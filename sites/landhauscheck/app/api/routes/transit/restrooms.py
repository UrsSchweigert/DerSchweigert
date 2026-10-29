"""Public restrooms discovery endpoint.

Route
-----
GET /transit/restrooms-nearby -- Find the nearest publicly accessible restrooms.

Data sources
------------
google  -- Google Places public_bathroom (fast, sparse)
osm     -- OSM Overpass (slower, richer: fee / hours / wheelchair)
all     -- Race both; first non-empty result wins (legacy single-call path)

The frontend fires ``source=google`` and ``source=osm`` simultaneously, renders
the first winner, then merges when the second arrives — upgrading entries with
the richer OSM fields without a visible flicker.
"""

import asyncio

import httpx
from fastapi import APIRouter, Query

from app.core.config import get_settings

from ._cache import _restroom_cache_get, _restroom_cache_set
from ._shared import GOOGLE_PLACES_NEARBY, HERE_ROUTER_URL, OVERPASS_MIRRORS, _haversine

router = APIRouter()


# ---------------------------------------------------------------------------
# OSM Overpass
# ---------------------------------------------------------------------------

async def _overpass_restrooms(lat: float, lng: float, radius: int) -> list[dict]:
    """Query OSM Overpass API for publicly accessible toilets near the given coordinates.
    Tries each mirror in order and returns on first successful JSON response.
    """
    query = (
        f"[out:json][timeout:15];"
        f"("
        f"  node[\"amenity\"=\"toilets\"][\"access\"!=\"private\"][\"access\"!=\"customers\"]"
        f"  (around:{radius},{lat},{lng});"
        f"  way[\"amenity\"=\"toilets\"][\"access\"!=\"private\"][\"access\"!=\"customers\"]"
        f"  (around:{radius},{lat},{lng});"
        f");"
        f"out center tags;"
    )

    async def _try_mirror(mirror: str) -> list:
        """Query a single Overpass mirror; return elements list or [] on any failure."""
        try:
            async with httpx.AsyncClient(timeout=4.0) as client:
                resp = await client.post(mirror, data={"data": query})
            if resp.status_code != 200:
                return []
            return resp.json().get("elements", [])
        except Exception:  # noqa: BLE001
            return []

    # Race all mirrors in parallel — return the first non-empty result.
    mirror_tasks = [_try_mirror(m) for m in OVERPASS_MIRRORS]
    elements: list = []
    for coro in asyncio.as_completed(mirror_tasks):
        result = await coro
        if result:
            elements = result
            break

    results: list[dict] = []
    for el in elements:
        etype = el.get("type")
        if etype == "node":
            elat, elng = el.get("lat"), el.get("lon")
        elif etype == "way":
            center = el.get("center", {})
            elat, elng = center.get("lat"), center.get("lon")
        else:
            continue
        if elat is None or elng is None:
            continue
        tags = el.get("tags", {})
        # Skip explicitly restricted even if the Overpass filter partially missed it
        if tags.get("access") in ("private", "customers"):
            continue
        dist = _haversine(lat, lng, elat, elng)
        # Build best available display name: named place > operator > street address > None
        _street = tags.get("addr:street")
        _number = tags.get("addr:housenumber")
        _addr = f"{_street} {_number}".strip() if _street and _number else _street
        _name = tags.get("name") or tags.get("operator") or _addr or None
        # Show address as subtitle when there is a real name (adds location context)
        _subtitle = _addr if (_name and _addr and _addr != _name) else None
        results.append({
            "id": f"osm:{etype}/{el['id']}",
            "name": _name,
            "subtitle": _subtitle,
            "lat": elat,
            "lng": elng,
            "distance": dist,
            "walk_min": max(1, round(dist / 83)),  # ~5 km/h walking speed
            "fee": tags.get("fee") in ("yes", "1", "true"),
            "opening_hours": tags.get("opening_hours"),
            "wheelchair": tags.get("wheelchair") in ("yes", "designated"),
        })

    results.sort(key=lambda r: r["distance"])
    return results


# ---------------------------------------------------------------------------
# HERE pedestrian routing
# ---------------------------------------------------------------------------

async def _here_walking_min(
    lat1: float, lng1: float, lat2: float, lng2: float, api_key: str
) -> int | None:
    """Return HERE-routed pedestrian travel time in minutes, or None on failure."""
    params = {
        "origin": f"{lat1},{lng1}",
        "destination": f"{lat2},{lng2}",
        "transportMode": "pedestrian",
        "return": "summary",
        "apiKey": api_key,
    }
    try:
        async with httpx.AsyncClient(timeout=6.0) as client:
            resp = await client.get(HERE_ROUTER_URL, params=params)
        if resp.status_code != 200:
            return None
        routes = resp.json().get("routes", [])
        if not routes:
            return None
        sections = routes[0].get("sections", [])
        if not sections:
            return None
        duration_s = sections[0].get("summary", {}).get("duration")
        return max(1, round(duration_s / 60)) if duration_s else None
    except Exception:  # noqa: BLE001
        return None


async def _enrich_restrooms_with_routing(
    results: list[dict], lat: float, lng: float, api_key: str
) -> list[dict]:
    """Overwrite walk_min with HERE-routed pedestrian times (parallel, haversine fallback)."""
    if not results or not api_key:
        return results
    times = await asyncio.gather(
        *[_here_walking_min(lat, lng, r["lat"], r["lng"], api_key) for r in results],
        return_exceptions=True,
    )
    for r, t in zip(results, times):
        if isinstance(t, int):
            r["walk_min"] = t
    return results


# ---------------------------------------------------------------------------
# Google Places fallback
# ---------------------------------------------------------------------------

async def _google_places_restrooms(
    lat: float, lng: float, radius: int, api_key: str
) -> list[dict]:
    """Query Google Places directly for public_bathroom when the shared cache is cold."""
    headers = {
        "X-Goog-Api-Key": api_key,
        "X-Goog-FieldMask": (
            "places.id,places.displayName,places.location,"
            "places.types,places.shortFormattedAddress"
        ),
        "Content-Type": "application/json",
    }
    body = {
        "includedTypes": ["public_bathroom"],
        "maxResultCount": 20,
        "rankPreference": "DISTANCE",
        "locationRestriction": {
            "circle": {
                "center": {"latitude": lat, "longitude": lng},
                "radius": float(min(radius, 50000)),
            }
        },
    }
    async with httpx.AsyncClient(timeout=10.0) as client:
        try:
            resp = await client.post(GOOGLE_PLACES_NEARBY, json=body, headers=headers)
            places = resp.json().get("places", []) if resp.status_code == 200 else []
        except Exception:  # noqa: BLE001
            return []

    results: list[dict] = []
    for p in places:
        loc = p.get("location", {})
        plat, plng = loc.get("latitude"), loc.get("longitude")
        if plat is None or plng is None:
            continue
        dist = _haversine(lat, lng, plat, plng)
        if dist > radius:
            continue
        _gname = p.get("displayName", {}).get("text") or None
        _gaddr = p.get("shortFormattedAddress") or None
        # Show address as subtitle when name is different from address
        _gsubtitle = _gaddr if (_gname and _gaddr and _gaddr != _gname) else _gaddr
        results.append({
            "id": f"gplaces:{p.get('id', '')}",
            "name": _gname,
            "subtitle": _gsubtitle,
            "lat": plat,
            "lng": plng,
            "distance": dist,
            "walk_min": max(1, round(dist / 83)),
            "fee": None,
            "opening_hours": None,
            "wheelchair": None,
        })
    results.sort(key=lambda r: r["distance"])
    return results


# ---------------------------------------------------------------------------
# Route
# ---------------------------------------------------------------------------

@router.get("/transit/restrooms-nearby")
async def transit_restrooms_nearby(
    lat: float = Query(..., ge=-90, le=90, description="Latitude of the centre point"),
    lng: float = Query(..., ge=-180, le=180, description="Longitude of the centre point"),
    radius: int = Query(1500, ge=100, le=5000, description="Search radius in metres"),
    limit: int = Query(5, ge=1, le=20, description="Maximum number of restrooms to return"),
    source: str = Query("all", description="Data source: 'google', 'osm', or 'all' (race both)"),
):
    """Find the nearest publicly accessible restrooms.

    Supports progressive loading from the frontend:
      source=google  — Google Places only (~500 ms, sparse data)
      source=osm     — OSM Overpass only + HERE walking times (richer: fee/hours/wheelchair)
      source=all     — race both, first non-empty wins (legacy / single-call path)

    The frontend fires source=google and source=osm simultaneously, renders the
    first winner, then merges when the second arrives — upgrading entries with
    the richer OSM fields without a visible flicker.
    """
    settings = get_settings()

    # ------------------------------------------------------------------ google
    if source == "google":
        if not settings.google_maps_api_key:
            return {"restrooms": [], "source": "google"}
        # Fast path: in-memory cache warm on this Lambda instance (side-effect of POI call)
        cached = _restroom_cache_get(lat, lng)
        if cached is not None:
            nearby = [r for r in cached if r["distance"] <= radius]
            if nearby:
                enriched = await _enrich_restrooms_with_routing(
                    nearby[:limit], lat, lng, settings.here_api_key
                )
                return {"restrooms": enriched, "source": "google_cached"}
        results = await _google_places_restrooms(lat, lng, radius, settings.google_maps_api_key)
        _restroom_cache_set(lat, lng, results)
        enriched = await _enrich_restrooms_with_routing(
            results[:limit], lat, lng, settings.here_api_key
        )
        return {"restrooms": enriched, "source": "google"}

    # -------------------------------------------------------------------- osm
    if source == "osm":
        results = await _overpass_restrooms(lat, lng, radius)
        enriched = await _enrich_restrooms_with_routing(
            results[:limit], lat, lng, settings.here_api_key
        )
        return {"restrooms": enriched, "source": "osm"}

    # -------------------------------------------------------------------- all
    # Legacy / single-call: race both, first non-empty wins.
    # Kept so any existing call without source= still works.
    async def _google_task_fn() -> list:
        if not settings.google_maps_api_key:
            return []
        cached = _restroom_cache_get(lat, lng)
        if cached is not None:
            return [r for r in cached if r["distance"] <= radius]
        return await _google_places_restrooms(lat, lng, radius, settings.google_maps_api_key)

    osm_task = asyncio.create_task(_overpass_restrooms(lat, lng, radius))
    google_task = asyncio.create_task(_google_task_fn())

    osm_res: list = []
    google_res: list = []
    pending: set = {osm_task, google_task}

    while pending:
        done, pending = await asyncio.wait(pending, return_when=asyncio.FIRST_COMPLETED)
        for t in done:
            try:
                result = t.result()
            except Exception:  # noqa: BLE001
                result = []
            result = result if isinstance(result, list) else []
            if t is osm_task:
                osm_res = result
            else:
                google_res = result

        if osm_res:
            for p in pending:
                p.cancel()
            break
        if google_res and osm_task in pending:
            osm_task.cancel()
            pending.discard(osm_task)
            break
        if not pending:
            break

    if osm_res:
        if google_res and len(osm_res) < 3:
            for gr in google_res:
                too_close = any(
                    _haversine(gr["lat"], gr["lng"], r["lat"], r["lng"]) < 50
                    for r in osm_res
                )
                if not too_close:
                    osm_res.append(gr)
            osm_res.sort(key=lambda r: r["distance"])
            final, src = osm_res, "osm+google"
        else:
            final, src = osm_res, "osm"
    elif google_res:
        final, src = google_res, "google"
    else:
        return {"restrooms": [], "source": "none"}

    _restroom_cache_set(lat, lng, final)
    enriched = await _enrich_restrooms_with_routing(final[:limit], lat, lng, settings.here_api_key)
    return {"restrooms": enriched, "source": src}
