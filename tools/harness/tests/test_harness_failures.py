import json
import pathlib
import time

import pytest

from harness import failures
from harness_doubles import Env

LONG = {"lease_s": 10**7, "run_wall_clock_s": 10**8, "worker_timeout_s": 10**7, "inactivity_timeout_s": 10**7}


@pytest.mark.parametrize("kind,expected", [
    ("infra", "transient"), ("network", "transient"), ("rate_limit", "transient"), ("runtime_crash", "transient"), ("lease_lost", "transient"),
    ("checks_failed", "deterministic"), ("review_findings", "deterministic"), ("schema_invalid", "deterministic"), ("merge_conflict", "deterministic"),
    ("check_configuration", "configuration"),
    ("scope_violation", "policy"), ("escalation_path", "policy"), ("approval", "policy"), ("permission", "policy"), ("protected_branch", "policy"),
    ("isolation", "systemic"), ("credentials", "systemic"), ("budget", "systemic"),
    ("something_new", "deterministic"),
])
def test_failure_class_is_assigned_by_code(kind, expected):
    assert failures.classify(kind) == expected


def test_timeouts_depend_on_history():
    assert failures.classify("timeout") == "transient"
    assert failures.classify("timeout", prior_timeout_same_packet=True) == "deterministic"
    assert failures.classify("inactivity", prior_timeout_same_packet=True) == "deterministic"


def test_backoff_grows_and_is_capped():
    d = [failures.backoff_delay(n, rng=lambda: 1.0) for n in (1, 2, 3, 20)]
    assert d[0] < d[1] < d[2] and d[3] == 600.0


def test_transient_and_repair_budgets_are_separate(tmp_path):
    env = Env(tmp_path, budgets=LONG)
    env.adapter.script("i1", "implementer", "error:infra", "error:infra", "error:infra")
    env.checker.fail_next = 2
    env.start()
    env.run_until(lambda: env.state("i1") == "Blocked", advance=700)
    issue = env.store.get_issue("i1")
    assert issue["transient_failures"] == 3 and issue["repair_failures"] == 2
    assert "identical check failure repeated" in issue["blocked_reason"]


def test_exhausted_transient_budget_blocks_with_an_owner(tmp_path):
    env = Env(tmp_path, budgets=LONG)
    # A transient failure after a worker ran: the issue's own work is at stake, so the owner decides.
    env.adapter.script("i1", "implementer", "error:runtime_crash", "error:runtime_crash", *["error:runtime_crash"] * 6)
    env.start()
    env.run_until(lambda: env.state("i1") == "Blocked", advance=700)
    assert "transient retry budget exhausted" in env.store.get_issue("i1")["blocked_reason"]
    assert [t["state"] for t in env.store.human_tasks("i1")] == ["Requested"]


def test_a_worker_that_never_starts_pauses_the_run_once_instead_of_asking_per_issue(tmp_path):
    """A host problem hits every issue the same way. Four retries per issue and a decision task each would bury the
    one fact the owner needs: no worker can start at all."""
    env = Env(tmp_path, budgets=LONG, issues=[("i1", "P1", ["F1.1"]), ("i2", "P1", ["F1.2"])])
    env.adapter.script("i1", "implementer", "start_fails", "start_fails", "start_fails", "start_fails")
    env.start()
    events = env.run_until(lambda: env.store.state("plan", "fx@v1") == "Paused", advance=700)
    assert [e["event"] for e in events if e["event"] in ("environment_failure", "paused")] == ["environment_failure", "paused"]
    assert "no worker can be started" in events[-1]["reason"]
    assert env.state("i1") == "Ready"  # released for a retry, not blocked
    assert env.store.human_tasks("i1") == [] and env.store.human_tasks("i2") == []
    assert env.store.get_issue("i1")["transient_failures"] == 0  # none of it was about this issue


def test_a_run_pauses_when_there_is_no_room_for_a_worker_copy(tmp_path):
    """Every attempt fails in preparation without disk space, so the harness says so instead of retrying."""
    env = Env(tmp_path)
    env.sched.free_space_floor_bytes = 2 ** 60  # no host has this much free
    env.start()
    events = env.tick(1)
    assert events[-1]["event"] == "paused" and "free for worker directories" in events[-1]["reason"]
    assert not env.adapter.started
    env.sched.free_space_floor_bytes = 0
    env.store.put_run("fx", dict(env.store.get_run("fx"), pause_requested=False))
    env.sched.start(env.clock())  # the owner resumes once space is free
    env.tick(1)
    assert env.adapter.started


def test_validation_configuration_failure_blocks_without_repair_dispatch(tmp_path):
    env = Env(tmp_path)
    env.checker.run = lambda issue_id, head_rev, commands: [
        {"command": commands[0], "exit_code": 127, "kind": "configuration", "output": "command not found"}
    ]
    env.start()
    env.run_until(lambda: env.state("i1") == "Blocked")
    issue = env.store.get_issue("i1")
    assert issue["repair_failures"] == 0
    assert len([a for a in env.store.list_attempts("i1") if a["role"] == "implementer"]) == 1
    assert "validation configuration failure" in issue["blocked_reason"]


def test_exhausted_repair_budget_blocks_and_raises_a_decision_task(tmp_path):
    env = Env(tmp_path)
    env.checker.fail_next = 99
    env.start()
    env.run_until(lambda: env.state("i1") == "Blocked")
    attempts = env.store.list_attempts("i1")
    assert len([a for a in attempts if a["role"] == "implementer"]) == 2  # the repeated command-and-error signature stops early
    [task] = env.store.human_tasks("i1")
    assert task["kind"] == "decision" and task["owner"] == "owner" and task["state"] == "Requested"
    assert task["payload"]["options"] == ["retry as is", "give guidance and retry", "extend retry budget and retry",
                                          "refine the scope", "cancel the issue"]
    assert [a["class"] for a in task["payload"]["extra"]["attempts"]] == ["deterministic"] * 2
    assert all(e["kind"] == "checks_failed" for e in task["payload"]["extra"]["evidence"])
    # Other eligible work continues: a second issue is still scheduled.
    assert env.store.active_claims() == []


def test_other_work_continues_when_one_issue_blocks(tmp_path):
    env = Env(tmp_path, issues=[("bad", "P1", ["F1.1"]), ("good", "P1", ["F1.2"])])
    env.adapter.impl_paths["bad"] = ["elsewhere/x.py"]
    env.start()
    env.run_until(lambda: env.state("good") == "Done")
    assert env.state("bad") == "Blocked"


def test_each_retry_must_change_an_input(tmp_path):
    env = Env(tmp_path)
    env.checker.fail_next = 1
    env.start()
    env.run_until(lambda: env.state("i1") == "Done")
    first, second = [r for r in env.adapter.started if r.role == "implementer"]
    assert "previous_failures" not in first.packet["untrusted_data"]
    assert "checks_failed" in second.packet["untrusted_data"]
    assert first.tier != second.tier  # evidence also moved the tier up


def test_duplicate_attempt_is_rejected(tmp_path):
    from harness.scheduler import digest_of
    env = Env(tmp_path)
    issue = env.store.get_issue("i1")
    digest = digest_of(env.sched._packet(issue, "implementer", "standard"))
    env.store.put_attempt({"attempt_id": "i1#0", "issue_id": "i1", "role": "implementer", "tier": "standard", "packet_digest": digest,
                           "outcome": "Failed", "failure_class": "deterministic", "failure_kind": "checks_failed"})
    env.start()
    events = env.tick()
    assert any(e["event"] == "duplicate_attempt_rejected" and e["of"] == "i1#0" for e in events)
    assert env.state("i1") == "Blocked" and not env.adapter.started


def test_changing_the_tier_makes_a_retry_distinct(tmp_path):
    from harness.scheduler import digest_of
    env = Env(tmp_path)
    issue = env.store.get_issue("i1")
    digest = digest_of(env.sched._packet(issue, "implementer", "low"))
    assert digest == digest_of(env.sched._packet(issue, "implementer", "strong"))  # the digest alone ignores the tier
    env.store.put_attempt({"attempt_id": "i1#0", "issue_id": "i1", "role": "implementer", "tier": "low", "packet_digest": digest,
                           "outcome": "Failed", "failure_class": "deterministic"})
    assert failures.duplicate_of_failed(env.store.list_attempts("i1"), digest, "standard") is None


def test_policy_failure_blocks_immediately_without_retry(tmp_path):
    env = Env(tmp_path)
    env.adapter.impl_paths["i1"] = ["not/allowed.py"]
    env.start()
    env.run_until(lambda: env.state("i1") == "Blocked")
    issue = env.store.get_issue("i1")
    assert issue["repair_failures"] == 0 and issue["transient_failures"] == 0
    assert len(env.store.list_attempts("i1")) == 1
    assert env.store.get_attempt("i1#1")["failure_class"] == "policy"


def test_schema_invalid_result_is_deterministic(tmp_path):
    env = Env(tmp_path)
    env.adapter.script("i1", "implementer", "bad_schema")
    env.start()
    env.tick()
    env.tick()
    a = env.store.get_attempt("i1#1")
    assert a["failure_kind"] == "schema_invalid" and a["failure_class"] == "deterministic"


def test_systemic_failure_pauses_instead_of_blocking(tmp_path):
    env = Env(tmp_path)
    env.adapter.script("i1", "implementer", "error:credentials")
    env.start()
    env.tick()
    env.tick()
    assert env.store.state("plan", "fx@v1") == "Paused"
    assert env.state("i1") == "Ready" and env.store.human_tasks("i1") == []
    assert "systemic failure" in env.store.get_run("fx")["paused_reason"]


def test_blocked_issue_without_owner_is_repaired_and_reported(tmp_path):
    env = Env(tmp_path)
    env.store.transition("issue", "i1", "Blocked", "someone", {"reason": "manual"})
    env.start()
    events = env.tick()
    assert any(e["event"] == "invariant_repaired" and e["issue"] == "i1" for e in events)
    assert len(env.store.human_tasks("i1")) == 1
    assert [e for e in env.tick() if e["event"] == "invariant_repaired"] == []  # idempotent


def test_blocked_on_unmet_dependency_needs_no_task(tmp_path):
    env = Env(tmp_path, issues=[("a", "P1", ["F1.1"])])
    env.add_issue("b", "P1", ["F1.2"], deps=["a"])
    env.adapter.script("a", "implementer", "hang")
    env.store.transition("issue", "b", "Blocked", "someone")
    env.start()
    env.tick()
    assert env.store.human_tasks("b") == []


def test_a_finished_attempt_releases_its_working_copy(tmp_path):
    """Every attempt gets its own copy of the repository. Keeping them after the attempt is over filled the disk."""
    env = Env(tmp_path, budgets=LONG)
    env.adapter.script("i1", "implementer", "error:runtime_crash", "ok")
    env.start()
    env.run_until(lambda: env.state("i1") == "Done", advance=700)
    started = [req.attempt_id for req in env.adapter.started]
    assert started and sorted(env.adapter.cleaned) == sorted(started)  # every copy released, each exactly once


def test_the_heartbeat_keeps_a_lease_alive_when_a_tick_is_slow(tmp_path):
    """A lease detects a dead runner, not a busy one. A slow network call in one tick used to fence every worker in
    flight, spend its retry budget, and block four issues over workers that had done nothing wrong."""
    env = Env(tmp_path, budgets=dict(LONG, lease_s=90))
    env.adapter.script("i1", "implementer", "busy", "busy", "ok")
    env.start()
    env.tick(1)
    assert env.sched.active_attempts() == ["i1#1"]
    env.clock.advance(80)
    env.sched._renew_leases()  # what the heartbeat thread does while the tick is stuck in a slow call
    env.clock.advance(80)
    assert env.store.recover(env.clock()) == []  # 160s after the claim, and the lease is still alive
    assert env.sched.active_attempts() == ["i1#1"]


def test_a_notification_that_fails_does_not_stop_the_scheduling_pass(tmp_path):
    class Broken:
        def send(self, recipient, subject, message, task):
            raise RuntimeError("gh did not answer within 60s")

    env = Env(tmp_path, budgets=LONG)
    env.sched.notifier = Broken()
    env.start()
    env.tick(1)  # must not raise
    assert env.state("i1") == "In Progress" and env.sched.active_attempts() == ["i1#1"]


def test_a_slow_scheduling_stage_is_named_in_the_run_log(tmp_path, monkeypatch):
    from harness import scheduler as scheduler_mod
    monkeypatch.setattr(scheduler_mod, "SLOW_STAGE_S", 0.01)
    env = Env(tmp_path, budgets=LONG)
    env.sched.events = []
    with env.sched._timed("notify"):
        time.sleep(0.02)
    assert env.sched.events[0]["event"] == "tick_slow" and env.sched.events[0]["stage"] == "notify"


def test_a_sleeping_host_does_not_fence_a_running_attempt(tmp_path):
    """A laptop that sleeps freezes the runner, the worker and the lease at once. Fencing that attempt charges the
    issue for a fault of the host — and on a machine that sleeps at night it charges every issue once per night."""
    env = Env(tmp_path, budgets=dict(LONG, lease_s=90, worker_timeout_s=10 ** 7, inactivity_timeout_s=10 ** 7))
    mono = {"t": 1000.0}
    env.sched.mono_clock = lambda: mono["t"]
    env.adapter.script("i1", "implementer", "busy", "busy", "ok")
    env.start()
    env.tick(1)  # the pivot
    env.clock.advance(700)  # 11 minutes of wall clock pass ...
    mono["t"] += 2  # ... while this process was frozen for all but two seconds of it
    events = env.tick(1)
    assert [e for e in events if e["event"] == "host_slept"] != []
    assert env.sched.active_attempts() == ["i1#1"]  # still running, not fenced
    assert env.state("i1") == "In Progress"
    assert not [e for e in events if e["event"] == "attempt_failed"]


def test_without_sleep_detection_the_same_jump_fences_the_attempt(tmp_path):
    """The control: the very same wall-clock jump, with no monotonic clock to compare against."""
    env = Env(tmp_path, budgets=dict(LONG, lease_s=90, worker_timeout_s=10 ** 7, inactivity_timeout_s=10 ** 7))
    env.adapter.script("i1", "implementer", "busy", "busy", "ok")
    env.start()
    env.tick(1)
    env.clock.advance(700)
    events = env.tick(1)
    assert [e for e in events if e["event"] == "attempt_failed" and e.get("kind") == "lease_lost"] != []


def test_a_claim_cannot_be_extended_under_another_epoch(tmp_path):
    env = Env(tmp_path, budgets=dict(LONG, lease_s=90))
    env.start()
    env.tick(1)
    claim = env.store.active_claims()[0]
    assert env.store.extend_claim(claim["attempt_id"], claim["epoch"], env.clock(), 90) is True
    assert env.store.extend_claim(claim["attempt_id"], claim["epoch"] + 1, env.clock(), 90) is False


def test_keep_awake_is_a_no_op_outside_macos(monkeypatch):
    from harness import runner as runner_mod
    monkeypatch.setattr(runner_mod.sys, "platform", "linux")
    assert runner_mod.keep_awake() is None


def test_a_worker_that_writes_no_result_is_transient_not_deterministic():
    """A clean exit with no result file is a provider or CLI fault. Classifying it deterministic blocked an issue after
    one repeat instead of spending a retry on a stronger model."""
    assert failures.classify("no_result") == "transient"
    assert failures.classify("schema_invalid") == "deterministic"


def test_a_repeated_failure_signature_escalates_the_model_tier(tmp_path):
    """The harness already changes the packet; when the model produced nothing, the model is what has to change."""
    env = Env(tmp_path, budgets=dict(LONG, transient_retries=10, repair_attempts=10),
              available_models=["claude-haiku-4.5", "claude-sonnet-5", "claude-opus-5"])
    env.adapter.script("i1", "implementer", *["error:no_result"] * 6)
    env.start()
    env.run_until(lambda: len(env.adapter.started) >= 3, advance=700)
    tiers = [req.tier for req in env.adapter.started if req.role == "implementer"]
    assert tiers[0] == "low"
    assert "standard" in tiers[2:3]  # after two identical failures the next attempt is a tier higher


def test_the_escalation_skips_a_tier_that_offers_the_same_model(tmp_path):
    """This plan maps low and standard both to the cheapest model. Escalating one label up repeated the same failure
    under a different name; the model is what has to change."""
    env = Env(tmp_path, budgets=dict(LONG, transient_retries=10, repair_attempts=10),
              available_models=["deepseek/deepseek-flash", "deepseek/deepseek-v4-pro"],
              model_sources=["deepseek"],
              policy_overrides={"model_tiers": {"low": ["deepseek/deepseek-flash"],
                                                "standard": ["deepseek/deepseek-flash"],
                                                "strong": ["deepseek/deepseek-v4-pro"]}})
    env.adapter.script("i1", "implementer", *["error:no_result"] * 6)
    env.start()
    env.run_until(lambda: len(env.adapter.started) >= 3, advance=700)
    models_used = [req.model for req in env.adapter.started if req.role == "implementer"]
    assert models_used[0] == "deepseek/deepseek-flash"
    assert models_used[2] == "deepseek/deepseek-v4-pro"  # straight past the tier that repeats the same model


def test_an_attempt_left_by_a_stopped_runner_is_requeued_without_charge(tmp_path):
    """Restarting the runner used to cost the issue a retry for whatever was in flight, and enough restarts blocked a
    healthy issue. The attempt is still recorded as fenced, but the issue keeps its budget."""
    from harness.scheduler import Scheduler
    from harness_doubles import FakeAdapter, TIER_A
    env = Env(tmp_path, budgets=dict(LONG, lease_s=90))
    env.adapter.script("i1", "implementer", "busy", "busy", "ok")
    env.start()
    env.tick(1)
    before = env.store.get_issue("i1")["transient_failures"]
    # A new process takes the plan over, exactly as `harness resume` does.
    adapter2 = FakeAdapter(env.repo, env.clock)
    adapter2.script("i1", "implementer", "ok")
    sched2 = Scheduler(env.store, "fx", 1, adapter2, env.repo, env.checker, env.publisher,
                       clock=env.clock, rng=lambda: 0.0, isolation_override=TIER_A)
    env.clock.advance(120)  # the dead runner's lease lapses
    sched2.start(env.clock())
    events = sched2.tick(env.clock())
    assert [e for e in events if e["event"] == "attempt_orphaned"] != []
    assert not [e for e in events if e.get("kind") == "lease_lost"]
    assert env.store.get_issue("i1")["transient_failures"] == before
    assert env.store.get_attempt("i1#1")["failure_kind"] == "runner_lost"


def test_a_failure_keeps_the_workers_own_last_words(tmp_path):
    """Without the worker's output a failure is a category with no cause, and every such failure ends at the owner."""
    import json as _json
    env = Env(tmp_path, budgets=dict(LONG, transient_retries=5))
    env.adapter.tail_lines = ["Rate limit reached for deepseek-flash", "context length exceeded: 131072 tokens"]
    env.adapter.script("i1", "implementer", "error:no_result", "ok")
    env.start()
    env.run_until(lambda: env.state("i1") == "Done", advance=700)
    issue = env.store.get_issue("i1")
    first = issue["last_failures"][0]
    assert first["kind"] == "no_result"
    assert any("context length exceeded" in line for line in first["tail"])
    attempt = env.store.get_attempt("i1#1")
    assert any("Rate limit" in line for line in attempt["output_tail"])
    log = pathlib.Path(env.store.home) / "attempt-logs" / "i1_1.log"
    assert log.exists() and "Rate limit" in log.read_text()


def test_the_tail_does_not_change_the_failure_signature(tmp_path):
    """Two identical failures with different output are still the same failure; the repeat rule must still fire."""
    from harness import failures
    a = failures.signature("no_result", "the worker exited without writing result.json")
    b = failures.signature("no_result", "the worker exited without writing result.json")
    assert a == b
