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
