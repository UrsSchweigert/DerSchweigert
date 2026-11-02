"""Validate the curriculum bands.

``data/curriculum/bands.json`` is the single source of the skill progression.
Each band names the operations it drills, the operand ranges per operation, the
largest allowed answer, the answer format, its prerequisites, and its island.
This module checks the document shape, the operand ranges, the cross
references, and the safety rules: a subtraction band declares that it never
produces a negative result, a division band declares that its answers are
exact, and an optional free-entry threshold is a number in (0, 1]. Every
problem is reported with its file, line, and field.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from ._common import display, field_line

DATA_RELATIVE = Path("data") / "curriculum" / "bands.json"
DOCUMENT_FIELD = "<document>"
BAND_FIELDS = (
    "id",
    "grade",
    "island",
    "operations",
    "maxResult",
    "answerFormat",
    "prerequisites",
)
ISLAND_FIELDS = ("id", "name", "grade")
OPERATIONS = frozenset({"addition", "subtraction", "multiplication", "division"})
ANSWER_FORMATS = frozenset({"numeric", "multiple_choice"})
GRADES = frozenset({1, 2, 3, 4})


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


def find_line(text: str, marker: str, fallback: str) -> int:
    """Return the first line containing ``marker``, else ``field_line(fallback)``."""
    for number, line in enumerate(text.splitlines(), start=1):
        if marker in line:
            return number
    return field_line(text, fallback)


def band_line(text: str, band_id: str, field: str) -> int:
    """Return the line that declares ``field`` inside band ``band_id``."""
    start = find_line(text, f'"id": "{band_id}"', "id")
    if field == "id":
        return start
    for number, line in enumerate(text.splitlines()[start - 1 :], start=start):
        if f'"{field}"' in line:
            return number
    return start


def range_problem(value: Any) -> str | None:
    """Return why an operand range is invalid, or ``None`` when it is valid."""
    if not isinstance(value, dict):
        return f"expected an operand range object but found {type_name(value)}"
    if "min" in value or "max" in value:
        if "min" not in value or "max" not in value:
            return "an operand range needs both min and max"
        low, high = value["min"], value["max"]
        if not is_integer(low) or not is_integer(high):
            return f"expected integer min and max but found {type_name(low)} and {type_name(high)}"
        if low < 0 or high < low:
            return f"range [{low}, {high}] is empty or negative"
        return None
    values = value.get("values")
    if not isinstance(values, list) or not values:
        return "an operand range needs min/max or a non-empty values list"
    for item in values:
        if not is_integer(item) or item < 0:
            return f"values must be non-negative integers but found {item!r}"
    if len(set(values)) != len(values):
        return "values must be unique"
    return None


def validate_operations(
    value: Any, band_id: str, text: str, location: str
) -> tuple[set[str], list[str]]:
    """Return the declared operations and every problem in the operation map."""
    errors: list[str] = []
    line = band_line(text, band_id, "operations")
    if not isinstance(value, dict) or not value:
        errors.append(
            f"{location}:{line}: expected a non-empty object of operations but found "
            f"{type_name(value)} (field 'operations')"
        )
        return set(), errors
    names: set[str] = set()
    for name, operands in value.items():
        if name not in OPERATIONS:
            errors.append(f"{location}:{line}: unknown operation '{name}' (field 'operations')")
            continue
        names.add(name)
        if not isinstance(operands, dict):
            errors.append(
                f"{location}:{line}: operation '{name}' must be an object with "
                f"operands a and b (field 'operations')"
            )
            continue
        for operand in ("a", "b"):
            if operand not in operands:
                errors.append(
                    f"{location}:{line}: operation '{name}' is missing operand "
                    f"'{operand}' (field 'operations')"
                )
                continue
            problem = range_problem(operands[operand])
            if problem is not None:
                errors.append(
                    f"{location}:{line}: operation '{name}' operand '{operand}': "
                    f"{problem} (field 'operations')"
                )
        divisor = operands.get("b")
        if name == "division" and isinstance(divisor, dict):
            candidates = divisor.get("values", [divisor.get("min"), divisor.get("max")])
            if any(is_integer(item) and item == 0 for item in candidates):
                errors.append(
                    f"{location}:{line}: division operand 'b' may be zero (field 'operations')"
                )
    return names, errors


def validate_islands(
    islands: list[Any], text: str, location: str
) -> tuple[set[str], dict[str, int], list[str]]:
    """Return the island ids, their grades, and every island problem."""
    errors: list[str] = []
    ids: set[str] = set()
    by_grade: dict[int, str] = {}
    for index, island in enumerate(islands):
        if not isinstance(island, dict):
            errors.append(
                f"{location}:1: island {index + 1} must be an object but found "
                f"{type_name(island)} (field 'islands')"
            )
            continue
        island_id = island.get("id")
        if not isinstance(island_id, str) or not island_id.strip():
            errors.append(f"{location}:1: island {index + 1} needs a non-empty string id (field 'id')")
            continue
        line = find_line(text, f'"id": "{island_id}"', "islands")
        if island_id in ids:
            errors.append(f"{location}:{line}: duplicate island id '{island_id}' (field 'id')")
            continue
        ids.add(island_id)
        for field in ISLAND_FIELDS:
            if field not in island:
                errors.append(
                    f"{location}:{line}: island '{island_id}' is missing required "
                    f"field (field '{field}')"
                )
        name = island.get("name")
        if "name" in island and (not isinstance(name, str) or not name.strip()):
            errors.append(f"{location}:{line}: island '{island_id}' needs a name (field 'name')")
        grade = island.get("grade")
        if "grade" in island:
            if not is_integer(grade) or grade not in GRADES:
                errors.append(
                    f"{location}:{line}: island '{island_id}' grade must be 1, 2, 3, or 4 "
                    f"but found {grade!r} (field 'grade')"
                )
            elif grade in by_grade:
                errors.append(
                    f"{location}:{line}: grade {grade} already belongs to island "
                    f"'{by_grade[grade]}' (field 'grade')"
                )
            else:
                by_grade[grade] = island_id
    return ids, {island_id: grade for grade, island_id in by_grade.items()}, errors


def validate_bands(
    bands: list[Any],
    island_ids: set[str],
    island_grades: dict[str, int],
    text: str,
    location: str,
) -> list[str]:
    """Return every problem in the band list and its cross references."""
    errors: list[str] = []
    ids: set[str] = set()
    for index, band in enumerate(bands):
        if not isinstance(band, dict):
            errors.append(
                f"{location}:1: band {index + 1} must be an object but found "
                f"{type_name(band)} (field 'bands')"
            )
            continue
        band_id = band.get("id")
        if not isinstance(band_id, str) or not band_id.strip():
            errors.append(f"{location}:1: band {index + 1} needs a non-empty string id (field 'id')")
            continue
        line = band_line(text, band_id, "id")
        if band_id in ids:
            errors.append(f"{location}:{line}: duplicate band id '{band_id}' (field 'id')")
            continue
        ids.add(band_id)
        for field in BAND_FIELDS:
            if field not in band:
                errors.append(
                    f"{location}:{line}: band '{band_id}' is missing required "
                    f"field (field '{field}')"
                )

        grade = band.get("grade")
        if "grade" in band and (not is_integer(grade) or grade not in GRADES):
            errors.append(
                f"{location}:{band_line(text, band_id, 'grade')}: band '{band_id}' grade "
                f"must be 1, 2, 3, or 4 but found {grade!r} (field 'grade')"
            )

        island = band.get("island")
        if "island" in band:
            island_line = band_line(text, band_id, "island")
            if not isinstance(island, str):
                errors.append(
                    f"{location}:{island_line}: band '{band_id}' island must be a string "
                    f"but found {type_name(island)} (field 'island')"
                )
            elif island not in island_ids:
                errors.append(f"{location}:{island_line}: unknown island '{island}' (field 'island')")
            elif island in island_grades and is_integer(grade) and island_grades[island] != grade:
                errors.append(
                    f"{location}:{island_line}: island '{island}' belongs to grade "
                    f"{island_grades[island]}, not grade {grade} (field 'island')"
                )

        operations, operation_errors = validate_operations(
            band.get("operations"), band_id, text, location
        )
        errors.extend(operation_errors)

        max_result = band.get("maxResult")
        if "maxResult" in band and (not is_integer(max_result) or max_result < 1):
            errors.append(
                f"{location}:{band_line(text, band_id, 'maxResult')}: band '{band_id}' "
                f"maxResult must be a positive integer but found {max_result!r} "
                f"(field 'maxResult')"
            )

        answer_format = band.get("answerFormat")
        if "answerFormat" in band and answer_format not in ANSWER_FORMATS:
            errors.append(
                f"{location}:{band_line(text, band_id, 'answerFormat')}: band "
                f"'{band_id}' answerFormat must be 'numeric' or 'multiple_choice' "
                f"but found {answer_format!r} (field 'answerFormat')"
            )

        if "freeEntryMastery" in band:
            threshold = band["freeEntryMastery"]
            if (
                isinstance(threshold, bool)
                or not isinstance(threshold, (int, float))
                or not 0 < threshold <= 1
            ):
                errors.append(
                    f"{location}:{band_line(text, band_id, 'freeEntryMastery')}: band "
                    f"'{band_id}' freeEntryMastery must be a number in (0, 1] but "
                    f"found {threshold!r} (field 'freeEntryMastery')"
                )

        prerequisites = band.get("prerequisites")
        if "prerequisites" in band:
            prerequisite_line = band_line(text, band_id, "prerequisites")
            if not isinstance(prerequisites, list):
                errors.append(
                    f"{location}:{prerequisite_line}: band '{band_id}' prerequisites "
                    f"must be a list but found {type_name(prerequisites)} "
                    f"(field 'prerequisites')"
                )
            else:
                seen: set[str] = set()
                for prerequisite in prerequisites:
                    if not isinstance(prerequisite, str):
                        errors.append(
                            f"{location}:{prerequisite_line}: prerequisite must be a band "
                            f"id string but found {type_name(prerequisite)} "
                            f"(field 'prerequisites')"
                        )
                    elif prerequisite not in ids:
                        errors.append(
                            f"{location}:{prerequisite_line}: unknown prerequisite "
                            f"'{prerequisite}' (field 'prerequisites')"
                        )
                    elif prerequisite == band_id:
                        errors.append(
                            f"{location}:{prerequisite_line}: band '{band_id}' cannot "
                            f"require itself (field 'prerequisites')"
                        )
                    elif prerequisite in seen:
                        errors.append(
                            f"{location}:{prerequisite_line}: duplicate prerequisite "
                            f"'{prerequisite}' (field 'prerequisites')"
                        )
                    else:
                        seen.add(prerequisite)

        if "subtraction" in operations and band.get("noNegativeResults") is not True:
            errors.append(
                f"{location}:{line}: band '{band_id}' subtracts, so it must declare "
                f"noNegativeResults true (field 'noNegativeResults')"
            )
        if "division" in operations and band.get("exactDivision") is not True:
            errors.append(
                f"{location}:{line}: band '{band_id}' divides, so it must declare "
                f"exactDivision true (field 'exactDivision')"
            )
        if "crossesTens" in band and not isinstance(band["crossesTens"], bool):
            errors.append(
                f"{location}:{band_line(text, band_id, 'crossesTens')}: band "
                f"'{band_id}' crossesTens must be a boolean (field 'crossesTens')"
            )
    return errors


def validate_document(text: str, location: str) -> list[str]:
    """Return every problem in a decoded ``bands.json`` document."""
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
    islands = data.get("islands")
    bands = data.get("bands")
    if not isinstance(islands, list):
        errors.append(
            f"{location}:1: expected a list of islands but found {type_name(islands)} "
            f"(field 'islands')"
        )
        islands = []
    if not isinstance(bands, list):
        errors.append(
            f"{location}:1: expected a list of bands but found {type_name(bands)} "
            f"(field 'bands')"
        )
        bands = []

    island_ids, island_grades, island_errors = validate_islands(islands, text, location)
    errors.extend(island_errors)
    errors.extend(validate_bands(bands, island_ids, island_grades, text, location))
    return errors


def validate(root: Path) -> list[str]:
    """Return every problem in ``data/curriculum/bands.json``.

    A project that ships no curriculum data has nothing to validate; the game
    project itself is guarded by ``test/unit/math/test_curriculum.gd``, which
    asserts that the data file exists.
    """
    path = root / DATA_RELATIVE
    if not path.is_file():
        return []
    location = display(path, root)
    try:
        text = path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError) as exc:
        return [f"{location}:1: cannot read the data file ({exc}) (field '{DOCUMENT_FIELD}')"]
    return validate_document(text, location)
