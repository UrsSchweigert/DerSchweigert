import json

import pytest
import os

from harness import cli, humantasks, status, telemetry
from harness.store import Store
from harness_doubles import Env, RecordingNotifier

DAY = 86400
LONG = {"lease_s": 10**7, "run_wall_clock_s": 10**8, "worker_timeout_s": 10**7, "inactivity_timeout_s": 10**7}


def test_events_are_sanitized_and_bounded(tmp_path):
    store = Store(str(tmp_path))
    telemetry.emit(store, "probe", issue_id="i1", data={
        "note": "token ghp_" + "a" * 30 + " leaked", "bearer": "Bearer " + "x" * 40, "prompt": "full prompt text", "raw_transcript": "…",
        "diff": "big diff", "body": "issue body", "password": "hunter2", "long": "z" * 5000, "nested": {"a": {"b": {"c": 1}}},
        "items": list(range(100)), "ok": 3})
    [ev] = telemetry.recent(store)
    d = ev["data"]
    assert "[redacted]" in d["note"] and "ghp_" not in json.dumps(d) and "[redacted]" in d["bearer"]
    for forbidden in ("prompt", "raw_transcript", "diff", "body", "password"):
        assert forbidden not in d
    assert len(d["long"]) == telemetry.MAX_STRING and len(d["items"]) == telemetry.MAX_KEYS
    assert d["nested"]["a"] == {"b": "[truncated]"} or d["nested"]["a"] == "[truncated]"
    assert d["ok"] == 3 and ev["issue_id"] == "i1"


def test_events_carry_plan_phase_issue_attempt_and_run_ids(tmp_path):
    env = Env(tmp_path, budgets=LONG)
    env.start()
    env.run_until(lambda: env.store.state("phase", "fx@v1/P1") == "Done")
    dispatched = [e for e in telemetry.recent(env.store, 200) if e["type"] == "dispatched"]
    assert dispatched and all(e["plan_id"] == "fx" and e["issue_id"] == "i1" and e["attempt_id"].startswith("i1#") and e["run_id"].startswith("runner-1@") for e in dispatched)
    assert any(e["type"] == "phase_done" and e["phase_id"] == "P1" for e in telemetry.recent(env.store, 200))
    assert any(e["type"] == "done" and e["issue_id"] == "i1" for e in telemetry.recent(env.store, 200))


def test_retention_is_bounded_to_fourteen_days(tmp_path):
    store = Store(str(tmp_path))
    now = 100 * DAY
    for age in (1, 13, 14.5, 30, 90):
        telemetry.emit(store, "old", data={"age": age}, now=now - age * DAY)
    assert telemetry.prune(store, now) == 3
    assert [e["data"]["age"] for e in telemetry.recent(store)] == [1, 13]


def test_the_scheduler_prunes_as_it_runs(tmp_path):
    env = Env(tmp_path, budgets=LONG)
    telemetry.emit(env.store, "ancient", now=env.clock() - 40 * DAY)
    env.start()
    env.tick()
    assert not any(e["type"] == "ancient" for e in telemetry.recent(env.store, 500))


def test_failure_details_are_truncated_not_transcripts(tmp_path):
    env = Env(tmp_path, budgets=LONG)
    env.adapter.script("i1", "implementer", "error:infra")
    env.start()
    env.run_until(lambda: env.store.get_issue("i1")["transient_failures"] == 1)
    for e in telemetry.recent(env.store, 500):
        assert all(len(str(v)) <= telemetry.MAX_STRING for v in e["data"].values())


def test_unavailable_metrics_are_labeled_never_estimated(tmp_path):
    env = Env(tmp_path, budgets=LONG)
    env.start()
    env.tick()
    report = status.build_report(env.store.home, env.clock())
    for metric in ("tokens", "cost", "generation_credits"):
        assert report["metrics"][metric]["status"] == "unavailable" and report["metrics"][metric]["value"] is None
    assert report["usage"].startswith("unavailable") and report["budgets"]["fx"]["tokens_and_cost"] == "unavailable"
    text = status.render(report)
    assert "tokens and cost unavailable" in text and "usage: unavailable" in text


# -- status ------------------------------------------------------------------------------------------------------

def test_status_shows_progress_workers_runner_health_and_budgets(tmp_path):
    env = Env(tmp_path, issues=[("a", "P1", ["F1.1", "F1.2"]), ("b", "P2", ["F2.1"])], budgets={"run_wall_clock_s": 10_000, "worker_timeout_s": 10**6, "inactivity_timeout_s": 10**6})
    env.adapter.script("a", "implementer", "busy")
    env.start()
    env.tick(10)
    env.tick(10)
    r = status.build_report(env.store.home, env.clock())
    [worker] = r["workers"]
    assert worker["role"] == "implementer" and worker["issue"] == "a" and worker["branch"] == "harness/a" and worker["attempt_id"] == "a#1"
    assert worker["elapsed_s"] == 10 and worker["retries"] == 0 and worker["last_activity_age_s"] == 0 and worker["tier"] == "low"
    assert r["runner"]["status"] == "alive" and r["runner"]["last_heartbeat_age_s"] == 0
    assert r["budgets"]["fx"]["wall_clock_s"]["remaining"] == 10_000 - 20
    assert r["budgets"]["fx"]["pull_requests"]["limit"] is None and r["budgets"]["fx"]["pull_requests"]["remaining"] is None
    phases = {p["phase"]: p for p in r["phases"]}
    assert phases["P1"]["state"] == "Active" and phases["P2"]["state"] == "Planned" and phases["P2"]["depends_on"] == ["P1"]
    reqs = {q["id"]: q["coverage"] for q in r["requirements"]}
    assert reqs["F1.1"] == "in progress" and reqs["F2.1"] == "in progress"
    queue = {q["issue_id"]: q for q in r["queue"]}
    assert queue["b"]["state"] == "Ready"
    # The runner stops. Time passes. Status reports a stale runner and the expired lease.
    env.clock.advance(500)
    later = status.build_report(env.store.home, env.clock())
    assert later["runner"]["status"].startswith("stale") and later["expired_leases"][0]["attempt_id"] == "a#1"


def test_status_covers_evidence_blockers_failures_and_human_tasks(tmp_path):
    env = Env(tmp_path, issues=[("a", "P1", ["F1.1"]), ("bad", "P1", ["F1.2"])], budgets=LONG)
    env.adapter.impl_paths["bad"] = ["outside/x.py"]
    env.sched.notifier = RecordingNotifier()
    env.start()
    env.run_until(lambda: env.state("a") == "Done" and env.state("bad") == "Blocked")
    env.clock.advance(30 * 3600)
    env.tick(1)
    r = status.build_report(env.store.home, env.clock())
    ev = {e["issue_id"]: e for e in r["evidence"]}
    assert ev["a"]["checks"][0]["verdict"] == "pass" and ev["a"]["review"][0]["verdict"] == "approve"
    assert ev["a"]["integration"]["merged"] and ev["a"]["integration"]["integrated_checks"][0]["verdict"] == "pass"
    [blocker] = r["blockers"]
    assert blocker["issue_id"] == "bad" and blocker["owned"] and blocker["human_tasks"]
    assert r["failures"][0]["issue_id"] == "bad" and r["failures"][0]["recent"][-1]["class"] == "policy"
    [task] = r["human_tasks"]
    assert task["owner"] == "owner" and task["affected_issues"] == ["bad"] and task["age_s"] >= 30 * 3600 and task["reminders_sent"] == 1
    assert {q["id"]: q["coverage"] for q in r["requirements"]}["F1.1"] == "implemented, phase not validated"


def test_status_is_read_only_and_serializes(tmp_path, capsys):
    env = Env(tmp_path, budgets=LONG)
    env.start()
    env.tick()
    before = (env.store.journal(500), telemetry.count(env.store), env.store.sync_ops())
    assert cli.main(["--home", env.store.home, "status", "--json"]) == 0
    data = json.loads(capsys.readouterr().out)
    assert data["plans"][0]["state"] == "Executing" and data["runner"]["status"] in ("alive", "stale: no scheduling pass recently")
    assert cli.main(["--home", env.store.home, "status"]) == 0
    assert "plan fx v1" in capsys.readouterr().out
    after = Store(env.store.home)
    assert (after.journal(500), telemetry.count(after), after.sync_ops()) == before


def test_status_marks_requirements_verified_when_the_phase_is_done(tmp_path):
    env = Env(tmp_path, issues=[("a", "P1", ["F1.1", "F1.2"]), ("b", "P2", ["F2.1"])], budgets=LONG)
    env.start()
    env.run_until(lambda: env.store.state("plan", "fx@v1") == "Completed")
    r = status.build_report(env.store.home, env.clock())
    assert {q["coverage"] for q in r["requirements"]} == {"verified"} and r["plans"][0]["state"] == "Completed"


# -- one issue in detail ---------------------------------------------------------------------------------------------

def test_issue_detail_shows_scope_attempts_evidence_and_history(tmp_path, capsys):
    env = Env(tmp_path, budgets=LONG)
    env.checker.fail_next = 1
    env.start()
    env.run_until(lambda: env.state("i1") == "Done")
    d = status.issue_detail(env.store.home, "i1")
    assert d["state"] == "Done" and d["issue"]["requirement_ids"] == ["F1.1", "F1.2"]
    assert [a["role"] for a in d["attempts"]] == ["implementer", "implementer", "reviewer"] and d["attempts"][0]["failure_kind"] == "checks_failed"
    assert {e["kind"] for e in d["evidence"]} >= {"checks", "review", "merge", "integrated"} and any(not e["valid"] or e["verdict"] == "fail" for e in d["evidence"])
    assert [j["to_state"] for j in d["journal"]][-1] == "Done" and "In Review" in [j["to_state"] for j in d["journal"]]
    text = status.render_issue(d)
    for fragment in ("issue i1  [Done]", "requirements F1.1, F1.2", "attempts:", "i1#1 implementer", "checks_failed", "evidence:", "history:", "Ready -> In Progress"):
        assert fragment in text, fragment
    assert cli.main(["--home", env.store.home, "issue", "i1", "--json"]) == 0
    assert json.loads(capsys.readouterr().out)["state"] == "Done"
    assert cli.main(["--home", env.store.home, "issue", "i1"]) == 0 and "issue i1" in capsys.readouterr().out


def test_issue_detail_is_read_only_and_explains_unknown_ids(tmp_path, capsys):
    env = Env(tmp_path, budgets=LONG)
    before = env.store.journal(200)
    with pytest.raises(KeyError, match="unknown issue 'nope' \\(known: i1\\)"):
        status.issue_detail(env.store.home, "nope")
    assert cli.main(["--home", env.store.home, "issue", "nope"]) == 2 and "unknown issue" in capsys.readouterr().err
    assert env.store.journal(200) == before


def test_issue_detail_includes_human_tasks(tmp_path):
    env = Env(tmp_path, budgets=LONG)
    env.checker.fail_next = 99
    env.start()
    env.run_until(lambda: env.state("i1") == "Blocked")
    d = status.issue_detail(env.store.home, "i1")
    assert d["human_tasks"][0]["kind"] == "decision" and "BLOCKED" in status.render_issue(d) and "human task decision-i1-1" in status.render_issue(d)
