#!/usr/bin/env python3
"""Waste Calendar Pull Request Review Agent.

Triggered by GitHub Actions when a PR touches
``sites/landhauscheck/app/data/waste/*.ics``.

The agent:
  1. Discovers which ICS files were added, modified, or deleted in the PR
     (via ``git diff`` against the base branch).
  2. For additions / modifications:
       – Validates structure  (BEGIN:VCALENDAR, VEVENTs, geo headers).
       – Checks future-event count (reject if all dates are in the past).
       – Checks for duplicate coverage (existing file within 2 km → warning).
       – Normalises the file automatically (CRLF → LF, trailing whitespace,
         missing trailing newline).
  3. For deletions:
       – Reads the file from the base branch and warns if future events are
         being removed.
  4. Commits any normalisation changes back to the PR branch (bot commit).
  5. Posts a GitHub PR review:
       – APPROVE          all checks pass → auto-merges immediately.
       – REQUEST_CHANGES  validation errors → maintainer must fix.
  6. If approved: squash-merges the PR and deletes the remote branch.

Environment variables (injected by GitHub Actions):
    GH_TOKEN   PAT with 'repo' scope  (GH_WASTE_PAT secret)
    PR_NUMBER  Pull request number
    REPO       Repository slug  (owner/repo)
    BASE_REF   Base branch name  (main)
    HEAD_REF   PR head branch name  (waste/contrib-… / waste/update-… / waste/expire-…)

Exit codes:
    0   Script ran without fatal errors (review posted; PR merged or waiting).
    1   Unrecoverable error (missing env vars, GitHub API hard failure).
"""

from __future__ import annotations

import json
import math
import os
import re
import subprocess
import sys
import urllib.error
import urllib.request
from datetime import date

# ── Constants ──────────────────────────────────────────────────────────────────

_WASTE_DATA_PATH = "sites/landhauscheck/app/data/waste"
_MIN_FUTURE_EVENTS = 1
_DUPLICATE_RADIUS_M = 2_000   # warn if another calendar centre is within 2 km
_GITHUB_API = "https://api.github.com"

# ICS properties whose values contain user-supplied free text.
# Other fields (DTSTART, UID, CALSCALE, …) are structural and skipped.
_ICS_TEXT_PROPERTIES = {
    "SUMMARY",
    "DESCRIPTION",
    "LOCATION",
    "COMMENT",
    "CONTACT",
    "CATEGORIES",
    "X-WR-CALNAME",
    "X-WR-CALDESC",
    "X-WR-LOCATION-NAME",
}

# Hate-speech / offensive-content patterns (case-insensitive, word-boundary aware).
# Covers common slurs in English, German and Portuguese that have no legitimate
# use in a municipal waste-collection calendar.  The list is intentionally kept
# to unambiguous terms to minimise false positives.
# NOTE: This check is a first-pass safety net, not a complete moderation system.
# Maintainers should still audit edge cases flagged as REQUEST_CHANGES.
_HARMFUL_PATTERNS: list[re.Pattern[str]] = [
    re.compile(p, re.IGNORECASE)
    for p in [
        # ── English slurs ──────────────────────────────────────────────────────
        r"\bnigger\b", r"\bnigga\b", r"\bchink\b", r"\bspic\b", r"\bwetback\b",
        r"\bkike\b", r"\bgook\b", r"\bcoon\b", r"\bgreaseball\b",
        r"\bfaggot\b", r"\bfag\b", r"\bdyke\b", r"\btranny\b",
        r"\bretard\b", r"\bcracker\b", r"\bwhite\s*power\b",
        r"\bheil\s*hitler\b", r"\bsieg\s*heil\b",
        # ── German slurs / extremist terms ────────────────────────────────────
        r"\bneger\b", r"\bkanake\b", r"\bschw[au]chtel\b", r"\bfotze\b",
        r"\bwichser\b", r"\bjude[ns]?sau\b", r"\breichsb[uü]rger\b",
        r"\bvolksverr[äa]ter\b",
        # ── Portuguese slurs ──────────────────────────────────────────────────
        r"\bviado\b", r"\bbuchecha\b", r"\bcrioulo\b", r"\bpretinho\b",
        # ── Generic extremist / hateful phrases ───────────────────────────────
        r"\b(kill|death\s+to|murder)\s+all\b",
        r"\bwhite\s+supremac",
        r"\brace\s+war\b",
        r"\bjihad\b",
        r"\binfidel[s]?\b",
        r"\b88\b.*\b14\b",   # neo-Nazi numeric codes
        # ── Executable / injection payloads (defense-in-depth) ────────────────
        r"<script[\s>]",
        r"javascript:\s*",
        r"on\w+\s*=\s*[\"']",  # inline event handlers
    ]
]


# ── GitHub REST API ────────────────────────────────────────────────────────────

def _gh(method: str, path: str, token: str, body: dict | None = None) -> dict:
    """Execute a GitHub REST API call and return the parsed JSON response.

    Raises RuntimeError on HTTP errors.
    """
    data = json.dumps(body).encode() if body else None
    req = urllib.request.Request(
        f"{_GITHUB_API}{path}",
        data=data,
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "Content-Type": "application/json",
            "User-Agent": "Landhauscheck-waste-review/1.0",
        },
        method=method,
    )
    try:
        with urllib.request.urlopen(req) as resp:
            content = resp.read()
            return json.loads(content) if content else {}
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode(errors="replace")[:600]
        raise RuntimeError(f"GitHub {exc.code} {method} {path}: {detail}") from exc


# ── Git helpers ────────────────────────────────────────────────────────────────

def _git(*args: str) -> str:
    """Run a git subcommand and return stdout (trailing newline stripped)."""
    result = subprocess.run(
        ["git", *args],
        capture_output=True,
        text=True,
        check=True,
    )
    return result.stdout.strip()


def _git_show_base(base_ref: str, path: str) -> str | None:
    """Return the content of `path` on `origin/<base_ref>`, or None if not found."""
    try:
        return _git("show", f"origin/{base_ref}:{path}")
    except subprocess.CalledProcessError:
        return None


# ── ICS parsing helpers ────────────────────────────────────────────────────────

def _unfold(raw: str) -> str:
    """Remove RFC-5545 line continuations (CRLF or LF followed by SPACE/TAB)."""
    raw = raw.replace("\r\n ", "").replace("\r\n\t", "")
    return raw.replace("\n ", "").replace("\n\t", "")


def _extract_geo(unfolded: str) -> tuple[float | None, float | None]:
    """Return (lat, lng) from X-WR-GEO-* headers, or (None, None) if absent."""
    lat = lng = None
    for line in unfolded.splitlines():
        up = line.strip().upper()
        if up.startswith("X-WR-GEO-LAT:"):
            try:
                lat = float(line.split(":", 1)[-1])
            except ValueError:
                pass
        elif up.startswith("X-WR-GEO-LNG:"):
            try:
                lng = float(line.split(":", 1)[-1])
            except ValueError:
                pass
    return lat, lng


def _count_future_events(unfolded: str) -> int:
    """Return the number of VEVENTs whose DTSTART is today or later."""
    today = date.today()
    count = 0
    in_event = False
    ev_date: date | None = None
    for line in unfolded.splitlines():
        s = line.strip()
        if s == "BEGIN:VEVENT":
            in_event = True
            ev_date = None
        elif s == "END:VEVENT":
            if ev_date is not None and ev_date >= today:
                count += 1
            in_event = False
        elif in_event and s.upper().startswith("DTSTART"):
            val = s.split(":", 1)[-1].strip()[:8]
            try:
                ev_date = date(int(val[0:4]), int(val[4:6]), int(val[6:8]))
            except (ValueError, IndexError):
                pass
    return count


def _count_total_events(unfolded: str) -> int:
    return unfolded.upper().count("BEGIN:VEVENT")


def _haversine(lat1: float, lng1: float, lat2: float, lng2: float) -> int:
    """Return great-circle distance in metres."""
    R = 6_371_000
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lng2 - lng1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    return round(R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a)))


# ── Normalisations ─────────────────────────────────────────────────────────────

def _normalize(raw: str) -> tuple[str, list[str]]:
    """Apply cosmetic normalisations to ICS text.

    Returns:
        (normalised_content, list_of_human_readable_change_descriptions)
    """
    changes: list[str] = []
    lines = raw.splitlines()

    # 1. Strip carriage returns (CRLF → LF)
    cleaned = [ln.rstrip("\r") for ln in lines]
    if cleaned != lines:
        changes.append("Normalised Windows line endings (CRLF → LF)")

    # 2. Strip trailing whitespace per line
    stripped = [ln.rstrip() for ln in cleaned]
    if stripped != cleaned:
        changes.append("Removed trailing whitespace")

    result = "\n".join(stripped)

    # 3. Ensure file ends with exactly one newline
    if not result.endswith("\n"):
        result += "\n"
        changes.append("Added missing trailing newline")

    return result, changes


# ── Content moderation ────────────────────────────────────────────────────────

def _extract_ics_text_fields(unfolded: str) -> list[tuple[str, str]]:
    """Return ``[(property_name, value), …]`` for all free-text ICS properties.

    Handles both top-level calendar properties and per-VEVENT properties,
    and both plain ``PROPNAME:value`` and parameterised ``PROPNAME;PARAM=…:value``
    forms.
    """
    results: list[tuple[str, str]] = []
    for line in unfolded.splitlines():
        # Strip the parameter part (everything between the first ; and the :)
        # e.g.  SUMMARY;LANGUAGE=de:Restmüll  →  SUMMARY
        colon_idx = line.find(":")
        if colon_idx == -1:
            continue
        prop_raw = line[:colon_idx]
        value = line[colon_idx + 1:].strip()
        # Ignore parameters: take the part before the first ;
        prop = prop_raw.split(";")[0].strip().upper()
        if prop in _ICS_TEXT_PROPERTIES and value:
            results.append((prop, value))
    return results


def _check_harmful_content(unfolded: str) -> list[_Issue]:
    """Scan user-supplied text fields for hate speech or malicious content.

    Returns an ERROR issue for each property that contains a match.
    The matched term is deliberately NOT included in the message to avoid
    amplifying offensive content in PR comments.
    """
    issues: list[_Issue] = []
    flagged_props: set[str] = set()
    for prop, value in _extract_ics_text_fields(unfolded):
        for pattern in _HARMFUL_PATTERNS:
            if pattern.search(value) and prop not in flagged_props:
                flagged_props.add(prop)
                issues.append({
                    "severity": "error",
                    "message": (
                        f"Potentially harmful or offensive content detected in the `{prop}` field. "
                        "This calendar requires manual review before it can be accepted."
                    ),
                })
                break  # one issue per property is enough
    return issues


# ── Duplicate detection ────────────────────────────────────────────────────────

def _find_nearby_files(lat: float, lng: float, exclude_path: str) -> list[dict]:
    """Scan the local waste data directory and return existing ICS files
    whose embedded coordinates are within ``_DUPLICATE_RADIUS_M`` metres.

    Reads from the checked-out working tree — no API call needed.
    The file at *exclude_path* is skipped (it's the one being reviewed).
    """
    import glob

    nearby = []
    for filepath in glob.glob(f"{_WASTE_DATA_PATH}/*.ics"):
        rel = filepath.replace("\\", "/")
        # Normalise exclude_path for comparison
        exc = exclude_path.replace("\\", "/")
        if rel == exc or rel.endswith("/" + exc.lstrip("/")):
            continue
        try:
            with open(filepath, encoding="utf-8", errors="replace") as fh:
                raw = fh.read()
        except OSError:
            continue
        unfolded = _unfold(raw)
        f_lat, f_lng = _extract_geo(unfolded)
        if f_lat is None or f_lng is None:
            continue
        dist = _haversine(lat, lng, f_lat, f_lng)
        if dist <= _DUPLICATE_RADIUS_M:
            nearby.append({
                "name": os.path.basename(filepath),
                "path": rel,
                "dist_m": dist,
            })
    return nearby


# ── Validation ─────────────────────────────────────────────────────────────────

_Issue = dict  # {"severity": "error"|"warning", "message": str}


def _validate_addition(raw: str, path: str) -> list[_Issue]:
    """Full validation for added or modified ICS files."""
    issues: list[_Issue] = []

    if "\x00" in raw:
        return [{"severity": "error", "message": "Binary content detected — not a valid ICS text file."}]

    unfolded = _unfold(raw)

    if "BEGIN:VCALENDAR" not in unfolded.upper():
        return [{"severity": "error", "message": "Missing `BEGIN:VCALENDAR` — not a valid ICS file."}]

    if "BEGIN:VEVENT" not in unfolded.upper():
        issues.append({"severity": "error", "message": "No `VEVENT` blocks found — calendar has no events."})

    lat, lng = _extract_geo(unfolded)
    if lat is None:
        issues.append({"severity": "error", "message": "Missing `X-WR-GEO-LAT` header — geo coordinates required."})
    if lng is None:
        issues.append({"severity": "error", "message": "Missing `X-WR-GEO-LNG` header — geo coordinates required."})

    if lat is not None and not (-90 <= lat <= 90):
        issues.append({"severity": "error", "message": f"Latitude `{lat}` out of range [-90, 90]."})
    if lng is not None and not (-180 <= lng <= 180):
        issues.append({"severity": "error", "message": f"Longitude `{lng}` out of range [-180, 180]."})

    future = _count_future_events(unfolded)
    total = _count_total_events(unfolded)
    if future < _MIN_FUTURE_EVENTS:
        issues.append({
            "severity": "error",
            "message": (
                f"No upcoming events found ({total} total VEVENT(s), all in the past). "
                "Please submit a current schedule."
            ),
        })
    elif future < 5:
        issues.append({
            "severity": "warning",
            "message": f"Only {future} future event(s) — this calendar will expire soon.",
        })

    # Content moderation — must run before geo / duplicate checks
    issues.extend(_check_harmful_content(unfolded))

    # Duplicate-coverage check
    if lat is not None and lng is not None:
        for dup in _find_nearby_files(lat, lng, path):
            issues.append({
                "severity": "warning",
                "message": (
                    f"Possible duplicate: `{dup['name']}` is {dup['dist_m']} m away. "
                    "Please verify both files don't cover the same collection area."
                ),
            })

    return issues


def _validate_deletion(base_ref: str, path: str) -> list[_Issue]:
    """Validate a file that is being deleted.

    Reads the file from the base branch (git show) so we can check
    whether any future events are being removed.
    """
    raw = _git_show_base(base_ref, path)
    if not raw:
        return []  # file wasn't on base branch — no further validation possible
    unfolded = _unfold(raw)
    future = _count_future_events(unfolded)
    if future > 0:
        return [{
            "severity": "warning",
            "message": (
                f"`{os.path.basename(path)}` still has {future} future event(s). "
                "Deleting it will remove upcoming collection dates from the app."
            ),
        }]
    return []


# ── Review builder ─────────────────────────────────────────────────────────────

def _build_review(
    added: list[dict],
    updated: list[dict],
    deleted: list[dict],
) -> tuple[str, str]:
    """Build the review body and decide the GitHub review event.

    Returns:
        (body_markdown, event)  where event ∈ {"APPROVE", "REQUEST_CHANGES"}
    """
    all_issues: list[_Issue] = []
    all_normalizations: list[str] = []
    for entry in added + updated + deleted:
        all_issues.extend(entry.get("issues", []))
    for entry in added + updated:
        all_normalizations.extend(entry.get("normalizations", []))

    errors = [i for i in all_issues if i["severity"] == "error"]
    warnings = [i for i in all_issues if i["severity"] == "warning"]
    event = "REQUEST_CHANGES" if errors else "APPROVE"

    lines: list[str] = ["## 🤖 Waste Calendar Review\n"]

    if not errors and not warnings:
        lines.append("✅ All checks passed — this calendar is ready to go live!\n")

    if errors:
        lines.append("### ❌ Errors (must be fixed before merge)\n")
        for e in errors:
            lines.append(f"- {e['message']}")
        lines.append("")

    if warnings:
        lines.append("### ⚠️ Warnings\n")
        for w in warnings:
            lines.append(f"- {w['message']}")
        lines.append("")

    lines.append("### 📄 Files reviewed\n")
    for entry in added:
        fut = entry.get("future_events", "?")
        lines.append(f"- **Added** `{os.path.basename(entry['path'])}` — {fut} future event(s)")
    for entry in updated:
        fut = entry.get("future_events", "?")
        lines.append(f"- **Updated** `{os.path.basename(entry['path'])}` — {fut} future event(s)")
    for entry in deleted:
        lines.append(f"- **Deleted** `{os.path.basename(entry['path'])}`")

    if all_normalizations:
        lines.append("\n### 🔧 Normalisations applied automatically\n")
        for n in all_normalizations:
            lines.append(f"- {n}")
        lines.append("\n_Changes were committed back to this PR branch._")

    if event == "APPROVE":
        lines.append("\n---\n_Approved and auto-merging. 🚀_")
    else:
        lines.append("\n---\n_Please address the errors above and push a new commit._")

    return "\n".join(lines), event


# ── Main ───────────────────────────────────────────────────────────────────────

def main() -> int:
    token = os.environ.get("GH_TOKEN", "")
    repo = os.environ.get("REPO", "")
    pr_number_str = os.environ.get("PR_NUMBER", "")
    base_ref = os.environ.get("BASE_REF", "main")
    head_ref = os.environ.get("HEAD_REF", "")

    if not all([token, repo, pr_number_str]):
        print("ERROR: Missing required env vars (GH_TOKEN, REPO, PR_NUMBER)", file=sys.stderr)
        return 1

    pr_number = int(pr_number_str)
    print(f"Reviewing PR #{pr_number} ({head_ref}) on {repo}")

    # ── 1. Find changed ICS files ──────────────────────────────────────────────
    try:
        _git("fetch", "origin", base_ref)
    except subprocess.CalledProcessError as exc:
        print(f"WARNING: git fetch failed: {exc.stderr}", file=sys.stderr)

    try:
        diff_output = _git(
            "diff", "--name-status", f"origin/{base_ref}...HEAD",
            "--", f"{_WASTE_DATA_PATH}/*.ics",
        )
    except subprocess.CalledProcessError as exc:
        print(f"ERROR: git diff failed: {exc.stderr}", file=sys.stderr)
        return 1

    added_paths: list[str] = []
    updated_paths: list[str] = []
    deleted_paths: list[str] = []

    for line in diff_output.splitlines():
        if not line.strip():
            continue
        parts = line.split("\t")
        status = parts[0].strip()
        # Handles A, M, D; also R100 → parts[1]=old, parts[2]=new
        path = parts[-1].strip()  # last field is always the relevant path
        if status.startswith("A"):
            added_paths.append(path)
        elif status.startswith("M") or status.startswith("R"):
            updated_paths.append(path)
        elif status.startswith("D"):
            deleted_paths.append(path)

    print(f"  Added:   {added_paths or '(none)'}")
    print(f"  Updated: {updated_paths or '(none)'}")
    print(f"  Deleted: {deleted_paths or '(none)'}")

    if not any([added_paths, updated_paths, deleted_paths]):
        print("No ICS file changes detected — nothing to review.")
        return 0

    # ── 2. Validate + normalise additions / modifications ──────────────────────
    added_results: list[dict] = []
    updated_results: list[dict] = []
    any_normalizations = False

    for path in added_paths + updated_paths:
        is_update = path in updated_paths
        result_list = updated_results if is_update else added_results

        try:
            with open(path, encoding="utf-8", errors="replace") as fh:
                raw = fh.read()
        except OSError as exc:
            result_list.append({
                "path": path,
                "issues": [{"severity": "error", "message": f"Cannot read file: {exc}"}],
                "normalizations": [],
                "future_events": 0,
            })
            continue

        issues = _validate_addition(raw, path)
        normalized, normalizations = _normalize(raw)

        if normalizations:
            try:
                with open(path, "w", encoding="utf-8", newline="") as fh:
                    fh.write(normalized)
                any_normalizations = True
                print(f"  Normalised {path}: {normalizations}")
            except OSError as exc:
                print(f"WARNING: Could not write normalised file: {exc}", file=sys.stderr)
                normalizations = []

        unfolded = _unfold(normalized)
        future_events = _count_future_events(unfolded)

        result_list.append({
            "path": path,
            "issues": issues,
            "normalizations": normalizations,
            "future_events": future_events,
        })

    # ── 3. Validate deletions ──────────────────────────────────────────────────
    deleted_results: list[dict] = []
    for path in deleted_paths:
        issues = _validate_deletion(base_ref, path)
        deleted_results.append({"path": path, "issues": issues})

    # ── 4. Commit normalisations if any ───────────────────────────────────────
    if any_normalizations:
        try:
            _git("config", "user.name", "github-actions[bot]")
            _git("config", "user.email", "github-actions[bot]@users.noreply.github.com")
            _git("add", _WASTE_DATA_PATH)
            _git("commit", "-m", "chore(waste): auto-normalise ICS file(s) [bot]")
            _git("push")
            print("  Committed and pushed normalisations.")
        except subprocess.CalledProcessError as exc:
            print(f"WARNING: Could not commit normalisations: {exc.stderr}", file=sys.stderr)

    # ── 5. Build and post review ───────────────────────────────────────────────
    body, event = _build_review(added_results, updated_results, deleted_results)
    print(f"\nPosting review: {event}")
    print(body)

    try:
        _gh("POST", f"/repos/{repo}/pulls/{pr_number}/reviews", token, {
            "body": body,
            "event": event,
        })
    except RuntimeError as exc:
        print(f"ERROR: Could not post review: {exc}", file=sys.stderr)
        return 1

    # ── 6. Auto-merge if approved ─────────────────────────────────────────────
    if event == "APPROVE":
        print("\nMerging PR...")
        try:
            _gh("PUT", f"/repos/{repo}/pulls/{pr_number}/merge", token, {
                "merge_method": "squash",
                "commit_title": f"feat(waste): merge waste calendar PR #{pr_number} [bot]",
                "commit_message": body[:2000],
            })
            print("  PR merged successfully.")

            # Delete the remote branch after merge (keep repo tidy)
            try:
                _gh("DELETE", f"/repos/{repo}/git/refs/heads/{head_ref}", token)
                print(f"  Deleted branch: {head_ref}")
            except RuntimeError as exc:
                print(f"WARNING: Could not delete branch: {exc}", file=sys.stderr)

        except RuntimeError as exc:
            # Merge may fail if required status checks are pending.
            # In this case the review approval is already posted — the PR
            # will be mergeable once all checks pass.
            print(f"WARNING: Auto-merge failed (will need manual merge): {exc}", file=sys.stderr)

    return 0


if __name__ == "__main__":
    sys.exit(main())
