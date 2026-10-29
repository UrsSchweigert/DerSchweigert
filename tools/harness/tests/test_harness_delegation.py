import json
import os

import pytest

from harness import failures, humantasks, models, runner, schemas
from harness.adapter import WorkRequest, build_prompt
from harness_doubles import Env

NO_ANALYSIS = {"analyses_per_issue": 0}
NO_HELP = {"delegator_consults_per_issue": 0, "analyses_per_issue": 0}

RETRY_WITH_SONNET = {"action": "retry", "diagnosis": "The helper lives in the shared module.", "guidance": "Import the helper from src/shared.py.",
                     "model_choice": {"model": "claude-sonnet-5", "reason": "The dependency analysis needs a more capable model."}}


def implementers(env):
    return [a for a in env.store.list_attempts("i1") if a["role"] == "implementer"]


def consultations(env):
    return [a for a in env.store.list_attempts("i1") if a["role"] == "delegator"]


def packet_data(request):
    body = request.packet["untrusted_data"].split("\n", 1)[1].rsplit("\n", 1)[0]  # the harness fences worker-visible data
    return json.loads(body)


# -- the implementer's own report ------------------------------------------------------------------

def test_a_blocked_implementer_is_never_treated_as_done(tmp_path):
    env = Env(tmp_path, budgets=NO_HELP)
    env.adapter.script("i1", "implementer", "blocked")
    env.start()
    env.run_until(lambda: env.state("i1") == "Blocked")
    issue = env.store.get_issue("i1")
    attempt = implementers(env)[0]
    assert attempt["failure_kind"] == "worker_blocked" and attempt["failure_class"] == "reported" and attempt["outcome"] == "Failed"
    assert "does not exist anywhere" in issue["blocked_reason"] and issue["repair_failures"] == 0
    assert [t["kind"] for t in env.store.human_tasks("i1")] == ["decision"]
    assert not [a for a in env.store.list_attempts("i1") if a["role"] == "reviewer"] and issue["pr"] is None


def test_done_with_unresolved_blockers_counts_as_stuck(tmp_path):
    env = Env(tmp_path, budgets=NO_HELP)
    env.adapter.script("i1", "implementer", "done_with_blockers")
    env.start()
    env.run_until(lambda: env.state("i1") == "Blocked")
    assert implementers(env)[0]["failure_kind"] == "worker_blocked"
    assert env.checker.calls == []  # the work was never published or checked


def test_an_unknown_implementer_outcome_is_a_schema_failure(tmp_path):
    env = Env(tmp_path)
    env.adapter.script("i1", "implementer", "unknown_outcome")
    env.start()
    env.run_until(lambda: env.state("i1") == "Done")
    first = implementers(env)[0]
    assert first["failure_kind"] == "schema_invalid" and consultations(env) == []


def test_a_credential_in_a_stuck_report_is_withheld(tmp_path):
    env = Env(tmp_path, budgets=NO_HELP)
    original = env.adapter.poll

    def leaky(handle, now):
        polled = original(handle, now)
        if polled.result and handle.req.role == "implementer":
            polled.result["blockers"] = ["token ghp_" + "a" * 36 + " was rejected"]
            polled.result["outcome"] = "blocked"
        return polled

    env.adapter.poll = leaky
    env.start()
    env.run_until(lambda: env.state("i1") == "Blocked")
    assert "ghp_" not in json.dumps(env.store.get_issue("i1")) and "withheld" in env.store.get_issue("i1")["blocked_reason"]


# -- the delegator consultation ------------------------------------------------------------------------

def test_a_stuck_report_consults_the_delegator_who_picks_the_next_model_and_guidance(tmp_path):
    env = Env(tmp_path)
    env.adapter.script("i1", "implementer", "blocked", "ok")
    env.adapter.decisions["i1"] = [dict(RETRY_WITH_SONNET)]
    env.start()
    env.run_until(lambda: env.state("i1") == "Done")
    first, second = implementers(env)
    assert [first["model"], second["model"]] == ["claude-haiku-4.5", "claude-sonnet-5"]
    assert second["routing_source"] == "delegator" and "more capable model" in second["routing_note"]
    [consult] = consultations(env)
    assert consult["outcome"] == "Succeeded" and consult["decision"]["action"] == "retry" and consult["model"] == "claude-sonnet-5"
    data = packet_data(env.adapter.started[[r.role for r in env.adapter.started].index("implementer", 1)])
    assert data["delegator_guidance"] == ["Import the helper from src/shared.py."] and data["previous_failures"][0]["kind"] == "worker_blocked"
    issue = env.store.get_issue("i1")
    assert issue["repair_failures"] == 0 and issue["consult_pending"] is False and env.store.human_tasks("i1") == []


def test_the_implementer_does_not_restart_before_the_delegator_answers(tmp_path):
    env = Env(tmp_path)
    env.adapter.script("i1", "implementer", "blocked", "ok")
    env.adapter.script("i1", "delegator", "hang")
    env.start()
    env.run_until(lambda: any(r.role == "delegator" for r in env.adapter.started))
    for _ in range(5):
        env.tick()
    assert [r.role for r in env.adapter.started].count("implementer") == 1 and env.state("i1") == "Ready"


def test_the_delegator_is_given_the_stuck_report_history_and_model_menu(tmp_path):
    env = Env(tmp_path)
    env.adapter.script("i1", "implementer", "blocked", "ok")
    env.start()
    env.run_until(lambda: env.state("i1") == "Done")
    request = next(r for r in env.adapter.started if r.role == "delegator")
    data = packet_data(request)
    assert "does not exist anywhere" in data["stuck_report"] and request.tier == "standard"
    assert {o["model"] for o in data["model_options"]} == {"claude-haiku-4.5", "claude-sonnet-5", "claude-opus-5", "claude-opus-4.8"}
    assert data["strong_attempts_remaining"] == 1 and data["attempts"][0]["failure_kind"] == "worker_blocked"


def test_a_delegator_decision_without_a_model_keeps_the_current_one(tmp_path):
    env = Env(tmp_path)
    env.adapter.script("i1", "implementer", "blocked", "ok")
    env.start()
    env.run_until(lambda: env.state("i1") == "Done")
    assert [a["model"] for a in implementers(env)] == ["claude-haiku-4.5", "claude-haiku-4.5"]


def test_the_delegator_can_hand_the_question_to_the_owner(tmp_path):
    env = Env(tmp_path, budgets=NO_ANALYSIS)
    env.adapter.script("i1", "implementer", "blocked")
    env.adapter.decisions["i1"] = [{"action": "ask_owner", "diagnosis": "The task needs a helper that no issue creates. Split it into two issues."}]
    env.start()
    env.run_until(lambda: env.state("i1") == "Blocked")
    assert len(implementers(env)) == 1
    [task] = env.store.human_tasks("i1")
    assert "delegating agent asks for your decision" in task["payload"]["extra"]["reason"] and "Split it into two issues" in task["payload"]["extra"]["reason"]
    assert any(e["kind"] == "delegator_escalation" for e in task["payload"]["extra"]["evidence"])
    assert env.store.get_issue("i1")["consult_pending"] is False


def test_a_second_stuck_report_goes_to_the_owner_not_back_to_the_delegator(tmp_path):
    env = Env(tmp_path, budgets=NO_ANALYSIS)
    env.adapter.script("i1", "implementer", "blocked", "blocked")
    env.start()
    env.run_until(lambda: env.state("i1") == "Blocked")
    assert len(consultations(env)) == 1 and len(implementers(env)) == 2
    assert [t["kind"] for t in env.store.human_tasks("i1")] == ["decision"]


@pytest.mark.parametrize("decision, used, message", [
    (dict(RETRY_WITH_SONNET, model_choice={"model": "unapproved-model", "reason": "Cheap."}), 0, "configured"),
    (dict(RETRY_WITH_SONNET, model_choice={"model": "claude-opus-5", "reason": "Hard."}), 1, "budget"),
    (dict(RETRY_WITH_SONNET, model_choice={"model": "claude-sonnet-5", "reason": " "}), 0, "reason"),
    (dict(RETRY_WITH_SONNET, diagnosis="  "), 0, "diagnosis"),
    (dict(RETRY_WITH_SONNET, guidance="use ghp_" + "b" * 36), 0, "credential"),
    ({"action": "ask_owner", "diagnosis": "d", "model_choice": RETRY_WITH_SONNET["model_choice"]}, 0, "only applies to a retry"),
])
def test_an_unusable_delegator_decision_asks_the_owner_and_spends_no_repair_budget(tmp_path, decision, used, message):
    env = Env(tmp_path)
    issue = env.store.get_issue("i1")
    issue["strong_attempts"] = used
    env.store.put_issue(issue)
    env.adapter.script("i1", "implementer", "blocked")
    env.adapter.decisions["i1"] = [decision]
    env.start()
    env.run_until(lambda: env.state("i1") == "Blocked")
    [consult] = consultations(env)
    assert consult["failure_kind"] == "schema_invalid" and message in consult["detail"]
    issue = env.store.get_issue("i1")
    assert issue["repair_failures"] == 0 and issue["consult_pending"] is False and len(implementers(env)) == 1
    assert [t["kind"] for t in env.store.human_tasks("i1")] == ["decision"]


def test_a_delegator_that_returns_no_decision_asks_the_owner(tmp_path):
    env = Env(tmp_path)
    env.adapter.script("i1", "implementer", "blocked")
    env.adapter.script("i1", "delegator", "bad_schema")
    env.start()
    env.run_until(lambda: env.state("i1") == "Blocked")
    assert consultations(env)[0]["failure_class"] == "deterministic" and env.store.get_issue("i1")["repair_failures"] == 0


def test_a_transient_delegator_failure_is_retried(tmp_path):
    env = Env(tmp_path)
    env.adapter.script("i1", "implementer", "blocked", "ok")
    env.adapter.script("i1", "delegator", "error:infra", "ok")
    env.start()
    env.run_until(lambda: env.state("i1") == "Done", advance=60)
    assert [a["outcome"] for a in consultations(env)] == ["Failed", "Succeeded"]


def test_a_plan_without_a_consultation_budget_sends_stuck_reports_to_the_owner(tmp_path):
    budgets = {"repair_attempts": 2, "transient_retries": 3}
    assert failures.decide("reported", {}, budgets, 0.0) == {"action": "block", "reason": "the worker reported it cannot solve the task"}
    issue = {}
    assert failures.decide("reported", issue, dict(budgets, delegator_consults_per_issue=1), 0.0) == {"action": "consult"}
    assert issue == {"consults": 1, "consult_pending": True}
    assert failures.decide("reported", issue, dict(budgets, delegator_consults_per_issue=1), 0.0)["action"] == "block"


def test_the_owner_can_still_retry_after_a_stuck_report(tmp_path):
    env = Env(tmp_path, budgets=NO_HELP)
    env.adapter.script("i1", "implementer", "blocked", "ok")
    env.start()
    env.run_until(lambda: env.state("i1") == "Blocked")
    [task] = env.store.human_tasks("i1")
    humantasks.respond(env.store, task["task_id"], responder_ids=["owner"], source="local", answers={"option": "retry as is"}, now=env.clock())
    env.run_until(lambda: env.state("i1") == "Done")


# -- contracts ------------------------------------------------------------------------------------------------

def test_failure_kind_and_default_tier():
    assert failures.classify("worker_blocked") == "reported" and models.choose_tier("delegator") == "standard"


def test_prompts_tell_each_role_how_to_report():
    implementer = build_prompt(WorkRequest("a#1", 1, "i", "implementer", "low", None, {}, "b"))
    assert '"done" or "blocked"' in implementer and "cannot complete" in implementer
    delegator = build_prompt(WorkRequest("a#2", 1, "i", "delegator", "standard", None, {}, "b"))
    assert '"retry" or "ask_owner"' in delegator and '"decision"' in delegator and "model_options" in delegator and "Change no files" in delegator


def test_worker_results_accept_only_well_formed_decisions():
    base = {"attempt_id": "a", "epoch": 1, "outcome": "done", "changed_files": [], "revision": "", "checks": [], "risks": [], "blockers": [], "next_action": ""}
    schemas.validate(dict(base, decision=RETRY_WITH_SONNET), schemas.WORKER_RESULT)
    for bad in ({"action": "merge", "diagnosis": "x"}, {"action": "retry"}, {"action": "retry", "diagnosis": "x", "extra": 1}):
        with pytest.raises(schemas.SchemaError):
            schemas.validate(dict(base, decision=bad), schemas.WORKER_RESULT)


def test_a_delegator_retry_that_matches_the_chosen_reviewer_reroutes_the_review(tmp_path):
    env = Env(tmp_path)
    issue = env.store.get_issue("i1")
    issue["model_choices"] = {
        "implementer": {"model": "claude-haiku-4.5", "reason": "A bounded change with strong test coverage."},
        "reviewer": {"model": "claude-sonnet-5", "reason": "One standard-tier model is enough for this diff."},
    }
    env.store.put_issue(issue)
    env.adapter.script("i1", "implementer", "blocked", "ok")
    env.adapter.decisions["i1"] = [dict(RETRY_WITH_SONNET)]
    env.start()
    env.run_until(lambda: env.state("i1") == "Done")
    implementations = [a for a in env.store.list_attempts("i1") if a["role"] == "implementer"]
    review = next(a for a in env.store.list_attempts("i1") if a["role"] == "reviewer")
    assert [a["model"] for a in implementations] == ["claude-haiku-4.5", "claude-sonnet-5"]
    assert review["model"] != "claude-sonnet-5" and review["independent"] is True
    assert "claude-sonnet-5" in review["routing_note"]
