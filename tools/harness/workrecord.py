"""GitHub work record: marker blocks, idempotent issue ensure, and plan synchronization."""
from __future__ import annotations

import hashlib
import json
import re
from typing import Any, Dict, List, Optional, Sequence

from . import approval, plans
from .github import Client, GitHubError, RateLimited, with_retries
from .store import Store

_BLOCK = re.compile(r"<!-- harness:begin id=(\S+) sha256=([0-9a-f]{64}) -->\n(.*?)\n<!-- harness:end id=\1 -->", re.S)
_MARKER_TEXT = re.compile(r"<!--\s*/?harness:[^>]*-->", re.I)


def sha(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def render_block(stable_id: str, content: str) -> str:
    return "<!-- harness:begin id=%s sha256=%s -->\n%s\n<!-- harness:end id=%s -->" % (stable_id, sha(content), content, stable_id)


def parse_block(body: str, stable_id: str) -> Optional[Dict[str, Any]]:
    """Return the managed block for this id. `checksum_ok` is False when the content no longer matches its header."""
    for m in _BLOCK.finditer(body or ""):
        if m.group(1) == stable_id:
            return {"content": m.group(3), "checksum_ok": sha(m.group(3)) == m.group(2), "sha": sha(m.group(3))}
    return None


def sanitize_untrusted(text: str, limit: int = 4000) -> str:
    """Worker text is data. Strip forged markers and fences, bound the length, and quote it."""
    text = _MARKER_TEXT.sub("[marker removed]", text)[:limit].replace("```", "'''")
    return "```untrusted-worker-output\n%s\n```" % text


def _replace_block(body: str, stable_id: str, content: str) -> str:
    block = render_block(stable_id, content)
    for m in _BLOCK.finditer(body or ""):
        if m.group(1) == stable_id:
            return body[:m.start()] + block + body[m.end():]
    return (body + "\n\n" if body else "") + block


def ensure_issue(client: Client, store: Optional[Store], op_key: str, kind: str, stable_id: str, title: str,
                 content: str, labels: Sequence[str], allowlist: Sequence[str], required_tokens: Sequence[str] = (),
                 milestone: Optional[int] = None, dry_run: bool = False, retries: int = 5,
                 sleep=None) -> Dict[str, Any]:
    """Search before create, adopt what exists, and keep the managed block current. Idempotent.

    Actions: create, adopt-noop, update, restore (block missing or edited by a non-allowlisted author),
    accepted_edit (allowlisted edit that still carries the required tokens), noop.
    """
    def retry(f):
        return with_retries(f, retries=retries, sleep=sleep)

    op = store.sync_get(op_key) if store else None
    number = op["remote_ref"] if op else None
    if number is None:
        found = retry(lambda: client.find_by_marker(stable_id))
        number = found["number"] if found else None
    if number is None:
        result = {"op": op_key, "action": "create", "title": title, "number": None, "dry_run": dry_run}
        if dry_run:
            return result
        store.sync_put(op_key, kind, stable_id, "pending")
        created = retry(lambda: client.create_issue(title, render_block(stable_id, content), list(labels), milestone))
        store.sync_put(op_key, kind, stable_id, "done", created["number"], sha(content))
        result["number"] = created["number"]
        return result

    issue = retry(lambda: client.get_issue(number))
    block = parse_block(issue["body"], stable_id)
    result = {"op": op_key, "number": number, "dry_run": dry_run, "action": "noop"}
    written = op["content_sha"] if op else None
    if block is None:
        result["action"] = "restore"
    else:
        edited = (block["sha"] != written) if written else (not block["checksum_ok"])
        if edited and block["content"] != content:
            editor = issue.get("editor")
            valid = all(t in block["content"] for t in required_tokens)
            if editor in allowlist and valid:
                result.update(action="accepted_edit", editor=editor)
            else:
                result.update(action="restore", ignored_edit_by=editor or "unknown")
        elif block["content"] != content:
            result["action"] = "update"
    if result["action"] in ("restore", "update") and not dry_run:
        store.sync_put(op_key, kind, stable_id, "pending", number)
        retry(lambda: client.update_issue(number, _replace_block(issue["body"], stable_id, content)))
        store.sync_put(op_key, kind, stable_id, "done", number, sha(content))
    elif result["action"] == "noop" and not dry_run and op and op["status"] != "done":
        store.sync_put(op_key, kind, stable_id, "done", number, sha(content))
    elif not dry_run and not op:
        store.sync_put(op_key, kind, stable_id, "done", number, sha(content))
    return result


def _requirements_content(plan: Dict[str, Any], digest: str, nums: Dict[str, Optional[int]]) -> str:
    covered: Dict[str, List[str]] = {}
    for p in plan["phases"]:
        for r in p["requirements"]:
            covered.setdefault(r, []).append(_ref(nums.get("phase:" + p["id"]), p["id"]))
    lines = ["Requirements tracking for plan `%s` version %d (digest `%s`)." % (plan["plan_id"], plan["version"], digest[:12]), ""]
    for r in sorted(plan["requirements"], key=lambda r: r["id"]):
        lines.append("- **%s** %s (source: %s) -> %s" % (r["id"], r["title"], r["source"], ", ".join(covered.get(r["id"], [])) or "uncovered"))
    return "\n".join(lines)


def _ref(number: Optional[int], label: str) -> str:
    return "#%d" % number if number else label


def _phase_content(plan: Dict[str, Any], phase: Dict[str, Any], nums: Dict[str, Optional[int]]) -> str:
    deps = ", ".join(_ref(nums.get("phase:" + d), d) for d in phase["dependencies"]) or "none"
    out = ["Phase `%s` of plan `%s` v%d. Part of %s." % (phase["id"], plan["plan_id"], plan["version"], _ref(nums.get("req"), "requirements issue")), ""]
    for title, key in (("Outcomes", "outcomes"), ("Requirements", "requirements"), ("Path allowlist", "path_allowlist"),
                       ("Non-goals", "non_goals"), ("Exit criteria", "exit_criteria"), ("Validation", "validation")):
        out.append("**%s**: %s" % (title, "; ".join(phase[key])))
    out.append("**Depends on**: " + deps)
    return "\n".join(out)


def sync_plan(client: Client, store: Store, plan_id: str, version: Optional[int], allowlist: Sequence[str],
              dry_run: bool = True, isolation: Optional[Dict[str, str]] = None, sleep=None) -> Dict[str, Any]:
    """Create or reconcile the requirements issue, milestones, and phase issues for an approved plan.

    Dry run reads only and reports intended writes. A real run needs a verified approval and Tier A.
    """
    stored = store.get_plan(plan_id, version)
    if stored is None:
        raise approval.AuthorizationError("unknown plan %s" % plan_id)
    plan = stored["plan"]
    ver = plan["version"]
    if not dry_run:
        iso = isolation or approval.detect_isolation(store)
        if iso["tier"] != "A":
            raise approval.AuthorizationError("remote writes refused, Tier B permits --dry-run only: %s" % iso["reason"])
        record = approval.verify_approval(store, plan_id, ver)
        if "issue_project_updates" not in record["authorized_operations"]:
            raise approval.AuthorizationError("approval does not authorize issue updates")
    digest = stored["digest"]
    base = plan_id
    report: Dict[str, Any] = {"plan_id": plan_id, "version": ver, "dry_run": dry_run, "repo": client.repo, "results": [], "unavailable": [], "pending": []}
    caps = client.capabilities() if hasattr(client, "capabilities") else {}
    native = bool(caps.get("native_sub_issues"))
    report["native_sub_issues"] = native
    if not str(caps.get("projects", "")).startswith("available"):
        report["unavailable"].append("GitHub Project fields: %s" % caps.get("projects", "not probed"))
    if not native:
        report["unavailable"].append("native sub-issues: using explicit links")

    nums: Dict[str, Optional[int]] = {}
    # Resolve existing issue numbers first so the cross-links in every block are stable across runs.
    try:
        for key, stable in [("req", "%s/req" % plan_id)] + [("phase:" + p["id"], "%s/phase/%s" % (plan_id, p["id"])) for p in plan["phases"]]:
            op = store.sync_get("%s/%s" % (base, stable.split("/", 1)[1]))
            found = op["remote_ref"] if op else None
            if found is None:
                hit = with_retries(lambda: client.find_by_marker(stable), sleep=sleep)
                found = hit["number"] if hit else None
            nums[key] = found
    except RateLimited as exc:
        report["pending"].append("rate limited, retries exhausted: %s" % exc)
        return report
    kw = dict(allowlist=allowlist, dry_run=dry_run, sleep=sleep)
    try:
        for pass_no in ((1,) if dry_run else (1, 2)):
            if pass_no == 2:
                # Second pass writes the cross-links now that every number is known.
                report["results"].append({"pass": "link"})
            r = ensure_issue(client, store, "%s/req" % base, "requirements", "%s/req" % plan_id,
                             "Requirements: %s" % plan_id, _requirements_content(plan, digest, nums), ["harness", "harness:requirements"],
                             required_tokens=[q["id"] for q in plan["requirements"]], **kw)
            nums["req"] = r["number"]
            report["results"].append(r)
            for ph in plan["phases"]:
                key = "phase:" + ph["id"]
                ms_title = "%s %s" % (plan_id, ph["id"])
                ms = None
                if pass_no == 1:
                    ms = _ensure_milestone(client, ms_title, "Harness phase %s (plan %s)" % (ph["id"], plan_id), dry_run, report, sleep)
                    nums["ms:" + ph["id"]] = ms
                r = ensure_issue(client, store, "%s/phase/%s" % (base, ph["id"]), "phase", "%s/phase/%s" % (plan_id, ph["id"]),
                                 "Phase %s: %s" % (ph["id"], ph["outcomes"][0]), _phase_content(plan, ph, nums),
                                 ["harness", "harness:phase"], required_tokens=ph["requirements"],
                                 milestone=nums.get("ms:" + ph["id"]), **kw)
                nums[key] = r["number"]
                report["results"].append(r)
        if native and not dry_run:
            for ph in plan["phases"]:
                if nums.get("req") and nums.get("phase:" + ph["id"]):
                    try:
                        with_retries(lambda: client.add_sub_issue(nums["req"], nums["phase:" + ph["id"]]), sleep=sleep)
                    except GitHubError as exc:
                        report["pending"].append("sub-issue link %s: %s" % (ph["id"], exc))
    except RateLimited as exc:
        report["pending"].append("rate limited, retries exhausted: %s" % exc)
    except GitHubError as exc:
        report["pending"].append("GitHub error: %s" % exc)
    report["pending"] += ["%s (%s)" % (o["op_key"], o["status"]) for o in store.pending_sync()]
    return report


def _ensure_milestone(client: Client, title: str, description: str, dry_run: bool, report: Dict[str, Any], sleep=None) -> Optional[int]:
    number = with_retries(lambda: client.find_milestone(title), sleep=sleep)
    if number is None:
        report["results"].append({"op": "milestone:" + title, "action": "create", "number": None, "dry_run": dry_run})
        if dry_run:
            return None
        number = with_retries(lambda: client.create_milestone(title, description), sleep=sleep)
    return number


def sync_human_tasks(client: Client, store: Store, plan_id: str, allowlist: Sequence[str], dry_run: bool = True,
                     isolation: Optional[Dict[str, str]] = None, sleep=None) -> Dict[str, Any]:
    """Mirror open human tasks as GitHub issues so the owner can see and answer them. Idempotent, with the same dry-run rule as sync."""
    if not dry_run:
        iso = isolation or approval.detect_isolation(store)
        if iso["tier"] != "A":
            raise approval.AuthorizationError("remote writes refused, Tier B permits --dry-run only: %s" % iso["reason"])
    report: Dict[str, Any] = {"dry_run": dry_run, "results": [], "pending": []}
    try:
        for task in store.human_tasks():
            if task["state"] not in ("Requested", "Acknowledged", "Submitted", "Validated"):
                continue
            p = task["payload"]
            content = "\n".join(["Human task `%s` (%s) for %s. Owner: @%s." % (task["task_id"], p["kind"], ", ".join(p["issue_ids"]), p["owner"]), "",
                                  "**Why**: " + p["why"], "**Request**: " + p["request"], "**Respond with**: " + json.dumps(p["response_format"], sort_keys=True),
                                  "**Done when**: " + p["resolution_criteria"], "**Options**: " + (", ".join(p["options"]) or "none"),
                                  "", "Answer with `python3 -m harness respond %s ...` or the trusted local command. Comments here do not resolve the task." % task["task_id"]])
            report["results"].append(ensure_issue(client, store, "%s/task/%s" % (plan_id, task["task_id"]), "human_task_issue",
                                                  "%s/task/%s" % (plan_id, task["task_id"]), "Human task: %s" % task["task_id"], content,
                                                  ["harness", "human-task"], allowlist, dry_run=dry_run, sleep=sleep))
    except RateLimited as exc:
        report["pending"].append("rate limited, retries exhausted: %s" % exc)
    except GitHubError as exc:
        report["pending"].append("GitHub error: %s" % exc)
    return report


class GitHubNotifier:
    """Mentions the recipient on the task's GitHub issue. A comment is a notification only. It can never resolve a task."""

    def __init__(self, client: Client, store: Store, plan_id: str):
        self.client, self.store, self.plan_id = client, store, plan_id

    def send(self, recipient: str, subject: str, message: str, task: Dict[str, Any]) -> None:
        op = self.store.sync_get("%s/task/%s" % (self.plan_id, task["task_id"]))
        if op and op.get("remote_ref"):
            self.client.add_comment(op["remote_ref"], "@%s %s: %s" % (recipient, subject, sanitize_untrusted(message, 500)))
