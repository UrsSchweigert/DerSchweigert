"""Development fixture cache — record-and-replay for external API calls.

When ``DEV_CACHE_MODE`` is **not** ``"off"``, every outbound ``httpx.AsyncClient``
request is intercepted by :class:`DevCacheTransport` before it reaches the
network:

- **mode = on** (strict replay):
    Serve the pre-recorded fixture file.  If no fixture exists, raise an
    ``httpx.ConnectError`` so the failure is loud and obvious rather than
    silently triggering a real API call.

- **mode = record**:
    Make the real network request **and** save the response body as a fixture
    JSON file.  Use this mode once to seed the fixture directory, then switch
    back to ``on``.

- **mode = off** (default / production):
    Transport is never patched; all requests go straight to the network.

────────────────────────────────────────────────────────────────────────────
Cache-key design
────────────────────────────────────────────────────────────────────────────
Key = first 20 chars of SHA-256 over:  ``<METHOD>|<cleaned-url>|<body>``

"Cleaned" means every query-parameter whose name looks like an API key
(key, apikey, api_key, apiKey) is removed before hashing so that rotating
secrets doesn't invalidate fixtures.

The fixture file is stored as:
    sites/landhauscheck/app/data/fixtures/<key>.json

with the following envelope:
    {
        "meta": { "url": "...", "method": "GET", "note": "..." },
        "status": 200,
        "body": { ... }          # parsed JSON of the upstream response body
    }

────────────────────────────────────────────────────────────────────────────
Per-request bypass
────────────────────────────────────────────────────────────────────────────
Set the ``_bypass`` context-var to ``True`` (via :func:`set_bypass`) for the
duration of a request to skip the cache regardless of mode.  The FastAPI
middleware in ``main.py`` reads the incoming ``X-Dev-Cache-Bypass: 1`` header
and sets this contextvar automatically.

────────────────────────────────────────────────────────────────────────────
Monkey-patching httpx
────────────────────────────────────────────────────────────────────────────
:func:`install` replaces ``httpx.AsyncClient`` with a thin subclass that
injects :class:`DevCacheTransport` as the default transport whenever the
cache is active.  Calling :func:`install` twice is a no-op.  It must be
called **before** any route module is imported (handled in ``main.py``).
"""

from __future__ import annotations

import contextvars
import hashlib
import json
import logging
import re
from pathlib import Path
from typing import TYPE_CHECKING

import httpx

if TYPE_CHECKING:
    pass

log = logging.getLogger(__name__)

# ── Paths ────────────────────────────────────────────────────────────────────
_FIXTURE_DIR = Path(__file__).parent.parent / "data" / "fixtures"

# ── Context variable ──────────────────────────────────────────────────────────
# Toggled per-request by the middleware so individual route handlers don't need
# to know anything about the cache.
_bypass: contextvars.ContextVar[bool] = contextvars.ContextVar(
    "dev_cache_bypass", default=False
)


def set_bypass(value: bool) -> None:
    """Set bypass flag for the current async context."""
    _bypass.set(value)


def is_bypassed() -> bool:
    return _bypass.get()


# ── Key derivation ────────────────────────────────────────────────────────────
_KEY_PARAMS = re.compile(
    r"([?&])(key|apikey|api_key|apiKey)=[^&]*", re.IGNORECASE
)


def _cache_key(method: str, url: str, body: bytes) -> str:
    """Return a 20-char hex key for (method, url-without-api-keys, body)."""
    clean_url = _KEY_PARAMS.sub(r"\1\2=REDACTED", str(url))
    raw = f"{method.upper()}|{clean_url}|{body!r}"
    return hashlib.sha256(raw.encode()).hexdigest()[:20]


def fixture_path(key: str) -> Path:
    return _FIXTURE_DIR / f"{key}.json"


# ── Transport ─────────────────────────────────────────────────────────────────

class DevCacheTransport(httpx.AsyncBaseTransport):
    """httpx async transport that intercepts requests for dev caching."""

    def __init__(self, mode: str, real: httpx.AsyncBaseTransport | None = None) -> None:
        self._mode = mode
        self._real = real or httpx.AsyncHTTPTransport()

    async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
        # Always bypass if the contextvar says so
        if is_bypassed():
            return await self._real.handle_async_request(request)

        body_bytes: bytes = request.content
        key = _cache_key(request.method, str(request.url), body_bytes)
        fpath = fixture_path(key)

        # ── Replay from fixture ──────────────────────────────────────────────
        if fpath.exists():
            data = json.loads(fpath.read_text(encoding="utf-8"))
            log.debug("dev_cache HIT  %s %s → %s", request.method, request.url, fpath.name)
            content = json.dumps(data["body"]).encode()
            return httpx.Response(
                status_code=data.get("status", 200),
                headers={"content-type": "application/json"},
                content=content,
            )

        # ── Cache miss ───────────────────────────────────────────────────────
        if self._mode == "on":
            # Strict replay: fixture must exist — fail loudly so missing fixtures
            # are detected immediately rather than quietly hitting the live API.
            log.warning(
                "dev_cache MISS (mode=on, no fixture) %s %s  key=%s",
                request.method, request.url, key,
            )
            raise httpx.ConnectError(
                f"[dev_cache] No fixture for {request.method} {request.url} "
                f"(key={key}).  Run with DEV_CACHE_MODE=record to create it, "
                f"or send X-Dev-Cache-Bypass: 1 to hit the live API."
            )

        # ── Record mode: make real call, then save ───────────────────────────
        log.info(
            "dev_cache RECORD %s %s  key=%s",
            request.method, request.url, key,
        )
        real_response = await self._real.handle_async_request(request)
        await real_response.aread()  # drain the stream before accessing .content
        content = real_response.content

        try:
            body_data = json.loads(content)
        except (ValueError, UnicodeDecodeError):
            # Non-JSON response — save raw text, replay as-is
            body_data = content.decode("utf-8", errors="replace")

        _FIXTURE_DIR.mkdir(parents=True, exist_ok=True)
        envelope = {
            "meta": {
                "url": _KEY_PARAMS.sub(r"\1\2=REDACTED", str(request.url)),
                "method": request.method,
                "note": (
                    "Auto-recorded by DEV_CACHE_MODE=record.  "
                    "Review before committing."
                ),
            },
            "status": real_response.status_code,
            "body": body_data,
        }
        fpath.write_text(json.dumps(envelope, indent=2, ensure_ascii=False), encoding="utf-8")
        log.info("dev_cache SAVED  %s", fpath)

        # Return a fresh response (original stream consumed above)
        return httpx.Response(
            status_code=real_response.status_code,
            headers=dict(real_response.headers),
            content=content,
        )

    async def aclose(self) -> None:
        await self._real.aclose()


# ── Monkey-patch ──────────────────────────────────────────────────────────────

_installed = False
_original_async_client: type[httpx.AsyncClient] | None = None


def install(mode: str) -> None:
    """Replace ``httpx.AsyncClient`` with a caching-aware subclass.

    Safe to call multiple times — subsequent calls are no-ops.
    Must be invoked **before** any route module creates an ``AsyncClient``.
    """
    global _installed, _original_async_client  # noqa: PLW0603
    if _installed or mode == "off":
        return

    _original_async_client = httpx.AsyncClient

    class _CachingAsyncClient(httpx.AsyncClient):  # type: ignore[misc]
        """Thin wrapper that injects DevCacheTransport when no transport is given."""

        def __init__(self, *args, **kwargs) -> None:  # noqa: ANN002,ANN003
            if "transport" not in kwargs:
                kwargs["transport"] = DevCacheTransport(mode=mode)
            super().__init__(*args, **kwargs)

    # Replace at the httpx module level so all existing imports pick it up
    httpx.AsyncClient = _CachingAsyncClient  # type: ignore[misc]
    _installed = True
    log.info("dev_cache installed (mode=%s, fixture_dir=%s)", mode, _FIXTURE_DIR)


def uninstall() -> None:
    """Restore the original ``httpx.AsyncClient`` (used in tests)."""
    global _installed, _original_async_client  # noqa: PLW0603
    if _original_async_client is not None:
        httpx.AsyncClient = _original_async_client  # type: ignore[misc]
        _original_async_client = None
    _installed = False
