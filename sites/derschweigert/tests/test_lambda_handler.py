import importlib.util
import json
from pathlib import Path


HANDLER_PATH = Path(__file__).resolve().parents[1] / "lambda" / "handler.py"
SPEC = importlib.util.spec_from_file_location("contact_lambda_handler", HANDLER_PATH)
handler = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(handler)


def contact_event(payload):
    return {
        "httpMethod": "POST",
        "path": "/api/contact",
        "body": json.dumps(payload),
    }


def test_contact_submission_returns_410():
    """Contact API is retired and returns 410 Gone."""
    response = handler.lambda_handler(contact_event({
        "name": "Test User",
        "email": "test@example.com",
        "message": "I need help with a project.",
    }), None)

    assert response["statusCode"] == 410


def test_contact_get_request_returns_410():
    """Contact form GET request returns 410."""
    response = handler.lambda_handler({
        "httpMethod": "GET",
        "path": "/api/contact",
    }, None)

    assert response["statusCode"] == 410


def test_admin_pin_verification_works():
    """Admin PIN verification endpoint still works."""
    import os
    admin_pin = os.getenv("ADMIN_PIN", "123456")
    response = handler.lambda_handler({
        "httpMethod": "POST",
        "path": "/api/admin/verify-pin",
        "body": json.dumps({"pin": admin_pin}),
    }, None)
    assert response["statusCode"] == 200
    assert json.loads(response["body"])["ok"] is True


def test_admin_pin_verification_rejects_invalid():
    """Invalid PIN is rejected."""
    response = handler.lambda_handler({
        "httpMethod": "POST",
        "path": "/api/admin/verify-pin",
        "body": json.dumps({"pin": "wrong"}),
    }, None)
    assert response["statusCode"] == 401


def test_unlock_page_available():
    """Unlock page should be available."""
    response = handler.lambda_handler({
        "httpMethod": "GET",
        "path": "/unlock",
        "queryStringParameters": {"next": "/"},
    }, None)
    assert response["statusCode"] == 200
    assert "Seite gesperrt" in response["body"] or "gesperrt" in response["body"]


def test_health_endpoint_available():
    """Health endpoint should be available."""
    response = handler.lambda_handler({
        "httpMethod": "GET",
        "path": "/health",
    }, None)
    assert response["statusCode"] == 200
