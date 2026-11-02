"""Validate the Muddler archetype documents under data/enemies/.

Every document declares the seven states, a telegraph of at least 0.4 seconds,
positive speed and hp, and a movement and attack pattern. The validator also
compares all archetypes so no two share a movement pattern or an attack pattern.
Problems name the file, line, and field.
"""

from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Any

from ._common import display, field_line

DATA_RELATIVE = Path("data") / "enemies"
DOCUMENT_FIELD = "<document>"
REQUIRED_STATES = (
    "idle",
    "patrol",
    "chase",
    "telegraph",
    "attack",
    "stagger",
    "unscramble",
)
REQUIRED_TEXT_FIELDS = ("id", "biome")
PATTERN_FIELDS = ("movement", "attack")
MIN_TELEGRAPH = 0.4

PatternUse = tuple[str, int]


def validate(root: Path) -> list[str]:
    """Return every problem in the Muddler archetype documents."""
    directory = root / DATA_RELATIVE
    if not directory.is_dir():
        return []
    errors: list[str] = []
    patterns: dict[str, dict[str, list[PatternUse]]] = {
        field: {} for field in PATTERN_FIELDS
    }
    for path in sorted(directory.glob("*.json")):
        location = display(path, root)
        try:
            text = path.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError) as exc:
            errors.append(
                f"{location}:1: cannot read the data file ({exc}) "
                f"(field '{DOCUMENT_FIELD}')"
            )
            continue
        try:
            document: Any = json.loads(text)
        except json.JSONDecodeError as exc:
            errors.append(
                f"{location}:{exc.lineno}: invalid JSON: {exc.msg} "
                f"(field '{DOCUMENT_FIELD}')"
            )
            continue
        if not isinstance(document, dict):
            errors.append(
                f"{location}:1: expected a JSON object but found "
                f"{type(document).__name__} (field '{DOCUMENT_FIELD}')"
            )
            continue
        errors.extend(_document_errors(document, text, location, patterns))
    errors.extend(_duplicate_errors(patterns))
    return errors


def _document_errors(
    document: dict[str, Any],
    text: str,
    location: str,
    patterns: dict[str, dict[str, list[PatternUse]]],
) -> list[str]:
    errors: list[str] = []
    if document.get("version") != 1:
        errors.append(_error(location, text, "version", "expected version 1"))
    for field in REQUIRED_TEXT_FIELDS:
        value = document.get(field)
        if not isinstance(value, str) or not value.strip():
            errors.append(
                _error(location, text, field, f"{field} must be a non-empty string")
            )
    errors.extend(_state_errors(location, text, document.get("states")))
    telegraph = document.get("telegraph")
    if not _is_number(telegraph) or float(telegraph) < MIN_TELEGRAPH:
        errors.append(
            _error(
                location,
                text,
                "telegraph",
                f"telegraph must be a number of at least {MIN_TELEGRAPH} seconds",
            )
        )
    for field in ("speed", "hp"):
        value = document.get(field)
        if not _is_number(value) or float(value) <= 0:
            errors.append(
                _error(location, text, field, f"{field} must be a positive number")
            )
    for field in PATTERN_FIELDS:
        value = document.get(field)
        if not isinstance(value, str) or not value.strip():
            errors.append(
                _error(
                    location, text, field, f"{field} pattern must be a non-empty string"
                )
            )
            continue
        patterns[field].setdefault(value, []).append(
            (location, field_line(text, field))
        )
    return errors


def _state_errors(location: str, text: str, states: Any) -> list[str]:
    line = field_line(text, "states")
    if not isinstance(states, list) or not all(
        isinstance(state, str) for state in states
    ):
        return [
            f"{location}:{line}: states must be a list of strings (field 'states')"
        ]
    errors: list[str] = []
    for state in REQUIRED_STATES:
        if state not in states:
            errors.append(
                f"{location}:{line}: missing state '{state}' (field 'states')"
            )
    for state in states:
        if state not in REQUIRED_STATES:
            errors.append(
                f"{location}:{line}: unknown state '{state}' (field 'states')"
            )
    return errors


def _duplicate_errors(
    patterns: dict[str, dict[str, list[PatternUse]]],
) -> list[str]:
    errors: list[str] = []
    for field in PATTERN_FIELDS:
        for pattern, uses in sorted(patterns[field].items()):
            if len(uses) < 2:
                continue
            owners = ", ".join(location for location, _line in uses)
            for location, line in uses:
                errors.append(
                    f"{location}:{line}: duplicate {field} pattern '{pattern}' "
                    f"used by {owners} (field '{field}')"
                )
    return errors


def _is_number(value: Any) -> bool:
    return (
        not isinstance(value, bool)
        and isinstance(value, (int, float))
        and math.isfinite(value)
    )


def _error(location: str, text: str, field: str, message: str) -> str:
    return f"{location}:{field_line(text, field)}: {message} (field '{field}')"
