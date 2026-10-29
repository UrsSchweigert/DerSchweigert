"""In-memory POI and restroom caches, persisted to Lambda /tmp.

Both caches are defined here so they share a single module import and the POI
fetch can populate the restroom cache as a free side-effect without a circular
dependency between poi.py and restrooms.py.

The /tmp directory is intentional — it is the only writable path available in
AWS Lambda.  Data written here survives warm-start invocations on the same
container instance, which is the desired behaviour.  File paths are
hard-coded constants, not derived from user input, so there is no path
traversal risk.
"""

import json
import time

# ---------------------------------------------------------------------------
# POI cache
# ---------------------------------------------------------------------------
# Key: "{round(lat,2)}_{round(lng,2)}_{radius}_{lang}"
# Value: (unix_timestamp, list[dict])
_POI_CACHE: dict[str, tuple[float, list]] = {}
_POI_CACHE_TTL = 180 * 24 * 3600  # ~6 months
_POI_CACHE_FILE = "/tmp/poi_cache.json"  # nosec B108 — Lambda ephemeral storage, no user input


def _load_poi_cache() -> None:
    """Load persisted POI cache from disk on module import."""
    try:
        with open(_POI_CACHE_FILE) as f:  # nosec B108
            raw = json.load(f)
        now = time.time()
        for k, (ts, pois) in raw.items():
            if now - ts < _POI_CACHE_TTL and pois:
                _POI_CACHE[k] = (ts, pois)
    except Exception:  # noqa: BLE001
        pass  # cache file absent on cold start — normal


def _save_poi_cache() -> None:
    """Persist POI cache to disk."""
    try:
        with open(_POI_CACHE_FILE, "w") as f:  # nosec B108
            json.dump({k: list(v) for k, v in _POI_CACHE.items()}, f)
    except Exception:  # noqa: BLE001
        pass  # never block the request path


def _poi_cache_get(key: str) -> list | None:
    entry = _POI_CACHE.get(key)
    if entry and (time.time() - entry[0]) < _POI_CACHE_TTL:
        return entry[1]
    return None


def _poi_cache_set(key: str, value: list) -> None:
    if not value:  # never cache empty results
        return
    _POI_CACHE[key] = (time.time(), value)
    # Evict expired entries to avoid unbounded growth
    now = time.time()
    expired = [k for k, (ts, _) in _POI_CACHE.items() if now - ts >= _POI_CACHE_TTL]
    for k in expired:
        del _POI_CACHE[k]
    _save_poi_cache()


# ---------------------------------------------------------------------------
# Restroom cache
# ---------------------------------------------------------------------------
# Populated as a side-effect of the POI query (public_bathroom is included in
# the same Google Places request), so restrooms-nearby gets a fast cache hit
# without a separate API call.
# Key: f"{round(lat,2)}_{round(lng,2)}_restrooms"
# Value: (unix_timestamp, list[dict])
_RESTROOM_CACHE: dict[str, tuple[float, list]] = {}
_RESTROOM_CACHE_FILE = "/tmp/restroom_cache.json"  # nosec B108 — Lambda ephemeral storage


def _restroom_cache_key(lat: float, lng: float) -> str:
    return f"{round(lat, 2)}_{round(lng, 2)}_restrooms"


def _load_restroom_cache() -> None:
    """Load persisted restroom cache from disk on module import."""
    try:
        with open(_RESTROOM_CACHE_FILE) as f:  # nosec B108
            raw = json.load(f)
        now = time.time()
        for k, (ts, items) in raw.items():
            if now - ts < _POI_CACHE_TTL:
                _RESTROOM_CACHE[k] = (ts, items)
    except Exception:  # noqa: BLE001
        pass  # cache file absent on cold start — normal


def _save_restroom_cache() -> None:
    """Persist restroom cache to disk."""
    try:
        with open(_RESTROOM_CACHE_FILE, "w") as f:  # nosec B108
            json.dump({k: list(v) for k, v in _RESTROOM_CACHE.items()}, f)
    except Exception:  # noqa: BLE001
        pass  # never block the request path


def _restroom_cache_get(lat: float, lng: float) -> list | None:
    entry = _RESTROOM_CACHE.get(_restroom_cache_key(lat, lng))
    if entry and (time.time() - entry[0]) < _POI_CACHE_TTL:
        return entry[1]
    return None


def _restroom_cache_set(lat: float, lng: float, value: list) -> None:
    """Store restroom results — even an empty list is stored so that subsequent calls
    know Google found nothing and should fall through to Overpass OSM."""
    _RESTROOM_CACHE[_restroom_cache_key(lat, lng)] = (time.time(), value)
    _save_restroom_cache()


# Populate caches from disk on module import (runs once per Lambda container lifetime)
_load_poi_cache()
_load_restroom_cache()
