"""The refiner plans the work before a paid implementer is dispatched. Tiers, never model ids, decide the routing."""
from harness import models, plans
from harness_doubles import Env


DEEPSEEK = ["deepseek/deepseek-flash", "deepseek/deepseek-v4-pro"]


def starts(env, role):
    return [req for req in env.adapter.started if req.role == role]


def test_the_tiers_follow_the_chosen_source_instead_of_the_catalog_defaults():
    deepseek = plans.with_model_sources(plans.DEFAULT_POLICY, ["deepseek"])
    assert {model for tier in models.TIERS for model in deepseek["model_tiers"][tier]} == set(DEEPSEEK)
    copilot = plans.with_model_sources(plans.DEFAULT_POLICY, ["copilot"])
    assert not set(DEEPSEEK) & {model for tier in models.TIERS for model in copilot["model_tiers"][tier]}


def test_a_task_for_the_cheap_tier_is_not_planned_first(tmp_path):
    env = Env(tmp_path)
    issue = env.store.get_issue("i1")
    issue["model_choices"] = {"implementer": {"model": "claude-haiku-4.5", "reason": "A mechanical edit with strong tests."}}
    env.store.put_issue(issue)
    env.start()
    env.run_until(lambda: env.state("i1") == "Done")
    implemented = starts(env, "implementer")
    assert implemented and implemented[0].tier == "low"
    assert not any(e["event"] == "plan_requested" for e in env.sched.events)


def test_a_paid_task_is_planned_first_and_the_plan_lowers_the_implementer(tmp_path):
    env = Env(tmp_path)
    issue = env.store.get_issue("i1")
    issue["model_choices"] = {"implementer": {"model": "claude-sonnet-5", "reason": "Two files interact."}}
    env.store.put_issue(issue)
    env.adapter.plans["i1"] = {"plan": ["edit src/a.py: read the flag once", "edit src/b.py: use that flag"], "tier_fit": "low"}
    env.start()
    events = env.run_until(lambda: env.state("i1") == "Done")

    assert starts(env, "refiner"), "the plan pass must run before the implementer"
    implemented = starts(env, "implementer")[0]
    assert implemented.tier == "low"  # the plan fits the cheap tier, so the paid one is not spent
    assert "edit src/b.py: use that flag" in implemented.packet["untrusted_data"]
    assert any(e["event"] == "tier_lowered_by_plan" for e in events)
    assert env.store.get_issue("i1")["planned"] is True


def test_the_plan_pass_runs_once_even_when_the_refiner_writes_no_steps(tmp_path):
    env = Env(tmp_path)
    issue = env.store.get_issue("i1")
    issue["model_choices"] = {"implementer": {"model": "claude-sonnet-5", "reason": "Two files interact."}}
    env.store.put_issue(issue)
    env.start()
    env.run_until(lambda: env.state("i1") == "Done")
    assert len(starts(env, "refiner")) == 1
    assert starts(env, "implementer")[0].tier == "standard"


def test_a_task_that_does_not_fit_one_implementer_goes_to_the_strong_analysis(tmp_path):
    """Sizing work down is an analysis: the strong model proposes the smaller tasks, not the owner."""
    env = Env(tmp_path)
    issue = env.store.get_issue("i1")
    issue["model_choices"] = {"implementer": {"model": "claude-opus-5", "reason": "Looks large."}}
    env.store.put_issue(issue)
    env.adapter.plans["i1"] = {"split_advice": "the stylesheet work and the markup work are independent"}
    part = lambda iid, req, anchor, outcome: {"issue_id": iid, "title": iid, "requirement_ids": [req], "outcomes": [outcome],
                                              "acceptance_criteria": ["the check passes"], "non_goals": ["nothing else"],
                                              "code_anchors": [anchor]}
    env.adapter.analyses["i1"] = [{"root_cause": "Two independent areas are bundled.", "recommendation": "split",
                                   "split": [part("i1-a", "F1.1", "src/a.py", "the theme is one"),
                                             part("i1-b", "F1.2", "src/b.py", "one radio group")]}]
    env.start()
    events = [e for _ in range(6) for e in env.tick()]

    assert not starts(env, "implementer")
    assert any(e["event"] == "split_advised" for e in events)
    assert starts(env, "analyst") and starts(env, "analyst")[0].tier == "strong"
    issue = env.store.get_issue("i1")
    assert [p["issue_id"] for p in issue["proposed_split"]] == ["i1-a", "i1-b"]  # the smaller tasks, ready to apply


def test_planning_and_routing_stay_inside_the_deepseek_source(tmp_path):
    env = Env(tmp_path, model_sources=["deepseek"], available_models=DEEPSEEK)
    issue = env.store.get_issue("i1")
    issue["model_choices"] = {"implementer": {"model": "deepseek/deepseek-v4-pro", "reason": "The task needs the strongest planning."}}
    env.store.put_issue(issue)
    env.adapter.plans["i1"] = {"plan": ["edit src/a.py: one change"], "tier_fit": "standard"}
    env.start()
    env.run_until(lambda: env.state("i1") == "Done")

    used = {req.model for req in env.adapter.started}
    assert used and all(model in DEEPSEEK for model in used), used
    assert starts(env, "implementer")[0].model == "deepseek/deepseek-flash"


def test_a_failed_plan_tier_still_escalates_on_evidence(tmp_path):
    """The plan decides the first attempt. Once checks fail, evidence owns the tier again."""
    env = Env(tmp_path, budgets=dict(lease_s=10**7, run_wall_clock_s=10**8, worker_timeout_s=10**7, inactivity_timeout_s=10**7))
    issue = env.store.get_issue("i1")
    issue["model_choices"] = {"implementer": {"model": "claude-sonnet-5", "reason": "Two files interact."}}
    env.store.put_issue(issue)
    env.adapter.plans["i1"] = {"plan": ["edit src/a.py: one change"], "tier_fit": "low"}
    env.checker.fail_next = 1
    env.start()
    env.run_until(lambda: env.state("i1") == "Done")

    tiers = [req.tier for req in starts(env, "implementer")]
    assert tiers[0] == "low" and tiers[1] == "standard", tiers
