"""Command line entry point: plan, approve, status. Run with `PYTHONPATH=tools python3 -m harness`."""
from __future__ import annotations

import argparse
import getpass
import hashlib
import json
import os
import re
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional

import shutil
import subprocess
import time

from . import approval, assets, humantasks, investigate, isolation, models, plans, providers, reconcile, runner, schemas, status, workrecord
from .github import GhCli, GitHubError
from .approval import AuthorizationError, plan_entity
from .checks import SandboxChecker
from .repo import GitRepo
from .store import Store, default_home


def _slug(path: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", os.path.basename(path).lower()).strip("-") or "plan"


def plan_command(store: Optional[Store], requirements: str, phases_path: Optional[str] = None,
                 plan_id: Optional[str] = None, fixture: bool = False, dry_run: bool = False,
                 model_sources: Optional[List[str]] = None, intent: Optional[str] = None) -> Dict[str, Any]:
    """Build a plan from requirements. Without phases the plan stays Draft and lists what is missing."""
    reqs = plans.parse_requirements(requirements)
    phases = None
    draft_sources = None
    if phases_path:
        with open(phases_path, encoding="utf-8") as fh:
            data = json.load(fh)
        phases = data["phases"] if isinstance(data, dict) else data
        draft_sources = data.get("model_sources") if isinstance(data, dict) else None  # the investigator's choice
    plan_id = plan_id or _slug(requirements)
    latest = store.get_plan(plan_id) if store else None
    version = latest["plan"]["version"] + 1 if latest else 1
    catalog = models.load_catalog(store.home) if store else None
    plan = plans.build_plan(plan_id, version, reqs, phases, fixture=fixture, model_sources=model_sources or draft_sources,
                            catalog=catalog, intent=intent)
    digest = plans.plan_digest(plan)
    result: Dict[str, Any] = {"plan_id": plan_id, "version": version, "digest": digest, "requirements": len(reqs), "dry_run": dry_run,
                              "model_sources": plan["policy"].get("model_sources")}
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


def preflight_checks(store: Store, repo_root: str, checks: List[Dict[str, str]], key: str) -> Dict[str, Any]:
    """Run approved check definitions in the worker image before approval or issue import."""
    repo = GitRepo(repo_root, "main")
    head = repo.base_head()
    checker = SandboxChecker(repo, os.path.join(store.home, "copilot.token"))
    results = checker.preflight(head, checks)
    record = {"head": head, "results": results, "checked_at": time.time()}
    store.put_doc("check_preflight_result", key, record)
    return record


def phase_allowlists(phases: List[Dict[str, Any]], phase_id: str) -> List[str]:
    """The phase's own allowlist plus those of every phase that runs before it, so a check may rely on their files."""
    by_id = {phase["id"]: phase for phase in phases}
    seen, out, stack = set(), [], [phase_id]
    while stack:
        current = stack.pop()
        if current in seen or current not in by_id:
            continue
        seen.add(current)
        out.extend(by_id[current].get("path_allowlist", []))
        stack.extend(by_id[current].get("dependencies", []))
    return out


def preflight_plan(store: Store, plan_id: str, version: Optional[int], repo_root: str,
                   issue_docs: Optional[List[Dict[str, Any]]] = None) -> Dict[str, Any]:
    stored = store.get_plan(plan_id, version)
    if stored is None:
        raise AuthorizationError("unknown plan %s" % plan_id)
    plan = stored["plan"]
    checks = [{"command": command, "working_directory": phase.get("working_directory", ".")}
              for phase in plan["phases"] for command in phase["validation"]]
    phases = {phase["id"]: phase for phase in plan["phases"]}
    declared = [(command, phase.get("working_directory", "."), phase_allowlists(plan["phases"], phase["id"]), "phase %s" % phase["id"])
                for phase in plan["phases"] for command in phase["validation"]]
    for issue in issue_docs or []:
        schemas.validate(issue, runner.ISSUE_SCHEMA, "issue")
        phase = phases.get(issue.get("phase_id"), {})
        directory = issue.get("working_directory") or phase.get("working_directory", ".")
        allowlist = phase_allowlists(plan["phases"], issue.get("phase_id"))
        for command in issue.get("validation_commands") or []:
            checks.append({"command": command, "working_directory": directory})
            declared.append((command, directory, allowlist, "issue %s" % issue.get("issue_id")))
    node = repo_root and GitRepo(repo_root, "main")
    for command, directory, allowlist, label in declared:
        problem = plans.command_paths_problem(command, directory, allowlist, node.path_exists if node else (lambda _p: True))
        if problem:
            raise runner.RunRefused("%s validation command %r: %s" % (label, command, problem))
    for check in checks:
        problem = plans.command_problem(check["command"])
        if problem:
            raise runner.RunRefused("validation command %r is not allowed: %s" % (check["command"], problem))
    key = plan_entity(plan_id, plan["version"])
    result = preflight_checks(store, repo_root, checks, key)
    result["digest"] = stored["digest"]
    if issue_docs is not None:
        result["issue_digest"] = hashlib.sha256(plans.canonical(issue_docs)).hexdigest()
        result["issue_docs"] = issue_docs
    store.put_doc("check_preflight", key, result)
    return result


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
        if args.cmd == "pause":
            result = runner.request_pause(store, args.plan_id, version, args.now)
            print("plan %s v%d: %s" % (args.plan_id, version, "paused" if result == "Paused" else
                  "pause requested. %s. The run stops by itself, then `resume` continues" % ("active workers are being cancelled" if args.now else "waiting for active workers to finish")))
            return 0
        if args.cmd == "cancel":
            print("plan %s v%d: %s" % (args.plan_id, version, runner.request_cancel(store, args.plan_id, version, args.drain)))
            return 0
        if args.cmd == "import-issues":
            stored = store.get_plan(args.plan_id, version)
            if stored is None:
                raise runner.RunRefused("unknown plan %s" % args.plan_id)
            with open(args.file, encoding="utf-8") as fh:
                issue_docs = json.load(fh)
            issue_docs = issue_docs["issues"] if isinstance(issue_docs, dict) else issue_docs
            phases = {p["id"]: p for p in stored["plan"]["phases"]}
            proof = store.get_doc("check_preflight", plan_entity(args.plan_id, version)) or {}
            issue_digest = hashlib.sha256(plans.canonical(issue_docs)).hexdigest()
            if proof.get("issue_digest") and proof["issue_digest"] != issue_digest:
                raise runner.RunRefused("issue definitions differ from the checks preflighted before approval")
            if not proof.get("issue_digest"):
                overrides = []
                for issue in issue_docs:
                    phase = phases.get(issue.get("phase_id"), {})
                    commands_differ = bool(issue.get("validation_commands") and
                                           issue["validation_commands"] != phase.get("validation"))
                    directory_differ = bool(issue.get("working_directory") and
                                            issue["working_directory"] != phase.get("working_directory", "."))
                    if commands_differ or directory_differ:
                        overrides.append(issue["issue_id"])
                if overrides:
                    raise runner.RunRefused("issue-specific validation commands must be included with `harness plan --issues` before approval: %s" %
                                            ", ".join(overrides))
            checks = []
            probe = GitRepo(root, "main")
            for issue in issue_docs:
                phase = phases.get(issue.get("phase_id"), {})
                directory = issue.get("working_directory") or phase.get("working_directory", ".")
                commands = issue.get("validation_commands") or phase.get("validation", [])
                for command in commands:
                    problem = plans.command_problem(command)
                    if problem:
                        raise runner.RunRefused("issue %s validation command is not allowed: %s" % (issue.get("issue_id"), problem))
                    problem = plans.command_paths_problem(command, directory, phase_allowlists(stored["plan"]["phases"], issue.get("phase_id")), probe.path_exists)
                    if problem:
                        raise runner.RunRefused("issue %s validation command %r: %s" % (issue.get("issue_id"), command, problem))
                    checks.append({"command": command, "working_directory": directory})
            preflight = preflight_checks(store, root, checks, plan_entity(args.plan_id, version) + ":issues")
            config_errors = [r for r in preflight["results"] if r["kind"] == "configuration"]
            if config_errors:
                raise runner.RunRefused("validation configuration errors prevent issue import: %s" %
                                        "; ".join("%s: %s" % (r["command"], r.get("output", "")) for r in config_errors[:3]))
            base = subprocess.run(["git", "-C", root, "rev-parse", "main"], capture_output=True, text=True).stdout.strip()
            print("imported:", ", ".join(runner.import_issues(store, args.plan_id, version, args.file, base, replace=True)) or "nothing new")
            return 0
        if not store.list_issues(args.plan_id):
            raise runner.RunRefused("no issues to schedule: supply refined issues with `import-issues`. Issue creation from phases is not automated yet")
        repo_slug = args.repo or detect_repo()
        upstream = "https://github.com/%s.git" % repo_slug
        sched = runner.build_scheduler(store, args.plan_id, version, root, args.dry_run, upstream, repo_slug, os.environ.get("USER", "owner"))
        tunnel = None
        if not args.no_tunnel:
            from . import remote as remote_mod
            settings = remote_mod.tunnel_settings(Path(root) if root else _repo_root())
            if settings["pin"] and not settings["disabled"]:
                tunnel = remote_mod.RemoteDashboard(root or str(_repo_root()), args.home, repo_slug)
                tunnel.start()
        if args.cmd == "resume" and store.state("plan", plan_entity(args.plan_id, version)) == "Completed":
            # a finished run is not resumed; it is watched until the owner merges or the watch expires
            return runner.watch_promotion(sched, args.interval, args.max_ticks,
                                          lambda e: print(json.dumps(e, sort_keys=True), flush=True))
        try:
            return runner.run_loop(sched, args.interval, args.max_ticks, lambda e: print(json.dumps(e, sort_keys=True), flush=True))
        finally:
            if tunnel is not None:
                tunnel.stop()
    except (runner.RunRefused, approval.AuthorizationError) as exc:
        print("error: %s" % exc, file=sys.stderr)
        return 2
    finally:
        store.close()


def providers_command(args) -> int:
    """Show, set, or remove a BYOK provider profile. The key is never echoed and never passed as an argument."""
    home = args.home or default_home()
    if args.action == "show":
        profiles = providers.redacted(home)
        if not profiles:
            print("no provider profiles in %s" % providers.path(home))
            return 0
        print(json.dumps(profiles, indent=2, sort_keys=True))
        return 0
    source = (args.source or "").strip()
    if source not in models.SOURCES:
        print("error: choose a source from %s" % ", ".join(models.SOURCES), file=sys.stderr)
        return 2
    if source == "copilot":
        print("error: copilot uses copilot.token, not a provider profile", file=sys.stderr)
        return 2
    if args.action == "rm":
        removed = providers.remove(home, source)
        print("removed %s" % source if removed else "no profile for %s" % source)
        return 0
    if args.api_key_env:
        key = os.environ.get(args.api_key_env, "").strip()
        if not key:
            print("error: %s is empty or unset" % args.api_key_env, file=sys.stderr)
            return 2
    else:
        if not sys.stdin.isatty():
            print("error: pass --api-key-env VAR, or run in a terminal to be prompted", file=sys.stderr)
            return 2
        key = getpass.getpass("API key for %s (not echoed): " % source).strip()
    try:
        cfg = providers.save(home, source, api_key=key, base_url=args.base_url, kind=args.type)
    except (ValueError, OSError) as exc:
        print("error: %s" % exc, file=sys.stderr)
        return 2
    print("saved %s -> %s (%s), key %s" % (source, cfg["baseUrl"], cfg["type"],
                                           providers.redacted(home).get(source, {}).get("apiKey", "")))
    return 0


def models_command(args) -> int:
    """Show the picker menu per source and which ids this runtime accepts. Read-only apart from the probe cache."""
    store = Store(args.home)
    try:
        catalog = models.load_catalog(store.home)
        sources = list(dict.fromkeys(args.source or list(models.SOURCES)))
        root = subprocess.run(["git", "rev-parse", "--show-toplevel"], capture_output=True, text=True).stdout.strip()
        report = runner.probe_menu(store.home, sources, root, refresh=args.refresh, catalog=catalog)
        if not report["reachable"]:
            print("model routing unavailable: %s; showing candidates only" % report["reason"])
        available = set(report["available"])
        for source in sources:
            print(source)
            for tier in models.TIERS:
                shown = ["%s %s" % (model, "yes" if model in available else "no") for model in catalog[source][tier]]
                print("  %-8s %s" % (tier, ", ".join(shown) or "-"))
        if report["reachable"]:
            accepted = [model for model in report["candidates"] if model in available]
            print("menu with %s: %d of %d model(s) accepted" % ("+".join(sources), len(accepted), len(report["candidates"])))
            if report["candidates"] and not accepted:
                print("none accepted; replace the ids for this runtime in %s" % os.path.join(store.home, models.CATALOG_FILE), file=sys.stderr)
        return 0
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
        policy = plans.with_model_sources(plans.DEFAULT_POLICY, args.model_source, models.load_catalog(store.home))
        tiers = policy["model_tiers"]
        candidates = sorted({m for v in tiers.values() for m in ([v] if isinstance(v, str) else v)})
        available = runner.cached_models(adapter, store.home, candidates)
        if available is not None and not available:
            raise runner.RunRefused("none of the %s models are available in this runtime; check them with `harness models --source %s`"
                                    % ("+".join(policy["model_sources"]), " --source ".join(policy["model_sources"])))
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
        print("Draft written to %s: %d phases, %d issues (tier %s, model %s, sources %s)" % (
            out, result["phases"], result["issues"], result["tier"], result["model"], "+".join(policy["model_sources"])))
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


def defer_command(args) -> int:
    from . import descope
    store = Store(args.home)
    try:
        stored = store.get_plan(args.plan_id, args.version)
        if stored is None:
            raise runner.RunRefused("unknown plan %s" % args.plan_id)
        plan = stored["plan"]
        if args.list or not args.requirement:
            records = descope.deferrals(store, args.plan_id, plan["version"])
            print("\n".join(descope.describe(records)) or "no deferred requirements")
            return 0
        record = descope.defer(store, args.plan_id, args.requirement, reason=args.reason or "",
                               followup_issue=args.followup or "", actor=getpass.getuser(), version=plan["version"])
        print(json.dumps(record, indent=2, sort_keys=True))
        return 0
    except descope.DescopeError as exc:
        print("error: %s" % exc, file=sys.stderr)
        return 2
    finally:
        store.close()


def restore_command(args) -> int:
    from . import descope
    store = Store(args.home)
    try:
        draft = descope.restore_draft(store, args.plan_id, args.version)
        out = args.out or os.path.join("uploads", draft["plan_id"])
        os.makedirs(out, exist_ok=True)
        with open(os.path.join(out, "requirements.md"), "w", encoding="utf-8") as fh:
            fh.write(draft["requirements_markdown"])
        with open(os.path.join(out, "phases.json"), "w", encoding="utf-8") as fh:
            json.dump(draft["phases"], fh, indent=2)
        with open(os.path.join(out, "issues.json"), "w", encoding="utf-8") as fh:
            json.dump(draft["issues"], fh, indent=2)
        print(json.dumps({"plan_id": draft["plan_id"], "out": out,
                          "issues": [i["issue_id"] for i in draft["issues"]["issues"]]}, indent=2))
        return 0
    except descope.DescopeError as exc:
        print("error: %s" % exc, file=sys.stderr)
        return 2
    finally:
        store.close()


def discard_run_command(args) -> int:
    store = Store(args.home)
    try:
        root = subprocess.run(["git", "rev-parse", "--show-toplevel"], capture_output=True, text=True).stdout.strip()
        result = runner.discard_run_branch(store, args.plan_id, args.version, root or ".", args.remote)
        print("%s %s" % (result["branch"], "deleted" if result["deleted"] else "did not exist"))
        return 0
    except runner.RunRefused as exc:
        print("error: %s" % exc, file=sys.stderr)
        return 2
    finally:
        store.close()


def archive_command(args) -> int:
    """Hide a plan or a workspace from the dashboard. Nothing is deleted, and `status` still lists everything."""
    from . import gui_workflow
    store = Store(args.home)
    try:
        if args.kind == "plan" and store.get_plan(args.target) is None:
            raise runner.RunRefused("unknown plan %s" % args.target)
        if args.kind == "workspace" and store.get_doc("gui_workspace", args.target) is None:
            raise runner.RunRefused("unknown workspace %s" % args.target)
        record = gui_workflow.set_archived(store, args.kind, args.target, archived=not args.undo)
        print("%s %s: %s" % (record["kind"], record["target"], "archived" if record["archived"] else "visible"))
        return 0
    finally:
        store.close()


def task_command(args) -> int:
    store = Store(args.home)
    try:
        if args.cmd == "tasks":
            open_tasks = [t for t in store.human_tasks() if t["state"] in humantasks.OPEN_STATES]
            print("\n\n".join(humantasks.render_task(t) for t in open_tasks) or "no open tasks")
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


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[2]


def main(argv: Optional[List[str]] = None) -> int:
    ap = argparse.ArgumentParser(prog="harness")
    ap.add_argument("--home", help="runtime store directory (default: ~/.local/state/derschweigert-harness or $HARNESS_HOME)")
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("plan", help="build a plan from requirements")
    p.add_argument("--requirements", required=True)
    p.add_argument("--phases", help="JSON file with the phase definitions")
    p.add_argument("--issues", help="issue definitions to include in pre-approval check preflight")
    p.add_argument("--plan-id")
    p.add_argument("--intent", help="one short paragraph on why this plan exists; every worker reads it")
    p.add_argument("--fixture", action="store_true", help="mark the plan as a test fixture")
    p.add_argument("--dry-run", action="store_true")
    p.add_argument("--model-source", action="append", choices=list(models.SOURCES),
                   help="where the picker menu takes models from (repeatable; default: the phases file's choice, else copilot)")
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
    r.add_argument("--no-tunnel", action="store_true", help="do not auto-start the remote dashboard tunnel")
    rs = sub.add_parser("resume", help="reconcile stored state and continue a paused or interrupted run")
    rs.add_argument("plan_id")
    rs.add_argument("--version", type=int)
    rs.add_argument("--dry-run", action="store_true")
    rs.add_argument("--interval", type=float, default=30.0)
    rs.add_argument("--max-ticks", type=int)
    rs.add_argument("--repo")
    rs.add_argument("--no-tunnel", action="store_true", help="do not auto-start the remote dashboard tunnel")
    pz = sub.add_parser("pause", help="pause a running plan: finish the workers in flight, start nothing new, then stop")
    pz.add_argument("plan_id")
    pz.add_argument("--version", type=int)
    pz.add_argument("--now", action="store_true", help="cancel the workers in flight instead of waiting for them")
    cn = sub.add_parser("cancel", help="stop scheduling and terminate or drain active work")
    cn.add_argument("plan_id")
    cn.add_argument("--version", type=int)
    cn.add_argument("--drain", action="store_true", help="let active workers finish first")
    ii = sub.add_parser("import-issues", help="load refined implementation issues for an approved plan")
    ii.add_argument("plan_id")
    ii.add_argument("file")
    ii.add_argument("--version", type=int)
    st = sub.add_parser("start", help="one guided path: environment, investigate, plan, approve, import, run")
    st.add_argument("--requirements", help="requirements file (asked for when omitted)")
    st.add_argument("--out", help="investigation directory (default: <requirements>_plan)")
    st.add_argument("--plan-id")
    st.add_argument("--tier", choices=["low", "standard", "strong"], default="standard")
    st.add_argument("--model-source", action="append", choices=list(models.SOURCES), help="picker sources to allow (repeatable; asked when omitted)")
    st.add_argument("--repo", help="GitHub owner/name (detected from the remote when omitted)")
    st.add_argument("--redraft", action="store_true", help="investigate again even when a draft exists")
    iv = sub.add_parser("investigate", help="draft phases and issues from requirements with the investigator (asks you questions when needed)")
    iv.add_argument("--requirements", required=True)
    iv.add_argument("--out", help="output directory (default: <requirements>_plan next to the requirements file)")
    iv.add_argument("--tier", choices=["low", "standard", "strong"], default="standard")
    iv.add_argument("--model-source", action="append", choices=list(models.SOURCES),
                    help="where the picker menu takes models from (repeatable; default copilot)")
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
    df = sub.add_parser("defer", help="defer a requirement to a named follow-up issue so the plan can end")
    df.add_argument("plan_id")
    df.add_argument("requirement", nargs="?")
    df.add_argument("--reason")
    df.add_argument("--followup")
    df.add_argument("--version", type=int)
    df.add_argument("--list", action="store_true")
    rs = sub.add_parser("restore", help="write a follow-up plan that adds deferred requirements back, one at a time")
    rs.add_argument("plan_id")
    rs.add_argument("--version", type=int)
    rs.add_argument("--out", help="directory for requirements.md, phases.json and issues.json")
    dr = sub.add_parser("discard-run", help="delete a stopped plan's run branch so the next run starts clean")
    dr.add_argument("plan_id")
    dr.add_argument("--version", type=int)
    dr.add_argument("--remote", help="the repository URL; defaults to this working copy")
    ar = sub.add_parser("archive", help="hide a finished plan or an old workspace from the dashboard")
    ar.add_argument("kind", choices=["plan", "workspace"])
    ar.add_argument("target", help="the plan id or workspace id")
    ar.add_argument("--undo", action="store_true", help="show it in the dashboard again")
    tk = sub.add_parser("tasks", help="list open human tasks")
    st = sub.add_parser("sync-tasks", help="mirror open human tasks as GitHub issues")
    st.add_argument("plan_id")
    st.add_argument("--repo")
    st.add_argument("--dry-run", action="store_true")
    asx = sub.add_parser("assets", help="asset tooling")
    asx.add_argument("action", choices=["probe"])
    i = sub.add_parser("isolation", help="Tier A worker sandbox: build the image, verify it, or show the tier")
    i.add_argument("action", choices=["build", "verify", "status"])
    pv = sub.add_parser("providers", help="manage BYOK provider profiles (endpoint and key) for non-Copilot sources")
    pv.add_argument("action", choices=["show", "set", "rm"])
    pv.add_argument("source", nargs="?", help="model source, e.g. deepseek")
    pv.add_argument("--base-url", help="API endpoint; defaults to the known URL for the source")
    pv.add_argument("--type", default="openai", choices=["openai", "azure", "anthropic"], help="provider wire type")
    pv.add_argument("--api-key-env", help="read the key from this environment variable instead of prompting")
    md = sub.add_parser("models", help="show the picker menu per source and which models this runtime accepts")
    md.add_argument("--source", action="append", choices=list(models.SOURCES), help="source to show (repeatable; default all)")
    md.add_argument("--refresh", action="store_true", help="probe again instead of using the cached result")
    q = sub.add_parser("probe", help="read-only GitHub capability probe")
    q.add_argument("--repo")
    rc = sub.add_parser("reconcile-completion", help="verify and record work completed outside the harness")
    rc.add_argument("issue_id")
    rc.add_argument("--pr", type=int, required=True)
    rc.add_argument("--sha", required=True, help="full PR head SHA")
    rc.add_argument("--repo", help="GitHub owner/name")
    ish = sub.add_parser("issue", help="show everything about one issue (read-only)")
    ish.add_argument("issue_id")
    ish.add_argument("--json", action="store_true")
    s = sub.add_parser("status", help="read-only status")
    s.add_argument("--plan", help="show only this plan, e.g. bugfixes-001-md")
    s.add_argument("--json", action="store_true")
    dashboard = sub.add_parser("gui", help="monitor and manage the harness in a local browser")
    dashboard.add_argument("--host", choices=["127.0.0.1", "localhost"], default="127.0.0.1")
    dashboard.add_argument("--port", type=int, default=8765, help="loopback port, or 0 to choose an available port")
    dashboard.add_argument("--refresh", type=int, default=5, help="refresh interval in seconds")
    dashboard.add_argument("--read-only", action="store_true")
    dashboard.add_argument("--no-browser", action="store_true")
    dashboard.add_argument("--no-tunnel", action="store_true", help="do not auto-start the PIN-locked relay and Cloudflare tunnel")
    dashboard.add_argument("--repo", help="GitHub owner/name for GUI-launched runs")
    rm = sub.add_parser("remote", help="PIN-locked loopback relay that proxies the local GUI for a tunnel")
    rm.add_argument("--upstream", default="http://127.0.0.1:8765", help="the loopback harness GUI URL")
    rm.add_argument("--host", choices=["127.0.0.1", "localhost"], default="127.0.0.1")
    rm.add_argument("--port", type=int, default=8443, help="loopback port, or 0 to choose an available port")
    rm.add_argument("--pin", help="override HARNESS_GUI_PIN")
    rm.add_argument("--session-hours", type=float, default=12.0, help="signed session lifetime in hours")
    args = ap.parse_args(argv)

    try:
        if args.cmd == "gui":
            from . import gui, remote
            try:
                if not args.no_tunnel:
                    settings = remote.tunnel_settings(_repo_root())
                    if settings["pin"] and not settings["disabled"]:
                        dashboard = gui.make_server(args.home, host=args.host, port=args.port,
                                                   refresh=args.refresh, read_only=args.read_only)
                        dashboard.repo_slug = args.repo
                        tunnel = remote.RemoteDashboard(_repo_root(), args.home, args.repo, gui_server=dashboard)
                        tunnel.start()
                        try:
                            return gui.serve_server(dashboard, open_browser=not args.no_browser)
                        finally:
                            tunnel.stop()
                return gui.serve(args.home, host=args.host, port=args.port, refresh=args.refresh, read_only=args.read_only,
                                 open_browser=not args.no_browser, repo=args.repo)
            except ValueError as exc:
                raise RuntimeError(str(exc)) from exc
        if args.cmd == "remote":
            from . import remote
            try:
                return remote.serve(args.upstream, host=args.host, port=args.port, pin=args.pin,
                                    session_hours=args.session_hours)
            except ValueError as exc:
                raise RuntimeError(str(exc)) from exc
        if args.cmd == "issue":
            detail = status.issue_detail(args.home, args.issue_id)
            print(json.dumps(detail, indent=2, sort_keys=True, default=str) if args.json else status.render_issue(detail))
            return 0
        if args.cmd == "status":
            report = status_report(args.home)
            if args.plan:
                if args.plan not in {p["plan_id"] for p in report["plans"]}:
                    print("no plan %r; known: %s" % (args.plan, ", ".join(p["plan_id"] for p in report["plans"])), file=sys.stderr)
                    return 2
                report = status.filter_plan(report, args.plan)
            print(json.dumps(report, indent=2, sort_keys=True, default=str) if args.json else status.render(report))
            return 0
        if args.cmd == "plan":
            store = None if args.dry_run and not os.path.exists(os.path.join(args.home or default_home(), "harness.sqlite")) else Store(args.home)
            result = plan_command(store, args.requirements, args.phases, args.plan_id, args.fixture, args.dry_run,
                                  model_sources=args.model_source)
            if store is not None and not args.dry_run and result.get("state") == "Proposed" and args.phases:
                issue_path = args.issues
                if issue_path is None:
                    sibling = os.path.join(os.path.dirname(os.path.abspath(args.phases)), "issues.json")
                    issue_path = sibling if os.path.isfile(sibling) else None
                issue_docs = None
                if issue_path:
                    with open(issue_path, encoding="utf-8") as fh:
                        issue_docs = json.load(fh)
                    issue_docs = issue_docs["issues"] if isinstance(issue_docs, dict) else issue_docs
                root = subprocess.run(["git", "rev-parse", "--show-toplevel"], capture_output=True, text=True).stdout.strip()
                if not root:
                    raise runner.RunRefused("cannot locate the repository root for validation preflight")
                preflight = preflight_plan(store, result["plan_id"], result.get("version"), root, issue_docs)
                config_errors = [r for r in preflight["results"] if r["kind"] == "configuration"]
                if config_errors:
                    result["preflight_errors"] = config_errors
            print(json.dumps(result, indent=2, sort_keys=True))
            return 2 if result.get("preflight_errors") else 0
        if args.cmd in ("run", "resume", "cancel", "import-issues", "pause"):
            return runner_command(args)
        if args.cmd == "start":
            from .start import run_start
            return run_start(args)
        if args.cmd == "investigate":
            return investigate_command(args)
        if args.cmd == "defer":
            return defer_command(args)
        if args.cmd == "restore":
            return restore_command(args)
        if args.cmd == "discard-run":
            return discard_run_command(args)
        if args.cmd == "archive":
            return archive_command(args)
        if args.cmd in ("respond", "tasks", "sync-tasks"):
            return task_command(args)
        if args.cmd == "assets":
            print(json.dumps(assets.BlenderCli().probe(), indent=2, sort_keys=True))
            return 0
        if args.cmd == "isolation":
            return isolation_command(args.action, args.home)
        if args.cmd == "providers":
            return providers_command(args)
        if args.cmd == "models":
            return models_command(args)
        if args.cmd == "probe":
            print(json.dumps(GhCli(args.repo or detect_repo(), token_file=broker_token_file(args.home)).capabilities(), indent=2, sort_keys=True))
            return 0
        if args.cmd == "reconcile-completion":
            store = Store(args.home)
            try:
                result = reconcile.reconcile_completion(store, GhCli(args.repo or detect_repo(), token_file=broker_token_file(args.home)),
                                                        args.issue_id, args.pr, args.sha, getpass.getuser())
                print(json.dumps(result, indent=2, sort_keys=True))
                return 0
            finally:
                store.close()
        if args.cmd == "sync":
            repo = args.repo or detect_repo()
            store = Store(args.home)
            report = workrecord.sync_plan(GhCli(repo, token_file=broker_token_file(args.home)), store, args.plan_id, args.version, [repo.split("/")[0]] + args.allow_author, dry_run=args.dry_run)
            print(json.dumps(report, indent=2, sort_keys=True))
            return 1 if report["pending"] else 0
        store = Store(args.home)
        root = subprocess.run(["git", "rev-parse", "--show-toplevel"], capture_output=True, text=True).stdout.strip()
        if not root:
            raise runner.RunRefused("cannot locate the repository root for validation preflight")
        approved_plan = store.get_plan(args.plan_id, args.version)
        if approved_plan is None:
            raise runner.RunRefused("unknown plan %s" % args.plan_id)
        key = plan_entity(args.plan_id, approved_plan["plan"]["version"])
        previous = store.get_doc("check_preflight", key) or {}
        preflight = preflight_plan(store, args.plan_id, args.version, root, previous.get("issue_docs"))
        config_errors = [r for r in preflight["results"] if r["kind"] == "configuration"]
        if config_errors:
            raise AuthorizationError("validation configuration errors must be fixed before approval: %s" %
                                     "; ".join("%s: %s" % (r["command"], r.get("output", "")) for r in config_errors[:3]))
        record = approval.approve(store, args.plan_id, args.version, getpass.getuser(), terminal_confirm, require_preflight=True)
        print("approved %s v%d digest %s" % (record["plan_id"], record["version"], record["digest"][:12]))
        return 0
    except (runner.RunRefused, AuthorizationError, reconcile.ReconciliationError, schemas.SchemaError, GitHubError, humantasks.TaskError,
            RuntimeError, OSError, KeyError) as exc:
        print("error: %s" % exc, file=sys.stderr)
        return 2
