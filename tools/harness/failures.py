"""Failure classification by code, retry budgets, and backoff. The agent's own account of a failure is never evidence."""
from __future__ import annotations

import random
from typing import Any, Callable, Dict, List, Optional

TRANSIENT, DETERMINISTIC, POLICY, SYSTEMIC = "transient", "deterministic", "policy", "systemic"

# Evidence kinds observed by trusted code mapped to a failure class.
KIND_CLASS = {
    "infra": TRANSIENT, "network": TRANSIENT, "rate_limit": TRANSIENT, "runtime_crash": TRANSIENT, "lease_lost": TRANSIENT,
    "checks_failed": DETERMINISTIC, "review_findings": DETERMINISTIC, "schema_invalid": DETERMINISTIC,
    "merge_conflict": DETERMINISTIC, "push_rejected": DETERMINISTIC, "patch_changed": DETERMINISTIC, "integrated_checks_failed": DETERMINISTIC,
    "scope_violation": POLICY, "escalation_path": POLICY, "approval": POLICY, "permission": POLICY,
    "protected_branch": POLICY, "diff_too_large": POLICY,
    "isolation": SYSTEMIC, "credentials": SYSTEMIC, "budget": SYSTEMIC,
}


def classify(kind: str, prior_timeout_same_packet: bool = False) -> str:
    """A first timeout for a packet is transient. A repeated timeout for the same packet is deterministic. Unknown is deterministic."""
    if kind in ("timeout", "inactivity"):
        return DETERMINISTIC if prior_timeout_same_packet else TRANSIENT
    return KIND_CLASS.get(kind, DETERMINISTIC)


def backoff_delay(failures: int, base: float = 5.0, cap: float = 600.0, rng: Callable[[], float] = random.random) -> float:
    """Exponential backoff with jitter for the Nth transient failure (1-based)."""
    return min(cap, base * (2 ** max(0, failures - 1))) * (0.5 + rng() / 2)


def decide(failure_class: str, issue: Dict[str, Any], budgets: Dict[str, Any], now: float,
           rng: Callable[[], float] = random.random) -> Dict[str, Any]:
    """Update the issue's counters and return the next action: retry, block, or pause.

    Transient failures use their own budget. Deterministic failures use the repair budget and must change an
    input before retrying (enforced at dispatch). Policy failures block at once. Systemic failures pause the project.
    """
    if failure_class == SYSTEMIC:
        return {"action": "pause"}
    if failure_class == POLICY:
        return {"action": "block", "reason": "policy failure"}
    if failure_class == TRANSIENT:
        issue["transient_failures"] = issue.get("transient_failures", 0) + 1
        if issue["transient_failures"] > budgets["transient_retries"]:
            return {"action": "block", "reason": "transient retry budget exhausted"}
        delay = backoff_delay(issue["transient_failures"], rng=rng)
        issue["not_before"] = now + delay
        return {"action": "retry", "delay": delay}
    issue["repair_failures"] = issue.get("repair_failures", 0) + 1
    if issue["repair_failures"] > budgets["repair_attempts"]:
        return {"action": "block", "reason": "repair budget exhausted"}
    return {"action": "retry", "delay": 0.0, "must_change_input": True}


def duplicate_of_failed(attempts: List[Dict[str, Any]], packet_digest: str, tier: str) -> Optional[str]:
    """A replacement for a deterministically failed attempt must differ in packet digest or tier."""
    for a in attempts:
        if a.get("outcome") in ("Failed", "TimedOut", "Fenced") and a.get("failure_class") == DETERMINISTIC \
                and a.get("packet_digest") == packet_digest and a.get("tier") == tier:
            return a["attempt_id"]
    return None
