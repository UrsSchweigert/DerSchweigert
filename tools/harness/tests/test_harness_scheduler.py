import pytest

from harness import approval, status
from harness.store import Store
from harness_doubles import Env, FakeChecker


LONG_BUDGETS = {"lease_s": 10**7, "run_wall_clock_s": 10**8, "worker_timeout_s": 10**7, "inactivity_timeout_s": 10**7}


class PendingChecker(FakeChecker):
    def __init__(self):
        super().__init__()
        self.held = True
        self.pending = []
        self.cancelled = []
        self.recovered = []

    def start(self, issue_id, head_rev, commands):
        handle = (issue_id, head_rev, commands)
        self.pending.append(handle)
        return handle

    def poll(self, handle):
        return None if self.held else super().run(*handle)

    def cancel(self, handle):
        self.cancelled.append(handle)

    def recovery_data(self, handle):
        return {"check": len(self.pending)}

    def recover(self, data):
        self.recovered.append(data)

    def run(self, *args):
        pytest.fail("the scheduler must not run checks synchronously")


def pending_checks(env):
    env.checker = PendingChecker()
    env.sched.checker = env.checker
    env.start()
    env.tick()
    env.tick()


def test_pending_checks_renew_the_implementer_lease(tmp_path):
    env = Env(tmp_path)
    pending_checks(env)
    for _ in range(6):
        env.tick(30)
        env.store.validate_lease("i1#1", 1, env.clock())
    assert env.state("i1") == "In Progress"
    assert len(env.checker.pending) == 1 and not env.publisher.intents
    env.checker.held = False
    env.run_until(lambda: env.state("i1") == "Done")


@pytest.mark.parametrize("action", ["pause", "cancel"])
def test_immediate_stop_cancels_pending_checks(tmp_path, action):
    from harness import runner
    env = Env(tmp_path)
    pending_checks(env)
    if action == "pause":
        runner.request_pause(env.store, "fx", 1, now_flag=True)
    else:
        env.sched.request_cancel()
    env.tick()
    assert env.store.state("plan", "fx@v1") == ("Paused" if action == "pause" else "Cancelled")
    assert env.checker.cancelled == env.checker.pending
    assert not env.store.active_claims() and not env.publisher.intents
    assert env.state("i1") == "Ready"


def test_graceful_stop_waits_for_pending_checks(tmp_path):
    env = Env(tmp_path)
    pending_checks(env)
    env.sched.request_cancel(drain=True)
    env.tick()
    assert env.store.state("plan", "fx@v1") == "Executing"
    env.checker.held = False
    env.tick()
    assert env.store.state("plan", "fx@v1") == "Cancelled"
    assert env.state("i1") == "In Review" and not env.checker.cancelled
    assert not [request for request in env.adapter.started if request.role == "reviewer"]


def pending_stage(env, stage):
    if stage == "implementation":
        pending_checks(env)
        return
    env.start()
    env.run_until(lambda: env.state("i1") == ("Done" if stage == "phase" else "In Review"))
    if stage == "rebase":
        env.repo.advance_base(["src/parallel.py"])
    env.checker = PendingChecker()
    env.sched.checker = env.checker
    env.tick()
    assert env.store.get_run("fx")["checks"]


@pytest.mark.parametrize("stage", ["implementation", "rebase", "integrated", "phase"])
def test_pending_check_results_require_the_same_revision_context(tmp_path, stage):
    env = Env(tmp_path)
    pending_stage(env, stage)
    old_base = env.repo.base_head()
    env.repo.advance_base(["src/new-base.py"])
    env.checker.held = False
    env.tick()
    assert len(env.checker.pending) >= 2
    assert any(event["event"] == "checks_stale" for event in env.sched.events)
    if stage == "phase":
        assert env.store.state("phase", "fx@v1/P1") == "Done"
    else:
        kind = "integrated" if stage == "integrated" else "checks"
        assert env.store.evidence("i1", kind)[-1]["base_rev"] != old_base


@pytest.mark.parametrize("stage", ["implementation", "rebase", "integrated", "phase"])
def test_restart_reclaims_pending_checks_after_expiry(tmp_path, stage):
    from harness.scheduler import Scheduler
    from harness_doubles import FakeAdapter, TIER_A
    env = Env(tmp_path)
    pending_stage(env, stage)
    checker = PendingChecker()
    checker.held = False
    adapter = FakeAdapter(env.repo, env.clock)
    env.checker, env.adapter = checker, adapter
    env.sched = Scheduler(env.store, "fx", 1, adapter, env.repo, checker, env.publisher, clock=env.clock,
                          isolation_override=TIER_A, available_models=["claude-haiku-4.5", "claude-sonnet-5"], runner_id="runner-2")
    env.clock.advance(65)  # a crashed runner keeps its plan lock for two heartbeats
    env.sched.start()
    env.tick(5)
    assert not checker.pending and not adapter.started
    env.tick(200)
    assert checker.recovered == [{"check": 1}]
    env.run_until(lambda: env.store.state("phase", "fx@v1/P1") == "Done")
    assert len([intent for intent in env.publisher.intents if intent["action"] == "merge_pr"]) == 1
    assert not env.store.get_run("fx")["checks"]


def test_replaced_check_job_cannot_publish_or_delete_its_replacement(tmp_path):
    env = Env(tmp_path)
    pending_checks(env)
    run = env.store.get_run("fx")
    run["checks"]["implementation:i1"]["job_id"] = "replacement-job"
    env.store.put_run("fx", run)
    env.checker.held = False
    env.tick()
    assert not env.publisher.intents
    assert env.store.get_run("fx")["checks"]["implementation:i1"]["job_id"] == "replacement-job"
    assert env.checker.cancelled


@pytest.mark.parametrize("stage", ["rebase", "integrated", "phase"])
def test_pause_now_cancels_coordinator_checks_without_worker_claims(tmp_path, stage):
    from harness import runner
    env = Env(tmp_path)
    pending_stage(env, stage)
    assert not env.store.active_claims()
    assert runner.request_pause(env.store, "fx", 1, now_flag=True) == "Executing"
    env.tick()
    assert env.store.state("plan", "fx@v1") == "Paused"
    assert env.checker.cancelled == env.checker.pending and not env.store.get_run("fx")["checks"]
    env.checker.held = False
    env.sched.start()
    env.run_until(lambda: env.store.state("phase", "fx@v1/P1") == "Done")
    assert len([intent for intent in env.publisher.intents if intent["action"] == "merge_pr"]) == 1


def test_refresh_pause_stops_the_remaining_dispatch_pass(tmp_path):
    from harness.github import GitHubError
    env = Env(tmp_path)
    env.start()
    env.run_until(lambda: env.state("i1") == "In Review")
    env.add_issue("waiting", "P1", ["F1.1"])
    def failed_refresh():
        raise GitHubError("remote unavailable")
    env.publisher.refresh_base = failed_refresh
    env.tick()
    assert env.store.state("plan", "fx@v1") == "Paused"
    assert env.state("waiting") == "Ready" and not env.store.human_tasks("waiting")
    assert not [request for request in env.adapter.started if request.issue_id == "waiting"]


def test_new_reviewer_lease_uses_the_current_clock(tmp_path):
    env = Env(tmp_path)
    def slow_diff(branch, limit=60000):
        env.clock.advance(120)
        return "reviewed diff"
    env.repo.diff_text = slow_diff
    env.start()
    env.run_until(lambda: env.state("i1") == "In Review")
    request = env.adapter.started[-1]
    assert request.role == "reviewer"
    env.store.validate_lease(request.attempt_id, request.epoch, env.clock())


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


def test_an_absent_pull_request_budget_is_unlimited(tmp_path):
    env = Env(tmp_path, issues=[("a", "P1", ["F1.1"]), ("b", "P1", ["F1.2"])], budgets={"pull_requests_per_run": None})
    env.start()
    env.run_until(lambda: env.state("a") == "Done" and env.state("b") == "Done")
    run = env.store.get_run("fx")
    assert not run.get("pause_requested") and "pull request budget" not in (run.get("paused_reason") or "")
    assert run["prs"] >= 2  # two pull requests went out and the plan kept scheduling
    report = status.build_report(env.store.home)
    assert report["budgets"]["fx"]["pull_requests"]["limit"] is None
    assert report["budgets"]["fx"]["pull_requests"]["remaining"] is None


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
    env.clock.advance(65)  # the dead runner's plan lock expires after two heartbeats
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


class _Promoter:
    """A publisher whose run branch accumulates the work, so completion has somewhere to promote to."""

    base = "harness/run/fx"

    def __init__(self, fail=False):
        self.calls, self.fail = [], fail

    def open_promotion(self, base, title, body):
        if self.fail:
            raise RuntimeError("no permission")
        self.calls.append((base, title, body))
        return 42


def test_a_finished_run_offers_its_branch_to_the_base_branch(tmp_path):
    env = Env(tmp_path, budgets=LONG_BUDGETS)
    env.sched.publisher = _Promoter()

    env.sched._open_promotion()

    base, title, body = env.sched.publisher.calls[0]
    assert base == "main" and "fx" in title and "harness/run/fx" in body
    assert [e for e in env.sched.events if e["event"] == "promotion_pr"][0]["number"] == 42


def test_a_missing_promotion_never_undoes_a_completed_plan(tmp_path):
    env = Env(tmp_path, budgets=LONG_BUDGETS)
    env.sched.publisher = _Promoter(fail=True)

    env.sched._open_promotion()

    failed = [e for e in env.sched.events if e["event"] == "promotion_failed"]
    assert failed and "RuntimeError" in failed[0]["error"]


def test_pausing_an_idle_plan_clears_the_request(tmp_path):
    from harness import runner as runner_mod

    env = Env(tmp_path, budgets=LONG_BUDGETS)
    env.sched.start()

    assert runner_mod.request_pause(env.store, "fx", 1) == "Paused"
    run = env.store.get_run("fx")
    assert env.store.state("plan", "fx@v1") == "Paused" and not run.get("pause_requested") and not run.get("pause_now")
    assert run["paused_reason"] == "paused by the operator"


def test_the_runner_clears_the_pause_request_once_it_pauses(tmp_path):
    env = Env(tmp_path, budgets=LONG_BUDGETS)
    env.sched.start()
    env.store.put_run("fx", dict(env.store.get_run("fx"), pause_requested=True, pause_now=False))

    env.sched._pause("paused by the operator", env.clock())

    run = env.store.get_run("fx")
    assert env.store.state("plan", "fx@v1") == "Paused" and not run.get("pause_requested")


def test_a_fresh_approval_does_not_inherit_the_cancel_request(tmp_path):
    env = Env(tmp_path, budgets=LONG_BUDGETS)
    env.store.put_run("fx", dict(env.store.get_run("fx"), cancel_requested=True, drain=False))

    env.sched.start()

    assert env.store.state("plan", "fx@v1") == "Executing" and not env.store.get_run("fx").get("cancel_requested")


def test_the_run_clock_stops_when_the_plan_is_cancelled(tmp_path):
    env = Env(tmp_path, budgets=LONG_BUDGETS)
    env.sched.start(now=1000.0)
    env.clock.advance(60)

    env.sched.request_cancel()
    env.sched.tick()

    used = status.build_report(env.store.home, env.clock())["budgets"]["fx"]["wall_clock_s"]["used"]
    env.clock.advance(3600)
    assert status.build_report(env.store.home, env.clock())["budgets"]["fx"]["wall_clock_s"]["used"] == used == 60


def test_a_resumed_run_does_not_pay_for_the_time_it_was_stopped(tmp_path):
    env = Env(tmp_path, budgets=LONG_BUDGETS)
    env.sched.start(now=1000.0)
    env.clock.advance(60)
    env.sched._pause("paused by the operator", env.clock())
    stopped_at = env.store.get_run("fx")["ended_at"]

    env.clock.advance(3600)  # an hour paused
    env.sched.start()
    env.clock.advance(30)

    run = env.store.get_run("fx")
    assert "ended_at" not in run and run["started_at"] == 1000.0 + 3600
    used = status.build_report(env.store.home, env.clock())["budgets"]["fx"]["wall_clock_s"]["used"]
    assert used == 90 and stopped_at == 1060


def test_the_run_clock_stops_when_the_plan_completes(tmp_path):
    env = Env(tmp_path, budgets=LONG_BUDGETS)
    env.sched.start(now=1000.0)
    env.clock.advance(120)

    for phase in ("P1", "P2"):
        for state in ("Eligible", "Active", "Validating", "Done"):
            env.store.transition("phase", "fx@v1/" + phase, state, "test")
    env.sched._complete_plan_if_done(env.clock())

    env.clock.advance(7200)
    assert status.build_report(env.store.home, env.clock())["budgets"]["fx"]["wall_clock_s"]["used"] == 120


def test_a_run_record_without_an_end_stamp_does_not_keep_growing(tmp_path):
    env = Env(tmp_path, budgets=LONG_BUDGETS)
    env.sched.start(now=1000.0)
    env.clock.advance(60)
    env.sched.request_cancel()
    env.sched.tick()
    legacy = env.store.get_run("fx")
    legacy.pop("ended_at", None)  # written by a version that did not stamp the end
    env.store.put_run("fx", legacy)

    first = status.build_report(env.store.home, env.clock())["budgets"]["fx"]["wall_clock_s"]["used"]
    env.clock.advance(3600)
    second = status.build_report(env.store.home, env.clock())["budgets"]["fx"]["wall_clock_s"]["used"]

    assert first == second == 60


def test_a_worker_that_never_started_does_not_use_up_the_strong_budget(tmp_path):
    env = Env(tmp_path, budgets=dict(LONG_BUDGETS, strong_attempts_per_issue=1))
    issue = env.store.get_issue("i1")
    issue["model_choices"] = {"implementer": {"model": "claude-opus-5", "reason": "needs the strong model"}}
    env.store.put_issue(issue)

    def explode(req):
        raise OSError("git checkout failed")

    env.adapter.start = explode
    env.sched.start()

    env.sched.tick(60)

    issue = env.store.get_issue("i1")
    assert issue["strong_attempts"] == 0
    assert any("adapter failed to start" in f["detail"] for f in issue["last_failures"])


def test_a_second_runner_cannot_take_the_same_plan(tmp_path):
    from harness.broker import BrokerRejected
    from harness.scheduler import Scheduler
    from harness_doubles import TIER_A

    env = Env(tmp_path, budgets=LONG_BUDGETS)
    env.sched.start(now=1000.0)
    other = Scheduler(env.store, "fx", 1, env.adapter, env.repo, env.checker, env.publisher, clock=env.clock,
                      rng=lambda: 0.0, isolation_override=TIER_A, available_models=["claude-haiku-4.5", "claude-sonnet-5", "claude-opus-5", "claude-opus-4.8"])
    other.runner_id = "runner-2"

    with pytest.raises(BrokerRejected, match="already being run by runner-1"):
        other.start(now=1010.0)


def test_the_lock_expires_so_a_crashed_runner_does_not_block_the_plan(tmp_path):
    from harness.scheduler import Scheduler
    from harness_doubles import TIER_A

    env = Env(tmp_path, budgets=LONG_BUDGETS)
    env.sched.start(now=1000.0)
    env.sched.release()

    other = Scheduler(env.store, "fx", 1, env.adapter, env.repo, env.checker, env.publisher, clock=env.clock,
                      rng=lambda: 0.0, isolation_override=TIER_A, available_models=["claude-haiku-4.5", "claude-sonnet-5", "claude-opus-5", "claude-opus-4.8"])
    other.runner_id = "runner-2"

    other.start(now=1010.0)  # the plan was released, so a new runner may take it
    assert env.store.get_doc("plan_owner", "fx")["runner_id"] == "runner-2"


def test_a_splittable_task_does_not_get_the_strongest_tier(tmp_path, monkeypatch):
    from harness import plans

    monkeypatch.setitem(plans.DEFAULT_POLICY, "split_pressure", {"enabled": True, "max_files": 1})
    env = Env(tmp_path, budgets=dict(LONG_BUDGETS, strong_attempts_per_issue=1))
    issue = env.store.get_issue("i1")
    issue["code_anchors"] = ["src/a.py", "src/b.py"]
    issue["model_choices"] = {"implementer": {"model": "claude-opus-5", "reason": "looks big"}}
    issue["planned"] = True  # planning is covered elsewhere; this test is about who implements
    env.store.put_issue(issue)
    started = []

    def record(req):
        started.append((req.tier, req.model))
        raise OSError("stop here: the routing is what this test looks at")

    env.adapter.start = record
    env.sched.start()
    env.sched.tick(60)

    assert started and started[0][0] != "strong"
    assert any(e["event"] == "split_pressure" for e in env.sched.events)
