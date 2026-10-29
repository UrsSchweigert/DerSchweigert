"""Human tasks as dependencies: typed requests, deduplicated notifications, bounded reminders, identity-checked responses,
and automatic release of the work that waits on them. Silence never moves a task forward."""
from __future__ import annotations

import json
import os
import re
from typing import Any, Dict, Iterable, List, Optional, Sequence

from . import telemetry
from .broker import BrokerRejected, assert_no_secrets
from .store import Store

KINDS = ("asset", "decision", "manual_test")
OPEN_STATES = ("Requested", "Acknowledged", "Submitted", "Validated")
TRUSTED_SOURCES = ("local", "github")
DECISION_OPTIONS = ["retry as is", "give guidance and retry", "extend retry budget and retry", "refine the scope", "cancel the issue"]
APPLY_SPLIT = "apply the proposed split"  # offered only when a validated split was proposed for the issue
OPTION_HELP = {
    "retry as is": "Run the next step again with no changes. Choose this when the cause looks like a fluke or a fault in the harness or its tools.",
    "give guidance and retry": "Retry, and pass your hint to the worker with --guidance \"...\". Choose this when you know what the worker got wrong.",
    "extend retry budget and retry": "Authorize one additional attempt in the exhausted retry class. This override is recorded and does not reset prior failures.",
    "refine the scope": "Send the issue back to be re-planned before another attempt. Choose this when the issue itself is unclear or too big.",
    "cancel the issue": "Drop this issue and every issue that depends on it, because they can no longer run. A phase left with requirements that no finished issue covers pauses the plan until you import replacements.",
    APPLY_SPLIT: "Replace this issue with the proposed issues listed above. Nothing is applied until you choose this option. The harness checks the proposal again, then cancels this issue and makes the work that depended on it wait for the new issues instead.",
    # Labels used by tasks raised before the wording was clarified.
    "supply guidance or an asset": "Retry, optionally with your hint (--guidance). The 'asset' part only matters for tasks that ask for a file.",
    "accept a different approach": "Retry, optionally with your hint (--guidance).",
}
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
    option = str(answers.get("option", "")).strip()
    if p["kind"] == "decision" and option.isdigit() and 1 <= int(option) <= len(p["options"]):
        answers = dict(answers, option=p["options"][int(option) - 1])  # a number picks the option from the list
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
                cancel_issue(store, iid, now)
                continue  # cancel_issue wrote the issues itself, so the stale copy above must not be saved over them
            if option == APPLY_SPLIT:
                issue["split_approved"] = True  # the scheduler re-checks the proposal and applies it
            else:
                issue["proposed_split"], issue["split_approved"] = None, False
                if str(answers.get("guidance", "")).strip():
                    issue["guidance"] = (issue.get("guidance", []) + [str(answers["guidance"]).strip()])[-5:]
                plan = store.get_plan(issue["plan_id"])
                budgets = plan["plan"]["policy"]["budgets"] if plan else {"repair_attempts": 0, "transient_retries": 0}
                repair_exhausted = issue.get("repair_failures", 0) > budgets["repair_attempts"] + issue.get("repair_budget_override", 0)
                transient_exhausted = issue.get("transient_failures", 0) > budgets["transient_retries"] + issue.get("transient_budget_override", 0)
                exhausted = repair_exhausted or transient_exhausted
                if option == "extend retry budget and retry":
                    if transient_exhausted:
                        issue["transient_budget_override"] = issue.get("transient_budget_override", 0) + 1
                    else:
                        issue["repair_budget_override"] = issue.get("repair_budget_override", 0) + 1
                    exhausted = False
                if exhausted:
                    issue["blocked_reason"] = "retry budget exhausted; choose the explicit budget extension to authorize another attempt"
                else:
                    issue["blocked_reason"] = ""
                if state == "Blocked" and not exhausted:
                    answered_questions(issue)
                    store.transition("issue", iid, "Refining" if option == "refine the scope" else "Ready", "coordinator",
                                     {"task": task["task_id"], "retry_budget_override": issue.get("repair_budget_override", 0) +
                                      issue.get("transient_budget_override", 0)}, now=now)
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
                    plan = store.get_plan(issue["plan_id"])
                    budgets = plan["plan"]["policy"]["budgets"] if plan else {"repair_attempts": 0}
                    limit = budgets["repair_attempts"] + issue.get("repair_budget_override", 0)
                    if issue["repair_failures"] > limit:
                        issue["blocked_reason"] = "repair budget exhausted after a failed manual test"
                        store.transition("issue", iid, "Blocked", "coordinator",
                                         {"reason": issue["blocked_reason"], "task": task["task_id"]}, now=now)
                        n = len(store.human_tasks(iid)) + 1
                        request_task(
                            store, task_id="decision-%s-%d" % (iid, n), kind="decision", issue_ids=[iid],
                            owner=p["owner"], secondary_owner=p.get("secondary_owner"), now=now,
                            why="Issue %s exhausted its repair budget after a failed manual test." % iid,
                            request="Choose whether to cancel the issue or explicitly extend the retry budget.",
                            response_format={"required": ["option"], "optional": ["guidance"]},
                            options=DECISION_OPTIONS, resolution_criteria="The decision is recorded and the issue resumes only within budget.",
                            extra={"reason": issue["blocked_reason"], "evidence": issue["last_failures"],
                                   "option_help": {o: OPTION_HELP[o] for o in DECISION_OPTIONS}}, block_issues=False)
                    else:
                        store.transition("issue", iid, "In Progress", "coordinator",
                                         {"reason": "manual test failed", "task": task["task_id"]}, now=now)
                        released.append(iid)
            else:
                released.append(iid)
        store.put_issue(issue)
    return released


def answered_questions(issue: Dict[str, Any]) -> None:
    """Drop `needs_input` failures whose question the owner has now answered.

    They stay in the journal, but they must not keep appearing as evidence on the next decision task: an
    answered question is history, not a live blocker.
    """
    issue["last_failures"] = [f for f in issue.get("last_failures", []) if f.get("kind") != "needs_input"]


def cancel_issue(store: Store, issue_id: str, now: float, reason: str = "cancelled by the owner") -> List[str]:
    """Cancel an issue and, transitively, the open work that depends on it, because that work can no longer run. Returns the ids cancelled."""
    root = store.get_issue(issue_id)
    if root is None:
        return []
    docs = {i["issue_id"]: i for i in store.list_issues(root["plan_id"])}
    parent, queue = {issue_id: None}, [issue_id]
    while queue:
        current = queue.pop(0)
        for other, doc in docs.items():
            if current in doc["deps"] and other not in parent:
                parent[other] = current
                queue.append(other)
    cancelled = []
    for iid, source in parent.items():
        if store.state("issue", iid) not in ("Refining", "Ready", "Blocked"):
            continue  # finished work stays finished, and nothing claimed or in review can depend on an unfinished issue
        doc = store.get_issue(iid)
        doc.update(cancelled=True, consult_pending=False, analysis_pending=False, proposed_split=None, split_approved=False,
                   blocked_reason=reason if source is None else "depends on cancelled issue %s" % source)
        store.transition("issue", iid, "Cancelled", "coordinator", {"reason": doc["blocked_reason"]}, now=now)
        store.put_issue(doc)
        cancelled.append(iid)
    cancel_for_issues(store, cancelled, now)
    telemetry.emit(store, "issue_cancelled", issue_id=issue_id, data={"cancelled": cancelled}, now=now)
    return cancelled


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


def render_task(task: Dict[str, Any]) -> str:
    """A task a human can answer without reading anything else: what happened, what each option does, and the exact command."""
    p, tid = task["payload"], task["task_id"]
    out = ["%s  [%s] %s  owner %s  issues %s" % (tid, p["kind"], task["state"], p["owner"], ", ".join(p["issue_ids"])), "  Why: " + p["why"]]
    if p["kind"] == "decision":
        out.append("  This is the harness asking you, not a request from a reviewer or a worker. It stopped by itself and needs your call.")
        extra = p.get("extra", {})
        for f in extra.get("evidence", [])[-3:]:
            out.append("  Failure: %s (%s, %s) %s" % (f.get("kind"), f.get("class"), f.get("role"), str(f.get("detail", ""))[:160]))
        analysis = extra.get("analysis")
        if analysis:
            out.append("  Strong analysis recommends %s: %s" % (analysis["recommendation"], str(analysis["root_cause"])[:400]))
            for part in analysis.get("parts", []):
                out.append("    proposed issue %s: %s (%s%s)" % (part["issue_id"], part["title"], ", ".join(part["requirement_ids"]),
                                                             "; after " + ", ".join(part["deps"]) if part.get("deps") else ""))
            if analysis.get("file"):
                out.append("  The proposed issues are in %s. They are checked but not applied." % analysis["file"])
            if analysis.get("guidance"):
                out.append("  Suggested guidance: " + str(analysis["guidance"])[:300])
            out.extend("  Needs your decision: " + str(q)[:200] for q in analysis.get("questions", []))
        out.append("  Options:")
        for n, o in enumerate(p["options"], 1):
            out.append("    %d) %s: %s" % (n, o, extra.get("option_help", {}).get(o) or OPTION_HELP.get(o, "")))
        out.append("  Answer with, for example:")
        out.append("    harness respond %s --option 1" % tid)
        out.append("    harness respond %s --option 2 --guidance \"what the worker should do differently\"" % tid)
    else:
        out += ["  Request: " + p["request"], "  Respond with: " + json.dumps(p["response_format"], sort_keys=True), "  Done when: " + p["resolution_criteria"]]
    return "\n".join(out)
