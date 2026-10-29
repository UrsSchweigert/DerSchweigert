import json

import pytest

from harness import descope
from harness_doubles import Env


def plan_with(env, allow=True, **envelope):
    """Bind an approved envelope into both the stored plan and the running scheduler."""
    stored = env.store.get_plan("fx")
    plan = stored["plan"]
    plan["policy"]["descope"] = dict({"allow_deferral": allow, "require_followup": True}, **envelope)
    env.store.cx.execute("UPDATE plans SET content=? WHERE plan_id=? AND version=?",
                         (json.dumps(plan, sort_keys=True), plan["plan_id"], plan["version"]))
    env.sched._plan = lambda: plan
    return plan


def test_deferral_needs_an_envelope(tmp_path):
    env = Env(tmp_path)
    with pytest.raises(descope.DescopeError):
        descope.defer(env.store, "fx", "F1.2", reason="too big", followup_issue="later", actor="owner", now=env.clock())


def test_deferral_needs_a_reason_and_a_followup(tmp_path):
    env = Env(tmp_path)
    plan_with(env)
    with pytest.raises(descope.DescopeError):
        descope.defer(env.store, "fx", "F1.2", reason="", followup_issue="later", actor="owner", now=env.clock())
    with pytest.raises(descope.DescopeError):
        descope.defer(env.store, "fx", "F1.2", reason="too big", followup_issue="", actor="owner", now=env.clock())


def test_unknown_and_forbidden_requirements_are_refused(tmp_path):
    env = Env(tmp_path)
    plan_with(env, forbidden_requirements=["F1.2"])
    with pytest.raises(descope.DescopeError):
        descope.defer(env.store, "fx", "F9.9", reason="x", followup_issue="later", actor="owner", now=env.clock())
    with pytest.raises(descope.DescopeError):
        descope.defer(env.store, "fx", "F1.2", reason="x", followup_issue="later", actor="owner", now=env.clock())


def test_the_envelope_caps_the_number_of_deferrals(tmp_path):
    env = Env(tmp_path, issues=[])
    env.add_issue("a", "P1", ["F1.1"])
    env.add_issue("b", "P1", ["F1.2"])
    plan_with(env, max_deferred_requirements=1)
    descope.defer(env.store, "fx", "F1.1", reason="x", followup_issue="later", actor="owner", now=env.clock())
    with pytest.raises(descope.DescopeError):
        descope.defer(env.store, "fx", "F1.2", reason="x", followup_issue="later", actor="owner", now=env.clock())


def test_a_deferred_requirement_lets_the_phase_complete(tmp_path, monkeypatch):
    from harness import plans
    monkeypatch.setitem(plans.DEFAULT_POLICY, "descope", {"allow_deferral": True, "require_followup": True})
    env = Env(tmp_path, issues=[("a", "P1", ["F1.1", "F1.2"])])
    env.adapter.impl_paths["a"] = ["src/a.py"]
    env.start()
    env.run_until(lambda: env.state("a") == "Done")
    assert env.store.state("phase", "fx@v1/P1") != "Done"  # F1.2 is uncovered
    descope.defer(env.store, "fx", "F1.2", reason="cost", followup_issue="later", actor="owner", now=env.clock())
    env.run_until(lambda: env.store.state("phase", "fx@v1/P1") == "Done")
    assert [d["requirement_id"] for d in descope.deferrals(env.store, "fx", 1)] == ["F1.2"]


def test_restore_chains_one_issue_per_deferred_requirement(tmp_path):
    env = Env(tmp_path, issues=[])
    env.add_issue("a", "P1", ["F1.1"])
    env.add_issue("b", "P1", ["F1.2"])
    plan_with(env)
    descope.defer(env.store, "fx", "F1.1", reason="cost", followup_issue="later", actor="owner", now=env.clock())
    descope.defer(env.store, "fx", "F1.2", reason="cost", followup_issue="later", actor="owner", now=env.clock())
    draft = descope.restore_draft(env.store, "fx")
    assert draft["plan_id"] == "fx-restore-1"
    issues = draft["issues"]["issues"]
    assert [i["requirement_ids"] for i in issues] == [["F1.1"], ["F1.2"]]
    assert issues[0]["deps"] == [] and issues[1]["deps"] == [issues[0]["issue_id"]]  # sequential, never parallel
    assert json.dumps(draft["phases"])


def test_restore_refuses_when_nothing_was_deferred(tmp_path):
    env = Env(tmp_path)
    with pytest.raises(descope.DescopeError):
        descope.restore_draft(env.store, "fx")


# -- answering without the owner ------------------------------------------------------------------

def auto_env(tmp_path, monkeypatch, analyses=None, emergency_topics=None, **envelope):
    from harness import plans
    monkeypatch.setitem(plans.DEFAULT_POLICY, "descope", dict({"allow_deferral": True, "require_followup": True}, **envelope))
    auto = {"enabled": True, "triage_all_blocks": True}
    if emergency_topics:
        auto["emergency_topics"] = emergency_topics
    monkeypatch.setitem(plans.DEFAULT_POLICY, "auto_answer", auto)
    env = Env(tmp_path, issues=[])
    env.add_issue("i1", "P1", ["F1.1"])
    env.adapter.script("i1", "implementer", "blocked")
    env.adapter.decisions["i1"] = [{"action": "ask_owner", "diagnosis": "This needs a decision."}]
    if analyses:
        env.adapter.analyses["i1"] = list(analyses)
    return env


def test_a_retry_recommendation_is_applied_without_asking(tmp_path, monkeypatch):
    env = auto_env(tmp_path, monkeypatch, analyses=[{"root_cause": "The task is feasible.", "recommendation": "retry", "guidance": "use src/x.py"}])
    env.start()
    events = env.run_until(lambda: any(e["event"] == "answered_without_owner" for e in env.sched.events) or env.state("i1") == "Done", limit=40)
    assert not env.store.human_tasks("i1")  # no question reached a human
    assert any(e.get("action") == "retry" for e in events if e.get("event") == "answered_without_owner")


def test_a_needs_owner_analysis_is_descoped_instead_of_asking(tmp_path, monkeypatch):
    env = auto_env(tmp_path, monkeypatch, analyses=[{"root_cause": "Only a human can decide this.", "recommendation": "needs_owner", "questions": ["which?"]}])
    env.start()
    env.run_until(lambda: env.state("i1") == "Cancelled", limit=40)
    assert not env.store.human_tasks("i1")
    assert [d["requirement_id"] for d in descope.deferrals(env.store, "fx", 1)] == ["F1.1"]
    assert descope.deferrals(env.store, "fx", 1)[0]["followup_issue"] == "restore-F1-1"


def test_an_emergency_still_reaches_the_owner(tmp_path, monkeypatch):
    env = auto_env(tmp_path, monkeypatch, emergency_topics=["helper"])
    env.start()
    env.run_until(lambda: env.state("i1") == "Blocked", limit=40)
    assert env.store.human_tasks("i1")  # the emergency is the one thing that is asked
