"""Tests for the stats endpoint."""

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_stats_endpoint_returns_expected_shape() -> None:
    """Stats endpoint should return the expected top-level keys."""

    response = client.get("/api/v1/admin/stats", headers={"X-Stats-Pin": "test-pin-000000"})

    assert response.status_code == 200
    payload = response.json()

    assert "total_requests" in payload
    assert "sessions_total" in payload
    assert "started_at" in payload
    assert isinstance(payload["total_requests"], int)
    assert isinstance(payload["sessions_total"], int)
