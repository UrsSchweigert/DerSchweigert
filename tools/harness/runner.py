"""Wiring for `run`, `resume`, and `cancel`: trusted clone, adapter probe, model cache, issue import, and the foreground loop."""
from __future__ import annotations

import json
import os
import shutil
import sqlite3
import subprocess
import time
from typing import Any, Dict, List, Optional

from . import approval, plans, schemas
import sys

from .adapter import CopilotCliAdapter
from .checks import DryRunPublisher, SandboxChecker
from .github import GhCli
from .humantasks import MultiNotifier, TerminalNotifier
from .publisher import GitHubPublisher, git_with_token
from .repo import GitRepo
from .scheduler import Scheduler, new_issue
from .store import Store

MODEL_CACHE_TTL_S = 24 * 3600
ISSUE_SCHEMA = {
    "issue_id": str, "phase_id": str, "requirement_ids": [str], "title?": str, "outcomes": [str], "acceptance_criteria": [str],
    "non_goals": [str], "code_anchors": [str], "contract_paths?": [str], "deps?": [str], "validation_commands?": [str], "parallel_safe?": bool,
}


class RunRefused(Exception):
    pass


def import_issues(store: Store, plan_id: str, version: Optional[int], path: str, base_rev: str) -> List[str]:
    """Load refined issues supplied by a human or an investigator pass. They enter Ready after validation against the approved plan."""
    stored = store.get_plan(plan_id, version)
    if stored is None:
        raise RunRefused("unknown plan %s" % plan_id)
    plan = stored["plan"]
    with open(path, encoding="utf-8") as fh:
        docs = json.load(fh)
    docs = docs["issues"] if isinstance(docs, dict) else docs
    phases = {p["id"]: p for p in plan["phases"]}
    added = []
    for doc in docs:
        schemas.validate(doc, ISSUE_SCHEMA, "issue")
        phase = phases.get(doc["phase_id"])
        if phase is None or not doc["requirement_ids"] or not set(doc["requirement_ids"]) <= set(phase["requirements"]):
            raise RunRefused("issue %s must reference one approved phase and its requirement IDs" % doc["issue_id"])
        if store.get_issue(doc["issue_id"]):
            continue
        extra = {k: doc[k] for k in ("title", "outcomes", "acceptance_criteria", "non_goals", "code_anchors", "contract_paths", "deps",
                                      "validation_commands", "parallel_safe") if k in doc}
        store.put_issue(new_issue(doc["issue_id"], plan_id, doc["phase_id"], doc["requirement_ids"], base_rev=base_rev, **extra))
        for state in ("Refining", "Ready"):
            store.transition("issue", doc["issue_id"], state, "import")
        added.append(doc["issue_id"])
    return added


def trusted_clone(home: str, source_repo: str, base: str = "main", remote: Optional[str] = None, token_file: Optional[str] = None) -> GitRepo:
    """A bare clone owned by the harness. Workers clone from it, and trusted code inspects worker branches in it."""
    path = os.path.join(home, "trusted-clone.git")
    if not os.path.exists(path):
        subprocess.run(["git", "clone", "--quiet", "--bare", "--no-hardlinks", source_repo, path], check=True, capture_output=True,
                       env={"PATH": os.environ.get("PATH", ""), "GIT_CONFIG_GLOBAL": os.devnull, "HOME": home})
    repo = GitRepo(path, base)
    proc = git_with_token(["fetch", "--quiet", remote or source_repo, "+refs/heads/%s:refs/heads/%s" % (base, base)], path, token_file if remote else None)
    if proc.returncode != 0:
        raise RunRefused("could not update the base branch: %s" % proc.stderr.strip()[-200:])
    return repo


def cached_models(adapter: CopilotCliAdapter, home: str, candidates: List[str]) -> Optional[List[str]]:
    """Models the runtime accepts. Probing costs a call per model, so the result is cached for a day."""
    path = os.path.join(home, "models.json")
    if os.path.exists(path):
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


def build_scheduler(store: Store, plan_id: str, version: int, repo_root: str, dry_run: bool, remote_url: Optional[str],
                    repo_slug: Optional[str], owner: str) -> Scheduler:
    home = store.home
    token = os.path.join(home, "copilot.token")
    broker_token = os.path.join(home, "broker.token")
    clone = trusted_clone(home, repo_root, "main", None if dry_run else remote_url, None if dry_run else broker_token)
    adapter = CopilotCliAdapter(home, clone.path, "main")
    probe = adapter.probe()
    if not probe["available"]:
        raise RunRefused("run refused: the Copilot CLI sandbox adapter is unavailable: %s" % probe["reason"])
    plan = store.get_plan(plan_id, version)["plan"]
    tiers = plan["policy"]["model_tiers"]
    candidates = sorted({m for v in tiers.values() for m in ([v] if isinstance(v, str) else v)})
    available = cached_models(adapter, home, candidates)
    if dry_run:
        publisher = DryRunPublisher(clone)
    else:
        publisher = GitHubPublisher(GhCli(repo_slug, token_file=broker_token), clone.path, remote_url, "main", broker_token)
    notifier = TerminalNotifier(lambda m: print(m, file=sys.stderr, flush=True))
    if not dry_run:
        from .workrecord import GitHubNotifier
        notifier = MultiNotifier(notifier, GitHubNotifier(GhCli(repo_slug, token_file=broker_token), store, plan_id))
    return Scheduler(store, plan_id, version, adapter, clone, SandboxChecker(clone, token), publisher, available_models=available, owner=owner, notifier=notifier)


def run_loop(sched: Scheduler, interval: float, max_ticks: Optional[int], emit) -> int:
    """Foreground and restartable. Stopping it leaves leases to expire, and `resume` reconciles from the store."""
    sched.start()
    ticks = 0
    try:
        while True:
            for event in sched.tick():
                emit(event)
            ticks += 1
            state = sched.store.state("plan", sched.entity)
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


def request_cancel(store: Store, plan_id: str, version: int, drain: bool) -> str:
    """Flag the plan for cancellation. A live runner enacts it on its next pass. With no active claims it is enacted here."""
    entity = approval.plan_entity(plan_id, version)
    state = store.state("plan", entity)
    if state is None:
        raise RunRefused("unknown plan %s v%d" % (plan_id, version))
    run = store.get_run(plan_id)
    run.update(cancel_requested=True, drain=drain)
    store.put_run(plan_id, run)
    if not store.active_claims():
        if state in ("Approved", "Executing", "Paused", "Draft", "Proposed"):
            store.transition("plan", entity, "Cancelled", "operator", {"drain": drain})
            return "Cancelled"
    return state
