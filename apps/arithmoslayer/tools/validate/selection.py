"""Validate data/session/selection.json, the adaptive selector config."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from ._common import display, field_line

DATA_RELATIVE = Path("data") / "session" / "selection.json"
CATEGORIES = ("new", "review", "challenge")


def validate(root: Path) -> list[str]:
    """Return one problem string per selection configuration error."""
    path = root / DATA_RELATIVE
    name = display(path, root)
    if not path.is_file():
        return []
    text = path.read_text(encoding="utf-8")
    try:
        data = json.loads(text)
    except json.JSONDecodeError as exc:
        return [f"{name}:{exc.lineno}: invalid JSON: {exc.msg} (field '<document>')"]
    if not isinstance(data, dict):
        return [f"{name}:1: document must be an object (field '<document>')"]
    return _check(name, text, data)


def _check(name: str, text: str, data: dict) -> list[str]:
    errors: list[str] = []
    if data.get("version") != 1:
        errors.append(_error(name, text, "version", "version must be 1"))
    for field, value, message in (
        ("targetAccuracy", data.get("targetAccuracy"), "targetAccuracy must be a number in (0, 1]"),
        ("masteryThreshold", data.get("masteryThreshold"), "masteryThreshold must be a number in (0, 1]"),
    ):
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not 0 < value <= 1:
            errors.append(_error(name, text, field, message))
    window = data.get("windowSize")
    if not _is_int(window) or window <= 0:
        errors.append(_error(name, text, "windowSize", "windowSize must be a positive integer"))
    if not isinstance(data.get("interleaveOperations"), bool):
        errors.append(_error(name, text, "interleaveOperations", "interleaveOperations must be a boolean"))
    errors.extend(_weight_errors(name, text, data.get("weights")))
    return errors


def _weight_errors(name: str, text: str, weights: Any) -> list[str]:
    line = field_line(text, "weights")
    if not isinstance(weights, dict):
        return [f"{name}:{line}: weights must be an object (field 'weights')"]
    errors: list[str] = []
    total = 0.0
    for category in CATEGORIES:
        if category not in weights:
            errors.append(_error(name, text, "weights", f"weights is missing category '{category}'"))
            continue
        value = weights[category]
        if isinstance(value, bool) or not isinstance(value, (int, float)) or value < 0:
            errors.append(_error(name, text, "weights", f"weight for '{category}' must be non-negative"))
        else:
            total += float(value)
    for category in weights:
        if category not in CATEGORIES:
            errors.append(_error(name, text, "weights", f"unknown category '{category}'"))
    if total <= 0:
        errors.append(_error(name, text, "weights", "weights must have at least one positive value"))
    return errors


def _is_int(value: Any) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


def _error(name: str, text: str, field: str, message: str) -> str:
    return f"{name}:{field_line(text, field)}: {message} (field '{field}')"
