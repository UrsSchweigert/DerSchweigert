"""Wiring for `run`, `resume`, and `cancel`: trusted clone, adapter probe, model cache, issue import, and the foreground loop."""
from __future__ import annotations

import json
import os
import shutil
import sqlite3
import subprocess
import tempfile
import time
from typing import Any, Dict, List, Optional

from . import approval, models, plans, schemas
import sys

from .adapter import CopilotCliAdapter
from .checks import DryRunPublisher, SandboxChecker
from .github import GhCli
from .humantasks import MultiNotifier, TerminalNotifier
from .publisher import GitHubPublisher, git_with_token
from .repo import GitRepo
from . import scheduler as scheduler_mod
from .scheduler import Scheduler, new_issue
from .store import Store

MODEL_CACHE_TTL_S = 24 * 3600
PROMOTION_POLL_S = 30            # how often a finished run re-reads its pull request while it waits for the merge
PROMOTION_WATCH_S = 6 * 3600     # an unattended finished run stops watching after this long
CLONE_TIMEOUT_S = 600            # a bare clone of this repository takes seconds; a hang must fail loudly, not wait forever
ISSUE_SCHEMA = {
    "issue_id": str, "phase_id": str, "requirement_ids": [str], "title?": str, "outcomes": [str], "acceptance_criteria": [str],
    "non_goals": [str], "code_anchors": [str], "contract_paths?": [str], "deps?": [str], "validation_commands?": [str],
    "working_directory?": str, "parallel_safe?": bool, "model_choices?": schemas.MODEL_CHOICES,
}


class RunRefused(Exception):
    pass


def import_issues(store: Store, plan_id: str, version: Optional[int], path: str, base_rev: str,
                  replace: bool = False) -> List[str]:
    """Load refined issues supplied by a human or an investigator pass. They enter Ready after validation against the approved plan.

    `replace` says the file is the plan's whole issue set, as `import-issues` declares: an issue of this plan that the
    file no longer names is then superseded instead of silently staying `Ready` for a plan that no longer contains it.
    """
    stored = store.get_plan(plan_id, version)
    if stored is None:
        raise RunRefused("unknown plan %s" % plan_id)
    plan = stored["plan"]
    with open(path, encoding="utf-8") as fh:
        docs = json.load(fh)
    docs = docs["issues"] if isinstance(docs, dict) else docs
    phases = {p["id"]: p for p in plan["phases"]}
    leftover = _leftovers(store, plan_id, {doc["issue_id"] for doc in docs}) if replace else []  # refuse before writing
    added, replaced = [], []
    for doc in docs:
        schemas.validate(doc, ISSUE_SCHEMA, "issue")
        for role, choice in doc.get("model_choices", {}).items():
            try:
                models.resolve_choice(choice, plan["policy"]["model_tiers"], None, role=role,
                                      strong_budget=plan["policy"]["budgets"]["strong_attempts_per_issue"] if role == "implementer" else 1)
            except ValueError as exc:
                raise RunRefused("issue %s %s model choice: %s" % (doc["issue_id"], role, exc)) from exc
        working_directory = doc.get("working_directory", ".")
        if (not working_directory or os.path.isabs(working_directory) or "\\" in working_directory
                or ".." in working_directory.split("/")):
            raise RunRefused("issue %s working_directory must stay inside the repository" % doc["issue_id"])
        for command in doc.get("validation_commands", []):
            problem = plans.command_problem(command)
            if problem:
                raise RunRefused("issue %s validation command is not allowed: %s" % (doc["issue_id"], problem))
        phase = phases.get(doc["phase_id"])
        if phase is None or not doc["requirement_ids"] or not set(doc["requirement_ids"]) <= set(phase["requirements"]):
            raise RunRefused("issue %s must reference one approved phase and its requirement IDs" % doc["issue_id"])
        existing = store.get_issue(doc["issue_id"])
        if existing is not None and store.state("issue", doc["issue_id"]) == "Cancelled":
            _revive_or_refuse(store, existing, plan_id)
            store.put_issue(new_issue(doc["issue_id"], plan_id, doc["phase_id"], doc["requirement_ids"], base_rev=base_rev,
                                      **_definition(doc)))
            store.transition("issue", doc["issue_id"], "Ready", "import", {"reason": "re-added"})
            added.append(doc["issue_id"])
            continue
        if existing is not None:
            if (existing.get("plan_id") == plan_id and _unchanged(existing, doc)
                    and store.state("issue", doc["issue_id"]) == "Done"):
                continue  # preserve completed work and its exact historical evidence on a plan revision
            _adopt_or_refuse(store, existing, plan_id)
            if _unchanged(existing, doc):
                if base_rev and existing.get("base_rev") != base_rev:
                    store.put_issue(dict(existing, base_rev=base_rev))  # re-anchor it to the base just resolved
                continue  # already imported from this definition
            store.put_issue(new_issue(doc["issue_id"], plan_id, doc["phase_id"], doc["requirement_ids"], base_rev=base_rev,
                                      **_definition(doc)))
            replaced.append(doc["issue_id"])
            continue
        store.put_issue(new_issue(doc["issue_id"], plan_id, doc["phase_id"], doc["requirement_ids"], base_rev=base_rev, **_definition(doc)))
        for state in ("Refining", "Ready"):
            store.transition("issue", doc["issue_id"], state, "import")
        added.append(doc["issue_id"])
    superseded = _retire(store, plan_id, leftover)
    store.put_doc("import_report", plan_id, {"added": added, "replaced": replaced, "superseded": superseded})
    return added + replaced


def _leftovers(store: Store, plan_id: str, imported: set) -> List[Dict[str, Any]]:
    """Issues of this plan that the new document no longer names. A revised plan renames or merges issues, and the old
    rows would otherwise stay `Ready` and be dispatched by a plan whose phases no longer contain them."""
    leftovers = [i for i in store.list_issues(plan_id)
                 if i["issue_id"] not in imported and store.state("issue", i["issue_id"]) not in ("Done", "Cancelled")]
    landed = sorted(i["issue_id"] for i in leftovers
                    if i.get("head_rev") or i.get("pr") is not None or store.active_claims_for(i["issue_id"]))
    if landed:
        raise RunRefused("issue %s from an earlier version already has work and is not part of this plan version"
                         % ", ".join(landed))
    return leftovers


def _retire(store: Store, plan_id: str, leftovers: List[Dict[str, Any]]) -> List[str]:
    retired = []
    for existing in leftovers:
        store.transition("issue", existing["issue_id"], "Cancelled", "import", {"reason": "not part of this plan version"})
        retired.append(existing["issue_id"])
    return retired


_DEFINITION_FIELDS = ("title", "outcomes", "acceptance_criteria", "non_goals", "code_anchors", "contract_paths", "deps",
                      "validation_commands", "working_directory", "parallel_safe", "model_choices")


def _definition(doc: Dict[str, Any]) -> Dict[str, Any]:
    """The parts of an issue that define the work, so an unchanged re-import stays a no-op."""
    return {key: doc[key] for key in _DEFINITION_FIELDS if key in doc}


def _unchanged(existing: Dict[str, Any], doc: Dict[str, Any]) -> bool:
    """Compare only the fields the new document states, so fields the harness defaults do not look like a change."""
    definition = _definition(doc)
    return plans.canonical({key: existing.get(key) for key in definition}) == plans.canonical(definition)


def _adopt_or_refuse(store: Store, existing: Dict[str, Any], plan_id: str) -> None:
    """A new plan version may replace an issue definition that no worker has touched yet.

    Re-importing used to skip every existing id silently, so a corrected plan never reached the issue it corrected.
    """
    issue_id = existing["issue_id"]
    if existing.get("plan_id") != plan_id:
        raise RunRefused("issue %s already belongs to plan %s; issue ids are global" % (issue_id, existing.get("plan_id")))
    state = store.state("issue", issue_id)
    if existing.get("head_rev") or existing.get("pr") is not None or store.active_claims_for(issue_id) or \
            state not in ("Inbox", "Refining", "Ready", "Blocked"):
        raise RunRefused("issue %s is already %s and has work recorded; a new plan version cannot replace it"
                         % (issue_id, state))


def _revive_or_refuse(store: Store, existing: Dict[str, Any], plan_id: str) -> None:
    """A cancelled issue may be put back only while nothing ever landed for it."""
    issue_id = existing["issue_id"]
    if existing.get("plan_id") != plan_id:
        raise RunRefused("issue %s already belongs to plan %s; issue ids are global" % (issue_id, existing.get("plan_id")))
    if existing.get("head_rev") or existing.get("pr") is not None or store.active_claims_for(issue_id):
        raise RunRefused("issue %s was cancelled after it had work; add a fresh issue instead" % issue_id)


def _clone_env(home: str) -> Dict[str, str]:
    """A git environment with no user, system, or terminal input: an unattended clone must never wait on a prompt."""
    return {"PATH": os.environ.get("PATH", ""), "GIT_CONFIG_GLOBAL": os.devnull, "GIT_CONFIG_NOSYSTEM": "1",
            "GIT_TERMINAL_PROMPT": "0", "HOME": home}


def clone_bare(home: str, source_repo: str, path: str, timeout: float = CLONE_TIMEOUT_S) -> None:
    """Clone into a scratch directory and move it into place, so `path` exists only once the clone has finished.

    `--no-local` forces the protocol transfer. The local transport copies the object directory file by file and
    stalled for nearly an hour on this repository, with no timeout to end it. A failed or interrupted attempt is
    kept for inspection and named in the error, but never where the next call would read it as a finished clone.
    """
    partial = tempfile.mkdtemp(prefix="trusted-clone.git.partial-", dir=home)
    scratch = os.path.join(partial, "clone.git")
    try:
        proc = subprocess.run(["git", "clone", "--quiet", "--bare", "--no-local", source_repo, scratch],
                              capture_output=True, text=True, timeout=timeout, env=_clone_env(home))
    except subprocess.TimeoutExpired:
        raise RunRefused("cloning %s timed out after %gs; the incomplete attempt is kept at %s"
                         % (source_repo, timeout, partial))
    if proc.returncode != 0:
        raise RunRefused("could not clone %s: %s; the incomplete attempt is kept at %s"
                         % (source_repo, (proc.stderr or "").strip()[-200:], partial))
    os.replace(scratch, path)
    shutil.rmtree(partial, ignore_errors=True)


def trusted_clone(home: str, source_repo: str, base: str = "main", remote: Optional[str] = None, token_file: Optional[str] = None) -> GitRepo:
    """A bare clone owned by the harness. Workers clone from it, and trusted code inspects worker branches in it."""
    path = os.path.join(home, "trusted-clone.git")
    if not os.path.exists(path):
        clone_bare(home, source_repo, path)
    repo = GitRepo(path, base)
    proc = git_with_token(["fetch", "--quiet", remote or source_repo, "+refs/heads/%s:refs/heads/%s" % (base, base)], path, token_file if remote else None)
    if proc.returncode != 0:
        raise RunRefused("could not update the base branch: %s" % proc.stderr.strip()[-200:])
    return repo


def cached_models(adapter: CopilotCliAdapter, home: str, candidates: List[str], force: bool = False) -> Optional[List[str]]:
    """Models the runtime accepts. Probing costs a call per model, so the result is cached for a day."""
    path = os.path.join(home, "models.json")
    if os.path.exists(path) and not force:
        with open(path) as fh:
            doc = json.load(fh)
        if time.time() - doc["checked_at"] < MODEL_CACHE_TTL_S and set(doc["candidates"]) == set(candidates):
            return doc["models"]
    probe = adapter.probe(candidates)
    if probe.get("models") is None:
        return None
    with open(path, "w") as fh:
        json.dump({"checked_at": time.time(), "candidates": candidates, "models": probe["models"]}, fh)
    return probe["models"]


def cached_probe(home: str) -> Optional[Dict[str, Any]]:
    """The last cached probe result, without calling the runtime."""
    try:
        with open(os.path.join(home, "models.json")) as fh:
            doc = json.load(fh)
    except (OSError, ValueError, KeyError):
        return None
    return {"checked_at": doc.get("checked_at"), "candidates": list(doc.get("candidates") or []), "available": list(doc.get("models") or [])}


def probe_menu(home: str, sources: List[str], repo_root: str = "", *, refresh: bool = False,
               catalog: Optional[Dict[str, Dict[str, List[str]]]] = None) -> Dict[str, Any]:
    """Probe the candidate ids of the chosen model sources and report what this runtime accepts."""
    catalog = catalog or models.load_catalog(home)
    menu = models.menu_for(sources, catalog)
    candidates = sorted({model for ids in menu.values() for model in ids})
    adapter = CopilotCliAdapter(home, repo_root or home, "main")
    available = cached_models(adapter, home, candidates, force=refresh) if candidates else []
    return {"sources": list(sources), "menu": menu, "candidates": candidates, "available": list(available or []),
            "reachable": available is not None, "reason": "" if available is not None else adapter.probe().get("reason", ""),
            "checked_at": time.time()}


def make_rehearsal(home: str) -> str:
    """A throwaway copy of the store for `--dry-run`, so a rehearsal never marks real issues Done or uses up the real plan."""
    dest = os.path.join(home, "rehearsal-%d" % int(time.time()))
    os.makedirs(dest, mode=0o700)
    src, dst = sqlite3.connect(os.path.join(home, "harness.sqlite")), sqlite3.connect(os.path.join(dest, "harness.sqlite"))
    try:
        src.backup(dst)
    finally:
        src.close()
        dst.close()
    os.chmod(os.path.join(dest, "harness.sqlite"), 0o600)
    for name in ("approval.key", "isolation.json", "models.json", "copilot.token"):
        if os.path.exists(os.path.join(home, name)):
            shutil.copyfile(os.path.join(home, name), os.path.join(dest, name))
            os.chmod(os.path.join(dest, name), 0o600)
    return dest


def ensure_run_branch(clone_path: str, remote: str, base: str, run: str, token_file: Optional[str]) -> None:
    """Create the run branch at the current base head if it is missing. An existing one resumes where it stopped.

    The run branch only accepts changes through a pull request, so it cannot be fast-forwarded here when the base moved.
    The promotion merges the base in through such a pull request instead (`GitHubPublisher.sync_run_branch`).
    """
    known = git_with_token(["ls-remote", "--heads", remote, "refs/heads/" + run], clone_path, token_file)
    if known.returncode != 0:
        raise RunRefused("could not inspect the run branch %s: %s" % (run, known.stderr.strip()[-200:]))
    if known.stdout.strip():
        return
    head = GitRepo(clone_path, base).base_head()
    created = git_with_token(["push", "--quiet", remote, "%s:refs/heads/%s" % (head, run)], clone_path, token_file)
    if created.returncode != 0:
        raise RunRefused("could not create the run branch %s: %s" % (run, created.stderr.strip()[-200:]))


def discard_run_branch(store: Store, plan_id: str, version: Optional[int], repo_root: str,
                       remote_url: Optional[str] = None) -> Dict[str, Any]:
    """Delete the protected run branch of a stopped plan, so the next run starts from the base branch again.

    Nothing else ever deletes a branch: a cancelled run keeps what it merged on its own branch, and `main` was never
    touched. This is the owner's explicit way to throw that work away.
    """
    stored = store.get_plan(plan_id, version)
    if stored is None:
        raise RunRefused("unknown plan %s" % plan_id)
    plan = stored["plan"]
    branch = plans.run_branch(plan)
    if not branch:
        raise RunRefused("plan %s has no run branch; its work lands on %s" % (plan_id, plans.base_branch(plan)))
    state = store.state("plan", approval.plan_entity(plan_id, plan["version"]))
    if state in ("Executing", "Paused"):
        raise RunRefused("a plan that is %s still owns its run branch; cancel it first" % state)
    home = store.home
    token_file = os.path.join(home, "broker.token")
    token_file = token_file if os.path.isfile(token_file) else None
    remote = remote_url or repo_root
    clone = trusted_clone(home, repo_root, plans.base_branch(plan), remote_url, token_file)
    known = git_with_token(["ls-remote", "--heads", remote, "refs/heads/" + branch], clone.path, token_file)
    if known.returncode != 0:
        raise RunRefused("could not inspect the run branch %s: %s" % (branch, known.stderr.strip()[-200:]))
    if not known.stdout.strip():
        return {"plan_id": plan_id, "branch": branch, "deleted": False}
    removed = git_with_token(["push", "--quiet", remote, "--delete", branch], clone.path, token_file)
    if removed.returncode != 0:
        raise RunRefused("could not delete the run branch %s: %s" % (branch, removed.stderr.strip()[-200:]))
    return {"plan_id": plan_id, "branch": branch, "deleted": True}


def build_scheduler(store: Store, plan_id: str, version: int, repo_root: str, dry_run: bool, remote_url: Optional[str],
                    repo_slug: Optional[str], owner: str) -> Scheduler:
    home = store.home
    token = os.path.join(home, "copilot.token")
    broker_token = os.path.join(home, "broker.token")
    plan = store.get_plan(plan_id, version)["plan"]
    base = plans.base_branch(plan)
    run = "" if dry_run else plans.run_branch(plan)
    clone = trusted_clone(home, repo_root, base, None if dry_run else remote_url, None if dry_run else broker_token)
    target = base
    if run:
        ensure_run_branch(clone.path, remote_url, base, run, broker_token)
        clone = trusted_clone(home, repo_root, run, remote_url, broker_token)
        target = run
    adapter = CopilotCliAdapter(home, clone.path, target)
    probe = adapter.probe()
    if not probe["available"]:
        raise RunRefused("run refused: the Copilot CLI sandbox adapter is unavailable: %s" % probe["reason"])
    tiers = plan["policy"]["model_tiers"]
    candidates = sorted({m for v in tiers.values() for m in ([v] if isinstance(v, str) else v)})
    available = cached_models(adapter, home, candidates)
    if dry_run:
        publisher = DryRunPublisher(clone)
    else:
        client = GhCli(repo_slug, token_file=broker_token)
        protection = client.merge_protection(target)
        if not protection["safe"]:
            raise RunRefused("run refused by effective GitHub rules for %s: %s" % (target, protection["reason"]))
        publisher = GitHubPublisher(client, clone.path, remote_url, target, broker_token)
    notifier = TerminalNotifier(lambda m: print(m, file=sys.stderr, flush=True))
    if not dry_run:
        from .workrecord import GitHubNotifier
        notifier = MultiNotifier(notifier, GitHubNotifier(GhCli(repo_slug, token_file=broker_token), store, plan_id))
    return Scheduler(store, plan_id, version, adapter, clone, SandboxChecker(clone, token), publisher, available_models=available, owner=owner, notifier=notifier,
                     free_space_floor_bytes=scheduler_mod.WORK_ROOT_FREE_BYTES, mono_clock=time.monotonic)


def watch_promotion(sched: Scheduler, interval: float, max_ticks: Optional[int], emit) -> int:
    """Watch a finished run whose pull request the owner has not merged yet.

    Nothing is claimed and nothing is restarted: the plan stays Complete, and the only work is reading the pull request
    back so the harness can close its own ask. Without this, a run whose runner already exited would keep the ask open
    forever, because `start` refuses a completed plan (correctly: it must not resume work).
    """
    deadline = time.time() + PROMOTION_WATCH_S
    ticks = 0
    while sched.promotion_waiting() and time.time() < deadline:
        for event in sched.tick():
            emit(event)
        ticks += 1
        if max_ticks is not None and ticks >= max_ticks:
            return 0
        time.sleep(max(interval, PROMOTION_POLL_S))
    emit({"event": "stopped", "plan_state": sched.store.state("plan", sched.entity), "reason": "promotion settled"})
    return 0


def keep_awake() -> Optional[Any]:
    """Stop the host from idle-sleeping while a run is active, on macOS only.

    A sleeping machine freezes the runner, the workers and every lease at once: every attempt in flight is fenced on
    wake, and a model request that was waiting on the network simply never answers. `caffeinate` binds the assertion to
    this process, so it disappears with the run and nothing has to be remembered or cleaned up. A closed lid still
    sleeps; the scheduler's own sleep detection covers that case.
    """
    if sys.platform != "darwin":
        return None
    tool = shutil.which("caffeinate")
    if tool is None:
        return None
    try:
        return subprocess.Popen([tool, "-i", "-m", "-s", "-w", str(os.getpid())],
                                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except OSError:
        return None


def stop_keep_awake(process: Optional[Any]) -> None:
    if process is None:
        return
    try:
        process.terminate()
        process.wait(timeout=5)
    except Exception:  # noqa: BLE001 - the assertion dies with this process anyway
        pass


def run_loop(sched: Scheduler, interval: float, max_ticks: Optional[int], emit, max_errors: int = 3) -> int:
    """Foreground and restartable. Stopping it leaves leases to expire, and `resume` reconciles from the store.
    An unexpected error in one pass is reported and retried. Repeated errors pause the plan instead of killing the process."""
    sched.start()
    sched.reclaim_dead_workdirs()
    sched.start_heartbeat()  # leases depend on the process being alive, not on every tick being fast
    keeper = keep_awake()
    ticks = errors = 0
    watch_until = time.time() + PROMOTION_WATCH_S if sched.promotion_waiting() else None
    try:
        while True:
            try:
                for event in sched.tick():
                    emit(event)
                errors = 0
            except Exception as exc:  # noqa: BLE001 - one bad pass must not end the run
                errors += 1
                emit({"event": "tick_error", "error": "%s: %s" % (type(exc).__name__, str(exc)[:200]), "consecutive": errors})
                if errors >= max_errors:
                    sched.pause_for("repeated internal errors: %s" % str(exc)[:160])
                    emit({"event": "stopped", "plan_state": sched.store.state("plan", sched.entity), "reason": "repeated errors"})
                    return 1
            ticks += 1
            state = sched.store.state("plan", sched.entity)
            if state == "Completed" and watch_until is not None and time.time() < watch_until and sched.promotion_waiting():
                # A finished run waits for one human step. Keep reading its pull request so the ask closes itself.
                time.sleep(max(interval, PROMOTION_POLL_S))
                continue
            if state != "Executing":
                emit({"event": "stopped", "plan_state": state})
                return 0
            if max_ticks is not None and ticks >= max_ticks:
                emit({"event": "max_ticks_reached", "plan_state": state})
                return 0
            time.sleep(interval)
    except KeyboardInterrupt:
        emit({"event": "interrupted", "note": "leases expire on their own; run `resume` to reconcile and continue"})
        return 130
    finally:
        stop_keep_awake(keeper)
        sched.stop_heartbeat()
        release = getattr(sched, "release", None)
        if callable(release):
            release()


def request_cancel(store: Store, plan_id: str, version: int, drain: bool) -> str:
    """Flag the plan for cancellation. A live runner enacts it on its next pass. With no active claims it is enacted here."""
    entity = approval.plan_entity(plan_id, version)
    state = store.state("plan", entity)
    if state is None:
        raise RunRefused("unknown plan %s v%d" % (plan_id, version))
    run = store.update_run(plan_id, lambda current: current.update(cancel_requested=True, drain=drain))
    if not store.active_claims() and not run.get("checks"):
        if state in ("Approved", "Executing", "Paused", "Draft", "Proposed"):
            store.transition("plan", entity, "Cancelled", "operator", {"drain": drain})
            return "Cancelled"
    return state


def request_pause(store: Store, plan_id: str, version: int, now_flag: bool = False,
                  after_phase: Optional[str] = None) -> str:
    """Ask a running scheduler to pause: stop starting work, wait for active workers (or cancel them with now_flag), then stop.
    With no active work the plan is paused here. With after_phase on a plan that is already paused, arm the gate for the
    next resume instead. Returns the plan state, "after PHASE", or "armed after PHASE"."""
    entity = approval.plan_entity(plan_id, version)
    state = store.state("plan", entity)
    if after_phase:
        # Finish one phase, then stop by itself: the operator wants the work in flight to land as a completed phase
        # instead of an unfinished one, and nothing after it to start. The gate is one-shot, so the pause it caused
        # cleared it; arming the next one has to be possible while the plan is paused, or the first tick of `resume`
        # would start the phases that gate was meant to hold back.
        if state not in ("Executing", "Paused"):
            raise RunRefused("only a running or paused plan can be gated on a phase (plan is %s)" % state)
        # A phase the run has not reached yet has no state document, and gating one of those is the usual request.
        # The approved plan, not the store, says which phase ids exist.
        if after_phase not in [p["id"] for p in store.get_plan(plan_id, version)["plan"]["phases"]]:
            raise RunRefused("unknown phase %s in %s v%d" % (after_phase, plan_id, version))
        phase_entity = "%s/%s" % (entity, after_phase)
        if store.state("phase", phase_entity) == "Done":
            # Nothing is left for this gate to hold back. Say so: a paused plan must not be resumed by a request that
            # reads as "stop after P2" but would in fact let the whole rest of the plan run.
            if state == "Paused":
                raise RunRefused("phase %s is already Done in %s v%d, so it cannot gate the run. Name a later phase, "
                                 "or resume without a gate." % (after_phase, plan_id, version))
        else:
            store.update_run(plan_id, lambda run: run.update(pause_after_phase=after_phase))
            # Arming a gate changes nothing else: no plan or phase transition, and no work starts or stops here.
            return ("after %s" if state == "Executing" else "armed after %s") % after_phase
    if state != "Executing":
        raise RunRefused("only a running plan can be paused (plan is %s)" % state)
    run = store.update_run(plan_id, lambda current: current.update(
        pause_requested=True, pause_now=bool(now_flag), paused_reason="paused by the operator"))
    if not store.active_claims() and not run.get("checks"):
        store.transition("plan", entity, "Paused", "operator", {"reason": "paused by the operator"})

        def fulfilled(current):
            current["ended_at"] = time.time()
            current.pop("pause_requested", None)  # nothing was draining, so the request is already fulfilled
            current.pop("pause_now", None)
        store.update_run(plan_id, fulfilled)
        return "Paused"
    return state
