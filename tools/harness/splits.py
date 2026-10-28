"""Trusted checks on an analysis and the split a worker proposes for a stuck issue. Nothing here applies a split: the owner decides."""
from __future__ import annotations

import os
import re
from typing import Any, Dict, List, Sequence, Set

from . import broker, plans

MAX_PARTS = 6
MAX_TEXT = 2000
ISSUE_ID = re.compile(r"^[a-z0-9][a-z0-9-]{0,40}$")


def _safe_path(path: str) -> bool:
    normal = os.path.normpath(path)
    return bool(path) and not os.path.isabs(path) and normal != "." and not normal.startswith("..") and "\\" not in path


def _under(path: str, prefixes: Sequence[str]) -> bool:
    normal = os.path.normpath(path).replace(os.sep, "/")
    return any(normal == p.rstrip("/") or normal.startswith(p.rstrip("/") + "/") for p in (os.path.normpath(q).replace(os.sep, "/") for q in prefixes))


def _too_long(value: Any) -> bool:
    if isinstance(value, str):
        return len(value) > MAX_TEXT
    if isinstance(value, dict):
        return any(_too_long(v) for v in value.values())
    if isinstance(value, list):
        return any(_too_long(v) for v in value)
    return False


def _has_cycle(parts: List[Dict[str, Any]]) -> bool:
    ids = {p["issue_id"] for p in parts}
    graph = {p["issue_id"]: [d for d in p.get("deps", []) if d in ids] for p in parts}
    state: Dict[str, int] = {}

    def visit(node: str) -> bool:
        if state.get(node) == 1:
            return True
        if state.get(node) == 2:
            return False
        state[node] = 1
        if any(visit(d) for d in graph[node]):
            return True
        state[node] = 2
        return False

    return any(visit(n) for n in graph)


def validate_split(parts: List[Dict[str, Any]], original: Dict[str, Any], phase: Dict[str, Any], existing_ids: Set[str], repo: Any) -> List[str]:
    """Problems that make a proposed split unsafe or incomplete. An empty list means the owner may review it."""
    if not 2 <= len(parts) <= MAX_PARTS:
        return ["a split needs 2 to %d issues, not %d" % (MAX_PARTS, len(parts))]
    problems: List[str] = []
    ids = [p["issue_id"] for p in parts]
    if len(set(ids)) != len(ids):
        problems.append("duplicate issue ids in the split")
    wanted, covered = set(original["requirement_ids"]), set()
    for p in parts:
        iid = p["issue_id"]
        if not ISSUE_ID.match(iid):
            problems.append("issue id %r must be lowercase letters, digits, and dashes" % iid)
        if iid in existing_ids:
            problems.append("issue id %r already exists" % iid)
        reqs = set(p["requirement_ids"])
        if not reqs or not reqs <= wanted:
            problems.append("issue %s: requirement ids must be a non-empty subset of the original's" % iid)
        covered |= reqs & wanted
        if not p["title"].strip() or not p["outcomes"] or not p["acceptance_criteria"] or not p["code_anchors"]:
            problems.append("issue %s: title, outcomes, acceptance criteria, and code anchors are required" % iid)
        for anchor in p["code_anchors"] + p.get("contract_paths", []):
            if not _safe_path(anchor):
                problems.append("issue %s: anchor %r must be a repository-relative path" % (iid, anchor))
            elif not repo.path_exists(anchor) and not _under(anchor, phase["path_allowlist"]):
                problems.append("issue %s: anchor %r does not exist and is not a new path under the phase allowlist" % (iid, anchor))
        for command in p.get("validation_commands", []):
            problem = plans.command_problem(command)
            if problem:
                problems.append("issue %s: validation command %r: %s" % (iid, command, problem))
        directory = p.get("working_directory", ".")
        if not directory or os.path.isabs(directory) or "\\" in directory or ".." in directory.split("/"):
            problems.append("issue %s: working_directory must be repository-relative" % iid)
        for dep in p.get("deps", []):
            if dep == iid or (dep not in ids and dep not in original["deps"]):
                problems.append("issue %s: dependency %s must be another part of the split or a dependency of the original" % (iid, dep))
    problems += ["requirement %s is not covered by any part" % r for r in sorted(wanted - covered)]
    if _has_cycle(parts):
        problems.append("the parts' dependencies contain a cycle")
    return problems


def validate_analysis(analysis: Dict[str, Any], original: Dict[str, Any], phase: Dict[str, Any], existing_ids: Set[str], repo: Any) -> List[str]:
    """Check the whole analysis. The worker's account is advice for the owner, so only its safety and consistency are verified."""
    problems: List[str] = []
    if not analysis["root_cause"].strip():
        problems.append("the analysis needs a root cause")
    if _too_long(analysis):
        problems.append("analysis text is longer than %d characters" % MAX_TEXT)
    try:
        broker.assert_no_secrets(analysis, "analysis")
    except broker.BrokerRejected as exc:
        problems.append(str(exc))
    parts = analysis.get("split")
    if analysis["recommendation"] == "split":
        problems += validate_split(parts, original, phase, existing_ids, repo) if parts else ["a split recommendation needs a split"]
    elif parts:
        problems.append("a split is only allowed with a split recommendation")
    return problems
