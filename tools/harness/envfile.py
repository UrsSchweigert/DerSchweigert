"""Read the harness's ``HARNESS_*`` settings from the git-ignored app env file."""

from __future__ import annotations

import os
from pathlib import Path


def load_harness_env(repo_root: Path) -> None:
    """Load ``HARNESS_*`` values from the app env file without overriding the real environment.

    The harness shares ``sites/derschweigert/.env`` (git-ignored), but only keys in
    the ``HARNESS_`` namespace are read, so the app's unrelated secrets are never
    imported into the harness process. The real environment always wins.
    """
    env_file = Path(repo_root) / "sites" / "derschweigert" / ".env"
    if not env_file.is_file():
        return
    for line in env_file.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key.startswith("HARNESS_") and value and key not in os.environ:
            os.environ[key] = value
