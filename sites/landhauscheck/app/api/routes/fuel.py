"""Proxy route for Tankerkönig fuel price API (Germany).

Tankerkönig is an official reseller of MTS-K government data (mandatory
real-time price reporting by German law). Prices update every few minutes.

API docs: https://creativecommons.tankerkoenig.de/
Free tier: 10,000 requests/day.

The API key is stored in Secrets Manager and injected via TANKERKOENIG_API_KEY
env var. It is never exposed to the browser.
"""

import httpx
from fastapi import APIRouter, HTTPException, Query

from app.core.config import get_settings

router = APIRouter()

TANKERKOENIG_URL = "https://creativecommons.tankerkoenig.de/json/list.php"


@router.get("/fuel")
async def get_fuel_prices(
    lat: float = Query(..., ge=-90, le=90, description="Centre latitude"),
    lng: float = Query(..., ge=-180, le=180, description="Centre longitude"),
    radius: float = Query(5.0, ge=0.5, le=25.0, description="Search radius in km (max 25)"),
):
    """Return nearby petrol stations with live diesel / E10 / E5 prices.

    Proxies Tankerkönig list endpoint server-side so the API key is never
    exposed in the browser bundle.

    Response shape per station:
    {
      "id": str,
      "name": str,
      "brand": str,
      "lat": float,
      "lng": float,
      "dist": float,          # km from query centre
      "isOpen": bool,
      "diesel": float | null,
      "e10": float | null,
      "e5": float | null
    }
    """
    settings = get_settings()
    api_key = settings.tankerkoenig_api_key

    if not api_key:
        raise HTTPException(
            status_code=503,
            detail="Fuel price service is not configured (TANKERKOENIG_API_KEY missing).",
        )

    params = {
        "lat": lat,
        "lng": lng,
        "rad": radius,
        "sort": "dist",
        "type": "all",
        "apikey": api_key,
    }

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(TANKERKOENIG_URL, params=params)
            resp.raise_for_status()
            data = resp.json()
    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail="Tankerkönig API timed out.")
    except httpx.HTTPStatusError as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Tankerkönig API error: {exc.response.status_code}",
        )

    if not data.get("ok"):
        raise HTTPException(
            status_code=502,
            detail=f"Tankerkönig API returned ok=false: {data.get('message', 'unknown error')}",
        )

    stations = [
        {
            "id":      s.get("id", ""),
            "name":    s.get("name", ""),
            "brand":   s.get("brand", ""),
            "lat":     s.get("lat"),
            "lng":     s.get("lng"),
            "dist":    round(s.get("dist", 0), 2),
            "isOpen":  s.get("isOpen", False),
            "diesel":  s.get("diesel"),
            "e10":     s.get("e10"),
            "e5":      s.get("e5"),
        }
        for s in data.get("stations", [])
    ]

    return {"stations": stations, "count": len(stations)}
