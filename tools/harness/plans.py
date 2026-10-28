"""Plan construction, validation, and the scope-and-policy digest."""
from __future__ import annotations

import copy
import hashlib
import json
import os
import re
from typing import Any, Dict, List, Optional, Tuple

from . import schemas

ALLOWED_OPERATIONS = [
    "issue_project_updates", "isolated_branches", "commits", "pushes", "pull_requests", "eligible_merges", "asset_requests",
]

# Spec defaults. docs/harness/decisions.md overrides: autonomous merge, tiers low/standard/strong.
DEFAULT_POLICY: Dict[str, Any] = {
    "authorized_operations": list(ALLOWED_OPERATIONS),
    "escalation_paths": [
        ".github/workflows/", "tools/harness/", "docs/harness/", ".github/CODEOWNERS",
        "package.json", "package-lock.json", "requirements.txt", "build.gradle", "settings.gradle", "AndroidManifest.xml", "infra/", "migrations/",
    ],
    "merge_policy": "autonomous-when-all-gates-pass",
    "budgets": {
        "concurrent_workers": 2, "repair_attempts": 2, "strong_attempts_per_issue": 1, "transient_retries": 3, "delegator_consults_per_issue": 1,
        "analyses_per_issue": 1,
        "worker_timeout_s": 1800, "inactivity_timeout_s": 600, "heartbeat_s": 30, "lease_s": 90,
        "run_wall_clock_s": 28800, "pull_requests_per_run": 20, "github_write_retries": 5,
        "human_reminder_after_s": 86400, "human_reminders_max": 3, "human_escalation_after_s": 259200,
    },
    "model_tiers": {"low": ["claude-haiku-4.5"], "standard": ["claude-sonnet-5"], "strong": ["claude-opus-5", "claude-opus-4.8"]},
    "diff_size_cap": 800,
    "assets": {
        "allowed_sources": ["repository", "cc0_library", "procedural"],
        "allowed_licenses": ["CC0-1.0"],
        "attribution_required_licenses": [],
        "paid_generation_credits": 0,
        "classes": {
            "model3d": {"formats": ["glb", "gltf"], "max_bytes": 5000000, "max_triangles": 100000, "max_texture_px": 2048, "max_bbox_m": 20.0},
            "texture": {"formats": ["png", "jpg"], "max_bytes": 4000000, "max_texture_px": 2048},
            "sprite": {"formats": ["png"], "max_bytes": 1000000, "max_texture_px": 1024},
            "hdri": {"formats": ["hdr", "exr"], "max_bytes": 20000000, "max_texture_px": 4096},
        },
        "output_dir": "assets/",
        "name_pattern": "^[a-z0-9][a-z0-9_-]*\\.[a-z0-9]+$",
        "visual_fit_needs_human": False,
    },
    "manual_testing": {"allowed_reasons": ["visual_judgment", "physical_device", "native_dialog", "restricted_environment", "one_off_interaction"]},
}

_REQ_ROW = re.compile(r"^\|\s*\*\*([A-Za-z]*\d+(?:\.\d+)*)\*\*\s*\|\s*\*\*(.+?)\*\*\s*\|")
_COMMAND_DENY = re.compile(r"(\bcurl\b|\bwget\b|\bssh\b|\bscp\b|\bsudo\b|\brm\s+-[a-z]*r[a-z]*f?\s+/|\bgit\s+push\b|\bgh\s|\bdocker\b|\bnpm\s+publish\b|\bnpx\b)", re.I)


def command_problem(command: str) -> Optional[str]:
    if _COMMAND_DENY.search(command):
        return "command uses a prohibited network, privilege, container, or publishing tool"
    return None


def parse_requirements(path: str) -> List[Dict[str, str]]:
    """Extract stable requirement IDs from table rows like `| **1.1** | **Title** | ...`."""
    source = os.path.basename(path)
    reqs, seen = [], set()
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            m = _REQ_ROW.match(line)
            if m and m.group(1) not in seen:
                seen.add(m.group(1))
                reqs.append({"id": m.group(1), "title": m.group(2).strip(), "source": source})
    return reqs


def canonical(obj: Any) -> bytes:
    return json.dumps(obj, sort_keys=True, separators=(",", ":")).encode("utf-8")


def _hashable(plan: Dict[str, Any]) -> Dict[str, Any]:
    """Requirement IDs and sources, phase scope, and policy. Titles, statuses, and progress are excluded."""
    return {
        "fixture": bool(plan.get("fixture", False)),
        "requirements": sorted(({"id": r["id"], "source": r["source"]} for r in plan["requirements"]), key=lambda r: r["id"]),
        "phases": sorted(plan["phases"], key=lambda p: p["id"]),
        "policy": plan["policy"],
    }


def plan_digest(plan: Dict[str, Any]) -> str:
    return hashlib.sha256(canonical(_hashable(plan))).hexdigest()


def phase_digests(plan: Dict[str, Any]) -> Dict[str, str]:
    return {p["id"]: hashlib.sha256(canonical({"phase": p, "policy": plan["policy"]})).hexdigest() for p in plan["phases"]}


def changed_phases(old: Dict[str, Any], new: Dict[str, Any]) -> List[str]:
    """Phases whose authorization must be renewed. Everything changes when the policy changes."""
    if old["policy"] != new["policy"]:
        return sorted(p["id"] for p in new["phases"])
    a, b = phase_digests(old), phase_digests(new)
    return sorted(pid for pid in b if a.get(pid) != b[pid])


def validate_plan(plan: Dict[str, Any]) -> List[str]:
    """Return semantic problems. An empty list means the plan may move from Draft to Proposed."""
    schemas.validate(plan, schemas.PLAN, "plan")
    problems: List[str] = []
    req_ids = {r["id"] for r in plan["requirements"]}
    phase_ids = [p["id"] for p in plan["phases"]]
    if not plan["requirements"]:
        problems.append("no requirements found")
    if not plan["phases"]:
        problems.append("no phases defined: supply --phases with outcomes, scope, and exit criteria")
    if len(set(phase_ids)) != len(phase_ids):
        problems.append("duplicate phase ids")
    covered = set()
    for p in plan["phases"]:
        for field in ("outcomes", "requirements", "path_allowlist", "exit_criteria", "validation"):
            if not p[field]:
                problems.append("phase %s: %s is empty" % (p["id"], field))
        for r in p["requirements"]:
            if r not in req_ids:
                problems.append("phase %s: unknown requirement %s" % (p["id"], r))
            covered.add(r)
        for d in p["dependencies"]:
            if d not in phase_ids:
                problems.append("phase %s: unknown dependency %s" % (p["id"], d))
        for pa in p["path_allowlist"]:
            if pa.startswith("/") or ".." in pa.split("/"):
                problems.append("phase %s: unsafe path %s" % (p["id"], pa))
        for command in p["validation"]:
            problem = command_problem(command)
            if problem:
                problems.append("phase %s: validation %r: %s" % (p["id"], command, problem))
        working_directory = p.get("working_directory", ".")
        if not working_directory or os.path.isabs(working_directory) or "\\" in working_directory or ".." in working_directory.split("/"):
            problems.append("phase %s: working_directory must be repository-relative and stay inside the repository" % p["id"])
    for r in sorted(req_ids - covered):
        problems.append("requirement %s is not covered by any phase" % r)
    if _has_cycle(plan["phases"]):
        problems.append("phase dependencies contain a cycle")
    bad_ops = set(plan["policy"]["authorized_operations"]) - set(ALLOWED_OPERATIONS)
    if bad_ops:
        problems.append("policy authorizes operations that plan approval cannot grant: %s" % sorted(bad_ops))
    return problems


def _has_cycle(phases: List[Dict[str, Any]]) -> bool:
    deps = {p["id"]: [d for d in p["dependencies"] if d in {q["id"] for q in phases}] for p in phases}
    state: Dict[str, int] = {}

    def visit(n: str) -> bool:
        if state.get(n) == 1:
            return True
        if state.get(n) == 2:
            return False
        state[n] = 1
        if any(visit(d) for d in deps[n]):
            return True
        state[n] = 2
        return False

    return any(visit(n) for n in deps)


def build_plan(plan_id: str, version: int, requirements: List[Dict[str, str]], phases: Optional[List[Dict[str, Any]]],
               policy: Optional[Dict[str, Any]] = None, fixture: bool = False) -> Dict[str, Any]:
    plan = {
        "plan_id": plan_id,
        "version": version,
        "requirements": requirements,
        "phases": copy.deepcopy(phases or []),
        "policy": copy.deepcopy(policy or DEFAULT_POLICY),
    }
    if fixture:
        plan["fixture"] = True
    return plan
