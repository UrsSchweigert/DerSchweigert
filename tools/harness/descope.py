"""Recorded descoping: defer a requirement to a named follow-up issue so the plan can end.

Descoping changes what the owner approved, so it is never silent. Every deferral is a stored record
with a reason, the follow-up issue that still owns the work, and the actor who decided. The plan's
policy carries an envelope; the owner approves that envelope with the digest, and everything inside
it needs no further approval.
"""
from __future__ import annotations

import time
from typing import Any, Dict, List, Optional, Sequence

DEFAULT_ENVELOPE: Dict[str, Any] = {
    "allow_deferral": False,
    "max_deferred_requirements": None,
    "max_deferred_share": None,
    "forbidden_requirements": [],
    "require_followup": True,
}


class DescopeError(Exception):
    pass


def envelope(plan: Dict[str, Any]) -> Dict[str, Any]:
    """The approved envelope, with defaults for anything the policy leaves out."""
    env = dict(DEFAULT_ENVELOPE)
    env.update((plan.get("policy") or {}).get("descope") or {})
    return env


def _matches(doc: Dict[str, Any], plan_id: str, version: int) -> bool:
    return doc.get("plan_id") == plan_id and doc.get("version") == version


def deferrals(store: Any, plan_id: str, version: int) -> List[Dict[str, Any]]:
    return sorted((d for d in store.docs("deferral") if _matches(d, plan_id, version)), key=lambda d: d["requirement_id"])


def deferred_requirements(store: Any, plan_id: str, version: int) -> set:
    return {d["requirement_id"] for d in deferrals(store, plan_id, version)}


def check(plan: Dict[str, Any], store: Any, requirement_id: str, followup_issue: str) -> None:
    """Raise DescopeError unless this deferral is inside the approved envelope."""
    env = envelope(plan)
    if not env.get("allow_deferral"):
        raise DescopeError("this plan does not allow deferring requirements; the owner approves descoping with the plan")
    known = {r["id"] for r in plan["requirements"]}
    if requirement_id not in known:
        raise DescopeError("unknown requirement %s; known: %s" % (requirement_id, ", ".join(sorted(known))))
    if requirement_id in set(env.get("forbidden_requirements") or []):
        raise DescopeError("requirement %s may not be deferred by policy" % requirement_id)
    already = deferred_requirements(store, plan["plan_id"], plan["version"])
    if requirement_id in already:
        raise DescopeError("requirement %s is already deferred" % requirement_id)
    if env.get("require_followup", True) and not str(followup_issue or "").strip():
        raise DescopeError("a deferral needs the follow-up issue that still owns the work")
    limit = env.get("max_deferred_requirements")
    if limit is not None and len(already) + 1 > int(limit):
        raise DescopeError("the plan allows %d deferred requirements; %d are deferred already" % (int(limit), len(already)))
    share = env.get("max_deferred_share")
    if share is not None and len(known) and (len(already) + 1) / len(known) > float(share):
        raise DescopeError("deferring %s would exceed the allowed share of %.0f %% of the plan" % (requirement_id, float(share) * 100))


def defer(store: Any, plan_id: str, requirement_id: str, *, reason: str, followup_issue: str,
          actor: str, version: Optional[int] = None, now: Optional[float] = None) -> Dict[str, Any]:
    """Record one deferral. The plan can then complete with the requirement marked as deferred."""
    stored = store.get_plan(plan_id, version)
    if stored is None:
        raise DescopeError("unknown plan %s" % plan_id)
    plan = stored["plan"]
    if not str(reason or "").strip():
        raise DescopeError("a deferral needs a reason the owner can read")
    check(plan, store, requirement_id, followup_issue)
    record = {
        "plan_id": plan_id,
        "version": plan["version"],
        "requirement_id": requirement_id,
        "reason": str(reason).strip()[:1000],
        "followup_issue": str(followup_issue).strip(),
        "actor": actor,
        "deferred_at": time.time() if now is None else now,
    }
    store.put_doc("deferral", "%s@v%d/%s" % (plan_id, plan["version"], requirement_id), record)
    return record


def describe(records: Sequence[Dict[str, Any]]) -> List[str]:
    return ["%s -> %s: %s" % (r["requirement_id"], r["followup_issue"], r["reason"]) for r in records]


def _plan_ids(store: Any) -> List[str]:
    return [row[0] for row in store.cx.execute("SELECT DISTINCT plan_id FROM plans ORDER BY plan_id")]


def restore_draft(store: Any, plan_id: str, version: Optional[int] = None) -> Dict[str, Any]:
    """A follow-up plan that adds the deferred requirements back, one at a time.

    The issues are chained: each one depends on the previous, so the restored scope arrives in small
    increments and only after the increment before it is done. Nothing is restored automatically; the
    owner approves the draft like any other plan.
    """
    stored = store.get_plan(plan_id, version)
    if stored is None:
        raise DescopeError("unknown plan %s" % plan_id)
    plan = stored["plan"]
    records = deferrals(store, plan_id, plan["version"])
    if not records:
        raise DescopeError("plan %s has no deferred requirements" % plan_id)

    existing = [pid for pid in _plan_ids(store) if pid.startswith(plan_id + "-restore-")]
    wave = len(existing) + 1
    restore_id = "%s-restore-%d" % (plan_id, wave)

    requirements = {r["id"]: r for r in plan["requirements"]}
    phases = {p["id"]: p for p in plan["phases"]}
    issues: List[Dict[str, Any]] = []
    used_phases: List[Dict[str, Any]] = []
    previous: Optional[str] = None

    for record in records:
        req = record["requirement_id"]
        requirement = requirements.get(req)
        if requirement is None:
            raise DescopeError("deferred requirement %s is not in the plan any more" % req)
        source = next((i for i in store.list_issues(plan_id) if req in i.get("requirement_ids", [])), None)
        phase_id = source["phase_id"] if source else next(
            (p["id"] for p in plan["phases"] if req in p["requirements"]), plan["phases"][0]["id"])
        phase = phases[phase_id]
        if phase_id not in [p["id"] for p in used_phases]:
            used_phases.append({"id": phase["id"], "outcomes": phase["outcomes"], "requirements": [req],
                                "path_allowlist": phase["path_allowlist"], "non_goals": phase["non_goals"],
                                "dependencies": [], "exit_criteria": phase["exit_criteria"],
                                "validation": phase["validation"], "working_directory": phase.get("working_directory", ".")})
        else:
            for p in used_phases:
                if p["id"] == phase_id and req not in p["requirements"]:
                    p["requirements"].append(req)
        issue_id = "restore-" + req.replace(".", "-")
        doc = {
            "issue_id": issue_id,
            "phase_id": phase_id,
            "requirement_ids": [req],
            "title": (source or {}).get("title") or "Restore %s: %s" % (req, requirement["title"]),
            "outcomes": (source or {}).get("outcomes") or [requirement["title"]],
            "acceptance_criteria": (source or {}).get("acceptance_criteria") or ["Requirement %s is delivered as described: %s" % (req, requirement["title"])],
            "non_goals": (source or {}).get("non_goals") or [],
            "code_anchors": (source or {}).get("code_anchors") or [],
            "deps": [previous] if previous else [],
            "validation_commands": (source or {}).get("validation_commands") or phase["validation"],
            "working_directory": (source or {}).get("working_directory") or phase.get("working_directory", "."),
            "parallel_safe": False,
        }
        issues.append(doc)
        previous = issue_id

    table = ["| ID | Title | Phase | Description |", "|---|---|---|---|"]
    for record in records:
        requirement = requirements[record["requirement_id"]]
        table.append("| **%s** | **%s** | %s | %s |" % (requirement["id"], requirement["title"],
                                                        issues[[d["requirement_ids"][0] for d in issues].index(requirement["id"])]["phase_id"],
                                                        requirement["source"]))
    markdown = "\n".join([
        "# Restore wave %d for %s" % (wave, plan_id),
        "",
        "Requirements this plan deferred, added back one at a time. Each issue depends on the one before it.",
        "",
    ] + table + [""])
    return {"plan_id": restore_id, "requirements_markdown": markdown,
            "phases": {"phases": used_phases}, "issues": {"issues": issues}, "deferred": records}
