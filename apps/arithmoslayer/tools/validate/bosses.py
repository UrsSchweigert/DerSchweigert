"""Validate the boss documents in ``data/combat/bosses.json``.

Each boss names an island from ``data/curriculum/bands.json``, a positive hp,
and phases whose band ids all belong to that island. Boss and phase ids are
unique, hp and durations are positive, and patterns are non-empty.
"""

from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Any

from ._common import display, field_line

DATA_RELATIVE = Path("data") / "combat" / "bosses.json"
BANDS_RELATIVE = Path("data") / "curriculum" / "bands.json"
DOCUMENT_FIELD = "<document>"


def validate(root: Path) -> list[str]:
    """Return every problem in the boss document."""
    path = root / DATA_RELATIVE
    if not path.is_file():
        return []
    location = display(path, root)
    try:
        text = path.read_text(encoding="utf-8")
        document: Any = json.loads(text)
    except (OSError, UnicodeDecodeError) as exc:
        return [f"{location}:1: cannot read the data file ({exc}) (field '{DOCUMENT_FIELD}')"]
    except json.JSONDecodeError as exc:
        return [f"{location}:{exc.lineno}: invalid JSON: {exc.msg} (field '{DOCUMENT_FIELD}')"]
    if not isinstance(document, dict):
        return [f"{location}:1: expected a JSON object (field '{DOCUMENT_FIELD}')"]

    islands, band_islands = _curriculum(root)
    errors: list[str] = []
    if document.get("version") != 1:
        errors.append(_error(location, text, "version", "expected version 1"))
    bosses = document.get("bosses")
    if not isinstance(bosses, list) or not bosses:
        errors.append(_error(location, text, "bosses", "bosses must be a non-empty list"))
        return errors
    seen: set[str] = set()
    for boss in bosses:
        if not isinstance(boss, dict):
            errors.append(_error(location, text, "bosses", "every boss must be an object"))
            continue
        errors.extend(
            _boss_errors(boss, text, location, islands, band_islands, seen)
        )
    return errors


def _boss_errors(
    boss: dict[str, Any],
    text: str,
    location: str,
    islands: set[str],
    band_islands: dict[str, str],
    seen: set[str],
) -> list[str]:
    errors: list[str] = []
    boss_id = boss.get("id")
    if not isinstance(boss_id, str) or not boss_id.strip():
        errors.append(_error(location, text, "id", "boss id must be a non-empty string"))
    elif boss_id in seen:
        errors.append(_error(location, text, "id", f"duplicate boss id '{boss_id}'"))
    else:
        seen.add(boss_id)
    island = boss.get("island")
    if not isinstance(island, str) or not island.strip():
        errors.append(_error(location, text, "island", "island must be a non-empty string"))
        island = ""
    elif island not in islands:
        errors.append(_error(location, text, "island", f"unknown island '{island}'"))
    if not _positive(boss.get("hp")):
        errors.append(_error(location, text, "hp", "hp must be a positive number"))
    phases = boss.get("phases")
    if not isinstance(phases, list) or not phases:
        errors.append(_error(location, text, "phases", "phases must be a non-empty list"))
        return errors
    seen_phases: set[str] = set()
    for phase in phases:
        if not isinstance(phase, dict):
            errors.append(_error(location, text, "phases", "every phase must be an object"))
            continue
        errors.extend(
            _phase_errors(phase, text, location, island, band_islands, seen_phases)
        )
    return errors


def _phase_errors(
    phase: dict[str, Any],
    text: str,
    location: str,
    island: str,
    band_islands: dict[str, str],
    seen: set[str],
) -> list[str]:
    errors: list[str] = []
    phase_id = phase.get("id")
    if not isinstance(phase_id, str) or not phase_id.strip():
        errors.append(_error(location, text, "id", "phase id must be a non-empty string"))
    elif phase_id in seen:
        errors.append(_error(location, text, "id", f"duplicate phase id '{phase_id}'"))
    else:
        seen.add(phase_id)
    if not _positive(phase.get("hp")):
        errors.append(_error(location, text, "hp", "phase hp must be a positive number"))
    if not _positive(phase.get("duration")):
        errors.append(_error(location, text, "duration", "duration must be positive"))
    pattern = phase.get("pattern")
    if not isinstance(pattern, str) or not pattern.strip():
        errors.append(_error(location, text, "pattern", "pattern must be a non-empty string"))
    errors.extend(_band_errors(phase.get("bands"), text, location, island, band_islands))
    return errors


def _band_errors(
    bands: Any,
    text: str,
    location: str,
    island: str,
    band_islands: dict[str, str],
) -> list[str]:
    line = field_line(text, "bands")
    if not isinstance(bands, list) or not bands:
        return [f"{location}:{line}: bands must be a non-empty list (field 'bands')"]
    errors: list[str] = []
    for band in bands:
        if not isinstance(band, str) or not band.strip():
            errors.append(f"{location}:{line}: every band must be a non-empty string (field 'bands')")
        elif band not in band_islands:
            errors.append(f"{location}:{line}: unknown band '{band}' (field 'bands')")
        elif island and band_islands[band] != island:
            owner = band_islands[band]
            errors.append(
                f"{location}:{line}: band '{band}' belongs to island "
                f"'{owner}', not '{island}' (field 'bands')"
            )
    return errors


def _curriculum(root: Path) -> tuple[set[str], dict[str, str]]:
    try:
        document: Any = json.loads((root / BANDS_RELATIVE).read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError):
        return set(), {}
    if not isinstance(document, dict):
        return set(), {}
    islands = {i["id"] for i in document.get("islands", []) if isinstance(i, dict) and isinstance(i.get("id"), str)}
    bands = {
        b["id"]: b["island"]
        for b in document.get("bands", [])
        if isinstance(b, dict) and isinstance(b.get("id"), str) and isinstance(b.get("island"), str)
    }
    return islands, bands


def _positive(value: Any) -> bool:
    return (
        not isinstance(value, bool)
        and isinstance(value, (int, float))
        and math.isfinite(value)
        and value > 0
    )


def _error(location: str, text: str, field: str, message: str) -> str:
    return f"{location}:{field_line(text, field)}: {message} (field '{field}')"
