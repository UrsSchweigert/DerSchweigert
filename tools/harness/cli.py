"""Command line entry point: plan, approve, status. Run with `PYTHONPATH=tools python3 -m harness`."""
from __future__ import annotations

import argparse
import getpass
import json
import os
import re
import sys
from typing import Any, Dict, List, Optional

import shutil
import subprocess
import time

from . import approval, assets, humantasks, investigate, isolation, plans, runner, schemas, status, workrecord
from .github import GhCli, GitHubError
from .approval import AuthorizationError, plan_entity
from .store import Store, default_home


def _slug(path: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", os.path.basename(path).lower()).strip("-") or "plan"


def plan_command(store: Optional[Store], requirements: str, phases_path: Optional[str] = None,
                 plan_id: Optional[str] = None, fixture: bool = False, dry_run: bool = False) -> Dict[str, Any]:
    """Build a plan from requirements. Without phases the plan stays Draft and lists what is missing."""
    reqs = plans.parse_requirements(requirements)
    phases = None
    if phases_path:
        with open(phases_path, encoding="utf-8") as fh:
            data = json.load(fh)
        phases = data["phases"] if isinstance(data, dict) else data
    plan_id = plan_id or _slug(requirements)
    latest = store.get_plan(plan_id) if store else None
    version = latest["plan"]["version"] + 1 if latest else 1
    plan = plans.build_plan(plan_id, version, reqs, phases, fixture=fixture)
    digest = plans.plan_digest(plan)
    result: Dict[str, Any] = {"plan_id": plan_id, "version": version, "digest": digest, "requirements": len(reqs), "dry_run": dry_run}
    if latest and latest["digest"] == digest:
        result.update(version=latest["plan"]["version"], unchanged=True, state=store.state("plan", plan_entity(plan_id, latest["plan"]["version"])))
        return result
    problems = plans.validate_plan(plan)
    result["problems"] = problems
    result["state"] = "Draft" if problems else "Proposed"
    if latest:
        result["changed_phases"] = plans.changed_phases(latest["plan"], plan)
    if dry_run or store is None:
        return result
    with store.tx() as cx:
        store.put_plan(plan, digest)
        if latest:
            old_entity = plan_entity(plan_id, latest["plan"]["version"])
            old_state = store.state("plan", old_entity)
            if old_state in ("Approved", "Executing", "Paused"):
                store._transition(cx, "plan", old_entity, "Superseded", "planner", {"superseded_by": version}, None, None)
            elif old_state == "Proposed":
                store._transition(cx, "plan", old_entity, "Draft", "planner", {"revised_as": version}, None, None)
        entity = plan_entity(plan_id, version)
        if not problems:
            store._transition(cx, "plan", entity, "Proposed", "planner", {"digest": digest}, None, None)
        else:
            cx.execute("INSERT OR IGNORE INTO entities(machine, id, state) VALUES('plan', ?, 'Draft')", (entity,))
    return result


def terminal_confirm(plan: Dict[str, Any], digest: str) -> bool:
    """Trusted human interaction: needs a real terminal and the digest prefix typed back."""
    if not (sys.stdin.isatty() and sys.stdout.isatty()):
        print("approval needs an interactive terminal", file=sys.stderr)
        return False
    print("Plan %s v%d  digest %s" % (plan["plan_id"], plan["version"], digest))
    for p in plan["phases"]:
        print("  phase %-12s reqs=%s deps=%s paths=%s" % (p["id"], ",".join(p["requirements"]), ",".join(p["dependencies"]) or "-", ",".join(p["path_allowlist"])))
    pol = plan["policy"]
    print("  authorized: %s" % ", ".join(pol["authorized_operations"]))
    print("  escalation paths: %s" % ", ".join(pol["escalation_paths"]))
    print("  merge policy: %s  budgets: %s" % (pol["merge_policy"], json.dumps(pol["budgets"], sort_keys=True)))
    print("  not authorized: production deploys, new paid services, credential changes, destructive actions, protection bypasses")
    return input("Type the first 12 characters of the digest to approve: ").strip() == digest[:12]


def status_report(home: Optional[str] = None, now: Optional[float] = None) -> Dict[str, Any]:
    return status.build_report(home, now)


def broker_token_file(home: Optional[str]) -> Optional[str]:
    path = os.path.join(home or default_home(), "broker.token")
    return path if os.path.exists(path) else None


def isolation_command(action: str, home: Optional[str]) -> int:
    home = home or default_home()
    if action == "build":
        print("built", isolation.build_image())
        return 0
    store = Store(home)
    try:
        if action == "verify":
            result = isolation.probe(home)
            print(json.dumps(result, indent=2, sort_keys=True))
            if not result["ok"]:
                return 1
            isolation.write_attestation(home, approval._load_key(store, True), result)
        print(json.dumps(approval.detect_isolation(store), sort_keys=True))
        return 0
    finally:
        store.close()


def runner_command(args) -> int:
    store = Store(args.home)
    rehearsal = None
    try:
        if args.cmd in ("run", "resume") and args.dry_run:
            rehearsal = runner.make_rehearsal(store.home)
            store.close()
            store = Store(rehearsal)
            print("DRY RUN on a throwaway copy of your state: %s\n  your real plan and issues are untouched. Watch it with:\n  harness --home %s status" % (rehearsal, rehearsal), flush=True)
        latest = store.get_plan(args.plan_id, args.version)
        if latest is None:
            raise runner.RunRefused("unknown plan %s" % args.plan_id)
        version = latest["plan"]["version"]
        root = subprocess.run(["git", "rev-parse", "--show-toplevel"], capture_output=True, text=True).stdout.strip()
        if args.cmd == "cancel":
            print("plan %s v%d: %s" % (args.plan_id, version, runner.request_cancel(store, args.plan_id, version, args.drain)))
            return 0
        if args.cmd == "import-issues":
            base = subprocess.run(["git", "-C", root, "rev-parse", "main"], capture_output=True, text=True).stdout.strip()
            print("imported:", ", ".join(runner.import_issues(store, args.plan_id, version, args.file, base)) or "nothing new")
            return 0
        if not store.list_issues(args.plan_id):
            raise runner.RunRefused("no issues to schedule: supply refined issues with `import-issues`. Issue creation from phases is not automated yet")
        repo_slug = args.repo or detect_repo()
        remote = "https://github.com/%s.git" % repo_slug
        sched = runner.build_scheduler(store, args.plan_id, version, root, args.dry_run, remote, repo_slug, os.environ.get("USER", "owner"))
        return runner.run_loop(sched, args.interval, args.max_ticks, lambda e: print(json.dumps(e, sort_keys=True), flush=True))
    except (runner.RunRefused, approval.AuthorizationError) as exc:
        print("error: %s" % exc, file=sys.stderr)
        return 2
    finally:
        store.close()


def investigate_command(args) -> int:
    store = Store(args.home)
    try:
        iso = approval.detect_isolation(store)
        if iso["tier"] != "A":
            raise runner.RunRefused("investigate refused, Tier B: %s. Run `isolation verify` first" % iso["reason"])
        root = subprocess.run(["git", "rev-parse", "--show-toplevel"], capture_output=True, text=True).stdout.strip()
        clone = runner.trusted_clone(store.home, root, "main")
        from .adapter import CopilotCliAdapter
        adapter = CopilotCliAdapter(store.home, clone.path, "main")
        probe = adapter.probe()
        if not probe["available"]:
            raise runner.RunRefused("the Copilot CLI sandbox adapter is unavailable: %s" % probe["reason"])
        policy = plans.DEFAULT_POLICY
        tiers = policy["model_tiers"]
        candidates = sorted({m for v in tiers.values() for m in ([v] if isinstance(v, str) else v)})
        available = runner.cached_models(adapter, store.home, candidates)
        base = os.path.basename(args.requirements)
        out = args.out or os.path.join(os.path.dirname(os.path.abspath(args.requirements)), base + "_plan")
        interactive = not args.non_interactive and sys.stdin.isatty()
        print("Starting the investigator (Ctrl+C stops it safely). Progress lines follow.", flush=True)
        inv = investigate.Investigator(adapter, clone, policy, available, tier=args.tier, max_rounds=args.max_rounds, timeout=args.timeout,
                                       log=lambda m: print(m, flush=True))
        try:
            feedback = list(args.feedback)
            if args.feedback_file:
                with open(args.feedback_file, encoding="utf-8") as fh:
                    feedback.append(fh.read())
            result = inv.run(args.requirements, out, answers_file=args.answers, interactive=interactive, force=args.force, feedback=feedback)
        except investigate.Aborted:
            print("stopped. Your answers so far are saved: run the same command to continue")
            return 130
        if result["status"] == "needs_answers":
            print("The investigator needs answers. See %s, then rerun with --answers FILE" % result["file"])
            return 3
        if result["status"] == "failed":
            print("No valid draft after %d attempts. Problems:\n  - %s\nThe last rejected draft is in %s/rejected-draft.json" % (
                result["attempts"], "\n  - ".join(result["problems"][:10]), out))
            return 1
        print("Draft written to %s: %d phases, %d issues (tier %s, model %s)" % (out, result["phases"], result["issues"], result["tier"], result["model"]))
        if result.get("archived"):
            print("The previous version is kept in %s" % result["archived"])
        for a in result["assumptions"]:
            print("  assumption: " + a)
        for f in result["flags"]:
            print("  needs a human merge: " + f)
        print("Review %s/investigation-report.md, then:\n  harness plan --requirements %s --phases %s/phases.json" % (out, args.requirements, out))
        return 0
    except (runner.RunRefused, investigate.InvestigationError) as exc:
        print("error: %s" % exc, file=sys.stderr)
        return 2
    finally:
        store.close()


def responder_ids() -> List[str]:
    """Identities established by trusted code: the OS account and, when gh is authenticated, the GitHub login."""
    ids = [getpass.getuser()]
    try:
        login = subprocess.run(["gh", "api", "user", "--jq", ".login"], capture_output=True, text=True, timeout=20).stdout.strip()
        if login:
            ids.append(login)
    except (OSError, subprocess.TimeoutExpired):
        pass
    return ids


def task_command(args) -> int:
    store = Store(args.home)
    try:
        if args.cmd == "tasks":
            for t in store.human_tasks():
                if t["state"] in humantasks.OPEN_STATES:
                    p = t["payload"]
                    print("%s [%s] %s owner %s issues %s\n  why: %s\n  request: %s\n  respond with: %s\n  done when: %s" % (
                        t["task_id"], p["kind"], t["state"], p["owner"], ",".join(p["issue_ids"]), p["why"], p["request"],
                        json.dumps(p["response_format"], sort_keys=True), p["resolution_criteria"]))
            return 0
        if args.cmd == "sync-tasks":
            repo = args.repo or detect_repo()
            out = workrecord.sync_human_tasks(GhCli(repo, token_file=broker_token_file(args.home)), store, args.plan_id, [repo.split("/")[0]], dry_run=args.dry_run)
            print(json.dumps(out, indent=2, sort_keys=True))
            return 1 if out["pending"] else 0
        now = time.time()
        if args.ack:
            humantasks.acknowledge(store, args.task_id, responder_ids(), "local", now)
            print("acknowledged")
            return 0
        answers: Dict[str, Any] = {}
        for pair in args.answer:
            key, _, value = pair.partition("=")
            answers[key] = value
        for key in ("option", "outcome", "tester", "revision", "notes", "guidance"):
            if getattr(args, key):
                answers[key] = getattr(args, key)
        if args.evidence:
            answers["evidence"] = args.evidence
        task = store.get_human_task(args.task_id)
        handler = None
        if task and task["payload"]["kind"] == "asset":
            issue = store.get_issue(task["issue_id"])
            plan = store.get_plan(issue["plan_id"])["plan"]
            root = subprocess.run(["git", "rev-parse", "--show-toplevel"], capture_output=True, text=True).stdout.strip()
            handler = assets.AssetService(store, issue["plan_id"], plan["policy"], root).accept_human_asset
        result = humantasks.respond(store, args.task_id, responder_ids=responder_ids(), source="local", answers=answers, now=now,
                                    artifacts=args.artifact, asset_handler=handler)
        print(json.dumps(result, sort_keys=True))
        return 0 if result["status"] == "resolved" else 1
    except humantasks.TaskError as exc:
        print("error: %s" % exc, file=sys.stderr)
        return 2
    finally:
        store.close()


def detect_repo() -> str:
    url = subprocess.run(["git", "remote", "get-url", "origin"], capture_output=True, text=True).stdout.strip()
    m = re.search(r"github\.com[:/]([^/]+/[^/.]+)", url)
    if not m:
        raise GitHubError("cannot determine the GitHub repository from the origin remote; pass --repo")
    return m.group(1)


def main(argv: Optional[List[str]] = None) -> int:
    ap = argparse.ArgumentParser(prog="harness")
    ap.add_argument("--home", help="runtime store directory (default: ~/.local/state/derschweigert-harness or $HARNESS_HOME)")
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("plan", help="build a plan from requirements")
    p.add_argument("--requirements", required=True)
    p.add_argument("--phases", help="JSON file with the phase definitions")
    p.add_argument("--plan-id")
    p.add_argument("--fixture", action="store_true", help="mark the plan as a test fixture")
    p.add_argument("--dry-run", action="store_true")
    a = sub.add_parser("approve", help="record human approval of a plan version")
    a.add_argument("plan_id")
    a.add_argument("--version", type=int)
    y = sub.add_parser("sync", help="create or reconcile the GitHub work record for a plan")
    y.add_argument("plan_id")
    y.add_argument("--version", type=int)
    y.add_argument("--repo")
    y.add_argument("--allow-author", action="append", default=[], help="GitHub login allowed to edit managed blocks (repo owner is always allowed)")
    y.add_argument("--dry-run", action="store_true")
    r = sub.add_parser("run", help="execute an approved plan (foreground, restartable)")
    r.add_argument("plan_id")
    r.add_argument("--version", type=int)
    r.add_argument("--dry-run", action="store_true", help="real workers, but no remote writes: pull requests and merges are only recorded")
    r.add_argument("--interval", type=float, default=30.0)
    r.add_argument("--max-ticks", type=int)
    r.add_argument("--repo", help="GitHub owner/name")
    rs = sub.add_parser("resume", help="reconcile stored state and continue a paused or interrupted run")
    rs.add_argument("plan_id")
    rs.add_argument("--version", type=int)
    rs.add_argument("--dry-run", action="store_true")
    rs.add_argument("--interval", type=float, default=30.0)
    rs.add_argument("--max-ticks", type=int)
    rs.add_argument("--repo")
    cn = sub.add_parser("cancel", help="stop scheduling and terminate or drain active work")
    cn.add_argument("plan_id")
    cn.add_argument("--version", type=int)
    cn.add_argument("--drain", action="store_true", help="let active workers finish first")
    ii = sub.add_parser("import-issues", help="load refined implementation issues for an approved plan")
    ii.add_argument("plan_id")
    ii.add_argument("file")
    ii.add_argument("--version", type=int)
    iv = sub.add_parser("investigate", help="draft phases and issues from requirements with the investigator (asks you questions when needed)")
    iv.add_argument("--requirements", required=True)
    iv.add_argument("--out", help="output directory (default: <requirements>_plan next to the requirements file)")
    iv.add_argument("--tier", choices=["low", "standard", "strong"], default="standard")
    iv.add_argument("--max-rounds", type=int, default=3, help="how many times the investigator may ask questions")
    iv.add_argument("--non-interactive", action="store_true", help="write questions.md and stop instead of asking in the terminal")
    iv.add_argument("--answers", help="JSON file mapping question id to answer, to continue a non-interactive run")
    iv.add_argument("--timeout", type=float, default=1200.0, help="seconds per investigator attempt")
    iv.add_argument("--force", action="store_true", help="start over: replace an existing phases.json and issues.json")
    iv.add_argument("--feedback", action="append", default=[], help="revise the existing draft: tell the investigator what to change or reconsider (repeatable)")
    iv.add_argument("--feedback-file", help="text file with feedback for revising the existing draft")
    rp = sub.add_parser("respond", help="answer a human task through the trusted local command")
    rp.add_argument("task_id")
    rp.add_argument("--option")
    rp.add_argument("--outcome", choices=["pass", "fail", "inconclusive"])
    rp.add_argument("--tester")
    rp.add_argument("--revision")
    rp.add_argument("--notes")
    rp.add_argument("--guidance")
    rp.add_argument("--evidence", action="append", default=[])
    rp.add_argument("--artifact", action="append", default=[])
    rp.add_argument("--answer", action="append", default=[], metavar="KEY=VALUE")
    rp.add_argument("--ack", action="store_true", help="acknowledge the task without answering")
    tk = sub.add_parser("tasks", help="list open human tasks")
    st = sub.add_parser("sync-tasks", help="mirror open human tasks as GitHub issues")
    st.add_argument("plan_id")
    st.add_argument("--repo")
    st.add_argument("--dry-run", action="store_true")
    asx = sub.add_parser("assets", help="asset tooling")
    asx.add_argument("action", choices=["probe"])
    i = sub.add_parser("isolation", help="Tier A worker sandbox: build the image, verify it, or show the tier")
    i.add_argument("action", choices=["build", "verify", "status"])
    q = sub.add_parser("probe", help="read-only GitHub capability probe")
    q.add_argument("--repo")
    ish = sub.add_parser("issue", help="show everything about one issue (read-only)")
    ish.add_argument("issue_id")
    ish.add_argument("--json", action="store_true")
    s = sub.add_parser("status", help="read-only status")
    s.add_argument("--json", action="store_true")
    args = ap.parse_args(argv)

    try:
        if args.cmd == "issue":
            detail = status.issue_detail(args.home, args.issue_id)
            print(json.dumps(detail, indent=2, sort_keys=True, default=str) if args.json else status.render_issue(detail))
            return 0
        if args.cmd == "status":
            report = status_report(args.home)
            print(json.dumps(report, indent=2, sort_keys=True, default=str) if args.json else status.render(report))
            return 0
        if args.cmd == "plan":
            store = None if args.dry_run and not os.path.exists(os.path.join(args.home or default_home(), "harness.sqlite")) else Store(args.home)
            result = plan_command(store, args.requirements, args.phases, args.plan_id, args.fixture, args.dry_run)
            print(json.dumps(result, indent=2, sort_keys=True))
            return 0
        if args.cmd in ("run", "resume", "cancel", "import-issues"):
            return runner_command(args)
        if args.cmd == "investigate":
            return investigate_command(args)
        if args.cmd in ("respond", "tasks", "sync-tasks"):
            return task_command(args)
        if args.cmd == "assets":
            print(json.dumps(assets.BlenderCli().probe(), indent=2, sort_keys=True))
            return 0
        if args.cmd == "isolation":
            return isolation_command(args.action, args.home)
        if args.cmd == "probe":
            print(json.dumps(GhCli(args.repo or detect_repo(), token_file=broker_token_file(args.home)).capabilities(), indent=2, sort_keys=True))
            return 0
        if args.cmd == "sync":
            repo = args.repo or detect_repo()
            store = Store(args.home)
            report = workrecord.sync_plan(GhCli(repo, token_file=broker_token_file(args.home)), store, args.plan_id, args.version, [repo.split("/")[0]] + args.allow_author, dry_run=args.dry_run)
            print(json.dumps(report, indent=2, sort_keys=True))
            return 1 if report["pending"] else 0
        store = Store(args.home)
        record = approval.approve(store, args.plan_id, args.version, getpass.getuser(), terminal_confirm)
        print("approved %s v%d digest %s" % (record["plan_id"], record["version"], record["digest"][:12]))
        return 0
    except (AuthorizationError, schemas.SchemaError, GitHubError, humantasks.TaskError, RuntimeError, OSError, KeyError) as exc:
        print("error: %s" % exc, file=sys.stderr)
        return 2
