"""Delegated model choices, bounded legacy routing, and independent review."""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from . import schemas

TIERS = ("low", "standard", "strong")
ROLE_TIER = {"investigator": "low", "refiner": "low", "implementer": "low", "reviewer": "standard", "integrator": "low", "delegator": "standard",
             "analyst": "strong"}
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


def resolve_choice(choice: dict[str, Any], policy_tiers: dict[str, Any], available: list[str] | None,
                   avoid: str | None = None, *, strong_used: int = 0, strong_budget: int = 1) -> dict[str, Any]:
    """Validate a delegator's concrete model choice without substituting a role default."""
    schemas.validate(choice, schemas.MODEL_CHOICE, "model_choice")
    reason = choice["reason"].strip()
    if not reason or len(reason) > 2000:
        raise ValueError("model choice needs a non-empty reason under 2000 characters")
    selected = choice["model"]
    tier = next((band for band in TIERS if selected in _candidates(band, policy_tiers)), None)
    if tier is None:
        raise ValueError("model %r is not configured in the approved policy" % selected)
    if tier == "strong" and strong_used >= strong_budget:
        raise ValueError("strong attempt budget exhausted")
    note = "delegator chose %s: %s" % (selected, reason)
    if available is None:
        return {"model": None, "tier": tier, "routing": False,
                "note": note + "; model routing unavailable: runtime default model used"}
    if selected not in available:
        raise ValueError("selected model %r is not available" % selected)
    if selected == avoid:
        alternatives = {model for band in TIERS for model in _candidates(band, policy_tiers)
                        if model in available and model != avoid}
        if alternatives:
            raise ValueError("reviewer must use an independent model when one is available")
        note += "; reviewer shares the implementer's model: no different model available"
    return {"model": selected, "tier": tier, "routing": True, "note": note}


def available_in_tier(tier: str, policy_tiers: dict[str, Any], available: list[str] | None) -> list[str]:
    """Approved models of one tier that the runtime offers. Empty when model routing is unavailable."""
    return [m for m in _candidates(tier, policy_tiers) if available is not None and m in available]


def model_options(policy_tiers: dict[str, Any], available: list[str] | None) -> list[dict[str, str]]:
    """Expose probed models and approved relative cost bands to the delegator."""
    return [{"model": candidate, "relative_cost": band} for band in TIERS
            for candidate in _candidates(band, policy_tiers) if available is not None and candidate in available]


def validate_choices(choices: dict[str, Any], policy_tiers: dict[str, Any], available: list[str] | None,
                     *, strong_budget: int = 1, require: bool = False) -> None:
    """Check a task's delegation decisions against the model menu and implementation budget."""
    schemas.validate(choices, schemas.MODEL_CHOICES, "model_choices")
    if require and available is not None:
        missing = {"implementer", "reviewer", "refiner"} - set(choices)
        if missing:
            raise ValueError("model_choices missing decisions for %s" % ", ".join(sorted(missing)))
    for role, choice in choices.items():
        avoid = choices.get("implementer", {}).get("model") if role == "reviewer" else None
        resolve_choice(choice, policy_tiers, available, avoid, strong_budget=strong_budget if role == "implementer" else 1)


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
