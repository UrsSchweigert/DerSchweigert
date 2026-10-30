#!/usr/bin/env python3
"""Validate the data-driven content that ships with Arithmo Slayer.

The translation table in data/i18n/strings.csv is the first data file the game
loads. This tool checks its shape and completeness and verifies that every
translation key referenced by a script or scene exists in the table. Every
problem is reported with its file, line, and field so a missing translation is
easy to locate.
"""

from __future__ import annotations

import argparse
import csv
import re
import sys
from pathlib import Path

I18N_RELATIVE = Path("data") / "i18n" / "strings.csv"
KEY_COLUMN = "key"
SUPPORTED_LOCALES = ("en", "de")
SKIP_DIRECTORIES = frozenset({".git", ".godot", ".import", "addons", "__pycache__"})
MAX_SCAN_BYTES = 2_000_000
KEY_PATTERN = re.compile(r"^[a-z0-9_]+(?:\.[a-z0-9_]+)*$")
REFERENCE_PATTERNS = (
    re.compile(r"\btr_key\(\s*&?\"([^\"]+)\""),
    re.compile(r"\btr\(\s*&?\"([^\"]+)\""),
)
SOURCE_SUFFIXES = frozenset({".gd", ".tscn"})


def display(path: Path, root: Path) -> str:
    try:
        return path.relative_to(root).as_posix()
    except ValueError:
        return path.as_posix()


def read_text(path: Path) -> str | None:
    try:
        if path.stat().st_size > MAX_SCAN_BYTES:
            return None
        data = path.read_bytes()
    except OSError:
        return None
    if b"\0" in data:
        return None
    return data.decode("utf-8", errors="ignore")


def validate_table(path: Path, root: Path) -> tuple[set[str], list[str]]:
    errors: list[str] = []
    location = display(path, root)
    if not path.is_file():
        return set(), [f"{location}: missing translation table"]
    try:
        with path.open(newline="", encoding="utf-8") as handle:
            rows = list(csv.reader(handle))
    except (OSError, UnicodeDecodeError) as exc:
        return set(), [f"{location}: cannot read the translation table ({exc})"]
    if not rows:
        return set(), [f"{location}:1: empty translation table (field '{KEY_COLUMN}')"]

    expected = [KEY_COLUMN, *SUPPORTED_LOCALES]
    header = [cell.strip() for cell in rows[0]]
    if header != expected:
        found = ",".join(header) if header else "<empty>"
        errors.append(
            f"{location}:1: expected header {','.join(expected)} but found {found} "
            f"(field '{KEY_COLUMN}')"
        )

    keys: set[str] = set()
    for line_number, row in enumerate(rows[1:], start=2):
        if not row or all(not cell.strip() for cell in row):
            continue
        if len(row) != len(header):
            errors.append(
                f"{location}:{line_number}: expected {len(header)} fields but found "
                f"{len(row)} (field '{KEY_COLUMN}')"
            )
            continue
        key = row[0].strip()
        if not key:
            errors.append(f"{location}:{line_number}: missing key (field '{KEY_COLUMN}')")
            continue
        if not KEY_PATTERN.match(key):
            errors.append(
                f"{location}:{line_number}: key '{key}' is not a lowercase dotted key "
                f"(field '{KEY_COLUMN}')"
            )
        if key in keys:
            errors.append(
                f"{location}:{line_number}: duplicate key '{key}' (field '{KEY_COLUMN}')"
            )
            continue
        keys.add(key)
        for index, locale in enumerate(header[1:], start=1):
            if not row[index].strip():
                errors.append(
                    f"{location}:{line_number}: missing translation for key '{key}' "
                    f"(field '{locale}')"
                )
    return keys, errors


def iter_source_files(root: Path) -> list[Path]:
    files: list[Path] = []
    for directory_name in ("scripts", "scenes"):
        directory = root / directory_name
        if not directory.is_dir():
            continue
        for path in sorted(directory.rglob("*")):
            if not path.is_file() or path.suffix not in SOURCE_SUFFIXES:
                continue
            if any(part in SKIP_DIRECTORIES for part in path.relative_to(root).parts[:-1]):
                continue
            files.append(path)
    return files


def validate_references(root: Path, keys: set[str]) -> list[str]:
    errors: list[str] = []
    for path in iter_source_files(root):
        content = read_text(path)
        if content is None:
            continue
        location = display(path, root)
        for line_number, line in enumerate(content.splitlines(), start=1):
            for pattern in REFERENCE_PATTERNS:
                for key in pattern.findall(line):
                    if key not in keys:
                        errors.append(
                            f"{location}:{line_number}: missing translation key '{key}' "
                            f"(field '{KEY_COLUMN}')"
                        )
    return errors


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Validate the translation table and the keys the game references."
    )
    parser.add_argument(
        "--root",
        type=Path,
        default=None,
        help="project directory to validate (defaults to this script's project)",
    )
    return parser.parse_args(argv)


def main(argv: list[str]) -> int:
    args = parse_args(argv)
    root = (
        args.root.resolve()
        if args.root is not None
        else Path(__file__).resolve().parent.parent
    )
    if not root.is_dir():
        print(f"validate_data: project directory {root} does not exist", file=sys.stderr)
        return 2

    keys, errors = validate_table(root / I18N_RELATIVE, root)
    errors.extend(validate_references(root, keys))

    if errors:
        print("validate_data: FAIL", file=sys.stderr)
        for error in errors:
            print(f"  {error}", file=sys.stderr)
        return 1

    print(f"validate_data: OK ({len(keys)} translation keys)")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
