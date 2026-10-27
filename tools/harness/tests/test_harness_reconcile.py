import json

import pytest

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
        "base_ref": "main", "checks": [{"name": "ci", "conclusion": "success"}],
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
