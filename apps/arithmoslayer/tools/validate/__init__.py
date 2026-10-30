"""Discover and run the data validators that ship with Arithmo Slayer.

Every data type owns one module in this package. A module joins the run by
exposing ``validate(root: Path) -> list[str]``, so adding a data type means
adding a module here and nothing else: the entry point in
``tools/validate_data.py`` discovers it automatically.

Every error a validator returns must name the file and the field, and use the
``<file>:<line>: <message> (field '<field>')`` shape so a failure is easy to
locate.
"""

from __future__ import annotations

import importlib
import pkgutil
from pathlib import Path
from types import ModuleType

MAX_SCAN_BYTES = 2_000_000


def display(path: Path, root: Path) -> str:
    """Return ``path`` relative to ``root`` when possible, else as-is."""
    try:
        return path.relative_to(root).as_posix()
    except ValueError:
        return path.as_posix()


def read_text(path: Path) -> str | None:
    """Read a text file, returning ``None`` for binary or oversized files."""
    try:
        if path.stat().st_size > MAX_SCAN_BYTES:
            return None
        data = path.read_bytes()
    except OSError:
        return None
    if b"\0" in data:
        return None
    return data.decode("utf-8", errors="ignore")


def validator_modules() -> list[ModuleType]:
    """Import and return every sibling module that exposes ``validate``."""
    modules: list[ModuleType] = []
    for info in pkgutil.iter_modules([str(Path(__file__).resolve().parent)]):
        if info.name.startswith("_"):
            continue
        module = importlib.import_module(f"{__name__}.{info.name}")
        if callable(getattr(module, "validate", None)):
            modules.append(module)
    return sorted(modules, key=lambda module: module.__name__)


def run(root: Path) -> tuple[list[str], list[str]]:
    """Run every discovered validator and return ``(names, errors)``."""
    names: list[str] = []
    errors: list[str] = []
    for module in validator_modules():
        name = module.__name__.rsplit(".", 1)[-1]
        names.append(name)
        try:
            errors.extend(module.validate(root))
        except Exception as exc:  # a broken validator must still fail the run
            errors.append(f"tools/validate/{name}.py: validator crashed ({exc})")
    return names, errors
