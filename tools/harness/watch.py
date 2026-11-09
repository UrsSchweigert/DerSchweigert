"""Read-only supervision of one running plan.

The scheduler waits rather than asks. A required status check that never reports
leaves a merge pending for up to 30 minutes, an issue can sit In Review while its
pull request is red, and a sandbox that keeps fencing its check jobs only shows as
repeated `checks_abandoned` events. None of that reaches the owner, so
`harness watch` turns the run's own records into an alert and exits.

It never writes: no store update, no GitHub mutation. The only network use is the
optional `gh pr view` probe, which catches a failing or never-created workflow
that the harness itself only sees as a missing check.
"""
from __future__ import annotations

import json
import time
from typing import Any, Callable, Dict, Iterable, List, Optional

DEFAULTS = {
    "interval_s": 60.0,
    "missing_check_minutes": 5.0,
    "stall_minutes": 10.0,
    "abandoned_window_s": 900.0,
}

def _ts(event: Dict[str, Any]) -> float:
    return float(event.get("ts") or 0.0)


def _data(event: Dict[str, Any]) -> Dict[str, Any]:
    data = event.get("data")
    if isinstance(data, dict):
        return data
    try:
        return json.loads(data or "{}")
    except (TypeError, ValueError):
        return {}


def _age(seconds: float) -> str:
    return "%d min" % round(seconds / 60.0) if seconds < 3600 else "%.1f h" % (seconds / 3600.0)


def _last_per_issue(events: Iterable[Dict[str, Any]]) -> Dict[str, Dict[str, Any]]:
    last: Dict[str, Dict[str, Any]] = {}
    for event in sorted(events, key=_ts):
        if event.get("issue_id"):
            last[event["issue_id"]] = event
    return last


def findings(*, now: float, plan_state: str, events: List[Dict[str, Any]],
             issue_states: Dict[str, str],
             missing_check_minutes: float = DEFAULTS["missing_check_minutes"],
             stall_minutes: float = DEFAULTS["stall_minutes"],
             abandoned_window_s: float = DEFAULTS["abandoned_window_s"]) -> List[Dict[str, str]]:
    """Stalls the run's own records already prove. Pure: pass events and states, get findings."""
    if plan_state != "Executing":
        return []
    out: List[Dict[str, str]] = []
    last = _last_per_issue(events)

    for issue, event in last.items():
        kind = str(event.get("type") or "")
        age = now - _ts(event)
        error = str(_data(event).get("error", ""))
        if kind == "merge_pending" and "expected" in error and age >= missing_check_minutes * 60:
            out.append({"kind": "missing_check", "subject": issue,
                        "message": "%s waited %s for a required check that never reported (%s)"
                                   % (issue, _age(age), error.splitlines()[0] if error else "expected")})
        elif issue_states.get(issue) == "In Review" and age >= stall_minutes * 60:
            # The issue says In Review and the run has not moved since; the last event may be the review that
            # finished, which is exactly the silence worth reporting.
            out.append({"kind": "stalled", "subject": issue,
                        "message": "%s is In Review with no event for %s (last: %s)"
                                   % (issue, _age(age), kind or "none")})

    abandoned = [e for e in events
                 if e.get("type") == "checks_abandoned" and now - _ts(e) <= abandoned_window_s]
    if len(abandoned) >= 2:
        out.append({"kind": "abandoned_checks",
                    "subject": ",".join(sorted({str(e.get("issue_id") or "?") for e in abandoned})),
                    "message": "%d check jobs were abandoned in the last %s; sandbox checks are being retried"
                               % (len(abandoned), _age(abandoned_window_s))})
    return out


def github_findings(*, repo: str, pr_numbers: Dict[str, int],
                    run: Callable[[List[str]], str]) -> List[Dict[str, str]]:
    """Failures only GitHub knows about: a red workflow job, or a workflow that never created its jobs."""
    out: List[Dict[str, str]] = []
    for issue, number in sorted(pr_numbers.items()):
        raw = run(["pr", "view", str(number), "--repo", repo, "--json", "number,state,statusCheckRollup"])
        try:
            pr = json.loads(raw or "{}")
        except ValueError:
            continue
        if pr.get("state") != "OPEN":
            continue
        checks = pr.get("statusCheckRollup") or []
        failed = sorted({str(c.get("name") or c.get("context") or "?") for c in checks
                         if str(c.get("conclusion") or "").upper()
                         in {"FAILURE", "TIMED_OUT", "STARTUP_FAILURE", "CANCELLED"}})
        if failed:
            out.append({"kind": "failed_workflow", "subject": issue,
                        "message": "PR #%s has failing checks: %s" % (number, ", ".join(failed))})
    return out


def watch(store_home: str, plan_id: str, *, interval_s: float = DEFAULTS["interval_s"],
          max_minutes: Optional[float] = None, once: bool = False,
          missing_check_minutes: float = DEFAULTS["missing_check_minutes"],
          stall_minutes: float = DEFAULTS["stall_minutes"],
          github: Optional[Dict[str, Any]] = None,
          clock: Callable[[], float] = time.time, sleep: Callable[[float], None] = time.sleep,
          emit: Callable[[str], None] = print) -> Dict[str, Any]:
    """Poll until the plan stops, a stall is found, or the deadline passes.

    `github`, when given, is `{"repo": "owner/name", "pr_numbers": {issue: number}, "run": callable}`.
    """
    from .approval import plan_entity
    from .store import Store

    deadline = None if max_minutes is None else clock() + max_minutes * 60
    state = "unknown"
    while True:
        store = Store(store_home, readonly=True)
        try:
            plan = store.get_plan(plan_id)
            version = plan["plan"]["version"] if plan else 1
            state = store.state("plan", plan_entity(plan_id, version)) or "unknown"
            found: List[Dict[str, str]] = []
            if state == "Executing":
                issue_states = {row["id"]: row["state"] for row in store.entity_states()
                                if row["machine"] == "issue"}
                found = findings(now=clock(), plan_state=state, events=store.events(plan_id),
                                 issue_states=issue_states,
                                 missing_check_minutes=missing_check_minutes, stall_minutes=stall_minutes)
        finally:
            store.close()
        if state != "Executing":
            return {"status": "finished", "plan_state": state, "findings": []}
        if github and github.get("pr_numbers"):
            try:
                found += github_findings(repo=github["repo"], pr_numbers=github["pr_numbers"], run=github["run"])
            except Exception as exc:  # noqa: BLE001 - a probe failure never hides the local findings
                emit("github probe unavailable: %s" % str(exc)[:200])
        if found:
            return {"status": "alert", "plan_state": state, "findings": found}
        if once or (deadline is not None and clock() >= deadline):
            return {"status": "healthy", "plan_state": state, "findings": []}
        sleep(interval_s)


def render(result: Dict[str, Any]) -> str:
    if result["status"] == "finished":
        return "plan is %s; supervision finished" % result["plan_state"]
    if result["status"] == "healthy":
        return "healthy at %s" % time.strftime("%H:%M:%S")
    return "\n".join(["ALERT"] + ["  - %s" % f["message"] for f in result["findings"]])
