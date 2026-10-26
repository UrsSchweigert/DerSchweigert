"""Human tasks as dependencies: typed requests, deduplicated notifications, bounded reminders, identity-checked responses,
and automatic release of the work that waits on them. Silence never moves a task forward."""
from __future__ import annotations

import os
import re
from typing import Any, Dict, Iterable, List, Optional, Sequence

from . import telemetry
from .broker import BrokerRejected, assert_no_secrets
from .store import Store

KINDS = ("asset", "decision", "manual_test")
OPEN_STATES = ("Requested", "Acknowledged", "Submitted", "Validated")
TRUSTED_SOURCES = ("local", "github")
DECISION_OPTIONS = ["refine the scope", "supply guidance or an asset", "accept a different approach", "cancel the issue"]
MANUAL_FIELDS = ("build_ref", "commit", "environment", "device_or_browser", "preconditions", "test_data", "steps", "expected", "evidence_required")
MAX_ARTIFACT_BYTES = 50 * 1024 * 1024


class TaskError(Exception):
    pass


def _norm(names: Iterable[str]) -> set:
    return {n.strip().lower() for n in names if n and n.strip()}


def request_task(store: Store, *, task_id: str, kind: str, issue_ids: Sequence[str], owner: str, why: str, request: str,
                 response_format: Dict[str, Any], resolution_criteria: str, now: float, options: Sequence[str] = (),
                 deadline: Optional[float] = None, secondary_owner: Optional[str] = None, delegates: Sequence[str] = (),
                 extra: Optional[Dict[str, Any]] = None, block_issues: bool = True) -> bool:
    """Create a task once (idempotent by id). Returns False when it already exists. Dependent issues block unless they await a manual test."""
    if kind not in KINDS:
        raise TaskError("unknown task kind %r" % kind)
    if not issue_ids or not why or not request or not resolution_criteria:
        raise TaskError("a task needs affected issues, a reason, a request, and resolution criteria")
    payload = {"kind": kind, "issue_ids": list(issue_ids), "why": why, "request": request, "response_format": response_format,
               "resolution_criteria": resolution_criteria, "options": list(options), "deadline": deadline, "owner": owner,
               "secondary_owner": secondary_owner, "delegates": list(delegates), "extra": extra or {}, "round": 1,
               "requested_at": now, "history": []}
    assert_no_secrets(payload, "task")
    if not store.add_human_task(task_id, issue_ids[0], kind, owner, payload, now):
        return False
    store.ensure_entity("human_task", task_id, "coordinator", {"kind": kind, "issues": list(issue_ids)}, now)
    if block_issues:
        for iid in issue_ids:
            state = store.state("issue", iid)
            if state in ("Refining", "Ready", "In Progress"):
                store.transition("issue", iid, "Blocked", "coordinator", {"reason": "waiting for human task %s" % task_id}, now=now)
    telemetry.emit(store, "human_task_requested", issue_id=issue_ids[0], data={"task": task_id, "kind": kind, "owner": owner}, now=now)
    return True


def manual_test_extra(issue: Dict[str, Any], *, reason: str, details: Dict[str, Any], policy: Dict[str, Any]) -> Dict[str, Any]:
    """Validate a manual GUI test request against the validation policy and bind it to the issue's current head."""
    allowed = (policy.get("manual_testing") or {}).get("allowed_reasons", [])
    if reason not in allowed:
        raise TaskError("manual testing is not allowed for reason %r (policy allows %s)" % (reason, allowed))
    missing = [f for f in MANUAL_FIELDS if not details.get(f)]
    if missing:
        raise TaskError("manual test request is missing: %s" % ", ".join(missing))
    if details.get("replaces_automated"):
        raise TaskError("manual tests never replace mandatory automated checks")
    if details["commit"] != issue["head_rev"]:
        raise TaskError("the manual test must name the exact current head revision")
    return dict({k: details[k] for k in MANUAL_FIELDS}, reason=reason, tested_head=issue["head_rev"])


def request_manual_test(store: Store, issue: Dict[str, Any], *, task_id: str, owner: str, reason: str, details: Dict[str, Any],
                        policy: Dict[str, Any], now: float, **kw: Any) -> bool:
    extra = manual_test_extra(issue, reason=reason, details=details, policy=policy)
    issue["manual_tests_required"] = True
    store.put_issue(issue)
    return request_task(store, task_id=task_id, kind="manual_test", issue_ids=[issue["issue_id"]], owner=owner, now=now, block_issues=False,
                        why="Visual or device judgment is needed for %s (%s)." % (issue["issue_id"], reason),
                        request="Run the steps against build %s at commit %s and report the result." % (details["build_ref"], details["commit"]),
                        response_format={"required": ["outcome", "tester", "revision"], "outcome": ["pass", "fail", "inconclusive"]},
                        resolution_criteria="A pass at the current head releases the merge gate. A fail returns the issue for repair. Inconclusive stays open.",
                        extra=extra, **kw)


# -- identity -------------------------------------------------------------------

def authorized(task: Dict[str, Any], responder_ids: Iterable[str]) -> bool:
    p = task["payload"]
    return bool(_norm(responder_ids) & _norm([p["owner"]] + list(p.get("delegates", []))))


def acknowledge(store: Store, task_id: str, responder_ids: Iterable[str], source: str, now: float) -> None:
    task = _open_task(store, task_id)
    _check_source(task, responder_ids, source)
    if task["state"] != "Requested":
        raise TaskError("task is %s, not Requested" % task["state"])
    store.transition("human_task", task_id, "Acknowledged", "responder", {"by": sorted(_norm(responder_ids))[:3]}, now=now)


def _open_task(store: Store, task_id: str) -> Dict[str, Any]:
    task = store.get_human_task(task_id)
    if task is None:
        raise TaskError("unknown task %s" % task_id)
    if task["state"] not in ("Requested", "Acknowledged"):
        raise TaskError("task %s is %s and cannot accept a response" % (task_id, task["state"]))
    return task


def _check_source(task: Dict[str, Any], responder_ids: Iterable[str], source: str) -> None:
    ids = list(responder_ids)
    if source not in TRUSTED_SOURCES:
        raise TaskError("responses are accepted only from authenticated GitHub interactions or the trusted local command")
    if any(i.lower().endswith("[bot]") or i.lower().startswith("harness") for i in ids):
        raise TaskError("a worker or bot cannot answer a human task")
    if not authorized(task, ids):
        raise TaskError("responder is not the task owner or an authorized delegate")


# -- responses ------------------------------------------------------------------------

def _validate_content(store: Store, task: Dict[str, Any], answers: Dict[str, Any], artifacts: Sequence[str]) -> Optional[str]:
    p = task["payload"]
    fmt = p["response_format"]
    missing = [f for f in fmt.get("required", []) if answers.get(f) in (None, "", [])]
    if missing:
        return "missing required answers: %s" % ", ".join(missing)
    try:
        assert_no_secrets(answers, "answers")
    except BrokerRejected:
        return "the response contains something that looks like a credential. Send secrets through an external channel instead"
    for path in artifacts:
        if not os.path.isfile(path) or not os.access(path, os.R_OK):
            return "artifact is missing or unreadable: %s" % os.path.basename(path)
        if os.path.getsize(path) > MAX_ARTIFACT_BYTES:
            return "artifact is too large: %s" % os.path.basename(path)
    kind = p["kind"]
    if kind == "decision" and answers.get("option") not in p["options"]:
        return "option must be one of %s" % p["options"]
    if kind == "asset" and not artifacts:
        return "an asset response needs the asset file as an artifact"
    if kind == "manual_test":
        if answers.get("outcome") not in ("pass", "fail", "inconclusive"):
            return "outcome must be pass, fail, or inconclusive"
        if answers["outcome"] != "inconclusive" and len(answers.get("evidence", [])) < len(p["extra"].get("evidence_required", [])):
            return "the required evidence was not supplied"
    return None


def respond(store: Store, task_id: str, *, responder_ids: Iterable[str], source: str, answers: Dict[str, Any], now: float,
            artifacts: Sequence[str] = (), asset_handler=None) -> Dict[str, Any]:
    """Validate and apply a human response. Identity is checked before any state change, so an impostor cannot move a task."""
    task = _open_task(store, task_id)
    _check_source(task, responder_ids, source)
    p = task["payload"]
    store.transition("human_task", task_id, "Submitted", "responder", {"by": sorted(_norm(responder_ids))[:3]}, now=now)
    problem = _validate_content(store, task, answers, artifacts)
    if problem is None and p["kind"] == "asset":
        problem = asset_handler(task, answers, artifacts) if asset_handler else "asset validation is not available, so the file cannot be accepted"
    if problem is None and p["kind"] == "manual_test":
        if p["extra"].get("bind") == "asset":
            from .assets import sha256_file
            current = {iid: sha256_file(p["extra"]["asset_abspath"]) if os.path.isfile(p["extra"]["asset_abspath"]) else None for iid in p["issue_ids"]}
        else:
            current = {iid: (store.get_issue(iid) or {}).get("head_rev") for iid in p["issue_ids"]}
        if answers.get("revision") != p["extra"]["tested_head"] or any(h != p["extra"]["tested_head"] for h in current.values()):
            return _stale(store, task, current, now)
        if answers["outcome"] == "inconclusive":
            problem = "the result was inconclusive"
    if problem:
        store.transition("human_task", task_id, "Acknowledged", "coordinator", {"reason": problem}, now=now)
        _history(store, task, "returned", problem, now)
        telemetry.emit(store, "human_task_invalid", issue_id=p["issue_ids"][0], data={"task": task_id, "reason": problem}, now=now)
        return {"status": "invalid", "reason": problem}
    store.transition("human_task", task_id, "Validated", "coordinator", {"kind": p["kind"]}, now=now)
    outcome = answers.get("outcome") or answers.get("option") or "delivered"
    released = _release(store, task, outcome, answers, artifacts, now)
    store.transition("human_task", task_id, "Resolved", "coordinator", {"outcome": outcome, "released": released}, now=now)
    _history(store, task, "resolved", outcome, now)
    telemetry.emit(store, "human_task_resolved", issue_id=p["issue_ids"][0], data={"task": task_id, "outcome": outcome, "released": released}, now=now)
    return {"status": "resolved", "outcome": outcome, "released": released}


def _history(store: Store, task: Dict[str, Any], what: str, detail: str, now: float) -> None:
    payload = store.get_human_task(task["task_id"])["payload"]
    payload["history"].append({"at": now, "what": what, "detail": detail[:200]})
    store.update_human_task(task["task_id"], payload)


def _stale(store: Store, task: Dict[str, Any], current: Dict[str, Optional[str]], now: float) -> Dict[str, Any]:
    """The tested revision is no longer the current one: reopen the task for the new revision."""
    payload = store.get_human_task(task["task_id"])["payload"]
    head = next(iter(current.values()))
    payload["extra"]["tested_head"] = head
    payload["extra"]["commit"] = head
    payload["round"] += 1
    payload["requested_at"] = now
    payload["history"].append({"at": now, "what": "stale", "detail": "tested revision is not the current head"})
    store.update_human_task(task["task_id"], payload)
    store.transition("human_task", task["task_id"], "Requested", "coordinator", {"reason": "stale tested revision", "new_head": head}, now=now)
    return {"status": "stale", "reason": "the tested revision is not the current head", "new_head": head}


def _release(store: Store, task: Dict[str, Any], outcome: str, answers: Dict[str, Any], artifacts: Sequence[str], now: float) -> List[str]:
    """Release waiting work. Resumed issues return to Ready, and the scheduler picks them up without anyone polling."""
    p, released = task["payload"], []
    for iid in p["issue_ids"]:
        issue = store.get_issue(iid)
        state = store.state("issue", iid)
        if issue is None:
            continue
        if p["kind"] == "decision":
            option = answers["option"]
            if option == "cancel the issue":
                issue["cancelled"] = True
            else:
                issue["guidance"] = (issue.get("guidance", []) + [answers.get("guidance", option)])[-5:]
                issue["blocked_reason"] = ""
                issue["transient_failures"] = issue["repair_failures"] = 0
                if state == "Blocked":
                    store.transition("issue", iid, "Refining" if option == "refine the scope" else "Ready", "coordinator", {"task": task["task_id"]}, now=now)
                    released.append(iid)
        elif p["kind"] == "asset":
            issue["assets"] = issue.get("assets", []) + [os.path.basename(a) for a in artifacts]
            issue["blocked_reason"] = ""
            if state == "Blocked":
                store.transition("issue", iid, "Ready", "coordinator", {"task": task["task_id"]}, now=now)
                released.append(iid)
        elif p["kind"] == "manual_test":
            head = p["extra"]["tested_head"]
            kind = "asset_review" if p["extra"].get("bind") == "asset" else "manual"
            store.add_evidence(iid, kind, head, issue["base_rev"], outcome, {"tester": answers.get("tester"), "task": task["task_id"],
                                                                                    "evidence": answers.get("evidence", [])}, now)
            if outcome == "fail" and kind == "manual":
                store.invalidate_evidence(iid, "manual failed")
                issue["last_failures"].append({"attempt": None, "role": "human", "kind": "manual_test_failed", "class": "deterministic",
                                               "detail": str(answers.get("notes", ""))[:300]})
                issue["repair_failures"] = issue.get("repair_failures", 0) + 1
                if state == "In Review":
                    store.transition("issue", iid, "In Progress", "coordinator", {"reason": "manual test failed", "task": task["task_id"]}, now=now)
                    released.append(iid)
            else:
                released.append(iid)
        store.put_issue(issue)
    return released


def cancel_for_issues(store: Store, issue_ids: Iterable[str], now: float) -> List[str]:
    """Dependent work was cancelled or became obsolete, so its open tasks are cancelled too."""
    wanted, cancelled = set(issue_ids), []
    for t in store.human_tasks():
        if t["state"] in ("Requested", "Acknowledged", "Submitted") and wanted & set(t["payload"].get("issue_ids", [t["issue_id"]])):
            store.transition("human_task", t["task_id"], "Cancelled", "coordinator", {"reason": "dependent work cancelled or obsolete"}, now=now)
            cancelled.append(t["task_id"])
    return cancelled


# -- notifications, reminders, escalation ---------------------------------------------------

class Notifier:
    """Delivery channel. The terminal notifier prints. The GitHub notifier mentions the owner on the task's issue."""

    def send(self, recipient: str, subject: str, message: str, task: Dict[str, Any]) -> None:
        raise NotImplementedError


class MultiNotifier(Notifier):
    def __init__(self, *notifiers: Notifier):
        self.notifiers = notifiers

    def send(self, recipient, subject, message, task):
        for n in self.notifiers:
            n.send(recipient, subject, message, task)


class TerminalNotifier(Notifier):
    def __init__(self, write=print):
        self.write = write

    def send(self, recipient, subject, message, task):
        self.write("[harness] to %s: %s - %s" % (recipient, subject, message))


def notify_once(store: Store, notifier: Notifier, key: str, recipient: str, subject: str, message: str, task: Dict[str, Any], now: float) -> bool:
    """Send at most once per key, so restarts and repeated passes never duplicate a notification."""
    if store.get_doc("notified", key):
        return False
    notifier.send(recipient, subject, message, task)
    store.put_doc("notified", key, {"at": now, "to": recipient})
    return True


def summary(task: Dict[str, Any]) -> str:
    p = task["payload"]
    return "%s task %s for %s: %s" % (p["kind"], task["task_id"], ", ".join(p["issue_ids"]), p["why"])


def tick_tasks(store: Store, notifier: Notifier, now: float, budgets: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Notify on new requests, send bounded reminders, and escalate to the secondary owner. State never changes here."""
    events: List[Dict[str, Any]] = []
    for task in store.human_tasks():
        if task["state"] not in OPEN_STATES:
            continue
        p, tid = task["payload"], task["task_id"]
        rnd = p.get("round", 1)
        age = now - p.get("requested_at", task["created_at"])
        if notify_once(store, notifier, "%s:r%d:requested" % (tid, rnd), p["owner"], "action needed", summary(task), task, now):
            events.append({"event": "task_notified", "task": tid, "to": p["owner"], "round": rnd})
        due = min(int(age // budgets["human_reminder_after_s"]), budgets["human_reminders_max"])
        for k in range(1, due + 1):
            if notify_once(store, notifier, "%s:r%d:reminder:%d" % (tid, rnd, k), p["owner"], "reminder %d" % k, summary(task), task, now):
                events.append({"event": "task_reminder", "task": tid, "to": p["owner"], "number": k})
        if age >= budgets["human_escalation_after_s"] and p.get("secondary_owner"):
            if notify_once(store, notifier, "%s:r%d:escalated" % (tid, rnd), p["secondary_owner"], "escalated", summary(task) + " (no response from %s)" % p["owner"], task, now):
                events.append({"event": "task_escalated", "task": tid, "to": p["secondary_owner"]})
        if p.get("deadline") and now > p["deadline"] and notify_once(store, notifier, "%s:r%d:deadline" % (tid, rnd), p["owner"], "deadline passed", summary(task), task, now):
            events.append({"event": "task_deadline_passed", "task": tid})
    return events
