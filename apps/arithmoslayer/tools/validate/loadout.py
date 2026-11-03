"""Validate the weapon loadout data.

``data/weapons/loadout.json`` declares the two quick-swap slots, the short swap
cooldown, the unlock sources, and every weapon's unlock route. This module
rejects unknown fields, a slot count other than two, an out-of-range cooldown,
any unlock source that is not exploration, quest, or boss, and a loadout that
omits a shipped weapon or names a weapon document that does not exist.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from ._common import display, field_line

DATA_RELATIVE = Path("data") / "weapons" / "loadout.json"
WEAPONS_RELATIVE = Path("data") / "weapons"
IGNORED_DOCUMENTS = ("schema.json", "loadout.json")
DOCUMENT_FIELDS = ("version", "slots", "swapCooldownFrames", "sources", "weapons", "starting")
ENTRY_FIELDS = ("id", "source", "unlock")
SOURCES = ("exploration", "quest", "boss")
SLOT_COUNT = 2
MAX_COOLDOWN_FRAMES = 30
TYPE_NAMES = {bool: "a boolean", int: "an integer", float: "a number", str: "a string", list: "a list", dict: "an object"}


def error(location: str, line: int, message: str, field: str) -> str:
    """Build one reported problem in the project's validator format."""
    return f"{location}:{line}: {message} (field '{field}')"


def type_name(value: Any) -> str:
    """Describe a JSON value for a type error."""
    return TYPE_NAMES.get(type(value), "null")


def is_integer(value: Any) -> bool:
    """Return whether a decoded value is a whole JSON number."""
    return not isinstance(value, bool) and isinstance(value, int)


def document_ids(root: Path) -> list[str]:
    """Return every weapon id declared by a weapon document under ``root``."""
    ids: list[str] = []
    for path in sorted((root / WEAPONS_RELATIVE).glob("*.json")):
        if path.name in IGNORED_DOCUMENTS:
            continue
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        if isinstance(data, dict) and isinstance(data.get("id"), str):
            ids.append(data["id"])
    return ids


def entry_errors(
    entry: Any, index: int, text: str, location: str, declared: list[str], sources: list[Any]
) -> list[str]:
    """Return every problem in one weapon unlock entry."""
    if not isinstance(entry, dict):
        return [error(location, field_line(text, "weapons"), f"weapon {index} is {type_name(entry)}", "weapons")]
    errors = [
        error(location, field_line(text, field), "unknown field", field)
        for field in entry
        if field not in ENTRY_FIELDS
    ]
    weapon_id = entry.get("id")
    if not isinstance(weapon_id, str) or not weapon_id:
        errors.append(error(location, field_line(text, "id"), f"weapon {index} needs a non-empty id", "id"))
    elif weapon_id in declared:
        errors.append(error(location, field_line(text, "id"), f"duplicate weapon id '{weapon_id}'", "id"))
    else:
        declared.append(weapon_id)
    source = entry.get("source")
    if source not in SOURCES:
        errors.append(error(location, field_line(text, "source"), f"expected one of {', '.join(SOURCES)}", "source"))
    elif source not in sources:
        errors.append(error(location, field_line(text, "source"), f"source '{source}' is not declared", "source"))
    if not isinstance(entry.get("unlock"), str) or not entry["unlock"]:
        errors.append(error(location, field_line(text, "unlock"), "expected a non-empty string", "unlock"))
    return errors


def document_errors(text: str, location: str, ids: list[str]) -> list[str]:
    """Return every problem in one decoded loadout document."""
    try:
        data: Any = json.loads(text)
    except json.JSONDecodeError as exc:
        return [error(location, exc.lineno, f"invalid JSON: {exc.msg}", "<document>")]
    if not isinstance(data, dict):
        return [error(location, 1, f"expected an object but found {type_name(data)}", "<document>")]

    def problem(field: str, message: str) -> str:
        return error(location, field_line(text, field), message, field)

    errors = [problem(field, "unknown field") for field in data if field not in DOCUMENT_FIELDS]
    if data.get("version") != 1:
        errors.append(problem("version", "expected 1"))
    if not is_integer(data.get("slots")) or data.get("slots") != SLOT_COUNT:
        errors.append(problem("slots", f"expected exactly {SLOT_COUNT} quick-swap slots"))
    cooldown = data.get("swapCooldownFrames")
    if not is_integer(cooldown) or not 1 <= cooldown <= MAX_COOLDOWN_FRAMES:
        errors.append(problem("swapCooldownFrames", f"expected an integer from 1 to {MAX_COOLDOWN_FRAMES}"))
    raw_sources = data.get("sources")
    sources: list[Any] = raw_sources if isinstance(raw_sources, list) else []
    if not isinstance(raw_sources, list):
        errors.append(problem("sources", "expected a list"))
    else:
        errors.extend(
            problem("sources", f"unlock source {source!r} is not exploration, quest, or boss")
            for source in sources
            if source not in SOURCES
        )
        errors.extend(
            problem("sources", f"missing unlock source '{required}'")
            for required in SOURCES
            if required not in sources
        )
    declared: list[str] = []
    raw_weapons = data.get("weapons")
    if not isinstance(raw_weapons, list) or not raw_weapons:
        errors.append(problem("weapons", "expected a non-empty list"))
    else:
        for index, entry in enumerate(raw_weapons):
            errors.extend(entry_errors(entry, index, text, location, declared, sources))
    raw_starting = data.get("starting")
    if not isinstance(raw_starting, list) or not raw_starting:
        errors.append(problem("starting", "expected a non-empty list"))
    else:
        errors.extend(
            problem("starting", f"starting weapon {weapon_id!r} is not declared")
            for weapon_id in raw_starting
            if not isinstance(weapon_id, str) or weapon_id not in declared
        )
    errors.extend(
        problem("weapons", f"weapon '{weapon_id}' has no weapon document")
        for weapon_id in declared
        if weapon_id not in ids
    )
    errors.extend(
        problem("weapons", f"weapon document '{weapon_id}' is missing from the loadout")
        for weapon_id in ids
        if weapon_id not in declared
    )
    return errors


def validate(root: Path) -> list[str]:
    """Validate ``data/weapons/loadout.json`` when the project ships one."""
    path = root / DATA_RELATIVE
    if not path.is_file():
        return []
    try:
        text = path.read_text(encoding="utf-8")
    except OSError as exc:
        return [error(display(path, root), 1, f"cannot read the loadout ({exc})", "<document>")]
    return document_errors(text, display(path, root), document_ids(root))
