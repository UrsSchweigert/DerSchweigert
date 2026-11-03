"""Every role's role prompt and the result schema must agree on the same keys.

A prompt that tells a model to omit a key the schema then requires rejects every model that follows the
instruction. That happened to the refiner: its example dropped `checks`, the schema demanded it, and three
attempts in a row failed as `schema_invalid: result.checks: missing`.
"""
import json
import re

import pytest

from harness import schemas
from harness.adapter import WorkRequest, build_prompt

ROLES = ("refiner", "implementer", "reviewer", "delegator", "analyst")


def prompt_keys(role):
    req = WorkRequest(attempt_id="x#1", epoch=1, issue_id="i", role=role, tier="low", model=None, packet="p", branch="b")
    example = re.search(r"exactly these keys: (\{.*?\})\.", build_prompt(req), re.S).group(1)
    return json.loads(example)


@pytest.mark.parametrize("role", ROLES)
def test_a_result_that_follows_the_role_prompt_is_accepted(role):
    result = prompt_keys(role)
    assert result["outcome"] == {"refiner": "ready", "implementer": "done", "reviewer": "done",
                                 "delegator": "done", "analyst": "done"}[role] or role == "reviewer"
    schemas.validate(dict(result, attempt_id="x#1", epoch=1), schemas.WORKER_RESULT, "result")


@pytest.mark.parametrize("role", ROLES)
def test_the_prompt_never_asks_for_a_key_the_schema_forbids(role):
    example = prompt_keys(role)
    allowed = {key.rstrip("?") for key in schemas.WORKER_RESULT}
    assert set(example) <= allowed, sorted(set(example) - allowed)


def test_checks_stay_optional_because_trusted_code_runs_them():
    assert "checks?" in schemas.WORKER_RESULT
    base = {"attempt_id": "x#1", "epoch": 1, "outcome": "done", "changed_files": [], "revision": "abc",
            "risks": [], "blockers": [], "next_action": "review"}
    schemas.validate(base, schemas.WORKER_RESULT, "result")
    schemas.validate(dict(base, checks=[{"command": "true", "exit_code": 0}]), schemas.WORKER_RESULT, "result")


# -- the diff budget is stated, and an oversize diff is a sizing problem ---------------------------------

def test_the_worker_is_told_the_line_budget_it_is_judged_against():
    from harness.adapter import ROLE_INSTRUCTIONS
    for role in ("implementer", "refiner"):
        assert "diff_budget.max_added_lines" in ROLE_INSTRUCTIONS[role], role


def test_the_task_packet_carries_the_budget(tmp_path):
    from harness.tests.harness_doubles import Env
    env = Env(tmp_path, issues=[("i1", "P1", ["F1.1"])])
    env.start()
    issue = env.store.get_issue("i1")
    packet = env.sched._packet(issue, "implementer", "low")
    assert packet["diff_budget"]["max_added_lines"] == env.sched._plan()["policy"]["diff_size_cap"]
    assert "blocked" in packet["diff_budget"]["rule"]


def test_an_oversize_diff_goes_to_the_sizing_analysis_instead_of_blocking(tmp_path):
    from harness.tests.harness_doubles import Env
    env = Env(tmp_path, issues=[("i1", "P1", ["F1.1"])], budgets={"analyses_per_issue": 1})
    env.start()
    env.adapter.impl_lines["i1"] = 900  # over the 800-line cap
    events = env.run_until(lambda: env.store.get_issue("i1").get("analysis_pending") or env.state("i1") == "Blocked")
    assert any(e["event"] == "analysis_scheduled" for e in events)
    issue = env.store.get_issue("i1")
    assert any(f["kind"] == "diff_too_large" for f in issue["last_failures"])
    assert issue.get("analysis_pending") is True and env.state("i1") != "Blocked"


def test_an_oversize_diff_reaches_the_owner_only_when_the_overseer_is_off(tmp_path):
    from harness.tests.harness_doubles import Env
    env = Env(tmp_path, issues=[("i1", "P1", ["F1.1"])], budgets={"analyses_per_issue": 0},
              policy_overrides={"overseer": {"enabled": False}})
    env.start()
    env.adapter.impl_lines["i1"] = 900
    env.run_until(lambda: env.state("i1") == "Blocked")
    assert "diff" in env.store.get_issue("i1")["blocked_reason"]
    assert not any(a["role"] == "overseer" for a in env.store.list_attempts("i1"))


# -- the overseer: a top-tier agent for stuck issues, bounded to process actions -------------------------

def _run(env, predicate, limit=20, advance=10):
    """Tick until the predicate holds over the accumulated events, which is the only observable the scheduler keeps."""
    events = []
    for _ in range(limit):
        events += env.tick(advance)
        if predicate(events, env):
            return events
    raise AssertionError("condition not reached; events=%s state=%s" % (events[-6:], env.state("i1")))


def _failing_check_env(tmp_path, overseer=None, **kw):
    from harness.tests.harness_doubles import Env
    overrides = dict(kw.pop("policy_overrides", {}) or {})
    overrides["overseer"] = overseer or {"enabled": True, "rounds_per_issue": 2}
    env = Env(tmp_path, issues=[], budgets=dict(lease_s=10**7, worker_timeout_s=10**7, inactivity_timeout_s=10**7,
                                               repair_attempts=0), policy_overrides=overrides, **kw)
    env.add_issue("i1", "P1", ["F1.1"], validation_commands=["unit"])
    env.checker.fail_commands = {"unit"}
    env.checker.outputs["unit"] = "FAIL: boom"
    env.start()
    return env


def test_a_process_block_goes_to_the_overseer_before_the_owner(tmp_path):
    env = _failing_check_env(tmp_path)
    events = _run(env, lambda ev, e: any(x["event"] == "overseer_scheduled" for x in ev))
    assert not env.store.human_tasks("i1")
    assert [x for x in events if x["event"] == "overseer_scheduled"][0]["kind"] == "checks_failed"


def test_the_overseer_may_retry_without_asking_the_owner(tmp_path):
    env = _failing_check_env(tmp_path)
    env.adapter.overseer = {"action": "retry", "cause": "process", "reason": "the test file is new; retry after the fix",
                            "guidance": "a hint"}
    events = _run(env, lambda ev, e: any(x["event"] == "overseer_decision" for x in ev))
    assert [x for x in events if x["event"] == "overseer_decision"][0]["action"] == "retry"
    assert not env.store.human_tasks("i1")
    assert "a hint" in env.store.get_issue("i1")["guidance"]
    assert env.state("i1") != "Blocked"


def test_a_harness_defect_finding_reaches_the_owner_with_its_reason(tmp_path):
    env = _failing_check_env(tmp_path)
    env.adapter.overseer = {"action": "escalate", "cause": "harness_defect",
                            "reason": "the check runner reports a missing directory that the plan creates"}
    _run(env, lambda ev, e: e.state("i1") == "Blocked")
    issue = env.store.get_issue("i1")
    assert issue["overseer_finding"]["cause"] == "harness_defect"
    assert "the check runner reports a missing directory" in issue["blocked_reason"]
    assert any(t["kind"] == "decision" for t in env.store.human_tasks("i1"))


def test_the_overseer_cannot_cancel_or_approve(tmp_path):
    env = _failing_check_env(tmp_path)
    env.adapter.overseer = {"action": "cancel", "cause": "process", "reason": "give up"}
    _run(env, lambda ev, e: e.state("i1") == "Blocked")
    assert "no usable decision" in env.store.get_issue("i1")["blocked_reason"]
    assert any(t["kind"] == "decision" for t in env.store.human_tasks("i1"))


def test_the_overseer_is_bounded_per_issue(tmp_path):
    env = _failing_check_env(tmp_path, overseer={"enabled": True, "rounds_per_issue": 1})
    env.adapter.overseer = {"action": "retry", "cause": "process", "reason": "try again"}
    _run(env, lambda ev, e: e.state("i1") == "Blocked")
    assert len([a for a in env.store.list_attempts("i1") if a["role"] == "overseer"]) == 1


def test_an_authority_failure_never_reaches_the_overseer(tmp_path):
    from harness.tests.harness_doubles import Env
    env = Env(tmp_path, issues=[("i1", "P1", ["F1.1"])], allowlist=("src/", "tools/harness/"))
    env.adapter.impl_paths["i1"] = ["tools/harness/store.py"]
    env.start()
    env.run_until(lambda: env.state("i1") == "Blocked")
    assert not any(a["role"] == "overseer" for a in env.store.list_attempts("i1"))


def test_the_overseer_runs_on_the_strongest_tier(tmp_path):
    from harness import models
    assert models.ROLE_TIER["overseer"] == "strong" and models.REQUIRED_TIER["overseer"] == "strong"


def test_the_overseer_is_off_unless_the_plan_asks_for_it(tmp_path):
    from harness import plans
    assert "overseer" not in plans.DEFAULT_POLICY
    on = plans.with_overseer(plans.DEFAULT_POLICY, True)
    assert on["overseer"] == {"enabled": True, "rounds_per_issue": 2}
    assert plans.plan_digest(plans.build_plan("p", 1, [], None, policy=on)) != \
        plans.plan_digest(plans.build_plan("p", 1, [], None, policy=plans.with_overseer(plans.DEFAULT_POLICY, False)))


def test_a_plan_that_does_not_opt_in_keeps_every_block_with_the_owner(tmp_path):
    from harness.tests.harness_doubles import Env
    env = Env(tmp_path, issues=[], budgets=dict(lease_s=10**7, worker_timeout_s=10**7, inactivity_timeout_s=10**7,
                                                repair_attempts=0))
    env.add_issue("i1", "P1", ["F1.1"], validation_commands=["unit"])
    env.checker.fail_commands = {"unit"}
    env.start()
    env.run_until(lambda: env.state("i1") == "Blocked")
    assert not any(a["role"] == "overseer" for a in env.store.list_attempts("i1"))
    assert any(t["kind"] == "decision" for t in env.store.human_tasks("i1"))



def test_a_stalled_worker_goes_to_the_overseer_not_the_owner(tmp_path):
    """An attempt that produced nothing is a process question, like a lost lease. Sending it to the owner asked a human
    to decide about the game when nothing about the game had failed."""
    from harness.tests.harness_doubles import Env
    env = Env(tmp_path, issues=[("i1", "P1", ["F1.1"])],
              budgets=dict(lease_s=10**7, worker_timeout_s=10**7, inactivity_timeout_s=10**7, transient_retries=0),
              policy_overrides={"overseer": {"enabled": True, "rounds_per_issue": 2}})
    env.adapter.script("i1", "implementer", *["error:inactivity"] * 4)
    env.adapter.overseer = {"action": "retry", "cause": "process", "reason": "the worker stalled; retry in smaller steps"}
    env.start()
    events = _run(env, lambda ev, e: any(x["event"] == "overseer_decision" for x in ev))
    scheduled = [x for x in events if x["event"] == "overseer_scheduled"]
    assert scheduled and scheduled[0]["kind"] == "inactivity"
    assert env.store.human_tasks("i1") == []  # the owner was not asked
