"""Weather forecast proxy — Open-Meteo (primary) with Bright Sky / DWD fallback.

Primary:  Open-Meteo  (free, global, no key).
Fallback: Bright Sky  (free, DWD data, no key, best coverage: Central Europe).

On any Open-Meteo error (HTTP or network) the request is retried against
Bright Sky transparently.  The fallback response is tagged with
``utc_timestamps: true`` so the frontend uses Date-based local-time matching
instead of the local-prefix string matching that Open-Meteo's tz-local times allow.
"""

import datetime

import httpx
from fastapi import APIRouter, HTTPException, Query

router = APIRouter()

OPEN_METEO_URL  = "https://api.open-meteo.com/v1/forecast"
BRIGHT_SKY_URL  = "https://api.brightsky.dev/weather"

# Maps Bright Sky icon strings to WMO weather interpretation codes.
# Bright Sky icons: clear-day, clear-night, partly-cloudy-day, partly-cloudy-night,
#                   cloudy, fog, wind, rain, sleet, snow, hail, thunderstorm
_ICON_TO_WMO: dict[str, int] = {
    "clear-day":           0,   # Clear sky
    "clear-night":         0,
    "partly-cloudy-day":   2,   # Partly cloudy
    "partly-cloudy-night": 2,
    "cloudy":              3,   # Overcast
    "fog":                 45,  # Fog
    "wind":                0,   # Windy but clear
    "rain":                61,  # Rain: slight
    "sleet":               67,  # Freezing rain: heavy
    "snow":                71,  # Snow fall: slight
    "hail":                96,  # Thunderstorm with hail
    "thunderstorm":        95,  # Thunderstorm
}


def _moonphase(date: datetime.date) -> float:
    """Return moon phase as 0–1 (0=new, 0.25=first quarter, 0.5=full, 0.75=last)."""
    # Known new moon reference: 2000-01-06
    ref = datetime.date(2000, 1, 6)
    days_since = (date - ref).days
    cycle = 29.53058867  # mean synodic month
    return (days_since % cycle) / cycle


async def _fetch_brightsky(
    lat: float, lng: float, units: str, client: httpx.AsyncClient
) -> dict:
    """Fetch forecast from Bright Sky (DWD) and return in our standard slot format.

    Bright Sky timestamps are UTC ISO-8601 strings
    (e.g. ``"2026-04-07T09:00:00+00:00"``).  The response is tagged with
    ``utc_timestamps: true`` so the frontend converts them to local-time strings
    via the browser's Date API instead of the plain string-prefix matching used
    for Open-Meteo's already-local timestamps.
    """
    today = datetime.date.today()
    last  = today + datetime.timedelta(days=2)
    r = await client.get(BRIGHT_SKY_URL, params={
        "lat":       lat,
        "lon":       lng,
        "date":      today.isoformat(),
        "last_date": last.isoformat(),
    })
    r.raise_for_status()
    data = r.json()

    slots = []
    for entry in data.get("weather", []):
        icon = entry.get("icon") or ""
        temp = entry.get("temperature")
        if temp is None:
            continue
        if units == "imperial":
            temp = round(temp * 9 / 5 + 32, 1)
        # Prefer hourly probability; fall back to 6-hour bucket; default to 0.
        prob = entry.get("precipitation_probability")
        if prob is None:
            prob = entry.get("precipitation_probability_6h") or 0
        slots.append({
            "time":   entry["timestamp"],   # UTC ISO-8601, e.g. "2026-04-07T09:00:00+00:00"
            "temp":   temp,
            "code":   _ICON_TO_WMO.get(icon, 0),
            "precip": prob,
            "is_day": 0 if "night" in icon else 1,
        })

    return {
        "slots":          slots,
        "timezone":       "UTC",
        "moonphase":      round(_moonphase(today), 4),
        "utc_timestamps": True,   # tells frontend to use Date() for slot matching
    }


@router.get("/weather/forecast")
async def weather_forecast(
    lat: float = Query(..., ge=-90, le=90),
    lng: float = Query(..., ge=-180, le=180),
    units: str = Query("metric", pattern="^(metric|imperial)$"),
):
    """Return hourly forecast for the next 48 h.

    Tries Open-Meteo first.  Falls back to Bright Sky / DWD on any error.
    """
    params = {
        "latitude":  lat,
        "longitude": lng,
        "hourly":    "temperature_2m,weathercode,precipitation_probability,is_day",
        "forecast_days": 2,
        "timezone":  "auto",
    }
    if units == "imperial":
        params["temperature_unit"] = "fahrenheit"
        params["wind_speed_unit"]  = "mph"

    # ── Primary: Open-Meteo ───────────────────────────────────────────────────
    open_meteo_data = None
    try:
        async with httpx.AsyncClient(timeout=8) as client:
            r = await client.get(OPEN_METEO_URL, params=params)
            r.raise_for_status()
            open_meteo_data = r.json()
    except (httpx.HTTPStatusError, httpx.RequestError):
        pass  # fall through to Bright Sky below

    if open_meteo_data is not None:
        hourly = open_meteo_data.get("hourly", {})
        times  = hourly.get("time", [])
        temps  = hourly.get("temperature_2m", [])
        codes  = hourly.get("weathercode", [])
        precip = hourly.get("precipitation_probability", [])
        is_day = hourly.get("is_day", [])
        slots = [
            {
                "time":   times[i],
                "temp":   temps[i],
                "code":   codes[i],
                "precip": precip[i],
                "is_day": is_day[i] if i < len(is_day) else 1,
            }
            for i in range(len(times))
        ]
        return {
            "slots":     slots,
            "timezone":  open_meteo_data.get("timezone", "UTC"),
            "moonphase": round(_moonphase(datetime.date.today()), 4),
        }

    # ── Fallback: Bright Sky (DWD) ────────────────────────────────────────────
    try:
        async with httpx.AsyncClient(timeout=8) as client:
            return await _fetch_brightsky(lat, lng, units, client)
    except httpx.HTTPStatusError as exc:
        raise HTTPException(status_code=502, detail="weather service error") from exc
    except httpx.RequestError as exc:
        raise HTTPException(status_code=503, detail="weather service unreachable") from exc


NAGER_URL = "https://date.nager.at/api/v3/PublicHolidays/{year}/{country}"


@router.get("/holidays")
async def get_holidays(
    year: int = Query(default=None, ge=2020, le=2100),
    country: str = Query(
        default="DE",
        min_length=2,
        max_length=2,
        description="ISO 3166-1 alpha-2 country code",
    ),
    state: str = Query(
        default=None,
        max_length=5,
        description="State/subdivision code, only used for DE (e.g. BY)",
    ),
):
    """Return public holidays for a given country/year from nager.date.

    For Germany (*country=DE*), pass *state* (e.g. ``BY``) to include
    state-specific holidays in addition to national ones.
    """
    if year is None:
        year = datetime.date.today().year
    url = NAGER_URL.format(year=year, country=country.upper())
    try:
        async with httpx.AsyncClient(timeout=8) as client:
            r = await client.get(url)
            r.raise_for_status()
            data = r.json()
    except httpx.HTTPStatusError as exc:
        raise HTTPException(status_code=502, detail="nager.date error") from exc
    except httpx.RequestError as exc:
        raise HTTPException(status_code=503, detail="nager.date unreachable") from exc

    # State filtering only makes sense for DE (other countries use different subdivision systems)
    country_upper = country.upper()
    state_code = f"{country_upper}-{state.upper()}" if state and country_upper == "DE" else None
    holidays = []
    for h in data:
        counties = h.get("counties")
        if counties is None:
            holidays.append({"date": h["date"], "name": h["localName"]})
        elif state_code and state_code in counties:
            holidays.append({"date": h["date"], "name": h["localName"]})
        elif not state_code and counties is not None:
            # Non-DE or no state specified: include all regional holidays too
            if country_upper != "DE":
                holidays.append({"date": h["date"], "name": h["localName"]})

    return {"year": year, "country": country_upper, "holidays": holidays}
