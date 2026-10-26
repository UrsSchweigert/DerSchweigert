import pytest

from harness import humantasks, plans
from harness.humantasks import TaskError
from harness_doubles import Env

DETAILS = {"build_ref": "http://localhost:8080/preview", "commit": "", "environment": "macOS 15, Safari 18", "device_or_browser": "iPad Air, Safari",
           "preconditions": ["fresh install"], "test_data": ["word list de"], "steps": ["open the app", "tap Read Out Loud"],
           "expected": ["the word is spoken"], "evidence_required": ["screenshot"]}
LONG = {"lease_s": 10**7, "run_wall_clock_s": 10**8, "worker_timeout_s": 10**7, "inactivity_timeout_s": 10**7}


def policy():
    return {"manual_testing": plans.DEFAULT_POLICY["manual_testing"]}


def to_review(env):
    """Run until the reviewer is mid-flight, so the issue is In Review with a head and passing checks."""
    env.adapter.script("i1", "reviewer", "hang")
    env.start()
    env.run_until(lambda: any(r.role == "reviewer" for r in env.adapter.started))
    return env.store.get_issue("i1")


def release_review(env):
    next(h["handle"] for h in env.sched.handles.values() if h["handle"].req.role == "reviewer").step = "ok"


def request(env, issue, **over):
    details = dict(DETAILS, commit=issue["head_rev"])
    details.update(over)
    return humantasks.request_manual_test(env.store, issue, task_id="m1", owner="alice", reason="visual_judgment", details=details,
                                          policy=policy(), now=env.clock())


def answer(env, outcome="pass", revision=None, evidence=("shot.png",), who=("alice",), **kw):
    issue = env.store.get_issue("i1")
    return humantasks.respond(env.store, "m1", responder_ids=who, source="local", now=env.clock(),
                              answers=dict({"outcome": outcome, "tester": "alice", "revision": revision or issue["head_rev"], "evidence": list(evidence)}, **kw))


def test_request_must_follow_the_validation_policy(tmp_path):
    env = Env(tmp_path, budgets=LONG)
    issue = to_review(env)
    with pytest.raises(TaskError, match="not allowed for reason"):
        humantasks.request_manual_test(env.store, issue, task_id="m1", owner="a", reason="we are lazy", details=dict(DETAILS, commit=issue["head_rev"]),
                                       policy=policy(), now=env.clock())
    with pytest.raises(TaskError, match="never replace mandatory automated checks"):
        request(env, issue, replaces_automated=True)
    with pytest.raises(TaskError, match="exact current head"):
        request(env, issue, commit="deadbeef")


@pytest.mark.parametrize("missing", ["build_ref", "steps", "expected", "evidence_required", "environment", "device_or_browser", "preconditions", "test_data"])
def test_missing_assets_refuse_the_request(tmp_path, missing):
    env = Env(tmp_path, budgets=LONG)
    issue = to_review(env)
    with pytest.raises(TaskError, match="missing"):
        request(env, issue, **{missing: ""})
    assert env.store.human_tasks() == []


def test_task_carries_everything_a_tester_needs(tmp_path):
    env = Env(tmp_path, budgets=LONG)
    issue = to_review(env)
    assert request(env, issue)
    extra = env.store.get_human_task("m1")["payload"]["extra"]
    for f in humantasks.MANUAL_FIELDS + ("tested_head", "reason"):
        assert f in extra
    assert extra["tested_head"] == issue["head_rev"]
    assert env.state("i1") == "In Review"  # waiting for the test does not block the issue


def test_merge_waits_for_the_manual_result_and_then_proceeds(tmp_path):
    env = Env(tmp_path, budgets=LONG)
    request(env, to_review(env))
    release_review(env)
    env.tick()
    assert env.state("i1") == "In Review"
    assert any("manual test" in r for r in env.sched.merge_gate(env.store.get_issue("i1")))
    assert answer(env)["status"] == "resolved"
    env.run_until(lambda: env.state("i1") == "Done")


def test_stale_result_is_not_accepted_and_reopens_the_task(tmp_path):
    env = Env(tmp_path, budgets=LONG)
    request(env, to_review(env))
    res = answer(env, revision="oldrev")
    assert res["status"] == "stale" and env.store.state("human_task", "m1") == "Requested"
    assert not env.store.evidence("i1", "manual")
    assert env.store.get_human_task("m1")["payload"]["round"] == 2


def test_result_for_a_head_that_has_moved_is_stale(tmp_path):
    env = Env(tmp_path, budgets=LONG)
    issue = to_review(env)
    request(env, issue)
    old = issue["head_rev"]
    moved = env.store.get_issue("i1")
    moved["head_rev"] = "new-head"  # the branch changed after the test was requested
    env.store.put_issue(moved)
    res = answer(env, revision=old)
    assert res["status"] == "stale" and res["new_head"] == "new-head"
    assert env.store.get_human_task("m1")["payload"]["extra"]["tested_head"] == "new-head"


def test_inconclusive_stays_unresolved_and_never_counts_as_passing(tmp_path):
    env = Env(tmp_path, budgets=LONG)
    request(env, to_review(env))
    res = answer(env, outcome="inconclusive", evidence=())
    assert res["status"] == "invalid" and "inconclusive" in res["reason"]
    assert env.store.state("human_task", "m1") == "Acknowledged" and not env.store.evidence("i1", "manual")
    release_review(env)
    env.tick()
    assert env.state("i1") == "In Review"
    assert any("manual test" in r for r in env.sched.merge_gate(env.store.get_issue("i1")))


def test_failed_manual_test_returns_the_issue_for_repair_and_needs_a_new_task(tmp_path):
    env = Env(tmp_path, budgets=LONG)
    request(env, to_review(env))
    res = answer(env, outcome="fail", notes="the button does nothing")
    assert res["released"] == ["i1"] and env.state("i1") == "In Progress"
    issue = env.store.get_issue("i1")
    assert issue["last_failures"][-1]["kind"] == "manual_test_failed" and issue["repair_failures"] == 1
    assert not env.store.evidence("i1")  # every piece of evidence is stale
    # The repaired revision needs its own manual test: the old task is closed.
    release_review(env)
    env.run_until(lambda: env.state("i1") == "In Review" and env.store.get_issue("i1")["head_rev"] != "")
    assert env.store.state("human_task", "m1") == "Resolved"
    assert any("manual test" in r for r in env.sched.merge_gate(env.store.get_issue("i1")))


def test_required_evidence_must_be_supplied(tmp_path):
    env = Env(tmp_path, budgets=LONG)
    request(env, to_review(env))
    res = answer(env, evidence=())
    assert res["status"] == "invalid" and "evidence" in res["reason"]


def test_only_the_owner_can_report_a_result(tmp_path):
    env = Env(tmp_path, budgets=LONG)
    request(env, to_review(env))
    with pytest.raises(TaskError):
        answer(env, who=("mallory",))


def test_manual_pass_never_excuses_failing_automated_checks(tmp_path):
    env = Env(tmp_path, budgets=LONG)
    request(env, to_review(env))
    answer(env)
    issue = env.store.get_issue("i1")
    env.store.add_evidence("i1", "checks", issue["head_rev"], env.repo.base_head(), "fail", {}, env.clock())
    reasons = env.sched.merge_gate(issue)
    assert any("required checks failed" in r for r in reasons)
    assert not any("manual test" in r for r in reasons)  # the manual result was accepted, but it cannot replace the checks
    assert env.state("i1") == "In Review"


def test_manual_evidence_is_bound_to_the_tested_head(tmp_path):
    env = Env(tmp_path, budgets=LONG)
    issue = to_review(env)
    request(env, issue)
    answer(env)
    assert env.sched._valid("i1", "manual", issue["head_rev"])["verdict"] == "pass"
    assert env.sched._valid("i1", "manual", "another-head") is None
