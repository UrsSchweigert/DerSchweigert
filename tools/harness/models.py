"""Model routing: tier per role, evidence-only escalation, independent reviewer, and the no-routing fallback."""
from __future__ import annotations

from typing import Any, Dict, List, Optional

TIERS = ("low", "standard", "strong")
ROLE_TIER = {"investigator": "low", "refiner": "low", "implementer": "low", "reviewer": "standard", "integrator": "low"}
ESCALATION_EVIDENCE = ("checks_failed", "review_findings", "integrated_checks_failed")


def _up(tier: str) -> str:
    return TIERS[min(TIERS.index(tier) + 1, len(TIERS) - 1)]


def choose_tier(role: str, *, implementer_tier: Optional[str] = None, previous_tier: Optional[str] = None,
                previous_failure_kind: Optional[str] = None, touches_escalation_path: bool = False,
                strong_used: int = 0, strong_budget: int = 1) -> str:
    """Cheapest tier the packet supports. Move up only on evidence, and only while the strong budget lasts."""
    tier = ROLE_TIER[role]
    if role == "reviewer":
        # The reviewer never runs below the implementer's tier.
        return max(tier, implementer_tier or tier, key=TIERS.index)
    if role == "implementer":
        if previous_tier:
            tier = max(tier, previous_tier, key=TIERS.index)
            if previous_failure_kind in ESCALATION_EVIDENCE:
                tier = max(tier, _up(previous_tier), key=TIERS.index)
        if touches_escalation_path:
            tier = "strong"
        if tier == "strong" and strong_used >= strong_budget:
            tier = "standard"
    return tier


def accept_tier_request(requested: str, current: str, *, previous_failure_kind: Optional[str],
                        touches_escalation_path: bool, strong_used: int, strong_budget: int) -> str:
    """An agent's request for a stronger model is a proposal. Accept it only on evidence or an escalation path."""
    if TIERS.index(requested) <= TIERS.index(current):
        return current
    if not (previous_failure_kind in ESCALATION_EVIDENCE or touches_escalation_path):
        return current
    target = requested if touches_escalation_path else _up(current)
    if target == "strong" and strong_used >= strong_budget:
        return current
    return target


def _candidates(tier: str, policy_tiers: Dict[str, Any]) -> List[str]:
    value = policy_tiers.get(tier, [])
    return [value] if isinstance(value, str) else list(value)


def resolve_model(tier: str, policy_tiers: Dict[str, Any], available: Optional[List[str]], avoid: Optional[str] = None) -> Dict[str, Any]:
    """Map a tier to a concrete model. `available` is None when the runtime has no model routing."""
    if available is None:
        return {"model": None, "tier": tier, "routing": False, "note": "model routing unavailable: runtime default model used"}
    note = ""
    for t in TIERS[TIERS.index(tier):]:
        options = [m for m in _candidates(t, policy_tiers) if m in available]
        if avoid:
            different = [m for m in options if m != avoid]
            if different:
                if t != tier:
                    note = "no different model at tier %s: used higher tier %s" % (tier, t)
                return {"model": different[0], "tier": t, "routing": True, "note": note}
            continue
        if options:
            if t != tier:
                note = "no model available at tier %s: used %s" % (tier, t)
            return {"model": options[0], "tier": t, "routing": True, "note": note}
    # Last resort for a reviewer: the same model, and say so.
    for t in TIERS[TIERS.index(tier):]:
        options = [m for m in _candidates(t, policy_tiers) if m in available]
        if options:
            return {"model": options[0], "tier": t, "routing": True, "note": "reviewer shares the implementer's model: no different model available"}
    return {"model": None, "tier": tier, "routing": True, "note": "no configured model for tier %s is available" % tier}
