#!/usr/bin/env python3
"""Fail when the project can reach the network or asks for Android permissions.

Arithmo Slayer is offline first: it must not use Godot's HTTP or WebSocket
clients, and the only Android permission it may request is Play Billing.
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

NETWORK_CLASSES = ("HTTPRequest", "HTTPClient", "WebSocketPeer")
ALLOWED_PERMISSIONS = frozenset({"com.android.vending.BILLING"})
SKIP_DIRECTORIES = frozenset({".git", ".godot", ".import", "addons", "__pycache__"})
MAX_SCAN_BYTES = 2_000_000

PERMISSION_SWITCH_RE = re.compile(
    r"^\s*permissions/([a-z0-9_]+)\s*=\s*(true|false)\s*$"
)
CUSTOM_PERMISSIONS_RE = re.compile(r"custom_permissions\s*=\s*PackedStringArray\((.*)\)")
ANDROID_PERMISSION_RE = re.compile(r"android\.permission\.[A-Z0-9_]+")
QUOTED_PERMISSION_RE = re.compile(r"\"([^\"]+)\"")


def iter_text_files(root: Path) -> list[tuple[Path, str]]:
    files: list[tuple[Path, str]] = []
    for path in sorted(root.rglob("*")):
        if not path.is_file():
            continue
        relative_parts = path.relative_to(root).parts[:-1]
        if any(part in SKIP_DIRECTORIES for part in relative_parts):
            continue
        try:
            if path.stat().st_size > MAX_SCAN_BYTES:
                continue
            data = path.read_bytes()
        except OSError:
            continue
        if b"\0" in data:
            continue
        files.append((path, data.decode("utf-8", errors="ignore")))
    return files


def scan_file(path: Path, content: str, display_path: str) -> list[str]:
    violations: list[str] = []
    for line_number, line in enumerate(content.splitlines(), start=1):
        location = f"{display_path}:{line_number}"
        for class_name in NETWORK_CLASSES:
            if class_name in line:
                violations.append(f"{location} uses the network class {class_name}")
        switch = PERMISSION_SWITCH_RE.match(line)
        if switch is not None and switch.group(2) == "true":
            violations.append(
                f"{location} enables the Android permission switch {switch.group(1)}"
            )
        custom = CUSTOM_PERMISSIONS_RE.search(line)
        if custom is not None:
            for permission in QUOTED_PERMISSION_RE.findall(custom.group(1)):
                if permission not in ALLOWED_PERMISSIONS:
                    violations.append(
                        f"{location} requests the Android permission {permission}"
                    )
        for permission in ANDROID_PERMISSION_RE.findall(line):
            if permission not in ALLOWED_PERMISSIONS:
                violations.append(f"{location} requests the Android permission {permission}")
    return violations


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Fail when the project uses the network or over-asks for Android permissions."
    )
    parser.add_argument(
        "--root",
        type=Path,
        default=None,
        help="project directory to scan (defaults to this script's project)",
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
        print(f"check_offline: project directory {root} does not exist", file=sys.stderr)
        return 2

    tool_path = Path(__file__).resolve()
    violations: list[str] = []
    for path, content in iter_text_files(root):
        if path.resolve() == tool_path:
            continue
        display_path = path.relative_to(root).as_posix()
        violations.extend(scan_file(path, content, display_path))

    if violations:
        print("check_offline: FAIL", file=sys.stderr)
        for violation in violations:
            print(f"  {violation}", file=sys.stderr)
        return 1

    print("check_offline: OK")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
