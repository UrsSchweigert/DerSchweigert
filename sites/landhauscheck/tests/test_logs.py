"""Tests for the PIN-protected CloudWatch logs endpoint."""

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_logs_requires_the_stats_pin() -> None:
    """Anonymous callers must not be able to read backend logs."""

    assert client.get("/api/v1/logs").status_code == 401


def test_logs_rejects_a_wrong_pin() -> None:
    """A non-matching PIN is refused."""

    assert client.get("/api/v1/logs", headers={"X-Stats-Pin": "wrong-pin"}).status_code == 401


def test_logs_returns_events_for_the_correct_pin() -> None:
    """With the right PIN the endpoint answers (empty without AWS credentials)."""

    response = client.get("/api/v1/logs", headers={"X-Stats-Pin": "test-pin-000000"})

    assert response.status_code == 200
    assert response.json() == []
