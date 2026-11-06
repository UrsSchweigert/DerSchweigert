"""Tests for the PIN-protected CloudWatch logs endpoint."""

from fastapi.testclient import TestClient

from app.api.routes import logs
from app.main import app

client = TestClient(app)


def test_logs_requires_the_stats_pin(monkeypatch) -> None:
    """Anonymous callers must not be able to read backend logs."""

    def unexpected_fetch(_minutes: int) -> list:
        raise AssertionError("CloudWatch must not be queried without a PIN")

    monkeypatch.setattr(logs, "_fetch_cloudwatch_logs", unexpected_fetch)
    assert client.get("/api/v1/logs").status_code == 401


def test_logs_rejects_a_wrong_pin(monkeypatch) -> None:
    """A non-matching PIN is refused."""

    def unexpected_fetch(_minutes: int) -> list:
        raise AssertionError("CloudWatch must not be queried with a wrong PIN")

    monkeypatch.setattr(logs, "_fetch_cloudwatch_logs", unexpected_fetch)
    assert client.get("/api/v1/logs", headers={"X-Stats-Pin": "wrong-pin"}).status_code == 401


def test_logs_returns_events_for_the_correct_pin(monkeypatch) -> None:
    """Authorized callers receive the requested events without contacting AWS."""

    events = [{"message": "test event"}]
    requested_minutes = []

    def fake_fetch(minutes: int) -> list:
        requested_minutes.append(minutes)
        return events

    monkeypatch.setattr(logs, "_fetch_cloudwatch_logs", fake_fetch)
    response = client.get("/api/v1/logs?minutes=15", headers={"X-Stats-Pin": "test-pin-000000"})

    assert response.status_code == 200
    assert response.json() == events
    assert requested_minutes == [15]
