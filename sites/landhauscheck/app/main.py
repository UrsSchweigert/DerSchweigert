"""FastAPI application entrypoint for the Landhauscheck backend."""

import hashlib
import time
from datetime import UTC, datetime

import httpx
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from starlette.background import BackgroundTask

# ── Dev fixture cache: must be installed BEFORE any route module that uses
# httpx.AsyncClient is imported, so the monkey-patch is in effect.
from app.core import dev_cache as _dev_cache
from app.core.config import get_settings as _get_settings_early

_dev_cache.install(_get_settings_early().dev_cache_mode)

# Route imports intentionally placed after dev_cache.install() so the
# monkey-patch is active when each module-level httpx client is created.
from app.api.routes.chargers import router as chargers_router  # noqa: E402
from app.api.routes.feature_request import router as feature_request_router  # noqa: E402
from app.api.routes.fuel import router as fuel_router  # noqa: E402
from app.api.routes.geocode import router as geocode_router  # noqa: E402
from app.api.routes.health import router as health_router  # noqa: E402
from app.api.routes.logs import router as logs_router  # noqa: E402
from app.api.routes.notifications import router as notifications_router  # noqa: E402
from app.api.routes.stats import router as stats_router  # noqa: E402
from app.api.routes.transit import router as transit_router  # noqa: E402
from app.api.routes.waste import router as waste_router  # noqa: E402
from app.api.routes.waste_contribute import router as waste_contribute_router  # noqa: E402
from app.api.routes.weather import router as weather_router  # noqa: E402
from app.core.config import get_settings  # noqa: E402
from app.services import stats_store  # noqa: E402

settings = get_settings()


app = FastAPI(
    title=settings.app_name,
    version="0.1.0",
    description=(
        "Backend API for Landhauscheck. "
        "Step 1 includes baseline health and integration plumbing."
    ),
)

# Origins are read from CORS_ORIGINS env var (comma-separated).
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in settings.cors_origins.split(",") if o.strip()],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Paths excluded from endpoint stats and request log (health checks + self-polling)
_STATS_EXCLUDE = frozenset(["/health", "/api/v1/admin/stats"])

# How many external API calls each backend path makes
_PROVIDER_COSTS: dict[str, dict[str, int]] = {
    "/api/v1/transit/poi-nearby":   {"Google": 3},
    "/api/v1/transit/nearby":       {"HERE": 1},
    "/api/v1/transit/departures":   {"HERE": 1},
    "/api/v1/transit/rail-nearby":  {},          # in-memory snapshot
    "/api/v1/weather/forecast":     {"Open-Meteo": 1},
    "/api/v1/waste/upcoming":            {},
    "/api/v1/waste/contribute":           {},   # no external API — creates a GitHub PR
    "/api/v1/notifications/manifest":     {},   # no external API — scans ICS files
    "/api/v1/holidays":             {},
}

# Query-param paths where lat/lng should update the session location.
# Only paths that receive the USER's actual position (GPS or manual entry).
# Deliberately excludes /transit/nearby — that is called with STATION coordinates
# (not the user's location) by RoutingWidget when resolving a HERE station ID,
# which would otherwise overwrite the session location with the nearest train station.
_LOCATION_PATHS = frozenset([
    "/api/v1/transit/poi-nearby",
    "/api/v1/transit/rail-nearby",
    "/api/v1/waste/upcoming",
    "/api/v1/weather/forecast",
])


async def _reverse_geocode(session_id: str, lat: float, lon: float) -> None:
    """Background: reverse-geocode actual widget lat/lon via BigDataCloud (keyless HTTPS)."""
    try:
        url = (
            f"https://api.bigdatacloud.net/data/reverse-geocode-client"
            f"?latitude={lat}&longitude={lon}&localityLanguage=en"
        )
        async with httpx.AsyncClient(timeout=5) as client:
            r = await client.get(url)
            if r.status_code == 200:
                data = r.json()
                city = data.get("city") or data.get("locality") or ""
                country = data.get("countryName") or ""
                if session_id in stats_store.sessions:
                    stats_store.sessions[session_id]["city"] = city
                    stats_store.sessions[session_id]["country"] = country
                    stats_store.flush_persisted()  # persist geo immediately
    except Exception:  # noqa: BLE001
        pass


@app.middleware("http")
async def security_headers_middleware(request: Request, call_next):
    """Inject defensive security headers on every response.

    These are defence-in-depth headers for a JSON API.  The frontend HTML
    is served from S3/CloudFront with its own response-headers policy.
    """
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"] = "geolocation=(), camera=(), microphone=()"
    # Prevent caching of auth-protected admin endpoints
    if request.url.path.startswith("/api/v1/admin/"):
        response.headers["Cache-Control"] = "no-store"
    return response


@app.middleware("http")
async def dev_cache_middleware(request: Request, call_next):
    """Propagate X-Dev-Cache-Bypass header into the dev_cache contextvar.

    When the header is present with value '1', the fixture cache is skipped
    for all external API calls made during this request, even when
    DEV_CACHE_MODE=on.  The header is not forwarded upstream.
    """
    bypass = request.headers.get("X-Dev-Cache-Bypass", "") == "1"
    _dev_cache.set_bypass(bypass)
    return await call_next(request)


@app.middleware("http")
async def stats_middleware(request: Request, call_next):
    """Record per-endpoint hit counts, error counts, and response times."""
    start = time.monotonic()
    response = await call_next(request)
    ms = (time.monotonic() - start) * 1000

    # ── Developer exclusion ─────────────────────────────────────────────────
    # If the browser carries lhc_devmode=1 (set when the stats PIN is verified),
    # skip all tracking for this request.  Only the stats PIN holder can ever
    # acquire this cookie, so this suppresses developer traffic only.
    if request.cookies.get("lhc_devmode") == "1":
        return response

    path = request.url.path
    status = response.status_code

    now_utc = datetime.now(tz=UTC)
    today = now_utc.strftime("%Y-%m-%d")

    # Only track real app traffic — exclude ALB health checks and stats self-polling
    if path not in _STATS_EXCLUDE:
        if path not in stats_store.endpoint_stats:
            stats_store.endpoint_stats[path] = {"hits": 0, "errors": 0, "total_ms": 0.0}
        ep = stats_store.endpoint_stats[path]
        ep["hits"] = int(ep["hits"]) + 1  # type: ignore[arg-type]
        ep["total_ms"] = float(ep["total_ms"]) + ms  # type: ignore[arg-type]
        if status >= 400:
            ep["errors"] = int(ep["errors"]) + 1  # type: ignore[arg-type]
            # Only log errors on real API paths — ignore bot probes on arbitrary URLs
            if path.startswith("/api/") or path == "/health":
                stats_store.error_log.append({
                    "ts": now_utc.strftime("%H:%M:%S"),
                    "path": path,
                    "status": status,
                    "ms": round(ms, 1),
                })

        # Count external API calls per provider
        for provider, cost in _PROVIDER_COSTS.get(path, {}).items():
            stats_store.provider_totals[provider] = (
                stats_store.provider_totals.get(provider, 0) + cost
            )

        # Persist daily totals so they survive container restarts
        stats_store.daily_totals[today] = stats_store.daily_totals.get(today, 0) + 1
        stats_store.flush_persisted()

        stats_store.recent_requests.append({
            "ts": now_utc.strftime("%H:%M:%S"),
            "path": path,
            "status": status,
            "ms": round(ms, 1),
        })

    # --- Session tracking (hashed IP+UA — no raw PII stored) ---
    forwarded = request.headers.get("X-Forwarded-For", "")
    ip = (forwarded.split(",")[0].strip() if forwarded
          else (request.client.host if request.client else ""))
    ua = request.headers.get("User-Agent", "")
    session_id = hashlib.sha256(f"{ip}|{ua}".encode()).hexdigest()[:16]

    ua_short = ua[:80] if ua else "unknown"
    now_ts = time.monotonic()
    today = now_utc.strftime("%Y-%m-%d")
    now_str = now_utc.strftime("%H:%M:%S")

    if session_id not in stats_store.sessions:
        # New session — location starts empty; populated from widget lat/lng params below.
        # We never use IP-based geo (CloudFront headers) — widget params are the user's
        # actual location (GPS or manually entered).
        stats_store.sessions[session_id] = {
            "first_seen": now_utc.isoformat(timespec="seconds"),
            "last_seen_ts": now_ts,
            "last_seen": now_str,
            "hits": 1,
            "ua_short": ua_short,
            "city": "",
            "country": "",
            "lat": None,
            "lon": None,
            "providers": {},
        }
        stats_store.session_starts_by_day[today] = (
            stats_store.session_starts_by_day.get(today, 0) + 1
        )
    else:
        sess = stats_store.sessions[session_id]
        sess["last_seen_ts"] = now_ts
        sess["last_seen"] = now_str
        sess["hits"] = int(sess["hits"]) + 1

    # Update session location from actual widget lat/lng — the user's real location
    # (GPS or manually entered). Fire reverse-geocode only once per session.
    if path in _LOCATION_PATHS:
        params = request.query_params
        try:
            widget_lat = float(params.get("lat", ""))
            widget_lng = float(params.get("lng", "") or params.get("lon", ""))
            sess = stats_store.sessions[session_id]
            first_fix = sess.get("lat") is None
            sess["lat"] = widget_lat
            sess["lon"] = widget_lng
            if first_fix:
                response.background = BackgroundTask(
                    _reverse_geocode, session_id, widget_lat, widget_lng
                )
        except (ValueError, KeyError):
            pass

    # Track per-session provider costs
    if path not in _STATS_EXCLUDE:
        sess = stats_store.sessions[session_id]
        if "providers" not in sess:
            sess["providers"] = {}
        for provider, cost in _PROVIDER_COSTS.get(path, {}).items():
            sess["providers"][provider] = sess["providers"].get(provider, 0) + cost

    return response


app.include_router(health_router)
app.include_router(logs_router)
app.include_router(stats_router)
app.include_router(chargers_router,        prefix=settings.api_v1_prefix)
app.include_router(feature_request_router, prefix=settings.api_v1_prefix)
app.include_router(fuel_router,            prefix=settings.api_v1_prefix)
app.include_router(geocode_router,         prefix=settings.api_v1_prefix)
app.include_router(transit_router,         prefix=settings.api_v1_prefix)
app.include_router(notifications_router,   prefix=settings.api_v1_prefix)
app.include_router(waste_router,           prefix=settings.api_v1_prefix)
app.include_router(waste_contribute_router, prefix=settings.api_v1_prefix)
app.include_router(weather_router,         prefix=settings.api_v1_prefix)
