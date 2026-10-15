"""Shared minting/validation for auth JWTs. Every jwt.decode()/jwt.encode()
in the app must go through decode_auth_token()/mint_access_token()/
mint_refresh_token() here, not a second ad-hoc path.

Binds every token to the account's immutable `stable_id` and a persisted
`token_version`, both re-checked against the CURRENT DynamoDB row (not
just at mint time) so a deleted+recycled username or a password change/
reset can't be replayed with an old token. Legacy pre-fix tokens (missing
stable_id/ver/typ) are rejected outright, no compatibility fallback.
"""
import datetime

import jwt
from flask import current_app

from .models import get_user

ALGORITHM = 'HS256'
TYPE_ACCESS = 'access'
TYPE_REFRESH = 'refresh'

#: Claims every current-format token must carry. A token missing any of
#: these (including every legacy username-only token minted before this
#: fix) fails decode with jwt.MissingRequiredClaimError.
_REQUIRED_CLAIMS = ['exp', 'iat', 'sub', 'stable_id', 'ver', 'typ']


class InvalidAuthToken(Exception):
    """Any token that must not be accepted: expired, malformed, wrong
    purpose, missing/malformed claims, unknown user, or a user/stable_id/
    version mismatch against the current DynamoDB row."""


def _secret():
    return current_app.config['SECRET_KEY']


def _mint(user, token_type, ttl_seconds):
    now = datetime.datetime.utcnow()
    payload = {
        "sub": user['username'],
        "username": user['username'],
        "stable_id": user['stable_id'],
        "ver": user['token_version'],
        "typ": token_type,
        "iat": now,
        "exp": now + datetime.timedelta(seconds=ttl_seconds),
    }
    return jwt.encode(payload, _secret(), algorithm=ALGORITHM)


def mint_access_token(user):
    """`user` must be a fresh models.get_user() dict with a non-None
    stable_id (callers mint tokens only at login/refresh time, after
    ensure_stable_id() has backfilled any legacy profile)."""
    return _mint(user, TYPE_ACCESS, current_app.config['JWT_ACCESS_EXPIRES'])


def mint_refresh_token(user):
    return _mint(user, TYPE_REFRESH, current_app.config['JWT_REFRESH_EXPIRES'])


def _is_strict_int(value):
    """int but not bool (bool is an int subclass in Python)."""
    return isinstance(value, int) and not isinstance(value, bool)


def _validate_claim_shapes(payload):
    """We only ever mint these claims ourselves (see _mint above), so
    anything off-shape is a forged/corrupted token, not a legitimate
    external format to interoperate with."""
    sub = payload.get('sub')
    if not isinstance(sub, str) or not sub:
        raise InvalidAuthToken('invalid_sub_claim')
    stable_id = payload.get('stable_id')
    if not isinstance(stable_id, str) or not stable_id:
        raise InvalidAuthToken('invalid_stable_id_claim')
    ver = payload.get('ver')
    if not _is_strict_int(ver) or ver < 0:
        raise InvalidAuthToken('invalid_ver_claim')
    typ = payload.get('typ')
    if not isinstance(typ, str) or typ not in (TYPE_ACCESS, TYPE_REFRESH):
        raise InvalidAuthToken('invalid_typ_claim')
    exp, iat = payload.get('exp'), payload.get('iat')
    if not _is_strict_int(exp) or exp < 0:
        raise InvalidAuthToken('invalid_exp_claim')
    if not _is_strict_int(iat) or iat < 0:
        raise InvalidAuthToken('invalid_iat_claim')
    if exp <= iat:
        raise InvalidAuthToken('invalid_exp_iat_order')


def decode_auth_token(token, expected_type):
    """Decode + fully re-validate `token` against the CURRENT user row.
    Returns the fresh models.get_user() dict (so callers always see the
    live stable_id/token_version, never the ones baked into the token).
    Callers must not catch broader exceptions around this call."""
    try:
        payload = jwt.decode(
            token, _secret(), algorithms=[ALGORITHM],
            options={'require': _REQUIRED_CLAIMS},
        )
    except (jwt.ExpiredSignatureError, jwt.InvalidTokenError) as exc:
        # Covers jwt.MissingRequiredClaimError (subclass of InvalidTokenError)
        # for malformed/legacy tokens, bad signature, wrong algorithm, etc.
        raise InvalidAuthToken(str(exc)) from exc

    _validate_claim_shapes(payload)

    if payload['typ'] != expected_type:
        raise InvalidAuthToken('wrong_token_type')

    user = get_user(payload['sub'])
    if user is None:
        raise InvalidAuthToken('user_not_found')
    if not user.get('stable_id') or user['stable_id'] != payload['stable_id']:
        # Stale token for a deleted account whose username was then
        # recycled by an unrelated registration (different stable_id).
        raise InvalidAuthToken('stable_id_mismatch')
    if user.get('token_version', 0) != payload['ver']:
        raise InvalidAuthToken('token_version_mismatch')

    return user
