#!/usr/bin/env python3
"""Validate the data files that ship with Arithmo Slayer.

This is the single entry point. It discovers every validator module under
``tools/validate/`` and calls the module's ``validate(root)`` function. A
validator returns one ``<file>:<line>: <message> (field '<name>')`` string per
problem, so a failure always names the file and field to fix. Adding a data
type means adding a validator module; this script does not change.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path
from types import ModuleType


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Validate every data file and cross reference in the project."
    )
    parser.add_argument(
        "--root",
        type=Path,
        default=None,
        help="project directory to validate (defaults to this script's project)",
    )
    return parser.parse_args(argv)


def import_validator_package() -> ModuleType:
    """Import ``tools/validate`` with the tools directory on the module path."""
    tools_directory = str(Path(__file__).resolve().parent)
    if tools_directory not in sys.path:
        sys.path.insert(0, tools_directory)
    import validate

    return validate


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

    package = import_validator_package()
    try:
        validators = package.discover()
    except package.ContractError as exc:
        print(f"validate_data: {exc}", file=sys.stderr)
        return 2
    if not validators:
        print(
            "validate_data: no validator modules found under tools/validate",
            file=sys.stderr,
        )
        return 2

    errors: list[str] = []
    for _name, validate in validators:
        errors.extend(validate(root))

    if errors:
        print("validate_data: FAIL", file=sys.stderr)
        for error in errors:
            print(f"  {error}", file=sys.stderr)
        return 1

    names = ", ".join(name for name, _validate in validators)
    print(f"validate_data: OK ({len(validators)} validator modules: {names})")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
