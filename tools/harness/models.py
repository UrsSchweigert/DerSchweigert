"""Delegated model choices, bounded legacy routing, and independent review."""
from __future__ import annotations

import json
import os
from typing import Any, Dict, List, Optional

from . import schemas

TIERS = ("low", "standard", "strong")

# Sources the picker menu can draw from. A plan records the chosen ones, so the menu is bound by its approval digest.
SOURCES = ("copilot", "deepseek", "local")

# Candidate ids per source and tier. Availability is still probed: ids this runtime rejects are dropped from the menu.
# A store-level model_catalog.json can replace any source/tier list when a runtime uses different ids.
MODEL_CATALOG: Dict[str, Dict[str, List[str]]] = {
    "copilot": {
        "low": ["claude-haiku-4.5"],
        "standard": ["claude-sonnet-5"],
        "strong": ["claude-opus-5", "claude-opus-4.8"],
    },
    # Real DeepSeek API model names (BYOK). The `deepseek/` prefix is the source marker; the part after it
    # is the name sent to the provider, so these must stay valid wire names.
    "deepseek": {
        "low": ["deepseek/deepseek-flash"],
        "standard": ["deepseek/deepseek-flash"],
        "strong": ["deepseek/deepseek-v4-pro"],
    },
    "local": {
        "low": ["ollama-models/qwen3.5:4b", "ollama-models/qwen3:4b", "ollama-models/llama3.2:3b", "ollama-models/phi:latest"],
        "standard": ["ollama-models/gemma4:12b", "ollama-models/qwen3-local:8k"],
        "strong": ["ollama-models/gemma4:cloud"],
    },
}
CATALOG_FILE = "model_catalog.json"
ROLE_TIER = {"investigator": "low", "refiner": "strong", "implementer": "low", "reviewer": "standard", "integrator": "low", "delegator": "standard",
             "analyst": "strong", "overseer": "strong"}

# Roles whose output is a judgement rather than mechanical work. A cheap model that returns a malformed
# result costs a repair attempt and a human decision, which is always more expensive than the stronger call.
# The overseer decides whether a stuck issue is a harness defect, a scope problem, or a question for the owner. A wrong
# call there costs more than any implementation attempt, so it is never downgraded by a plan.
REQUIRED_TIER = {"refiner": "strong", "overseer": "strong"}

# A plan may sign one concrete refiner instead of taking the strong default. The signature is the owner's
# cost decision, so it replaces the REQUIRED_TIER floor for that role only, and never below this band:
# refinement is still a judgement role, so a low-tier refiner stays refused however it is signed.
SIGNED_REFINER_FLOOR = "standard"
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


def tier_of(model: str, policy_tiers: Dict[str, Any]) -> Optional[str]:
    """The band a model is approved at: the cheapest one that lists it, or None when it is not approved."""
    return next((band for band in TIERS if model in _candidates(band, policy_tiers)), None)


def signed_refiner(policy: Dict[str, Any]) -> Optional[Dict[str, str]]:
    """The refiner the approved policy names, with the band it is approved at.

    None for a legacy plan with no `model_routing`: those keep the REQUIRED_TIER strong floor.
    A signature naming an unapproved or low-tier model is refused here rather than quietly upgraded,
    so a bad policy blocks the attempt instead of spending a model the owner did not sign.
    """
    routing = policy.get("model_routing") or {}
    selected = routing.get("refiner")
    if not selected:
        return None
    tier = tier_of(selected, policy["model_tiers"])
    if tier is None:
        raise ValueError("the approved refiner %r is not configured in the approved policy" % selected)
    if TIERS.index(tier) < TIERS.index(SIGNED_REFINER_FLOOR):
        raise ValueError("the approved refiner %r is below the %s tier" % (selected, SIGNED_REFINER_FLOOR))
    return {"model": selected, "tier": tier}


def resolve_signed(selection: Dict[str, str], available: Optional[List[str]], *, role: str = "refiner") -> Dict[str, Any]:
    """Dispatch exactly the signed model: no substitution, no tier upgrade, no runtime-default fallback."""
    if available is None:
        raise ValueError("the approved %s routing requires verified model availability" % role)
    if selection["model"] not in available:
        raise ValueError("the approved %s model %r is not available" % (role, selection["model"]))
    return {"model": selection["model"], "tier": selection["tier"], "routing": True,
            "note": "the approved policy routes the %s to %s" % (role, selection["model"])}


def resolve_choice(choice: dict[str, Any], policy_tiers: dict[str, Any], available: list[str] | None,
                   avoid: str | None = None, *, strong_used: int = 0, strong_budget: int = 1,
                   role: str | None = None) -> dict[str, Any]:
    """Validate a delegator's concrete model choice without substituting a role default.

    A role with a required tier is upgraded by trusted code, never left cheap: the plan's
    own approval cannot lower that floor, and the returned note says what happened.
    """
    schemas.validate(choice, schemas.MODEL_CHOICE, "model_choice")
    reason = choice["reason"].strip()
    if not reason or len(reason) > 2000:
        raise ValueError("model choice needs a non-empty reason under 2000 characters")
    selected = choice["model"]
    tier = tier_of(selected, policy_tiers)
    if tier is None:
        raise ValueError("model %r is not configured in the approved policy" % selected)
    floor = REQUIRED_TIER.get(role or "")
    if floor and TIERS.index(tier) < TIERS.index(floor):
        upgraded = resolve_model(floor, policy_tiers, available, avoid)
        if upgraded.get("model"):
            return {"model": upgraded["model"], "tier": upgraded["tier"], "routing": True,
                    "note": "%s always runs on a %s-tier model; upgraded from %s: %s"
                            % (role, floor, selected, reason)}
        if available is not None:
            return {"model": selected, "tier": tier, "routing": True,
                    "note": "%s should run on a %s-tier model, but none is available; kept %s: %s"
                            % (role, floor, selected, reason)}
        return {"model": None, "tier": floor, "routing": False,
                "note": "model routing unavailable: runtime default model used; %s needs a %s-tier model" % (role, floor)}
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


SOURCES_ENV = "HARNESS_MODEL_SOURCES"
DASHBOARD_SOURCES_ENV = "HARNESS_INVESTIGATOR_SOURCES"


def operator_sources(env: Optional[Dict[str, str]] = None) -> Optional[List[str]]:
    """The operator's standing source choice, so every new run is wired to the same providers.

    `HARNESS_MODEL_SOURCES` wins over the dashboard's `HARNESS_INVESTIGATOR_SOURCES`.
    Unknown names are dropped instead of approving a source this runtime cannot serve,
    and with neither variable set the caller keeps its own default.
    """
    source = os.environ if env is None else env
    for name in (SOURCES_ENV, DASHBOARD_SOURCES_ENV):
        chosen = [part.strip() for part in str(source.get(name) or "").split(",") if part.strip()]
        valid = [item for item in chosen if item in SOURCES]
        if valid:
            return list(dict.fromkeys(valid))
    return None


def load_catalog(home: Optional[str] = None) -> Dict[str, Dict[str, List[str]]]:
    """The built-in catalog, with every source/tier that a store-level model_catalog.json replaces."""
    catalog = {source: {tier: list(ids) for tier, ids in tiers.items()} for source, tiers in MODEL_CATALOG.items()}
    path = os.path.join(home, CATALOG_FILE) if home else None
    if path and os.path.exists(path):
        with open(path, encoding="utf-8") as fh:
            custom = json.load(fh)
        schemas.validate(custom, {source + "?": {tier + "?": [str] for tier in TIERS} for source in SOURCES}, "model_catalog")
        if not custom:
            raise ValueError("model_catalog.json names no source")
        for source, tiers in custom.items():
            catalog[source].update({tier: list(ids) for tier, ids in tiers.items()})
    return catalog


def source_for(model_id: str, catalog: Dict[str, Dict[str, List[str]]]) -> Optional[str]:
    """Which source a catalog id belongs to. Ids are unique across sources, so the first match wins."""
    for source, tiers in catalog.items():
        for ids in tiers.values():
            if model_id in ids:
                return source
    return None


def menu_for(sources: List[str], catalog: Optional[Dict[str, Dict[str, List[str]]]] = None) -> Dict[str, List[str]]:
    """The picker menu for the chosen sources: each tier unions their candidates in the order the sources were given."""
    chosen = list(dict.fromkeys(sources or []))
    if not chosen:
        raise ValueError("at least one model source is required; choose from %s" % ", ".join(SOURCES))
    unknown = [source for source in chosen if source not in SOURCES]
    if unknown:
        raise ValueError("unknown model source(s) %s; choose from %s" % (", ".join(unknown), ", ".join(SOURCES)))
    catalog = catalog or load_catalog()
    menu: Dict[str, List[str]] = {}
    for tier in TIERS:
        ids: List[str] = []
        for source in chosen:
            ids.extend(model for model in catalog[source][tier] if model not in ids)
        menu[tier] = ids
    return menu


def available_in_tier(tier: str, policy_tiers: dict[str, Any], available: list[str] | None) -> list[str]:
    """Approved models of one tier that the runtime offers. Empty when model routing is unavailable."""
    return [m for m in _candidates(tier, policy_tiers) if available is not None and m in available]


def routed_tiers(policy: Dict[str, Any], role: str, escalated: bool = False) -> Dict[str, Any]:
    """Restrict the approved menu before resolving a role, including automatic fallback paths."""
    tiers = policy["model_tiers"]
    routing = policy.get("model_routing")
    if not routing:
        return tiers
    if role == "refiner":
        allowed = {routing["refiner"]}
    elif escalated or role in ("delegator", "analyst", "overseer"):
        allowed = set(routing["escalation_models"])
    else:
        allowed = set(routing["routine_models"])
    return {tier: [model for model in _candidates(tier, tiers) if model in allowed] for tier in TIERS}


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
        resolve_choice(choice, policy_tiers, available, avoid, role=role,
                      strong_budget=strong_budget if role == "implementer" else 1)


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
