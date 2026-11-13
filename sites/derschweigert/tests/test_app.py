from fastapi.testclient import TestClient
from html.parser import HTMLParser
import os
from pathlib import Path
import re

from app.main import app


client = TestClient(app)


class TagBalanceChecker(HTMLParser):
    """Verify HTML tags are balanced."""
    def __init__(self):
        super().__init__()
        self.stack = []
        self.errors = []
    
    def handle_starttag(self, tag, attrs):
        if tag not in ['br', 'hr', 'img', 'input', 'meta', 'link']:
            self.stack.append(tag)
    
    def handle_endtag(self, tag):
        if tag not in ['br', 'hr', 'img', 'input', 'meta', 'link']:
            if not self.stack or self.stack[-1] != tag:
                self.errors.append(f"Mismatched closing tag: {tag}")
            else:
                self.stack.pop()
    
    def check_balanced(self):
        if self.stack:
            self.errors.append(f"Unclosed tags: {self.stack}")
        return len(self.errors) == 0


def test_homepage_renders_public_by_default():
    """Homepage should be accessible without PIN when PIN_PROTECTION_ENABLED=false (default)."""
    from app.config import get_settings
    settings = get_settings()
    settings.app_env = "production"
    settings.pin_protection_enabled = False
    response = client.get("/")
    assert response.status_code == 200
    assert "DerSchweigert" in response.text or "Urs Schweigert" in response.text


def test_homepage_requires_pin_when_protection_enabled():
    """Homepage should require PIN when PIN_PROTECTION_ENABLED=true."""
    from app.config import get_settings
    settings = get_settings()
    settings.app_env = "production"
    settings.pin_protection_enabled = True
    response = client.get("/", follow_redirects=False)
    assert response.status_code == 307
    assert response.headers["location"].startswith("/unlock?next=")


def test_impressum_is_accessible_without_pin_in_production():
    # German law (§ 5 DDG) requires the legal notice to be reachable without
    # any access barrier, even while the rest of the site sits behind the
    # pre-launch PIN wall.
    from app.config import get_settings
    settings = get_settings()
    settings.app_env = "production"
    response = client.get("/impressum", follow_redirects=False)
    assert response.status_code == 200
    assert "Impressum" in response.text


def test_datenschutz_is_accessible_without_pin_in_production():
    from app.config import get_settings
    settings = get_settings()
    settings.app_env = "production"
    response = client.get("/datenschutz", follow_redirects=False)
    assert response.status_code == 200
    assert "Datenschutz" in response.text


def test_nutzungsbedingungen_is_accessible_without_pin_in_production():
    from app.config import get_settings
    settings = get_settings()
    settings.app_env = "production"
    settings.pin_protection_enabled = True
    response = client.get("/nutzungsbedingungen", follow_redirects=False)
    assert response.status_code == 200
    assert "Gemeinsame Nutzungsbedingungen" in response.text
    assert '<section lang="en"' in response.text
    assert "Shared Terms of Use" in response.text
    assert "ffm.derschweigert.de/terms.html" in response.text


def test_homepage_projects_focus_and_structure():
    """Verify homepage has project cards, Android app, contact mailto, and valid HTML structure."""
    from app.config import get_settings
    settings = get_settings()
    settings.app_env = "development"
    settings.pin_protection_enabled = False
    response = client.get("/")
    assert response.status_code == 200
    html = response.text
    
    # Verify three projects are present with valid links
    assert "landhauscheck.com" in html
    assert 'href="https://landhauscheck.com"' in html
    assert "Buchstabenzeit" in html
    assert "Lernapp für Lesefähigkeit" in html
    assert 'href="https://apps.apple.com/app/buchstabenzeit/id6831006870"' in html
    assert "Arithmoslayer" in html
    assert 'href="https://arithmoslayer.de"' in html

    # Verify all project artwork is present, referenced, and dimensioned.
    assets_dir = Path(__file__).resolve().parents[1] / "static" / "projects"
    for asset_name in ("landhauscheck.webp", "buchstabenzeit.webp", "arithmoslayer.webp"):
        assert (assets_dir / asset_name).is_file()
        assert f'/static/projects/{asset_name}' in html
    for asset_name in ("landhauscheck.webp", "buchstabenzeit.webp", "arithmoslayer.webp"):
        image_markup = re.search(
            rf'<img[^>]+src="/static/projects/{re.escape(asset_name)}(?:\?[^"]*)?"[^>]*>',
            html,
        )
        assert image_markup, f"Missing markup for {asset_name}"
        assert re.search(r'\bwidth="\d+"', image_markup.group())
        assert re.search(r'\bheight="\d+"', image_markup.group())
        assert 'loading="lazy"' in image_markup.group()
        assert 'decoding="async"' in image_markup.group()
    
    # Verify contact mailto is visible, not form link
    assert "info@derschweigert.de" in html
    assert 'href="mailto:info@derschweigert.de"' in html
    # Contact form link should not be present
    assert 'href="/contact"' not in html
    
    # Verify HTML structure is balanced
    parser = TagBalanceChecker()
    parser.feed(html)
    assert parser.check_balanced(), f"HTML structure errors: {parser.errors}"


def test_pin_unlock_redirects_to_homepage():
    from app.config import get_settings
    settings = get_settings()
    settings.app_env = "production"
    response = client.post("/unlock", data={"pin": os.environ["ADMIN_PIN"], "next": "/"}, follow_redirects=False)
    assert response.status_code == 302
    assert response.headers["location"] == "/"
    assert "ams_pin=1" in response.headers.get("set-cookie", "")


def test_contact_page_returns_410():
    """Contact form is no longer available."""
    response = client.get("/contact")
    assert response.status_code == 410


def test_contact_api_returns_410():
    """Contact API is retired."""
    payload = {
        "name": "Test User",
        "email": "test@example.com",
        "message": "I need a website for my small business.",
    }
    response = client.post("/api/contact", json=payload)
    assert response.status_code == 410


def test_admin_pin_requires_cookie():
    """Admin page requires valid PIN cookie even when protection disabled."""
    from app.config import get_settings
    settings = get_settings()
    settings.app_env = "production"
    settings.pin_protection_enabled = False
    response = client.get("/admin", follow_redirects=False)
    assert response.status_code == 403


def test_invalid_pin_is_rejected():
    response = client.post("/api/admin/verify-pin", json={"pin": "wrong-pin"})
    assert response.status_code == 401


def test_admin_pin_verification_sets_cookie():
    response = client.post("/api/admin/verify-pin", json={"pin": os.environ["ADMIN_PIN"]})
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

def test_a_service_page_cannot_be_read_through_a_path():
    # The router already refuses an encoded slash, so the traversal was not reachable through this route; the guard
    # makes that a property of the endpoint rather than of the router, and these cases pin it.
    for attempt in ("..%2Findex", "%2e%2e%2findex", "..%2F..%2Fapp%2Fconfig", "services"):
        response = client.get(f"/services/{attempt}")
        assert response.status_code == 404, attempt


def test_only_a_same_site_path_is_offered_after_unlock(monkeypatch):
    from app import main as app_main

    monkeypatch.setattr(app_main.settings, "admin_pin", "123456")
    for hostile in ("https://example.com/", "//example.com/", "/\\example.com", "javascript:alert(1)"):
        response = client.post("/unlock", data={"pin": "123456", "next": hostile}, follow_redirects=False)
        assert response.status_code == 302
        assert response.headers["location"] == "/", hostile
    response = client.post("/unlock", data={"pin": "123456", "next": "/admin"}, follow_redirects=False)
    assert response.headers["location"] == "/admin"
