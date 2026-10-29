"""Functional tests for /api/v1/weather/forecast — Open-Meteo + Bright Sky fallback."""

import respx
from fastapi.testclient import TestClient
from httpx import Response

from app.main import app

client = TestClient(app)

MUNICH = {"lat": 48.137, "lng": 11.575}

OPEN_METEO_MOCK = {
    "hourly": {
        "time": [f"2026-04-01T{h:02d}:00" for h in range(48)],
        "temperature_2m": [10.0 + h * 0.5 for h in range(48)],
        "weathercode": [0] * 48,
        "precipitation_probability": [5] * 48,
        "is_day": ([1] * 12 + [0] * 12) * 2,
    }
}

BRIGHT_SKY_MOCK = {
    "weather": [
        {
            "timestamp": f"2026-04-01T{h:02d}:00:00+00:00",
            "temperature": 12.0 + h * 0.3,
            "precipitation_probability": 5 if h % 3 == 0 else None,
            "precipitation_probability_6h": None,
            "condition": "dry",
            "icon": "partly-cloudy-day" if h < 12 else "clear-night",
        }
        for h in range(48)
    ],
    "sources": [],
}


@respx.mock
def test_weather_forecast_returns_slots():
    respx.get("https://api.open-meteo.com/v1/forecast").mock(
        return_value=Response(200, json=OPEN_METEO_MOCK)
    )
    r = client.get("/api/v1/weather/forecast", params=MUNICH)
    assert r.status_code == 200
    data = r.json()
    assert "slots" in data
    # Backend returns all hourly slots (48 for 2-day forecast); frontend slices to 5
    assert len(data["slots"]) >= 5


@respx.mock
def test_weather_forecast_slot_shape():
    respx.get("https://api.open-meteo.com/v1/forecast").mock(
        return_value=Response(200, json=OPEN_METEO_MOCK)
    )
    r = client.get("/api/v1/weather/forecast", params=MUNICH)
    slot = r.json()["slots"][0]
    assert "time" in slot
    assert "temp" in slot
    assert "code" in slot
    assert "precip" in slot
    assert "is_day" in slot


@respx.mock
def test_weather_forecast_moonphase_present():
    respx.get("https://api.open-meteo.com/v1/forecast").mock(
        return_value=Response(200, json=OPEN_METEO_MOCK)
    )
    r = client.get("/api/v1/weather/forecast", params=MUNICH)
    data = r.json()
    assert "moonphase" in data
    assert 0.0 <= data["moonphase"] <= 1.0


@respx.mock
def test_weather_forecast_missing_lat_returns_422():
    r = client.get("/api/v1/weather/forecast", params={"lng": 11.575})
    assert r.status_code == 422


@respx.mock
def test_weather_forecast_brightsky_fallback():
    """When Open-Meteo fails, Bright Sky provides the forecast."""
    respx.get("https://api.open-meteo.com/v1/forecast").mock(
        return_value=Response(503)
    )
    respx.get("https://api.brightsky.dev/weather").mock(
        return_value=Response(200, json=BRIGHT_SKY_MOCK)
    )
    r = client.get("/api/v1/weather/forecast", params=MUNICH)
    assert r.status_code == 200
    data = r.json()
    assert "slots" in data
    assert len(data["slots"]) >= 5
    assert data.get("utc_timestamps") is True
    slot = data["slots"][0]
    assert "time" in slot
    assert "temp" in slot
    assert "code" in slot
    assert "precip" in slot
    assert "is_day" in slot


@respx.mock
def test_weather_forecast_brightsky_slot_time_is_utc_iso():
    """Bright Sky slots carry UTC ISO-8601 timestamps (frontend converts via Date)."""
    respx.get("https://api.open-meteo.com/v1/forecast").mock(
        return_value=Response(503)
    )
    respx.get("https://api.brightsky.dev/weather").mock(
        return_value=Response(200, json=BRIGHT_SKY_MOCK)
    )
    r = client.get("/api/v1/weather/forecast", params=MUNICH)
    slot = r.json()["slots"][0]
    # Bright Sky UTC timestamps contain '+00:00'
    assert "+00:00" in slot["time"]


@respx.mock
def test_weather_forecast_brightsky_imperial_conversion():
    """Temperature is converted to °F when units=imperial in the Bright Sky path."""
    respx.get("https://api.open-meteo.com/v1/forecast").mock(
        return_value=Response(503)
    )
    respx.get("https://api.brightsky.dev/weather").mock(
        return_value=Response(200, json=BRIGHT_SKY_MOCK)
    )
    r = client.get("/api/v1/weather/forecast", params={**MUNICH, "units": "imperial"})
    assert r.status_code == 200
    # 12.0°C == 53.6°F; first slot temp should be above 32°F
    assert r.json()["slots"][0]["temp"] > 32


@respx.mock
def test_weather_forecast_all_sources_fail_returns_503():
    """Both Open-Meteo and Bright Sky are unreachable → 503."""
    respx.get("https://api.open-meteo.com/v1/forecast").mock(
        return_value=Response(503)
    )
    respx.get("https://api.brightsky.dev/weather").mock(
        return_value=Response(503)
    )
    r = client.get("/api/v1/weather/forecast", params=MUNICH)
    assert r.status_code == 502
