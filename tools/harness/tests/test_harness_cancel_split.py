import json
import os

import pytest

from harness import humantasks, runner, status
from harness.scheduler import new_issue
from harness_doubles import Env

NO_HELP = {"delegator_consults_per_issue": 0, "analyses_per_issue": 0}
APPLY = "apply the proposed split"


def part(issue_id, reqs, **changes):
    doc = {"issue_id": issue_id, "requirement_ids": reqs, "title": "Part " + issue_id, "outcomes": ["o"], "acceptance_criteria": ["a"], "non_goals": [],
           "code_anchors": ["src/%s.py" % issue_id], "contract_paths": [], "deps": [], "validation_commands": [], "parallel_safe": False}
    return dict(doc, **changes)


SPLIT = {"root_cause": "The task spans a data model and a view that cannot be built in one session.", "recommendation": "split",
         "split": [part("i1-model", ["F1.1"]), part("i1-view", ["F1.2"], deps=["i1-model"])]}


def respond(env, option, **answers):
    [task] = [t for t in env.store.human_tasks("i1") if t["state"] in humantasks.OPEN_STATES]
    return humantasks.respond(env.store, task["task_id"], responder_ids=["owner"], source="local", now=env.clock(), answers=dict(answers, option=option))


def block_then_cancel(env, iid="i1"):
    env.adapter.script(iid, "implementer", "blocked")
    env.start()
    env.run_until(lambda: env.state(iid) == "Blocked", advance=60)
    [task] = [t for t in env.store.human_tasks(iid) if t["state"] in humantasks.OPEN_STATES]
    humantasks.respond(env.store, task["task_id"], responder_ids=["owner"], source="local", now=env.clock(), answers={"option": "cancel the issue"})


def escalate_with_split(env, analysis=SPLIT):
    env.adapter.script("i1", "implementer", "blocked")
    env.adapter.decisions["i1"] = [{"action": "ask_owner", "diagnosis": "This is too large for one session."}]
    env.adapter.analyses["i1"] = [analysis]
    env.start()
    env.run_until(lambda: env.state("i1") == "Blocked", advance=60)


# -- cancelling ------------------------------------------------------------------------------------------

def test_a_cancelled_issue_is_terminal_and_drops_the_work_that_depends_on_it(tmp_path):
    env = Env(tmp_path, issues=[("a", "P1", ["F1.1"])], budgets=NO_HELP)
    env.add_issue("b", "P1", ["F1.2"], deps=["a"])
    env.add_issue("c", "P2", ["F2.1"], deps=["b"])
    env.adapter.script("a", "implementer", "blocked")
    env.start()
    env.run_until(lambda: env.state("a") == "Blocked", advance=60)
    [task] = env.store.human_tasks("a")
    result = humantasks.respond(env.store, task["task_id"], responder_ids=["owner"], source="local", now=env.clock(), answers={"option": "cancel the issue"})
    assert result["status"] == "resolved"
    assert [env.state(i) for i in "abc"] == ["Cancelled"] * 3
    assert "depends on cancelled issue a" in env.store.get_issue("b")["blocked_reason"] and "depends on cancelled issue b" in env.store.get_issue("c")["blocked_reason"]
    assert all(env.store.get_issue(i)["cancelled"] is True for i in "abc")
    assert env.store.human_tasks("b") == [] and env.store.human_tasks("c") == []


def test_cancelling_leaves_unrelated_work_alone(tmp_path):
    env = Env(tmp_path, issues=[("a", "P1", ["F1.1"]), ("other", "P1", ["F1.2"])], budgets=NO_HELP)
    env.adapter.script("a", "implementer", "blocked")
    env.start()
    env.run_until(lambda: env.state("a") == "Blocked" and env.state("other") == "Done", advance=60)
    [task] = env.store.human_tasks("a")
    humantasks.respond(env.store, task["task_id"], responder_ids=["owner"], source="local", now=env.clock(), answers={"option": "cancel the issue"})
    assert env.state("a") == "Cancelled" and env.state("other") == "Done"


def test_a_phase_that_cannot_complete_pauses_the_plan_and_says_why(tmp_path):
    env = Env(tmp_path, issues=[("i1", "P1", ["F1.1", "F1.2"]), ("i2", "P2", ["F2.1"])], budgets=NO_HELP)
    block_then_cancel(env)
    events = []
    for _ in range(3):
        events += env.tick(60)
    assert env.store.state("plan", "fx@v1") == "Paused" and env.store.state("phase", "fx@v1/P1") == "Active"
    reason = env.store.get_run("fx")["paused_reason"]
    assert "phase P1 cannot complete" in reason and "F1.1, F1.2" in reason and "resume" in reason
    assert any(e["event"] == "phase_stalled" and e["gaps"] == ["F1.1", "F1.2"] for e in events)
    assert env.store.state("phase", "fx@v1/P2") in (None, "Planned") and env.state("i2") == "Ready"
    assert env.tick(60) == []  # a paused plan stays quiet instead of re-validating every pass


def test_importing_replacement_issues_and_resuming_finishes_the_plan(tmp_path):
    env = Env(tmp_path, issues=[("i1", "P1", ["F1.1", "F1.2"]), ("i2", "P2", ["F2.1"])], budgets=NO_HELP)
    block_then_cancel(env)
    for _ in range(2):
        env.tick(60)
    assert env.store.state("plan", "fx@v1") == "Paused"
    replacement = tmp_path / "replacement.json"
    replacement.write_text(json.dumps({"issues": [dict(part("r1", ["F1.1", "F1.2"]), phase_id="P1")]}))
    assert runner.import_issues(env.store, "fx", None, str(replacement), env.repo.base_head()) == ["r1"]
    env.start()
    env.run_until(lambda: env.store.state("plan", "fx@v1") == "Completed", advance=60)
    assert env.state("r1") == "Done" and env.state("i2") == "Done" and env.state("i1") == "Cancelled"


def test_a_cancel_recorded_before_issues_became_terminal_is_settled(tmp_path):
    env = Env(tmp_path, issues=[("a", "P1", ["F1.1"])], budgets=NO_HELP)
    env.add_issue("b", "P1", ["F1.2"], deps=["a"])
    env.store.transition("issue", "a", "Blocked", "setup")
    legacy = env.store.get_issue("a")
    legacy["cancelled"] = True
    env.store.put_issue(legacy)
    env.start()
    env.tick()
    assert env.state("a") == "Cancelled" and env.state("b") == "Cancelled"


def test_cancelled_work_shows_in_the_status_report(tmp_path):
    env = Env(tmp_path, issues=[("i1", "P1", ["F1.1", "F1.2"]), ("i2", "P2", ["F2.1"])], budgets=NO_HELP)
    block_then_cancel(env)
    env.tick(60)
    report = status.build_report(env.store.home, env.clock())
    assert report["phases"][0]["issues"] == {"Cancelled": 1} and report["plans"][0]["state"] == "Paused" and "F1.1" in report["plans"][0]["paused_reason"]


def test_cancelling_also_cancels_the_open_task_of_a_dependent(tmp_path):
    env = Env(tmp_path, issues=[("a", "P1", ["F1.1"])], budgets=NO_HELP)
    env.add_issue("b", "P1", ["F1.2"], deps=["a"])
    humantasks.request_task(env.store, task_id="t-b", kind="decision", issue_ids=["b"], owner="owner", why="w", request="r", now=env.clock(),
                            response_format={"required": ["option"]}, resolution_criteria="c", options=humantasks.DECISION_OPTIONS)
    assert env.state("b") == "Blocked"
    env.adapter.script("a", "implementer", "blocked")
    env.start()
    env.run_until(lambda: env.state("a") == "Blocked", advance=60)
    [task] = [t for t in env.store.human_tasks("a") if t["state"] in humantasks.OPEN_STATES]
    humantasks.respond(env.store, task["task_id"], responder_ids=["owner"], source="local", now=env.clock(), answers={"option": "cancel the issue"})
    assert env.state("b") == "Cancelled" and env.store.get_human_task("t-b")["state"] == "Cancelled"


# -- applying a proposed split ---------------------------------------------------------------------------------

def task_options(env):
    [task] = [t for t in env.store.human_tasks("i1") if t["state"] in humantasks.OPEN_STATES]
    return task["payload"]["options"]


def test_the_split_is_offered_only_when_the_analysis_proposes_one(tmp_path):
    env = Env(tmp_path)
    escalate_with_split(env)
    assert task_options(env)[-1] == APPLY and task_options(env)[:-1] == humantasks.DECISION_OPTIONS
    other_dir = tmp_path / "other"
    other_dir.mkdir()
    other = Env(other_dir)
    escalate_with_split(other, {"root_cause": "The spec contradicts itself.", "recommendation": "needs_owner"})
    assert APPLY not in task_options(other)
    help_text = env.store.human_tasks("i1")[0]["payload"]["extra"]["option_help"][APPLY]
    assert "cancels this issue" in help_text and "Nothing is applied until you choose" in help_text


def test_the_owner_can_apply_a_split_and_the_plan_completes(tmp_path):
    env = Env(tmp_path, issues=[("i1", "P1", ["F1.1", "F1.2"]), ("i2", "P2", ["F2.1"])])
    dependent = env.store.get_issue("i2")
    dependent["deps"] = ["i1"]
    env.store.put_issue(dependent)
    escalate_with_split(env)
    assert respond(env, APPLY)["status"] == "resolved"
    assert env.state("i1") == "Blocked"  # nothing changes until the scheduler has checked the proposal again
    events = env.run_until(lambda: env.store.state("plan", "fx@v1") == "Completed", advance=60)
    assert any(e["event"] == "split_applied" and e["parts"] == 2 for e in events)
    original = env.store.get_issue("i1")
    assert env.state("i1") == "Cancelled" and original["superseded_by"] == ["i1-model", "i1-view"] and original["proposed_split"] is None
    assert env.store.get_issue("i2")["deps"] == ["i1-model", "i1-view"]
    assert env.store.get_issue("i1-view")["deps"] == ["i1-model"] and env.store.get_issue("i1-view")["phase_id"] == "P1"
    assert env.state("i1-model") == "Done" and env.state("i1-view") == "Done" and env.state("i2") == "Done"


def test_applied_parts_carry_the_models_the_analyst_chose(tmp_path):
    choices = {"implementer": {"model": "claude-sonnet-5", "reason": "The model layer is intricate."},
               "reviewer": {"model": "claude-haiku-4.5", "reason": "A narrow diff with reliable tests."}}
    analysis = dict(SPLIT, split=[part("i1-model", ["F1.1"], model_choices=choices), part("i1-view", ["F1.2"], deps=["i1-model"])])
    env = Env(tmp_path)
    escalate_with_split(env, analysis)
    respond(env, APPLY)
    env.run_until(lambda: env.state("i1-model") == "Done", advance=60)
    assert env.store.get_issue("i1-model")["model_choices"] == choices
    first = next(a for a in env.store.list_attempts("i1-model") if a["role"] == "implementer")
    assert first["model"] == "claude-sonnet-5" and first["routing_source"] == "delegator"


@pytest.mark.parametrize("choices, message", [
    ({"implementer": {"model": "unapproved-model", "reason": "Cheap."}}, "configured"),
    ({"implementer": {"model": "claude-opus-5", "reason": " "}}, "reason"),
])
def test_part_model_choices_are_validated_with_the_analysis(tmp_path, choices, message):
    env = Env(tmp_path)
    escalate_with_split(env, dict(SPLIT, split=[part("i1-model", ["F1.1"], model_choices=choices), part("i1-view", ["F1.2"])]))
    [analyst] = [a for a in env.store.list_attempts("i1") if a["role"] == "analyst"]
    assert analyst["failure_kind"] == "schema_invalid" and message in analyst["detail"] and APPLY not in task_options(env)


def test_choosing_another_option_discards_the_proposal(tmp_path):
    env = Env(tmp_path)
    escalate_with_split(env)
    respond(env, "give guidance and retry", guidance="Build the model first.")
    issue = env.store.get_issue("i1")
    assert issue["proposed_split"] is None and not issue.get("split_approved") and env.state("i1") == "Ready"
    assert [i["issue_id"] for i in env.store.list_issues()] == ["i1"]


def test_an_interrupted_apply_resumes_without_duplicates(tmp_path):
    env = Env(tmp_path)
    escalate_with_split(env)
    respond(env, APPLY)
    first = SPLIT["split"][0]  # a crash after the first part was created leaves it behind
    fields = {k: v for k, v in first.items() if k not in ("issue_id", "requirement_ids")}
    env.store.put_issue(new_issue("i1-model", "fx", "P1", first["requirement_ids"], base_rev=env.repo.base_head(), split_of="i1", **fields))
    for state in ("Refining", "Ready"):
        env.store.transition("issue", "i1-model", state, "setup")
    events = env.tick(60)
    assert any(e["event"] == "split_applied" for e in events) and env.state("i1") == "Cancelled"
    assert sorted(i["issue_id"] for i in env.store.list_issues()) == ["i1", "i1-model", "i1-view"]
    assert env.store.get_issue("i1")["superseded_by"] == ["i1-model", "i1-view"]


def test_a_split_that_stops_validating_goes_back_to_the_owner(tmp_path):
    env = Env(tmp_path)
    escalate_with_split(env)
    env.add_issue("i1-model", "P1", ["F1.1"], state="Refining")  # the id is taken before the owner approves
    respond(env, APPLY)
    env.tick(60)
    issue = env.store.get_issue("i1")
    assert env.state("i1") == "Blocked" and issue["proposed_split"] is None and not issue.get("split_approved")
    assert "no longer validates" in issue["blocked_reason"] and "already exists" in issue["blocked_reason"]
    [again] = [t for t in env.store.human_tasks("i1") if t["state"] in humantasks.OPEN_STATES]
    assert APPLY not in again["payload"]["options"] and "i1-view" not in [i["issue_id"] for i in env.store.list_issues()]


def test_an_unavailable_part_model_stops_the_split_at_apply_time(tmp_path):
    choices = {"implementer": {"model": "claude-sonnet-5", "reason": "Intricate."}}
    env = Env(tmp_path)
    escalate_with_split(env, dict(SPLIT, split=[part("i1-model", ["F1.1"], model_choices=choices), part("i1-view", ["F1.2"], deps=["i1-model"])]))
    respond(env, APPLY)
    env.sched.available_models = ["claude-haiku-4.5"]
    env.tick(60)
    assert env.state("i1") == "Blocked" and "not available" in env.store.get_issue("i1")["blocked_reason"]


@pytest.mark.parametrize("reached", [(), ("Refining",)])
def test_an_apply_interrupted_before_the_part_transitions_resumes(tmp_path, reached):
    env = Env(tmp_path, issues=[("i1", "P1", ["F1.1", "F1.2"]), ("i2", "P2", ["F2.1"])])
    escalate_with_split(env)
    respond(env, APPLY)
    first = SPLIT["split"][0]  # a crash after the part was written, before or between its transitions
    fields = {k: v for k, v in first.items() if k not in ("issue_id", "requirement_ids")}
    env.store.put_issue(new_issue("i1-model", "fx", "P1", first["requirement_ids"], base_rev=env.repo.base_head(), split_of="i1", **fields))
    for state in reached:
        env.store.transition("issue", "i1-model", state, "setup")
    events = env.run_until(lambda: env.store.state("plan", "fx@v1") == "Completed", advance=60)
    assert any(e["event"] == "split_applied" for e in events)
    assert env.state("i1") == "Cancelled" and env.state("i1-model") == "Done" and env.state("i1-view") == "Done"


def test_a_run_pauses_by_itself_once_the_named_phase_is_done(tmp_path):
    """The operator asks for one phase to land whole and nothing after it to start."""
    from harness_doubles import Env
    env = Env(tmp_path, budgets={"lease_s": 10 ** 7, "run_wall_clock_s": 10 ** 8, "worker_timeout_s": 10 ** 7,
                                 "inactivity_timeout_s": 10 ** 7})
    env.store.put_run("fx", dict(env.store.get_run("fx"), pause_after_phase="P1"))
    env.start()
    events = env.run_until(lambda: env.store.state("plan", "fx@v1") == "Paused", advance=700)
    assert "paused after phase P1" in [e for e in events if e["event"] == "paused"][0]["reason"]
    assert env.store.state("phase", "fx@v1/P1") == "Done"
    assert env.store.state("phase", "fx@v1/P2") in ("Planned", "Eligible")  # P2 never started
    paused = env.store.get_run("fx")
    assert not paused.get("pause_after_phase")  # the request is one-shot
