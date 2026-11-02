"""Validate the combat health, dodge, and respawn data.

``data/combat/health.json`` holds the hearts count, the dodge i-frame window and
cooldown, and the respawn timings. Every number must be finite and in range so a
typo cannot remove the i-frames, make a dodge impossible to repeat, or respawn
without protection. Problems name the file, line, and field.
"""

from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Any

from ._common import display, field_line

DATA_RELATIVE = Path("data") / "combat" / "health.json"
DOCUMENT_FIELD = "<document>"
DOCUMENT_FIELDS = ("version", "health", "dodge", "respawn")
RULES = {
    "health": {
        "maxHearts": "positive_integer",
        "startingHearts": "positive_integer",
        "hitInvulnerabilitySeconds": "positive_number",
    },
    "dodge": {
        "cooldownSeconds": "positive_number",
        "durationSeconds": "positive_number",
        "invulnerabilityStartSeconds": "non_negative_number",
        "invulnerabilityEndSeconds": "positive_number",
        "speedMultiplier": "positive_number",
    },
    "respawn": {
        "delaySeconds": "non_negative_number",
        "invulnerabilitySeconds": "non_negative_number",
    },
}
TYPE_NAMES = {bool: "a boolean", int: "an integer", float: "a number", str: "a string", list: "a list", dict: "an object"}


def type_name(value: Any) -> str:
    """Describe a JSON value for a type error."""
    return TYPE_NAMES.get(type(value), "null")


def is_number(value: Any) -> bool:
    """Return whether a decoded value is a finite JSON number."""
    return not isinstance(value, bool) and isinstance(value, (int, float)) and math.isfinite(value)


def leaf_problem(rule: str, value: Any) -> str | None:
    """Return why ``value`` breaks one field rule, or ``None`` when it holds."""
    if rule == "positive_integer":
        if not isinstance(value, int) or isinstance(value, bool):
            return f"expected an integer but found {type_name(value)}"
        return None if value >= 1 else f"expected an integer of at least 1 but found {value!r}"
    if not is_number(value):
        return f"expected a number but found {type_name(value)}"
    if rule == "positive_number" and value <= 0:
        return f"expected a number greater than zero but found {value!r}"
    if rule == "non_negative_number" and value < 0:
        return f"expected a number of at least zero but found {value!r}"
    return None


def error(location: str, line: int, message: str, field: str) -> str:
    """Build one reported problem in the project's validator format."""
    return f"{location}:{line}: {message} (field '{field}')"


def unknown_fields(data: dict[str, Any], allowed: tuple[str, ...], text: str, location: str) -> list[str]:
    """Return a problem for every field the document does not declare."""
    return [error(location, field_line(text, field), "unknown field", field) for field in data if field not in allowed]


def section_errors(data: dict[str, Any], name: str, text: str, location: str) -> list[str]:
    """Return every type and range problem in one required section."""
    section = data.get(name)
    if not isinstance(section, dict):
        line = field_line(text, name)
        return [error(location, line, f"expected an object but found {type_name(section)}", name)]
    errors = unknown_fields(section, tuple(RULES[name]), text, location)
    for field, rule in RULES[name].items():
        line = field_line(text, field)
        if field not in section:
            errors.append(error(location, line, "missing required field", field))
        else:
            problem = leaf_problem(rule, section[field])
            if problem is not None:
                errors.append(error(location, line, problem, field))
    return errors


def cross_field_errors(data: dict[str, Any], text: str, location: str) -> list[str]:
    """Return the range relationships the runtime relies on."""
    errors: list[str] = []
    health = data.get("health", {})
    dodge = data.get("dodge", {})
    if isinstance(health, dict):
        maximum = health.get("maxHearts")
        starting = health.get("startingHearts")
        if isinstance(maximum, int) and isinstance(starting, int) and starting > maximum:
            line = field_line(text, "startingHearts")
            errors.append(error(location, line, f"startingHearts {starting} is greater than maxHearts {maximum}", "startingHearts"))
    if isinstance(dodge, dict):
        start = dodge.get("invulnerabilityStartSeconds")
        end = dodge.get("invulnerabilityEndSeconds")
        duration = dodge.get("durationSeconds")
        cooldown = dodge.get("cooldownSeconds")
        line = field_line(text, "invulnerabilityEndSeconds")
        if is_number(start) and is_number(end) and end < start:
            errors.append(error(location, line, f"invulnerabilityEndSeconds {end!r} is before the start {start!r}", "invulnerabilityEndSeconds"))
        if is_number(end) and is_number(duration) and end > duration:
            errors.append(error(location, line, f"invulnerabilityEndSeconds {end!r} is after the roll duration {duration!r}", "invulnerabilityEndSeconds"))
        if is_number(cooldown) and is_number(duration) and cooldown < duration:
            line = field_line(text, "cooldownSeconds")
            errors.append(error(location, line, f"cooldownSeconds {cooldown!r} is shorter than the roll duration {duration!r}", "cooldownSeconds"))
    return errors


def validate_document(text: str, location: str) -> list[str]:
    """Return every problem in a decoded ``health.json`` document."""
    try:
        data: Any = json.loads(text)
    except json.JSONDecodeError as exc:
        return [error(location, exc.lineno, f"invalid JSON: {exc.msg}", DOCUMENT_FIELD)]
    if not isinstance(data, dict):
        return [error(location, 1, f"expected an object but found {type_name(data)}", DOCUMENT_FIELD)]
    errors = unknown_fields(data, DOCUMENT_FIELDS, text, location)
    if data.get("version") != 1:
        errors.append(error(location, field_line(text, "version"), "expected 1", "version"))
    for name in RULES:
        errors.extend(section_errors(data, name, text, location))
    errors.extend(cross_field_errors(data, text, location))
    return errors


def validate(root: Path) -> list[str]:
    """Return every problem in ``data/combat/health.json``."""
    path = root / DATA_RELATIVE
    if not path.is_file():
        return []
    location = display(path, root)
    try:
        text = path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError) as exc:
        return [error(location, 1, f"cannot read the data file ({exc})", DOCUMENT_FIELD)]
    return validate_document(text, location)
