"""Backend API tests for Step 1 endpoints."""

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_health_endpoint_returns_ok_status() -> None:
    """Health endpoint should expose a stable status contract."""

    response = client.get("/health")

    assert response.status_code == 200
    payload = response.json()

    assert payload["status"] == "ok"
    assert payload["service"] == "backend"
    assert "timestamp" in payload
