"""Validate ``data/android_targets.json``, the Android SDK target record.

The record holds the SDK levels, the requested permissions, and the source
note the release owner uses when maintaining the export preset. A bad value
here would ship a Play build with the wrong API level or an extra permission,
so every required field is checked and each error names the field.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

from validate import display

TARGETS_RELATIVE = Path("data") / "android_targets.json"
REQUIRED_FIELDS = ("source", "minSdk", "targetSdk", "permissions")
PERMISSION_PATTERN = re.compile(r"^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)+$")
MIN_SOURCE_LENGTH = 20


def _line_of(raw: str, field: str) -> int:
    needle = f'"{field}"'
    for line_number, line in enumerate(raw.splitlines(), start=1):
        if needle in line:
            return line_number
    return 1


def _error(location: str, raw: str, field: str, message: str) -> str:
    return f"{location}:{_line_of(raw, field)}: {message} (field '{field}')"


def _is_int(value: object) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


def validate(root: Path) -> list[str]:
    """Validate the Android target record and return every problem found."""
    path = root / TARGETS_RELATIVE
    location = display(path, root)
    if not path.is_file():
        return [f"{location}:1: missing Android target record (field 'minSdk')"]
    try:
        raw = path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError) as exc:
        return [f"{location}:1: cannot read the Android target record ({exc}) (field 'minSdk')"]

    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        return [f"{location}:{exc.lineno}: invalid JSON: {exc.msg} (field '<document>')"]

    if not isinstance(data, dict):
        return [f"{location}:1: expected a JSON object (field '<document>')"]

    errors: list[str] = []
    for field in REQUIRED_FIELDS:
        if field not in data:
            errors.append(_error(location, raw, field, "missing required field"))

    min_sdk = data.get("minSdk")
    if "minSdk" in data and (not _is_int(min_sdk) or min_sdk < 1):
        errors.append(_error(location, raw, "minSdk", "minSdk must be a positive integer"))

    target_sdk = data.get("targetSdk")
    if "targetSdk" in data and (not _is_int(target_sdk) or target_sdk < 1):
        errors.append(_error(location, raw, "targetSdk", "targetSdk must be a positive integer"))
    elif _is_int(min_sdk) and _is_int(target_sdk) and target_sdk < min_sdk:
        errors.append(
            _error(location, raw, "targetSdk", "targetSdk must be at least minSdk")
        )

    if "permissions" in data:
        errors.extend(_validate_permissions(location, raw, data["permissions"]))

    if "source" in data:
        source = data["source"]
        if not isinstance(source, str) or len(source.strip()) < MIN_SOURCE_LENGTH:
            errors.append(
                _error(
                    location,
                    raw,
                    "source",
                    f"source must cite the SDK policy in at least {MIN_SOURCE_LENGTH} characters",
                )
            )
    return errors


def _validate_permissions(location: str, raw: str, permissions: object) -> list[str]:
    if not isinstance(permissions, list):
        return [_error(location, raw, "permissions", "permissions must be a list")]
    errors: list[str] = []
    seen: set[str] = set()
    for index, permission in enumerate(permissions):
        if not isinstance(permission, str) or not PERMISSION_PATTERN.match(permission):
            errors.append(
                _error(
                    location,
                    raw,
                    "permissions",
                    f"permissions[{index}] is not a dotted Android permission name",
                )
            )
            continue
        if permission in seen:
            errors.append(
                _error(location, raw, "permissions", f"duplicate permission '{permission}'")
            )
            continue
        seen.add(permission)
    return errors
