"""Validate the feedback ladder configuration.

``data/session/feedback.json`` orders the hint stages and names the visual
models each operation prefers. This module checks the document shape: the
version, the ordered stage list, and a non-empty model list per operation drawn
from the four known model ids. Every problem is reported with its file, line,
and field.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from ._common import display, field_line

DATA_RELATIVE = Path("data") / "session" / "feedback.json"
DOCUMENT_FIELD = "<document>"
STAGES = ("visual_model", "decomposition", "answer")
MODEL_IDS = frozenset({"dot_array", "ten_frame", "number_line", "equal_groups"})
OPERATIONS = frozenset({"addition", "subtraction", "multiplication", "division"})


def validate(root: Path) -> list[str]:
    """Return one problem string per feedback configuration error."""
    path = root / DATA_RELATIVE
    name = display(path, root)
    if not path.is_file():
        return []
    text = path.read_text(encoding="utf-8")
    try:
        data = json.loads(text)
    except json.JSONDecodeError as exc:
        return [f"{name}:{exc.lineno}: invalid JSON: {exc.msg} (field '{DOCUMENT_FIELD}')"]
    if not isinstance(data, dict):
        return [f"{name}:1: document must be an object (field '{DOCUMENT_FIELD}')"]
    errors: list[str] = []
    if data.get("version") != 1:
        errors.append(
            f"{name}:{field_line(text, 'version')}: "
            f"version must be 1 (field 'version')"
        )
    errors.extend(_stage_errors(name, text, data.get("stages")))
    errors.extend(_model_errors(name, text, data.get("visualModels")))
    return errors


def _stage_errors(name: str, text: str, stages: Any) -> list[str]:
    line = field_line(text, "stages")
    if not isinstance(stages, list) or not all(isinstance(stage, str) for stage in stages):
        return [f"{name}:{line}: stages must be a list of strings (field 'stages')"]
    if tuple(stages) != STAGES:
        return [
            f"{name}:{line}: stages must be {list(STAGES)} in order (field 'stages')"
        ]
    return []


def _model_errors(name: str, text: str, models: Any) -> list[str]:
    line = field_line(text, "visualModels")
    if not isinstance(models, dict):
        return [f"{name}:{line}: visualModels must be an object (field 'visualModels')"]
    errors: list[str] = []
    for operation, preferred in models.items():
        where = _line(text, f'"{operation}"', "visualModels")
        if operation not in OPERATIONS:
            errors.append(
                f"{name}:{where}: unknown operation '{operation}' (field 'visualModels')"
            )
            continue
        if not isinstance(preferred, list) or not preferred:
            errors.append(
                f"{name}:{where}: {operation} must name at least one model "
                f"(field 'visualModels')"
            )
            continue
        seen: set[str] = set()
        for model in preferred:
            if not isinstance(model, str) or model not in MODEL_IDS:
                errors.append(
                    f"{name}:{where}: unknown model '{model}' for {operation} "
                    f"(field 'visualModels')"
                )
            elif model in seen:
                errors.append(
                    f"{name}:{where}: duplicate model '{model}' for {operation} "
                    f"(field 'visualModels')"
                )
            else:
                seen.add(model)
    for operation in sorted(OPERATIONS):
        if operation not in models:
            errors.append(
                f"{name}:{line}: missing models for {operation} (field 'visualModels')"
            )
    return errors


def _line(text: str, marker: str, fallback: str) -> int:
    for number, line in enumerate(text.splitlines(), start=1):
        if marker in line:
            return number
    return field_line(text, fallback)
