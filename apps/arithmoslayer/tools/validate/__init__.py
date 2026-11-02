"""Validator modules for the data files Arithmo Slayer loads.

``tools/validate_data.py`` is the single entry point. It imports every module
in this package, calls the module's ``validate(root)``, and prints the
aggregated errors. A validator returns one string per problem in the form
``<file>:<line>: <message> (field '<name>')`` so every failure names its file
and field.

Adding a data type means adding one module here; ``validate_data.py`` needs no
edit. Modules whose name starts with an underscore are shared helpers and are
not discovered.
"""

from __future__ import annotations

import importlib
import pkgutil
from pathlib import Path
from types import ModuleType
from typing import Callable

Validator = Callable[[Path], list[str]]
VALIDATE_FUNCTION = "validate"


class ContractError(RuntimeError):
    """A discovered module does not expose the validator contract."""


def module_names() -> list[str]:
    """Return the discoverable validator module names in a stable order."""
    return sorted(
        module.name
        for module in pkgutil.iter_modules(__path__)
        if not module.name.startswith("_")
    )


def discover() -> list[tuple[str, Validator]]:
    """Import every validator module and return its name and validate function."""
    validators: list[tuple[str, Validator]] = []
    for name in module_names():
        module: ModuleType = importlib.import_module(f"{__name__}.{name}")
        validate = getattr(module, VALIDATE_FUNCTION, None)
        if not callable(validate):
            raise ContractError(
                f"tools/validate/{name}.py must define "
                f"{VALIDATE_FUNCTION}(root) -> list[str]"
            )
        validators.append((name, validate))
    return validators
