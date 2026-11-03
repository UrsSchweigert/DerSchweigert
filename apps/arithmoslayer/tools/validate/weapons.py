"""Validate the data-only weapon format.

``data/weapons/schema.json`` describes the format and every other ``*.json`` in
that directory is a weapon. A weapon is an ordered combo graph, so this module
rejects unknown fields at every level and enforces the graph rules the engine
relies on: unique ids, positive frame data, cancel targets that exist, and
exactly one finisher as the last step.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from ._common import display, field_line

DATA_RELATIVE = Path("data") / "weapons"
SCHEMA_NAME = "schema.json"
DOCUMENT_FIELDS = ("version", "id", "inputBufferFrames", "steps", "affinity", "mastery")
REQUIRED_DOCUMENT_FIELDS = ("version", "id", "inputBufferFrames", "steps")
MASTERY_FIELDS = ("levels",)
MASTERY_LEVEL_FIELDS = ("threshold", "steps", "finisher", "trail")
AFFINITIES = ("sum", "product", "quotient", "difference", "equal")
MIN_LEVEL_STEPS = 3
STEP_FIELDS = (
    "id", "input", "frames", "hitbox", "impulse", "knockback", "cancel", "orb", "effects",
    "sounds", "finisher",
)
INPUT_KINDS = ("tap", "hold", "charge", "swipe", "rhythm")
DIRECTIONS = ("up", "down", "left", "right")
HITBOX_SHAPES = ("rectangle", "circle", "line")
ORB_PATTERNS = ("single", "cone", "line", "chain")
MAX_TOUCHES = 2
OPTIONAL_INPUT = ("direction", "holdFrames", "chargeFrames", "rhythmBeats")
# Each rule is ("integer", minimum[, maximum]), ("enum", values), ("size",) for a
# positive width and height pair, or ("ids",) for cancel targets that must exist.
SECTIONS: dict[str, dict[str, tuple[Any, ...]]] = {
    "input": {
        "kind": ("enum", INPUT_KINDS), "direction": ("enum", DIRECTIONS),
        "holdFrames": ("integer", 1), "chargeFrames": ("integer", 1),
        "rhythmBeats": ("integer", 1), "touches": ("integer", 1, MAX_TOUCHES),
    },
    "frames": {"startup": ("integer", 0), "active": ("integer", 1), "recovery": ("integer", 0)},
    "hitbox": {"shape": ("enum", HITBOX_SHAPES), "size": ("size",)},
    "cancel": {"startFrame": ("integer", 0), "endFrame": ("integer", 1), "into": ("ids",)},
}
TYPE_NAMES = {bool: "a boolean", int: "an integer", float: "a number", str: "a string", list: "a list", dict: "an object"}


def type_name(value: Any) -> str:
    """Describe a JSON value for a type error."""
    return TYPE_NAMES.get(type(value), "null")


def is_integer(value: Any) -> bool:
    """Return whether a decoded value is a whole JSON number."""
    return not isinstance(value, bool) and isinstance(value, int)


def line_of(text: str, field: str, step_id: str | None = None) -> int:
    """Return the line declaring ``field``, preferring the block of ``step_id``."""
    lines = text.splitlines()
    if step_id is not None:
        for index, line in enumerate(lines):
            if f'"{step_id}"' in line:
                for offset, candidate in enumerate(lines[index:], start=index + 1):
                    if f'"{field}"' in candidate:
                        return offset
    return field_line(text, field)


def error(location: str, line: int, message: str, field: str) -> str:
    """Build one reported problem in the project's validator format."""
    return f"{location}:{line}: {message} (field '{field}')"


def unknown_fields(
    data: dict[str, Any], allowed: tuple[str, ...], text: str, location: str, step_id: str | None = None
) -> list[str]:
    """Return a problem for every field the schema does not declare."""
    return [
        error(location, line_of(text, field, step_id), "unknown field", field)
        for field in data
        if field not in allowed
    ]


def leaf_problem(rule: tuple[Any, ...], value: Any, ids: list[str]) -> str | None:
    """Return why ``value`` breaks one field rule, or ``None`` when it holds."""
    kind = rule[0]
    if kind == "integer":
        low, high = rule[1], rule[2] if len(rule) > 2 else None
        if not is_integer(value) or value < low or (high is not None and value > high):
            return f"expected an integer from {low} to {high}" if high is not None else f"expected an integer of at least {low}"
    elif kind == "enum" and value not in rule[1]:
        return f"expected one of {', '.join(rule[1])}"
    elif kind == "size":
        if not (isinstance(value, list) and len(value) == 2 and all(type(v) in (int, float) for v in value)):
            return "expected a width and height pair"
        if not all(v > 0 for v in value):
            return "expected a positive width and height"
    elif kind == "ids":
        if not isinstance(value, list):
            return "expected a list of step ids"
        missing = [target for target in value if not isinstance(target, str) or target not in ids]
        if missing:
            return f"unknown cancel target {missing[0]!r}"
    return None


def validate_step(step: Any, index: int, text: str, location: str, ids: list[str]) -> list[str]:
    """Return every problem in one combo step."""
    if not isinstance(step, dict):
        return [error(location, 1, f"step {index} is {type_name(step)}", "steps")]
    raw_id = step.get("id")
    label = raw_id if isinstance(raw_id, str) and raw_id else None
    errors = unknown_fields(step, STEP_FIELDS, text, location, label)
    if label is None:
        errors.append(error(location, 1, f"step {index} needs a non-empty id", "id"))
    elif ids[:index].count(raw_id) > 0:
        errors.append(error(location, line_of(text, "id", label), f"duplicate step id '{raw_id}'", "id"))
    if step.get("orb") not in ORB_PATTERNS:
        message = f"expected one of {', '.join(ORB_PATTERNS)}"
        errors.append(error(location, line_of(text, "orb", label), message, "orb"))
    for name in ("effects", "sounds"):
        value = step.get(name, [])
        if not (isinstance(value, list) and all(isinstance(item, str) for item in value)):
            errors.append(error(location, line_of(text, name, label), "expected a list of strings", name))
    if not isinstance(step.get("finisher", False), bool):
        errors.append(error(location, line_of(text, "finisher", label), "expected a boolean", "finisher"))
    for section, rules in SECTIONS.items():
        data = step.get(section)
        if not isinstance(data, dict):
            message = f"expected an object but found {type_name(data)}"
            errors.append(error(location, line_of(text, section, label), message, section))
            continue
        errors.extend(unknown_fields(data, tuple(rules), text, location, label))
        for field, rule in rules.items():
            line = line_of(text, field, label)
            if field not in data:
                if field not in OPTIONAL_INPUT:
                    errors.append(error(location, line, "missing required field", field))
                continue
            problem = leaf_problem(rule, data[field], ids)
            if problem is not None:
                errors.append(error(location, line, problem, field))
    return errors


def validate_mastery(value: Any, text: str, location: str, ids: list[str]) -> list[str]:
    """Return every problem in the optional mastery levels of a weapon."""
    if not isinstance(value, dict):
        message = f"expected an object but found {type_name(value)}"
        return [error(location, field_line(text, "mastery"), message, "mastery")]
    errors = unknown_fields(value, MASTERY_FIELDS, text, location)
    levels = value.get("levels")
    if not isinstance(levels, list) or not levels:
        message = "expected a non-empty list"
        return errors + [error(location, field_line(text, "levels"), message, "levels")]
    previous = -1
    for index, level in enumerate(levels):
        if not isinstance(level, dict):
            message = f"mastery level {index} is {type_name(level)}"
            errors.append(error(location, field_line(text, "threshold"), message, "levels"))
            continue
        errors.extend(unknown_fields(level, MASTERY_LEVEL_FIELDS, text, location))
        threshold = level.get("threshold")
        if not (is_integer(threshold) and threshold >= 0):
            errors.append(error(location, field_line(text, "threshold"), "expected a non-negative integer", "threshold"))
        elif index == 0 and threshold != 0:
            errors.append(error(location, field_line(text, "threshold"), "the first level must start at 0", "threshold"))
        elif threshold <= previous:
            errors.append(error(location, field_line(text, "threshold"), "mastery thresholds must ascend", "threshold"))
        else:
            previous = threshold
        steps = level.get("steps")
        if not (isinstance(steps, list) and all(isinstance(step, str) for step in steps)):
            errors.append(error(location, field_line(text, "steps"), "expected a list of step ids", "steps"))
        else:
            if len(steps) < MIN_LEVEL_STEPS:
                message = f"level {index} needs at least {MIN_LEVEL_STEPS} steps"
                errors.append(error(location, field_line(text, "steps"), message, "steps"))
            missing = [step for step in steps if step not in ids]
            if missing:
                errors.append(error(location, field_line(text, "steps"), f"unknown step id {missing[0]!r}", "steps"))
        for name in ("finisher", "trail"):
            if not isinstance(level.get(name), str):
                errors.append(error(location, field_line(text, name), "expected a string", name))
    return errors


def validate_document(text: str, location: str) -> list[str]:
    """Return every problem in one decoded weapon document."""
    try:
        data: Any = json.loads(text)
    except json.JSONDecodeError as exc:
        return [error(location, exc.lineno, f"invalid JSON: {exc.msg}", "<document>")]
    if not isinstance(data, dict):
        return [error(location, 1, f"expected an object but found {type_name(data)}", "<document>")]
    errors = unknown_fields(data, DOCUMENT_FIELDS, text, location)
    for name in REQUIRED_DOCUMENT_FIELDS:
        if name not in data:
            errors.append(error(location, field_line(text, name), "missing required field", name))
    if data.get("version") != 1:
        errors.append(error(location, line_of(text, "version"), "expected 1", "version"))
    if not isinstance(data.get("id"), str) or not data.get("id"):
        errors.append(error(location, line_of(text, "id"), "expected a non-empty string", "id"))
    buffer = data.get("inputBufferFrames")
    if not (is_integer(buffer) and buffer >= 1):
        errors.append(error(location, line_of(text, "inputBufferFrames"), "expected a positive frame count", "inputBufferFrames"))
    steps = data.get("steps")
    if not isinstance(steps, list) or not steps:
        errors.append(error(location, line_of(text, "steps"), "expected a non-empty list", "steps"))
        return errors
    ids = [s.get("id") for s in steps if isinstance(s, dict) and isinstance(s.get("id"), str)]
    if "affinity" in data and data["affinity"] not in AFFINITIES:
        message = f"expected one of {', '.join(AFFINITIES)}"
        errors.append(error(location, field_line(text, "affinity"), message, "affinity"))
    if "mastery" in data:
        errors.extend(validate_mastery(data["mastery"], text, location, ids))
    for index, step in enumerate(steps):
        errors.extend(validate_step(step, index, text, location, ids))
    finishers = [i for i, s in enumerate(steps) if isinstance(s, dict) and s.get("finisher") is True]
    if len(finishers) != 1:
        message = f"expected exactly one finisher but found {len(finishers)}"
        errors.append(error(location, line_of(text, "finisher"), message, "finisher"))
    elif finishers[0] != len(steps) - 1:
        errors.append(error(location, line_of(text, "finisher"), "must be the last step", "finisher"))
    return errors


def validate(root: Path) -> list[str]:
    """Validate the weapon schema and every weapon document under ``root``.

    A project that ships no weapon data has nothing to validate; the game
    project itself is guarded by ``test/unit/weapons/test_combo_engine.gd``.
    """
    directory = root / DATA_RELATIVE
    if not directory.is_dir():
        return []
    schema_path = directory / SCHEMA_NAME
    if not schema_path.is_file():
        return [f"{display(schema_path, root)}:1: missing schema (field '<document>')"]
    errors: list[str] = []
    schema = json.loads(schema_path.read_text(encoding="utf-8"))
    for name in set(DOCUMENT_FIELDS) - set(schema.get("properties", {})):
        errors.append(error(display(schema_path, root), 1, "schema omits a field", name))
    for path in sorted(directory.glob("*.json")):
        if path.name != SCHEMA_NAME:
            errors.extend(validate_document(path.read_text(encoding="utf-8"), display(path, root)))
    return errors
