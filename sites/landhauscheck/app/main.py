"""FastAPI application entrypoint for the Landhauscheck backend."""

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

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
from app.api.routes.notifications import router as notifications_router  # noqa: E402
from app.api.routes.transit import router as transit_router  # noqa: E402
from app.api.routes.waste import router as waste_router  # noqa: E402
from app.api.routes.waste_contribute import router as waste_contribute_router  # noqa: E402
from app.api.routes.weather import router as weather_router  # noqa: E402
from app.core.config import get_settings  # noqa: E402

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


app.include_router(health_router)
app.include_router(chargers_router,        prefix=settings.api_v1_prefix)
app.include_router(feature_request_router, prefix=settings.api_v1_prefix)
app.include_router(fuel_router,            prefix=settings.api_v1_prefix)
app.include_router(geocode_router,         prefix=settings.api_v1_prefix)
app.include_router(transit_router,         prefix=settings.api_v1_prefix)
app.include_router(notifications_router,   prefix=settings.api_v1_prefix)
app.include_router(waste_router,           prefix=settings.api_v1_prefix)
app.include_router(waste_contribute_router, prefix=settings.api_v1_prefix)
app.include_router(weather_router,         prefix=settings.api_v1_prefix)
