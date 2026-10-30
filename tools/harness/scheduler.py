"""Scheduler and coordinator: eligible-work selection, claims and leases, worker polling, timeouts, failure handling,
evidence binding, merge gating, and phase progression. Trusted code. Time is injected so every path is testable."""
from __future__ import annotations

import hashlib
import json
import os
import random
import re
import shlex
import time
import uuid
from typing import Any, Callable, Dict, List, Optional

from . import approval, broker, descope, failures, humantasks, models, plans, schemas, smoke, splits, telemetry, usage
from .adapter import Adapter, WorkRequest
from .checks import Checker, Publisher
from .github import BaseChanged, GitHubError
from .repo import Repo
from .store import StaleLease, Store

OPEN_TASK_STATES = ("Requested", "Acknowledged", "Submitted", "Validated")
ACTIVE_ISSUE_STATES = ("Refining", "Ready", "In Progress", "In Review")


def new_issue(issue_id: str, plan_id: str, phase_id: str, requirement_ids: List[str], **fields: Any) -> Dict[str, Any]:
    """A refined issue document. Creating issues from phases needs an investigator pass that is not automated yet."""
    issue = {
        "issue_id": issue_id, "plan_id": plan_id, "phase_id": phase_id, "requirement_ids": requirement_ids,
        "title": fields.pop("title", issue_id), "outcomes": [], "acceptance_criteria": [], "non_goals": [], "code_anchors": [],
        "contract_paths": [], "deps": [], "validation_commands": [], "working_directory": "", "parallel_safe": False, "base_rev": "", "branch": "harness/" + issue_id,
        "head_rev": "", "patch_id": "", "pr": None, "transient_failures": 0, "repair_failures": 0, "strong_attempts": 0, "merge_pending": 0,
        "not_before": 0.0, "last_failures": [], "implementer_model": None, "implementer_tier": None, "model_choices": {}, "blocked_reason": "",
        "consults": 0, "consult_pending": False, "delegator_guidance": [], "analyses": 0, "analysis_pending": False, "analysis": None,
    }
    issue.update(fields)
    return issue


TRANSIENT_GITHUB = ("rate limit", "timeout", "timed out", "502", "503", "504", "connection", "temporar", "reset by peer", "could not resolve")
# GitHub refuses a merge with 405 while a required check is still running. That is neither a conflict nor a failure, so
# the merge simply waits: no repair budget, no stronger model, no issue churn.
MERGE_PENDING = ("in progress", "queued", "waiting for status", "expected \u2014 waiting", "expected - waiting")
MERGE_PENDING_LIMIT = 40
MAX_DECISION_TEXT = 2000
HELPER_FAILURE = {"delegator": "the delegating agent gave no usable decision", "analyst": "the strong analysis gave no usable result"}
# A worker's own question is triaged before the owner sees it. Budget and policy failures are decided by trusted code.
QUESTION_KINDS = ("needs_input",)

# A human is contacted only for these. Everything else is answered by the harness: triage decides, the
# descope envelope bounds what it may give up, and the reasons are recorded.
EMERGENCY_TOPICS = ("credential", "secret", "token", "password", "production", "deploy", "licence", "license",
                    "payment", "invoice", "legal", "gdpr", "contract", "physical device")



def _publish_kind(exc: Exception) -> str:
    """A rejected push is a deterministic problem with the branch. Anything else from GitHub is treated as infrastructure."""
    text = str(exc).lower()
    if any(k in text for k in ("behind its remote", "non-fast-forward", "fast-forward", "stale info", "rejected")):
        return "push_rejected"
    return "infra"


def digest_of(packet: Dict[str, Any]) -> str:
    """Packet digest excludes the tier, so a retry must change content or tier to count as different."""
    body = {k: v for k, v in packet.items() if k != "tier"}
    return hashlib.sha256(plans.canonical(body)).hexdigest()


class Scheduler:
    def __init__(self, store: Store, plan_id: str, version: int, adapter: Adapter, repo: Repo, checker: Checker,
                 publisher: Publisher, *, clock: Callable[[], float] = time.time, rng: Callable[[], float] = random.random,
                 isolation_override: Optional[Dict[str, str]] = None, available_models: Optional[List[str]] = None,
                 runner_id: str = "runner-1", owner: str = "owner", secondary_owner: Optional[str] = None,
                 notifier: Optional[humantasks.Notifier] = None, smoke_rules: Optional[List[Dict[str, Any]]] = None):
        self.smoke_rules = smoke.load_rules() if smoke_rules is None else smoke_rules  # trusted browser checks, see smoke.json
        self.store, self.plan_id, self.version = store, plan_id, version
        self.adapter, self.repo, self.checker, self.publisher = adapter, repo, checker, publisher
        self.clock, self.rng, self.iso, self.available_models = clock, rng, isolation_override, available_models
        self.runner_id, self.owner, self.secondary_owner, self.notifier = runner_id, owner, secondary_owner, notifier
        self.handles: Dict[str, Dict[str, Any]] = {}
        self.check_runs: Dict[str, Dict[str, Any]] = {}
        self.events: List[Dict[str, Any]] = []

    # -- plan and policy ------------------------------------------------------

    @property
    def entity(self) -> str:
        return approval.plan_entity(self.plan_id, self.version)

    def _plan(self) -> Dict[str, Any]:
        return self.store.get_plan(self.plan_id, self.version)["plan"]

    def _emit(self, event: str, **data: Any) -> None:
        self.events.append(dict(event=event, **data))
        run = self.store.get_run(self.plan_id)
        telemetry.emit(self.store, event, plan_id=self.plan_id, phase_id=str(data.get("phase", "")), issue_id=str(data.get("issue", "")),
                       attempt_id=str(data.get("attempt", "")), run_id="%s@%s" % (self.runner_id, int(run.get("started_at", 0))),
                       data=data, now=self.clock())

    def start(self, now: Optional[float] = None) -> None:
        """Begin or resume execution. Requires a verified approval and an isolation tier that permits `run`."""
        now = self.clock() if now is None else now
        approval.authorize_run(self.store, self.plan_id, self.version, self.iso, allow_paused=True)
        state = self.store.state("plan", self.entity)
        if state in ("Approved", "Paused"):
            self.store.transition("plan", self.entity, "Executing", self.runner_id, {"resumed_from": state}, now=now)
        for issue in self.store.list_issues(self.plan_id):
            if issue.get("head_rev") and not self.repo.pinned(issue["issue_id"]):
                try:
                    self.repo.pin_good(issue["issue_id"], issue["head_rev"])  # heads recorded before pinning existed
                except Exception:
                    pass
        run = self.store.get_run(self.plan_id)
        run.setdefault("started_at", now)
        run.pop("paused_reason", None)
        run.pop("pause_requested", None)
        run.pop("pause_now", None)
        run["cancel_requested"] = run.get("cancel_requested", False)
        self.store.put_run(self.plan_id, run)

    # -- one scheduling pass --------------------------------------------------

    def tick(self, now: Optional[float] = None) -> List[Dict[str, Any]]:
        now = self.clock() if now is None else now
        self.events = []
        self.store.put_doc("runner", self.runner_id, {"last_tick": now, "plan": self.plan_id, "active": sorted(self.handles)})
        telemetry.prune(self.store, now)
        if self.store.state("plan", self.entity) != "Executing":
            return self.events
        run = self.store.get_run(self.plan_id)
        if run.get("cancel_requested"):
            self._cancel(now, drain=run.get("drain", False))
            if self.store.state("plan", self.entity) != "Executing":
                return self.events
        if run.get("pause_requested") and run.get("pause_now"):
            self._pause("paused by the operator", now)
            return self.events
        try:
            approval.authorize_run(self.store, self.plan_id, self.version, self.iso)
        except approval.AuthorizationError as exc:
            self._pause("authorization or isolation: %s" % exc, now)
            return self.events
        budgets = self._plan()["policy"]["budgets"]
        if now - run.get("started_at", now) > budgets["run_wall_clock_s"]:
            self._pause("run wall-clock budget exhausted", now)
            return self.events
        self._recover_checks(now)
        self._fence_expired(now)
        self._poll(now, budgets)
        self._poll_checks()
        now = max(now, self.clock())
        if run.get("cancel_requested") and run.get("drain") and self.store.state("plan", self.entity) == "Executing":
            self._cancel(now, drain=True)
        if self.store.state("plan", self.entity) != "Executing":
            return self.events
        if run.get("pause_requested"):
            # Finished workers were handled above. Pause now, or once the workers in flight are done. Nothing new starts meanwhile.
            if run.get("pause_now") or not (self.handles or self._has_checks()):
                self._pause("paused by the operator", now)
            return self.events
        self._settle_cancelled(now)
        self._apply_approved_splits(now)
        self._reconcile_blocked(now)
        if self.notifier is not None:
            for event in humantasks.tick_tasks(self.store, self.notifier, now, budgets):
                self._emit(event.pop("event"), **event)
        self._advance_phases(now)
        if not run.get("cancel_requested"):
            self._integrate_ready(now)
            self._dispatch(now)
        self._complete_plan_if_done(now)
        return self.events

    # -- lease loss and polling ----------------------------------------------

    def _fence_expired(self, now: float) -> None:
        # An attempt fenced while a replacement was being claimed keeps an empty outcome in its record. Bring the record in line.
        for meta in self.store.list_attempts():
            if not meta.get("outcome") and meta["attempt_id"] not in self.handles:
                state = self.store.state("attempt", meta["attempt_id"])
                if state in ("Fenced", "Failed", "TimedOut", "Cancelled", "Succeeded"):
                    meta.update(outcome=state, finished_at=now)
                    self.store.put_attempt(meta)
        for attempt_id in self.store.recover(now, self.runner_id):
            self._drop(attempt_id)
            meta = self.store.get_attempt(attempt_id)
            if meta and not meta.get("outcome"):
                self._record_failure(meta, "lease_lost", now, "lease expired, worker fenced", outcome="Fenced", already_final=True)

    def _poll(self, now: float, budgets: Dict[str, Any]) -> None:
        for attempt_id, h in list(self.handles.items()):
            now = max(now, self.clock())
            meta = self.store.get_attempt(attempt_id)
            try:
                self.store.heartbeat(attempt_id, h["epoch"], now, budgets["lease_s"])
            except StaleLease:
                self._drop(attempt_id)
                continue
            meta.update(last_heartbeat=now)
            self.store.put_attempt(meta)
            if h.get("checking"):
                continue
            poll = self.adapter.poll(h["handle"], now)
            if poll.state == "running":
                meta.update(last_heartbeat=now, last_activity=poll.last_activity)
                self.store.put_attempt(meta)
                if now - h["started_at"] > budgets["worker_timeout_s"]:
                    self.adapter.cancel(h["handle"])
                    self._record_failure(meta, "timeout", now, "execution timeout")
                elif now - poll.last_activity > budgets["inactivity_timeout_s"]:
                    self.adapter.cancel(h["handle"])
                    self._record_failure(meta, "inactivity", now, "no activity")
                continue
            self._on_finished(meta, h, poll, now)

    def _drop(self, attempt_id: str) -> None:
        self._cancel_checks(attempt_id)
        h = self.handles.pop(attempt_id, None)
        if h:
            self.adapter.cancel(h["handle"])

    # -- required-check jobs -------------------------------------------------

    def _has_checks(self, issue_id: Optional[str] = None) -> bool:
        jobs = self.store.get_run(self.plan_id).get("checks", {}).values()
        return any(issue_id is None or job["issue_id"] == issue_id for job in jobs)

    def _forget_check(self, key: str, job_id: Optional[str]) -> None:
        if self.check_runs.get(key, {}).get("job_id") == job_id:
            self.check_runs.pop(key, None)
        run = self.store.get_run(self.plan_id)
        if run.setdefault("checks", {}).get(key, {}).get("job_id") == job_id:
            run["checks"].pop(key, None)
        self.store.put_run(self.plan_id, run)

    def _start_checks(self, key, issue_id, head, base, commands, done, attempt_id=None) -> None:
        if key in self.store.get_run(self.plan_id).get("checks", {}):
            return
        handle = self.checker.start(issue_id, head, commands)
        job_id = uuid.uuid4().hex
        self.check_runs[key] = {"handle": handle, "done": done, "attempt_id": attempt_id, "job_id": job_id}
        now = self.clock()
        run = self.store.get_run(self.plan_id)
        run.setdefault("checks", {})[key] = {
            "issue_id": issue_id, "head_rev": head, "base_rev": base, "runner": self.runner_id,
            "attempt_id": attempt_id, "job_id": job_id, "lease_until": now + self._plan()["policy"]["budgets"]["lease_s"],
            "recovery": self.checker.recovery_data(handle),
        }
        self.store.put_run(self.plan_id, run)
        self._poll_check(key)

    def _poll_check(self, key: str) -> None:
        job = self.check_runs.get(key)
        if job is None:
            return
        if not self._check_job_live(key, job):
            return
        results = self.checker.poll(job["handle"])
        now = self.clock()
        if not self._check_job_live(key, job):
            return
        if results is None:
            run = self.store.get_run(self.plan_id)
            run["checks"][key]["lease_until"] = now + self._plan()["policy"]["budgets"]["lease_s"]
            self.store.put_run(self.plan_id, run)
            return
        self._forget_check(key, job["job_id"])
        job["done"](results, now)

    def _check_job_live(self, key: str, job: Dict[str, Any]) -> bool:
        saved = self.store.get_run(self.plan_id).get("checks", {}).get(key, {})
        now = self.clock()
        if saved.get("job_id") == job["job_id"] and saved.get("lease_until", 0) > now:
            return True
        self.checker.cancel(job["handle"])
        self._forget_check(key, job["job_id"])
        if job["attempt_id"] in self.handles:
            self._record_failure(self.store.get_attempt(job["attempt_id"]), "lease_lost", now, "required-check job was fenced")
        self._emit("checks_fenced", check=key)
        return False

    def _poll_checks(self) -> None:
        for key in list(self.check_runs):
            if self.store.state("plan", self.entity) != "Executing":
                return
            self._poll_check(key)

    def _cancel_checks(self, attempt_id: Optional[str] = None) -> None:
        for key, job in list(self.check_runs.items()):
            if attempt_id is None or job["attempt_id"] == attempt_id:
                self.checker.cancel(job["handle"])
                self._forget_check(key, job["job_id"])

    def _recover_checks(self, now: float) -> None:
        for key, job in list(self.store.get_run(self.plan_id).get("checks", {}).items()):
            if key not in self.check_runs and job["lease_until"] <= now:
                self.checker.recover(job.get("recovery", {}))
                self._forget_check(key, job.get("job_id"))
                self._emit("checks_abandoned", issue=job["issue_id"], head=job["head_rev"])

    def _record_usage(self, meta: Dict[str, Any], h: Dict[str, Any], result: Any) -> None:
        """Keep the estimates for this attempt. They are advice for the owner and can never fail the attempt."""
        recorded: Dict[str, Any] = {}
        if hasattr(self.adapter, "usage") and h.get("handle") is not None:
            try:
                recorded.update(self.adapter.usage(h["handle"]) or {})
            except Exception:  # noqa: BLE001 - a missing or unreadable file only means no estimate
                pass
        agent = usage.clean_estimate(result.pop("usage_estimate", None)) if isinstance(result, dict) else None
        if agent:
            recorded["agent_estimate"] = agent
        if recorded:
            meta["usage"] = recorded
            self.store.put_attempt(meta)

    def _on_finished(self, meta: Dict[str, Any], h: Dict[str, Any], poll, now: float) -> None:
        now = max(now, self.clock())
        self._record_usage(meta, h, poll.result)
        if poll.error:
            kind = poll.error.get("kind", "runtime_crash")
            if kind == "cancelled":
                self.handles.pop(meta["attempt_id"], None)
                return
            self._record_failure(meta, kind, now, poll.error.get("detail", kind))
            return
        result = poll.result
        try:
            schemas.validate(result, schemas.WORKER_RESULT, "result")
            if result["attempt_id"] != meta["attempt_id"] or result["epoch"] != h["epoch"]:
                raise schemas.SchemaError("result does not match the attempt and epoch")
        except schemas.SchemaError as exc:
            self._record_failure(meta, "schema_invalid", now, str(exc))
            return
        handler = {"implementer": self._on_implementer, "reviewer": self._on_reviewer, "refiner": self._on_refiner,
                   "delegator": self._on_delegator, "analyst": self._on_analyst}.get(meta["role"])
        if handler is None:
            self._record_failure(meta, "schema_invalid", now, "unsupported role %s" % meta["role"])
            return
        handler(meta, h, result, now)

    # -- failure handling -----------------------------------------------------

    def _record_failure(self, meta: Dict[str, Any], kind: str, now: float, detail: str, outcome: Optional[str] = None,
                        already_final: bool = False, evidence: Optional[Dict[str, Any]] = None) -> None:
        """Classify by code, finish the attempt, update budgets, and retry, block, or pause."""
        attempt_id, issue_id = meta["attempt_id"], meta["issue_id"]
        prior_timeout = any(a["attempt_id"] != attempt_id and a.get("outcome") == "TimedOut" and a.get("packet_digest") == meta.get("packet_digest")
                            for a in self.store.list_attempts(issue_id))
        fclass = failures.classify(kind, prior_timeout)
        outcome = outcome or ("TimedOut" if kind in ("timeout", "inactivity") else "Failed")
        self._cancel_checks(attempt_id)
        h = self.handles.pop(attempt_id, None)
        if not already_final and h:
            try:
                self.store.finish(attempt_id, h["epoch"], outcome, now, {"kind": kind, "class": fclass})
            except StaleLease:
                outcome = "Fenced"
        meta.update(outcome=outcome, failure_kind=kind, failure_class=fclass, detail=detail, finished_at=now)
        self.store.put_attempt(meta)
        issue = self.store.get_issue(issue_id)
        issue["last_failures"].append({"attempt": attempt_id, "role": meta["role"], "kind": kind, "class": fclass, "detail": detail[:1500]})
        issue["last_failures"] = issue["last_failures"][-6:]
        budgets = self._plan()["policy"]["budgets"]
        failure_signature = failures.signature(kind, evidence if evidence is not None else detail)
        signatures = issue.setdefault("failure_signatures", {})
        repeated_check_failure = kind in ("checks_failed", "check_configuration") and failure_signature in signatures
        signatures[failure_signature] = signatures.get(failure_signature, 0) + 1
        issue["last_failures"][-1]["signature"] = failure_signature
        decision = {"action": "block", "reason": HELPER_FAILURE[meta["role"]]} if (
            meta["role"] in HELPER_FAILURE and fclass in (failures.DETERMINISTIC, failures.POLICY, failures.CONFIGURATION)
        ) else failures.decide(fclass, issue, budgets, now, self.rng)  # a failed helper must not spend the implementer's repair budget
        if fclass == failures.REPORTED and decision["action"] == "block" and self._schedule_analysis(issue):
            decision = {"action": "analyze"}
        if repeated_check_failure:
            decision = {"action": "block", "reason": "identical check failure repeated without changed command or inputs"}
        self._emit("attempt_failed", attempt=attempt_id, issue=issue_id, kind=kind, failure_class=fclass, action=decision["action"])
        if decision["action"] == "analyze":
            self._emit("analysis_scheduled", issue=issue_id, trigger="stuck_report")
        state = self.store.state("issue", issue_id)
        if decision["action"] == "pause":
            self._requeue(issue, state, now)
            self.store.put_issue(issue)
            self._pause("systemic failure: %s (%s)" % (kind, detail), now)
            return
        if decision["action"] == "block":
            issue["blocked_reason"] = "%s: %s" % (decision["reason"], detail[:200])
            self.store.put_issue(issue)
            self._block(issue, now)
            return
        if meta["role"] == "implementer":
            self._requeue(issue, state, now)
        self.store.put_issue(issue)

    def _requeue(self, issue: Dict[str, Any], state: str, now: float) -> None:
        if state == "In Progress":
            self.store.transition("issue", issue["issue_id"], "Ready", self.runner_id, {"reason": "attempt failed"}, now=now)

    def _block(self, issue: Dict[str, Any], now: float) -> None:
        """Block an issue and raise its decision task in the same step, so it always has an owner."""
        if issue.get("consult_pending") or issue.get("analysis_pending"):
            issue["consult_pending"] = issue["analysis_pending"] = False  # the owner decides what happens next
            self.store.put_issue(issue)
        state = self.store.state("issue", issue["issue_id"])
        if state in ("Ready", "In Progress", "In Review", "Refining"):
            self.store.transition("issue", issue["issue_id"], "Blocked", self.runner_id, {"reason": issue["blocked_reason"]}, now=now)
        self._ensure_decision_task(issue, now, "raised when the issue blocked")

    def _auto_answer(self) -> Dict[str, Any]:
        """The owner's standing instruction: answer questions here unless it is an emergency."""
        cfg = dict((self._plan().get("policy") or {}).get("auto_answer") or {})
        cfg.setdefault("enabled", False)
        cfg.setdefault("triage_all_blocks", False)
        cfg.setdefault("emergency_topics", list(EMERGENCY_TOPICS))
        return cfg

    def _is_emergency(self, issue: Dict[str, Any]) -> bool:
        topics = [str(t).lower() for t in self._auto_answer().get("emergency_topics") or []]
        text = " ".join([str(issue.get("blocked_reason") or "")] +
                        [str(f.get("detail") or "") + " " + str(f.get("kind") or "") for f in (issue.get("last_failures") or [])[-3:]]).lower()
        return any(topic in text for topic in topics)

    def _schedule_triage(self, issue: Dict[str, Any], now: float) -> bool:
        """Triage every question before the owner sees it, independent of the retry and analysis budgets.

        Bounded per distinct question, not by money: one triage for each question that would otherwise reach the
        owner, and never a second one straight after an analyst attempt. `_on_analyst` raises the task afterwards
        with the root cause and the precise questions attached.
        """
        reason = (issue.get("blocked_reason") or "")[:200]
        if not reason or issue.get("analysis_pending") or issue.get("triage_for") == reason:
            return False
        last = (issue.get("last_failures") or [])[-1:]
        if not self._auto_answer().get("triage_all_blocks"):
            if not any(f.get("kind") in QUESTION_KINDS for f in last):
                return False  # budgets and policy are decided by trusted code, not by a model
        if self._auto_answer().get("enabled") and self._is_emergency(issue):
            return False  # an emergency still goes to the owner
        attempts = self.store.list_attempts(issue["issue_id"])
        if attempts and attempts[-1]["role"] == "analyst":
            return False  # triage just answered; a second pass would only repeat it
        if self.store.state("issue", issue["issue_id"]) == "Blocked":
            self.store.transition("issue", issue["issue_id"], "Ready", self.runner_id,
                                  {"reason": "triage before the owner is asked"}, now=now)
        issue["triage_for"] = reason
        issue["analysis_pending"] = True
        self.store.put_issue(issue)
        self._emit("triage_scheduled", issue=issue["issue_id"], reason=reason)
        return True

    def _ensure_decision_task(self, issue: Dict[str, Any], now: float, why: str) -> Optional[str]:
        open_tasks = [t for t in self.store.human_tasks(issue["issue_id"]) if t["state"] in humantasks.OPEN_STATES]
        if open_tasks or self._unmet_deps(issue) or issue.get("cancelled") or issue.get("split_approved"):
            return None
        if self._schedule_triage(issue, now):
            return None
        n = len(self.store.human_tasks(issue["issue_id"])) + 1
        task_id = "decision-%s-%d" % (issue["issue_id"], n)
        attempts = [{"attempt": a["attempt_id"], "role": a["role"], "tier": a.get("tier"), "class": a.get("failure_class"), "kind": a.get("failure_kind")}
                    for a in self.store.list_attempts(issue["issue_id"])]
        options = humantasks.DECISION_OPTIONS + ([humantasks.APPLY_SPLIT] if issue.get("proposed_split") else [])
        extra = {"reason": issue.get("blocked_reason", ""), "evidence": issue["last_failures"], "attempts": attempts,
                 "option_help": {o: humantasks.OPTION_HELP[o] for o in options}}
        if issue.get("analysis"):
            extra["analysis"] = issue["analysis"]
        created = humantasks.request_task(
            self.store, task_id=task_id, kind="decision", issue_ids=[issue["issue_id"]], owner=self.owner, secondary_owner=self.secondary_owner, now=now,
            why="Issue %s is blocked: %s" % (issue["issue_id"], issue.get("blocked_reason", "")[:200]),
            request="The harness stopped working on this issue by itself and needs your call. Read the reason and the failures, then pick what happens next.",
            response_format={"required": ["option"], "optional": ["guidance"]}, options=options,
            resolution_criteria="Any listed option resolves the task. The issue resumes (or stays cancelled) accordingly.",
            extra=extra, block_issues=False)
        if created:
            if issue.get("analysis"):
                issue["analysis"] = None  # a later block must not show an old analysis
                self.store.put_issue(issue)
            self._emit("decision_task", task=task_id, issue=issue["issue_id"], owner=self.owner, why=why)
            return task_id
        return None

    def _unmet_deps(self, issue: Dict[str, Any]) -> List[str]:
        return [d for d in issue["deps"] if self.store.state("issue", d) != "Done"]

    def _reconcile_blocked(self, now: float) -> None:
        """Invariant: every Blocked issue has an unmet dependency or an open human task. Repair and report violations."""
        for issue in self.store.list_issues(self.plan_id):
            if self.store.state("issue", issue["issue_id"]) == "Blocked" and not issue.get("cancelled"):
                task = self._ensure_decision_task(issue, now, "repaired: blocked issue had no owner")
                if task:
                    self._emit("invariant_repaired", issue=issue["issue_id"], task=task)

    # -- implementer, reviewer, refiner outcomes -----------------------------------

    def _phase(self, issue: Dict[str, Any]) -> Dict[str, Any]:
        return next(p for p in self._plan()["phases"] if p["id"] == issue["phase_id"])

    def _authorize_operations(self, issue, operations, now, meta=None, epoch=None) -> bool:
        try:
            approval.authorize_operations(self.store, self.plan_id, self.version, operations, self.iso,
                                          attempt_id=meta["attempt_id"] if meta else None, epoch=epoch, now=self.clock())
        except approval.AuthorizationError as exc:
            if meta:
                self._record_failure(meta, "permission", self.clock(), str(exc))
            else:
                issue["blocked_reason"] = "authorization: %s" % exc
                self.store.put_issue(issue)
                self._block(issue, now)
            return False
        return True

    def _check_commands(self, issue: Dict[str, Any], changed_paths: List[str]) -> List[str]:
        """The issue's own commands plus the trusted browser checks that apply to the files it changed. A worker cannot opt out."""
        base = issue["validation_commands"] or self._phase(issue)["validation"]
        directory = issue.get("working_directory") or self._phase(issue).get("working_directory", ".")
        return self._with_working_directory(smoke.merge(base, smoke.commands_for(changed_paths, self.smoke_rules)), directory)

    @staticmethod
    def _with_working_directory(commands: List[str], directory: str) -> List[str]:
        if directory == ".":
            return list(commands)
        return ["cd /work/%s && %s" % (shlex.quote(directory.rstrip("/")), command) for command in commands]

    def _refresh_base(self, issue, now, meta=None) -> bool:
        try:
            self.publisher.refresh_base()
        except GitHubError as exc:
            if meta:
                self._record_failure(meta, "infra", self.clock(), str(exc))
            else:
                self._pause("could not refresh the trusted base: %s" % str(exc)[:200], self.clock())
            return False
        return True

    @staticmethod
    def _failure_summary(failed: List[Dict[str, Any]], limit: int = 1200) -> str:
        """Which commands failed and, where known, why: the end of their output. This is what a repair attempt is told."""
        parts = []
        for c in failed:
            tail = str(c.get("output", "")).strip()
            parts.append("%s (exit %s)%s" % (c["command"], c["exit_code"], (": " + tail) if tail else ""))
        return "; ".join(parts)[:limit]

    @staticmethod
    def _stuck_reason(result: Dict[str, Any]) -> Optional[str]:
        """The implementer's own account that it could not finish. Either a blocked outcome or a leftover blocker counts."""
        blockers = [b.strip() for b in result["blockers"] if b.strip()]
        if result["outcome"] == "done" and not blockers:
            return None
        reason = "; ".join(blockers) if blockers else "no reason given (next action: %s)" % str(result["next_action"])[:100]
        try:
            broker.assert_no_secrets(reason, "worker report")
        except broker.BrokerRejected:
            return "the worker's report was withheld because it looked like a credential"
        return reason[:400]

    def _on_implementer(self, meta, h, result, now) -> None:
        if result["outcome"] not in ("done", "blocked", "needs_input"):
            self._record_failure(meta, "schema_invalid", now, "implementer outcome was %r" % result["outcome"][:60])
            return
        stuck = self._stuck_reason(result)
        if stuck is not None:
            self._record_failure(meta, "worker_blocked", now, stuck)
            return
        issue = self.store.get_issue(meta["issue_id"])
        policy = self._plan()["policy"]
        if not self._refresh_base(issue, now, meta):
            return
        src = self.adapter.source_path(h["handle"])
        try:
            if src and hasattr(self.repo, "fetch_branch") and not h.get("imported"):
                self.repo.fetch_branch(src, issue["branch"])
            h["imported"] = True
            head = self.repo.branch_head(issue["branch"])
        except Exception as exc:  # the worker may not have produced a branch at all
            self._record_failure(meta, "schema_invalid", now, "no usable branch: %s" % exc)
            return
        base = self.repo.base_head()
        rebased = not self.repo.is_ancestor(base, head)
        h["rebased"] = h.get("rebased", False) or rebased
        if rebased:
            rebase = self.repo.rebase(issue["branch"])
            if rebase.conflict:
                self._record_failure(meta, "merge_conflict", now, "implementation conflicts with the current base")
                return
            head = rebase.head
        paths = self.repo.branch_changed_paths(issue["branch"])  # trusted view, never the worker's claim
        cls = broker.check_changed_paths(paths, self._phase(issue)["path_allowlist"], policy["escalation_paths"])
        if cls["rejected"] or cls["out_of_scope"]:
            self._record_failure(meta, "scope_violation", now, "paths outside scope: %s" % (cls["rejected"] + cls["out_of_scope"]))
            return
        if cls["escalate"]:
            issue["escalation_touched"] = cls["escalate"]
            self.store.put_issue(issue)
            self._record_failure(meta, "escalation_path", now, "escalation paths changed: %s" % cls["escalate"])
            return
        size = self.repo.numstat_diff(issue["branch"])
        if size["added"] > policy["diff_size_cap"]:
            self._record_failure(meta, "diff_too_large", now, "diff adds %d lines (cap %d); %d lines removed" % (
                size["added"], policy["diff_size_cap"], size["removed"]))
            return
        h["checking"] = True
        self._start_checks("implementation:" + issue["issue_id"], issue["issue_id"], head, base, self._check_commands(issue, paths),
                           lambda checks, when: self._implementation_checked(meta, h, result, head, base, checks, when), meta["attempt_id"])

    def _implementation_checked(self, meta, h, result, head, base, checks, now) -> None:
        issue = self.store.get_issue(meta["issue_id"])
        if not self._refresh_base(issue, now, meta):
            return
        now = max(now, self.clock())
        if base != self.repo.base_head() or head != self.repo.branch_head(issue["branch"]):
            self._emit("checks_stale", issue=issue["issue_id"], head=head)
            self._on_implementer(meta, h, result, now)
            return
        failed = [c for c in checks if c["exit_code"] != 0]
        self.store.add_evidence(issue["issue_id"], "checks", head, base, "fail" if failed else "pass", {"results": checks}, now)
        if failed:
            kind = "check_configuration" if any(c.get("kind") == "configuration" for c in failed) else "checks_failed"
            self._record_failure(meta, kind, now, "failing: %s" % self._failure_summary(failed),
                                 evidence={"head": head, "results": failed})
            return
        run = self.store.get_run(self.plan_id)
        pr_limit = self._plan()["policy"]["budgets"].get("pull_requests_per_run")  # None means the owner set no limit
        if pr_limit is not None and run.get("prs", 0) >= pr_limit:
            self._pause("pull request budget exhausted", now)
            return
        if not self._authorize_operations(issue, ["pushes", "pull_requests"], now, meta, h["epoch"]):
            return
        try:
            if h.get("rebased") and issue.get("pr"):
                self.publisher.update_branch(issue, issue["branch"], issue["head_rev"], head)
            pr = self.publisher.open_pr(issue, issue["branch"], head)
        except (GitHubError, broker.BrokerRejected) as exc:
            # A publishing problem fails this attempt. It must never take the whole run down.
            self._record_failure(meta, _publish_kind(exc), now, "publishing the branch failed: %s" % str(exc)[:300])
            return
        now = max(now, self.clock())
        self.store.finish(meta["attempt_id"], h["epoch"], "Succeeded", now, {"revision": head})
        self.handles.pop(meta["attempt_id"], None)
        try:
            self.repo.pin_good(issue["issue_id"], head)
        except Exception:
            pass  # without a pin, a repair attempt simply starts from the base branch
        run["prs"] = run.get("prs", 0) + 1
        self.store.put_run(self.plan_id, run)
        issue.update(head_rev=head, base_rev=base, patch_id=self.repo.patch_id(issue["branch"]), pr=pr.get("number"), pr_simulated=bool(pr.get("simulated")))
        meta.update(outcome="Succeeded", finished_at=now, revision=head)
        self.store.put_attempt(meta)
        self.store.put_issue(issue)
        self.store.transition("issue", issue["issue_id"], "In Review", self.runner_id, {"head": head, "base": base, "pr": pr.get("number")}, now=now)
        self._emit("in_review", issue=issue["issue_id"], head=head)
        self._emit("pr_opened", issue=issue["issue_id"], pr=pr.get("number"), simulated=bool(pr.get("simulated")))

    def _on_reviewer(self, meta, h, result, now) -> None:
        issue = self.store.get_issue(meta["issue_id"])
        if result["revision"] != meta["reviewed_head"] or meta["reviewed_head"] != issue["head_rev"]:
            self._record_failure(meta, "schema_invalid", now, "verdict is not bound to the current head")
            return
        if result["outcome"] not in ("approve", "changes_requested"):
            self._record_failure(meta, "schema_invalid", now, "verdict must be approve or changes_requested")
            return
        self.store.finish(meta["attempt_id"], h["epoch"], "Succeeded", now, {"verdict": result["outcome"]})
        self.handles.pop(meta["attempt_id"], None)
        meta.update(outcome="Succeeded", finished_at=now)
        self.store.put_attempt(meta)
        verdict = "approve" if result["outcome"] == "approve" else "changes"
        self.store.add_evidence(issue["issue_id"], "review", issue["head_rev"], issue["base_rev"], verdict,
                                {"model": meta.get("model"), "tier": meta.get("tier"), "independent": meta.get("independent"),
                                 "findings": result["risks"][:10]}, now)
        self._emit("review", issue=issue["issue_id"], verdict=verdict)
        if verdict == "changes":
            self._issue_failure(issue, "review_findings", "; ".join(result["risks"])[:400] or "changes requested", now)

    def _on_refiner(self, meta, h, result, now) -> None:
        issue = self.store.get_issue(meta["issue_id"])
        if result["outcome"] == "needs_input":
            # A real question for the owner, with the refiner's reasons, not a failure.
            reasons = [b for b in result["blockers"] if b] or [result["next_action"]]
            self.store.finish(meta["attempt_id"], h["epoch"], "Succeeded", now, {"outcome": "needs_input"})
            self.handles.pop(meta["attempt_id"], None)
            meta.update(outcome="Succeeded", finished_at=now)
            self.store.put_attempt(meta)
            issue["last_failures"].append({"attempt": meta["attempt_id"], "role": "refiner", "kind": "needs_input", "class": "human",
                                           "detail": "; ".join(reasons)[:400]})
            issue["blocked_reason"] = "the refiner needs your input: %s" % "; ".join(reasons)[:300]
            self.store.put_issue(issue)
            self._emit("refiner_needs_input", issue=issue["issue_id"])
            self._block(issue, now)
            return
        if result["outcome"] != "ready":
            self._record_failure(meta, "schema_invalid", now, "refiner outcome was %r (blockers: %s; next: %s)" % (
                result["outcome"], "; ".join(result["blockers"])[:200], str(result["next_action"])[:120]))
            return
        self.store.finish(meta["attempt_id"], h["epoch"], "Succeeded", now, {})
        self.handles.pop(meta["attempt_id"], None)
        meta.update(outcome="Succeeded", finished_at=now)
        self.store.put_attempt(meta)
        issue["base_rev"] = self.repo.base_head()
        self.store.put_issue(issue)
        self.store.transition("issue", issue["issue_id"], "Ready", self.runner_id, {"base": issue["base_rev"]}, now=now)
        self._emit("refined", issue=issue["issue_id"])

    def _on_delegator(self, meta, h, result, now) -> None:
        """Apply the delegating agent's decision after trusted code checks it. It can steer a retry or hand the question to the owner."""
        issue = self.store.get_issue(meta["issue_id"])
        policy = self._plan()["policy"]
        decision = result.get("decision")
        try:
            if decision is None:
                raise ValueError("the result has no decision")
            if not decision["diagnosis"].strip():
                raise ValueError("the decision needs a diagnosis")
            if max(len(decision["diagnosis"]), len(decision.get("guidance", ""))) > MAX_DECISION_TEXT:
                raise ValueError("decision text is too long")
            broker.assert_no_secrets(decision, "decision")
            choice = decision.get("model_choice")
            if choice and decision["action"] != "retry":
                raise ValueError("a model choice only applies to a retry")
            if choice:
                models.resolve_choice(choice, policy["model_tiers"], self.available_models, strong_used=issue["strong_attempts"],
                                      strong_budget=policy["budgets"]["strong_attempts_per_issue"])
        except (ValueError, broker.BrokerRejected) as exc:
            self._record_failure(meta, "schema_invalid", now, "delegator decision rejected: %s" % exc)
            return
        self.store.finish(meta["attempt_id"], h["epoch"], "Succeeded", now, {"decision": decision["action"]})
        self.handles.pop(meta["attempt_id"], None)
        meta.update(outcome="Succeeded", finished_at=now, decision=decision)
        self.store.put_attempt(meta)
        issue["consult_pending"] = False
        if decision["action"] == "ask_owner":
            issue["last_failures"].append({"attempt": meta["attempt_id"], "role": "delegator", "kind": "delegator_escalation", "class": "human",
                                           "detail": decision["diagnosis"][:400]})
            issue["last_failures"] = issue["last_failures"][-6:]
            issue["blocked_reason"] = "the delegating agent asks for your decision: %s" % decision["diagnosis"][:300]
            self.store.put_issue(issue)
            if self._schedule_analysis(issue):
                self.store.put_issue(issue)
                self._emit("analysis_scheduled", issue=issue["issue_id"], trigger="delegator")
                return
            self._emit("delegator_escalated", issue=issue["issue_id"], attempt=meta["attempt_id"])
            self._block(issue, now)
            return
        if choice:
            issue["model_choices"] = dict(issue.get("model_choices") or {}, implementer=choice)  # sticky, so later retries keep the pick
        if decision.get("guidance", "").strip():
            issue["delegator_guidance"] = (issue.get("delegator_guidance", []) + [decision["guidance"].strip()])[-3:]
        self.store.put_issue(issue)
        self._emit("delegator_retry", issue=issue["issue_id"], attempt=meta["attempt_id"], model=choice["model"] if choice else None)

    def _schedule_analysis(self, issue: Dict[str, Any]) -> bool:
        """A strong analysis needs budget and a strong model that the runtime offers. Without both, the owner is asked directly."""
        policy = self._plan()["policy"]
        if issue.get("analyses", 0) >= policy["budgets"].get("analyses_per_issue", 0):
            return False
        if not models.available_in_tier("strong", policy["model_tiers"], self.available_models):
            return False
        issue["analyses"] = issue.get("analyses", 0) + 1
        issue["analysis_pending"] = True
        return True

    def _write_split(self, issue: Dict[str, Any], parts: List[Dict[str, Any]]) -> str:
        """The validated parts in the format `import-issues` reads, kept in the private store for the owner to review."""
        folder = os.path.join(self.store.home, "analyses")
        os.makedirs(folder, mode=0o700, exist_ok=True)
        path = os.path.join(folder, "%s-%d.json" % (re.sub(r"[^A-Za-z0-9_.-]", "_", issue["issue_id"]), issue["analyses"]))
        with os.fdopen(os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600), "w") as fh:
            json.dump({"issues": [dict(part, phase_id=issue["phase_id"]) for part in parts]}, fh, indent=2)
            fh.write("\n")
        return path

    def _check_part_models(self, parts: List[Dict[str, Any]]) -> None:
        policy = self._plan()["policy"]
        for p in parts:
            models.validate_choices(p.get("model_choices", {}), policy["model_tiers"], self.available_models,
                                    strong_budget=policy["budgets"]["strong_attempts_per_issue"])

    def _settle_cancelled(self, now: float) -> None:
        """A cancel recorded before Cancelled existed left the issue Blocked with a flag. Finish it and drop the work that depends on it."""
        for issue in self.store.list_issues(self.plan_id):
            if issue.get("cancelled") and self.store.state("issue", issue["issue_id"]) in ("Refining", "Ready", "Blocked"):
                humantasks.cancel_issue(self.store, issue["issue_id"], now)

    def _apply_approved_splits(self, now: float) -> None:
        for issue in self.store.list_issues(self.plan_id):
            if issue.get("split_approved") and self.store.state("issue", issue["issue_id"]) == "Blocked":
                self._apply_split(issue, now)

    def _apply_split(self, issue: Dict[str, Any], now: float) -> None:
        """The owner approved the proposal. Check it again against the current state, then replace the issue with its parts."""
        parts = issue.get("proposed_split") or []
        made_before = {p["issue_id"] for p in parts if (self.store.get_issue(p["issue_id"]) or {}).get("split_of") == issue["issue_id"]}
        known = {i["issue_id"] for i in self.store.list_issues()} - made_before  # parts from an interrupted apply are not collisions
        problems = splits.validate_split(parts, issue, self._phase(issue), known, self.repo) if parts else ["there is no proposed split"]
        try:
            self._check_part_models(parts)
        except ValueError as exc:
            problems.append(str(exc))
        if problems:
            issue.update(split_approved=False, proposed_split=None, blocked_reason="the approved split no longer validates: %s" % "; ".join(problems[:4]))
            self.store.put_issue(issue)
            self._emit("split_rejected", issue=issue["issue_id"], problems=len(problems))
            self._ensure_decision_task(issue, now, "the approved split no longer validated")
            return
        ids, base = [p["issue_id"] for p in parts], self.repo.base_head()
        for p in parts:
            if self.store.get_issue(p["issue_id"]) is None:
                fields = {k: p[k] for k in ("title", "outcomes", "acceptance_criteria", "non_goals", "code_anchors", "contract_paths", "deps",
                                            "validation_commands", "working_directory", "parallel_safe", "model_choices") if k in p}
                self.store.put_issue(new_issue(p["issue_id"], self.plan_id, issue["phase_id"], p["requirement_ids"], base_rev=base,
                                               split_of=issue["issue_id"], **fields))
        for part_id in ids:
            # put_issue and the transitions commit separately, so a crash can leave a part with no state row or in Refining.
            # Advance only forward, so a part that already started is never reset.
            state = self.store.state("issue", part_id)
            if state in (None, "Inbox"):
                self.store.transition("issue", part_id, "Refining", self.runner_id, {"split_of": issue["issue_id"]}, now=now)
                state = "Refining"
            if state == "Refining":
                self.store.transition("issue", part_id, "Ready", self.runner_id, {"split_of": issue["issue_id"]}, now=now)
        for other in self.store.list_issues(self.plan_id):
            if issue["issue_id"] in other["deps"]:
                other["deps"] = list(dict.fromkeys(d for dep in other["deps"] for d in (ids if dep == issue["issue_id"] else [dep])))
                self.store.put_issue(other)
        issue.update(superseded_by=ids, proposed_split=None, split_approved=False, cancelled=True, blocked_reason="replaced by %s" % ", ".join(ids))
        self.store.put_issue(issue)
        self.store.transition("issue", issue["issue_id"], "Cancelled", self.runner_id, {"superseded_by": ids}, now=now)
        self._emit("split_applied", issue=issue["issue_id"], parts=len(ids))

    def _on_analyst(self, meta, h, result, now) -> None:
        """Give the owner the strong analysis and any validated split. It is advice: nothing is applied or restarted."""
        issue = self.store.get_issue(meta["issue_id"])
        analysis = result.get("analysis")
        try:
            if analysis is None:
                raise ValueError("the result has no analysis")
            known = {i["issue_id"] for i in self.store.list_issues()}
            problems = splits.validate_analysis(analysis, issue, self._phase(issue), known, self.repo)
            if problems:
                raise ValueError("; ".join(problems[:4]))
            self._check_part_models(analysis.get("split", []))
        except ValueError as exc:
            self._record_failure(meta, "schema_invalid", now, "analysis rejected: %s" % exc)
            return
        parts = analysis.get("split", [])
        summary = {"recommendation": analysis["recommendation"], "root_cause": analysis["root_cause"], "guidance": analysis.get("guidance", ""),
                   "questions": analysis.get("questions", []), "file": self._write_split(issue, parts) if parts else None,
                   "parts": [{"issue_id": p["issue_id"], "title": p["title"], "requirement_ids": p["requirement_ids"], "deps": p.get("deps", [])} for p in parts]}
        self.store.finish(meta["attempt_id"], h["epoch"], "Succeeded", now, {"recommendation": analysis["recommendation"]})
        self.handles.pop(meta["attempt_id"], None)
        meta.update(outcome="Succeeded", finished_at=now, analysis=summary)
        self.store.put_attempt(meta)
        issue["analysis_pending"] = False
        issue["analysis"] = summary
        issue["proposed_split"] = parts or None
        issue["last_failures"].append({"attempt": meta["attempt_id"], "role": "analyst", "kind": "analysis", "class": "human", "detail": analysis["root_cause"][:400]})
        issue["last_failures"] = issue["last_failures"][-6:]
        issue["blocked_reason"] = "the strong analysis recommends %s: %s" % (analysis["recommendation"], analysis["root_cause"][:250])
        self.store.put_issue(issue)
        self._emit("analysis_ready", issue=issue["issue_id"], attempt=meta["attempt_id"], recommendation=analysis["recommendation"], parts=len(parts))
        if self._auto_answer().get("enabled") and not self._is_emergency(issue) and self._apply_analysis(issue, analysis, now):
            return
        self._block(issue, now)

    def _to_ready(self, issue: Dict[str, Any], reason: str, now: float) -> None:
        """The analyst usually finishes while the issue is still Ready, so only a Blocked issue needs a transition."""
        if self.store.state("issue", issue["issue_id"]) != "Ready":
            self.store.transition("issue", issue["issue_id"], "Ready", self.runner_id, {"reason": reason}, now=now)

    def _apply_analysis(self, issue: Dict[str, Any], analysis: Dict[str, Any], now: float) -> bool:
        """Act on the analysis instead of asking the owner, while the answer stays inside the approved envelope."""
        recommendation = analysis["recommendation"]
        if recommendation == "retry":
            if str(analysis.get("guidance", "")).strip():
                issue["guidance"] = (issue.get("guidance", []) + [analysis["guidance"].strip()])[-5:]
            issue["blocked_reason"] = ""
            self.store.put_issue(issue)
            self._to_ready(issue, "answered by the analysis: retry with its guidance", now)
            self._emit("answered_without_owner", issue=issue["issue_id"], action="retry")
            return True
        if recommendation == "split" and issue.get("proposed_split"):
            issue["split_approved"] = True
            issue["blocked_reason"] = ""
            self.store.put_issue(issue)
            self._to_ready(issue, "answered by the analysis: apply the proposed split", now)
            self._emit("answered_without_owner", issue=issue["issue_id"], action="split")
            return True
        if recommendation == "needs_owner":
            return self._descope_instead_of_asking(issue, analysis, now)
        return False

    def _descope_instead_of_asking(self, issue: Dict[str, Any], analysis: Dict[str, Any], now: float) -> bool:
        """The analysis says only a human can decide. Rather than ask, defer the requirement and keep going.

        The plan policy still bounds this: without an approved descope envelope nothing is deferred and the
        owner is asked after all.
        """
        try:
            for requirement in issue["requirement_ids"]:
                descope.defer(self.store, self.plan_id, requirement,
                              reason="answered without the owner: %s" % analysis["root_cause"][:400],
                              followup_issue="restore-%s" % requirement.replace(".", "-"),
                              actor=self.runner_id, version=self.version, now=now)
        except descope.DescopeError:
            return False  # outside the envelope: the owner is asked, which is the point of the envelope
        issue["blocked_reason"] = ""
        self.store.put_issue(issue)
        humantasks.cancel_issue(self.store, issue["issue_id"], now, "descoped without the owner")
        self._emit("answered_without_owner", issue=issue["issue_id"], action="defer",
                   requirements=list(issue["requirement_ids"]))
        return True

    def _issue_failure(self, issue: Dict[str, Any], kind: str, detail: str, now: float, *, invalidate_evidence: bool = True) -> None:
        """A failure found by trusted code on an issue already In Review: retire the evidence it implicates and send it back.

        A failure that says nothing about the code (GitHub refusing a merge) passes `invalidate_evidence=False`: the review
        and checks stand, the issue parks in Ready, and `_resume_in_review` takes it back to review for another merge. When
        evidence is retired the work itself is in question, so the issue returns to In Progress for a repair attempt."""
        if invalidate_evidence:
            self.store.invalidate_evidence(issue["issue_id"], kind)
        fclass = failures.classify(kind)
        issue["last_failures"].append({"attempt": None, "role": "coordinator", "kind": kind, "class": fclass, "detail": detail[:1500]})
        decision = failures.decide(fclass, issue, self._plan()["policy"]["budgets"], now, self.rng)
        self._emit("issue_failure", issue=issue["issue_id"], kind=kind, action=decision["action"],
                   evidence_kept=not invalidate_evidence)
        if decision["action"] == "block":
            issue["blocked_reason"] = "%s: %s" % (decision["reason"], detail[:200])
            self.store.put_issue(issue)
            self._block(issue, now)
            return
        self.store.put_issue(issue)
        if invalidate_evidence:
            self.store.transition("issue", issue["issue_id"], "In Progress", self.runner_id, {"reason": kind}, now=now)
        else:
            # In Review has no edge to Ready, so step through In Progress. Ready lets the resume path rebuild review from
            # the evidence that was kept instead of spending a model attempt on work that is already done.
            self.store.transition("issue", issue["issue_id"], "In Progress", self.runner_id, {"reason": kind}, now=now)
            self.store.transition("issue", issue["issue_id"], "Ready", self.runner_id, {"reason": kind, "evidence_kept": True}, now=now)

    # -- integration: drift, staleness, merge gate ------------------------------

    def _valid(self, issue_id: str, kind: str, head: str, base: Optional[str] = None) -> Optional[Dict[str, Any]]:
        for ev in reversed(self.store.evidence(issue_id, kind)):
            if ev["head_rev"] == head and (base is None or ev["base_rev"] == base):
                return ev
        return None

    def merge_gate(self, issue: Dict[str, Any]) -> List[str]:
        """Reasons the issue may not merge. Empty means every gate holds. Never trusts a worker's statement."""
        reasons: List[str] = []
        head, base = issue["head_rev"], self.repo.base_head()
        policy = self._plan()["policy"]
        try:
            approval.authorize_operations(self.store, self.plan_id, self.version, ["eligible_merges"], self.iso)
        except approval.AuthorizationError as exc:
            reasons.append("authorization: %s" % exc)
        if not self.repo.is_ancestor(base, head):
            reasons.append("tested head does not contain the current base")
        checks = self._valid(issue["issue_id"], "checks", head, base)
        if checks is None:
            reasons.append("no passing checks bound to the current head on the current base")
        elif checks["verdict"] != "pass":
            reasons.append("required checks failed")
        review = self._valid(issue["issue_id"], "review", head)
        if review is None:
            reasons.append("no review bound to the current head")
        elif review["verdict"] != "approve":
            reasons.append("review did not approve")
        paths = self.repo.branch_changed_paths(issue["branch"])
        cls = broker.check_changed_paths(paths, self._phase(issue)["path_allowlist"], policy["escalation_paths"])
        if cls["rejected"] or cls["out_of_scope"]:
            reasons.append("scope drift: %s" % (cls["rejected"] + cls["out_of_scope"]))
        if cls["escalate"]:
            reasons.append("escalation path touched: %s" % cls["escalate"])
        if issue.get("manual_tests_required"):
            manual = self._valid(issue["issue_id"], "manual", head)
            if manual is None or manual["verdict"] != "pass":
                reasons.append("no passing manual test bound to the current head (manual tests never replace automated checks)")
        if not policy["merge_policy"].startswith("autonomous"):
            reasons.append("merge policy requires a human merge")
        client = getattr(self.publisher, "client", None)
        if client is not None:
            protection = client.merge_protection(getattr(self.publisher, "base", "main"))
            if not protection.get("safe"):
                reasons.extend("GitHub rule: " + rule for rule in protection.get("blocking_rules", [protection.get("reason", "unverified rules")]))
        return reasons

    def _integrate_ready(self, now: float) -> None:
        for issue in self.store.list_issues(self.plan_id):
            if self.store.state("plan", self.entity) != "Executing":
                return
            if (self.store.state("issue", issue["issue_id"]) != "In Review" or self.store.active_claims_for(issue["issue_id"])
                    or self._has_checks(issue["issue_id"])):
                continue
            if self._valid(issue["issue_id"], "merge", issue["head_rev"]) is not None:
                self._post_merge(issue, max(now, self.clock()))
                continue
            if self._valid(issue["issue_id"], "review", issue["head_rev"]) is None:
                continue  # waiting for a review
            self._integrate(issue, now)

    def _integrate(self, issue: Dict[str, Any], now: float) -> None:
        iid, branch = issue["issue_id"], issue["branch"]
        review = self._valid(iid, "review", issue["head_rev"])
        if review["verdict"] != "approve":
            return
        if not self._authorize_operations(issue, ["eligible_merges"], now):
            return
        if not self._refresh_base(issue, now):
            return
        base = self.repo.base_head()
        if base != issue["base_rev"] or not self.repo.is_ancestor(base, issue["head_rev"]):
            before = issue["patch_id"]
            rr = self.repo.rebase(branch)
            if rr.conflict:
                self._issue_failure(issue, "merge_conflict", "rebase onto the new base conflicts", now)
                return
            if rr.patch_id != before:
                self._issue_failure(issue, "patch_changed", "rebase changed the patch identity", now)
                return
            # Clean rebase: the review verdict carries over to the new head, but checks must be rerun on the new base.
            old_head = issue["head_rev"]
            if not self._authorize_operations(issue, ["pushes"], now):
                return
            try:
                # The pull request head must equal the commit the evidence is bound to, or GitHub refuses the merge.
                self.publisher.update_branch(issue, branch, old_head, rr.head)
            except (GitHubError, broker.BrokerRejected) as exc:
                self._emit("publish_failed", issue=iid, error=str(exc)[:200])
                return  # the local rebase is idempotent, so the next pass retries
            try:
                self.repo.pin_good(iid, rr.head)
            except Exception:
                pass
            issue.update(head_rev=rr.head, base_rev=base)
            self.store.put_issue(issue)
            self.store.add_evidence(iid, "review", rr.head, base, "approve", {"carried_from": old_head, "patch_id": rr.patch_id}, now)
        if self._valid(iid, "checks", issue["head_rev"], base) is None:
            head = issue["head_rev"]
            self._start_checks("rebase:" + iid, iid, head, base, self._check_commands(issue, self.repo.branch_changed_paths(branch)),
                               lambda checks, when: self._rebase_checked(iid, head, base, checks, when))
            return
        reasons = self.merge_gate(issue)
        if reasons:
            self._emit("merge_refused", issue=iid, reasons=reasons)
            if any(r.startswith("escalation path") for r in reasons):
                issue["blocked_reason"] = "escalation path changes need a human: %s" % reasons
                self.store.put_issue(issue)
                self._block(issue, now)
            return
        if not self._authorize_operations(issue, ["eligible_merges"], now):
            return
        try:
            merged = self.publisher.merge(issue, issue.get("pr"), issue["head_rev"])
        except BaseChanged as exc:
            self._emit("base_changed", issue=iid, reason=str(exc))
            return
        except broker.BrokerRejected as exc:
            issue["blocked_reason"] = "merge policy: %s" % str(exc)[:300]
            self.store.put_issue(issue)
            self._block(issue, now)
            return
        except GitHubError as exc:
            text = str(exc).lower()
            if any(k in text for k in MERGE_PENDING):
                issue["merge_pending"] = issue.get("merge_pending", 0) + 1
                if issue["merge_pending"] >= MERGE_PENDING_LIMIT:
                    issue["blocked_reason"] = "required checks did not finish after %d merge attempts: %s" % (
                        issue["merge_pending"], str(exc)[:200])
                    self.store.put_issue(issue)
                    self._block(issue, now)
                    return
                self.store.put_issue(issue)
                self._emit("merge_pending", issue=iid, waits=issue["merge_pending"], error=str(exc)[:160])
                return
            transient = any(k in text for k in TRANSIENT_GITHUB)
            self._emit("merge_failed", issue=iid, error=str(exc)[:200], transient=transient)
            if not transient:
                # GitHub refusing a merge is about the branch, not the code: the review and checks still stand.
                self._issue_failure(issue, "merge_conflict", "GitHub refused the merge: %s" % str(exc)[:300], now,
                                    invalidate_evidence=False)
                return
            issue["merge_retries"] = issue.get("merge_retries", 0) + 1
            if issue["merge_retries"] >= 5:
                issue["blocked_reason"] = "GitHub kept failing to merge: %s" % str(exc)[:200]
                self.store.put_issue(issue)
                self._block(issue, now)
            else:
                self.store.put_issue(issue)
            return
        if not merged.get("merged"):
            return
        if issue.get("merge_pending"):
            issue["merge_pending"] = 0
            self.store.put_issue(issue)
        self.store.add_evidence(iid, "merge", issue["head_rev"], self.repo.base_head(), "merged",
                                {"mode": merged.get("mode"), "simulated": bool(merged.get("simulated"))}, now)
        self._emit("merged", issue=iid, pr=issue.get("pr"), head=issue["head_rev"][:12], simulated=bool(merged.get("simulated")))
        self._post_merge(issue, now)

    def _rebase_checked(self, issue_id, head, base, checks, now) -> None:
        issue = self.store.get_issue(issue_id)
        if head != issue["head_rev"] or base != self.repo.base_head() or head != self.repo.branch_head(issue["branch"]):
            self._emit("checks_stale", issue=issue_id, head=head)
            return
        failed = [check for check in checks if check["exit_code"] != 0]
        self.store.add_evidence(issue_id, "checks", head, base, "fail" if failed else "pass", {"results": checks, "rerun": "new base"}, now)
        if failed:
            self._issue_failure(issue, "checks_failed", "checks fail on the new base: %s" % self._failure_summary(failed), now)
            return
        self._integrate(issue, now)

    def _post_merge(self, issue: Dict[str, Any], now: float) -> None:
        """Rerun the issue's own checks on the merged base. Phase-wide checks may depend on issues that are not built yet, so they run
        only when the phase is validated. The commands are the ones that passed before the merge."""
        iid = issue["issue_id"]
        before = self._valid(iid, "checks", issue["head_rev"])
        detail = json.loads(before["detail"]) if before else {}
        commands = [r["command"] for r in detail.get("results", [])] or issue["validation_commands"] or self._phase(issue)["validation"]
        base = self.repo.base_head()
        self._start_checks("integrated:" + iid, iid, base, base, commands,
                           lambda checks, when: self._integrated_checked(iid, issue["head_rev"], base, checks, when))

    def _integrated_checked(self, iid, head, base, post, now) -> None:
        issue = self.store.get_issue(iid)
        if head != issue["head_rev"] or base != self.repo.base_head():
            self._emit("checks_stale", issue=iid, head=base)
            return
        failed = [c for c in post if c["exit_code"] != 0]
        self.store.add_evidence(iid, "integrated", head, base, "fail" if failed else "pass", {"results": post}, now)
        if failed:
            issue["blocked_reason"] = "integrated checks fail after merge: %s" % self._failure_summary(failed, 600)
            self.store.put_issue(issue)
            self._block(issue, now)
            return
        self.complete_issue(iid, now)

    def complete_issue(self, issue_id: str, now: Optional[float] = None) -> None:
        """Done requires a merge and passing integrated checks. An open PR or existing code never qualifies."""
        now = self.clock() if now is None else now
        merge = self.store.evidence(issue_id, "merge")
        integ = self.store.evidence(issue_id, "integrated")
        if not merge or not integ or integ[-1]["verdict"] != "pass":
            raise approval.AuthorizationError("issue %s is not done: no merge with passing integrated checks" % issue_id)
        self.store.transition("issue", issue_id, "Done", self.runner_id, {"merge": merge[-1]["head_rev"], "simulated": self.publisher.simulated}, now=now)
        self._emit("done", issue=issue_id, simulated=self.publisher.simulated)

    # -- dispatch -------------------------------------------------------------

    def _concurrency_ok(self, issue: Dict[str, Any]) -> bool:
        limit = self._plan()["policy"]["budgets"]["concurrent_workers"]
        running = [self.store.get_issue(a["issue_id"]) for a in map(self.store.get_attempt, self.handles)]
        if not running:
            return True
        return len(running) < limit and issue["parallel_safe"] and all(r["parallel_safe"] for r in running)

    def _ready_to_work(self, issue: Dict[str, Any], now: float) -> bool:
        phase_state = self.store.state("phase", "%s/%s" % (self.entity, issue["phase_id"]))
        return (issue["not_before"] <= now and not self._unmet_deps(issue) and phase_state in ("Active",)
            and not self.store.active_claims_for(issue["issue_id"]) and not self._has_checks(issue["issue_id"]) and self._concurrency_ok(issue))

    def _dispatch(self, now: float) -> None:
        run = self.store.get_run(self.plan_id)
        if self.store.state("plan", self.entity) != "Executing" or run.get("pause_requested") or run.get("cancel_requested"):
            return
        issues = self.store.list_issues(self.plan_id)
        for role, states in (("reviewer", ("In Review",)), ("delegator", ("Ready",)), ("analyst", ("Ready",)), ("implementer", ("Ready", "In Progress")),
                             ("refiner", ("Refining",))):
            for issue in issues:
                state = self.store.state("issue", issue["issue_id"])
                if state not in states or not self._ready_to_work(issue, now):
                    continue
                if role == "delegator" and not issue.get("consult_pending"):
                    continue
                if role == "analyst" and not issue.get("analysis_pending"):
                    continue
                if role == "implementer" and (issue.get("consult_pending") or issue.get("analysis_pending")):
                    continue  # a helper answers first
                if role == "reviewer" and self._valid(issue["issue_id"], "review", issue["head_rev"]) is not None:
                    continue
                if role == "implementer" and state == "Ready" and self._resume_in_review(issue, now):
                    continue
                if role == "implementer" and state == "Ready" and self._stale_anchors(issue, now):
                    continue
                self._launch(issue, role, now)

    def _resume_in_review(self, issue: Dict[str, Any], now: float) -> bool:
        """Idempotent recovery: work that is already done and evidenced is not redone. If the branch still sits at the head whose checks
        passed and a pull request exists, go straight back to review instead of asking a worker to implement it again."""
        if not issue.get("head_rev") or not (issue.get("pr") or issue.get("pr_simulated")):
            return False
        passed = self._valid(issue["issue_id"], "checks", issue["head_rev"])
        try:
            same_head = self.repo.branch_head(issue["branch"]) == issue["head_rev"]
        except Exception:
            # The harness clone fetches the base branch only, so the worker's branch usually is not in it. The pinned
            # harness-good ref records the head the checks passed on, and the merge is bound to that same sha.
            same_head = self.repo.pinned(issue["issue_id"]) == issue["head_rev"]
        if passed is None or passed["verdict"] != "pass" or not same_head:
            return False
        merged = self._valid(issue["issue_id"], "merge", issue["head_rev"])
        self.store.transition("issue", issue["issue_id"], "In Progress", self.runner_id, {"resumed": True}, now=now)
        self.store.transition("issue", issue["issue_id"], "In Review", self.runner_id, {"resumed": True, "head": issue["head_rev"]}, now=now)
        if merged is not None:
            # Already merged: never merge twice. Only the post-merge checks are left.
            self._emit("resumed_after_merge", issue=issue["issue_id"], head=issue["head_rev"])
            self._post_merge(issue, now)
            return True
        self._emit("resumed_review", issue=issue["issue_id"], head=issue["head_rev"])
        return True

    def _stale_anchors(self, issue: Dict[str, Any], now: float) -> bool:
        """Refinement freshness: if the base moved under a code anchor or dependency contract, refine again instead of dispatching."""
        base = self.repo.base_head()
        if not issue["base_rev"] or issue["base_rev"] == base:
            return False
        changed = self.repo.changed_paths(issue["base_rev"], base)
        watched = issue["code_anchors"] + issue["contract_paths"]
        hit = [p for p in changed if any(p == w or p.startswith(w.rstrip("/") + "/") for w in watched)]
        if not hit:
            return False
        self.store.transition("issue", issue["issue_id"], "Refining", self.runner_id, {"reason": "anchors changed", "paths": hit}, now=now)
        self._emit("refresh_needed", issue=issue["issue_id"], paths=hit)
        return True

    def _history_data(self, issue: Dict[str, Any], evidence: List[Dict[str, Any]]) -> Dict[str, Any]:
        return {
            "stuck_report": next((f["detail"] for f in reversed(issue["last_failures"]) if f["kind"] == "worker_blocked"), ""),
            "previous_failures": [f for f in evidence if f["role"] not in ("reviewer", "delegator", "analyst")][-3:],
            "attempts": [{"role": a["role"], "model": a.get("model"), "tier": a.get("tier"), "outcome": a.get("outcome"), "failure_kind": a.get("failure_kind")}
                         for a in self.store.list_attempts(issue["issue_id"])[-6:]],
        }

    def _delegator_data(self, issue: Dict[str, Any], evidence: List[Dict[str, Any]]) -> Dict[str, Any]:
        policy = self._plan()["policy"]
        return dict(self._history_data(issue, evidence), model_options=models.model_options(policy["model_tiers"], self.available_models),
                    strong_attempts_remaining=max(policy["budgets"]["strong_attempts_per_issue"] - issue["strong_attempts"], 0))

    def _analyst_data(self, issue: Dict[str, Any], evidence: List[Dict[str, Any]]) -> Dict[str, Any]:
        diagnosis = next((f["detail"] for f in reversed(issue["last_failures"]) if f["kind"] == "delegator_escalation"), "")
        return dict(self._history_data(issue, evidence), delegator_diagnosis=diagnosis,
                    model_options=models.model_options(self._plan()["policy"]["model_tiers"], self.available_models), split_rules={
            "parts": "2 to %d" % splits.MAX_PARTS, "diff_size_cap": self._plan()["policy"]["diff_size_cap"], "requirement_ids": issue["requirement_ids"],
            "original_dependencies": issue["deps"], "existing_issue_ids": sorted(i["issue_id"] for i in self.store.list_issues())})

    def _packet(self, issue: Dict[str, Any], role: str, tier: str) -> Dict[str, Any]:
        phase = self._phase(issue)
        data: Any = {}
        evidence = [f for f in issue["last_failures"] if f["class"] != failures.TRANSIENT]  # infrastructure noise is not evidence
        if role == "implementer" and [f for f in evidence if f["role"] != "reviewer"]:
            data = {"previous_failures": [f for f in evidence if f["role"] != "reviewer"][-3:]}
        own = [f for f in evidence if f["role"] == role]
        if role in ("implementer", "refiner") and issue.get("guidance"):
            data = dict(data, human_guidance=issue["guidance"])
        if role == "implementer" and issue.get("delegator_guidance"):
            data = dict(data, delegator_guidance=issue["delegator_guidance"])
        if role == "delegator":
            data = self._delegator_data(issue, evidence)
        if role == "analyst":
            data = self._analyst_data(issue, evidence)
        if role == "reviewer":
            data = {"diff": self.repo.diff_text(issue["branch"]), "checks": (self._valid(issue["issue_id"], "checks", issue["head_rev"]) or {}).get("detail")}
            if own:
                data["your_previous_verdict_was_rejected"] = own[-2:]  # a retry must differ, and this tells the reviewer why
        if role == "refiner":
            base = self.repo.base_head()
            changed = self.repo.changed_paths(issue["base_rev"], base) if issue.get("base_rev") and issue["base_rev"] != base else []
            watched = issue["code_anchors"] + issue["contract_paths"]
            data = {"changed_since_refinement": [p for p in changed if any(p == w or p.startswith(w.rstrip("/") + "/") for w in watched)][:50],
                    "anchors_that_do_not_exist_yet": [w for w in watched if not self.repo.path_exists(w)]}
            if own:
                data["your_previous_answer_was_rejected"] = own[-2:]
        return {
            "intent": (self._plan().get("intent") or "").strip(),
            "requirement_context": [{"id": rid, "title": next((r["title"] for r in self._plan()["requirements"] if r["id"] == rid), "")}
                                    for rid in issue["requirement_ids"]],
            "phase_context": {"id": phase["id"], "outcomes": phase["outcomes"], "non_goals": phase["non_goals"],
                              "exit_criteria": phase["exit_criteria"], "dependencies": phase["dependencies"]},
            "issue_id": issue["issue_id"], "phase_id": issue["phase_id"], "requirement_ids": issue["requirement_ids"], "role": role, "tier": tier,
            "outcomes": issue["outcomes"], "acceptance_criteria": issue["acceptance_criteria"], "non_goals": issue["non_goals"],
            "code_anchors": issue["code_anchors"], "dependencies": issue["deps"],
            "validation_commands": issue["validation_commands"] or phase["validation"],             "working_directory": issue.get("working_directory") or phase.get("working_directory", "."),
            "path_allowlist": phase["path_allowlist"],
            "untrusted_data": json.dumps(data, sort_keys=True),
        }

    def _launch(self, issue: Dict[str, Any], role: str, now: float) -> None:
        if role == "implementer" and not self._authorize_operations(issue, ["isolated_branches", "commits"], now):
            return
        policy = self._plan()["policy"]
        budgets = policy["budgets"]
        attempts = self.store.list_attempts(issue["issue_id"])
        last_impl = next((a for a in reversed(attempts) if a["role"] == "implementer"), None)
        touches = any(broker.is_escalation(a, policy["escalation_paths"]) for a in issue["code_anchors"])
        last_kind = (issue["last_failures"][-1]["kind"] if issue["last_failures"] else None)
        tier = models.choose_tier(role, implementer_tier=issue.get("implementer_tier"), previous_tier=(last_impl or {}).get("tier"),
                                  previous_failure_kind=last_kind, touches_escalation_path=touches,
                                  strong_used=issue["strong_attempts"], strong_budget=budgets["strong_attempts_per_issue"])
        avoid = issue.get("implementer_model") if role == "reviewer" else None
        try:
            choices = schemas.validate(issue.get("model_choices", {}), schemas.MODEL_CHOICES, "model_choices")
            broker.assert_no_secrets(choices, "model_choices")
            choice = choices.get(role)
            repair = bool(last_impl and role == "implementer" and
                          (last_kind in models.ESCALATION_EVIDENCE or last_impl.get("routing_source") == "evidence"))
            # The implementer's model can change without spending repair budget (a delegator retry), so compare against
            # the model actually in use instead of gating independence on repair_failures.
            review_conflict = bool(choice and role == "reviewer" and choice["model"] == avoid)
            if choice and not repair and not review_conflict:
                route = models.resolve_choice(choice, policy["model_tiers"], self.available_models, avoid,
                                              strong_used=issue["strong_attempts"] if role == "implementer" else 0,
                                              strong_budget=budgets["strong_attempts_per_issue"] if role == "implementer" else 1)
                routing_source = "delegator"
            else:
                route = models.resolve_model(tier, policy["model_tiers"], self.available_models, avoid)
                routing_source = "evidence" if choice else "legacy"
                if choice:
                    why = "quality failure requires repair" if repair else "the reviewer must not share the implementer's model"
                    route["note"] = "%s; original choice: %s (%s); %s" % (
                        why, choice["model"], choice["reason"], route["note"])
            if route["routing"] and route["model"] is None:
                raise ValueError("no configured model is available for this attempt")
            if role == "implementer" and route["tier"] == "strong" and issue["strong_attempts"] >= budgets["strong_attempts_per_issue"]:
                raise ValueError("strong attempt budget exhausted")
        except (ValueError, broker.BrokerRejected) as exc:
            issue["blocked_reason"] = "model selection rejected: %s" % exc
            self.store.put_issue(issue)
            self._emit("model_selection_rejected", issue=issue["issue_id"], role=role, reason=str(exc))
            self._block(issue, now)
            return
        packet = self._packet(issue, role, route["tier"])
        digest = digest_of(packet)
        dup = failures.duplicate_of_failed(attempts, digest, route["tier"])
        if dup:
            issue["blocked_reason"] = "retry would repeat failed attempt %s with an identical packet and tier" % dup
            self.store.put_issue(issue)
            self._emit("duplicate_attempt_rejected", issue=issue["issue_id"], of=dup)
            self._block(issue, now)
            return
        try:
            schemas.validate(packet, schemas.TASK_PACKET, "task_packet")
            broker.assert_no_secrets(packet, "task_packet")
        except (schemas.SchemaError, broker.BrokerRejected) as exc:
            issue["blocked_reason"] = "task packet invalid: %s" % exc
            self.store.put_issue(issue)
            self._block(issue, now)
            return
        packet["untrusted_data"] = broker.sanitize_untrusted(packet["untrusted_data"])
        if role == "reviewer":
            packet["reviewed_head"] = issue["head_rev"]  # trusted value, outside the untrusted data block
        if role == "implementer" and issue.get("head_rev") and self.repo.pinned(issue["issue_id"]) == issue["head_rev"]:
            # A repair builds on the work that already has a pull request, so its push is a fast-forward of the same branch.
            packet["resume_from"] = "harness-good/" + issue["issue_id"]
        now = max(now, self.clock())
        lease = self.store.claim(issue["issue_id"], self.runner_id, now, budgets["lease_s"])
        if role == "implementer":
            if self.store.state("issue", issue["issue_id"]) == "Ready":
                self.store.transition("issue", issue["issue_id"], "In Progress", self.runner_id, {"attempt": lease.attempt_id}, now=now)
            if route["tier"] == "strong":
                issue["strong_attempts"] += 1
            issue["implementer_model"], issue["implementer_tier"] = route["model"], route["tier"]
            self.store.put_issue(issue)
        self.store.start(lease.attempt_id, lease.epoch, now)
        meta = {"attempt_id": lease.attempt_id, "issue_id": issue["issue_id"], "role": role, "tier": route["tier"], "model": route["model"],
            "routing": route["routing"], "routing_source": routing_source, "routing_note": route["note"], "packet_digest": digest, "started_at": now, "outcome": "",
                "independent": bool(role == "reviewer" and route["model"] and route["model"] != avoid),
                "reviewed_head": issue["head_rev"] if role == "reviewer" else ""}
        self.store.put_attempt(meta)
        req = WorkRequest(lease.attempt_id, lease.epoch, issue["issue_id"], role, route["tier"], route["model"], packet, issue["branch"])
        try:
            handle = self.adapter.start(req)
        except Exception as exc:
            self.handles[lease.attempt_id] = {"handle": None, "epoch": lease.epoch, "started_at": now}
            self._record_failure(meta, "infra", now, "adapter failed to start: %s" % exc)
            return
        self.handles[lease.attempt_id] = {"handle": handle, "epoch": lease.epoch, "started_at": now}
        self._emit("dispatched", attempt=lease.attempt_id, issue=issue["issue_id"], role=role, tier=route["tier"], model=route["model"],
               routing=route["routing"], routing_source=routing_source, routing_note=route["note"])

    # -- phases and completion --------------------------------------------------

    def _advance_phases(self, now: float) -> None:
        plan = self._plan()
        issues = self.store.list_issues(self.plan_id)
        for ph in plan["phases"]:
            ent = "%s/%s" % (self.entity, ph["id"])
            state = self.store.state("phase", ent) or "Planned"
            if state == "Planned" and all(self.store.state("phase", "%s/%s" % (self.entity, d)) == "Done" for d in ph["dependencies"]):
                self.store.transition("phase", ent, "Eligible", self.runner_id, {}, now=now)
                state = "Eligible"
            mine = [i for i in issues if i["phase_id"] == ph["id"]]
            if state == "Eligible" and mine:
                self.store.transition("phase", ent, "Active", self.runner_id, {}, now=now)
                state = "Active"
            if state == "Active" and mine:
                states = [self.store.state("issue", i["issue_id"]) for i in mine]
                if all(s in ("Done", "Cancelled") for s in states):
                    covered = {r for i, s in zip(mine, states) if s == "Done" for r in i["requirement_ids"]}
                    deferred = descope.deferred_requirements(self.store, self.plan_id, self.version)
                    gaps = sorted(set(ph["requirements"]) - covered - deferred)
                    if deferred & set(ph["requirements"]):
                        self._emit("phase_deferred_requirements", phase=ph["id"],
                                   deferred=sorted(deferred & set(ph["requirements"])))
                    if gaps:
                        self._stall_phase(ph, gaps, [i["issue_id"] for i, s in zip(mine, states) if s == "Cancelled"], now)
                        return
                    self.store.transition("phase", ent, "Validating", self.runner_id, {}, now=now)
                    state = "Validating"
            if state == "Validating":
                self._validate_phase(ph, mine, ent, now)

    def _stall_phase(self, ph: Dict[str, Any], gaps: List[str], cancelled: List[str], now: float) -> None:
        """Every issue in the phase is finished or cancelled, yet requirements remain uncovered. Nothing can progress without the owner."""
        self._emit("phase_stalled", phase=ph["id"], gaps=gaps, cancelled=cancelled)
        self._pause("phase %s cannot complete: requirements %s have no finished issue%s. Import issues that cover them, then resume." % (
            ph["id"], ", ".join(gaps), " (cancelled: %s)" % ", ".join(cancelled) if cancelled else ""), now)

    def _validate_phase(self, ph: Dict[str, Any], mine: List[Dict[str, Any]], ent: str, now: float) -> None:
        covered = {r for i in mine if self.store.state("issue", i["issue_id"]) == "Done" for r in i["requirement_ids"]}
        deferred = descope.deferred_requirements(self.store, self.plan_id, self.version)
        gaps = sorted(set(ph["requirements"]) - covered - deferred)
        commands = smoke.merge(ph["validation"], smoke.commands_for_allowlist(ph["path_allowlist"], self.smoke_rules))
        if gaps:
            self._phase_checked(ph, ent, covered, gaps, [], now)
            return
        base = self.repo.base_head()
        commands = self._with_working_directory(commands, ph.get("working_directory", "."))
        self._start_checks("phase:" + ph["id"], "phase-" + ph["id"], base, base, commands,
                           lambda results, when: self._phase_checked(ph, ent, covered, [], results, when, base))

    def _phase_checked(self, ph, ent, covered, gaps, results, now, base=None) -> None:
        if base is not None and base != self.repo.base_head():
            self._emit("checks_stale", phase=ph["id"], head=base)
            return
        failed = [c["command"] for c in results if c["exit_code"] != 0]
        if gaps or failed:
            self.store.transition("phase", ent, "Active", self.runner_id, {"gaps": gaps, "failed_exit_criteria": failed}, now=now)
            self._emit("phase_gaps", phase=ph["id"], gaps=gaps, failed=failed)
            return
        self.store.transition("phase", ent, "Done", self.runner_id, {"covered": sorted(covered)}, now=now)
        self._emit("phase_done", phase=ph["id"])

    def _complete_plan_if_done(self, now: float) -> None:
        phases = self._plan()["phases"]
        if all(self.store.state("phase", "%s/%s" % (self.entity, p["id"])) == "Done" for p in phases):
            self.store.transition("plan", self.entity, "Completed", self.runner_id, {}, now=now)
            self._emit("plan_completed")
            self._open_promotion()

    def _open_promotion(self) -> None:
        """Offer the run branch to the base branch. The owner merges it; the harness never touches the base."""
        plan = self._plan()
        base = plans.base_branch(plan)
        try:
            number = self.publisher.open_promotion(
                base, "%s: finished run (%s)" % (plan["plan_id"], self.runner_id),
                "All phases of plan `%s` are Done on `%s`. Merging this pull request moves them onto `%s`."
                % (plan["plan_id"], getattr(self.publisher, "base", ""), base))
        except Exception as exc:  # noqa: BLE001 - a missing promotion must not undo a completed plan
            self._emit("promotion_failed", error="%s: %s" % (type(exc).__name__, str(exc)[:200]))
            return
        if number:
            self._emit("promotion_pr", number=number, base=base)

    # -- pause, cancel ----------------------------------------------------------

    def _release_all(self, now: float, outcome: str) -> None:
        self._cancel_checks()
        for attempt_id, h in list(self.handles.items()):
            if h["handle"] is not None:
                self.adapter.cancel(h["handle"])
            try:
                self.store.finish(attempt_id, h["epoch"], outcome, now, {"reason": outcome})
            except StaleLease:
                pass
            meta = self.store.get_attempt(attempt_id)
            if meta:
                meta.update(outcome=outcome, finished_at=now)
                self.store.put_attempt(meta)
                issue = self.store.get_issue(meta["issue_id"])
                self._requeue(issue, self.store.state("issue", issue["issue_id"]), now)
        self.handles.clear()
        self.store.recover(now, self.runner_id)  # releases claims whose lease already lapsed

    def _pause(self, reason: str, now: float) -> None:
        self._release_all(now, "Cancelled")
        if self.store.state("plan", self.entity) == "Executing":
            self.store.transition("plan", self.entity, "Paused", self.runner_id, {"reason": reason}, now=now)
        run = self.store.get_run(self.plan_id)
        run["paused_reason"] = reason
        self.store.put_run(self.plan_id, run)
        self._emit("paused", reason=reason)

    def pause_for(self, reason: str) -> None:
        self._pause(reason, self.clock())

    def request_cancel(self, drain: bool = False) -> None:
        run = self.store.get_run(self.plan_id)
        run.update(cancel_requested=True, drain=drain)
        self.store.put_run(self.plan_id, run)

    def _cancel(self, now: float, drain: bool) -> None:
        if drain and (self.handles or self._has_checks()):
            return  # stop scheduling, let active workers finish
        self._release_all(now, "Cancelled")
        humantasks.cancel_for_issues(self.store, [i["issue_id"] for i in self.store.list_issues(self.plan_id)], now)
        self.store.transition("plan", self.entity, "Cancelled", self.runner_id, {"drain": drain}, now=now)
        self._emit("cancelled", drain=drain)

    def active_attempts(self) -> List[str]:
        return sorted(self.handles)
