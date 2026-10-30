"""A fixed rule: does a task that would use the strongest model actually belong to several cheaper tasks?

The decision must not depend on a model's opinion of its own workload. It is computed from facts the plan already
states - how many files the task may touch, how large they are at the base revision, how many requirements and
acceptance criteria it carries, and how many separate areas of the repository it spans. Cheap to compute, identical
on every machine, and it can only ever ask for a split, never grant one.
"""
from __future__ import annotations

from typing import Any, Callable, Dict, List, Optional, Sequence

DEFAULT_LIMITS = {
    "max_files": 3,
    "max_bytes": 60000,
    "max_requirements": 1,
    "max_acceptance_criteria": 6,
    "max_areas": 2,
}


def limits(policy: Optional[Dict[str, Any]]) -> Dict[str, int]:
    configured = ((policy or {}).get("split_pressure") or {})
    resolved = dict(DEFAULT_LIMITS)
    for key, value in configured.items():
        if key in resolved and isinstance(value, int) and value >= 0:
            resolved[key] = value
    return resolved


def enabled(policy: Optional[Dict[str, Any]]) -> bool:
    """Off unless the approved policy asks for it, so no existing plan changes behaviour."""
    return bool(((policy or {}).get("split_pressure") or {}).get("enabled"))


def _area(path: str) -> str:
    """The part of the repository a file belongs to, so a task spread over unrelated places is visible as such."""
    parts = [p for p in path.split("/") if p]
    if len(parts) >= 3:
        return "/".join(parts[:2])
    return parts[0] if parts else path


def split_pressure(issue: Dict[str, Any], size_of: Callable[[str], int], policy: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """Facts and reasons. `size_of` returns the byte size of a path at the base revision, 0 when unknown."""
    limit = limits(policy)
    anchors: Sequence[str] = list(dict.fromkeys(list(issue.get("code_anchors") or []) + list(issue.get("contract_paths") or [])))
    sizes = {path: max(0, int(size_of(path) or 0)) for path in anchors}
    total = sum(sizes.values())
    areas = sorted({_area(path) for path in anchors})
    requirements: List[str] = list(issue.get("requirement_ids") or [])
    criteria: List[str] = list(issue.get("acceptance_criteria") or [])

    reasons: List[str] = []
    if len(anchors) > limit["max_files"]:
        reasons.append("%d files (limit %d)" % (len(anchors), limit["max_files"]))
    if total > limit["max_bytes"]:
        reasons.append("%d bytes of anchored code (limit %d)" % (total, limit["max_bytes"]))
    if len(requirements) > limit["max_requirements"]:
        reasons.append("%d requirements (limit %d)" % (len(requirements), limit["max_requirements"]))
    if len(criteria) > limit["max_acceptance_criteria"]:
        reasons.append("%d acceptance criteria (limit %d)" % (len(criteria), limit["max_acceptance_criteria"]))
    if len(areas) > limit["max_areas"]:
        reasons.append("%d separate areas: %s (limit %d)" % (len(areas), ", ".join(areas), limit["max_areas"]))
    return {"split_recommended": bool(reasons), "reasons": reasons,
            "facts": {"files": len(anchors), "bytes": total, "areas": areas,
                      "requirements": len(requirements), "acceptance_criteria": len(criteria)},
            "limits": limit}


def describe(report: Dict[str, Any]) -> str:
    facts = report["facts"]
    return ("%d files, %d bytes, %d requirements, %d acceptance criteria, %d areas - %s"
            % (facts["files"], facts["bytes"], facts["requirements"], facts["acceptance_criteria"], len(facts["areas"]),
               "; ".join(report["reasons"])))
