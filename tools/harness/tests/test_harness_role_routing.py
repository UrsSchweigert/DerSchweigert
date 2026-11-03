import copy
import json

import pytest

from harness import cli, models, plans, runner
from harness_doubles import Env
from test_harness_runner import ISSUE, REQ, make_plan


FLASH = "deepseek/deepseek-flash"
PRO = "deepseek/deepseek-v4-pro"
OPUS = "claude-opus-5"
ROUTING = {
    "routine_models": [FLASH, PRO],
    "refiner": OPUS,
    "escalation_models": ["claude-haiku-4.5", "claude-sonnet-5", OPUS],
}
AVAILABLE = [FLASH, PRO, "claude-haiku-4.5", "claude-sonnet-5", OPUS]


def routed_env(tmp_path, available=None):
    env = Env(tmp_path, model_sources=["deepseek", "copilot"],
              available_models=AVAILABLE if available is None else available,
              policy_overrides={"model_routing": ROUTING})
    issue = env.store.get_issue("i1")
    issue["model_choices"] = {
        "implementer": {"model": FLASH, "reason": "Routine implementation after Opus refinement."},
        "reviewer": {"model": PRO, "reason": "Independent DeepSeek reviewer."},
        "refiner": {"model": OPUS, "reason": "Owner-selected refinement model."},
    }
    env.store.put_issue(issue)
    return env


def test_routine_work_is_refined_by_opus_then_implemented_and_reviewed_by_deepseek(tmp_path):
    env = routed_env(tmp_path)
    env.start()
    env.run_until(lambda: env.state("i1") == "Done")
    attempts = env.store.list_attempts("i1")
    assert [a["role"] for a in attempts] == ["refiner", "implementer", "reviewer"]
    assert [a["model"] for a in attempts] == [OPUS, FLASH, PRO]


def test_quality_repairs_and_their_review_use_the_claude_escalation_menu(tmp_path):
    env = routed_env(tmp_path)
    env.checker.fail_next = 1
    env.start()
    env.run_until(lambda: env.state("i1") == "Done")
    attempts = env.store.list_attempts("i1")
    implementations = [a for a in attempts if a["role"] == "implementer"]
    assert implementations[0]["model"] == FLASH
    assert implementations[1]["model"] in ROUTING["escalation_models"]
    reviewer = next(a for a in attempts if a["role"] == "reviewer")
    assert reviewer["model"] in ROUTING["escalation_models"]
    assert reviewer["model"] != implementations[1]["model"]


def test_missing_deepseek_does_not_silently_run_routine_work_on_claude(tmp_path):
    env = routed_env(tmp_path, available=[OPUS, "claude-sonnet-5"])
    env.start()
    env.run_until(lambda: env.state("i1") == "Blocked")
    assert not [a for a in env.store.list_attempts("i1") if a["role"] == "implementer"]
    assert "model selection rejected" in env.store.get_issue("i1")["blocked_reason"]


def test_missing_routing_support_fails_closed_instead_of_using_runtime_default(tmp_path):
    env = routed_env(tmp_path)
    env.sched.available_models = None
    env.start()
    env.run_until(lambda: env.state("i1") == "Blocked")
    assert env.adapter.started == []


def test_unavailable_independent_deepseek_reviewer_does_not_share_the_implementer(tmp_path):
    env = routed_env(tmp_path, available=[FLASH, OPUS])
    env.start()
    env.run_until(lambda: env.state("i1") == "Blocked")
    assert not [a for a in env.store.list_attempts("i1") if a["role"] == "reviewer"]


@pytest.mark.parametrize("role", ["delegator", "analyst", "overseer"])
def test_escalation_roles_only_see_the_escalation_models(role):
    policy = plans.with_model_sources(plans.DEFAULT_POLICY, ["deepseek", "copilot"])
    policy["model_routing"] = ROUTING
    tiers = models.routed_tiers(policy, role)
    assert {m for band in tiers.values() for m in band} == set(ROUTING["escalation_models"])


def test_model_routing_is_part_of_the_approval_digest(tmp_path):
    env = routed_env(tmp_path)
    original = env.store.get_plan("fx")["plan"]
    changed = copy.deepcopy(original)
    changed["policy"]["model_routing"]["refiner"] = "claude-opus-4.8"
    assert plans.plan_digest(original) != plans.plan_digest(changed)


@pytest.mark.parametrize("key,value", [
    ("routine_models", [FLASH]),
    ("routine_models", [FLASH, "unapproved"]),
    ("refiner", FLASH),
    ("escalation_models", ["claude-sonnet-5"]),
])
def test_invalid_role_menus_are_rejected(tmp_path, key, value):
    env = routed_env(tmp_path)
    plan = copy.deepcopy(env.store.get_plan("fx")["plan"])
    plan["policy"]["model_routing"][key] = value
    assert any("model_routing" in error for error in plans.validate_plan(plan))


def test_plan_preparation_reads_role_routing_from_the_draft(tmp_path):
    env = routed_env(tmp_path)
    revised = dict(ROUTING, escalation_models=["claude-sonnet-5", OPUS])
    phases = tmp_path / "routed-phases.json"
    phases.write_text(json.dumps({
        "phases": env.store.get_plan("fx")["plan"]["phases"],
        "model_sources": ["deepseek", "copilot"], "model_routing": revised,
    }))
    result = cli.plan_command(env.store, REQ, str(phases), plan_id="fx", fixture=True)
    assert result["state"] == "Proposed" and not result["problems"]
    assert env.store.get_plan("fx")["plan"]["policy"]["model_routing"] == revised


def test_reimporting_completed_unchanged_work_preserves_all_evidence(tmp_path):
    store = make_plan(tmp_path)
    path = tmp_path / "issues.json"
    path.write_text(json.dumps([ISSUE]))
    runner.import_issues(store, "fx", None, str(path), "base1")
    for state in ("In Progress", "In Review", "Done"):
        store.transition("issue", "i1", state, "test")
    before = store.get_issue("i1")
    assert runner.import_issues(store, "fx", None, str(path), "base2") == []
    assert store.get_issue("i1") == before and store.state("issue", "i1") == "Done"
    path.write_text(json.dumps([dict(ISSUE, outcomes=["changed"])]))
    with pytest.raises(runner.RunRefused, match="has work recorded"):
        runner.import_issues(store, "fx", None, str(path), "base2")


def test_native_ci_can_wait_twenty_minutes_without_spending_repair_budget(tmp_path):
    from harness.github import GitHubError

    env = Env(tmp_path)
    env.publisher.merge_errors = [GitHubError('Required status check "lesen-native" is in progress.')] * 45
    env.start()
    env.run_until(lambda: env.state("i1") == "Done", limit=60, advance=30)
    issue = env.store.get_issue("i1")
    assert issue["repair_failures"] == 0 and not issue["last_failures"]
