"""Helpers shared by validator modules; underscore names are not discovered."""

from __future__ import annotations

from pathlib import Path


def display(path: Path, root: Path) -> str:
    """Return the path relative to the project root with forward slashes."""
    try:
        return path.relative_to(root).as_posix()
    except ValueError:
        return path.as_posix()


def field_line(text: str, field: str) -> int:
    """Return the first line that declares ``field`` in a JSON document."""
    needle = f'"{field}"'
    for line_number, line in enumerate(text.splitlines(), start=1):
        if needle in line:
            return line_number
    return 1
