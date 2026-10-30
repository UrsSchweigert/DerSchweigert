#!/usr/bin/env python3
"""Validate every data file that ships with Arithmo Slayer.

Each data type owns a validator module under ``tools/validate/``. This entry
point discovers those modules, runs each of them against the project, and
exits nonzero when any file is broken. Every error names the file, the line,
and the field so a bad record is easy to find.

Adding a data type means adding ``tools/validate/<type>.py`` with a
``validate(root)`` function; nothing here needs to change.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

TOOLS_DIR = Path(__file__).resolve().parent
if str(TOOLS_DIR) not in sys.path:
    sys.path.insert(0, str(TOOLS_DIR))

import validate as validators  # noqa: E402  (imported after the path setup)


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
    parser.add_argument(
        "--list",
        action="store_true",
        help="list the discovered validator modules and exit",
    )
    return parser.parse_args(argv)


def main(argv: list[str]) -> int:
    args = parse_args(argv)
    root = (
        args.root.resolve()
        if args.root is not None
        else Path(__file__).resolve().parent.parent
    )

    if args.list:
        for module in validators.validator_modules():
            print(module.__name__.rsplit(".", 1)[-1])
        return 0

    if not root.is_dir():
        print(f"validate_data: project directory {root} does not exist", file=sys.stderr)
        return 2

    names, errors = validators.run(root)
    if errors:
        print("validate_data: FAIL", file=sys.stderr)
        for error in errors:
            print(f"  {error}", file=sys.stderr)
        return 1

    print(f"validate_data: OK ({len(names)} validators: {', '.join(names)})")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
