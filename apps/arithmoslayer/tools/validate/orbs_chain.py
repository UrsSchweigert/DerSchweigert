"""Validate the answer orb and chain documents.

The orbs document must offer two to four orbs drawn from exactly four shapes,
and the chain document must declare ascending tiers so a correct answer always
pays more than the tier below it.
"""

from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Any

from ._common import display, field_line

ORBS_RELATIVE = Path("data") / "combat" / "orbs.json"
CHAIN_RELATIVE = Path("data") / "combat" / "chain.json"
SHAPES = ("circle", "triangle", "square", "diamond")
ORBS_FIELDS = (
    "version", "minOrbs", "maxOrbs", "shapes", "orbit",
    "hintChipSeconds", "popSeconds", "wrongStrikeHastenSeconds",
)
CHAIN_FIELDS = ("version", "startTier", "finisherThreshold", "tiers")
TIER_FIELDS = ("shardMultiplier", "finisherCharge")
DOCUMENT_FIELD = "<document>"


def validate(root: Path) -> list[str]:
    """Return every problem in the orb and chain documents."""
    errors = _document_errors(root / ORBS_RELATIVE, root, _orbs_errors)
    errors.extend(_document_errors(root / CHAIN_RELATIVE, root, _chain_errors))
    return errors


def _document_errors(path: Path, root: Path, checker: Any) -> list[str]:
    if not path.is_file():
        return []
    location = display(path, root)
    try:
        text = path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError) as exc:
        return [_error(location, 1, f"cannot read the data file ({exc})", DOCUMENT_FIELD)]
    try:
        data: Any = json.loads(text)
    except json.JSONDecodeError as exc:
        return [_error(location, exc.lineno, f"invalid JSON: {exc.msg}", DOCUMENT_FIELD)]
    if not isinstance(data, dict):
        return [_error(location, 1, "expected an object", DOCUMENT_FIELD)]
    return checker(data, text, location)


def _error(location: str, line: int, message: str, field: str) -> str:
    return f"{location}:{line}: {message} (field '{field}')"


def _is_number(value: Any) -> bool:
    return not isinstance(value, bool) and isinstance(value, (int, float)) and math.isfinite(value)


def _unknown(data: dict[str, Any], allowed: tuple[str, ...], text: str, location: str) -> list[str]:
    return [
        _error(location, field_line(text, field), "unknown field", field)
        for field in data if field not in allowed
    ]


def _number(
    data: dict[str, Any], field: str, text: str, location: str, *, integer: bool = False, positive: bool = False
) -> list[str]:
    line = field_line(text, field)
    if field not in data:
        return [_error(location, line, "missing required field", field)]
    value = data[field]
    if integer and (not isinstance(value, int) or isinstance(value, bool)):
        return [_error(location, line, f"expected an integer but found {type(value).__name__}", field)]
    if not integer and not _is_number(value):
        return [_error(location, line, f"expected a number but found {type(value).__name__}", field)]
    if (positive and value <= 0) or (not positive and value < 0):
        comparison = "greater than zero" if positive else "of at least zero"
        return [_error(location, line, f"expected a number {comparison} but found {value!r}", field)]
    return []


def _version(data: dict[str, Any], text: str, location: str) -> list[str]:
    if data.get("version") != 1:
        return [_error(location, field_line(text, "version"), "expected 1", "version")]
    return []


def _orbs_errors(data: dict[str, Any], text: str, location: str) -> list[str]:
    errors = _unknown(data, ORBS_FIELDS, text, location)
    errors.extend(_version(data, text, location))
    errors.extend(_number(data, "minOrbs", text, location, integer=True))
    errors.extend(_number(data, "maxOrbs", text, location, integer=True))
    minimum = data.get("minOrbs")
    maximum = data.get("maxOrbs")
    if isinstance(minimum, int) and not 2 <= minimum <= 4:
        errors.append(_error(location, field_line(text, "minOrbs"), "minOrbs must be between 2 and 4", "minOrbs"))
    if isinstance(maximum, int) and not 2 <= maximum <= 4:
        errors.append(_error(location, field_line(text, "maxOrbs"), "maxOrbs must be between 2 and 4", "maxOrbs"))
    if isinstance(minimum, int) and isinstance(maximum, int) and minimum > maximum:
        errors.append(_error(location, field_line(text, "maxOrbs"), f"minOrbs {minimum} is greater than maxOrbs {maximum}", "maxOrbs"))
    shapes = data.get("shapes")
    line = field_line(text, "shapes")
    if not isinstance(shapes, list):
        errors.append(_error(location, line, "expected a list", "shapes"))
    else:
        for shape in dict.fromkeys((*SHAPES, *shapes)):
            if shapes.count(shape) != 1:
                errors.append(_error(location, line, f"expected exactly one {shape!r} shape", "shapes"))
    orbit = data.get("orbit")
    if not isinstance(orbit, dict):
        errors.append(_error(location, field_line(text, "orbit"), "expected an object", "orbit"))
    else:
        errors.extend(_number(orbit, "radiusPx", text, location, positive=True))
        errors.extend(_number(orbit, "angularSpeed", text, location, positive=True))
    for field in ("hintChipSeconds", "popSeconds", "wrongStrikeHastenSeconds"):
        errors.extend(_number(data, field, text, location))
    return errors


def _chain_errors(data: dict[str, Any], text: str, location: str) -> list[str]:
    errors = _unknown(data, CHAIN_FIELDS, text, location)
    errors.extend(_version(data, text, location))
    errors.extend(_number(data, "startTier", text, location, integer=True))
    errors.extend(_number(data, "finisherThreshold", text, location, positive=True))
    tiers = data.get("tiers")
    line = field_line(text, "tiers")
    if not isinstance(tiers, list):
        return errors + [_error(location, line, "expected a list", "tiers")]
    if len(tiers) < 2:
        errors.append(_error(location, line, f"expected at least 2 tiers but found {len(tiers)}", "tiers"))
    previous: float | None = None
    for index, tier in enumerate(tiers):
        if not isinstance(tier, dict):
            errors.append(_error(location, line, f"tier {index} must be an object", "tiers"))
            continue
        errors.extend(_unknown(tier, TIER_FIELDS, text, location))
        errors.extend(_number(tier, "shardMultiplier", text, location, positive=True))
        errors.extend(_number(tier, "finisherCharge", text, location, positive=True))
        multiplier = tier.get("shardMultiplier")
        if _is_number(multiplier) and multiplier > 0:
            if previous is not None and multiplier <= previous:
                errors.append(_error(location, field_line(text, "shardMultiplier"), f"tier {index} must rise above {previous}", "shardMultiplier"))
            previous = multiplier
    start = data.get("startTier")
    if isinstance(start, int) and not isinstance(start, bool) and not 0 <= start < len(tiers):
        errors.append(_error(location, field_line(text, "startTier"), f"startTier {start} is outside the tiers", "startTier"))
    return errors
