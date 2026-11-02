"""Validate the Android SDK and permission record.

``data/android_targets.json`` records the SDK levels and the only permission
the game may request. This module checks the JSON syntax, the required fields,
their types, and the cross references between them. Every problem is reported
with its file, line, and field.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from ._common import display, field_line

DATA_RELATIVE = Path("data") / "android_targets.json"
DOCUMENT_FIELD = "<document>"
REQUIRED_FIELDS = ("source", "minSdk", "targetSdk", "permissions")
INTEGER_FIELDS = ("minSdk", "targetSdk")
ALLOWED_PERMISSIONS = frozenset({"com.android.vending.BILLING"})


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


def is_integer(value: Any) -> bool:
    """Return whether a JSON value is an integer rather than a boolean."""
    return isinstance(value, int) and not isinstance(value, bool)


def validate_document(text: str, location: str) -> list[str]:
    """Return every problem in a decoded ``android_targets.json`` document."""
    try:
        data: Any = json.loads(text)
    except json.JSONDecodeError as exc:
        return [
            f"{location}:{exc.lineno}: invalid JSON: {exc.msg} "
            f"(field '{DOCUMENT_FIELD}')"
        ]
    if not isinstance(data, dict):
        return [
            f"{location}:1: expected a JSON object but found {type_name(data)} "
            f"(field '{DOCUMENT_FIELD}')"
        ]

    errors: list[str] = []
    for field in REQUIRED_FIELDS:
        if field not in data:
            errors.append(
                f"{location}:1: required field is missing (field '{field}')"
            )

    source = data.get("source")
    if "source" in data and (not isinstance(source, str) or not source.strip()):
        line = field_line(text, "source")
        errors.append(
            f"{location}:{line}: expected a non-empty string but found "
            f"{type_name(source)} (field 'source')"
        )

    for field in INTEGER_FIELDS:
        if field not in data:
            continue
        value = data[field]
        if not is_integer(value):
            line = field_line(text, field)
            errors.append(
                f"{location}:{line}: expected an integer but found {type_name(value)} "
                f"(field '{field}')"
            )

    min_sdk = data.get("minSdk")
    target_sdk = data.get("targetSdk")
    if is_integer(min_sdk) and is_integer(target_sdk) and min_sdk > target_sdk:
        line = field_line(text, "minSdk")
        errors.append(
            f"{location}:{line}: minSdk {min_sdk} is greater than targetSdk "
            f"{target_sdk} (field 'minSdk')"
        )

    if "permissions" in data:
        errors.extend(validate_permissions(data["permissions"], text, location))
    return errors


def validate_permissions(value: Any, text: str, location: str) -> list[str]:
    """Return every problem in the permission list."""
    line = field_line(text, "permissions")
    if not isinstance(value, list):
        return [
            f"{location}:{line}: expected a list of strings but found "
            f"{type_name(value)} (field 'permissions')"
        ]
    errors: list[str] = []
    seen: set[str] = set()
    for permission in value:
        if not isinstance(permission, str):
            errors.append(
                f"{location}:{line}: expected a string but found {type_name(permission)} "
                f"(field 'permissions')"
            )
        elif permission not in ALLOWED_PERMISSIONS:
            errors.append(
                f"{location}:{line}: permission '{permission}' is not allowed "
                f"(field 'permissions')"
            )
        elif permission in seen:
            errors.append(
                f"{location}:{line}: duplicate permission '{permission}' "
                f"(field 'permissions')"
            )
        else:
            seen.add(permission)
    return errors


def validate(root: Path) -> list[str]:
    """Return every problem in ``data/android_targets.json``."""
    path = root / DATA_RELATIVE
    location = display(path, root)
    if not path.is_file():
        return [
            f"{location}:1: missing data file (field '{DOCUMENT_FIELD}')"
        ]
    try:
        text = path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError) as exc:
        return [
            f"{location}:1: cannot read the data file ({exc}) "
            f"(field '{DOCUMENT_FIELD}')"
        ]
    return validate_document(text, location)
