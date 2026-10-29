"""Functional tests for transit endpoints (rail-nearby, poi-nearby, departures)."""

import respx
from fastapi.testclient import TestClient
from httpx import Response

from app.main import app

client = TestClient(app)

MUNICH = {"lat": 48.137, "lng": 11.575}
PFAFFENHOFEN = {"lat": 48.3153, "lng": 11.1674}

# ── rail-nearby ──────────────────────────────────────────────────────────────

def test_rail_nearby_returns_stations_for_munich():
    """Munich is well-covered by the DB snapshot — should return ≥1 station."""
    r = client.get("/api/v1/transit/rail-nearby", params={**MUNICH, "radius": 25000, "limit": 5})
    assert r.status_code == 200
    data = r.json()
    assert "stations" in data
    stations = data["stations"]
    assert len(stations) >= 1


def test_rail_nearby_station_shape():
    r = client.get("/api/v1/transit/rail-nearby", params={**MUNICH, "radius": 25000, "limit": 3})
    assert r.status_code == 200
    for s in r.json()["stations"]:
        assert "id" in s
        assert "name" in s
        assert "lat" in s
        assert "lng" in s
        assert "distance" in s
        assert "railway" in s


def test_rail_nearby_respects_limit():
    r = client.get("/api/v1/transit/rail-nearby", params={**MUNICH, "radius": 25000, "limit": 2})
    assert r.status_code == 200
    assert len(r.json()["stations"]) <= 2


def test_rail_nearby_distance_within_radius():
    radius = 25000
    r = client.get("/api/v1/transit/rail-nearby", params={**MUNICH, "radius": radius, "limit": 10})
    assert r.status_code == 200
    for s in r.json()["stations"]:
        assert s["distance"] <= radius


def test_rail_nearby_missing_lat_returns_422():
    r = client.get("/api/v1/transit/rail-nearby", params={"lng": 11.575})
    assert r.status_code == 422


def test_rail_nearby_pfaffenhofen_covered():
    """Pfaffenhofen an der Glonn should be within reach of a station."""
    params = {**PFAFFENHOFEN, "radius": 25000, "limit": 5}
    r = client.get("/api/v1/transit/rail-nearby", params=params)
    assert r.status_code == 200
    assert len(r.json()["stations"]) >= 1


# ── poi-nearby ────────────────────────────────────────────────────────────────

@respx.mock
def test_poi_nearby_returns_pois():
    """Mock Google Places — verify shape and category grouping."""
    mock_place = {
        "id": "ChIJ_test",
        "displayName": {"text": "Deutsches Museum"},
        "location": {"latitude": 48.130, "longitude": 11.583},
        "types": ["museum"],
        "rating": 4.7,
        "userRatingCount": 25000,
    }
    respx.post("https://places.googleapis.com/v1/places:searchNearby").mock(
        return_value=Response(200, json={"places": [mock_place]})
    )
    r = client.get(
        "/api/v1/transit/poi-nearby",
        params={**MUNICH, "radius": 7000, "limit": 12},
        headers={"Accept-Language": "de"},
    )
    assert r.status_code == 200
    data = r.json()
    assert "pois" in data
    assert isinstance(data["pois"], list)


@respx.mock
def test_poi_nearby_poi_shape():
    mock_place = {
        "id": "ChIJ_test2",
        "displayName": {"text": "REWE City"},
        "location": {"latitude": 48.150, "longitude": 11.461},
        "types": ["supermarket"],
        "rating": 4.2,
        "userRatingCount": 1800,
    }
    respx.post("https://places.googleapis.com/v1/places:searchNearby").mock(
        return_value=Response(200, json={"places": [mock_place]})
    )
    r = client.get("/api/v1/transit/poi-nearby", params={**MUNICH, "radius": 7000, "limit": 12})
    assert r.status_code == 200
    pois = r.json()["pois"]
    if pois:
        poi = pois[0]
        assert "id" in poi
        assert "name" in poi
        assert "lat" in poi
        assert "lng" in poi
        assert "distance" in poi
        assert "category" in poi


@respx.mock
def test_poi_nearby_google_error_returns_empty_not_500():
    """If Google Places returns an error, endpoint should return empty list, not crash."""
    # Clear both in-memory caches so a previous test's cached result doesn't bleed through.
    from app.api.routes.transit import _cache as _transit_cache
    _transit_cache._POI_CACHE.clear()
    _transit_cache._RESTROOM_CACHE.clear()

    respx.post("https://places.googleapis.com/v1/places:searchNearby").mock(
        return_value=Response(500)
    )
    r = client.get("/api/v1/transit/poi-nearby", params={**MUNICH, "radius": 7000, "limit": 12})
    assert r.status_code == 200
    assert r.json()["pois"] == []


def test_poi_nearby_missing_lat_returns_422():
    r = client.get("/api/v1/transit/poi-nearby", params={"lng": 11.575})
    assert r.status_code == 422


# ── departures ────────────────────────────────────────────────────────────────

@respx.mock
def test_departures_proxies_here_response():
    mock_response = {"boards": [{"place": {"name": "München Hbf"}, "departures": []}]}
    respx.get("https://transit.router.hereapi.com/v8/departures").mock(
        return_value=Response(200, json=mock_response)
    )
    station_id = "276u33db-b845add3dc034ca6bfb4e8ab09c89b4"
    r = client.get("/api/v1/transit/departures", params={"ids": station_id})
    assert r.status_code == 200
    assert "boards" in r.json()


@respx.mock
def test_departures_here_error_propagates():
    respx.get("https://transit.router.hereapi.com/v8/departures").mock(
        return_value=Response(401, json={"error": "Unauthorized"})
    )
    r = client.get("/api/v1/transit/departures", params={"ids": "fake_id"})
    assert r.status_code in (401, 503)


# ── restrooms-nearby ─────────────────────────────────────────────────────────

OVERPASS_URL = "https://overpass-api.de/api/interpreter"

MOCK_OVERPASS_RESPONSE = {
    "elements": [
        {
            "type": "node",
            "id": 123456789,
            "lat": 48.138,
            "lon": 11.576,
            "tags": {
                "amenity": "toilets",
                "access": "yes",
                "fee": "no",
                "wheelchair": "yes",
                "opening_hours": "Mo-Su 07:00-22:00",
                "name": "Marienplatz WC",
            },
        },
        {
            "type": "node",
            "id": 987654321,
            "lat": 48.136,
            "lon": 11.574,
            "tags": {
                "amenity": "toilets",
                "fee": "yes",
            },
        },
    ]
}


@respx.mock
def test_restrooms_nearby_returns_list():
    respx.post(OVERPASS_URL).mock(return_value=Response(200, json=MOCK_OVERPASS_RESPONSE))
    r = client.get(
        "/api/v1/transit/restrooms-nearby", params={**MUNICH, "radius": 1500, "limit": 5}
    )
    assert r.status_code == 200
    data = r.json()
    assert "restrooms" in data
    assert "source" in data
    assert len(data["restrooms"]) == 2


@respx.mock
def test_restrooms_nearby_shape():
    respx.post(OVERPASS_URL).mock(return_value=Response(200, json=MOCK_OVERPASS_RESPONSE))
    r = client.get(
        "/api/v1/transit/restrooms-nearby", params={**MUNICH, "radius": 1500, "limit": 5}
    )
    assert r.status_code == 200
    for item in r.json()["restrooms"]:
        assert "id" in item
        assert "lat" in item
        assert "lng" in item
        assert "distance" in item
        assert "walk_min" in item
        assert isinstance(item["fee"], bool)
        assert isinstance(item["wheelchair"], bool)


@respx.mock
def test_restrooms_nearby_respects_limit():
    respx.post(OVERPASS_URL).mock(return_value=Response(200, json=MOCK_OVERPASS_RESPONSE))
    r = client.get(
        "/api/v1/transit/restrooms-nearby", params={**MUNICH, "radius": 1500, "limit": 1}
    )
    assert r.status_code == 200
    assert len(r.json()["restrooms"]) == 1


@respx.mock
def test_restrooms_nearby_fee_and_wheelchair_parsed():
    respx.post(OVERPASS_URL).mock(return_value=Response(200, json=MOCK_OVERPASS_RESPONSE))
    r = client.get(
        "/api/v1/transit/restrooms-nearby", params={**MUNICH, "radius": 1500, "limit": 5}
    )
    items = r.json()["restrooms"]
    named = next(i for i in items if i.get("name") == "Marienplatz WC")
    assert named["wheelchair"] is True
    assert named["fee"] is False
    assert named["opening_hours"] == "Mo-Su 07:00-22:00"


@respx.mock
def test_restrooms_nearby_overpass_error_returns_empty():
    from unittest.mock import patch
    respx.post(OVERPASS_URL).mock(return_value=Response(503, text="Service Unavailable"))
    with patch("app.api.routes.transit.restrooms._restroom_cache_get", return_value=None):
        r = client.get("/api/v1/transit/restrooms-nearby", params={**MUNICH, "radius": 1500})
    assert r.status_code == 200
    assert r.json()["restrooms"] == []


def test_restrooms_nearby_uses_google_cache_when_warm():
    """When Google cache is warm (POI query ran first), Overpass is never called."""
    from unittest.mock import patch

    google_result = [{
        "id": "gplaces:abc",
        "name": "Bahnhof WC",
        "lat": 48.138,
        "lng": 11.576,
        "distance": 200,
        "walk_min": 3,
        "fee": None,
        "opening_hours": None,
        "wheelchair": None,
    }]
    with patch("app.api.routes.transit.restrooms._restroom_cache_get", return_value=google_result):
        r = client.get("/api/v1/transit/restrooms-nearby",
                       params={**MUNICH, "radius": 1500, "limit": 5, "source": "google"})
    assert r.status_code == 200
    data = r.json()
    assert data["source"] == "google_cached"
    assert len(data["restrooms"]) == 1
    assert data["restrooms"][0]["name"] == "Bahnhof WC"


@respx.mock
def test_restrooms_nearby_google_direct_fallback():
    """When all Overpass mirrors fail, endpoint falls back to direct Google Places query."""
    from unittest.mock import patch

    # All Overpass mirrors fail → respx raises ConnectError for unmocked URLs
    # (overpass-api.de, kumi.systems, openstreetmap.ru are all unmocked)
    google_response = {
        "places": [{
            "id": "gplaces:xyz",
            "displayName": {"text": "S-Bahn WC"},
            "location": {"latitude": 48.139, "longitude": 11.577},
            "types": ["public_bathroom"],
        }]
    }
    respx.post("https://places.googleapis.com/v1/places:searchNearby").mock(
        return_value=Response(200, json=google_response)
    )
    with patch("app.api.routes.transit.restrooms._restroom_cache_get", return_value=None):
        r = client.get("/api/v1/transit/restrooms-nearby", params={**MUNICH, "radius": 1500})
    assert r.status_code == 200
    data = r.json()
    assert data["source"] == "google"
    assert len(data["restrooms"]) >= 1
    assert data["restrooms"][0]["name"] == "S-Bahn WC"
