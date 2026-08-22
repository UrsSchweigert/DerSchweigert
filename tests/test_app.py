from fastapi.testclient import TestClient

from app.main import app


client = TestClient(app)


def test_homepage_renders():
    response = client.get("/")
    assert response.status_code == 200
    assert "AmSonnenhang" in response.text or "Portfolio" in response.text


def test_contact_form_accepts_payload():
    payload = {
        "name": "Test User",
        "email": "test@example.com",
        "message": "I need a website for my small business.",
    }
    response = client.post("/api/contact", json=payload)
    assert response.status_code == 200
    body = response.json()
    assert body["ok"] is True


def test_contact_form_rejects_missing_fields():
    response = client.post("/api/contact", json={"name": "Only name"})
    assert response.status_code == 400


def test_admin_pin_requires_cookie():
    response = client.get("/admin")
    assert response.status_code == 403


def test_invalid_pin_is_rejected():
    response = client.post("/api/admin/verify-pin", json={"pin": "wrong-pin"})
    assert response.status_code == 401


def test_admin_pin_verification_sets_cookie():
    response = client.post("/api/admin/verify-pin", json={"pin": "123456"})
    assert response.status_code == 200
    set_cookie = response.headers.get("set-cookie", "")
    assert "ams_pin" in set_cookie
    assert "HttpOnly" in set_cookie or "httponly" in set_cookie.lower()
    assert "SameSite" in set_cookie


def test_security_headers_are_present():
    response = client.get("/health")
    assert response.headers.get("x-content-type-options") == "nosniff"
    assert response.headers.get("x-frame-options") == "DENY"
    assert response.headers.get("referrer-policy") == "strict-origin-when-cross-origin"
    assert "geolocation" in response.headers.get("permissions-policy", "")


def test_apex_domain_redirects_to_www():
    response = client.get("/", headers={"host": "derschweigert.de"}, follow_redirects=False)
    assert response.status_code == 308
    assert response.headers["location"] == "https://www.derschweigert.de/"
