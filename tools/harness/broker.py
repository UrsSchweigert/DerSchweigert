"""Trusted broker: the only component that holds a GitHub client. Workers submit action proposals.

Every proposal is schema-validated, checked against the signed approval record, the plan state, the
isolation tier, the current lease epoch, and the approved scope before anything is written remotely.
"""
from __future__ import annotations

import os
import re
from typing import Any, Dict, List, Mapping, Optional, Sequence

from . import approval, schemas
from .github import Client, with_retries
from .isolation import scrub_env  # noqa: F401  (re-exported)
from .store import Store, StaleLease
from .workrecord import ensure_issue, sanitize_untrusted, sha

ACTION_OPERATION = {
    "create_issue": "issue_project_updates",
    "update_issue": "issue_project_updates",
    "comment": "issue_project_updates",
    "request_human_task": "issue_project_updates",
    "push_branch": "pushes",
    "open_pr": "pull_requests",
    "merge_pr": "eligible_merges",
    "asset_request": "asset_requests",
}

# Never reachable by workers, whatever the plan allowlist says.
ALWAYS_PROTECTED = (".git/", ".github/", "tools/harness/", "docs/harness/")

_SECRET_VALUE = re.compile(r"(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----)")


WORKER_BRANCH = re.compile(r"^harness/[A-Za-z0-9][A-Za-z0-9._-]*(/[A-Za-z0-9][A-Za-z0-9._-]*)*$")


class BrokerRejected(Exception):
    pass


def check_branch_target(ref: str, force: bool = False) -> str:
    """Branch protection by convention: workers push only to harness/* branches and never force-push."""
    name = ref[len("refs/heads/"):] if ref.startswith("refs/heads/") else ref
    if force:
        raise BrokerRejected("force pushes are not allowed")
    if not WORKER_BRANCH.match(name) or ".." in name or name.endswith(".lock") or name.endswith("/"):
        raise BrokerRejected("pushes are limited to harness/<issue>-<slug> branches, not %r" % ref)
    return name


def assert_no_secrets(value: Any, where: str = "document") -> None:
    if isinstance(value, str):
        if _SECRET_VALUE.search(value):
            raise BrokerRejected("%s contains something that looks like a credential" % where)
    elif isinstance(value, dict):
        for k, v in value.items():
            assert_no_secrets(v, "%s.%s" % (where, k))
    elif isinstance(value, list):
        for i, v in enumerate(value):
            assert_no_secrets(v, "%s[%d]" % (where, i))


def prepare_task_packet(packet: Dict[str, Any], store_home: str, worktree: str) -> Dict[str, Any]:
    """Validate a packet for a worker. It must carry no credentials and no path into the private store."""
    schemas.validate(packet, schemas.TASK_PACKET, "task_packet")
    assert_no_secrets(packet, "task_packet")
    home = os.path.realpath(store_home)
    if home in json_strings(packet):
        raise BrokerRejected("task packet exposes the private store location")
    assert_store_unreachable(worktree, store_home)
    out = dict(packet)
    out["untrusted_data"] = sanitize_untrusted(packet["untrusted_data"])
    return out


def json_strings(value: Any) -> List[str]:
    if isinstance(value, str):
        return [value]
    if isinstance(value, dict):
        return [s for v in value.values() for s in json_strings(v)]
    if isinstance(value, list):
        return [s for v in value for s in json_strings(v)]
    return []


def assert_store_unreachable(worktree: str, store_home: str) -> None:
    """The store, approval key, and policy must not live inside the worker's writable tree."""
    wt, home = os.path.realpath(worktree), os.path.realpath(store_home)
    if home == wt or home.startswith(wt + os.sep) or wt.startswith(home + os.sep):
        raise BrokerRejected("worker worktree and private store overlap")


def is_escalation(path: str, escalation: Sequence[str]) -> bool:
    """Match modes, so a policy can name files, directories, and binary types:
    a plain name matches a prefix or the exact path, and also any path with that base name
    (`sites/x/package.json` counts as `package.json`); an entry ending in `/` matches a directory of that
    name at any depth (third-party `addons/`); an entry starting with `*.` matches a file suffix (`*.so`)."""
    p = os.path.normpath(path).replace(os.sep, "/")
    for entry in escalation:
        raw = str(entry).replace(os.sep, "/").strip()
        if not raw:
            continue
        if raw.startswith("*."):
            if p.lower().endswith(raw[1:].lower()):
                return True
            continue
        is_dir = raw.endswith("/")
        normal = os.path.normpath(raw).replace(os.sep, "/")
        if is_dir:
            if p == normal or p.startswith(normal + "/") or ("/" + normal + "/") in ("/" + p):
                return True
        elif p.startswith(normal) or p == normal or ("/" not in normal and os.path.basename(p) == normal):
            return True
    return False


def check_changed_paths(changed: Sequence[str], allowlist: Sequence[str], escalation: Sequence[str]) -> Dict[str, List[str]]:
    """Classify a worker diff. Anything in `rejected` or `out_of_scope` blocks the work. `escalate` needs a human task."""
    result: Dict[str, List[str]] = {"rejected": [], "out_of_scope": [], "escalate": []}
    for raw in changed:
        path = os.path.normpath(raw).replace(os.sep, "/")
        if path.startswith("../") or path.startswith("/") or path == "..":
            result["rejected"].append(raw)
        elif any(path.startswith(p) or path + "/" == p for p in ALWAYS_PROTECTED):
            result["rejected"].append(raw)
        elif not any(path.startswith(a) for a in allowlist):
            result["out_of_scope"].append(raw)
        elif is_escalation(path, escalation):
            result["escalate"].append(raw)
    return result


class Broker:
    def __init__(self, store: Store, client: Client, plan_id: str, version: int, allowlist: Sequence[str],
                 isolation: Optional[Dict[str, str]] = None, sleep=None, assets=None):
        self._store, self._client, self._assets = store, client, assets
        self.plan_id, self.version, self.allowlist = plan_id, version, list(allowlist)
        self._isolation, self._sleep = isolation, sleep

    def execute(self, proposal: Dict[str, Any], now: float, dry_run: bool = False) -> Dict[str, Any]:
        try:
            schemas.validate(proposal, schemas.ACTION_PROPOSAL, "proposal")
        except schemas.SchemaError as exc:
            raise BrokerRejected("invalid proposal: %s" % exc)
        assert_no_secrets(proposal, "proposal")
        action = proposal["action"]
        try:
            approval.authorize_operations(self._store, self.plan_id, self.version, [ACTION_OPERATION[action]], self._isolation,
                                          attempt_id=proposal["attempt_id"], epoch=proposal["epoch"], now=now, dry_run=dry_run)
        except approval.AuthorizationError as exc:
            raise BrokerRejected("approval check failed: %s" % exc)
        self._now = now
        handler = getattr(self, "_do_" + action, None)
        if handler is None:
            raise BrokerRejected("%s is not implemented yet, failing closed" % action)
        plan = self._store.get_plan(self.plan_id, self.version)["plan"]
        return handler(proposal, plan, dry_run)

    # -- handlers -------------------------------------------------------------

    def _managed_numbers(self) -> set:
        return {o["remote_ref"] for o in self._store.sync_ops() if o["remote_ref"] and o["kind"] != "comment"}

    def _payload(self, proposal: Dict[str, Any], spec: Dict[str, Any]) -> Dict[str, Any]:
        try:
            return schemas.validate(proposal["payload"], spec, "payload")
        except schemas.SchemaError as exc:
            raise BrokerRejected("invalid payload: %s" % exc)

    def _scope(self, plan: Dict[str, Any], phase_id: str, req_ids: Sequence[str]) -> Dict[str, Any]:
        phase = next((p for p in plan["phases"] if p["id"] == phase_id), None)
        if phase is None:
            raise BrokerRejected("unknown phase %s" % phase_id)
        if not req_ids or not set(req_ids) <= set(phase["requirements"]):
            raise BrokerRejected("issue must reference requirement IDs from phase %s" % phase_id)
        return phase

    def _issue(self, plan, kind, key, title, content, labels, dry_run, required=()) -> Dict[str, Any]:
        base = plan["plan_id"]
        digest = sha(key)[:16]
        return ensure_issue(self._client, self._store, "%s/%s/%s" % (base, kind, digest), kind,
                            "%s/%s/%s" % (plan["plan_id"], kind, digest), title, content, labels, self.allowlist,
                            required_tokens=required, dry_run=dry_run, sleep=self._sleep)

    def _do_create_issue(self, proposal, plan, dry_run):
        p = self._payload(proposal, {"key": str, "title": str, "content": str, "phase_id": str, "requirement_ids": [str]})
        self._scope(plan, p["phase_id"], p["requirement_ids"])
        content = "Phase `%s`. Requirements: %s.\n\n%s" % (p["phase_id"], ", ".join(p["requirement_ids"]), sanitize_untrusted(p["content"]))
        return self._issue(plan, "implementation", p["key"], p["title"][:200], content, ["harness", "harness:implementation"], dry_run)

    def _do_update_issue(self, proposal, plan, dry_run):
        p = self._payload(proposal, {"key": str, "number": int, "content": str, "phase_id": str, "requirement_ids": [str]})
        self._scope(plan, p["phase_id"], p["requirement_ids"])
        op = next((o for o in self._store.sync_ops("implementation") if o["remote_ref"] == p["number"]), None)
        if op is None:
            raise BrokerRejected("issue %d is not a harness implementation issue" % p["number"])
        content = "Phase `%s`. Requirements: %s.\n\n%s" % (p["phase_id"], ", ".join(p["requirement_ids"]), sanitize_untrusted(p["content"]))
        return ensure_issue(self._client, self._store, op["op_key"], "implementation", op["stable_id"], "", content,
                            [], self.allowlist, dry_run=dry_run, sleep=self._sleep)

    def _do_comment(self, proposal, plan, dry_run):
        p = self._payload(proposal, {"key": str, "number": int, "body": str})
        if p["number"] not in self._managed_numbers():
            raise BrokerRejected("issue %d is not a harness-managed issue" % p["number"])
        op_key = "%s/comment/%s" % (plan["plan_id"], sha("%d:%s" % (p["number"], p["key"]))[:16])
        if (self._store.sync_get(op_key) or {}).get("status") == "done":
            return {"op": op_key, "action": "noop", "number": p["number"]}
        if dry_run:
            return {"op": op_key, "action": "comment", "number": p["number"], "dry_run": True}
        self._store.sync_put(op_key, "comment", op_key, "pending", p["number"])
        with_retries(lambda: self._client.add_comment(p["number"], sanitize_untrusted(p["body"], 2000)), sleep=self._sleep)
        self._store.sync_put(op_key, "comment", op_key, "done", p["number"])
        return {"op": op_key, "action": "comment", "number": p["number"]}

    def _do_request_human_task(self, proposal, plan, dry_run):
        p = self._payload(proposal, {"key": str, "title": str, "content": str, "blocks": int})
        if p["blocks"] not in self._managed_numbers():
            raise BrokerRejected("human task must block a harness-managed issue")
        content = "Blocks #%d.\n\n%s" % (p["blocks"], sanitize_untrusted(p["content"]))
        return self._issue(plan, "human_task", p["key"], p["title"][:200], content, ["harness", "human-task"], dry_run)

    def _do_asset_request(self, proposal, plan, dry_run):
        """Workers never call Blender. The broker validates the request against the asset policy and runs the sources in order."""
        from .assets import validate_request
        req = proposal["payload"]
        if self._store.get_issue(str(req.get("issue_id", ""))) is None:
            raise BrokerRejected("asset request names an unknown issue")
        problems = validate_request(plan["policy"], req)
        if problems:
            return {"status": "rejected", "problems": problems}
        if dry_run:
            return {"status": "valid", "dry_run": True, "request_id": req["request_id"]}
        if self._assets is None:
            raise BrokerRejected("asset generation is not configured")
        return self._assets.handle(req, self._now)
