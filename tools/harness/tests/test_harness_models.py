import pytest

from harness import models
from harness_doubles import Env

POLICY = {"low": ["claude-haiku-4.5"], "standard": ["claude-sonnet-5"], "strong": ["claude-opus-5", "claude-opus-4.8"]}
ALL = ["claude-haiku-4.5", "claude-sonnet-5", "claude-opus-5", "claude-opus-4.8"]


def test_default_tier_per_role():
    assert [models.choose_tier(r) for r in ("investigator", "refiner", "implementer", "reviewer", "integrator")] == \
        ["low", "low", "standard", "standard", "low"]


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
    assert attempts["implementer"]["tier"] == "standard" and attempts["implementer"]["model"] == "claude-sonnet-5"
    assert attempts["reviewer"]["model"] != attempts["implementer"]["model"] and attempts["reviewer"]["independent"] is True
    assert models.TIERS.index(attempts["reviewer"]["tier"]) >= models.TIERS.index("standard")


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
    assert [a["tier"] for a in impl] == ["standard", "strong"]


def test_infrastructure_retry_does_not_escalate(tmp_path):
    env = Env(tmp_path)
    env.adapter.script("i1", "implementer", "error:infra")
    env.start()
    env.run_until(lambda: env.state("i1") == "Done", advance=60)
    impl = [a for a in env.store.list_attempts("i1") if a["role"] == "implementer"]
    assert [a["tier"] for a in impl] == ["standard", "standard"]


def test_escalation_path_work_uses_strong(tmp_path):
    env = Env(tmp_path, issues=[])
    env.add_issue("sec", "P1", ["F1.1"], code_anchors=[".github/workflows/x.yml"])
    env.start()
    env.tick()
    assert env.store.get_attempt("sec#1")["tier"] == "strong"
    assert env.store.get_issue("sec")["strong_attempts"] == 1
