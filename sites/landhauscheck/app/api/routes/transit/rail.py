"""Rail-station discovery endpoint.

Route
-----
GET /transit/rail-nearby -- Find the nearest DB railway stations.

Strategy
--------
1. Search the in-memory DB snapshot (``_DB_STATIONS``) — instant, no API call.
2. If the snapshot returns nothing (location outside Germany or in a gap),
   fall back to the Google Places Nearby Search API.

The snapshot is refreshed monthly via ``.github/workflows/refresh-stations.yml``
and baked into the Docker image at build time.
"""

import json
from pathlib import Path

import httpx
from fastapi import APIRouter, Query

from app.core.config import get_settings

from ._shared import GOOGLE_PLACES_NEARBY, _haversine

router = APIRouter()

# ---------------------------------------------------------------------------
# Static station dataset – loaded once at module import time
# ---------------------------------------------------------------------------
_STATIONS_FILE = Path(__file__).parent.parent.parent.parent / "data" / "db_stations.json"


def _load_stations() -> list:
    if not _STATIONS_FILE.exists():
        return []
    with _STATIONS_FILE.open(encoding="utf-8") as fh:
        return json.load(fh)


_DB_STATIONS: list = _load_stations()


async def _google_places_stations(
    lat: float,
    lng: float,
    radius: int,
    limit: int,
    api_key: str,
) -> list[dict]:
    """Query Google Places API for train stations near the given coordinates.

    Returns a list of station dicts in the same shape as the DB snapshot lookup:
    id, name, lat, lng, distance (metres), railway.
    Used as a fallback when the in-memory DB snapshot returns no results.
    """
    body = {
        "includedTypes": ["train_station", "subway_station", "light_rail_station"],
        "maxResultCount": min(limit * 4, 20),  # fetch more, then trim after dedup
        "locationRestriction": {
            "circle": {
                "center": {"latitude": lat, "longitude": lng},
                "radius": float(radius),
            }
        },
    }
    headers = {
        "X-Goog-Api-Key": api_key,
        "X-Goog-FieldMask": "places.id,places.displayName,places.location,places.types",
        "Content-Type": "application/json",
    }
    async with httpx.AsyncClient(timeout=10.0) as client:
        try:
            resp = await client.post(GOOGLE_PLACES_NEARBY, json=body, headers=headers)
        except httpx.RequestError:
            return []

    if resp.status_code != 200:
        return []

    places = resp.json().get("places", [])
    results = []
    for p in places:
        loc = p.get("location", {})
        plat = loc.get("latitude")
        plng = loc.get("longitude")
        if plat is None or plng is None:
            continue
        types = set(p.get("types", []))
        # Map Google types → our railway field; prefer subway/light-rail over generic
        if "subway_station" in types:
            railway = "subway"
        elif "light_rail_station" in types:
            railway = "light_rail"
        else:
            railway = "rail"
        results.append({
            "id": p.get("id", ""),
            "name": p.get("displayName", {}).get("text", "Unknown"),
            "lat": plat,
            "lng": plng,
            "distance": _haversine(lat, lng, plat, plng),
            "railway": railway,
        })

    results.sort(key=lambda s: s["distance"])
    return results


@router.get("/transit/rail-nearby")
async def transit_rail_nearby(
    lat: float = Query(..., ge=-90, le=90, description="Latitude of the centre point"),
    lng: float = Query(..., ge=-180, le=180, description="Longitude of the centre point"),
    radius: int = Query(25000, ge=1000, le=100000, description="Search radius in metres"),
    limit: int = Query(5, ge=1, le=20, description="Maximum number of stations to return"),
):
    """Find the nearest DB railway stations using the in-memory station snapshot.

    Returns stations sorted by distance, each with id, name, lat, lng,
    distance (metres), and railway (derived from DB category).
    The snapshot is refreshed monthly and baked into the Docker image.

    If the snapshot returns no results (e.g. location is outside Germany),
    the endpoint falls back to the Google Places API.
    """
    settings = get_settings()

    candidates = []
    for s in _DB_STATIONS:
        dist = _haversine(lat, lng, s["lat"], s["lng"])
        if dist <= radius:
            candidates.append({
                "id": s["id"],
                "name": s["name"],
                "lat": s["lat"],
                "lng": s["lng"],
                "distance": dist,
                # DB category 1-4: major/regional; 5-7: small halts
                "railway": "rail" if s.get("category", 7) <= 4 else "halt",
            })

    candidates.sort(key=lambda s: s["distance"])

    # Deduplicate: drop stations closer than MIN_SPACING_M to an already-selected one
    MIN_SPACING_M = 5000
    selected = []
    for s in candidates:
        too_close = any(
            _haversine(s["lat"], s["lng"], sel["lat"], sel["lng"]) < MIN_SPACING_M
            for sel in selected
        )
        if not too_close:
            selected.append(s)
        if len(selected) >= limit:
            break

    # Fallback: if the DB snapshot found nothing, try Google Places API
    if not selected and settings.google_maps_api_key:
        selected = await _google_places_stations(
            lat, lng, radius, limit, settings.google_maps_api_key
        )
        # Apply the same dedup + limit to Google results
        deduped = []
        for s in selected:
            too_close = any(
                _haversine(s["lat"], s["lng"], sel["lat"], sel["lng"]) < MIN_SPACING_M
                for sel in deduped
            )
            if not too_close:
                deduped.append(s)
            if len(deduped) >= limit:
                break
        selected = deduped

    return {"stations": selected}
