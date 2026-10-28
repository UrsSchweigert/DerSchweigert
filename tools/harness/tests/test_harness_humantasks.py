import os

import pytest

from harness import humantasks, workrecord
from harness.humantasks import TaskError
from harness_doubles import Env, RecordingNotifier, TIER_A
from harness_fakes import FakeGitHub

H = 3600
BUDGETS = {"human_reminder_after_s": 24 * H, "human_reminders_max": 3, "human_escalation_after_s": 72 * H}
LONG = {"lease_s": 10**7, "run_wall_clock_s": 10**8, "worker_timeout_s": 10**7, "inactivity_timeout_s": 10**7}


def make_task(env, task_id="t1", issue="i1", kind="decision", **kw):
    args = dict(task_id=task_id, kind=kind, issue_ids=[issue], owner="alice", secondary_owner="bob", delegates=["carol"], now=env.clock(),
                why="needs a decision", request="pick one", response_format={"required": ["option"], "optional": ["guidance"]},
                options=humantasks.DECISION_OPTIONS, resolution_criteria="any option")
    args.update(kw)
    return humantasks.request_task(env.store, **args)


def respond(env, task_id="t1", who=("alice",), source="local", answers=None, **kw):
    return humantasks.respond(env.store, task_id, responder_ids=who, source=source, answers=answers or {"option": "give guidance and retry"},
                              now=env.clock(), **kw)


def state(env, task_id="t1"):
    return env.store.state("human_task", task_id)


# -- requests -----------------------------------------------------------------------------

def test_task_contains_what_a_human_needs_and_blocks_dependent_work(tmp_path):
    env = Env(tmp_path)
    assert make_task(env) is True
    task = env.store.get_human_task("t1")
    p = task["payload"]
    for field in ("why", "request", "response_format", "resolution_criteria", "options", "owner", "issue_ids", "deadline"):
        assert field in p
    assert task["state"] == "Requested" and env.state("i1") == "Blocked"


def test_task_creation_is_idempotent(tmp_path):
    env = Env(tmp_path)
    assert make_task(env) and not make_task(env)
    assert len(env.store.human_tasks()) == 1


def test_task_requires_context_and_rejects_secrets(tmp_path):
    env = Env(tmp_path)
    with pytest.raises(TaskError):
        make_task(env, why="")
    with pytest.raises(TaskError):
        make_task(env, kind="vote")
    with pytest.raises(Exception, match="credential"):
        make_task(env, request="use ghp_" + "a" * 30)


# -- notifications, reminders, escalation ---------------------------------------------------------

def test_notifications_are_deduplicated_across_passes_and_restarts(tmp_path):
    env = Env(tmp_path)
    make_task(env)
    note = RecordingNotifier()
    for _ in range(5):
        humantasks.tick_tasks(env.store, note, env.clock.advance(60), BUDGETS)
    assert note.subjects("t1") == [("alice", "action needed")]
    fresh = RecordingNotifier()  # a restarted process has a new notifier but the same store
    humantasks.tick_tasks(env.store, fresh, env.clock.advance(60), BUDGETS)
    assert fresh.sent == []


def test_reminders_are_bounded_and_escalation_goes_to_the_secondary_owner(tmp_path):
    env = Env(tmp_path)
    make_task(env)
    note = RecordingNotifier()
    for hours in (1, 25, 49, 73, 97, 200, 400):
        env.clock.t = 1000.0 + hours * H
        humantasks.tick_tasks(env.store, note, env.clock(), BUDGETS)
    subjects = note.subjects("t1")
    assert [s for r, s in subjects if s.startswith("reminder")] == ["reminder 1", "reminder 2", "reminder 3"]
    assert subjects.count(("bob", "escalated")) == 1
    assert state(env) == "Requested" and env.state("i1") == "Blocked"  # silence never moves anything forward


def test_deadline_notice_is_sent_once(tmp_path):
    env = Env(tmp_path)
    make_task(env, deadline=env.clock() + H)
    note = RecordingNotifier()
    for _ in range(3):
        humantasks.tick_tasks(env.store, note, env.clock.advance(2 * H), BUDGETS)
    assert [s for _, s in note.subjects("t1")].count("deadline passed") == 1


def test_closed_tasks_are_not_notified(tmp_path):
    env = Env(tmp_path)
    make_task(env)
    respond(env)
    note = RecordingNotifier()
    humantasks.tick_tasks(env.store, note, env.clock.advance(100 * H), BUDGETS)
    assert note.sent == []


def test_scheduler_notifies_open_tasks_once_per_round(tmp_path):
    env = Env(tmp_path, budgets=LONG)
    note = RecordingNotifier()
    env.sched.notifier = note
    env.checker.fail_next = 99
    env.start()
    env.run_until(lambda: env.state("i1") == "Blocked")
    for _ in range(5):
        env.tick(60)
    assert note.subjects().count(("owner", "action needed")) == 1


# -- responder identity and sources --------------------------------------------------------------------

@pytest.mark.parametrize("who", [("alice",), ("ALICE",), ("carol",)])
def test_owner_and_delegates_may_respond(tmp_path, who):
    env = Env(tmp_path)
    make_task(env)
    assert respond(env, who=who)["status"] == "resolved"


def test_impostors_bots_and_untrusted_sources_cannot_move_a_task(tmp_path):
    env = Env(tmp_path)
    make_task(env)
    before = env.store.journal(200)
    for who, source in ((("mallory",), "local"), (("alice[bot]",), "github"), (("harness-worker",), "local"), (("alice",), "worker"), (("alice",), "comment")):
        with pytest.raises(TaskError):
            respond(env, who=who, source=source)
    assert state(env) == "Requested" and env.store.journal(200) == before


def test_acknowledgement_needs_the_owner(tmp_path):
    env = Env(tmp_path)
    make_task(env)
    with pytest.raises(TaskError):
        humantasks.acknowledge(env.store, "t1", ["mallory"], "local", env.clock())
    humantasks.acknowledge(env.store, "t1", ["alice"], "github", env.clock())
    assert state(env) == "Acknowledged"


# -- invalid responses ----------------------------------------------------------------------------------

@pytest.mark.parametrize("answers,reason", [
    ({"guidance": "only guidance"}, "missing required"),
    ({"option": "do whatever"}, "option must be one of"),
    ({"option": "refine the scope", "guidance": "token ghp_" + "z" * 30}, "credential"),
])
def test_invalid_responses_return_the_task_with_a_reason(tmp_path, answers, reason):
    env = Env(tmp_path)
    make_task(env)
    result = respond(env, answers=answers)
    assert result["status"] == "invalid" and reason in result["reason"]
    assert state(env) == "Acknowledged" and env.state("i1") == "Blocked"
    assert env.store.get_human_task("t1")["payload"]["history"][-1]["what"] == "returned"
    assert respond(env)["status"] == "resolved"  # the owner can answer again


def test_missing_artifacts_and_asset_without_validator_fail_closed(tmp_path):
    env = Env(tmp_path)
    make_task(env, kind="asset", response_format={"required": ["source", "license", "author"]}, options=[])
    answers = {"source": "me", "license": "CC0-1.0", "author": "a"}
    assert "artifact" in respond(env, answers=answers)["reason"]
    assert "unreadable" in respond(env, answers=answers, artifacts=[str(tmp_path / "missing.glb")])["reason"]
    f = tmp_path / "a.glb"
    f.write_bytes(b"x")
    assert "not available" in respond(env, answers=answers, artifacts=[str(f)])["reason"]


# -- resolution and automatic resume ------------------------------------------------------------------------

def test_decision_options_resume_the_right_work(tmp_path):
    env = Env(tmp_path, issues=[("a", "P1", ["F1.1"]), ("b", "P1", ["F1.2"]), ("c", "P1", ["F1.1"])])
    for iid, option, expected in (("a", "give guidance and retry", "Ready"), ("b", "refine the scope", "Refining")):
        make_task(env, task_id="t-" + iid, issue=iid)
        res = respond(env, task_id="t-" + iid, answers={"option": option, "guidance": "use the helper"})
        assert res["status"] == "resolved" and res["released"] == [iid] and env.state(iid) == expected
    assert env.store.get_issue("a")["guidance"] == ["use the helper"]
    make_task(env, task_id="t-c", issue="c")
    respond(env, task_id="t-c", answers={"option": "cancel the issue"})
    assert env.state("c") == "Cancelled" and env.store.get_issue("c")["cancelled"] is True


def test_cancelled_issue_does_not_get_a_replacement_task(tmp_path):
    env = Env(tmp_path)
    make_task(env)
    respond(env, answers={"option": "cancel the issue"})
    env.start()
    assert not [e for e in env.tick() if e["event"] == "invariant_repaired"]
    assert len(env.store.human_tasks("i1")) == 1


def test_blocked_work_resumes_automatically_after_the_answer(tmp_path):
    env = Env(tmp_path, budgets=LONG)
    env.checker.fail_next = 99
    env.start()
    env.run_until(lambda: env.state("i1") == "Blocked")
    [task] = env.store.human_tasks("i1")
    env.checker.fail_next = 0  # the human's guidance fixed the cause
    res = humantasks.respond(env.store, task["task_id"], responder_ids=["owner"], source="local", now=env.clock(),
                             answers={"option": "give guidance and retry", "guidance": "the check needed a fixture"})
    assert res["released"] == ["i1"] and env.store.get_issue("i1")["repair_failures"] == 2
    env.run_until(lambda: env.state("i1") == "Done")
    assert "the check needed a fixture" in [r for r in env.adapter.started if r.role == "implementer"][-1].packet["untrusted_data"]


def test_human_retry_does_not_reset_cumulative_budget_and_override_is_explicit(tmp_path):
    env = Env(tmp_path)
    issue = env.store.get_issue("i1")
    issue["repair_failures"] = 3
    env.store.put_issue(issue)
    make_task(env)
    response = respond(env, answers={"option": "retry as is"})
    assert response["released"] == []
    assert env.state("i1") == "Blocked"
    assert env.store.get_issue("i1")["repair_failures"] == 3

    env.sched._ensure_decision_task(env.store.get_issue("i1"), env.clock(), "budget remains exhausted")
    task = next(t for t in env.store.human_tasks("i1") if t["state"] == "Requested")
    response = humantasks.respond(env.store, task["task_id"], responder_ids=["owner"], source="local",
                                  answers={"option": "extend retry budget and retry"}, now=env.clock())
    issue = env.store.get_issue("i1")
    assert response["released"] == ["i1"]
    assert issue["repair_failures"] == 3 and issue["repair_budget_override"] == 1


def test_unrelated_work_continues_while_a_task_waits(tmp_path):
    env = Env(tmp_path, issues=[("a", "P1", ["F1.1"]), ("b", "P1", ["F1.2"])])
    make_task(env, issue="a")
    env.start()
    env.run_until(lambda: env.state("b") == "Done")
    assert env.state("a") == "Blocked" and state(env) == "Requested"


def test_dependent_work_cancellation_cancels_open_tasks(tmp_path):
    env = Env(tmp_path)
    make_task(env)
    env.start()
    env.sched.request_cancel()
    env.tick()
    assert state(env) == "Cancelled"
    with pytest.raises(TaskError):
        respond(env)


# -- GitHub mirror and notifier -------------------------------------------------------------------------------

def test_tasks_are_mirrored_as_github_issues_idempotently_and_comments_never_resolve(tmp_path):
    env = Env(tmp_path)
    make_task(env)
    gh = FakeGitHub()
    kw = dict(allowlist=["UrsSchweigert"], isolation=TIER_A, sleep=lambda s: None)
    dry = workrecord.sync_human_tasks(gh, env.store, "fx", dry_run=True, **kw)
    assert dry["results"][0]["action"] == "create" and gh.mutations == 0
    workrecord.sync_human_tasks(gh, env.store, "fx", dry_run=False, **kw)
    workrecord.sync_human_tasks(gh, env.store, "fx", dry_run=False, **kw)
    assert len(gh.issues) == 1 and "Owner: @alice" in gh.issues[1]["body"] and "Comments here do not resolve" in gh.issues[1]["body"]
    notifier = workrecord.GitHubNotifier(gh, env.store, "fx")
    humantasks.tick_tasks(env.store, notifier, env.clock(), BUDGETS)
    assert gh.comments and gh.comments[0][1].startswith("@alice action needed")
    gh.comments.append((1, "@alice approved, go ahead"))  # a reply on GitHub is not an answer
    humantasks.tick_tasks(env.store, notifier, env.clock.advance(10), BUDGETS)
    assert state(env) == "Requested"
    with pytest.raises(workrecord.approval.AuthorizationError, match="Tier B"):
        workrecord.sync_human_tasks(gh, env.store, "fx", ["x"], dry_run=False)


# -- decision tasks that explain themselves ---------------------------------------------------------------------------------

def test_a_number_picks_the_option_from_the_list(tmp_path):
    env = Env(tmp_path)
    make_task(env)
    res = humantasks.respond(env.store, "t1", responder_ids=["alice"], source="local", answers={"option": "2"}, now=env.clock())
    assert res["status"] == "resolved" and env.state("i1") == "Ready"
    env2 = Env(tmp_path / "b")
    make_task(env2)
    bad = humantasks.respond(env2.store, "t1", responder_ids=["alice"], source="local", answers={"option": "9"}, now=env2.clock())
    assert bad["status"] == "invalid"


def test_retry_without_guidance_adds_no_guidance_text(tmp_path):
    env = Env(tmp_path)
    make_task(env)
    humantasks.respond(env.store, "t1", responder_ids=["alice"], source="local", answers={"option": "1"}, now=env.clock())
    assert not env.store.get_issue("i1").get("guidance")  # the option label must never leak into the worker's instructions


def test_tasks_raised_with_the_old_labels_can_still_be_answered(tmp_path):
    env = Env(tmp_path)
    make_task(env, options=["refine the scope", "supply guidance or an asset", "accept a different approach", "cancel the issue"])
    res = humantasks.respond(env.store, "t1", responder_ids=["alice"], source="local", answers={"option": "supply guidance or an asset"}, now=env.clock())
    assert res["status"] == "resolved" and env.state("i1") == "Ready"
    assert "supply guidance or an asset" in humantasks.OPTION_HELP and "asset" in humantasks.OPTION_HELP["supply guidance or an asset"]


def test_a_scheduler_decision_task_explains_what_happened_and_each_option(tmp_path):
    env = Env(tmp_path, budgets=dict(lease_s=10**7, run_wall_clock_s=10**8, worker_timeout_s=10**7, inactivity_timeout_s=10**7))
    env.checker.fail_next = 99
    env.start()
    env.run_until(lambda: env.state("i1") == "Blocked")
    [task] = env.store.human_tasks("i1")
    text = humantasks.render_task(task)
    assert "harness asking you, not a request from a reviewer or a worker" in text
    assert "Failure: checks_failed (deterministic, coordinator)" in text or "Failure: checks_failed" in text
    for label in humantasks.DECISION_OPTIONS:
        assert label in text
    assert "1) retry as is: Run the next step again" in text and "harness respond %s --option 1" % task["task_id"] in text and "--guidance" in text
    assert task["payload"]["extra"]["option_help"]["cancel the issue"].startswith("Drop this issue")


def test_the_tasks_command_prints_the_explained_task(tmp_path, capsys):
    env = Env(tmp_path)
    make_task(env)
    from harness import cli
    assert cli.main(["--home", env.store.home, "tasks"]) == 0
    out = capsys.readouterr().out
    assert "t1  [decision] Requested" in out and "Options:" in out and "harness respond t1 --option 1" in out
    humantasks.respond(env.store, "t1", responder_ids=["alice"], source="local", answers={"option": "1"}, now=env.clock())
    cli.main(["--home", env.store.home, "tasks"])
    assert "no open tasks" in capsys.readouterr().out
