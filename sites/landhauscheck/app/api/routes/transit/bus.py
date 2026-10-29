"""HERE Transit bus/station endpoints.

Routes
------
GET /transit/nearby     -- Find transit stations near a coordinate via HERE Stations API.
GET /transit/departures -- Upcoming departures for one or more HERE station IDs.
"""

import time

import httpx
from fastapi import APIRouter, HTTPException, Query

from app.core.config import get_settings

from ._shared import HERE_TRANSIT_DEPARTURES, HERE_TRANSIT_STATIONS

router = APIRouter()

_DEPARTURE_CACHE: dict[str, tuple[float, dict]] = {}
_DEP_CACHE_TTL = 300  # seconds — departures are time-sensitive, but stable for ~5 min


@router.get("/transit/nearby")
async def transit_nearby(
    lat: float = Query(..., ge=-90, le=90, description="Latitude of the centre point"),
    lng: float = Query(..., ge=-180, le=180, description="Longitude of the centre point"),
    radius: int = Query(750, ge=50, le=20000, description="Search radius in metres"),
):
    settings = get_settings()
    if not settings.here_api_key:
        raise HTTPException(status_code=503, detail="HERE API key is not configured on the server.")

    params = {
        "in": f"{lat},{lng};r={radius}",
        "apikey": settings.here_api_key,
    }

    async with httpx.AsyncClient(timeout=10.0) as client:
        try:
            response = await client.get(HERE_TRANSIT_STATIONS, params=params)
        except httpx.RequestError as exc:
            raise HTTPException(status_code=502, detail=f"Upstream request failed: {exc}") from exc

    if response.status_code != 200:
        raise HTTPException(
            status_code=response.status_code,
            detail=f"HERE Transit API error: {response.text[:200]}",
        )

    return response.json()


@router.get("/transit/departures")
async def transit_departures(
    ids: str = Query(
        ...,
        description="Comma-separated HERE station IDs",
        max_length=512,
        pattern=r"^[\w,\-]+$",
    ),
):
    """Return upcoming departures for one or more stations.

    The transport.mode integers on each departure are used by the frontend
    to render mode badges on each stop.
    """
    settings = get_settings()
    if not settings.here_api_key:
        raise HTTPException(status_code=503, detail="HERE API key is not configured on the server.")

    cache_key = ",".join(sorted(ids.split(",")))
    cached = _DEPARTURE_CACHE.get(cache_key)
    if cached and time.monotonic() - cached[0] < _DEP_CACHE_TTL:
        return cached[1]

    params = {
        "ids": ids,
        "apikey": settings.here_api_key,
    }

    async with httpx.AsyncClient(timeout=10.0) as client:
        try:
            response = await client.get(HERE_TRANSIT_DEPARTURES, params=params)
        except httpx.RequestError as exc:
            raise HTTPException(status_code=502, detail=f"Upstream request failed: {exc}") from exc

    if response.status_code != 200:
        raise HTTPException(
            status_code=response.status_code,
            detail=f"HERE Transit API error: {response.text[:200]}",
        )

    result = response.json()
    _DEPARTURE_CACHE[cache_key] = (time.monotonic(), result)
    return result
