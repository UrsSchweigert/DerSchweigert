"""Waste calendar contribution endpoint.

Allows users to upload an ICS file when no garbage calendar exists within
~500 m of their location, or when their local calendar has expired (all
events are in the past). The workflow is:

  1. User POSTs their ICS file along with their current lat/lng.
  2. This endpoint validates the file (structure, size, future events).
  3. The user's coordinates are injected as X-WR-GEO-* headers so the backend
     can match future users in the same area.
  4. If an existing ICS file for the same lat/lng is found in the repository
     the PR replaces it (update flow); otherwise a new file is added.
  5. A GitHub pull request is created on the user's behalf so the maintainer
     (Urs) can review the calendar before it goes live.
  6. After the PR is merged to main the backend picks up the new ICS file
     automatically on the next cold start — no further action needed.

Expired calendars are handled by waste.py, which calls _open_deletion_pr()
from this module whenever it detects a matched-but-fully-past calendar.

Security considerations:
  - File size is capped at 1 MiB before decoding.
  - Binary content (NUL bytes) is rejected.
  - Existing X-WR-GEO-* headers supplied by the user are stripped and replaced
    with the server-verified lat/lng from the signed request parameters.
  - Branch and file names are constructed from fixed templates; user-supplied
    calendar names are sanitised with a strict allow-list regex before use.
  - If GITHUB_TOKEN is absent the endpoint returns 503, not an error traceback.
"""

import base64
import json
import re
import time
import urllib.error
import urllib.request
from datetime import date

from fastapi import APIRouter, File, HTTPException, Query, UploadFile
from fastapi.responses import JSONResponse

from app.core.config import get_settings

router = APIRouter()

# ── Constants ─────────────────────────────────────────────────────────────────

_MAX_ICS_BYTES = 1_048_576          # 1 MiB hard cap before decoding
_MIN_FUTURE_EVENTS = 1              # reject calendars with no upcoming events
_GITHUB_API = "https://api.github.com"
_CALSCALE_ANCHOR = "CALSCALE:GREGORIAN"   # inject geo headers after this line
# Strict allow-list for calendar names used in file/branch names
_SAFE_NAME_RE = re.compile(r"[^\w\-]")


# ── ICS parsing helpers ───────────────────────────────────────────────────────

def _unfold(raw: str) -> str:
    """Remove RFC-5545 line continuations (CRLF or LF followed by SPACE/TAB)."""
    raw = raw.replace("\r\n ", "").replace("\r\n\t", "")
    return raw.replace("\n ", "").replace("\n\t", "")


def _extract_cal_name(unfolded: str) -> str:
    """Return the first X-WR-CALNAME or X-WR-LOCATION-NAME value, or fallback."""
    for line in unfolded.splitlines():
        k = line.upper()
        if k.startswith("X-WR-CALNAME:") or k.startswith("X-WR-LOCATION-NAME:"):
            return line.split(":", 1)[-1].strip()
    return "UserContribution"


def _count_future_events(unfolded: str) -> int:
    """Return the number of VEVENTs whose DTSTART is today or later."""
    today = date.today()
    count = 0
    in_event = False
    ev_date: date | None = None

    for line in unfolded.splitlines():
        stripped = line.strip()
        if stripped == "BEGIN:VEVENT":
            in_event = True
            ev_date = None
        elif stripped == "END:VEVENT":
            if ev_date is not None and ev_date >= today:
                count += 1
            in_event = False
        elif in_event and stripped.upper().startswith("DTSTART"):
            val = stripped.split(":", 1)[-1].strip()[:8]
            try:
                ev_date = date(int(val[0:4]), int(val[4:6]), int(val[6:8]))
            except (ValueError, IndexError):
                pass

    return count


def _inject_geo_headers(raw: str, lat: float, lng: float, location_name: str) -> str:
    """Strip any existing X-WR-GEO-* / X-WR-LOCATION-NAME lines and inject fresh
    ones immediately after the CALSCALE line.

    The raw (original, folded) content is used here so that line endings
    present in the original file are preserved.
    """
    injected = False
    out: list[str] = []

    for line in raw.splitlines(keepends=True):
        stripped_up = line.strip().upper()

        # Remove any geo headers the uploader may have included
        if any(stripped_up.startswith(h) for h in (
            "X-WR-GEO-LAT:", "X-WR-GEO-LNG:", "X-WR-LOCATION-NAME:"
        )):
            continue

        out.append(line)

        # Inject after the first CALSCALE line
        if not injected and stripped_up.startswith("CALSCALE:"):
            sep = "\r\n" if "\r\n" in line else "\n"
            out.append(f"X-WR-GEO-LAT:{lat:.6f}{sep}")
            out.append(f"X-WR-GEO-LNG:{lng:.6f}{sep}")
            out.append(f"X-WR-LOCATION-NAME:{location_name}{sep}")
            injected = True

    # Fallback: append before BEGIN:VEVENT if CALSCALE was not present
    if not injected:
        sep = "\r\n" if "\r\n" in raw else "\n"
        insert_at = next(
            (i for i, line in enumerate(out) if "BEGIN:VEVENT" in line.upper()),
            len(out),
        )
        out.insert(insert_at, f"X-WR-GEO-LAT:{lat:.6f}{sep}")
        out.insert(insert_at + 1, f"X-WR-GEO-LNG:{lng:.6f}{sep}")
        out.insert(insert_at + 2, f"X-WR-LOCATION-NAME:{location_name}{sep}")

    return "".join(out)


# ── ICS validation ────────────────────────────────────────────────────────────

def _validate_and_process(raw: str, lat: float, lng: float) -> tuple[str, str, int]:
    """Validate *raw* ICS text and inject geo headers.

    Returns:
        (processed_ics_text, calendar_name, future_event_count)

    Raises:
        ValueError with a user-facing message on any validation failure.
    """
    if "\x00" in raw:
        raise ValueError(
            "Binary content detected — please upload a plain-text .ics file."
        )

    unfolded = _unfold(raw)

    if "BEGIN:VCALENDAR" not in unfolded.upper():
        raise ValueError("Not a valid ICS file — BEGIN:VCALENDAR marker not found.")

    if "BEGIN:VEVENT" not in unfolded.upper():
        raise ValueError(
            "The ICS file contains no calendar events (VEVENT). "
            "Please upload a file exported from your waste provider."
        )

    fut = _count_future_events(unfolded)
    if fut < _MIN_FUTURE_EVENTS:
        raise ValueError(
            "No upcoming events found in the ICS file. "
            "Please upload a current schedule — past-only files cannot be used."
        )

    cal_name = _extract_cal_name(unfolded)
    processed = _inject_geo_headers(raw, lat, lng, cal_name)
    return processed, cal_name, fut


# ── GitHub API helpers ────────────────────────────────────────────────────────

def _gh(method: str, path: str, token: str, body: dict | None = None) -> dict:
    """Execute a GitHub REST API call and return the parsed JSON body.

    Raises RuntimeError on HTTP errors so the caller can convert them to
    a structured HTTP 502 response.
    """
    url = f"{_GITHUB_API}{path}"
    if not url.startswith("https://"):
        raise ValueError(f"Refusing non-HTTPS GitHub API URL: {url!r}")
    data = json.dumps(body).encode() if body else None
    req = urllib.request.Request(
        url,
        data=data,
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "Content-Type": "application/json",
            "User-Agent": "Landhauscheck-waste-c/1.0",
        },
        method=method,
    )
    try:
        with urllib.request.urlopen(req) as resp:  # nosec B310 – scheme validated above
            content = resp.read()
            return json.loads(content) if content else {}
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode(errors="replace")[:400]
        raise RuntimeError(f"GitHub {exc.code}: {detail}") from exc


def _list_matching_paths(token: str, repo: str, lat: float, lng: float) -> list[str]:
    """Return repo-relative paths of any ICS files in the waste data directory
    that belong to these coordinates.

    Detection uses two strategies in order:
    1. Filename suffix ``_{lat:.4f}_{lng:.4f}.ics`` — matches files previously
       contributed through this endpoint.
    2. Content search via GitHub code search for the geo-header values — catches
       manually-curated files whose filenames don't embed coordinates.

    Returns an empty list on any API error — the caller treats this as
    "no existing file found".
    """
    suffix = f"_{lat:.4f}_{lng:.4f}.ics"
    lat_header = f"X-WR-GEO-LAT:{lat:.4f}"
    lng_header = f"X-WR-GEO-LNG:{lng:.4f}"
    waste_path = "sites/landhauscheck/app/data/waste"

    found: dict[str, bool] = {}  # path → True, deduplicates across both strategies

    # ── Strategy 1: filename suffix ───────────────────────────────────────────
    try:
        items = _gh("GET", f"/repos/{repo}/contents/{waste_path}", token)
        if isinstance(items, list):
            for item in items:
                if isinstance(item, dict) and item.get("name", "").endswith(suffix):
                    found[item["path"]] = True
    except RuntimeError:
        pass

    # ── Strategy 2: code search on geo-header content ─────────────────────────
    # Uses GitHub Code Search (REST) — rate-limited to 10 req/min unauth, 30 auth.
    # We search for the LAT header; results are filtered to also contain the LNG.
    try:
        q = f"{lat_header}+repo:{repo}+path:{waste_path}"
        result = _gh("GET", f"/search/code?q={q}&per_page=10", token)
        for item in result.get("items", []):
            path = item.get("path", "")
            if path and path not in found:
                # Verify both headers are present by fetching raw file content
                try:
                    file_obj = _gh("GET", f"/repos/{repo}/contents/{path}", token)
                    import base64 as _b64  # noqa: PLC0415
                    raw = _b64.b64decode(file_obj.get("content", "")).decode(errors="replace")
                    # Match to 4 d.p. — same precision as stored
                    if lat_header in raw and lng_header in raw:
                        found[path] = True
                except (RuntimeError, Exception):  # noqa: BLE001
                    pass
    except RuntimeError:
        pass

    return list(found.keys())


def _open_deletion_pr(
    token: str,
    repo: str,
    file_path: str,
    lat: float,
    lng: float,
) -> str | None:
    """Open a PR that deletes an expired ICS file.

    The branch name is derived deterministically from the filename so that
    this function is idempotent: if the branch already exists (meaning the
    deletion PR is already open or was already merged/closed), we skip
    creation and return None.

    Returns the PR HTML URL on success, or None if already handled.
    Raises RuntimeError on GitHub API failures.
    """
    # Build a deterministic, filesystem-safe branch name from the file stem.
    stem = file_path.rsplit("/", 1)[-1].rsplit(".", 1)[0]
    safe_stem = _SAFE_NAME_RE.sub("_", stem)[:60]
    branch = f"waste/expire-{safe_stem}"

    # Deduplication: skip if the branch already exists.
    try:
        _gh("GET", f"/repos/{repo}/git/ref/heads/{branch}", token)
        return None  # branch found → PR already open or previously merged
    except RuntimeError:
        pass  # 404 expected when branch doesn't exist; proceed

    # Fetch main branch tip.
    ref = _gh("GET", f"/repos/{repo}/git/ref/heads/main", token)
    base_sha = ref["object"]["sha"]
    commit_obj = _gh("GET", f"/repos/{repo}/git/commits/{base_sha}", token)
    base_tree_sha = commit_obj["tree"]["sha"]

    # Create a tree that deletes the file (sha: None removes path from tree).
    tree = _gh("POST", f"/repos/{repo}/git/trees", token, {
        "base_tree": base_tree_sha,
        "tree": [{"path": file_path, "mode": "100644", "type": "blob", "sha": None}],
    })

    new_commit = _gh("POST", f"/repos/{repo}/git/commits", token, {
        "message": (
            f"chore(waste): remove expired garbage calendar ({lat:.4f}, {lng:.4f})\n\n"
            "No future events remain in this ICS file.\n"
            "Triggered automatically when a user with this location visited the app."
        ),
        "tree": tree["sha"],
        "parents": [base_sha],
    })

    _gh("POST", f"/repos/{repo}/git/refs", token, {
        "ref": f"refs/heads/{branch}",
        "sha": new_commit["sha"],
    })

    pr = _gh("POST", f"/repos/{repo}/pulls", token, {
        "title": f"chore(waste): remove expired calendar ({lat:.4f}, {lng:.4f})",
        "head": branch,
        "base": "main",
        "body": (
            "## Expired waste calendar\n\n"
            f"The garbage calendar at `{file_path}` has no upcoming events.\n\n"
            "This PR removes it so the area shows the contribution panel and visitors "
            "can upload a current schedule.\n\n"
            "_Auto-opened when a user with this location visited the app._"
        ),
    })
    return pr["html_url"]


def _open_pr(
    token: str,
    repo: str,
    ics_content: str,
    lat: float,
    lng: float,
    cal_name: str,
    future_event_count: int,
    existing_paths: list[str] | None = None,
) -> str:
    """Create a branch, commit the ICS file and open a pull request.

    When ``existing_paths`` is non-empty the PR replaces those files (update
    flow): old files are deleted within the same commit tree and the PR title
    / body reflect the update rather than a new contribution.

    Returns the HTML URL of the newly created PR.

    The Git Data API is used so no local git clone is needed:
      1. Fetch main branch tip → base SHA
      2. Create a blob with the ICS content
      3. Create a tree that adds the new file (and removes old ones if updating)
      4. Create a commit on that tree
      5. Create a branch reference pointing to that commit
      6. Open a PR from the branch into main
    """
    is_update = bool(existing_paths)
    safe_name = _SAFE_NAME_RE.sub("_", cal_name)[:40]
    ts = int(time.time())
    action = "update" if is_update else "contrib"
    branch = f"waste/{action}-{lat:.4f}_{lng:.4f}-{ts}"
    filename = f"{date.today().year}_{safe_name}_{lat:.4f}_{lng:.4f}.ics"
    file_path = f"sites/landhauscheck/app/data/waste/{filename}"

    # 1. Get main branch tip SHA
    ref = _gh("GET", f"/repos/{repo}/git/ref/heads/main", token)
    base_sha = ref["object"]["sha"]

    # 2. Get the commit's tree SHA
    commit_obj = _gh("GET", f"/repos/{repo}/git/commits/{base_sha}", token)
    base_tree_sha = commit_obj["tree"]["sha"]

    # 3. Create blob (base64-encoded to handle any line endings safely)
    blob = _gh("POST", f"/repos/{repo}/git/blobs", token, {
        "content": base64.b64encode(ics_content.encode()).decode(),
        "encoding": "base64",
    })

    # 4. Create tree: add the new file and (for updates) remove old files.
    #    Setting sha to None removes a path from the resulting tree.
    tree_entries: list[dict] = [
        {"path": file_path, "mode": "100644", "type": "blob", "sha": blob["sha"]}
    ]
    for old_path in (existing_paths or []):
        if old_path != file_path:
            tree_entries.append({"path": old_path, "mode": "100644", "type": "blob", "sha": None})

    tree = _gh("POST", f"/repos/{repo}/git/trees", token, {
        "base_tree": base_tree_sha,
        "tree": tree_entries,
    })

    # 5. Create commit
    verb = "update" if is_update else "add"
    commit_msg = (
        f"feat(waste): {verb} garbage calendar for ({lat:.4f}, {lng:.4f})\n\n"
        f"Contributed via the in-app upload form.\n"
        f"Calendar: {cal_name}\n"
        f"Location: {lat:.6f}, {lng:.6f}\n"
        f"Upcoming events: {future_event_count}"
    )
    if is_update and existing_paths:
        commit_msg += "\nReplaces: " + ", ".join(existing_paths)

    new_commit = _gh("POST", f"/repos/{repo}/git/commits", token, {
        "message": commit_msg,
        "tree": tree["sha"],
        "parents": [base_sha],
    })

    # 6. Create branch
    _gh("POST", f"/repos/{repo}/git/refs", token, {
        "ref": f"refs/heads/{branch}",
        "sha": new_commit["sha"],
    })

    # 7. Open pull request
    checklist = (
        "- [ ] The ICS file covers a reasonable geographic area\n"
        "- [ ] The embedded coordinates match the actual waste-collection zone\n"
        "- [ ] The events are for a real and current collection schedule\n"
    )
    if is_update and existing_paths:
        replaced = ", ".join(f"`{p}`" for p in existing_paths)
        checklist += f"- [ ] The replaced files ({replaced}) are correctly removed\n"
    else:
        checklist += "- [ ] No duplicate calendar already exists for this area\n"

    pr_body = (
        f"## Garbage calendar {'update' if is_update else 'contribution'}\n\n"
        "A user uploaded a waste collection ICS file from within the app.\n\n"
        "| Field | Value |\n"
        "|---|---|\n"
        f"| Calendar name | `{cal_name}` |\n"
        f"| Latitude | `{lat:.6f}` |\n"
        f"| Longitude | `{lng:.6f}` |\n"
        f"| File | `{file_path}` |\n"
        f"| Upcoming events | {future_event_count} |\n"
    )
    if is_update and existing_paths:
        pr_body += "| Replaces | " + ", ".join(f"`{p}`" for p in existing_paths) + " |\n"
    pr_body += (
        f"\n### Before merging, please verify:\n{checklist}\n"
        f"Once merged, the backend matches the "
        f"{'updated' if is_update else 'new'} calendar automatically for "
        "users within the configured radius (default 2 km)."
    )

    pr = _gh("POST", f"/repos/{repo}/pulls", token, {
        "title": (
            f"feat(waste): {'update' if is_update else 'add'} garbage calendar "
            f"— {cal_name} ({lat:.4f}, {lng:.4f})"
        ),
        "head": branch,
        "base": "main",
        "body": pr_body,
    })
    return pr["html_url"]


# ── Endpoint ──────────────────────────────────────────────────────────────────

@router.post("/waste/contribute")
async def contribute_waste_calendar(
    lat: float = Query(..., ge=-90, le=90, description="User latitude at upload time"),
    lng: float = Query(..., ge=-180, le=180, description="User longitude at upload time"),
    file: UploadFile = File(..., description="ICS garbage calendar file"),
) -> JSONResponse:
    """Accept a user-submitted ICS waste calendar and open a GitHub pull request.

    The file is validated for structure and future event content before any PR
    is created. The user's coordinates are injected as X-WR-GEO-* headers so
    the waste service can match the calendar to nearby users after merge.

    Returns 200 with ``{"status": "pending_review", "pr_url": "...", "events": N}``.
    Returns 503 if the contribution service is not yet configured (GITHUB_TOKEN absent).
    Returns 413 if the file exceeds 1 MiB.
    Returns 422 if the ICS content fails validation.
    Returns 502 if the GitHub API call fails.
    """
    settings = get_settings()

    # ── Size guard ────────────────────────────────────────────────────────────
    # Read up to MAX+1 bytes; if we get more the file is too large.
    raw_bytes = await file.read(_MAX_ICS_BYTES + 1)
    if len(raw_bytes) > _MAX_ICS_BYTES:
        raise HTTPException(
            status_code=413,
            detail=(
                f"ICS file too large — maximum size is "
                f"{_MAX_ICS_BYTES // 1024} KB."
            ),
        )

    # ── Decode ────────────────────────────────────────────────────────────────
    try:
        raw = raw_bytes.decode("utf-8", errors="strict")
    except UnicodeDecodeError:
        try:
            raw = raw_bytes.decode("latin-1")
        except UnicodeDecodeError:
            raise HTTPException(
                status_code=400,
                detail="ICS file must be UTF-8 or Latin-1 encoded text.",
            )

    # ── Validate + inject geo headers ─────────────────────────────────────────
    try:
        processed_ics, cal_name, future_count = _validate_and_process(raw, lat, lng)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))

    # ── GitHub token guard (after validation so callers get precise errors) ───
    if not settings.github_token:
        raise HTTPException(
            status_code=503,
            detail=(
                "The calendar contribution service is not yet active. "
                "Please try again later or contact the site owner."
            ),
        )

    # ── Detect update vs new addition ─────────────────────────────────────────
    # If files for this lat/lng already exist in the repo the PR will replace
    # them (update flow); otherwise it adds a new calendar (contribution flow).
    existing_paths = _list_matching_paths(settings.github_token, settings.github_repo, lat, lng)
    is_update = bool(existing_paths)

    # ── Create GitHub PR ──────────────────────────────────────────────────────
    try:
        pr_url = _open_pr(
            token=settings.github_token,
            repo=settings.github_repo,
            ics_content=processed_ics,
            lat=lat,
            lng=lng,
            cal_name=cal_name,
            future_event_count=future_count,
            existing_paths=existing_paths,
        )
    except RuntimeError as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Could not create pull request: {exc}",
        )

    _record_contribution()
    return JSONResponse({
        "status": "pending_update" if is_update else "pending_review",
        "pr_url": pr_url,
        "events": future_count,
    })


def _record_contribution() -> None:
    """Increment the waste contribution counters in stats_store (best-effort)."""
    from datetime import UTC, datetime  # noqa: PLC0415

    from app.services import stats_store  # noqa: PLC0415

    try:
        stats_store.waste_contributions_total += 1
        day = datetime.now(tz=UTC).strftime("%Y-%m-%d")
        stats_store.waste_contributions_by_day[day] = (
            stats_store.waste_contributions_by_day.get(day, 0) + 1
        )
        stats_store.flush_persisted()
    except Exception:
        pass  # never block the response path
