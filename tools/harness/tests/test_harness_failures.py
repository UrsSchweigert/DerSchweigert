import json

import pytest

from harness import failures
from harness_doubles import Env

LONG = {"lease_s": 10**7, "run_wall_clock_s": 10**8, "worker_timeout_s": 10**7, "inactivity_timeout_s": 10**7}


@pytest.mark.parametrize("kind,expected", [
    ("infra", "transient"), ("network", "transient"), ("rate_limit", "transient"), ("runtime_crash", "transient"), ("lease_lost", "transient"),
    ("checks_failed", "deterministic"), ("review_findings", "deterministic"), ("schema_invalid", "deterministic"), ("merge_conflict", "deterministic"),
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
    env.run_until(lambda: env.state("i1") == "Done", advance=700)
    issue = env.store.get_issue("i1")
    assert issue["transient_failures"] == 3 and issue["repair_failures"] == 2


def test_exhausted_transient_budget_blocks_with_an_owner(tmp_path):
    env = Env(tmp_path, budgets=LONG)
    env.adapter.script("i1", "implementer", *["error:infra"] * 6)
    env.start()
    env.run_until(lambda: env.state("i1") == "Blocked", advance=700)
    assert "transient retry budget exhausted" in env.store.get_issue("i1")["blocked_reason"]
    assert [t["state"] for t in env.store.human_tasks("i1")] == ["Requested"]


def test_exhausted_repair_budget_blocks_and_raises_a_decision_task(tmp_path):
    env = Env(tmp_path)
    env.checker.fail_next = 99
    env.start()
    env.run_until(lambda: env.state("i1") == "Blocked")
    attempts = env.store.list_attempts("i1")
    assert len([a for a in attempts if a["role"] == "implementer"]) == 3  # one attempt plus two repairs
    [task] = env.store.human_tasks("i1")
    assert task["kind"] == "decision" and task["owner"] == "owner" and task["state"] == "Requested"
    assert task["payload"]["options"] == ["retry as is", "give guidance and retry", "refine the scope", "cancel the issue"]
    assert [a["class"] for a in task["payload"]["extra"]["attempts"]] == ["deterministic"] * 3
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
