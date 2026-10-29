"""Usage statistics endpoint.

Returns in-memory request counts (since container start) plus a 7-day
historical summary from CloudWatch Logs Insights when AWS credentials
are available.  Degrades gracefully in local development.
"""

from __future__ import annotations

import secrets
import time
from typing import Any

from fastapi import APIRouter, Header, HTTPException, Response
from pydantic import BaseModel

from app.core.config import get_settings
from app.services import stats_store

router = APIRouter(tags=["stats"])


def _count_waste_calendars() -> int:
    """Return the number of ICS calendar files bundled with the backend."""
    import glob  # noqa: PLC0415
    import os  # noqa: PLC0415

    data_dir = os.path.join(os.path.dirname(__file__), "..", "..", "data", "waste")
    return len(glob.glob(os.path.join(os.path.normpath(data_dir), "*.ics")))


class _PinRequest(BaseModel):
    pin: str


def _check_pin(x_stats_pin: str | None) -> None:
    """Raise 401 if the supplied PIN does not match STATS_PIN."""
    expected = get_settings().stats_pin or ""
    supplied = x_stats_pin or ""
    if not secrets.compare_digest(supplied, expected):
        raise HTTPException(status_code=401, detail="Unauthorized")


@router.post("/api/v1/admin/verify-pin", status_code=200)
def verify_pin(body: _PinRequest, response: Response) -> dict[str, bool]:
    """Validate the stats dashboard PIN.

    Called by stats-login.html.  Returns 200 on success so the browser can
    set the lhc_pin cookie and redirect to /stats.html.  The actual PIN value
    is never returned — the browser sets the cookie from the value the user
    typed, which is only accepted by the CloudFront Function guard if it matches.

    Also sets lhc_devmode=1 (Secure, 1-year) so that all subsequent
    requests from this browser are excluded from stats tracking.  Only the stats
    PIN holder (the developer) can ever reach this endpoint, so only the developer
    suppresses their own traffic.

    Not HttpOnly so the stats.html badge JS can read it via document.cookie.
    The value is non-sensitive (just "1") so this is an acceptable trade-off.
    """
    if not secrets.compare_digest(body.pin, get_settings().stats_pin or ""):
        raise HTTPException(status_code=401, detail="Invalid PIN")
    response.set_cookie(
        key="lhc_devmode",
        value="1",
        max_age=365 * 24 * 3600,   # 1 year
        path="/",
        secure=True,
        httponly=False,
        samesite="strict",
    )
    return {"ok": True}


@router.post("/api/v1/admin/clear-devmode", status_code=200)
def clear_devmode(
    response: Response,
    x_stats_pin: str | None = Header(default=None),
) -> dict[str, bool]:
    """Remove the lhc_devmode exclusion cookie (PIN-protected).

    Allows the developer to re-enable their own traffic in stats — useful for
    testing that tracking still works correctly.
    """
    _check_pin(x_stats_pin)
    response.delete_cookie(
        key="lhc_devmode", path="/", secure=True, httponly=False, samesite="strict"
    )
    return {"ok": True}


def _cw_stats_by_day() -> list[dict[str, Any]]:
    """Query CloudWatch Logs Insights for request counts per day (last 7 days)."""
    try:
        import boto3  # noqa: PLC0415
        from botocore.exceptions import BotoCoreError, ClientError  # noqa: PLC0415
    except ImportError:
        return []

    settings = get_settings()
    end_time = int(time.time())
    start_time = end_time - 7 * 24 * 3600

    query = (
        "fields @timestamp, @message"
        " | filter @message like /api\\/v1/"
        ' | parse @message \'"* * HTTP\' as method, path'
        " | stats count(*) as hits by bin(1d)"
        " | sort @timestamp asc"
        " | limit 14"
    )

    try:
        client = boto3.client("logs", region_name=settings.aws_region)
        resp = client.start_query(
            logGroupName=settings.cloudwatch_log_group,
            startTime=start_time,
            endTime=end_time,
            queryString=query,
        )
        query_id = resp["queryId"]

        for _ in range(8):
            time.sleep(1)
            result = client.get_query_results(queryId=query_id)
            if result["status"] == "Complete":
                rows = []
                for record in result.get("results", []):
                    row = {r["field"]: r["value"] for r in record}
                    rows.append({
                        "day": row.get("bin(1d)", "")[:10],
                        "hits": int(row.get("hits", 0)),
                    })
                return rows
        return []
    except (BotoCoreError, ClientError, Exception):
        return []


@router.get("/api/v1/admin/stats")
def get_stats(x_stats_pin: str | None = Header(default=None)) -> dict[str, Any]:
    """Return usage statistics for the Landhauscheck admin dashboard."""
    _check_pin(x_stats_pin)
    from datetime import UTC, datetime  # noqa: PLC0415

    now = datetime.now(tz=UTC)

    total_hits = sum(v["hits"] for v in stats_store.endpoint_stats.values())  # type: ignore[union-attr]
    total_errors = sum(v["errors"] for v in stats_store.endpoint_stats.values())  # type: ignore[union-attr]

    endpoints = []
    for path, data in sorted(
        stats_store.endpoint_stats.items(),
        key=lambda x: x[1]["hits"],  # type: ignore[index]
        reverse=True,
    ):
        hits = int(data["hits"])  # type: ignore[arg-type]
        avg_ms = round(float(data["total_ms"]) / hits, 1) if hits else 0.0  # type: ignore[arg-type]
        endpoints.append({
            "path": path,
            "hits": hits,
            "errors": int(data["errors"]),  # type: ignore[arg-type]
            "error_rate": round(int(data["errors"]) / hits * 100, 1) if hits else 0.0,  # type: ignore[arg-type]
            "avg_ms": avg_ms,
        })

    by_day = _cw_stats_by_day()

    # --- Session stats ---
    import time as _time  # noqa: PLC0415
    now_ts = _time.monotonic()
    active_cutoff = now_ts - stats_store.ACTIVE_SECONDS

    sessions_total = len(stats_store.sessions)
    sessions_active = sum(
        1 for s in stats_store.sessions.values()
        if s["last_seen_ts"] > active_cutoff
    )

    # Most recent 50 sessions, sorted by last_seen_ts desc
    recent_sessions = sorted(
        [
            {
                "id": sid[:8],
                "first_seen": s["first_seen"],
                "last_seen": s["last_seen"],
                "hits": s["hits"],
                "ua": s["ua_short"],
                "active": s["last_seen_ts"] > active_cutoff,
                "city": s.get("city", ""),
                "country": s.get("country", ""),
                "lat": s.get("lat"),
                "lon": s.get("lon"),
                "providers": s.get("providers", {}),
            }
            for sid, s in stats_store.sessions.items()
        ],
        key=lambda x: x["first_seen"],
        reverse=True,
    )[:50]

    # Locations for the map — sessions with resolved geo, deduplicated by city+country
    locations = [
        {"city": s["city"], "country": s["country"],
         "lat": s["lat"], "lon": s["lon"], "hits": s["hits"]}
        for s in recent_sessions
        if s.get("lat") is not None and s.get("lon") is not None
    ]

    # New sessions per day (last 14 days, sorted asc)
    sessions_by_day = [
        {"day": day, "new_sessions": count}
        for day, count in sorted(stats_store.session_starts_by_day.items())
    ][-14:]

    # Daily totals — persisted across restarts, merged with CloudWatch by_day
    persisted_by_day = [
        {"day": day, "hits": count}
        for day, count in sorted(stats_store.daily_totals.items())
    ][-30:]

    return {
        "started_at": stats_store.started_at.isoformat(),
        "as_of": now.isoformat(),
        "total_requests": total_hits,
        "total_errors": total_errors,
        "error_rate": round(total_errors / total_hits * 100, 1) if total_hits else 0.0,
        "endpoints": endpoints,
        "by_day": by_day if by_day else persisted_by_day,
        "recent": list(stats_store.recent_requests)[-50:],
        "error_log": list(stats_store.error_log)[-50:],
        "provider_totals": dict(stats_store.provider_totals),
        "sessions_total": sessions_total,
        "sessions_active": sessions_active,
        "sessions": recent_sessions,
        "sessions_by_day": sessions_by_day,
        "locations": locations,
        "waste_calendar_count": _count_waste_calendars(),
        "waste_contributions_total": stats_store.waste_contributions_total,
        "waste_contributions_by_day": dict(stats_store.waste_contributions_by_day),
    }
