import pytest

from harness import models
from harness_doubles import Env

POLICY = {"low": ["claude-haiku-4.5"], "standard": ["claude-sonnet-5"], "strong": ["claude-opus-5", "claude-opus-4.8"]}
ALL = ["claude-haiku-4.5", "claude-sonnet-5", "claude-opus-5", "claude-opus-4.8"]


def test_delegator_selects_a_concrete_model_with_a_cost_quality_reason():
    choice = {"model": "claude-opus-4.8", "reason": "Cross-module correctness needs deeper reasoning before implementation."}
    route = models.resolve_choice(choice, POLICY, ALL)
    assert route["model"] == "claude-opus-4.8" and route["tier"] == "strong"
    assert route["routing"] is True and choice["reason"] in route["note"]


@pytest.mark.parametrize("choice, available, message", [
    ({"model": "unapproved-model", "reason": "Cheap"}, ALL, "configured"),
    ({"model": "claude-haiku-4.5", "reason": "Cheap"}, ["claude-sonnet-5"], "available"),
    ({"model": "claude-haiku-4.5", "reason": "  "}, ALL, "reason"),
])
def test_delegator_cannot_choose_an_unusable_model(choice, available, message):
    with pytest.raises(ValueError, match=message):
        models.resolve_choice(choice, POLICY, available)


def test_delegator_cannot_bypass_the_strong_attempt_budget():
    choice = {"model": "claude-opus-5", "reason": "Difficult repair"}
    with pytest.raises(ValueError, match="budget"):
        models.resolve_choice(choice, POLICY, ALL, strong_used=1, strong_budget=1)


def test_delegator_can_choose_a_cheaper_independent_reviewer():
    choice = {"model": "claude-haiku-4.5", "reason": "Small, test-covered diff needs only a focused review."}
    assert models.resolve_choice(choice, POLICY, ALL, avoid="claude-sonnet-5")["model"] == "claude-haiku-4.5"
    with pytest.raises(ValueError, match="independent"):
        models.resolve_choice(choice, POLICY, ALL, avoid="claude-haiku-4.5")


def test_default_tier_per_role():
    # The refiner is a judgement role: a cheap model there returns malformed results and costs a repair attempt.
    assert [models.choose_tier(r) for r in ("investigator", "refiner", "implementer", "reviewer", "integrator")] == \
        ["low", "strong", "low", "standard", "low"]


def test_a_cheap_refiner_choice_is_upgraded_to_the_strong_tier():
    choice = {"model": "claude-haiku-4.5", "reason": "Bounded re-check with one concrete anchor."}
    route = models.resolve_choice(choice, POLICY, ALL, role="refiner")
    assert route["tier"] == "strong" and route["model"] in POLICY["strong"]
    assert "upgraded from claude-haiku-4.5" in route["note"]
    # The same choice stays cheap for a role without a required tier.
    assert models.resolve_choice(choice, POLICY, ALL, role="implementer")["tier"] == "low"


def test_a_strong_refiner_choice_is_kept():
    choice = {"model": "claude-opus-4.8", "reason": "Interacting components must be re-derived."}
    route = models.resolve_choice(choice, POLICY, ALL, role="refiner")
    assert route["model"] == "claude-opus-4.8" and "upgraded" not in route["note"]


def test_a_refiner_falls_back_when_no_strong_model_is_available():
    choice = {"model": "claude-haiku-4.5", "reason": "Bounded re-check."}
    route = models.resolve_choice(choice, POLICY, ["claude-haiku-4.5"], role="refiner")
    assert route["model"] == "claude-haiku-4.5" and "none is available" in route["note"]


def test_the_plan_check_accepts_a_cheap_refiner_because_dispatch_upgrades_it():
    choices = {"implementer": {"model": "claude-haiku-4.5", "reason": "Mechanical edit."},
               "reviewer": {"model": "claude-sonnet-5", "reason": "Independent review."},
               "refiner": {"model": "claude-haiku-4.5", "reason": "Bounded re-check."}}
    models.validate_choices(choices, POLICY, ALL, require=True)


def test_escalation_only_on_evidence():
    assert models.choose_tier("implementer", previous_tier="standard", previous_failure_kind="infra") == "standard"
    assert models.choose_tier("implementer", previous_tier="standard", previous_failure_kind="timeout") == "standard"
    assert models.choose_tier("implementer", previous_tier="standard", previous_failure_kind="checks_failed") == "strong"
    assert models.choose_tier("implementer", previous_tier="low", previous_failure_kind="review_findings") == "standard"


def test_strong_budget_caps_escalation():
    assert models.choose_tier("implementer", previous_tier="standard", previous_failure_kind="checks_failed", strong_used=1, strong_budget=1) == "standard"
    assert models.choose_tier("implementer", touches_escalation_path=True, strong_used=0) == "strong"
    assert models.choose_tier("implementer", touches_escalation_path=True, strong_used=1) == "standard"


def test_agent_requests_for_stronger_models_need_grounds():
    kw = dict(touches_escalation_path=False, strong_used=0, strong_budget=1)
    assert models.accept_tier_request("strong", "standard", previous_failure_kind=None, **kw) == "standard"
    assert models.accept_tier_request("strong", "standard", previous_failure_kind="checks_failed", **kw) == "strong"
    assert models.accept_tier_request("strong", "low", previous_failure_kind="checks_failed", **kw) == "standard"
    assert models.accept_tier_request("strong", "standard", previous_failure_kind="checks_failed", touches_escalation_path=False, strong_used=1, strong_budget=1) == "standard"
    assert models.accept_tier_request("low", "standard", previous_failure_kind="checks_failed", **kw) == "standard"


def test_reviewer_never_below_implementer_tier():
    assert models.choose_tier("reviewer", implementer_tier="strong") == "strong"
    assert models.choose_tier("reviewer", implementer_tier="low") == "standard"


def test_reviewer_uses_a_different_model_when_available():
    impl = models.resolve_model("standard", POLICY, ALL)
    rev = models.resolve_model("standard", POLICY, ALL, avoid=impl["model"])
    assert impl["model"] == "claude-sonnet-5" and rev["model"] != impl["model"] and rev["tier"] == "strong"
    assert "higher tier" in rev["note"]


def test_reviewer_shares_model_only_when_nothing_else_exists():
    rev = models.resolve_model("standard", POLICY, ["claude-sonnet-5"], avoid="claude-sonnet-5")
    assert rev["model"] == "claude-sonnet-5" and "shares" in rev["note"]


def test_unavailable_configured_model_moves_up_and_says_so():
    res = models.resolve_model("low", POLICY, ["claude-sonnet-5"])
    assert res["model"] == "claude-sonnet-5" and res["tier"] == "standard" and res["note"]


def test_no_routing_fallback_is_reported_not_pretended():
    res = models.resolve_model("standard", POLICY, None)
    assert res["model"] is None and res["routing"] is False and "routing unavailable" in res["note"]


def test_scheduler_applies_tiers_and_records_them(tmp_path):
    env = Env(tmp_path)
    env.start()
    env.run_until(lambda: env.state("i1") == "Done")
    attempts = {a["role"]: a for a in env.store.list_attempts("i1")}
    assert attempts["implementer"]["tier"] == "low" and attempts["implementer"]["model"] == "claude-haiku-4.5"
    assert attempts["reviewer"]["tier"] == "standard" and attempts["reviewer"]["model"] == "claude-sonnet-5"
    assert attempts["reviewer"]["independent"] is True


def test_scheduler_uses_task_specific_models_instead_of_role_tiers(tmp_path):
    env = Env(tmp_path)
    issue = env.store.get_issue("i1")
    issue["model_choices"] = {
        "implementer": {"model": "claude-sonnet-5", "reason": "Interacting requirements justify a more capable implementation model."},
        "reviewer": {"model": "claude-haiku-4.5", "reason": "A small diff with reliable tests permits an inexpensive review."},
    }
    env.store.put_issue(issue)
    env.start()
    env.run_until(lambda: env.state("i1") == "Done")
    attempts = {attempt["role"]: attempt for attempt in env.store.list_attempts("i1")}
    assert attempts["implementer"]["model"] == "claude-sonnet-5"
    assert attempts["reviewer"]["model"] == "claude-haiku-4.5"
    assert attempts["reviewer"]["independent"] is True
    for role, choice in issue["model_choices"].items():  # the refiner plans, it is not a delegated choice
        assert attempts[role]["routing_source"] == "delegator"
        assert choice["reason"] in attempts[role]["routing_note"]


@pytest.mark.parametrize("model, available, used, message", [
    ("unapproved-model", ALL, 0, "configured"),
    ("claude-haiku-4.5", ["claude-sonnet-5"], 0, "available"),
    ("claude-opus-5", ALL, 2, "budget"),  # the default strong budget is two attempts
])
def test_scheduler_blocks_invalid_delegation_before_starting_a_worker(tmp_path, model, available, used, message):
    env = Env(tmp_path, available_models=available)
    issue = env.store.get_issue("i1")
    issue["model_choices"] = {"implementer": {"model": model, "reason": "Task-specific cost and quality decision."}}
    issue["strong_attempts"] = used
    env.store.put_issue(issue)
    env.start()
    env.tick()
    assert env.store.list_attempts("i1") == []
    assert message in env.store.get_issue("i1")["blocked_reason"]


def test_delegated_choices_keep_evidence_based_repairs_and_independent_review(tmp_path):
    env = Env(tmp_path)
    issue = env.store.get_issue("i1")
    issue["model_choices"] = {
        "implementer": {"model": "claude-haiku-4.5", "reason": "A bounded change with strong test coverage."},
        "reviewer": {"model": "claude-sonnet-5", "reason": "Independent review of the implementation."},
    }
    env.store.put_issue(issue)
    env.checker.fail_next = 1
    env.start()
    env.run_until(lambda: env.state("i1") == "Done")
    attempts = env.store.list_attempts("i1")
    implementations = [attempt for attempt in attempts if attempt["role"] == "implementer"]
    assert [attempt["model"] for attempt in implementations] == ["claude-haiku-4.5", "claude-sonnet-5"]
    assert implementations[-1]["routing_source"] == "evidence"
    review = next(attempt for attempt in attempts if attempt["role"] == "reviewer")
    assert review["model"] != implementations[-1]["model"] and review["independent"] is True


def test_infrastructure_retry_keeps_a_previous_evidence_based_upgrade(tmp_path):
    env = Env(tmp_path)
    issue = env.store.get_issue("i1")
    issue["model_choices"] = {"implementer": {"model": "claude-haiku-4.5", "reason": "Initially a small, well-tested change."}}
    env.store.put_issue(issue)
    env.adapter.script("i1", "implementer", "ok", "error:infra", "ok")
    env.checker.fail_next = 1
    env.start()
    env.run_until(lambda: env.state("i1") == "Done", advance=60)
    implementations = [attempt for attempt in env.store.list_attempts("i1") if attempt["role"] == "implementer"]
    assert [attempt["model"] for attempt in implementations] == ["claude-haiku-4.5", "claude-sonnet-5", "claude-sonnet-5"]


def test_scheduler_without_model_routing_reports_it(tmp_path):
    env = Env(tmp_path, available_models=None)
    env.start()
    env.run_until(lambda: env.state("i1") == "Done")
    for a in env.store.list_attempts("i1"):
        assert a["routing"] is False and a["model"] is None and "routing unavailable" in a["routing_note"]
        if a["role"] == "reviewer":
            assert a["independent"] is False


def test_failed_checks_escalate_the_repair_attempt_on_evidence_only(tmp_path):
    env = Env(tmp_path)
    env.checker.fail_next = 1
    env.start()
    env.run_until(lambda: env.state("i1") == "Done")
    impl = [a for a in env.store.list_attempts("i1") if a["role"] == "implementer"]
    assert [a["tier"] for a in impl] == ["low", "standard"]  # haiku first, then sonnet because the checks failed
    review = next(a for a in env.store.list_attempts("i1") if a["role"] == "reviewer")
    assert review["model"] != impl[-1]["model"] and models.TIERS.index(review["tier"]) >= models.TIERS.index("standard")  # independent, never below the implementer


def test_infrastructure_retry_does_not_escalate(tmp_path):
    env = Env(tmp_path)
    env.adapter.script("i1", "implementer", "error:infra")
    env.start()
    env.run_until(lambda: env.state("i1") == "Done", advance=60)
    impl = [a for a in env.store.list_attempts("i1") if a["role"] == "implementer"]
    assert [a["tier"] for a in impl] == ["low", "low"]


def test_escalation_path_work_uses_strong(tmp_path):
    env = Env(tmp_path, issues=[])
    env.add_issue("sec", "P1", ["F1.1"], code_anchors=[".github/workflows/x.yml"])
    env.start()
    env.tick()
    assert env.store.get_attempt("sec#1")["tier"] == "strong"
    assert env.store.get_issue("sec")["strong_attempts"] == 1
