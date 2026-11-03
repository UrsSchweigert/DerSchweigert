"""Validate the number-pad data.

``data/input/number_pad.json`` defines the free-entry pad: the world slow scale
applied while it is open, the minimum key size, the haptic and sound switches,
and the two-thumb key layout. This module rejects a slow scale outside (0, 1],
a key smaller than 48 dp, a missing digit, delete, or confirm key, and any key
that names an unknown thumb.
"""

from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Any

from ._common import display, field_line

DATA_RELATIVE = Path("data") / "input" / "number_pad.json"
DOCUMENT_FIELD = "<document>"
DOCUMENT_FIELDS = ("version", "slowScale", "minKeyDp", "haptic", "sound", "keys")
KEY_FIELDS = ("id", "label", "thumb")
THUMBS = ("left", "right")
DIGITS = tuple(str(digit) for digit in range(10))
REQUIRED_KEYS = DIGITS + ("delete", "confirm")
MIN_KEY_DP = 48.0


def error(location: str, line: int, message: str, field: str) -> str:
    """Build one reported problem in the project's validator format."""
    return f"{location}:{line}: {message} (field '{field}')"


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


def is_number(value: Any) -> bool:
    """Return whether a decoded value is a finite JSON number."""
    return (
        not isinstance(value, bool)
        and isinstance(value, (int, float))
        and math.isfinite(value)
    )


def document_errors(text: str, location: str) -> list[str]:
    """Return every problem in one decoded ``number_pad.json`` document."""
    try:
        data: Any = json.loads(text)
    except json.JSONDecodeError as exc:
        return [error(location, exc.lineno, f"invalid JSON: {exc.msg}", DOCUMENT_FIELD)]
    if not isinstance(data, dict):
        return [
            error(location, 1, f"expected an object but found {type_name(data)}", DOCUMENT_FIELD)
        ]

    def problem(field: str, message: str) -> str:
        return error(location, field_line(text, field), message, field)

    errors = [problem(field, "unknown field") for field in data if field not in DOCUMENT_FIELDS]
    if data.get("version") != 1:
        errors.append(problem("version", "expected 1"))

    slow_scale = data.get("slowScale")
    if not is_number(slow_scale):
        errors.append(problem("slowScale", "expected a number between zero and one"))
    elif not 0.0 < slow_scale <= 1.0:
        errors.append(
            problem("slowScale", f"expected a number between zero and one but found {slow_scale!r}")
        )

    min_key_dp = data.get("minKeyDp")
    if not is_number(min_key_dp):
        errors.append(problem("minKeyDp", f"expected a number of at least {MIN_KEY_DP} dp"))
    elif min_key_dp < MIN_KEY_DP:
        errors.append(
            problem("minKeyDp", f"expected at least {MIN_KEY_DP} dp but found {min_key_dp!r}")
        )

    if not isinstance(data.get("haptic"), bool):
        errors.append(problem("haptic", "expected a boolean"))
    if not isinstance(data.get("sound"), bool):
        errors.append(problem("sound", "expected a boolean"))

    raw_keys = data.get("keys")
    if not isinstance(raw_keys, list) or not raw_keys:
        errors.append(problem("keys", "expected a non-empty list"))
    else:
        errors.extend(key_errors(raw_keys, text, location))
    return errors


def key_errors(keys: list[Any], text: str, location: str) -> list[str]:
    """Return every problem in the key list of a number-pad document."""
    errors: list[str] = []
    declared: list[str] = []
    for index, entry in enumerate(keys):
        if not isinstance(entry, dict):
            errors.append(
                error(location, field_line(text, "keys"), f"key {index} is {type_name(entry)}", "keys")
            )
            continue
        errors.extend(
            error(location, field_line(text, field), "unknown field", field)
            for field in entry
            if field not in KEY_FIELDS
        )
        key_id = entry.get("id")
        if not isinstance(key_id, str) or not key_id:
            errors.append(
                error(location, field_line(text, "id"), f"key {index} needs a non-empty id", "id")
            )
        elif key_id in declared:
            errors.append(error(location, field_line(text, "id"), f"duplicate key id '{key_id}'", "id"))
        else:
            declared.append(key_id)
        label = entry.get("label")
        if not isinstance(label, str) or not label:
            errors.append(
                error(location, field_line(text, "label"), f"key {index} needs a non-empty label", "label")
            )
        thumb = entry.get("thumb")
        if thumb not in THUMBS:
            errors.append(
                error(location, field_line(text, "thumb"), f"expected one of {', '.join(THUMBS)}", "thumb")
            )
    for required in REQUIRED_KEYS:
        if required not in declared:
            errors.append(error(location, field_line(text, "keys"), f"missing key '{required}'", "keys"))
    return errors


def validate(root: Path) -> list[str]:
    """Return every problem in ``data/input/number_pad.json``."""
    path = root / DATA_RELATIVE
    if not path.is_file():
        return []
    location = display(path, root)
    try:
        text = path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError) as exc:
        return [error(location, 1, f"cannot read the data file ({exc})", DOCUMENT_FIELD)]
    return document_errors(text, location)
