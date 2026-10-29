"""In-memory request statistics store with file-backed daily persistence.

Accumulates per-endpoint hit counts, error counts, and timing since the
last container start.  Daily totals and session-starts-by-day are flushed
to /tmp/stats_persist.json so they survive container restarts.

Accessed by the stats middleware (main.py) and the stats endpoint
(api/routes/stats.py).
"""

from __future__ import annotations

import json
import os
import threading
from collections import deque
from datetime import UTC, datetime
from pathlib import Path

_PERSIST_PATH = Path("/tmp/stats_persist.json")  # nosec B108 — Lambda ephemeral storage, no user input
_STATS_BUCKET = os.environ.get("STATS_BUCKET", "")
_S3_KEY = "stats_persist.json"
_flush_lock = threading.Lock()

started_at: datetime = datetime.now(tz=UTC)

# {path: {"hits": int, "errors": int, "total_ms": float}}
endpoint_stats: dict[str, dict[str, float | int]] = {}

# Ring buffer of the 500 most recent requests
recent_requests: deque[dict] = deque(maxlen=500)

# Ring buffer of the 200 most recent errors with details
error_log: deque[dict] = deque(maxlen=200)

# Per-provider external API call counts  {provider: int}
# Providers: "Google", "HERE", "Open-Meteo"
provider_totals: dict[str, int] = {}

# Session tracking — keyed by sha256(ip+ua)[:16], no raw PII stored
# {session_id: {"first_seen": str, "last_seen_ts": float, "last_seen": str,
#                "hits": int, "ua_short": str,
#                "city": str, "country": str, "lat": float|None, "lon": float|None,
#                "providers": {"Google": int, "HERE": int, "Open-Meteo": int}}}
sessions: dict[str, dict] = {}

# New session starts per calendar day (UTC)  {"YYYY-MM-DD": int}
session_starts_by_day: dict[str, int] = {}

# Cumulative daily request totals  {"YYYY-MM-DD": int}  — persisted across restarts
daily_totals: dict[str, int] = {}

# A session is considered "active" if its last request was within this many seconds
ACTIVE_SECONDS: int = 300

# Waste calendar contribution counters
# Incremented each time a user successfully submits an ICS via POST /api/v1/waste/contribute.
waste_contributions_total: int = 0
# New contribution submissions per calendar day (UTC)  {"YYYY-MM-DD": int}
waste_contributions_by_day: dict[str, int] = {}


def _load_persisted() -> None:
    """Load persisted stats — try S3 first, fallback to /tmp."""
    import time as _time  # noqa: PLC0415
    global daily_totals, session_starts_by_day, provider_totals  # noqa: PLW0603
    global waste_contributions_total, waste_contributions_by_day  # noqa: PLW0603

    raw: str | None = None

    # Try S3 first (survives ECS container replacements / deploys)
    if _STATS_BUCKET:
        try:
            import boto3  # noqa: PLC0415
            s3 = boto3.client("s3")
            obj = s3.get_object(Bucket=_STATS_BUCKET, Key=_S3_KEY)
            raw = obj["Body"].read().decode()
        except Exception:
            pass  # bucket empty on first run, or no network yet

    # Fallback to local /tmp (same container restart, no S3)
    if raw is None and _PERSIST_PATH.exists():
        try:
            raw = _PERSIST_PATH.read_text()
        except Exception:
            pass

    if raw is None:
        return

    try:
        data = json.loads(raw)
        global waste_contributions_total, waste_contributions_by_day
        daily_totals = data.get("daily_totals", {})
        session_starts_by_day = data.get("session_starts_by_day", {})
        provider_totals.update(data.get("provider_totals", {}))
        waste_contributions_total = data.get("waste_contributions_total", 0)
        waste_contributions_by_day = data.get("waste_contributions_by_day", {})
        for path, ep in data.get("endpoint_stats", {}).items():
            if path not in endpoint_stats:
                endpoint_stats[path] = ep
        now_ts = _time.monotonic()
        for sid, s in data.get("sessions", {}).items():
            s["last_seen_ts"] = now_ts - ACTIVE_SECONDS - 1
            sessions[sid] = s
    except Exception:
        pass


def flush_persisted() -> None:
    """Flush stats to /tmp AND upload to S3 (best-effort, non-blocking)."""
    with _flush_lock:
        try:
            sessions_out = {
                sid: {k: v for k, v in s.items() if k != "last_seen_ts"}
                for sid, s in sessions.items()
            }
            payload = json.dumps({
                "daily_totals": daily_totals,
                "session_starts_by_day": session_starts_by_day,
                "endpoint_stats": endpoint_stats,
                "provider_totals": provider_totals,
                "sessions": sessions_out,
                "waste_contributions_total": waste_contributions_total,
                "waste_contributions_by_day": waste_contributions_by_day,
            })
            # Always write to /tmp (fast, local fallback)
            _PERSIST_PATH.write_text(payload)
            # Upload to S3 if bucket is configured
            if _STATS_BUCKET:
                try:
                    import boto3  # noqa: PLC0415
                    boto3.client("s3").put_object(
                        Bucket=_STATS_BUCKET,
                        Key=_S3_KEY,
                        Body=payload.encode(),
                        ContentType="application/json",
                    )
                except Exception:
                    pass  # never block the request path
        except Exception:
            pass


# Load on import
_load_persisted()
