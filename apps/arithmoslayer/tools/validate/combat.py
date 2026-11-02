"""Validate the combat player data.

``data/combat/player.json`` holds the hero's movement numbers and camera
settings. Every number must be finite and greater than zero, so a typo cannot
produce a hero that never accelerates or a camera that never smooths. Problems
are reported with their file, line, and field.
"""

from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Any

from ._common import display, field_line

DATA_RELATIVE = Path("data") / "combat" / "player.json"
DOCUMENT_FIELD = "<document>"
MOVEMENT_FIELDS = ("maxSpeed", "acceleration", "deceleration", "radius")
CAMERA_FIELDS = ("smoothingSpeed", "zoom")


def type_name(value: Any) -> str:
    """Describe a JSON value for a type error."""
    if isinstance(value, bool):
        return "a boolean"
    if isinstance(value, int):
        return "an integer"
    if isinstance(value, float):
        return "a number"
    if isinstance(value, str):
        return "a string"
    if isinstance(value, list):
        return "a list"
    if isinstance(value, dict):
        return "an object"
    return "null"


def number_problem(value: Any) -> str | None:
    """Return why a number is invalid, or ``None`` when it is positive and finite."""
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return f"expected a number but found {type_name(value)}"
    if not math.isfinite(value) or value <= 0:
        return f"expected a number greater than zero but found {value!r}"
    return None


def validate_section(
    data: dict[str, Any], name: str, fields: tuple[str, ...], text: str, location: str
) -> list[str]:
    """Return every problem in one required numeric section."""
    errors: list[str] = []
    section = data.get(name)
    if not isinstance(section, dict):
        line = field_line(text, name)
        errors.append(
            f"{location}:{line}: expected an object but found {type_name(section)} "
            f"(field '{name}')"
        )
        return errors
    for field in fields:
        line = field_line(text, field)
        if field not in section:
            errors.append(f"{location}:{line}: missing required field (field '{field}')")
            continue
        problem = number_problem(section[field])
        if problem is not None:
            errors.append(
                f"{location}:{line}: {name} {field}: {problem} (field '{field}')"
            )
    return errors


def validate_document(text: str, location: str) -> list[str]:
    """Return every problem in a decoded ``player.json`` document."""
    try:
        data: Any = json.loads(text)
    except json.JSONDecodeError as exc:
        return [f"{location}:{exc.lineno}: invalid JSON: {exc.msg} (field '{DOCUMENT_FIELD}')"]
    if not isinstance(data, dict):
        return [
            f"{location}:1: expected a JSON object but found {type_name(data)} "
            f"(field '{DOCUMENT_FIELD}')"
        ]

    errors: list[str] = []
    if data.get("version") != 1:
        errors.append(
            f"{location}:{field_line(text, 'version')}: expected version 1 but found "
            f"{data.get('version')!r} (field 'version')"
        )
    errors.extend(validate_section(data, "movement", MOVEMENT_FIELDS, text, location))
    errors.extend(validate_section(data, "camera", CAMERA_FIELDS, text, location))
    return errors


def validate(root: Path) -> list[str]:
    """Return every problem in ``data/combat/player.json``."""
    path = root / DATA_RELATIVE
    if not path.is_file():
        return []
    location = display(path, root)
    try:
        text = path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError) as exc:
        return [f"{location}:1: cannot read the data file ({exc}) (field '{DOCUMENT_FIELD}')"]
    return validate_document(text, location)
