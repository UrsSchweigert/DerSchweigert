"""A plan that needs files outside the phase scope is turned back before an implementer is paid for."""
from harness import broker
from test_harness_plan_prerequisites import refining_env, run_refinement, roles


def test_planned_out_of_scope_reads_both_path_forms():
    assert broker.planned_out_of_scope(["static/a.mjs", "../x.md"], ["sites/lesen/"], "sites/lesen") == ["../x.md"]
    assert broker.planned_out_of_scope(["sites/lesen/a.mjs"], ["sites/lesen/"], "sites/lesen") == []
    assert broker.planned_out_of_scope([], ["src/"]) == []


def test_a_plan_outside_the_scope_is_rejected_once_with_the_reason_and_costs_no_implementer(tmp_path):
    env = refining_env(tmp_path, working_directory="sites/lesen")
    run_refinement(env, plan=["x"], plan_files=["static/a.mjs", "../../docs/outside.md"])
    assert "implementer" not in roles(env)
    issue = env.store.get_issue("i1")
    failure = [f for f in issue["last_failures"] if f["kind"] == "plan_out_of_scope"]
    assert failure and "outside.md" in failure[0]["detail"] or "docs/outside.md" in failure[0]["detail"]


def test_a_plan_inside_the_scope_is_unaffected(tmp_path):
    env = refining_env(tmp_path, working_directory="sites/lesen")
    run_refinement(env, plan=["x"], plan_files=["static/a.mjs"])
    assert env.state("i1") == "In Progress" or env.state("i1") == "Ready"


def test_capability_lint_flags_unavailable_asks_and_allows_negations():
    from harness import plans
    pol = {"art": None}
    bad = {"issue_id": "a", "title": "t", "acceptance_criteria": ["Run a manual test of the menu."]}
    ok = {"issue_id": "b", "title": "t", "acceptance_criteria": ["No manual test and no asset request is needed."]}
    assert plans.capability_problems(bad, pol) and not plans.capability_problems(ok, pol)
    art = {"issue_id": "c", "title": "t", "description": "Use art-generate for the sheet."}
    assert plans.capability_problems(art, pol) and not plans.capability_problems(art, {"art": {"generator": "g", "credits": 1}})
