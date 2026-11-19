"""CORS must allow the site's own origin (APP_BASE_URL), not a hardcoded host.

The dev environment serves the same app from ffm-dev.derschweigert.de. With the
production host hardcoded, its browser calls to the API carried an Origin the
API never echoed back, so every credentialed request failed in the browser.
"""
import os

os.environ.setdefault('SECRET_KEY', 'test-secret-key-for-testing-only')

from sites.ffm.app import create_app
from sites.ffm.app.config import TestingConfig


def _preflight(app, origin):
    return app.test_client().options(
        '/api/health',
        headers={'Origin': origin, 'Access-Control-Request-Method': 'GET'},
    )


def _app_with_base_url(base_url):
    class Config(TestingConfig):
        APP_BASE_URL = base_url

    return create_app(Config)


def test_dev_origin_is_allowed_when_it_is_the_base_url():
    app = _app_with_base_url('https://ffm-dev.derschweigert.de')
    resp = _preflight(app, 'https://ffm-dev.derschweigert.de')
    assert resp.headers.get('Access-Control-Allow-Origin') == 'https://ffm-dev.derschweigert.de'
    assert resp.headers.get('Access-Control-Allow-Credentials') == 'true'


def test_dev_does_not_allow_the_production_origin():
    app = _app_with_base_url('https://ffm-dev.derschweigert.de')
    resp = _preflight(app, 'https://ffm.derschweigert.de')
    assert resp.headers.get('Access-Control-Allow-Origin') is None


def test_production_origin_is_allowed_by_default():
    app = _app_with_base_url('https://ffm.derschweigert.de')
    resp = _preflight(app, 'https://ffm.derschweigert.de')
    assert resp.headers.get('Access-Control-Allow-Origin') == 'https://ffm.derschweigert.de'


def test_trailing_slash_in_base_url_still_matches():
    app = _app_with_base_url('https://ffm-dev.derschweigert.de/')
    resp = _preflight(app, 'https://ffm-dev.derschweigert.de')
    assert resp.headers.get('Access-Control-Allow-Origin') == 'https://ffm-dev.derschweigert.de'
