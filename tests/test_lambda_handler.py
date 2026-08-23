import importlib.util
import json
from pathlib import Path


HANDLER_PATH = Path(__file__).resolve().parents[1] / "infra" / "lambda" / "handler.py"
SPEC = importlib.util.spec_from_file_location("contact_lambda_handler", HANDLER_PATH)
handler = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(handler)


def contact_event(payload):
    return {
        "httpMethod": "POST",
        "path": "/api/contact",
        "body": json.dumps(payload),
    }


def test_contact_submission_creates_github_issue(monkeypatch):
    created = {}
    monkeypatch.setattr(handler, "_get_github_token", lambda: "token")

    def create_issue(**kwargs):
        created.update(kwargs)
        return {"html_url": "https://github.com/UrsSchweigert/DerSchweigert/issues/1"}

    monkeypatch.setattr(handler, "_create_github_issue", create_issue)

    response = handler.lambda_handler(contact_event({
        "name": "Test User",
        "email": "test@example.com",
        "message": "I need help with a project.",
    }), None)

    assert response["statusCode"] == 200
    assert json.loads(response["body"])["ok"] is True
    assert created["repository"] == "UrsSchweigert/DerSchweigert"
    assert created["email"] == "test@example.com"


def test_contact_submission_rejects_invalid_email():
    response = handler.lambda_handler(contact_event({
        "name": "Test User",
        "email": "not-an-email",
        "message": "I need help with a project.",
    }), None)

    assert response["statusCode"] == 400


def test_contact_submission_reports_delivery_failure(monkeypatch):
    monkeypatch.setattr(handler, "_get_github_token", lambda: (_ for _ in ()).throw(RuntimeError("missing secret")))

    response = handler.lambda_handler(contact_event({
        "name": "Test User",
        "email": "test@example.com",
        "message": "I need help with a project.",
    }), None)

    assert response["statusCode"] == 502


def test_create_github_issue_uses_authenticated_request(monkeypatch):
    captured = {}

    class FakeResponse:
        status = 201

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc_value, traceback):
            return False

        def read(self):
            return b'{"html_url":"https://github.com/UrsSchweigert/DerSchweigert/issues/1"}'

    def fake_urlopen(request, timeout):
        captured["request"] = request
        captured["timeout"] = timeout
        return FakeResponse()

    monkeypatch.setattr(handler, "urlopen", fake_urlopen)

    result = handler._create_github_issue(
        token="token",
        repository="UrsSchweigert/DerSchweigert",
        name="Test User",
        email="test@example.com",
        message="A message",
    )

    assert result["html_url"].endswith("/1")
    assert captured["request"].full_url.endswith("/repos/UrsSchweigert/DerSchweigert/issues")
    assert captured["request"].get_header("Authorization") == "Bearer token"