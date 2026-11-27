from fastapi.testclient import TestClient
from html.parser import HTMLParser
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


def test_homepage_renders_publicly():
    from app.config import get_settings
    settings = get_settings()
    settings.app_env = "production"
    response = client.get("/")
    assert response.status_code == 200
    assert "DerSchweigert" in response.text or "Urs Schweigert" in response.text



def test_impressum_is_publicly_accessible_in_production():
    # German law (§ 5 DDG) requires the legal notice to be reachable without
    # any access barrier.
    from app.config import get_settings
    settings = get_settings()
    settings.app_env = "production"
    response = client.get("/impressum", follow_redirects=False)
    assert response.status_code == 200
    assert "Impressum" in response.text


def test_datenschutz_is_publicly_accessible_in_production():
    from app.config import get_settings
    settings = get_settings()
    settings.app_env = "production"
    response = client.get("/datenschutz", follow_redirects=False)
    assert response.status_code == 200
    assert "Datenschutz" in response.text


def test_nutzungsbedingungen_is_publicly_accessible_in_production():
    from app.config import get_settings
    settings = get_settings()
    settings.app_env = "production"
    response = client.get("/nutzungsbedingungen", follow_redirects=False)
    assert response.status_code == 200
    assert "Gemeinsame Nutzungsbedingungen" in response.text
    assert '<section lang="en"' in response.text
    assert "Shared Terms of Use" in response.text
    assert "ffm.derschweigert.de/terms.html" in response.text


def test_cupmark_pages_carry_operator_and_both_legal_sections():
    # The Cupmark app links here from the App Store, so the page itself has to name
    # the operator and hold the app's privacy policy and terms, in both languages.
    for path, lang in (("/cupmark", "de"), ("/cupmark/en", "en")):
        response = client.get(path, follow_redirects=False)
        assert response.status_code == 200, path
        html = response.text
        assert f'<html lang="{lang}">' in html
        assert "Cupmark" in html
        assert "Urs Schweigert" in html
        assert "Am Sonnenhang 12" in html
        assert 'id="privacy"' in html or 'id="datenschutz"' in html
        assert 'id="terms"' in html or 'id="bedingungen"' in html
        # The shared terms stay the framework; the page adds only what is app-specific.
        assert 'href="/nutzungsbedingungen"' in html
        assert 'href="/impressum"' in html
        assert 'hreflang="en"' in html and 'hreflang="de"' in html


def test_cupmark_pages_read_in_order_and_state_the_free_promise():
    # The order is the argument the page makes: what the app records, who roasts the
    # beans, what the community makes of it, and only then the buy. Community data and
    # the six-month promise are commitments made to readers, so both are pinned too.
    sections = {
        "/cupmark": ["app", "roester", "community", "kauf", "einblick", "test", "preis", "faq", "datenschutz", "bedingungen"],
        "/cupmark/en": ["app", "roasters", "community", "store", "inside", "test", "price", "faq", "privacy", "terms"],
    }
    for path, expected in sections.items():
        html = client.get(path, follow_redirects=False).text
        assert re.findall(r'<section class="section[^"]*" id="([^"]+)"', html) == expected, path
    expectations = {
        "/cupmark": ("id=\"community\"", "id=\"roester\"", "id=\"kauf\"", "id=\"faq\"", "sechs Monate", "Screenshot folgt", "27. November 2026", 'id="einblick"'),
        "/cupmark/en": ("id=\"community\"", "id=\"roasters\"", "id=\"store\"", "id=\"faq\"", "six months", "Screenshot follows", "27 November 2026", 'id="inside"'),
    }
    for path, needles in expectations.items():
        html = client.get(path, follow_redirects=False).text
        for needle in needles:
            assert needle in html, (path, needle)
        # The legal texts are published, not marked as drafts; that notice lives with the owner now.
        assert "Entwurf" not in html and "Draft" not in html
        assert "/static/projects/cupmark/marble.jpg" in html
        assert "/static/projects/cupmark/cafe-friends.jpg" in html


def test_cupmark_pages_load_no_third_party_assets():
    # The site's CSP is same-origin only (script-src 'self'), so any external asset
    # would be blocked silently in the browser while looking fine in the source.
    for path in ("/cupmark", "/cupmark/en"):
        html = client.get(path, follow_redirects=False).text
        assert 'src="http' not in html
        assert "fonts.googleapis" not in html
        parser = TagBalanceChecker()
        parser.feed(html)
        assert parser.check_balanced(), f"{path}: {parser.errors}"


def test_ovara_page_has_support_and_terms():
    response = client.get("/ovara", follow_redirects=False)
    assert response.status_code == 200
    assert "The Man the Tide Brought In" in response.text
    assert 'id="support"' in response.text
    assert 'id="terms"' in response.text
    assert "https://books.apple.com/de/book/the-man-the-tide-brought-in/id6838287964?l=en-GB" in response.text
    assert "1 December 2026" in response.text


def test_homepage_projects_focus_and_structure():
    """Verify homepage has project cards, Android app, contact mailto, and valid HTML structure."""
    from app.config import get_settings
    settings = get_settings()
    settings.app_env = "development"
    response = client.get("/")
    assert response.status_code == 200
    html = response.text
    
    # Verify three projects are present with valid links
    assert "landhauscheck.com" in html
    assert 'href="https://landhauscheck.com"' in html
    assert "Buchstabenzeit" in html
    assert "Lernapp für Lesefähigkeit" in html
    assert 'href="https://apps.apple.com/app/buchstabenzeit/id6831006870"' in html
    assert 'href="https://play.google.com/store/apps/details?id=de.derschweigert.buchstabenzeit"' in html
    assert "Geschlossener Test" not in html
    # The small hero tiles say where each product is available, not just a status.
    tags = re.findall(r'<span class="work-tile__tag">([^<]+)</span>', html)
    assert tags == ["Web", "Web · iOS · Android", "Web · iOS · Android", "iOS · Apple Books · Bald", "iOS · Im Test"]
    # Every tile names its product, so the mosaic reads without decoding the artwork.
    names = re.findall(r'<span class="work-tile__name">([^<]+)</span>', html)
    assert names == ["landhauscheck.com", "Buchstabenzeit", "Arithmo Slayer", "Ovara", "Cupmark"]
    assert "Arithmo Slayer" in html
    assert "Arithmoslayer" not in html
    assert 'href="https://arithmoslayer.de"' in html
    assert 'href="/ovara"' in html
    assert 'href="/cupmark"' in html
    assert 'href="https://books.apple.com/de/book/the-man-the-tide-brought-in/id6838287964"' in html

    # Verify all project artwork is present, referenced, and dimensioned.
    assets_dir = Path(__file__).resolve().parents[1] / "static" / "projects"
    for asset_name in ("landhauscheck.webp", "buchstabenzeit.webp", "arithmoslayer.webp", "ovara.webp"):
        assert (assets_dir / asset_name).is_file()
        assert f'/static/projects/{asset_name}' in html
    for asset_name in ("landhauscheck.webp", "buchstabenzeit.webp", "arithmoslayer.webp", "ovara.webp"):
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
