"""Plan construction, validation, and the scope-and-policy digest."""
from __future__ import annotations

import copy
import hashlib
import json
import os
import re
import shlex
from typing import Any, Callable, Dict, List, Optional, Sequence, Tuple

from . import models, schemas, sizing

ALLOWED_OPERATIONS = [
    "issue_project_updates", "isolated_branches", "commits", "pushes", "pull_requests", "eligible_merges", "asset_requests",
]

# Spec defaults. docs/harness/decisions.md overrides: autonomous merge, tiers low/standard/strong.
DEFAULT_POLICY: Dict[str, Any] = {
    "authorized_operations": list(ALLOWED_OPERATIONS),
    "escalation_paths": [
        ".github/workflows/", "tools/harness/", "docs/harness/", ".github/CODEOWNERS",
        "package.json", "package-lock.json", "requirements.txt", "build.gradle", "settings.gradle", "AndroidManifest.xml", "infra/", "migrations/",
        # Godot and Android release surface: presets hold signing configuration, addons are third-party code,
        # the Android build template and plugin binaries are native build inputs.
        "export_presets.cfg", "addons/", "apps/arithmoslayer/android/",
        "*.gdextension", "*.so", "*.dylib", "*.dll", "*.aar", "*.jar", "*.apk", "*.aab", "*.keystore", "*.jks",
    ],
    "merge_policy": "autonomous-when-all-gates-pass",
    "base_branch": "main",
    "run_branch": "harness/run/{plan}",
    # A first attempt and one repair may both use the strongest model; only repetition past that is capped.
    "split_pressure": {"enabled": True},
    "budgets": {
        "concurrent_workers": 2, "repair_attempts": 2, "transient_retries": 3, "delegator_consults_per_issue": 1,
        "analyses_per_issue": 1, "strong_attempts_per_issue": 2,
        "worker_timeout_s": 1800, "inactivity_timeout_s": 600, "heartbeat_s": 30, "lease_s": 90,
        # No wall-clock and no pull-request/issue cap by default: a run works until its issues are done or the owner
        # pauses it. Set a number here (or in the plan's policy) to bound a run again.
        "run_wall_clock_s": None, "pull_requests_per_run": None, "github_write_retries": 5,
        "human_reminder_after_s": 86400, "human_reminders_max": 3, "human_escalation_after_s": 259200,
    },
    "model_sources": ["copilot"],
    "model_tiers": {"low": ["claude-haiku-4.5"], "standard": ["claude-sonnet-5"], "strong": ["claude-opus-5", "claude-opus-4.8"]},
    "diff_size_cap": 800,
    "assets": {
        "allowed_sources": ["repository", "cc0_library", "procedural"],
        "allowed_licenses": ["CC0-1.0"],
        "attribution_required_licenses": [],
        "paid_generation_credits": 0,
        # Per-file ceilings, sized against a 150 MB release AAB. A class may override allowed_licenses.
        # Typical files sit far below the ceiling: an sfx is usually 10-50 kB and a UI font 100-400 kB.
        "classes": {
            "model3d": {"formats": ["glb", "gltf"], "max_bytes": 5000000, "max_triangles": 100000, "max_texture_px": 2048, "max_bbox_m": 20.0},
            "texture": {"formats": ["png", "jpg"], "max_bytes": 4000000, "max_texture_px": 2048},
            "sprite": {"formats": ["png"], "max_bytes": 1000000, "max_texture_px": 1024},
            "hdri": {"formats": ["hdr", "exr"], "max_bytes": 20000000, "max_texture_px": 4096},
            # A short effect: 3 s stereo Ogg at 96 kbit/s is about 36 kB, so 500 kB is a generous ceiling.
            "audio_sfx": {"formats": ["wav", "ogg"], "max_bytes": 500000, "max_seconds": 3.0, "max_sample_rate_hz": 48000, "max_channels": 2},
            # One looping track: 3 minutes at 96 kbit/s is about 2.2 MB. Twelve tracks stay under 42 MB.
            "audio_music": {"formats": ["ogg"], "max_bytes": 3500000, "max_seconds": 180.0, "max_sample_rate_hz": 48000, "max_channels": 2},
            # Fonts carry their own licence allowlist and must ship their licence text next to the file.
            "font": {"formats": ["ttf", "otf"], "max_bytes": 1500000, "license_file_required": True,
                     "allowed_licenses": ["OFL-1.1", "Apache-2.0"]},
        },
        "output_dir": "assets/",
        "name_pattern": "^[a-z0-9][a-z0-9_-]*\\.[a-z0-9]+$",
        "visual_fit_needs_human": False,
    },
    "manual_testing": {"allowed_reasons": ["visual_judgment", "physical_device", "native_dialog", "restricted_environment", "one_off_interaction"]},
}

_REQ_ROW = re.compile(r"^\|\s*\*\*([A-Za-z]*\d+(?:\.\d+)*)\*\*\s*\|\s*\*\*(.+?)\*\*\s*\|")
_COMMAND_DENY = re.compile(r"(\bcurl\b|\bwget\b|\bssh\b|\bscp\b|\bsudo\b|\brm\s+-[a-z]*r[a-z]*f?\s+/|\bgit\s+push\b|\bgh\s|\bdocker\b|\bnpm\s+publish\b|\bnpx\b)", re.I)
_SWALLOW_FAILURE = re.compile(r"(\|\||;)\s*(true|:|exit\s+0)\s*$", re.I)


def command_problem(command: str) -> Optional[str]:
    if _COMMAND_DENY.search(command):
        return "command uses a prohibited network, privilege, container, or publishing tool"
    if _SWALLOW_FAILURE.search(command):
        return "command ends in a fallback that always succeeds, so it can never report a failure; drop it"
    return None


def base_branch(plan: Dict[str, Any]) -> str:
    """The branch the run promotes into: `main` unless the plan says otherwise."""
    return str((plan.get("policy") or {}).get("base_branch") or "main").strip("/")


def run_branch(plan: Dict[str, Any]) -> str:
    """The protected branch a run accumulates on. Empty means the run works directly on the base branch."""
    template = str((plan.get("policy") or {}).get("run_branch") or "").strip().strip("/")
    return template.replace("{plan}", plan["plan_id"]) if template else ""


def branch_problem(name: str) -> Optional[str]:
    """A branch the harness creates and pushes must be a plain ref this repository may own."""
    if not name:
        return None
    if _BAD_BRANCH_CHARS.search(name) or ".." in name or "//" in name or name.startswith("/") or name.endswith("/") \
            or name.endswith(".lock") or name.endswith("."):
        return "%r is not a usable branch name" % name
    return None


_BAD_BRANCH_CHARS = re.compile(r"[\s~^:?*\[\\]")


_GLOB_CHARS = set("*?[")
_PATH_CHARS = re.compile(r"^[A-Za-z0-9._@+~/-]+$")


def under(path: str, prefixes: Sequence[str]) -> bool:
    """True when `path` is one of `prefixes` or lies inside one of them."""
    normal = os.path.normpath(path).replace(os.sep, "/")
    return any(normal == p or normal.startswith(p + "/")
               for p in (os.path.normpath(q).replace(os.sep, "/").rstrip("/") for q in prefixes))


_under = under


def command_paths_problem(command: str, working_directory: str, allowlist: Sequence[str],
                          exists: Callable[[str], bool]) -> Optional[str]:
    """A check may only name a path that exists at the base revision or that the phase may create.

    A command naming a file that is neither in the repository nor inside the phase allowlist can never pass:
    the worker is not allowed to create it. Refuse it before a worker attempt is paid for.
    """
    for token in shlex.split(command, posix=True):
        if token.startswith("-") or "/" not in token or "://" in token or _GLOB_CHARS & set(token):
            continue
        if not _PATH_CHARS.match(token):
            continue  # inline code such as require('static/index.html'), not a path argument
        paths = _path_candidates(token, working_directory)
        if any(os.path.isabs(path) or path == ".." or path.startswith(".." + os.sep) for path in paths):
            return "%r points outside the repository" % token
        if any(exists(path) or _under(path, allowlist) for path in paths):
            continue
        return ("%r does not exist at the base revision and is not inside the phase path allowlist, "
                "so the worker cannot create it and the command can never pass" % paths[0])
    return None


def _path_candidates(token: str, working_directory: str) -> List[str]:
    """A path may be relative to the working directory or, in a command that changes it, to the repository root."""
    paths = [os.path.normpath(os.path.join(working_directory or ".", token))]
    if working_directory:
        paths.append(os.path.normpath(token))
    return paths


def parse_requirements(path: str) -> List[Dict[str, str]]:
    """Extract stable requirement IDs from table rows like `| **1.1** | **Title** | ...`."""
    with open(path, encoding="utf-8") as fh:
        return requirements_from_table(fh.read(), os.path.basename(path))


def requirements_from_table(text: str, source: str) -> List[Dict[str, str]]:
    reqs, seen = [], set()
    for line in text.splitlines():
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


def with_model_sources(policy: Optional[Dict[str, Any]], sources: Optional[List[str]],
                       catalog: Optional[Dict[str, Dict[str, List[str]]]] = None) -> Dict[str, Any]:
    """Bind the chosen model sources into a policy. The picker menu is derived from them, so approval covers both."""
    policy = copy.deepcopy(policy or DEFAULT_POLICY)
    chosen = list(dict.fromkeys(sources or policy.get("model_sources") or []))
    if chosen:  # a policy without sources keeps its explicit tiers, so older plans still build
        policy["model_sources"] = chosen
        policy["model_tiers"] = models.menu_for(chosen, catalog)
    return policy


def assets_output_dir_problem(value: Any) -> Optional[str]:
    """An asset output directory must be a repository-relative directory that cannot climb out of the repository."""
    if not isinstance(value, str) or not value.strip():
        return "output_dir must be a non-empty repository-relative directory"
    text = value.strip().replace(os.sep, "/")
    if text.startswith("/") or ".." in text.split("/"):
        return "output_dir must stay inside the repository"
    if not text.endswith("/"):
        return "output_dir must end with '/' because it names a directory"
    return None


def with_overseer(policy: Optional[Dict[str, Any]], enabled: bool, rounds_per_issue: int = 2) -> Dict[str, Any]:
    """Bind the overseer setting into a plan's policy copy. The choice is part of the approval digest."""
    if not isinstance(rounds_per_issue, int) or rounds_per_issue < 0:
        raise ValueError("overseer rounds_per_issue must be a whole number")
    policy = copy.deepcopy(policy or DEFAULT_POLICY)
    policy["overseer"] = {"enabled": bool(enabled), "rounds_per_issue": rounds_per_issue}
    return policy


def with_assets_dir(policy: Optional[Dict[str, Any]], value: str) -> Dict[str, Any]:
    """Bind an asset output directory (for example `apps/arithmoslayer/assets/`) into a plan's policy copy."""
    problem = assets_output_dir_problem(value)
    if problem:
        raise ValueError(problem)
    policy = copy.deepcopy(policy or DEFAULT_POLICY)
    policy["assets"]["output_dir"] = re.sub(r"/{2,}", "/", value.strip().replace(os.sep, "/"))
    return policy



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
    pressure = plan["policy"].get("split_pressure")
    if pressure is not None:
        if not isinstance(pressure, dict):
            problems.append("policy.split_pressure must be an object")
        else:
            unknown = sorted(set(pressure) - set(sizing.DEFAULT_LIMITS) - {"enabled"})
            if unknown:
                problems.append("policy.split_pressure has unknown keys: %s" % unknown)
            for key, value in pressure.items():
                if key != "enabled" and (not isinstance(value, int) or value < 0):
                    problems.append("policy.split_pressure.%s must be a whole number" % key)
    for key in ("base_branch", "run_branch"):
        problem = branch_problem(str(plan["policy"].get(key) or ""))
        if problem:
            problems.append("policy.%s: %s" % (key, problem))
    if run_branch(plan) and run_branch(plan) == base_branch(plan):
        problems.append("policy.run_branch must differ from policy.base_branch")
    sources = plan["policy"].get("model_sources")
    if sources is not None:
        unknown = sorted(set(sources) - set(models.SOURCES))
        if not sources:
            problems.append("policy.model_sources is empty: choose at least one of %s" % ", ".join(models.SOURCES))
        elif unknown:
            problems.append("policy.model_sources has unknown sources: %s" % unknown)
        elif any(not plan["policy"]["model_tiers"].get(tier) for tier in models.TIERS):
            problems.append("policy.model_tiers has an empty tier for the chosen model sources %s" % sources)
    routing = plan["policy"].get("model_routing")
    if routing:
        tiers = plan["policy"]["model_tiers"]
        approved = {m for tier in models.TIERS for m in models._candidates(tier, tiers)}
        for key in ("routine_models", "escalation_models"):
            choices = routing[key]
            if not choices or not set(choices) <= approved:
                problems.append("policy.model_routing.%s must name non-empty approved models" % key)
        if len(set(routing["routine_models"])) < 2:
            problems.append("policy.model_routing.routine_models needs two distinct models for independent review")
        try:
            # The signed refiner must name an approved model of at least standard tier; an empty signature is no routing.
            if not models.signed_refiner(plan["policy"]):
                problems.append("policy.model_routing.refiner must name an approved standard or strong model")
        except ValueError as exc:
            problems.append("policy.model_routing.refiner must be an approved standard or strong model: %s" % exc)
        if not models.routed_tiers(plan["policy"], "overseer")["strong"]:
            problems.append("policy.model_routing.escalation_models needs an approved strong model")
    assets = plan["policy"].get("assets") or {}
    problem = assets_output_dir_problem(assets.get("output_dir"))
    if problem:
        problems.append("policy.assets.%s" % problem)
    try:
        re.compile(str(assets.get("name_pattern") or ""))
    except re.error:
        problems.append("policy.assets.name_pattern is not a valid regular expression")
    for name, spec in sorted((assets.get("classes") or {}).items()):
        if not isinstance(spec, dict) or not spec.get("formats"):
            problems.append("policy.assets.classes.%s needs a list of allowed formats" % name)
        elif spec.get("allowed_licenses") is not None and not spec["allowed_licenses"]:
            problems.append("policy.assets.classes.%s.allowed_licenses must not be empty; omit it to use the global list" % name)
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
               policy: Optional[Dict[str, Any]] = None, fixture: bool = False, model_sources: Optional[List[str]] = None,
               catalog: Optional[Dict[str, Dict[str, List[str]]]] = None,
               intent: Optional[str] = None) -> Dict[str, Any]:
    plan = {
        "plan_id": plan_id,
        "version": version,
        "requirements": requirements,
        "phases": copy.deepcopy(phases or []),
        "policy": with_model_sources(policy, model_sources, catalog),
    }
    if fixture:
        plan["fixture"] = True
    if intent and intent.strip():
        plan["intent"] = " ".join(intent.split())[:2000]
    return plan
