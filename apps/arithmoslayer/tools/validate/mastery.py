"""Validate data/mastery/intervals.json, the spaced-review ladder config."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from ._common import display, field_line

DATA_RELATIVE = Path("data") / "mastery" / "intervals.json"


def validate(root: Path) -> list[str]:
    """Return one problem string per intervals configuration error."""
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
    intervals = data.get("intervals")
    bad = (
        not isinstance(intervals, list)
        or not intervals
        or not all(_is_int(value) and value >= 0 for value in intervals)
        or any(intervals[i] >= intervals[i + 1] for i in range(len(intervals) - 1))
    )
    if bad:
        errors.append(
            _error(
                name,
                text,
                "intervals",
                "intervals must be a strictly ascending list of non-negative integers",
            )
        )
    if not _is_int(data.get("slowThresholdMs")) or data["slowThresholdMs"] <= 0:
        errors.append(
            _error(name, text, "slowThresholdMs", "slowThresholdMs must be a positive integer")
        )
    rate = data.get("learningRate")
    if isinstance(rate, bool) or not isinstance(rate, (int, float)) or not 0 < rate <= 1:
        errors.append(
            _error(name, text, "learningRate", "learningRate must be a number in (0, 1]")
        )
    return errors


def _is_int(value: Any) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


def _error(name: str, text: str, field: str, message: str) -> str:
    return f"{name}:{field_line(text, field)}: {message} (field '{field}')"
