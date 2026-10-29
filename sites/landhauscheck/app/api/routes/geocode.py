"""Geocoding proxy route.

The Google Geocoding REST API does not accept referrer-restricted API keys,
so geocoding must be performed server-side using the unrestricted server key.
"""

import httpx
from fastapi import APIRouter, HTTPException, Query

from app.core.config import get_settings

router = APIRouter()


@router.get("/geocode")
async def geocode(q: str = Query(..., min_length=1, max_length=200)):
    """Forward a geocoding query to Google and return results."""
    settings = get_settings()
    if not settings.google_maps_api_key:
        raise HTTPException(status_code=503, detail="Geocoding not configured")

    url = "https://maps.googleapis.com/maps/api/geocode/json"
    params = {"address": q, "key": settings.google_maps_api_key}

    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(url, params=params)

    if resp.status_code != 200:
        raise HTTPException(status_code=502, detail="Geocoding upstream error")

    data = resp.json()
    status = data.get("status", "ERROR")

    if status == "ZERO_RESULTS":
        return {"status": "ZERO_RESULTS", "results": []}

    if status != "OK":
        raise HTTPException(status_code=502, detail=f"Geocoding error: {status}")

    # Return only the fields the frontend needs
    def extract_country_code(components):
        for c in components:
            if "country" in c.get("types", []):
                return c.get("short_name", "")
        return ""

    results = [
        {
            "formatted_address": r["formatted_address"],
            "lat": r["geometry"]["location"]["lat"],
            "lng": r["geometry"]["location"]["lng"],
            "countryCode": extract_country_code(r.get("address_components", [])),
        }
        for r in data.get("results", [])[:6]
    ]
    return {"status": "OK", "results": results}
