"""Functional tests for /api/v1/waste/upcoming endpoint."""

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)

PFAFFENHOFEN = {"lat": 48.3153, "lng": 11.1674}
DIETRAMSZELL  = {"lat": 47.8894, "lng": 11.4967}
MUNICH        = {"lat": 48.137,  "lng": 11.575}


def test_waste_pfaffenhofen_returns_events():
    """Pfaffenhofen ICS should match and return upcoming events."""
    r = client.get("/api/v1/waste/upcoming", params={**PFAFFENHOFEN, "radius": 2000, "count": 5})
    assert r.status_code == 200
    data = r.json()
    assert "events" in data
    assert len(data["events"]) >= 1


def test_waste_dietramszell_returns_events():
    """Dietramszell ICS (recently added) should match at its geocoded center."""
    r = client.get("/api/v1/waste/upcoming", params={**DIETRAMSZELL, "radius": 2000, "count": 5})
    assert r.status_code == 200
    data = r.json()
    assert "events" in data
    assert len(data["events"]) >= 1


def test_waste_event_shape():
    r = client.get("/api/v1/waste/upcoming", params={**PFAFFENHOFEN, "radius": 2000, "count": 3})
    assert r.status_code == 200
    events = r.json()["events"]
    assert len(events) >= 1
    for event in events:
        assert "date" in event
        assert "summary" in event


def test_waste_future_dates_only():
    """All returned events must be today or in the future."""
    import datetime
    r = client.get("/api/v1/waste/upcoming", params={**PFAFFENHOFEN, "radius": 2000, "count": 10})
    assert r.status_code == 200
    today = datetime.date.today().isoformat()
    for event in r.json()["events"]:
        assert event["date"] >= today


def test_waste_no_match_returns_empty_events():
    """Far-away location should return empty events list (not an error)."""
    paris = {"lat": 48.8566, "lng": 2.3522}
    r = client.get("/api/v1/waste/upcoming", params={**paris, "radius": 2000, "count": 5})
    assert r.status_code == 200
    assert r.json()["events"] == []


def test_waste_count_respected():
    r = client.get("/api/v1/waste/upcoming", params={**PFAFFENHOFEN, "radius": 2000, "count": 2})
    assert r.status_code == 200
    assert len(r.json()["events"]) <= 2


def test_waste_missing_lat_returns_422():
    r = client.get("/api/v1/waste/upcoming", params={"lng": 11.1674})
    assert r.status_code == 422


def test_waste_response_has_expired_field():
    """All responses must include the 'expired' boolean field."""
    r = client.get("/api/v1/waste/upcoming", params={**PFAFFENHOFEN, "radius": 2000, "count": 5})
    assert r.status_code == 200
    assert "expired" in r.json()


def test_waste_active_calendar_not_expired():
    """A calendar with future events must have expired=False."""
    r = client.get("/api/v1/waste/upcoming", params={**PFAFFENHOFEN, "radius": 2000, "count": 5})
    assert r.status_code == 200
    data = r.json()
    assert data["expired"] is False
    assert len(data["events"]) >= 1


def test_waste_no_match_not_expired():
    """A no-match response (no calendar within radius) must have expired=False."""
    paris = {"lat": 48.8566, "lng": 2.3522}
    r = client.get("/api/v1/waste/upcoming", params={**paris, "radius": 2000, "count": 5})
    assert r.status_code == 200
    data = r.json()
    assert data["location"] is None
    assert data["expired"] is False
