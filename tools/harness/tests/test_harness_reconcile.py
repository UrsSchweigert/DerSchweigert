import json

import pytest

from harness import humantasks
from harness.reconcile import ReconciliationError, reconcile_completion
from harness_doubles import Env
from harness_fakes import FakeGitHub

HEAD = "a" * 40
MERGE = "b" * 40
BASE = "c" * 40


def setup(tmp_path):
    env = Env(tmp_path)
    issue = env.store.get_issue("i1")
    issue.update(pr=12, branch="harness/i1")
    env.store.put_issue(issue)
    github = FakeGitHub()
    github.completion = {
        "state": "closed", "merged": True, "head_sha": HEAD, "head_ref": "harness/i1",
        "head_repository": "owner/repo", "merge_commit_sha": MERGE, "base_sha": BASE,
        "base_ref": "harness/run/fx", "checks": [{"name": "ci", "conclusion": "success"}],
        "approvals": [{"login": "reviewer", "state": "APPROVED"}],
    }
    return env, github


def test_reconcile_records_verified_evidence_and_transitions_legally(tmp_path):
    env, github = setup(tmp_path)
    result = reconcile_completion(env.store, github, "i1", 12, HEAD, "owner", now=1234)

    assert result["source"] == "GitHub API"
    assert env.state("i1") == "Done"
    assert [row["kind"] for row in env.store.evidence("i1")] == ["checks", "merge", "integrated", "review"]
    assert all(json.loads(row["detail"]).get("source") == "GitHub API" for row in env.store.evidence("i1"))
    assert any(row["actor"] == "operator:owner" and row["to_state"] == "Done" for row in env.store.journal(20))


def test_reconcile_is_idempotent_for_the_same_merged_pr(tmp_path):
    env, github = setup(tmp_path)
    first = reconcile_completion(env.store, github, "i1", 12, HEAD, "owner", now=1234)
    second = reconcile_completion(env.store, github, "i1", 12, HEAD, "owner", now=1235)
    assert first["reconciled_at"] == second["reconciled_at"]
    assert second["already_reconciled"] is True
    assert len(env.store.evidence("i1")) == 4


def test_reconcile_does_not_reopen_or_complete_a_cancelled_plan(tmp_path):
    env, github = setup(tmp_path)
    env.store.transition("plan", "fx@v1", "Cancelled", "operator")
    reconcile_completion(env.store, github, "i1", 12, HEAD, "owner", now=1234)
    assert env.state("i1") == "Done"
    assert env.store.state("plan", "fx@v1") == "Cancelled"


@pytest.mark.parametrize("changes,match", [
    ({"head_sha": "d" * 40}, "head SHA"),
    ({"merged": False}, "not merged"),
    ({"approvals": []}, "no passing harness review"),
    ({"head_ref": "other"}, "head branch"),
    ({"head_repository": "fork/repo"}, "head repository"),
])
def test_reconcile_rejects_unverified_completion(tmp_path, changes, match):
    env, github = setup(tmp_path)
    github.completion.update(changes)
    with pytest.raises(ReconciliationError, match=match):
        reconcile_completion(env.store, github, "i1", 12, HEAD, "owner", now=1234)
    assert env.state("i1") == "Ready"
    assert env.store.evidence("i1") == []


def test_reconcile_does_not_invent_missing_review_evidence(tmp_path):
    env, github = setup(tmp_path)
    github.completion["approvals"] = []
    with pytest.raises(ReconciliationError, match="none was fabricated"):
        reconcile_completion(env.store, github, "i1", 12, HEAD, "owner")
    assert env.store.evidence("i1", "review") == []


def test_reconcile_verifies_the_run_branch_the_pull_request_merged_into(tmp_path):
    """Issue pull requests land on the run branch, so that is the branch whose rules and base ref are verified."""
    env, github = setup(tmp_path)
    checked = []
    protection = github.merge_protection
    github.merge_protection = lambda base: (checked.append(base), protection(base))[1]

    result = reconcile_completion(env.store, github, "i1", 12, HEAD, "owner", now=1234)

    assert checked == ["harness/run/fx"]
    assert result["head_sha"] == HEAD and env.state("i1") == "Done"


def test_reconcile_refuses_a_pull_request_that_bypassed_the_run_branch(tmp_path):
    env, github = setup(tmp_path)
    github.completion["base_ref"] = "main"
    with pytest.raises(ReconciliationError, match="base branch"):
        reconcile_completion(env.store, github, "i1", 12, HEAD, "owner", now=1234)
    assert env.store.evidence("i1") == []


def test_reconcile_waits_for_the_open_human_task_then_records_a_blocked_issue(tmp_path):
    """The escalation-path route: the owner's answer closes the decision task first, then the merge is recorded."""
    env, github = setup(tmp_path)
    env.store.transition("issue", "i1", "In Progress", "t")
    env.store.transition("issue", "i1", "Blocked", "t", {"reason": "escalation paths changed"})
    humantasks.request_task(env.store, task_id="decision-i1-1", kind="decision", issue_ids=["i1"], owner="owner", now=1.0,
                            why="escalation paths changed", request="choose", response_format={"required": ["option"]},
                            options=humantasks.DECISION_OPTIONS, resolution_criteria="recorded", block_issues=False)

    with pytest.raises(ReconciliationError, match="unresolved human tasks"):
        reconcile_completion(env.store, github, "i1", 12, HEAD, "owner", now=1234)
    assert env.state("i1") == "Blocked" and env.store.evidence("i1") == []

    env.store.transition("human_task", "decision-i1-1", "Cancelled", "owner")  # stands in for the owner's answer
    reconcile_completion(env.store, github, "i1", 12, HEAD, "owner", now=1235)
    assert env.state("i1") == "Done"
