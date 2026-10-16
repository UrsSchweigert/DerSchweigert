"""Security regression tests for JWT auth (access/refresh minting and the
shared validator in app/jwt_utils.py).

Covers the fixed vulnerability: usernames are not stable identities. A
deleted account's username can be re-registered by an unrelated person,
and before this fix a still-valid access or refresh token minted for the
*original* account would keep decoding successfully against whatever user
currently sits at that username -- handing the new registrant (or an
attacker who simply waited for a username to free up) the original
owner's session, profile, and (if billing is enabled) subscription/gift
state.

The fix binds every token to the account's immutable `stable_id` and a
persisted `token_version`, both re-checked against the CURRENT DynamoDB
row on every request (see app/jwt_utils.py for the full rationale). These
tests also cover: purpose (access/refresh) discrimination, outright
rejection of legacy pre-fix tokens and malformed/incomplete claims, and
version-based revocation on password change/reset.
"""
import os
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

import boto3
import jwt
import pytest
from moto import mock_aws

os.environ['SECRET_KEY'] = 'test-secret-key-for-testing-only'
os.environ['AWS_ACCESS_KEY_ID'] = 'testing'
os.environ['AWS_SECRET_ACCESS_KEY'] = 'testing'
os.environ['AWS_SECURITY_TOKEN'] = 'testing'
os.environ['AWS_SESSION_TOKEN'] = 'testing'
os.environ['AWS_DEFAULT_REGION'] = 'eu-central-1'
os.environ['DYNAMODB_USERS_TABLE'] = 'ffm-users-test'
os.environ['DYNAMODB_SCORES_TABLE'] = 'ffm-scores-test'
os.environ['DYNAMODB_RATELIMIT_TABLE'] = 'ffm-ratelimits-test'

from sites.ffm.app import create_app, models
from sites.ffm.app.config import TestingConfig
from .test_app import register_and_login

SECRET_KEY = 'test-secret-key-for-testing-only'


@pytest.fixture(scope='function')
def aws_mock():
    with mock_aws():
        ddb = boto3.resource('dynamodb', region_name='eu-central-1')
        for table_name in ('ffm-users-test', 'ffm-scores-test'):
            ddb.create_table(
                TableName=table_name,
                KeySchema=[
                    {'AttributeName': 'pk', 'KeyType': 'HASH'},
                    {'AttributeName': 'sk', 'KeyType': 'RANGE'},
                ],
                AttributeDefinitions=[
                    {'AttributeName': 'pk', 'AttributeType': 'S'},
                    {'AttributeName': 'sk', 'AttributeType': 'S'},
                ],
                BillingMode='PAY_PER_REQUEST',
            )
        ddb.create_table(
            TableName='ffm-ratelimits-test',
            KeySchema=[{'AttributeName': 'pk', 'KeyType': 'HASH'}],
            AttributeDefinitions=[{'AttributeName': 'pk', 'AttributeType': 'S'}],
            BillingMode='PAY_PER_REQUEST',
        )
        ses = boto3.client('ses', region_name='eu-central-1')
        ses.verify_email_identity(EmailAddress=os.environ.get('SES_SENDER_EMAIL', 'no-reply@ffm.derschweigert.de'))
        yield


@pytest.fixture
def app(aws_mock):
    return create_app(TestingConfig)


@pytest.fixture
def client(app):
    return app.test_client()


@pytest.fixture
def billing_client(aws_mock):
    """A second app/client with billing enabled, for asserting a recycled
    username's old token can't reach the new account's billing status."""
    app = create_app(TestingConfig)
    app.config['ACCESS_CONTROL_ENABLED'] = True
    app.config['BILLING_ENABLED'] = True
    return app.test_client()


def _delete_account(client, headers, password):
    r = client.delete('/api/profile', json={"current_password": password}, headers=headers)
    assert r.status_code == 200


def _craft_token(payload, secret=SECRET_KEY):
    return jwt.encode(payload, secret, algorithm='HS256')


def _legacy_payload(username, ttl_seconds=900):
    """Shape of every token minted before this fix: sub/username/exp only
    -- no stable_id, ver, or typ claim at all."""
    return {
        "sub": username,
        "username": username,
        "exp": datetime.utcnow() + timedelta(seconds=ttl_seconds),
    }


# ---------------------------------------------------------------------------
# 1. The vulnerability itself: deleted account + username recycling
# ---------------------------------------------------------------------------

def test_deleted_account_refresh_token_cannot_mint_access_for_recycled_username(client):
    """Reproduces the reported vulnerability: register+delete "alice",
    re-register "alice" as an unrelated new account, then replay the
    *original* alice's still-unexpired refresh token at /auth/refresh. It
    must be rejected outright -- it must never mint a fresh access token,
    and the new account's session/cookies must be completely unaffected."""
    headers = register_and_login(client, "alice", "alice.v1@example.com", "password123")
    # The test client's cookie jar now holds the ORIGINAL alice's refresh
    # cookie (set during login/register_and_login's /auth/login call).
    old_refresh_cookie = client.get_cookie('refresh_token').value

    _delete_account(client, headers, "password123")

    # An unrelated person recycles the now-free username.
    new_headers = register_and_login(client, "alice", "alice.v2@example.com", "hunter2pass")
    new_access_token = new_headers['Authorization'].split(' ', 1)[1]

    # Replay the ORIGINAL alice's refresh token (not the new account's).
    client.set_cookie('refresh_token', old_refresh_cookie)
    r = client.post('/api/auth/refresh')
    assert r.status_code == 401
    assert 'access_token' not in (r.get_json() or {})

    # The new account's own session must be entirely unaffected: its
    # access token still works and still resolves to its own profile.
    profile = client.get('/api/profile', headers=new_headers)
    assert profile.status_code == 200
    assert profile.get_json()['user']['email'] == 'alice.v2@example.com'
    assert new_access_token != old_refresh_cookie


def test_deleted_account_access_token_rejected_for_recycled_username_profile(client):
    """The deleted original account's still-unexpired ACCESS token must
    not resolve against the new account recycling its username either."""
    old_headers = register_and_login(client, "bob", "bob.v1@example.com", "password123")
    _delete_account(client, old_headers, "password123")
    register_and_login(client, "bob", "bob.v2@example.com", "newpassword456")

    r = client.get('/api/profile', headers=old_headers)
    assert r.status_code == 401


def test_deleted_account_old_token_cannot_reach_new_accounts_billing(billing_client):
    """With billing enabled: the deleted original account's old access
    token must not grant access to the recycled username's (unrelated)
    billing status/portal -- no billing-portal/new-profile leak across
    the username boundary."""
    old_headers = register_and_login(billing_client, "carol", "carol.v1@example.com", "password123")
    _delete_account(billing_client, old_headers, "password123")
    register_and_login(billing_client, "carol", "carol.v2@example.com", "newpassword456")

    r = billing_client.get('/api/billing/status', headers=old_headers)
    assert r.status_code == 401

    r = billing_client.post('/api/billing/portal', headers=old_headers)
    assert r.status_code == 401


# ---------------------------------------------------------------------------
# 2. Legacy (pre-fix) tokens must be rejected outright, no fallback
# ---------------------------------------------------------------------------

def test_legacy_username_only_access_token_rejected(client):
    register_and_login(client, "legacyuser", "legacy@example.com", "password123")
    legacy_token = _craft_token(_legacy_payload("legacyuser"))

    r = client.get('/api/profile', headers={'Authorization': f'Bearer {legacy_token}'})
    assert r.status_code == 401


def test_legacy_username_only_refresh_token_rejected(client):
    register_and_login(client, "legacyrefresh", "legacyrefresh@example.com", "password123")
    legacy_refresh = _craft_token(_legacy_payload("legacyrefresh", ttl_seconds=2_592_000))

    client.set_cookie('refresh_token', legacy_refresh)
    r = client.post('/api/auth/refresh')
    assert r.status_code == 401


# ---------------------------------------------------------------------------
# 3. Access/refresh purpose discrimination
# ---------------------------------------------------------------------------

def test_access_token_rejected_at_refresh_endpoint(client):
    headers = register_and_login(client, "swapuser1", "swap1@example.com", "password123")
    access_token = headers['Authorization'].split(' ', 1)[1]

    client.set_cookie('refresh_token', access_token)
    r = client.post('/api/auth/refresh')
    assert r.status_code == 401


def test_refresh_token_rejected_as_bearer_access_token(client):
    register_and_login(client, "swapuser2", "swap2@example.com", "password123")
    refresh_token = client.get_cookie('refresh_token').value

    r = client.get('/api/profile', headers={'Authorization': f'Bearer {refresh_token}'})
    assert r.status_code == 401


# ---------------------------------------------------------------------------
# 4. Malformed / incomplete claim tokens
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("missing_claim", ["exp", "sub", "stable_id", "ver", "typ"])
def test_token_missing_required_claim_rejected(client, missing_claim):
    headers = register_and_login(client, "claimuser", "claim@example.com", "password123")
    user = models.get_user("claimuser")
    payload = {
        "sub": "claimuser",
        "username": "claimuser",
        "stable_id": user['stable_id'],
        "ver": user['token_version'],
        "typ": "access",
        "iat": datetime.utcnow(),
        "exp": datetime.utcnow() + timedelta(seconds=900),
    }
    del payload[missing_claim]
    token = _craft_token(payload)

    r = client.get('/api/profile', headers={'Authorization': f'Bearer {token}'})
    assert r.status_code == 401


def _claims(username, user, token_type="access"):
    return {
        "sub": username,
        "username": username,
        "stable_id": user['stable_id'],
        "ver": user['token_version'],
        "typ": token_type,
        "iat": datetime.utcnow(),
        "exp": datetime.utcnow() + timedelta(seconds=900),
    }


_MALFORMED_CLAIM_CASES = [
    ("ver", True),        # bool (int subclass) must not pass as a version
    ("ver", 1.0),         # float -- we only ever mint ints
    ("ver", "0"),         # string
    ("ver", -1),          # negative
    ("stable_id", []),    # wrong type entirely
    ("stable_id", ""),    # blank
    ("sub", []),          # wrong type entirely
    ("sub", ""),          # blank
]


@pytest.mark.parametrize("claim,bad_value", _MALFORMED_CLAIM_CASES)
def test_malformed_claim_type_rejected_at_access_endpoint(client, claim, bad_value):
    """A signed-but-off-shape token (bool/float/string/negative ver, or a
    list/blank stable_id or sub) must 401, never 500 from a downstream
    type error (e.g. comparing a list to a string, or querying DynamoDB
    with a non-string key)."""
    register_and_login(client, "typeuser", "typeuser@example.com", "password123")
    user = models.get_user("typeuser")
    payload = _claims("typeuser", user)
    payload[claim] = bad_value
    token = _craft_token(payload)

    r = client.get('/api/profile', headers={'Authorization': f'Bearer {token}'})
    assert r.status_code == 401


@pytest.mark.parametrize("claim,bad_value", _MALFORMED_CLAIM_CASES)
def test_malformed_claim_type_rejected_at_refresh_endpoint(client, claim, bad_value):
    """Same malformed-claim coverage against /auth/refresh -- the other
    path through the shared decode_auth_token() validator."""
    register_and_login(client, "typeuser2", "typeuser2@example.com", "password123")
    user = models.get_user("typeuser2")
    payload = _claims("typeuser2", user, token_type="refresh")
    payload[claim] = bad_value
    refresh_token = _craft_token(payload)

    client.set_cookie('refresh_token', refresh_token)
    r = client.post('/api/auth/refresh')
    assert r.status_code == 401


def test_token_wrong_stable_id_rejected(client):
    headers = register_and_login(client, "wrongstable", "wrongstable@example.com", "password123")
    user = models.get_user("wrongstable")
    payload = {
        "sub": "wrongstable", "username": "wrongstable",
        "stable_id": "not-the-real-stable-id",
        "ver": user['token_version'], "typ": "access",
        "iat": datetime.utcnow(), "exp": datetime.utcnow() + timedelta(seconds=900),
    }
    token = _craft_token(payload)
    r = client.get('/api/profile', headers={'Authorization': f'Bearer {token}'})
    assert r.status_code == 401


def test_token_unknown_user_rejected(client):
    payload = {
        "sub": "nosuchuser", "username": "nosuchuser",
        "stable_id": "whatever", "ver": 0, "typ": "access",
        "iat": datetime.utcnow(), "exp": datetime.utcnow() + timedelta(seconds=900),
    }
    token = _craft_token(payload)
    r = client.get('/api/profile', headers={'Authorization': f'Bearer {token}'})
    assert r.status_code == 401


def test_token_bad_signature_rejected(client):
    headers = register_and_login(client, "badsig", "badsig@example.com", "password123")
    token = headers['Authorization'].split(' ', 1)[1]
    header_b64, payload_b64, sig_b64 = token.split('.')
    # Flip a character in the middle of the signature (not the last
    # character, whose low bits can be base64-padding that round-trips to
    # the same byte and wouldn't actually change the decoded signature).
    mid = len(sig_b64) // 2
    flipped_char = 'A' if sig_b64[mid] != 'A' else 'B'
    tampered_sig = sig_b64[:mid] + flipped_char + sig_b64[mid + 1:]
    tampered = f'{header_b64}.{payload_b64}.{tampered_sig}'
    r = client.get('/api/profile', headers={'Authorization': f'Bearer {tampered}'})
    assert r.status_code == 401


def test_expired_access_token_rejected(client):
    register_and_login(client, "expireduser", "expired@example.com", "password123")
    user = models.get_user("expireduser")
    payload = {
        "sub": "expireduser", "username": "expireduser",
        "stable_id": user['stable_id'], "ver": user['token_version'], "typ": "access",
        "iat": datetime.utcnow() - timedelta(seconds=1000),
        "exp": datetime.utcnow() - timedelta(seconds=1),
    }
    token = _craft_token(payload)
    r = client.get('/api/profile', headers={'Authorization': f'Bearer {token}'})
    assert r.status_code == 401


# ---------------------------------------------------------------------------
# 5. token_version revocation: password change / reset
# ---------------------------------------------------------------------------

def test_password_change_revokes_prior_access_and_refresh_tokens(client):
    headers = register_and_login(client, "pwchange", "pwchange@example.com", "password123")
    old_refresh_cookie = client.get_cookie('refresh_token').value

    r = client.post('/api/profile/password', json={
        "current_password": "password123", "new_password": "newpassword456",
    }, headers=headers)
    assert r.status_code == 200

    # Old access token is dead.
    r = client.get('/api/profile', headers=headers)
    assert r.status_code == 401

    # Old refresh token is dead too.
    client.set_cookie('refresh_token', old_refresh_cookie)
    r = client.post('/api/auth/refresh')
    assert r.status_code == 401

    # A fresh login with the new password works and yields a usable token.
    login_resp = client.post('/api/auth/login', json={"username": "pwchange", "password": "newpassword456"})
    assert login_resp.status_code == 200
    fresh_headers = {'Authorization': 'Bearer ' + login_resp.get_json()['access_token']}
    r = client.get('/api/profile', headers=fresh_headers)
    assert r.status_code == 200


def test_password_reset_revokes_prior_access_and_refresh_tokens(client):
    headers = register_and_login(client, "pwreset", "pwreset@example.com", "password123")
    old_refresh_cookie = client.get_cookie('refresh_token').value

    captured = {}
    with patch('sites.ffm.app.mailer.send_password_reset_email',
               side_effect=lambda to_email, username, token, **kwargs: captured.__setitem__('token', token)):
        r = client.post('/api/auth/forgot-password', json={"email": "pwreset@example.com"})
    assert r.status_code == 200

    r = client.post('/api/auth/reset-password', json={
        "token": captured['token'], "new_password": "resetpassword789",
    })
    assert r.status_code == 200

    r = client.get('/api/profile', headers=headers)
    assert r.status_code == 401

    client.set_cookie('refresh_token', old_refresh_cookie)
    r = client.post('/api/auth/refresh')
    assert r.status_code == 401

    login_resp = client.post('/api/auth/login', json={"username": "pwreset", "password": "resetpassword789"})
    assert login_resp.status_code == 200


# ---------------------------------------------------------------------------
# 6. Normal flows and legacy (pre-stable_id/token_version) profiles
# ---------------------------------------------------------------------------

def test_normal_login_access_and_refresh_cycle_works(client):
    headers = register_and_login(client, "normaluser", "normal@example.com", "password123")
    r = client.get('/api/profile', headers=headers)
    assert r.status_code == 200

    refresh_resp = client.post('/api/auth/refresh')
    assert refresh_resp.status_code == 200
    new_access = refresh_resp.get_json()['access_token']
    r = client.get('/api/profile', headers={'Authorization': f'Bearer {new_access}'})
    assert r.status_code == 200
    assert r.get_json()['user']['username'] == 'normaluser'

    # Refresh rotates the refresh cookie too; it should keep working.
    refresh_resp2 = client.post('/api/auth/refresh')
    assert refresh_resp2.status_code == 200


def test_legacy_profile_missing_stable_id_and_token_version_can_log_in(app, client):
    """Simulates an account created before stable_id/token_version
    existed at all: write the DynamoDB row directly, bypassing
    create_user(), with neither attribute present. Login must lazily
    backfill stable_id (ensure_stable_id) and default token_version to 0
    without error, and the minted tokens must work normally afterward."""
    import bcrypt
    with app.app_context():
        users_table = models._users()
        password_hash = bcrypt.hashpw(b'legacypassword1', bcrypt.gensalt(rounds=4)).decode('utf-8')
        users_table.put_item(Item={
            'pk': 'USER#oldtimer', 'sk': 'PROFILE',
            'username': 'oldtimer', 'email': 'oldtimer@example.com',
            'password_hash': password_hash, 'created_at': '2020-01-01T00:00:00+00:00',
            'email_verified': True,
            # Deliberately no 'stable_id', no 'token_version'.
        })

    with app.app_context():
        user_before = models.get_user('oldtimer')
    assert user_before['stable_id'] is None
    assert user_before['token_version'] == 0

    login_resp = client.post('/api/auth/login', json={"username": "oldtimer", "password": "legacypassword1"})
    assert login_resp.status_code == 200
    access_token = login_resp.get_json()['access_token']

    with app.app_context():
        user_after = models.get_user('oldtimer')
    assert user_after['stable_id'] is not None

    r = client.get('/api/profile', headers={'Authorization': f'Bearer {access_token}'})
    assert r.status_code == 200
    assert r.get_json()['user']['username'] == 'oldtimer'


def test_login_race_deleted_between_credential_check_and_stable_id_backfill_fails_cleanly(app, client):
    """Narrow race: the account is deleted after login's get_user()/
    password check but before ensure_stable_id() backfills a missing
    stable_id. Must fail the login cleanly (401), never hydrate a
    stable_id to a row that no longer exists."""
    import bcrypt
    with app.app_context():
        users_table = models._users()
        password_hash = bcrypt.hashpw(b'racepassword1', bcrypt.gensalt(rounds=4)).decode('utf-8')
        users_table.put_item(Item={
            'pk': 'USER#raceuser', 'sk': 'PROFILE',
            'username': 'raceuser', 'email': 'raceuser@example.com',
            'password_hash': password_hash, 'created_at': '2020-01-01T00:00:00+00:00',
            'email_verified': True,
        })

    real_ensure = models.ensure_stable_id

    def _delete_then_ensure(username):
        models.delete_user(username)
        return real_ensure(username)

    with patch('sites.ffm.app.auth.ensure_stable_id', side_effect=_delete_then_ensure):
        r = client.post('/api/auth/login', json={"username": "raceuser", "password": "racepassword1"})
    assert r.status_code == 401

    with app.app_context():
        assert models.get_user('raceuser') is None


def test_login_race_recycled_username_during_stable_id_backfill_rejected(app, client):
    """Broader race: the legacy account is deleted AND its username is
    re-registered by an unrelated party between login's password check
    and ensure_stable_id()'s backfill. ensure_stable_id() only conditions
    on the PROFILE row existing (it does -- it's the new account's row),
    so without the identity guard it would hand back the *new* account's
    own stable_id (new accounts always mint one at create_user() time)
    and silently mint an access token for the new account off the old
    account's already-verified password. Must be rejected cleanly, and
    the new account must be left completely untouched."""
    import bcrypt
    with app.app_context():
        users_table = models._users()
        password_hash = bcrypt.hashpw(b'racepassword1', bcrypt.gensalt(rounds=4)).decode('utf-8')
        users_table.put_item(Item={
            'pk': 'USER#raceuser2', 'sk': 'PROFILE',
            'username': 'raceuser2', 'email': 'raceuser2@example.com',
            'password_hash': password_hash, 'created_at': '2020-01-01T00:00:00+00:00',
            'email_verified': True,
        })

    real_ensure = models.ensure_stable_id
    attacker_password_hash = bcrypt.hashpw(b'attackerpw', bcrypt.gensalt(rounds=4)).decode('utf-8')

    def _recycle_then_ensure(username):
        models.delete_user(username)
        models.create_user(username, 'attacker@example.com', attacker_password_hash)
        return real_ensure(username)

    with patch('sites.ffm.app.auth.ensure_stable_id', side_effect=_recycle_then_ensure):
        r = client.post('/api/auth/login', json={"username": "raceuser2", "password": "racepassword1"})
    assert r.status_code == 401
    assert 'access_token' not in (r.get_json() or {})

    with app.app_context():
        recycled = models.get_user('raceuser2')
    assert recycled is not None
    assert recycled['email'] == 'attacker@example.com'
    assert recycled['password_hash'] == attacker_password_hash
