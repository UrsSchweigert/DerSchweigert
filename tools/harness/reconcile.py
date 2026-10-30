"""Audited reconciliation of work completed outside the harness."""
from __future__ import annotations

import json
import time
from typing import Any, Dict

from . import humantasks, machines, plans
from .github import Client, GitHubError
from .store import Store


class ReconciliationError(ValueError):
    pass


def _base_branch(store: Store, issue: Dict[str, Any]) -> str:
    """The branch this issue's pull request merged into: the run branch when the plan uses one."""
    versions = [row["version"] for row in store.list_plans() if row["plan_id"] == issue.get("plan_id")]
    if not versions:
        return "main"
    return plans.base_branch(store.get_plan(issue["plan_id"], max(versions))["plan"])


def reconcile_completion(store: Store, client: Client, issue_id: str, pr_number: int, head_sha: str,
                         operator: str, now: float | None = None) -> Dict[str, Any]:
    """Verify merged PR evidence at GitHub, then journal legal issue transitions atomically."""
    now = time.time() if now is None else now
    issue = store.get_issue(issue_id)
    if issue is None:
        raise ReconciliationError("unknown harness issue %s" % issue_id)
    if store.state("issue", issue_id) == "Done":
        prior = store.get_doc("external_completion", issue_id)
        if prior and prior.get("pr") == pr_number and prior.get("head_sha") == head_sha.lower():
            return dict(prior, already_reconciled=True)
        raise ReconciliationError("issue is already Done with different completion evidence")
    if issue.get("pr") is not None and int(issue["pr"]) != pr_number:
        raise ReconciliationError("PR #%d does not match issue's recorded PR #%s" % (pr_number, issue["pr"]))
    if store.active_claims_for(issue_id):
        raise ReconciliationError("issue has an active worker claim")
    if any(t["state"] in humantasks.OPEN_STATES for t in store.human_tasks(issue_id)):
        raise ReconciliationError("issue has unresolved human tasks")
    if len(head_sha) != 40 or any(c not in "0123456789abcdefABCDEF" for c in head_sha):
        raise ReconciliationError("head SHA must be a full 40-character commit id")

    try:
        base = _base_branch(store, issue)
        protection = client.merge_protection(base)
        required_checks = protection.get("required_checks", [])
        if not required_checks:
            raise ReconciliationError("effective GitHub rules expose no required checks to verify")
        proof = client.completion_evidence(pr_number, required_checks)
    except GitHubError as exc:
        raise ReconciliationError("could not verify GitHub completion evidence: %s" % exc) from exc

    expected_head = head_sha.lower()
    if not proof.get("merged") or proof.get("state") != "closed":
        raise ReconciliationError("PR #%d is not merged and closed" % pr_number)
    if int(proof.get("number", -1)) != pr_number:
        raise ReconciliationError("GitHub returned a different pull request number")
    if proof.get("head_sha") != expected_head:
        raise ReconciliationError("PR head SHA does not match the supplied SHA")
    if proof.get("head_ref") != issue.get("branch"):
        raise ReconciliationError("PR head branch does not match the harness issue branch")
    if proof.get("head_repository") != client.repo:
        raise ReconciliationError("PR head repository does not match the configured repository")
    if proof.get("base_ref") != base:
        raise ReconciliationError("PR base branch does not match the configured base branch %r" % base)
    if not proof.get("merge_commit_sha") or not proof.get("base_sha"):
        raise ReconciliationError("GitHub did not provide the merge commit and base revisions")
    successful = {c.get("name") for c in proof.get("checks", []) if c.get("conclusion") == "success"}
    missing = sorted(set(required_checks) - successful)
    if missing:
        raise ReconciliationError("required checks are missing or failing: %s" % ", ".join(missing))

    existing_review = any(e["head_rev"] == expected_head and e["verdict"] == "approve"
                          for e in store.evidence(issue_id, "review"))
    approvals = [review for review in proof.get("approvals", [])
                 if review.get("state") == "APPROVED" and review.get("login", "").lower() != proof.get("author", "").lower()]
    if not existing_review and not approvals:
        raise ReconciliationError("no passing harness review or verified GitHub approval exists; none was fabricated")

    key = "pr-%d-%s" % (pr_number, expected_head)
    record = {
        "issue_id": issue_id, "pr": pr_number, "head_sha": expected_head,
        "merge_commit_sha": proof["merge_commit_sha"], "base_sha": proof["base_sha"],
        "operator": operator, "reconciled_at": now, "source": "GitHub API",
        "checks": proof["checks"], "required_checks": proof["required_checks"],
        "approvals": approvals,
    }
    if store.get_doc("external_completion", issue_id):
        raise ReconciliationError("issue already has an external completion record")

    with store.tx() as cx:
        for kind, head, base, verdict, detail in (
            ("checks", expected_head, proof["base_sha"], "pass", {"source": "GitHub API", "pr": pr_number,
             "required_checks": proof["required_checks"], "checks": proof["checks"], "operator": operator}),
            ("merge", expected_head, proof["merge_commit_sha"], "merged", {"source": "GitHub API", "pr": pr_number,
             "merge_commit_sha": proof["merge_commit_sha"], "operator": operator}),
            ("integrated", expected_head, proof["merge_commit_sha"], "pass", {"source": "GitHub API", "pr": pr_number,
             "required_checks": proof["required_checks"], "checks": proof["checks"], "operator": operator}),
        ):
            cx.execute("INSERT INTO evidence(issue_id,kind,head_rev,base_rev,verdict,detail,created_at) VALUES(?,?,?,?,?,?,?)",
                       (issue_id, kind, head, base, verdict, json.dumps(detail, sort_keys=True), now))
        if not existing_review:
            review = {"source": "GitHub API", "pr": pr_number, "approvals": approvals, "operator": operator}
            cx.execute("INSERT INTO evidence(issue_id,kind,head_rev,base_rev,verdict,detail,created_at) VALUES(?,?,?,?,?,?,?)",
                       (issue_id, "review", expected_head, proof["base_sha"], "approve", json.dumps(review, sort_keys=True), now))

        actor = "operator:" + operator
        state = store.state("issue", issue_id)
        path = {"Inbox": ["Refining", "Ready", "In Progress", "In Review"],
                "Refining": ["Ready", "In Progress", "In Review"],
                "Ready": ["In Progress", "In Review"],
                "Blocked": ["Ready", "In Progress", "In Review"],
                "In Progress": ["In Review"],
                "In Review": []}.get(state)
        if path is None:
            raise ReconciliationError("cannot reconcile an issue in state %r" % state)
        current = state
        for next_state in path:
            machines.check_transition("issue", current, next_state)
            store._transition(cx, "issue", issue_id, next_state, actor,
                              {"external_completion": record, "reason": "verified merged work"}, None, now)
            current = next_state
        machines.check_transition("issue", current, "Done")
        store._transition(cx, "issue", issue_id, "Done", actor, {"external_completion": record}, "external-completion:" + key, now)
        store.put_doc("external_completion", issue_id, record)
    return record
