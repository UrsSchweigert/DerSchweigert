"""Validate the strike game-feel document.

``data/combat/feel.json`` defines hit-stop, knockback, squash and stretch,
camera punch, and screen shake, plus the scales that soften every effect when
reduced effects are on. Every duration and intensity must be finite and
non-negative, and each reduced scale must stay between zero and one so the
setting can only soften an effect.
"""

from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Any

from ._common import display, field_line

DATA_RELATIVE = Path("data") / "combat" / "feel.json"
DOCUMENT_FIELD = "<document>"
EFFECT_FIELDS: dict[str, tuple[str, ...]] = {
    "hitStop": ("seconds",),
    "knockback": ("distancePx", "seconds"),
    "squashStretch": ("squash", "stretch", "seconds"),
    "cameraPunch": ("distancePx", "seconds"),
    "screenShake": ("amplitudePx", "seconds", "frequency"),
}
POSITIVE_FIELDS = frozenset({"seconds", "distancePx", "amplitudePx", "frequency"})
SCALE_FIELDS = ("intensityScale", "durationScale")


def validate(root: Path) -> list[str]:
    """Return every problem in ``data/combat/feel.json``."""
    path = root / DATA_RELATIVE
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
    errors: list[str] = []
    if data.get("version") != 1:
        errors.append(
            _error(
                location,
                field_line(text, "version"),
                f"expected version 1 but found {data.get('version')!r}",
                "version",
            )
        )
    errors.extend(_scale_errors(data.get("reducedEffects"), text, location))
    for section, fields in EFFECT_FIELDS.items():
        errors.extend(_effect_errors(data.get(section), section, fields, text, location))
    return errors


def _scale_errors(section: Any, text: str, location: str) -> list[str]:
    line = field_line(text, "reducedEffects")
    if not isinstance(section, dict):
        return [_error(location, line, "expected an object", "reducedEffects")]
    errors: list[str] = []
    scales: dict[str, float] = {}
    for field in SCALE_FIELDS:
        value = section.get(field)
        where = field_line(text, field)
        if field not in section:
            errors.append(_error(location, where, "missing required field", field))
            continue
        if not _is_number(value):
            errors.append(
                _error(location, where, "expected a number between zero and one", field)
            )
            continue
        if value < 0.0 or value > 1.0:
            errors.append(
                _error(
                    location,
                    where,
                    f"expected a number between zero and one but found {value!r}",
                    field,
                )
            )
            continue
        scales[field] = float(value)
    if len(scales) == len(SCALE_FIELDS) and all(scale >= 1.0 for scale in scales.values()):
        errors.append(
            _error(
                location,
                line,
                "reduced effects must shorten or soften at least one scale",
                "reducedEffects",
            )
        )
    return errors


def _effect_errors(
    section: Any, name: str, fields: tuple[str, ...], text: str, location: str
) -> list[str]:
    line = field_line(text, name)
    if not isinstance(section, dict):
        return [_error(location, line, "expected an object", name)]
    errors: list[str] = []
    for field in fields:
        where = field_line(text, field)
        if field not in section:
            errors.append(_error(location, where, "missing required field", field))
            continue
        value = section[field]
        if not _is_number(value):
            errors.append(_error(location, where, "expected a number", field))
            continue
        if field in POSITIVE_FIELDS:
            if value <= 0.0:
                errors.append(
                    _error(
                        location,
                        where,
                        f"expected a number greater than zero but found {value!r}",
                        field,
                    )
                )
        elif value < 0.0 or value > 1.0:
            errors.append(
                _error(
                    location,
                    where,
                    f"expected a number between zero and one but found {value!r}",
                    field,
                )
            )
    return errors


def _is_number(value: Any) -> bool:
    return (
        not isinstance(value, bool)
        and isinstance(value, (int, float))
        and math.isfinite(value)
    )


def _error(location: str, line: int, message: str, field: str) -> str:
    return f"{location}:{line}: {message} (field '{field}')"
