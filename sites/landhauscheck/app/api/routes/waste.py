"""Waste collection calendar endpoint.

Scans all ICS files under app/data/waste/. Each file encodes a location
(via X-WR-GEO-LAT / X-WR-GEO-LNG) and a set of VEVENT entries. If the
user's position is within `radius` metres of a file's location the next
`count` upcoming events (from today) are returned.

File naming convention: {YEAR}_{LocationName}.ics

Expired calendars (matched file but all events in the past) are surfaced
to the frontend via ``"expired": true`` in the response, allowing the user
to upload a replacement. A deletion PR is also opened automatically (once
per file) when expiry is detected and GITHUB_TOKEN is configured.
"""

import math
import os
from datetime import date

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import Response

router = APIRouter()

_WASTE_DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "data", "waste")


def _try_delete_expired(file_path: str, lat: float, lng: float) -> None:
    """Best-effort: open a GitHub deletion PR for an expired ICS file.

    Uses a lazy import so waste.py does not create a hard dependency on the
    contribute module at load time. All errors are swallowed — this must never
    delay or break the primary response.
    """
    try:
        from app.api.routes.waste_contribute import _open_deletion_pr  # noqa: PLC0415
        from app.core.config import get_settings  # noqa: PLC0415

        settings = get_settings()
        if settings.github_token:
            _open_deletion_pr(settings.github_token, settings.github_repo, file_path, lat, lng)
    except Exception:  # noqa: BLE001 — best-effort, never block user response
        pass


def _haversine(lat1: float, lng1: float, lat2: float, lng2: float) -> int:
    """Return great-circle distance in metres."""
    R = 6_371_000
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lng2 - lng1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    return round(R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a)))


def _parse_ics(filepath: str) -> dict:
    """Parse a minimal ICS file.

    Returns:
        {
            "name": str | None,
            "lat": float | None,
            "lng": float | None,
            "events": [{"date": date, "summary": str}, ...]
        }
    """
    with open(filepath, encoding="utf-8") as fh:
        raw = fh.read()

    # Unfold RFC-5545 line continuations (CRLF or LF followed by space/tab)
    raw = raw.replace("\r\n ", "").replace("\r\n\t", "")
    raw = raw.replace("\n ", "").replace("\n\t", "")

    location_lat: float | None = None
    location_lng: float | None = None
    location_name: str | None = None
    events: list[dict] = []

    in_event = False
    current: dict = {}

    for line in raw.splitlines():
        line = line.strip()
        if line == "BEGIN:VEVENT":
            in_event = True
            current = {}
        elif line == "END:VEVENT":
            if "date" in current and "summary" in current:
                events.append(current)
            in_event = False
            current = {}
        elif in_event:
            if line.upper().startswith("DTSTART"):
                # DTSTART;VALUE=DATE:20260105
                # DTSTART;TZID=Europe/Berlin;VALUE=DATE:20260105
                # DTSTART:20260105T000000Z
                val = line.split(":", 1)[-1].strip()[:8]
                try:
                    current["date"] = date(int(val[0:4]), int(val[4:6]), int(val[6:8]))
                except (ValueError, IndexError):
                    pass
            elif line.upper().startswith("SUMMARY:"):
                summary = line.split(":", 1)[-1].strip()
                # AWIDO appends " in {LocationName}" — strip it
                if " in " in summary:
                    summary = summary.rsplit(" in ", 1)[0].strip()
                current["summary"] = summary
        else:
            if line.upper().startswith("X-WR-GEO-LAT:"):
                try:
                    location_lat = float(line.split(":", 1)[-1])
                except ValueError:
                    pass
            elif line.upper().startswith("X-WR-GEO-LNG:"):
                try:
                    location_lng = float(line.split(":", 1)[-1])
                except ValueError:
                    pass
            elif line.upper().startswith("X-WR-LOCATION-NAME:"):
                location_name = line.split(":", 1)[-1].strip()

    return {"name": location_name, "lat": location_lat, "lng": location_lng, "events": events}


@router.get("/waste/upcoming")
async def waste_upcoming(
    lat: float = Query(..., ge=-90, le=90, description="User latitude"),
    lng: float = Query(..., ge=-180, le=180, description="User longitude"),
    count: int = Query(10, ge=1, le=50, description="Number of upcoming events to return"),
    radius: int = Query(2000, ge=100, le=50000, description="Match radius in metres"),
):
    """Return the next `count` waste-collection events for the nearest matching location.

    The backend scans every *.ics file in the waste data directory and
    returns events from the first file whose embedded coordinates lie
    within `radius` metres of the supplied position.
    """
    data_dir = os.path.normpath(_WASTE_DATA_DIR)
    if not os.path.isdir(data_dir):
        return {"location": None, "events": [], "expired": False}

    today = date.today()
    matched_location: str | None = None
    matched_file_path: str | None = None
    matched_lat: float | None = None
    matched_lng: float | None = None
    upcoming: list[dict] = []

    ics_files = sorted(f for f in os.listdir(data_dir) if f.endswith(".ics"))
    for filename in ics_files:
        filepath = os.path.join(data_dir, filename)
        try:
            data = _parse_ics(filepath)
        except OSError:
            continue

        if data["lat"] is None or data["lng"] is None:
            continue

        dist = _haversine(lat, lng, data["lat"], data["lng"])
        if dist > radius:
            continue

        matched_location = data["name"] or filename.rsplit(".", 1)[0]
        matched_file_path = f"sites/landhauscheck/app/data/waste/{filename}"
        matched_lat = data["lat"]
        matched_lng = data["lng"]
        for event in data["events"]:
            if event["date"] >= today:
                upcoming.append(
                    {"date": event["date"].isoformat(), "summary": event["summary"]}
                )
        # Use the first matching file only
        break

    upcoming.sort(key=lambda e: e["date"])

    is_expired = matched_location is not None and len(upcoming) == 0

    # Best-effort: open a deletion PR when an expired file is first detected.
    # Uses a deterministic branch name so the PR is only opened once even if
    # many users trigger this code path concurrently.
    if is_expired and matched_file_path and matched_lat is not None and matched_lng is not None:
        _try_delete_expired(matched_file_path, matched_lat, matched_lng)

    return {"location": matched_location, "events": upcoming[:count], "expired": is_expired}


@router.get("/waste/calendar.ics")
async def waste_calendar_ics(
    lat: float = Query(..., ge=-90, le=90, description="User latitude"),
    lng: float = Query(..., ge=-180, le=180, description="User longitude"),
    radius: int = Query(5000, ge=100, le=50000, description="Search radius in metres"),
):
    """Return the raw ICS file for the nearest matching waste calendar.

    The client downloads this file and adds it to their native calendar app.
    Each VEVENT already carries a VALARM (TRIGGER:-P0DT7H0M) so the calendar
    app fires a native notification at 17:00 the day before collection,
    independently of the PWA being open.

    Duplicate prevention relies on the per-VEVENT UID embedded in the ICS:
    calendar apps deduplicate on UID, so re-importing the same file silently
    updates rather than creates new entries.  The client additionally stores a
    localStorage flag to avoid offering the export more than once per location.
    """
    data_dir = os.path.normpath(_WASTE_DATA_DIR)
    best_dist: int | None = None
    best_path: str | None = None

    if os.path.isdir(data_dir):
        for filename in sorted(f for f in os.listdir(data_dir) if f.endswith(".ics")):
            filepath = os.path.join(data_dir, filename)
            try:
                data = _parse_ics(filepath)
            except Exception:  # noqa: BLE001 — skip unreadable files silently
                continue
            if data["lat"] is None or data["lng"] is None:
                continue
            dist = _haversine(lat, lng, data["lat"], data["lng"])
            if dist <= radius and (best_dist is None or dist < best_dist):
                best_dist = dist
                best_path = filepath

    if best_path is None:
        raise HTTPException(status_code=404, detail="No waste calendar found near your location")

    with open(best_path, encoding="utf-8") as fh:
        ics_content = fh.read()

    safe_name = os.path.basename(best_path)
    return Response(
        content=ics_content,
        media_type="text/calendar; charset=utf-8",
        headers={
            # "attachment" causes iOS Safari (opened via window.open) to treat
            # the response as a file download and present the system
            # "Open in Calendar" / "Add to Calendar" sheet, which imports the
            # events into the user's personal calendar (VALARMs honoured).
            # "inline" would cause Safari to try to render text/calendar as
            # a text document, producing a blank page.
            # The webcal:// <a>-anchor path never sends an HTTP request so
            # this header does not affect it.
            "Content-Disposition": f'attachment; filename="{safe_name}"',
            "Cache-Control": "public, max-age=3600",
        },
    )
