"""Token and cost estimates. The runtime reports no usage, so every figure here is an estimate named by its source and never used for limits."""
from __future__ import annotations

import json
import math
import os
import re
from typing import Any, Dict, Iterable, List, Optional

from . import telemetry

MAX_TOKENS = 50_000_000
PRICE_FILE = "model-prices.json"
PRICE_FIELDS = ("per_million_input", "per_million_output", "per_attempt")
USAGE_LINE = re.compile(r"tokens?|usage|premium", re.I)
SOURCE_LABEL = {"agent_estimate": "agent estimate", "size_estimate": "size only"}
NO_DATA = "unavailable: the runtime reports no per-attempt token or cost data to the harness, and no agent gave an estimate"


def tokens_from_size(size: int) -> int:
    """Roughly four characters per token."""
    return math.ceil(max(size, 0) / 4)


def clean_estimate(value: Any) -> Optional[Dict[str, Any]]:
    """An agent's own token estimate, kept only when it is two sane non-negative integers. Anything else is ignored, never an error."""
    if not isinstance(value, dict):
        return None
    tokens = [value.get("input_tokens"), value.get("output_tokens")]
    if any(type(t) is not int or not 0 <= t <= MAX_TOKENS for t in tokens):
        return None
    return {"input_tokens": tokens[0], "output_tokens": tokens[1], "basis": telemetry.SECRET.sub("[redacted]", str(value.get("basis", "")))[:200]}


def runtime_lines(tail: Iterable[str]) -> List[str]:
    """Output lines that mention usage. They are kept as text: the format is unverified and the agent writes to the same stream."""
    return [telemetry.SECRET.sub("[redacted]", line.strip())[:200] for line in tail if USAGE_LINE.search(line)][-5:]


def load_prices(home: str) -> Dict[str, Any]:
    """Prices come only from a file the operator writes, because the harness cannot know them."""
    path = os.path.join(home, PRICE_FILE)
    if not os.path.exists(path):
        return {"status": "unavailable", "reason": "no prices configured: add %s" % path, "models": {}}
    try:
        with open(path, encoding="utf-8") as fh:
            doc = json.load(fh)
        models: Dict[str, Dict[str, float]] = {}
        for name, rates in doc["models"].items():
            clean = {k: float(rates[k]) for k in PRICE_FIELDS if k in rates}
            if not clean or any(v < 0 or v != v for v in clean.values()):
                raise ValueError("%s needs non-negative rates" % name)
            models[str(name)] = clean
        return {"status": "estimate", "unit": str(doc["unit"])[:20], "models": models}
    except (OSError, ValueError, KeyError, TypeError, AttributeError) as exc:
        return {"status": "unavailable", "reason": "the prices file is invalid: %s" % exc, "models": {}}


def attempt_tokens(meta: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """The best figure for one attempt: the agent's own estimate, else the size-based lower bound."""
    recorded = meta.get("usage") or {}
    for source in ("agent_estimate", "size_estimate"):
        if recorded.get(source):
            return dict(recorded[source], source=source)
    return None


def attempt_cost(model: Optional[str], tokens: Optional[Dict[str, Any]], prices: Dict[str, Any]) -> Optional[float]:
    rates = prices["models"].get(model or "")
    if prices["status"] != "estimate" or rates is None:
        return None
    cost = rates.get("per_attempt", 0.0)
    if tokens:
        cost += tokens["input_tokens"] / 1e6 * rates.get("per_million_input", 0.0) + tokens["output_tokens"] / 1e6 * rates.get("per_million_output", 0.0)
    return cost


def summarize(attempts: Iterable[Dict[str, Any]], prices: Dict[str, Any]) -> Dict[str, Any]:
    """Totals by model and role, with a count of how each attempt's figure was obtained."""
    counts = {"agent_estimate": 0, "size_estimate": 0, "no_data": 0}
    total = {"input_tokens": 0, "output_tokens": 0}
    groups: Dict[str, Dict[str, Dict[str, Any]]] = {"model": {}, "role": {}}
    cost, unpriced, n = 0.0, set(), 0
    for a in attempts:
        n += 1
        tokens = attempt_tokens(a)
        counts[tokens["source"] if tokens else "no_data"] += 1
        price = attempt_cost(a.get("model"), tokens, prices)
        if prices["status"] == "estimate":
            if price is None:
                unpriced.add(a.get("model") or "runtime default")
            else:
                cost += price
        for kind, name in (("model", a.get("model") or "runtime default"), ("role", a.get("role") or "unknown")):
            row = groups[kind].setdefault(name, {"name": name, "attempts": 0, "input_tokens": 0, "output_tokens": 0, "cost": 0.0})
            row["attempts"] += 1
            row["cost"] += price or 0.0
            for key in total:
                row[key] += tokens[key] if tokens else 0
        for key in total:
            total[key] += tokens[key] if tokens else 0
    priced = prices["status"] == "estimate"
    return {"attempts": n, "counts": counts, "input_tokens": total["input_tokens"], "output_tokens": total["output_tokens"],
            "by_model": sorted(groups["model"].values(), key=lambda r: -r["input_tokens"] - r["output_tokens"]),
            "by_role": sorted(groups["role"].values(), key=lambda r: -r["input_tokens"] - r["output_tokens"]),
            "cost": {"status": prices["status"], "value": round(cost, 4) if priced else None, "unit": prices.get("unit"),
                     "reason": prices.get("reason"), "unpriced_models": sorted(unpriced)}}


def count(n: int) -> str:
    return ("%.1fM" % (n / 1e6) if n >= 1e6 else "%.1fk" % (n / 1e3) if n >= 1e3 else str(n))


def has_data(summary: Dict[str, Any]) -> bool:
    return summary["counts"]["agent_estimate"] + summary["counts"]["size_estimate"] > 0


def cost_text(summary: Dict[str, Any]) -> str:
    cost = summary["cost"]
    if cost["status"] != "estimate":
        return "cost unavailable (%s)" % cost["reason"]
    note = "; no price for %s" % ", ".join(cost["unpriced_models"]) if cost["unpriced_models"] else ""
    return "cost ~%s %.2f%s" % (cost["unit"], cost["value"], note)


def short(summary: Dict[str, Any]) -> str:
    if not has_data(summary):
        return telemetry.UNAVAILABLE
    return "~%s in / ~%s out tokens (estimate)" % (count(summary["input_tokens"]), count(summary["output_tokens"]))


def headline(summary: Dict[str, Any]) -> str:
    if not has_data(summary):
        return NO_DATA
    c = summary["counts"]
    return "estimated: ~%s input and ~%s output tokens over %d attempts (%d agent estimates, %d size-only lower bounds, %d without data); %s" % (
        count(summary["input_tokens"]), count(summary["output_tokens"]), summary["attempts"], c["agent_estimate"], c["size_estimate"], c["no_data"], cost_text(summary))


def attempt_label(meta: Dict[str, Any]) -> str:
    tokens = attempt_tokens(meta)
    if not tokens:
        return ""
    return "~%s in / ~%s out (%s)" % (count(tokens["input_tokens"]), count(tokens["output_tokens"]), SOURCE_LABEL[tokens["source"]])
