"""Production smoke tests — run against a live BASE_URL.

Usage:
    # Against local docker stack:
    BASE_URL=http://localhost:8000 pytest tests/smoke/ -v

    # Against production:
    BASE_URL=https://landhauscheck.com pytest tests/smoke/ -v

All tests are read-only GET requests. No write operations are performed.
Tests are deliberately lenient — they verify contract shape, not exact values,
since external data (weather, transit, Google) changes frequently.
"""

import os

import httpx
import pytest

BASE_URL = os.environ.get("BASE_URL", "http://localhost:8000").rstrip("/")
MUNICH = {"lat": 48.137, "lng": 11.575}
PFAFFENHOFEN = {"lat": 48.3153, "lng": 11.1674}


@pytest.fixture(scope="module")
def api():
    with httpx.Client(base_url=BASE_URL, timeout=15) as client:
        yield client


# ── Health ────────────────────────────────────────────────────────────────────

def test_smoke_health(api):
    r = api.get("/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


# ── Weather ───────────────────────────────────────────────────────────────────

def test_smoke_weather_forecast_munich(api):
    r = api.get("/api/v1/weather/forecast", params=MUNICH)
    assert r.status_code == 200
    data = r.json()
    assert "slots" in data
    assert len(data["slots"]) >= 5  # backend returns all raw slots (≥48); frontend slices to 5
    assert "moonphase" in data
    slot = data["slots"][0]
    assert all(k in slot for k in ("time", "temp", "code", "precip", "is_day"))


def test_smoke_weather_forecast_pfaffenhofen(api):
    r = api.get("/api/v1/weather/forecast", params=PFAFFENHOFEN)
    assert r.status_code == 200
    assert len(r.json()["slots"]) >= 5


# ── Rail-nearby ───────────────────────────────────────────────────────────────

def test_smoke_rail_nearby_munich(api):
    r = api.get("/api/v1/transit/rail-nearby", params={**MUNICH, "radius": 25000, "limit": 5})
    assert r.status_code == 200
    stations = r.json()["stations"]
    assert len(stations) >= 1
    assert any("München" in s["name"] for s in stations), (
        f"Expected München Hbf vicinity — got: {[s['name'] for s in stations]}"
    )


def test_smoke_rail_nearby_pfaffenhofen(api):
    r = api.get("/api/v1/transit/rail-nearby", params={**PFAFFENHOFEN, "radius": 25000, "limit": 5})
    assert r.status_code == 200
    assert len(r.json()["stations"]) >= 1


def test_smoke_rail_nearby_paris_fallback(api):
    """Paris triggers the Google Places fallback — should still return ≥1 result."""
    paris = {"lat": 48.8566, "lng": 2.3522}
    r = api.get("/api/v1/transit/rail-nearby", params={**paris, "radius": 25000, "limit": 5})
    assert r.status_code == 200
    # Paris may or may not return Google results depending on quota — just verify no crash
    assert "stations" in r.json()


# ── POI-nearby ────────────────────────────────────────────────────────────────

def test_smoke_poi_nearby_munich(api):
    r = api.get("/api/v1/transit/poi-nearby", params={**MUNICH, "radius": 7000, "limit": 12})
    assert r.status_code == 200
    pois = r.json()["pois"]
    assert len(pois) >= 1
    poi = pois[0]
    assert all(k in poi for k in ("id", "name", "lat", "lng", "distance", "category"))


def test_smoke_poi_nearby_sorted_by_distance(api):
    r = api.get("/api/v1/transit/poi-nearby", params={**MUNICH, "radius": 7000, "limit": 12})
    assert r.status_code == 200
    distances = [p["distance"] for p in r.json()["pois"]]
    assert distances == sorted(distances), "POIs should be sorted by distance ascending"


def test_smoke_poi_nearby_at_least_two_categories(api):
    r = api.get("/api/v1/transit/poi-nearby", params={**MUNICH, "radius": 7000, "limit": 12})
    assert r.status_code == 200
    categories = {p["category"] for p in r.json()["pois"]}
    assert len(categories) >= 2, f"Expected ≥2 categories, got: {categories}"


# ── Waste ─────────────────────────────────────────────────────────────────────

def test_smoke_waste_pfaffenhofen(api):
    r = api.get("/api/v1/waste/upcoming", params={**PFAFFENHOFEN, "radius": 2000, "count": 5})
    assert r.status_code == 200
    events = r.json()["events"]
    assert len(events) >= 1
    assert all("date" in e and "summary" in e for e in events)


def test_smoke_waste_dietramszell(api):
    r = api.get(
        "/api/v1/waste/upcoming",
        params={"lat": 47.8894, "lng": 11.4967, "radius": 2000, "count": 5},
    )
    assert r.status_code == 200
    assert len(r.json()["events"]) >= 1


def test_smoke_waste_no_match_returns_empty(api):
    paris = {"lat": 48.8566, "lng": 2.3522}
    r = api.get("/api/v1/waste/upcoming", params={**paris, "radius": 2000, "count": 5})
    assert r.status_code == 200
    assert r.json()["events"] == []


# ── Holidays ──────────────────────────────────────────────────────────────────

def test_smoke_holidays_germany(api):
    r = api.get("/api/v1/holidays", params={"country": "DE", "state": "DE-BY"})
    assert r.status_code == 200
    body = r.json()
    holidays = body.get("holidays", body) if isinstance(body, dict) else body
    assert isinstance(holidays, list)
    assert len(holidays) >= 1
    h = holidays[0]
    assert "date" in h and "name" in h


def test_smoke_holidays_france(api):
    r = api.get("/api/v1/holidays", params={"country": "FR"})
    assert r.status_code == 200
    body = r.json()
    holidays = body.get("holidays", body) if isinstance(body, dict) else body
    assert len(holidays) >= 1
