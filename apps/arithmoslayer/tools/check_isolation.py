#!/usr/bin/env python3
"""Guard that every change stays inside apps/arithmoslayer.

The check lists the paths changed in the working tree and, when a base branch
is available, the paths changed by the commits on the current branch. It fails
when a path leaves apps/arithmoslayer/ and when the project references the
browser game that lives in the sibling site tree.
"""

from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

PROJECT_RELATIVE = Path("apps") / "arithmoslayer"
FORBIDDEN_REFERENCE = "sites" + "/ffm"
SKIP_DIRECTORIES = frozenset({".git", ".godot", ".import", "addons", "__pycache__"})
MAX_SCAN_BYTES = 2_000_000


def run_git(repo_root: Path, *arguments: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["git", "-C", str(repo_root), *arguments],
        capture_output=True,
        text=True,
        check=False,
    )


def discover_repo_root(start: Path) -> Path | None:
    result = run_git(start, "rev-parse", "--show-toplevel")
    if result.returncode != 0:
        return None
    output = result.stdout.strip()
    return Path(output) if output else None


def working_tree_changes(repo_root: Path) -> list[tuple[str, str]]:
    result = run_git(
        repo_root, "status", "--porcelain=v1", "-z", "--untracked-files=all"
    )
    if result.returncode != 0:
        return []
    entries = result.stdout.split("\0")
    changes: list[tuple[str, str]] = []
    index = 0
    while index < len(entries):
        entry = entries[index]
        index += 1
        if len(entry) < 4:
            continue
        status = entry[:2]
        path = entry[3:]
        changes.append((status, path))
        if "R" in status or "C" in status:
            index += 1
    return changes


def resolve_base(repo_root: Path, requested: str | None) -> str | None:
    candidates = [requested] if requested else ["origin/main", "main"]
    for candidate in candidates:
        if not candidate:
            continue
        result = run_git(repo_root, "rev-parse", "--verify", "--quiet", candidate)
        if result.returncode == 0:
            return candidate
    return None


def committed_changes(repo_root: Path, base: str) -> list[tuple[str, str]]:
    merge_base = run_git(repo_root, "merge-base", "HEAD", base)
    if merge_base.returncode != 0:
        return []
    base_sha = merge_base.stdout.strip()
    if not base_sha:
        return []
    result = run_git(repo_root, "diff", "--name-only", base_sha, "HEAD")
    if result.returncode != 0:
        return []
    return [("  ", path) for path in result.stdout.splitlines() if path]


def collect_changes(repo_root: Path, base: str | None) -> list[tuple[str, str]]:
    changes = working_tree_changes(repo_root)
    resolved_base = resolve_base(repo_root, base)
    if resolved_base is not None:
        changes.extend(committed_changes(repo_root, resolved_base))
    deduplicated: dict[str, str] = {}
    for status, path in changes:
        deduplicated.setdefault(path, status)
    return [(status, path) for path, status in deduplicated.items()]


def is_inside_project(path: str) -> bool:
    normalized = path.replace("\\", "/").strip("/")
    project = PROJECT_RELATIVE.as_posix()
    return normalized == project or normalized.startswith(project + "/")


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


def find_forbidden_references(project_dir: Path) -> list[str]:
    violations: list[str] = []
    for path, content in iter_text_files(project_dir):
        for line_number, line in enumerate(content.splitlines(), start=1):
            if FORBIDDEN_REFERENCE in line:
                relative = path.relative_to(project_dir).as_posix()
                violations.append(
                    f"{relative}:{line_number} references {FORBIDDEN_REFERENCE}"
                )
    return violations


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Fail when a change leaves apps/arithmoslayer or reaches the web game."
    )
    parser.add_argument(
        "--repo-root",
        type=Path,
        default=None,
        help="repository root to inspect (defaults to the git root of this project)",
    )
    parser.add_argument(
        "--base",
        default=None,
        help="branch or commit to diff against (defaults to origin/main, then main)",
    )
    return parser.parse_args(argv)


def main(argv: list[str]) -> int:
    args = parse_args(argv)
    script_project = Path(__file__).resolve().parent.parent
    repo_root = (
        args.repo_root.resolve()
        if args.repo_root is not None
        else discover_repo_root(script_project)
    )
    project_dir = repo_root / PROJECT_RELATIVE if repo_root is not None else script_project

    violations: list[str] = []
    if repo_root is None:
        print("check_isolation: no git repository found; skipping changed-path scan")
    else:
        changes = collect_changes(repo_root, args.base)
        print(f"check_isolation: changed paths ({len(changes)}):")
        for status, path in changes:
            print(f"  {status} {path}")
            if not is_inside_project(path):
                violations.append(f"{path} is outside {PROJECT_RELATIVE.as_posix()}/")

    if not project_dir.is_dir():
        violations.append(f"project directory {project_dir} does not exist")
    else:
        violations.extend(find_forbidden_references(project_dir))

    if violations:
        print("check_isolation: FAIL", file=sys.stderr)
        for violation in violations:
            print(f"  {violation}", file=sys.stderr)
        return 1

    print("check_isolation: OK")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
