import json
import time

import pytest

from harness import watch
from harness.store import Store


def event(ts, kind, issue="", **data):
    return {"ts": ts, "type": kind, "issue_id": issue, "data": json.dumps(data)}


def test_a_required_check_that_never_reported_is_an_alert():
    now = 10_000.0
    events = [event(now - 600, "merge_pending", "task-a",
                    error="gh: Repository rule violations found\n\n2 of 2 required status checks are expected.\n")]
    found = watch.findings(now=now, plan_state="Executing", events=events,
                           issue_states={"task-a": "In Review"})
    assert [f["kind"] for f in found] == ["missing_check"]
    assert "task-a" in found[0]["message"]
    assert "never reported" in found[0]["message"]


def test_a_recent_merge_pending_is_not_yet_an_alert():
    now = 10_000.0
    events = [event(now - 60, "merge_pending", "task-a",
                    error="Required status check \"test-ffm\" is in progress.\n")]
    assert watch.findings(now=now, plan_state="Executing", events=events,
                          issue_states={"task-a": "In Review"}) == []


def test_an_issue_left_in_review_without_events_is_an_alert():
    now = 10_000.0
    events = [event(now - 11 * 60, "review", "task-b", verdict="approve")]
    found = watch.findings(now=now, plan_state="Executing", events=events,
                           issue_states={"task-b": "In Review"})
    assert [f["kind"] for f in found] == ["stalled"]
    assert "11 min" in found[0]["message"]


def test_repeated_abandoned_checks_are_an_alert():
    now = 10_000.0
    events = [event(now - 120, "checks_abandoned", "phase-P1"),
              event(now - 60, "checks_abandoned", "phase-P1")]
    found = watch.findings(now=now, plan_state="Executing", events=events, issue_states={})
    assert [f["kind"] for f in found] == ["abandoned_checks"]


@pytest.mark.parametrize("state", ["Paused", "Completed", "Cancelled", "Proposed"])
def test_a_plan_that_is_not_executing_reports_nothing(state):
    events = [event(0, "merge_pending", "task-a", error="checks are expected")]
    assert watch.findings(now=10_000.0, plan_state=state, events=events,
                          issue_states={"task-a": "In Review"}) == []


def test_github_probe_reports_failing_checks_only_for_open_pull_requests():
    def run(args):
        number = args[2]
        if number == "1":
            return json.dumps({"state": "OPEN", "statusCheckRollup": [
                {"name": "test-ffm", "conclusion": "SUCCESS"},
                {"name": "ffm-native", "conclusion": "FAILURE"}]})
        return json.dumps({"state": "OPEN", "statusCheckRollup": [{"name": "test", "conclusion": "SUCCESS"}]})

    found = watch.github_findings(repo="o/r", pr_numbers={"a": 1, "b": 2}, run=run)
    assert [f["kind"] for f in found] == ["failed_workflow"]
    assert "ffm-native" in found[0]["message"]


def test_github_probe_ignores_merged_pull_requests():
    def run(args):
        return json.dumps({"state": "MERGED", "statusCheckRollup": [{"name": "test", "conclusion": "FAILURE"}]})
    assert watch.github_findings(repo="o/r", pr_numbers={"a": 1}, run=run) == []


def test_watch_reads_the_store_and_alerts_once_the_window_is_old(tmp_path):
    home = str(tmp_path / "home")
    store = Store(home)
    store.put_plan({"plan_id": "p", "version": 1, "phases": [], "policy": {}}, "digest")
    store.cx.execute("INSERT INTO entities VALUES('plan','p@v1','Executing','')")
    store.cx.execute("INSERT INTO entities VALUES('issue','task-a','In Review','')")
    store.cx.execute("INSERT INTO events(ts,type,plan_id,phase_id,issue_id,attempt_id,run_id,data) "
                     "VALUES(?,?,?,?,?,?,?,?)",
                     (time.time() - 600, "merge_pending", "p", "", "task-a", "", "",
                      json.dumps({"error": "2 of 2 required status checks are expected."})))
    store.close()

    result = watch.watch(home, "p", once=True)
    assert result["status"] == "alert"
    assert result["findings"][0]["kind"] == "missing_check"


def test_watch_finishes_quietly_when_the_plan_is_paused(tmp_path):
    home = str(tmp_path / "home")
    store = Store(home)
    store.put_plan({"plan_id": "p", "version": 1, "phases": [], "policy": {}}, "digest")
    store.cx.execute("INSERT INTO entities VALUES('plan','p@v1','Paused','')")
    store.close()

    result = watch.watch(home, "p", once=True)
    assert result == {"status": "finished", "plan_state": "Paused", "findings": []}
    assert "supervision finished" in watch.render(result)


def test_a_healthy_window_renders_without_an_alert(tmp_path):
    home = str(tmp_path / "home")
    store = Store(home)
    store.put_plan({"plan_id": "p", "version": 1, "phases": [], "policy": {}}, "digest")
    store.cx.execute("INSERT INTO entities VALUES('plan','p@v1','Executing','')")
    store.close()

    result = watch.watch(home, "p", once=True)
    assert result["status"] == "healthy"
    assert "ALERT" not in watch.render(result)
