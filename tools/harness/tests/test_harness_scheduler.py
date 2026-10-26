import pytest

from harness import approval
from harness.store import Store
from harness_doubles import Env


LONG_BUDGETS = {"lease_s": 10**7, "run_wall_clock_s": 10**8, "worker_timeout_s": 10**7, "inactivity_timeout_s": 10**7}


def done(env, *ids):
    return lambda: all(env.state(i) == "Done" for i in ids)


def test_dry_run_flow_reaches_plan_completion_without_remote_writes(tmp_path):
    env = Env(tmp_path, issues=[("a", "P1", ["F1.1", "F1.2"]), ("b", "P2", ["F2.1"])])
    env.start()
    env.run_until(lambda: env.store.state("plan", "fx@v1") == "Completed")
    assert env.state("a") == "Done" and env.state("b") == "Done"
    assert env.store.state("phase", "fx@v1/P1") == "Done" and env.store.state("phase", "fx@v1/P2") == "Done"
    assert [i["action"] for i in env.publisher.intents] == ["open_pr", "merge_pr", "open_pr", "merge_pr"]
    assert env.store.active_claims() == []
    reviewers = [r for r in env.adapter.started if r.role == "reviewer"]
    implementers = [r for r in env.adapter.started if r.role == "implementer"]
    assert reviewers and reviewers[0].model != implementers[0].model  # independent review


def test_run_refused_without_tier_a(tmp_path):
    env = Env(tmp_path)
    env.sched.iso = None
    with pytest.raises(approval.AuthorizationError, match="Tier B"):
        env.sched.start(env.clock())
    assert env.store.state("plan", "fx@v1") == "Approved"


def test_dependencies_gate_dispatch(tmp_path):
    env = Env(tmp_path, issues=[("a", "P1", ["F1.1", "F1.2"])])
    env.add_issue("b", "P1", ["F1.1"], deps=["a"])
    env.start()
    env.tick()
    roles = [(r.issue_id, r.role) for r in env.adapter.started]
    assert ("a", "implementer") in roles and not any(i == "b" for i, _ in roles)


def test_bounded_concurrency_only_for_parallel_safe_issues(tmp_path):
    env = Env(tmp_path, issues=[])
    for n in "abc":
        env.add_issue(n, "P1", ["F1.1"], parallel_safe=True)
        env.adapter.script(n, "implementer", "hang")
    env.start()
    env.tick()
    assert sorted(env.sched.active_attempts()) == ["a#1", "b#1"]  # limit is 2
    env2 = Env(tmp_path / "x", issues=[])
    for n in "ab":
        env2.add_issue(n, "P1", ["F1.1"], parallel_safe=(n == "a"))
        env2.adapter.script(n, "implementer", "hang")
    env2.start()
    env2.tick()
    assert env2.sched.active_attempts() == ["a#1"]


def test_heartbeat_loss_fences_worker_and_retries_with_new_epoch(tmp_path):
    env = Env(tmp_path)
    env.adapter.script("i1", "implementer", "busy")
    env.start()
    env.tick()
    assert env.sched.active_attempts() == ["i1#1"]
    # The runner stops ticking, so nothing renews the lease. A later pass fences the worker.
    env.clock.advance(200)
    env.sched.tick()
    assert env.store.state("attempt", "i1#1") == "Fenced"
    assert "i1#1" in env.adapter.cancelled
    issue = env.store.get_issue("i1")
    assert issue["transient_failures"] == 1 and issue["last_failures"][-1]["kind"] == "lease_lost"
    env.run_until(lambda: env.state("i1") == "Done")
    assert env.store.state("attempt", "i1#2") is not None


def test_inactivity_timeout_is_transient_then_deterministic_for_same_packet(tmp_path):
    env = Env(tmp_path, budgets={"inactivity_timeout_s": 60, "lease_s": 100000})
    env.adapter.script("i1", "implementer", "hang", "hang")
    env.start()
    env.tick(1)
    env.tick(100)
    first = env.store.get_attempt("i1#1")
    assert first["outcome"] == "TimedOut" and first["failure_class"] == "transient"
    env.run_until(lambda: env.store.get_attempt("i1#2") is not None, advance=200)
    env.tick(100)
    second = env.store.get_attempt("i1#2")
    assert second["outcome"] == "TimedOut" and second["failure_class"] == "deterministic"
    assert env.store.get_issue("i1")["repair_failures"] == 1


def test_execution_timeout_kills_a_busy_worker(tmp_path):
    env = Env(tmp_path, budgets={"worker_timeout_s": 300, "lease_s": 10_000})
    env.adapter.script("i1", "implementer", "busy")
    env.start()
    env.tick(1)
    env.tick(400)
    assert env.store.get_attempt("i1#1")["failure_kind"] == "timeout" and "i1#1" in env.adapter.cancelled


def test_adapter_start_failure_is_transient(tmp_path):
    env = Env(tmp_path)
    env.adapter.script("i1", "implementer", "start_fails")
    env.start()
    env.tick()
    a = env.store.get_attempt("i1#1")
    assert a["failure_class"] == "transient" and a["failure_kind"] == "infra"
    assert env.store.active_claims() == []


def test_transient_backoff_delays_the_retry(tmp_path):
    env = Env(tmp_path)
    env.adapter.script("i1", "implementer", "error:rate_limit")
    env.start()
    env.tick()
    env.tick()
    not_before = env.store.get_issue("i1")["not_before"]
    assert not_before > env.clock()
    env.tick(1)
    assert env.store.get_attempt("i1#2") is None
    env.run_until(lambda: env.state("i1") == "Done", advance=60)


def test_wall_clock_budget_pauses_the_project(tmp_path):
    env = Env(tmp_path, budgets={"run_wall_clock_s": 100})
    env.adapter.script("i1", "implementer", "hang")
    env.start()
    env.tick(10)
    events = env.tick(500)
    assert env.store.state("plan", "fx@v1") == "Paused" and any(e["event"] == "paused" for e in events)
    assert env.store.active_claims() == [] and env.state("i1") == "Ready"


def test_pull_request_budget_pauses_the_project(tmp_path):
    env = Env(tmp_path, issues=[("a", "P1", ["F1.1"]), ("b", "P1", ["F1.2"])], budgets={"pull_requests_per_run": 1})
    env.start()
    env.run_until(lambda: env.store.state("plan", "fx@v1") == "Paused")
    assert "pull request budget" in env.store.get_run("fx")["paused_reason"]


def test_cancel_terminates_workers_and_cancels_the_plan(tmp_path):
    env = Env(tmp_path)
    env.adapter.script("i1", "implementer", "busy")
    env.start()
    env.tick()
    env.sched.request_cancel()
    env.tick()
    assert env.store.state("plan", "fx@v1") == "Cancelled"
    assert env.store.state("attempt", "i1#1") == "Cancelled" and "i1#1" in env.adapter.cancelled
    assert env.store.active_claims() == [] and env.state("i1") == "Ready"
    assert env.tick() == []


def test_drain_waits_for_active_work_then_cancels(tmp_path):
    env = Env(tmp_path)
    env.adapter.script("i1", "implementer", "busy")
    env.start()
    env.tick()
    env.sched.request_cancel(drain=True)
    env.tick()
    assert env.store.state("plan", "fx@v1") == "Executing" and env.sched.active_attempts() == ["i1#1"]
    env.adapter.scripts["i1", "implementer"] = []
    handle = env.sched.handles["i1#1"]["handle"]
    handle.step = "ok"
    env.tick()
    assert env.store.state("plan", "fx@v1") == "Cancelled"
    assert not [r for r in env.adapter.started if r.role == "reviewer"]  # no new work started while draining


def test_crash_recovery_resumes_from_the_store_alone(tmp_path):
    env = Env(tmp_path)
    env.adapter.script("i1", "implementer", "busy")
    env.start()
    env.tick()
    assert env.state("i1") == "In Progress"
    # The runner process dies. A new scheduler instance with a new adapter takes over from stored state.
    from harness.scheduler import Scheduler
    from harness_doubles import FakeAdapter, TIER_A
    adapter2 = FakeAdapter(env.repo, env.clock)
    s2 = Scheduler(env.store, "fx", 1, adapter2, env.repo, env.checker, env.publisher, clock=env.clock, isolation_override=TIER_A,
                   available_models=["claude-haiku-4.5", "claude-sonnet-5", "claude-opus-5"], runner_id="runner-2")
    s2.start(env.clock())
    s2.tick(env.clock.advance(5))
    assert not adapter2.started  # the dead runner's lease is still live, so no duplicate worker starts
    s2.tick(env.clock.advance(200))
    assert env.store.state("attempt", "i1#1") == "Fenced"
    for _ in range(40):
        s2.tick(env.clock.advance(10))
        if env.state("i1") == "Done":
            break
    assert env.state("i1") == "Done"


def test_authorization_tamper_pauses_execution(tmp_path):
    import json
    env = Env(tmp_path)
    env.adapter.script("i1", "implementer", "busy")
    env.start()
    env.tick()
    plan = env.store.get_plan("fx")["plan"]
    plan["policy"]["merge_policy"] = "x"
    env.store.cx.execute("UPDATE plans SET content=?", (json.dumps(plan),))
    env.tick()
    assert env.store.state("plan", "fx@v1") == "Paused" and "changed since approval" in env.store.get_run("fx")["paused_reason"]
    assert env.store.active_claims() == []
    with pytest.raises(approval.AuthorizationError):
        env.sched.start(env.clock())


# -- pause ------------------------------------------------------------------------------------------------------------

def test_graceful_pause_lets_the_active_worker_finish_then_stops_and_resume_continues(tmp_path):
    from harness import runner
    env = Env(tmp_path, issues=[("a", "P1", ["F1.1"]), ("b", "P1", ["F1.2"])], budgets=dict(LONG_BUDGETS))
    env.adapter.script("a", "implementer", "busy")
    env.start()
    env.tick()
    assert env.sched.active_attempts() == ["a#1"]
    assert runner.request_pause(env.store, "fx", 1) == "Executing"  # a worker is active, so the pause is only requested
    env.tick()
    assert env.store.state("plan", "fx@v1") == "Executing" and env.sched.active_attempts() == ["a#1"]
    assert not [r for r in env.adapter.started if r.issue_id == "b"]  # nothing new starts while pausing
    env.sched.handles["a#1"]["handle"].step = "ok"
    events = env.tick()
    assert env.store.state("plan", "fx@v1") == "Paused" and any(e["event"] == "paused" for e in events)
    assert env.state("a") == "In Review"
    assert env.tick() == []  # a paused plan schedules nothing
    env.sched.start(env.clock())
    assert env.store.state("plan", "fx@v1") == "Executing" and not env.store.get_run("fx").get("pause_requested")
    env.run_until(lambda: env.state("a") == "Done" and env.state("b") == "Done")


def test_pause_now_cancels_active_workers_and_requeues_their_issues(tmp_path):
    from harness import runner
    env = Env(tmp_path, budgets=dict(LONG_BUDGETS))
    env.adapter.script("i1", "implementer", "busy")
    env.start()
    env.tick()
    runner.request_pause(env.store, "fx", 1, now_flag=True)
    env.tick()
    assert env.store.state("plan", "fx@v1") == "Paused" and "i1#1" in env.adapter.cancelled
    assert env.state("i1") == "Ready" and env.store.active_claims() == []
    env.sched.start(env.clock())
    env.run_until(lambda: env.state("i1") == "Done")


def test_pausing_an_idle_plan_is_immediate(tmp_path):
    from harness import runner
    env = Env(tmp_path)
    env.start()
    assert runner.request_pause(env.store, "fx", 1) == "Paused"
    assert env.store.state("plan", "fx@v1") == "Paused"


def test_only_a_running_plan_can_be_paused(tmp_path):
    import pytest as _pytest
    from harness import runner
    env = Env(tmp_path)
    with _pytest.raises(runner.RunRefused, match="Approved"):
        runner.request_pause(env.store, "fx", 1)


def test_status_and_cli_report_a_requested_pause(tmp_path, capsys):
    from harness import cli, runner, status
    env = Env(tmp_path, budgets=dict(LONG_BUDGETS))
    env.adapter.script("i1", "implementer", "busy")
    env.start()
    env.tick()
    assert cli.main(["--home", env.store.home, "pause", "fx"]) == 0
    assert "pause requested" in capsys.readouterr().out
    assert "PAUSE REQUESTED" in status.render(status.build_report(env.store.home, env.clock()))
    assert cli.main(["--home", env.store.home, "pause", "fx", "--now"]) == 0
    env.tick()
    assert "PAUSED" in status.render(status.build_report(env.store.home, env.clock()))
    assert cli.main(["--home", env.store.home, "pause", "fx"]) == 2  # already paused
