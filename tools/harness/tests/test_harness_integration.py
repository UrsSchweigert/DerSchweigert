import pytest

from harness import approval, plans
from harness_doubles import Env


LONG_BUDGETS = {"lease_s": 10**7, "run_wall_clock_s": 10**8, "worker_timeout_s": 10**7, "inactivity_timeout_s": 10**7}


def hold_review(env, iid="i1"):
    """Run until the reviewer is mid-flight so the test can change the world under it."""
    env.adapter.script(iid, "reviewer", "hang")
    env.run_until(lambda: any(r.role == "reviewer" for r in env.adapter.started))


def release_review(env, iid="i1"):
    handle = next(h["handle"] for h in env.sched.handles.values() if h["handle"].req.role == "reviewer" and h["handle"].req.issue_id == iid)
    handle.step = "ok"


# -- Staleness -----------------------------------------------------------------

def test_ready_issue_is_refreshed_when_an_anchor_changed(tmp_path):
    env = Env(tmp_path)
    env.repo.advance_base(["src/core.py"])
    env.start()
    events = env.tick()
    assert any(e["event"] == "refresh_needed" and e["paths"] == ["src/core.py"] for e in events)
    assert env.state("i1") == "Refining" and not [r for r in env.adapter.started if r.role == "implementer"]
    env.run_until(lambda: env.state("i1") == "Done")
    refiner = next(a for a in env.store.list_attempts("i1") if a["role"] == "refiner")
    assert refiner["tier"] == "low"
    assert env.store.get_issue("i1")["base_rev"] == env.repo.base_head()


def test_dependency_contract_change_also_refreshes(tmp_path):
    env = Env(tmp_path, issues=[])
    env.add_issue("i1", "P1", ["F1.1"], code_anchors=["src/own.py"], contract_paths=["api/schema.json"])
    env.repo.advance_base(["api/schema.json"])
    env.start()
    assert any(e["event"] == "refresh_needed" for e in env.tick())


def test_unrelated_base_change_does_not_refresh(tmp_path):
    env = Env(tmp_path, issues=[])
    env.add_issue("i1", "P1", ["F1.1"], code_anchors=["src/core/"])
    env.repo.advance_base(["docs/readme.md"])
    env.start()
    events = env.tick()
    assert not any(e["event"] == "refresh_needed" for e in events)
    assert [r.role for r in env.adapter.started] == ["implementer"]


def test_clean_rebase_keeps_the_review_and_reruns_checks_on_the_new_base(tmp_path):
    env = Env(tmp_path)
    env.start()
    hold_review(env)
    old_base = env.repo.base_head()
    env.repo.advance_base(["docs/other.md"])
    release_review(env)
    env.run_until(lambda: env.state("i1") == "Done")
    assert env.repo.rebased == ["harness/i1"]
    assert len([r for r in env.adapter.started if r.role == "reviewer"]) == 1  # the verdict carried over, no second review
    new_head = env.repo.branch_head("harness/i1")
    reviews = env.store.evidence("i1", "review")
    assert any(r["head_rev"] == new_head and "carried_from" in r["detail"] for r in reviews)
    assert any(h.endswith("+r") for i, h in env.checker.calls if i == "i1")  # checks ran against the rebased head
    merged = env.store.evidence("i1", "checks")[-1]
    assert merged["head_rev"] == new_head and merged["base_rev"] == env.repo.base_head() != old_base


def test_rebase_conflict_invalidates_evidence_and_counts_as_a_repair(tmp_path):
    env = Env(tmp_path)
    env.start()
    hold_review(env)
    env.repo.advance_base(["src/x.py"])
    env.repo.rebase_conflict = True
    release_review(env)
    env.tick()
    assert env.state("i1") == "In Progress"
    assert env.store.evidence("i1") == []  # every piece of evidence is invalid
    issue = env.store.get_issue("i1")
    assert issue["repair_failures"] == 1 and issue["last_failures"][-1]["kind"] == "merge_conflict"
    env.repo.rebase_conflict = False
    env.run_until(lambda: env.state("i1") == "Done")
    assert len([r for r in env.adapter.started if r.role == "reviewer"]) == 2  # a fresh review of the new head


def test_changed_patch_identity_invalidates_the_review(tmp_path):
    env = Env(tmp_path)
    env.start()
    hold_review(env)
    env.repo.advance_base(["src/x.py"])
    env.repo.rebase_new_patch = True
    release_review(env)
    env.tick()
    assert env.state("i1") == "In Progress"
    assert env.store.get_issue("i1")["last_failures"][-1]["kind"] == "patch_changed"
    assert not env.store.evidence("i1")


def test_checks_failing_on_the_new_base_send_the_issue_back(tmp_path):
    env = Env(tmp_path)
    env.start()
    hold_review(env)
    env.repo.advance_base(["docs/other.md"])
    release_review(env)
    env.checker.fail_next = 1
    env.tick()
    assert env.state("i1") == "In Progress"
    assert "new base" in env.store.get_issue("i1")["last_failures"][-1]["detail"]


def test_remote_refresh_failure_prevents_merge(tmp_path):
    from harness.github import GitHubError
    env = Env(tmp_path)
    env.start()
    hold_review(env)
    def failed_refresh():
        raise GitHubError("cannot refresh remote main")
    env.publisher.refresh_base = failed_refresh
    release_review(env)
    env.tick()
    assert env.store.state("plan", "fx@v1") == "Paused"
    assert not [intent for intent in env.publisher.intents if intent["action"] == "merge_pr"]


def test_incorrect_legacy_base_metadata_does_not_skip_revalidation(tmp_path):
    env = Env(tmp_path)
    env.start()
    hold_review(env)
    env.repo.advance_base(["src/parallel.py"])
    issue = env.store.get_issue("i1")
    issue["base_rev"] = env.repo.base_head()
    env.store.put_issue(issue)
    release_review(env)
    env.run_until(lambda: env.state("i1") == "Done")
    assert env.repo.rebased == ["harness/i1"]
    assert env.store.evidence("i1", "checks")[-1]["head_rev"].endswith("+r")


# -- Evidence and integration ------------------------------------------------------

@pytest.mark.parametrize("operation", ["isolated_branches", "commits", "pushes", "pull_requests", "eligible_merges"])
def test_scheduler_enforces_approved_operations(tmp_path, operation):
    operations = [allowed for allowed in plans.ALLOWED_OPERATIONS if allowed != operation]
    env = Env(tmp_path, authorized_operations=operations)
    env.start()
    for _ in range(6):
        env.tick()
    assert env.state("i1") == "Blocked"
    assert operation in env.store.get_issue("i1")["blocked_reason"]
    actions = [intent["action"] for intent in env.publisher.intents]
    assert actions == (["open_pr"] if operation == "eligible_merges" else [])
    if operation in ("isolated_branches", "commits"):
        assert env.adapter.started == []


def test_failed_checks_never_open_a_pull_request(tmp_path):
    env = Env(tmp_path)
    env.checker.fail_next = 99
    env.start()
    env.run_until(lambda: env.state("i1") == "Blocked")
    assert env.publisher.intents == []


def test_review_findings_send_the_issue_back_for_repair(tmp_path):
    env = Env(tmp_path)
    env.adapter.verdicts["i1"] = ["changes_requested", "approve"]
    env.start()
    env.run_until(lambda: env.state("i1") == "Done")
    reviews = env.store.evidence("i1", "review", valid_only=False)
    assert [r["verdict"] for r in reviews] == ["changes", "approve"]
    assert env.store.get_issue("i1")["repair_failures"] == 1
    assert len([r for r in env.adapter.started if r.role == "implementer"]) == 2


def test_stale_review_does_not_satisfy_the_merge_gate(tmp_path):
    env = Env(tmp_path)
    env.start()
    hold_review(env)
    issue = env.store.get_issue("i1")
    issue["head_rev"] = "some-new-head"  # the branch moved after it was checked
    assert any("no review bound" in r for r in env.sched.merge_gate(issue))
    assert any("no passing checks" in r for r in env.sched.merge_gate(issue))


def test_checks_from_an_older_base_do_not_satisfy_the_gate(tmp_path):
    env = Env(tmp_path)
    env.start()
    hold_review(env)
    env.repo.advance_base(["docs/o.md"])
    issue = env.store.get_issue("i1")
    assert any("current base" in r for r in env.sched.merge_gate(issue))


def test_review_must_be_bound_to_the_reviewed_head(tmp_path):
    env = Env(tmp_path, issues=[("i1", "P1", ["F1.1", "F1.2"])])
    env.adapter.script("i1", "reviewer", "wrong_revision")
    env.start()
    env.run_until(lambda: any(a["role"] == "reviewer" and a.get("outcome") for a in env.store.list_attempts("i1")))
    first = next(a for a in env.store.list_attempts("i1") if a["role"] == "reviewer")
    assert first["failure_kind"] == "schema_invalid" and first["outcome"] == "Failed"
    assert env.store.evidence("i1", "review") == []  # the unbound verdict produced no evidence


def test_escalation_path_changes_are_never_merged_autonomously(tmp_path):
    env = Env(tmp_path, allowlist=("src/", "requirements.txt"))
    env.adapter.impl_paths["i1"] = ["requirements.txt"]
    env.start()
    env.run_until(lambda: env.state("i1") == "Blocked")
    assert env.publisher.intents == []
    assert env.store.get_attempt("i1#1")["failure_kind"] == "escalation_path"
    [task] = env.store.human_tasks("i1")
    assert task["kind"] == "decision" and task["owner"] == "owner"


def test_scope_drift_is_detected_from_the_repository_not_the_worker_claim(tmp_path):
    env = Env(tmp_path)
    env.adapter.impl_paths["i1"] = ["src/ok.py", "infra/main.tf"]
    env.start()
    env.run_until(lambda: env.state("i1") == "Blocked")
    assert "infra/main.tf" in env.store.get_attempt("i1#1")["detail"]


def test_harness_paths_are_rejected_even_if_the_plan_allows_them(tmp_path):
    env = Env(tmp_path, allowlist=("src/", "tools/harness/"))
    env.adapter.impl_paths["i1"] = ["tools/harness/store.py"]
    env.start()
    env.run_until(lambda: env.state("i1") == "Blocked")
    assert env.store.get_attempt("i1#1")["failure_kind"] == "scope_violation"


def test_oversized_diff_blocks(tmp_path):
    env = Env(tmp_path)
    env.adapter.impl_lines["i1"] = 5000
    env.start()
    env.run_until(lambda: env.state("i1") == "Blocked")
    assert env.store.get_attempt("i1#1")["failure_kind"] == "diff_too_large"


def test_human_merge_policy_stops_at_review(tmp_path):
    env = Env(tmp_path, merge_policy="human-merges")
    env.start()
    events = env.run_until(lambda: any(e["event"] == "merge_refused" for e in env.sched.events) or env.state("i1") == "Done", limit=15)
    assert env.state("i1") == "In Review"
    assert not [i for i in env.publisher.intents if i["action"] == "merge_pr"]


def test_premature_completion_is_refused(tmp_path):
    env = Env(tmp_path)
    env.start()
    env.run_until(lambda: env.state("i1") == "In Review" or env.state("i1") == "Done", limit=5)
    if env.state("i1") == "In Review":
        with pytest.raises(approval.AuthorizationError, match="not done"):
            env.sched.complete_issue("i1")
    # Existing code or an open PR never qualifies: with no merge evidence the guard refuses.
    env2 = Env(tmp_path / "b", issues=[("x", "P1", ["F1.1"])])
    with pytest.raises(approval.AuthorizationError, match="not done"):
        env2.sched.complete_issue("x")
    env2.store.add_evidence("x", "merge", "h", "b", "merged")
    with pytest.raises(approval.AuthorizationError, match="not done"):
        env2.sched.complete_issue("x")


def test_failing_integrated_checks_after_merge_block_the_issue(tmp_path):
    env = Env(tmp_path, issues=[])
    env.add_issue("i1", "P1", ["F1.1", "F1.2"], validation_commands=["unit"])
    env.checker.fail_calls = {2}  # the first run (before the merge) passes, the second (after the merge) fails
    env.start()
    env.run_until(lambda: env.state("i1") == "Blocked")
    assert "integrated checks fail" in env.store.get_issue("i1")["blocked_reason"] and "unit" in env.store.get_issue("i1")["blocked_reason"]
    assert env.store.evidence("i1", "integrated")[-1]["verdict"] == "fail"
    assert len(env.store.human_tasks("i1")) == 1


def test_post_merge_checks_are_the_issues_own_commands_not_the_whole_phase(tmp_path):
    """Regression: a phase check can need files from issues that are not built yet, so it must not gate the first issue."""
    env = Env(tmp_path, issues=[])
    env.add_issue("i1", "P1", ["F1.1"], validation_commands=["unit-i1"])
    env.checker.fail_commands = {"check-p1"}  # the phase-wide command fails until later issues land
    env.start()
    env.run_until(lambda: env.state("i1") == "Done")
    assert env.checker.commands_run[0] == ["unit-i1"] and ["unit-i1"] in env.checker.commands_run[1:]
    assert not any("check-p1" in cmds for cmds in env.checker.commands_run)
    assert env.store.evidence("i1", "integrated")[-1]["verdict"] == "pass"


def test_post_merge_reruns_the_commands_that_passed_before_the_merge(tmp_path):
    env = Env(tmp_path, issues=[])
    env.add_issue("i1", "P1", ["F1.1"], validation_commands=["a", "b"])
    env.start()
    env.run_until(lambda: env.state("i1") == "Done")
    assert env.checker.commands_run[0] == ["a", "b"] and env.checker.commands_run[1] == ["a", "b"]


def test_an_issue_blocked_after_merging_finishes_its_checks_without_merging_again(tmp_path):
    """Regression for the first real run: PR merged, post-merge check failed, owner answered the decision task."""
    env = Env(tmp_path, issues=[])
    env.add_issue("i1", "P1", ["F1.1"], validation_commands=["unit"])
    env.checker.fail_calls = {2}
    env.start()
    env.run_until(lambda: env.state("i1") == "Blocked")
    merges = [i for i in env.publisher.intents if i["action"] == "merge_pr"]
    reviewers = len([r for r in env.adapter.started if r.role == "reviewer"])
    implementers = len([r for r in env.adapter.started if r.role == "implementer"])
    assert len(merges) == 1
    from harness import humantasks
    [task] = env.store.human_tasks("i1")
    humantasks.respond(env.store, task["task_id"], responder_ids=["owner"], source="local", now=env.clock(),
                       answers={"option": "give guidance and retry", "guidance": "the check was wrong"})
    env.checker.fail_calls = set()
    events = env.tick()
    assert any(e["event"] == "resumed_after_merge" for e in events)
    assert env.state("i1") == "Done" and env.store.evidence("i1", "integrated")[-1]["verdict"] == "pass"
    assert len([i for i in env.publisher.intents if i["action"] == "merge_pr"]) == 1  # not merged a second time
    assert len([r for r in env.adapter.started if r.role == "reviewer"]) == reviewers
    assert len([r for r in env.adapter.started if r.role == "implementer"]) == implementers


def test_phase_with_uncovered_requirements_is_not_done(tmp_path):
    env = Env(tmp_path, issues=[("a", "P1", ["F1.1"])])
    env.start()
    events = env.run_until(lambda: env.state("a") == "Done")
    events += env.tick()
    assert env.store.state("phase", "fx@v1/P1") == "Active"
    assert any(e["event"] == "phase_gaps" and e["gaps"] == ["F1.2"] for e in events)
    assert env.store.state("plan", "fx@v1") == "Executing"


def test_merge_is_bound_to_the_reviewed_head(tmp_path):
    env = Env(tmp_path)
    env.start()
    env.run_until(lambda: env.state("i1") == "Done")
    head = env.store.get_issue("i1")["head_rev"]
    assert [i["head"] for i in env.publisher.intents if i["action"] == "merge_pr"] == [head]
    assert env.store.evidence("i1", "merge")[-1]["detail"] and "simulated" in env.store.evidence("i1", "merge")[-1]["detail"]


# -- a reviewer must be able to report the head it reviewed (regression for a blocked first run) ---------------------------

def test_reviewer_gets_the_trusted_head_and_a_failed_verdict_is_retried_with_the_reason(tmp_path):
    env = Env(tmp_path, budgets=dict(LONG_BUDGETS))
    env.adapter.script("i1", "reviewer", "wrong_revision", "ok")
    env.start()
    env.run_until(lambda: env.state("i1") == "Done")
    reviewers = [r for r in env.adapter.started if r.role == "reviewer"]
    assert len(reviewers) == 2 and all(r.packet["reviewed_head"] == env.store.get_issue("i1")["head_rev"] for r in reviewers)
    assert "your_previous_verdict_was_rejected" not in reviewers[0].packet["untrusted_data"]
    assert "not bound to the current head" in reviewers[1].packet["untrusted_data"]  # the retry differs, so it is not a duplicate
    assert env.store.get_issue("i1")["repair_failures"] == 1


def test_implementer_retries_do_not_see_reviewer_bookkeeping_failures(tmp_path):
    env = Env(tmp_path, budgets=dict(LONG_BUDGETS))
    issue = env.store.get_issue("i1")
    issue["last_failures"] = [{"attempt": "a", "role": "reviewer", "kind": "schema_invalid", "class": "deterministic", "detail": "reviewer noise"},
                              {"attempt": None, "role": "coordinator", "kind": "review_findings", "class": "deterministic", "detail": "real finding"}]
    packet = env.sched._packet(issue, "implementer", "standard")
    assert "real finding" in packet["untrusted_data"] and "reviewer noise" not in packet["untrusted_data"]


def test_blocked_issue_with_a_pull_request_and_passing_checks_resumes_review_without_a_new_implementation(tmp_path):
    env = Env(tmp_path, budgets=dict(LONG_BUDGETS))
    env.adapter.script("i1", "reviewer", "wrong_revision", "wrong_revision", "wrong_revision", "wrong_revision")
    env.start()
    env.run_until(lambda: env.state("i1") == "Blocked")
    implementers_before = len([r for r in env.adapter.started if r.role == "implementer"])
    issue = env.store.get_issue("i1")
    assert issue["head_rev"] and (issue["pr"] or issue.get("pr_simulated")) and env.store.evidence("i1", "checks")
    # The owner answers the decision task: the issue returns to Ready.
    [task] = env.store.human_tasks("i1")
    from harness import humantasks
    res = humantasks.respond(env.store, task["task_id"], responder_ids=["owner"], source="local", now=env.clock(),
                             answers={"option": "give guidance and retry", "guidance": "reviewer bug fixed"})
    assert res["released"] == ["i1"] and env.state("i1") == "Ready"
    env.adapter.scripts["i1", "reviewer"] = []
    events = env.tick()
    assert any(e["event"] == "resumed_review" for e in events)
    assert len([r for r in env.adapter.started if r.role == "implementer"]) == implementers_before  # nothing was implemented again
    env.run_until(lambda: env.state("i1") == "Done")


def test_resume_is_refused_when_the_branch_moved_or_checks_are_missing(tmp_path):
    env = Env(tmp_path, issues=[("i1", "P1", ["F1.1"])], budgets=dict(LONG_BUDGETS))
    issue = env.store.get_issue("i1")
    issue.update(head_rev="abc", pr=5)
    assert env.sched._resume_in_review(issue, env.clock()) is False  # no branch in the repository
    env.repo.set_branch("harness/i1", ["src/x.py"], head="abc")
    assert env.sched._resume_in_review(issue, env.clock()) is False  # no passing checks bound to that head
    env.store.add_evidence("i1", "checks", "abc", env.repo.base_head(), "pass", {}, env.clock())
    env.repo.branches["harness/i1"]["head"] = "moved"
    assert env.sched._resume_in_review(issue, env.clock()) is False  # the branch is no longer at the checked head
    env.repo.branches["harness/i1"]["head"] = "abc"
    issue["pr"] = None
    assert env.sched._resume_in_review(issue, env.clock()) is False  # no pull request


# -- refiners: a real question carries the reason, and a retry is never an identical duplicate -------------------------------

def stale_issue_env(tmp_path, **script):
    env = Env(tmp_path, issues=[], budgets=dict(LONG_BUDGETS))
    env.add_issue("i1", "P1", ["F1.1"], code_anchors=["src/index.html", "src/new-module.js"], contract_paths=["src/new-module.js"])
    env.repo.existing = {"src/index.html"}  # new-module.js is a file the issue will create
    env.repo.advance_base(["src/index.html"])  # an earlier issue merged a change to the same file
    return env


def test_a_refiner_that_needs_the_owner_raises_a_decision_task_with_its_reasons(tmp_path):
    env = stale_issue_env(tmp_path)
    env.adapter.script("i1", "refiner", "needs_input")
    env.start()
    events = env.run_until(lambda: env.state("i1") == "Blocked")
    assert any(e["event"] == "refiner_needs_input" for e in events)
    issue = env.store.get_issue("i1")
    assert "whether the disclaimer repeats after a reload" in issue["blocked_reason"] and issue["repair_failures"] == 0
    [task] = env.store.human_tasks("i1")
    from harness import humantasks
    text = humantasks.render_task(task)
    assert "whether the disclaimer repeats after a reload" in text and "needs_input" in text  # the owner can decide with real information
    assert env.store.get_attempt("i1#1")["outcome"] == "Succeeded"  # a valid answer, not a failure


def test_a_refiner_is_told_what_changed_and_which_anchors_are_new_files(tmp_path):
    env = stale_issue_env(tmp_path)
    env.start()
    env.run_until(lambda: env.state("i1") == "Done")
    refiner = next(r for r in env.adapter.started if r.role == "refiner")
    data = refiner.packet["untrusted_data"]
    assert "src/index.html" in data and "changed_since_refinement" in data
    assert "src/new-module.js" in data and "anchors_that_do_not_exist_yet" in data
    assert "new files the task will create" in adapter_prompt()


def adapter_prompt():
    from harness.adapter import ROLE_INSTRUCTIONS
    return ROLE_INSTRUCTIONS["refiner"]


def test_a_confused_refiner_failure_keeps_its_reason_and_the_retry_is_not_a_duplicate(tmp_path):
    env = stale_issue_env(tmp_path)
    env.adapter.script("i1", "refiner", "not_sure")
    env.start()
    env.run_until(lambda: env.state("i1") == "Done")
    first = env.store.get_attempt("i1#1")
    assert first["failure_kind"] == "schema_invalid" and "not_sure" in first["detail"] and "whether the disclaimer repeats" in first["detail"]
    refiners = [r for r in env.adapter.started if r.role == "refiner"]
    assert len(refiners) == 2 and "your_previous_answer_was_rejected" in refiners[1].packet["untrusted_data"]
    assert "your_previous_answer_was_rejected" not in refiners[0].packet["untrusted_data"]


# -- publishing problems fail an attempt, never the run; repairs continue the pushed branch; rebased branches are published -------------

from harness.broker import BrokerRejected  # noqa: E402
from harness.checks import DryRunPublisher  # noqa: E402
from harness.github import GitHubError  # noqa: E402


class FlakyPublisher(DryRunPublisher):
    """TEST DOUBLE: a publisher that fails on demand with the errors GitHub or git would raise."""

    def __init__(self, repo=None):
        super().__init__(repo)
        self.open_errors, self.merge_errors, self.update_errors = [], [], []

    def open_pr(self, issue, branch, head_rev):
        if self.open_errors:
            raise self.open_errors.pop(0)
        return super().open_pr(issue, branch, head_rev)

    def merge(self, issue, pr, head_rev):
        if self.merge_errors:
            raise self.merge_errors.pop(0)
        return super().merge(issue, pr, head_rev)

    def update_branch(self, issue, branch, old_head, new_head):
        if self.update_errors:
            raise self.update_errors.pop(0)
        super().update_branch(issue, branch, old_head, new_head)


def flaky_env(tmp_path, **kw):
    env = Env(tmp_path, issues=[("i1", "P1", ["F1.1", "F1.2"])], budgets=dict(LONG_BUDGETS), **kw)
    env.publisher = env.sched.publisher = FlakyPublisher()
    return env


def test_a_rejected_push_fails_the_attempt_and_the_run_carries_on(tmp_path):
    """Regression: 'push of harness/x failed: behind its remote' used to crash the whole run."""
    env = flaky_env(tmp_path)
    env.publisher.open_errors = [GitHubError("push of harness/i1 failed: ! [rejected] harness/i1 -> harness/i1 (non-fast-forward) behind its remote")]
    env.start()
    env.tick()
    env.tick()  # must not raise
    first = env.store.get_attempt("i1#1")
    assert first["failure_kind"] == "push_rejected" and first["failure_class"] == "deterministic" and first["outcome"] == "Failed"
    assert env.store.state("attempt", "i1#1") == "Failed"  # the store agrees with the attempt record
    assert env.store.get_issue("i1")["repair_failures"] == 1
    env.run_until(lambda: env.state("i1") == "Done")


def test_other_github_errors_while_publishing_are_transient_and_retried(tmp_path):
    env = flaky_env(tmp_path)
    env.publisher.open_errors = [GitHubError("HTTP 502 Bad Gateway")]
    env.start()
    env.run_until(lambda: env.store.get_issue("i1")["transient_failures"] == 1)
    assert env.store.get_attempt("i1#1")["failure_class"] == "transient"
    env.run_until(lambda: env.state("i1") == "Done", advance=60)


def test_a_broker_refusal_while_publishing_is_handled_too(tmp_path):
    env = flaky_env(tmp_path)
    env.publisher.open_errors = [BrokerRejected("pushes are limited to harness/<issue>-<slug> branches")]
    env.start()
    env.tick()
    env.tick()
    assert env.store.get_attempt("i1#1")["outcome"] == "Failed"


def test_github_refusing_a_merge_sends_the_issue_back_for_repair(tmp_path):
    env = flaky_env(tmp_path)
    env.publisher.merge_errors = [GitHubError("HTTP 405: Pull Request is not mergeable")]
    env.start()
    events = env.run_until(lambda: any(e["event"] == "merge_failed" for e in env.sched.events), limit=40)
    assert env.state("i1") == "In Progress" or env.state("i1") == "Ready"
    assert env.store.get_issue("i1")["last_failures"][-1]["kind"] == "merge_conflict"
    env.run_until(lambda: env.state("i1") == "Done")


def test_a_transient_merge_error_is_retried_and_five_in_a_row_block_with_a_task(tmp_path):
    env = flaky_env(tmp_path)
    env.publisher.merge_errors = [GitHubError("HTTP 503 Service Unavailable")] * 2
    env.start()
    env.run_until(lambda: env.state("i1") == "Done")
    assert env.store.get_issue("i1")["merge_retries"] == 2
    env2 = flaky_env(tmp_path / "b")
    env2.publisher.merge_errors = [GitHubError("HTTP 502 Bad Gateway")] * 20
    env2.start()
    env2.run_until(lambda: env2.state("i1") == "Blocked")
    assert "kept failing to merge" in env2.store.get_issue("i1")["blocked_reason"] and len(env2.store.human_tasks("i1")) == 1


def test_a_branch_rebased_by_the_harness_is_published_before_the_merge(tmp_path):
    """Regression: the merge is bound to the rebased head, which GitHub only knows if it was pushed."""
    env = flaky_env(tmp_path)
    env.adapter.script("i1", "reviewer", "hang")
    env.start()
    env.run_until(lambda: any(r.role == "reviewer" for r in env.adapter.started))
    old_head = env.store.get_issue("i1")["head_rev"]
    env.repo.advance_base(["docs/elsewhere.md"])
    next(h["handle"] for h in env.sched.handles.values() if h["handle"].req.role == "reviewer").step = "ok"
    env.run_until(lambda: env.state("i1") == "Done")
    update = next(i for i in env.publisher.intents if i["action"] == "update_branch")
    merge = next(i for i in env.publisher.intents if i["action"] == "merge_pr")
    assert update["old"] == old_head and update["new"] == merge["head"] != old_head
    assert env.publisher.intents.index(update) < env.publisher.intents.index(merge)
    assert env.repo.pinned("i1") == merge["head"]


def test_a_failed_branch_publication_is_retried_without_merging(tmp_path):
    env = flaky_env(tmp_path)
    env.adapter.script("i1", "reviewer", "hang")
    env.start()
    env.run_until(lambda: any(r.role == "reviewer" for r in env.adapter.started))
    env.repo.advance_base(["docs/elsewhere.md"])
    env.publisher.update_errors = [GitHubError("publishing the rebased harness/i1 failed: stale info")]
    next(h["handle"] for h in env.sched.handles.values() if h["handle"].req.role == "reviewer").step = "ok"
    events = env.run_until(lambda: any(e["event"] == "publish_failed" for e in env.sched.events), limit=30)
    assert not [i for i in env.publisher.intents if i["action"] == "merge_pr"]
    env.run_until(lambda: env.state("i1") == "Done")


def test_a_repair_attempt_continues_the_branch_that_already_has_a_pull_request(tmp_path):
    """Regression: a repair used to start from main, so its push diverged from the pushed branch and was rejected."""
    env = flaky_env(tmp_path)
    env.adapter.verdicts["i1"] = ["changes_requested", "approve"]
    env.start()
    env.run_until(lambda: env.state("i1") == "Done")
    implementers = [r for r in env.adapter.started if r.role == "implementer"]
    assert len(implementers) == 2
    assert "resume_from" not in implementers[0].packet and implementers[1].packet["resume_from"] == "harness-good/i1"
    assert env.repo.pinned("i1") == env.store.get_issue("i1")["head_rev"]


def test_start_pins_heads_recorded_before_pinning_existed(tmp_path):
    env = flaky_env(tmp_path)
    issue = env.store.get_issue("i1")
    issue["head_rev"] = "abc123"
    env.store.put_issue(issue)
    assert env.repo.pinned("i1") is None
    env.start()
    assert env.repo.pinned("i1") == "abc123"


# -- the run output names each step, including the pull request and the merge ---------------------------------------------

def test_the_run_reports_when_a_pull_request_is_opened_and_merged(tmp_path):
    env = flaky_env(tmp_path)
    env.start()
    events = env.run_until(lambda: env.state("i1") == "Done")
    names = [e["event"] for e in events]
    assert names.index("pr_opened") < names.index("in_review") + 2 and names.index("in_review") < names.index("review") < names.index("merged") < names.index("done")
    merged = next(e for e in events if e["event"] == "merged")
    assert merged["issue"] == "i1" and merged["head"] == env.store.get_issue("i1")["head_rev"][:12] and merged["simulated"] is True


def test_an_attempt_fenced_while_its_replacement_was_claimed_stops_showing_as_running(tmp_path):
    """Regression: after a crash, the abandoned attempt kept an empty outcome and showed as 'running' forever."""
    env = Env(tmp_path, issues=[("i1", "P1", ["F1.1", "F1.2"])], budgets={"lease_s": 30})
    env.adapter.script("i1", "implementer", "busy")
    env.start()
    env.tick()
    assert env.store.get_attempt("i1#1")["outcome"] == ""
    # The runner dies. A new claim for the same issue fences the old attempt in the store only.
    env.clock.advance(500)
    env.store.claim("i1", "runner-2", env.clock(), 30)
    assert env.store.state("attempt", "i1#1") == "Fenced" and env.store.get_attempt("i1#1")["outcome"] == ""
    env.sched.handles.clear()
    env.sched.tick(env.clock())
    assert env.store.get_attempt("i1#1")["outcome"] == "Fenced"
