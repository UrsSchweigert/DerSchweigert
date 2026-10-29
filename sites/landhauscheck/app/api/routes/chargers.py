"""EV charging station, gas station, public toilet and ATM search via Google Places."""

import math

import httpx
from fastapi import APIRouter, Query

from app.core.config import get_settings

router = APIRouter()
settings = get_settings()

GOOGLE_PLACES_NEARBY = "https://places.googleapis.com/v1/places:searchNearby"

# Place types that typically have accessible bathrooms (used for poi_type=toilet)
TOILET_PLACE_TYPES = [
    "public_bathroom",
    "fast_food_restaurant",
    "cafe",
    "coffee_shop",
    "gas_station",
]


def _dist_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    R = 6371
    dlat = (lat2 - lat1) * math.pi / 180
    dlng = (lng2 - lng1) * math.pi / 180
    a = (
        math.sin(dlat / 2) ** 2
        + math.cos(lat1 * math.pi / 180)
        * math.cos(lat2 * math.pi / 180)
        * math.sin(dlng / 2) ** 2
    )
    return R * 2 * math.asin(math.sqrt(a))


@router.get("/chargers")
async def get_chargers(
    lat: float = Query(..., ge=-90, le=90, description="Latitude"),
    lng: float = Query(..., ge=-180, le=180, description="Longitude"),
    radius: float = Query(5.0, description="Search radius in km", ge=0.1, le=20),
    poi_type: str = Query(
        "ev",
        description=(
            "'ev' = EV chargers · 'gas' = gas stations · "
            "'toilet' = places with bathrooms · 'atm' = ATMs"
        ),
    ),
):
    """Return nearby places of the requested type via Google Places Nearby Search."""
    if not settings.google_maps_api_key:
        return {"stations": []}

    if poi_type == "gas":
        included_types = ["gas_station"]
        max_results = 8
    elif poi_type == "atm":
        included_types = ["atm"]
        max_results = 10
    elif poi_type == "toilet":
        included_types = TOILET_PLACE_TYPES
        max_results = 12
    else:  # ev (default)
        included_types = ["electric_vehicle_charging_station"]
        max_results = 8

    body = {
        "includedTypes": included_types,
        "maxResultCount": max_results,
        "locationRestriction": {
            "circle": {
                "center": {"latitude": lat, "longitude": lng},
                "radius": radius * 1000,
            }
        },
    }
    headers = {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": settings.google_maps_api_key,
        "X-Goog-FieldMask": (
            "places.id,places.displayName,places.location,"
            "places.currentOpeningHours,places.regularOpeningHours,"
            "places.shortFormattedAddress,places.primaryType"
        ),
    }

    try:
        async with httpx.AsyncClient(timeout=8) as client:
            resp = await client.post(GOOGLE_PLACES_NEARBY, json=body, headers=headers)
            resp.raise_for_status()
    except Exception:
        return {"stations": []}

    stations = []
    for p in resp.json().get("places", []):
        loc = p.get("location", {})
        slat = loc.get("latitude")
        slng = loc.get("longitude")
        if slat is None or slng is None:
            continue

        # Prefer currentOpeningHours (live), fall back to regularOpeningHours
        opening = p.get("currentOpeningHours") or p.get("regularOpeningHours") or {}
        is_open = opening.get("openNow")

        stations.append({
            "id": p.get("id"),
            "name": p.get("displayName", {}).get("text", ""),
            "address": p.get("shortFormattedAddress", ""),
            "lat": slat,
            "lng": slng,
            "isOpen": is_open,
            "distKm": round(_dist_km(lat, lng, slat, slng), 2),
            "primaryType": p.get("primaryType", ""),
        })

    # Sort by distance; return up to 6 for fuel/ev, 8 for toilet/atm
    stations.sort(key=lambda s: s["distKm"])
    limit = 6 if poi_type in ("ev", "gas") else 8
    return {"stations": stations[:limit]}
