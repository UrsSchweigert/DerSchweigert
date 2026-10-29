"""POI discovery endpoint using Google Places API.

Route
-----
GET /transit/poi-nearby -- Find nearby POIs in five categories:
                           Food & Drink, Essential Facilities, Shopping,
                           Accommodation, Culture.

The POI fetch also populates the restroom cache (``_restroom_cache_set``) as a
free side-effect — ``public_bathroom`` is included in the same Places request,
so the restrooms-nearby endpoint gets fast cache hits without a separate call.
"""

import httpx
from fastapi import APIRouter, HTTPException, Query

from app.core.config import get_settings

from ._cache import _poi_cache_get, _poi_cache_set, _restroom_cache_set
from ._shared import GOOGLE_PLACES_NEARBY, _haversine

router = APIRouter()

# ---------------------------------------------------------------------------
# Google Places type → our 5 user-facing categories
# ---------------------------------------------------------------------------
_GOOGLE_CATEGORY_TYPES: dict[str, list[str]] = {
    "Food & Drink": [
        "restaurant",
        "cafe",
        "bakery",
        "bar",
    ],
    "Essential Facilities": [
        "public_bathroom",
        "pharmacy",
        "hospital",
        "atm",
    ],
    "Shopping": [
        "supermarket",
        "convenience_store",
        "drugstore",
        "electronics_store",
    ],
    "Culture": [
        "museum",
        "art_gallery",
        "library",
        "church",
        "monument",
        "night_club",
        "event_venue",
        "concert_hall",
        "casino",
    ],
}

# These types typically have no meaningful user-review counts;
# skip the rating quality-filter for them.
_UTILITY_TYPES = frozenset({"public_bathroom", "atm", "pharmacy", "hospital"})


async def _google_places_pois(
    lat: float,
    lng: float,
    radius: int,
    api_key: str,
    language: str = "de",
) -> list[dict]:
    """Fetch POIs via a single POPULARITY-ranked Google Places Nearby Search.

    Includes public_bathroom in the same request so that restroom data is
    populated into the restroom cache as a free side-effect (no extra API call).
    Returns all five categories (Food & Drink, Essential Facilities, Shopping,
    Accommodation, Culture) sorted nearest-first to the caller.
    """
    type_to_category: dict[str, str] = {
        t: cat for cat, types in _GOOGLE_CATEGORY_TYPES.items() for t in types
    }
    # public_bathroom is now part of _GOOGLE_CATEGORY_TYPES (Essential Facilities)
    # so all_types is simply the full keyset.
    all_types = list(type_to_category.keys())

    cache_key = f"{round(lat, 2)}_{round(lng, 2)}_{radius}_{language}"
    cached = _poi_cache_get(cache_key)
    if cached is not None:
        return cached

    headers = {
        "X-Goog-Api-Key": api_key,
        "X-Goog-FieldMask": (
            "places.id,places.displayName,places.location,"
            "places.types,places.rating,places.userRatingCount"
        ),
        "Content-Type": "application/json",
    }
    body = {
        "includedTypes": all_types,
        "maxResultCount": 20,
        "rankPreference": "POPULARITY",
        "locationRestriction": {
            "circle": {
                "center": {"latitude": lat, "longitude": lng},
                "radius": float(min(radius, 50000)),
            }
        },
        "languageCode": language,
    }
    async with httpx.AsyncClient(timeout=10.0) as client:
        try:
            resp = await client.post(GOOGLE_PLACES_NEARBY, json=body, headers=headers)
            places = resp.json().get("places", []) if resp.status_code == 200 else []
        except Exception:  # noqa: BLE001
            places = []

    pois: list[dict] = []
    google_restrooms: list[dict] = []

    for p in places:
        pid = p.get("id", "")
        types = p.get("types", [])
        loc = p.get("location", {})
        plat = loc.get("latitude")
        plng = loc.get("longitude")
        if plat is None or plng is None:
            continue
        dist = _haversine(lat, lng, plat, plng)
        name = p.get("displayName", {}).get("text") or None

        if "public_bathroom" in types:
            # Populate restroom cache as a free side-effect (restrooms widget re-uses this).
            google_restrooms.append({
                "id": f"gplaces:{pid}",
                "name": name,
                "lat": plat,
                "lng": plng,
                "distance": dist,
                "walk_min": max(1, round(dist / 83)),
                "fee": None,           # Google Places doesn't provide fee info
                "opening_hours": None, # nor hours
                "wheelchair": None,    # nor wheelchair access
            })
            # Fall through — still add to pois under Essential Facilities.

        category = next(
            (type_to_category[t] for t in types if t in type_to_category),
            None,
        )
        if not category:
            continue

        # Utility services (bathrooms, ATMs, pharmacies, hospitals) often have
        # few or no user reviews; skip the quality filter for those.
        is_utility = any(t in _UTILITY_TYPES for t in types)
        if not is_utility:
            rating = p.get("rating") or 0.0
            rating_count = p.get("userRatingCount") or 0
            if rating_count < 3 or rating < 3.0:
                continue

        pois.append({
            "id": f"gplaces:{pid}",
            "name": name or "Unknown",
            "lat": plat,
            "lng": plng,
            "distance": dist,
            "category": category,
            "bike_min": max(1, round(dist / 250)),
        })

    # Populate restroom cache as a free side-effect (empty list = Google found none → use OSM)
    _restroom_cache_set(lat, lng, sorted(google_restrooms, key=lambda r: r["distance"]))

    _poi_cache_set(cache_key, pois)
    return pois


@router.get("/transit/poi-nearby")
async def transit_poi_nearby(
    lat: float = Query(..., ge=-90, le=90, description="Latitude of the centre point"),
    lng: float = Query(..., ge=-180, le=180, description="Longitude of the centre point"),
    radius: int = Query(7000, ge=100, le=50000, description="Search radius in metres"),
    limit: int = Query(20, ge=1, le=50, description="Maximum number of POIs to return"),
    lang: str = Query(
        default="de",
        description="BCP-47 language tag for result names (e.g. de, en, fr)",
    ),
):
    """Return all nearby POIs across all categories (Unterhaltung, Restaurant, Shopping),
    sorted nearest-first, up to *limit*.

    All filtering (e.g. by category) is intentionally left to the client so that a
    single Google Places API call covers every category and the frontend can switch
    the active filter without re-fetching.
    """
    settings = get_settings()
    if not settings.google_maps_api_key:
        raise HTTPException(status_code=503, detail="Google Maps API key not configured")

    pois = await _google_places_pois(lat, lng, radius, settings.google_maps_api_key, language=lang)
    pois.sort(key=lambda p: p["distance"])
    return {"pois": pois[:limit]}
