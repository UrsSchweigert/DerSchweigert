import importlib.util
import json
import os
from pathlib import Path
from urllib.parse import quote


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
    admin_pin = os.environ["ADMIN_PIN"]
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


def test_unlock_page_escapes_next_in_the_hidden_field():
    """next is HTML-escaped, so it cannot break out of the value attribute."""
    response = handler.lambda_handler({
        "httpMethod": "GET",
        "path": "/unlock",
        "queryStringParameters": {"next": '"><script>alert(1)</script>'},
    }, None)

    assert response["statusCode"] == 200
    assert "<script>alert(1)</script>" not in response["body"]
    assert "&quot;&gt;&lt;script&gt;" in response["body"]


def test_failed_unlock_does_not_reinject_markup():
    """The error branch re-renders next from the POST body, so it must escape too."""
    response = handler.lambda_handler({
        "httpMethod": "POST",
        "path": "/unlock",
        "headers": {"content-type": "application/x-www-form-urlencoded"},
        "body": "pin=wrong&next=" + quote('"><script>alert(1)</script>', safe=""),
    }, None)

    assert response["statusCode"] == 200
    assert "<script>alert(1)</script>" not in response["body"]


def test_unlock_submit_refuses_a_cross_site_redirect():
    """Only a same-site path is a valid post-unlock destination."""
    admin_pin = os.environ["ADMIN_PIN"]
    for hostile in ("https://example.com/", "//example.com/", "/\\example.com", "javascript:alert(1)"):
        response = handler.lambda_handler({
            "httpMethod": "POST",
            "path": "/unlock",
            "headers": {"content-type": "application/x-www-form-urlencoded"},
            "body": f"pin={quote(admin_pin, safe='')}&next={quote(hostile, safe='')}",
        }, None)

        assert response["statusCode"] == 302, hostile
        assert response["headers"]["Location"] == "/", hostile


def test_unlock_submit_keeps_a_same_site_path():
    """A legitimate local path still survives the redirect check."""
    response = handler.lambda_handler({
        "httpMethod": "POST",
        "path": "/unlock",
        "headers": {"content-type": "application/x-www-form-urlencoded"},
        "body": f"pin={quote(os.environ['ADMIN_PIN'], safe='')}&next=%2Fadmin",
    }, None)

    assert response["headers"]["Location"] == "/admin"
