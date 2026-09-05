"""Cloudflare Turnstile CAPTCHA verification.

Used to reduce automated abuse of the anonymous, mail-triggering endpoints
(/api/auth/register, /api/auth/forgot-password, /api/auth/resend-verification).
Reads TURNSTILE_SECRET_KEY from os.environ at call time (not import time),
matching the pattern used by app/mailer.py and app/models.py, so tests can
monkeypatch/override it.
"""
import json
import os
import urllib.parse
import urllib.request

TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify"


def verify_turnstile_token(token, remote_ip=None):
    """Return True if the Turnstile token is valid, False otherwise
    (including on a missing token, missing secret, or any network/parsing
    error — fails closed, not open)."""
    if not token:
        return False

    secret = os.environ.get('TURNSTILE_SECRET_KEY', '')
    if not secret:
        return False

    payload = {'secret': secret, 'response': token}
    if remote_ip:
        payload['remoteip'] = remote_ip

    data = urllib.parse.urlencode(payload).encode('utf-8')
    req = urllib.request.Request(TURNSTILE_VERIFY_URL, data=data, method='POST')
    try:
        with urllib.request.urlopen(req, timeout=5) as resp:
            result = json.loads(resp.read().decode('utf-8'))
    except Exception:
        return False

    return bool(result.get('success'))
