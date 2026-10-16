import os
from datetime import datetime, timedelta, timezone

import pytest
import boto3
from boto3.dynamodb.conditions import Key
from moto import mock_aws
from unittest.mock import patch

os.environ['SECRET_KEY'] = 'test-secret-key-for-testing-only'
os.environ['AWS_ACCESS_KEY_ID'] = 'testing'
os.environ['AWS_SECRET_ACCESS_KEY'] = 'testing'
os.environ['AWS_SECURITY_TOKEN'] = 'testing'
os.environ['AWS_SESSION_TOKEN'] = 'testing'
os.environ['AWS_DEFAULT_REGION'] = 'eu-central-1'
os.environ['DYNAMODB_USERS_TABLE'] = 'ffm-users-test'
os.environ['DYNAMODB_SCORES_TABLE'] = 'ffm-scores-test'
os.environ['DYNAMODB_RATELIMIT_TABLE'] = 'ffm-ratelimits-test'

from sites.ffm.app import create_app
from sites.ffm.app.config import TestingConfig
from sites.ffm.app.captcha import verify_turnstile_token


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


def register_and_login(client, username, email, password, first_grade_year=None):
    payload = {
        "username": username,
        "email": email,
        "password": password,
    }
    if first_grade_year is not None:
        payload["first_grade_year"] = first_grade_year

    captured = {}
    with patch('sites.ffm.app.mailer.send_verification_email',
               side_effect=lambda to_email, username, token, **kwargs: captured.__setitem__('token', token)):
        register_resp = client.post('/api/auth/register', json=payload)
    assert register_resp.status_code == 201

    verify_resp = client.post('/api/auth/verify-email', json={"token": captured['token']})
    assert verify_resp.status_code == 200

    login_resp = client.post('/api/auth/login', json={
        "username": username,
        "password": password,
    })
    assert login_resp.status_code == 200
    token = login_resp.get_json()['access_token']
    return {"Authorization": 'Bearer ' + token}


def register_only(client, username, email, password, first_grade_year=None):
    """Like register_and_login but does NOT verify or log in — leaves the
    account unverified, for tests of the verification-gating behavior."""
    payload = {"username": username, "email": email, "password": password}
    if first_grade_year is not None:
        payload["first_grade_year"] = first_grade_year
    r = client.post('/api/auth/register', json=payload)
    assert r.status_code == 201
    return r


def score_table():
    ddb = boto3.resource('dynamodb', region_name='eu-central-1')
    return ddb.Table(os.environ['DYNAMODB_SCORES_TABLE'])


def test_health(client):
    r = client.get('/api/health')
    assert r.status_code == 200
    assert r.get_json()['ok'] is True


def test_register_success_with_first_grade_year(client):
    captured = {}
    with patch('sites.ffm.app.mailer.send_verification_email',
               side_effect=lambda to_email, username, token, **kwargs: captured.__setitem__('token', token)):
        r = client.post('/api/auth/register', json={
            "username": "testuser",
            "email": "test@example.com",
            "password": "password123",
            "first_grade_year": 2011
        })
    assert r.status_code == 201
    data = r.get_json()
    assert 'access_token' not in data
    assert data['user']['username'] == 'testuser'
    assert 'message' in data


def test_register_first_grade_year_validation(client):
    invalid_low = client.post('/api/auth/register', json={
        "username": "yearlow",
        "email": "yearlow@example.com",
        "password": "password123",
        "first_grade_year": 1949
    })
    assert invalid_low.status_code == 400

    invalid_type = client.post('/api/auth/register', json={
        "username": "yearbad",
        "email": "yearbad@example.com",
        "password": "password123",
        "first_grade_year": "2010"
    })
    assert invalid_type.status_code == 400

    with patch('sites.ffm.app.mailer.send_verification_email'):
        valid = client.post('/api/auth/register', json={
            "username": "yearok",
            "email": "yearok@example.com",
            "password": "password123",
            "first_grade_year": 2010
        })
    assert valid.status_code == 201


def test_login_success(client):
    register_and_login(client, "loginuser", "login@example.com", "mypassword1")


def test_register_duplicate(client):
    register_and_login(client, "dup", "dup@example.com", "password123")
    r = client.post('/api/auth/register', json={
        "username": "dup",
        "email": "dup2@example.com",
        "password": "password123",
    })
    assert r.status_code == 409


def test_login_wrong_password(client):
    register_and_login(client, "wpass", "wpass@example.com", "correct123")
    r = client.post('/api/auth/login', json={
        "username": "wpass",
        "password": "wrong"
    })
    assert r.status_code == 401
    # Same error message as wrong username to prevent user enumeration
    r2 = client.post('/api/auth/login', json={
        "username": "nonexistent",
        "password": "anything"
    })
    assert r2.status_code == 401
    assert r.get_json()['error'] == r2.get_json()['error']


def test_high_score_unauthenticated(client):
    r = client.post('/api/high-score', json={"score": 100})
    assert r.status_code == 401


def test_high_score_invalid_inputs(client):
    headers = register_and_login(client, "badinput", "badinput@example.com", "password123")

    for bad in [{"score": "500"}, {"score": True}, {"score": -1}, {"score": None}, {}]:
        r = client.post('/api/high-score', json=bad, headers=headers)
        assert r.status_code == 400, f"expected 400 for payload {bad}"


def test_submit_level_score(client):
    """/api/score previously had zero test coverage."""
    headers = register_and_login(client, "levelscorer", "levelscorer@example.com", "password123")

    ok = client.post(
        '/api/score',
        json={"level": 5, "score": 250, "difficulty": "medium"},
        headers=headers,
    )
    assert ok.status_code == 200
    assert ok.get_json() == {"saved": True, "personal_best": 250}

    lower = client.post(
        '/api/score',
        json={"level": 5, "score": 100, "difficulty": "medium"},
        headers=headers,
    )
    assert lower.status_code == 200
    assert lower.get_json() == {"saved": False, "personal_best": 250}


def test_submit_level_score_invalid_inputs(client):
    """Regression test: /api/score used to validate `level`/`score` with
    `isinstance(x, int)`, which silently accepts bool (bool is an int
    subclass in Python) — e.g. {"score": true} was treated as score=1.
    Every numeric field here must go through the same strict check."""
    headers = register_and_login(client, "badlevelinput", "badlevelinput@example.com", "password123")

    bad_payloads = [
        {"level": True, "score": 100, "difficulty": "easy"},
        {"level": 1, "score": True, "difficulty": "easy"},
        {"level": 0, "score": 100, "difficulty": "easy"},
        {"level": 61, "score": 100, "difficulty": "easy"},
        {"level": 1, "score": -1, "difficulty": "easy"},
        {"level": 1, "score": 100, "difficulty": "impossible"},
        {"level": "1", "score": 100, "difficulty": "easy"},
    ]
    for bad in bad_payloads:
        r = client.post('/api/score', json=bad, headers=headers)
        assert r.status_code == 400, f"expected 400 for payload {bad}"


def test_high_score_upsert_max_only(client):
    headers = register_and_login(client, "scorer", "scorer@example.com", "scorepass1")

    first = client.post('/api/high-score', json={"score": 500}, headers=headers)
    assert first.status_code == 200
    assert first.get_json()['saved'] is True
    assert first.get_json()['high_score'] == 500

    lower = client.post('/api/high-score', json={"score": 100}, headers=headers)
    assert lower.status_code == 200
    assert lower.get_json()['saved'] is False
    assert lower.get_json()['high_score'] == 500

    higher = client.post('/api/high-score', json={"score": 1000}, headers=headers)
    assert higher.status_code == 200
    assert higher.get_json()['saved'] is True
    assert higher.get_json()['high_score'] == 1000


def test_profile_returns_high_score_and_timestamp(client):
    headers = register_and_login(client, "profilehs", "profilehs@example.com", "scorepass1")

    saved = client.post('/api/high-score', json={"score": 750}, headers=headers)
    assert saved.status_code == 200

    profile = client.get('/api/profile', headers=headers)
    assert profile.status_code == 200
    data = profile.get_json()

    assert data['high_score']['score'] == 750
    assert data['high_score']['achieved_at'] == saved.get_json()['achieved_at']


def test_profile_update_first_grade_year(client):
    headers = register_and_login(client, "profileu", "profileu@example.com", "profilepass1")

    update = client.patch('/api/profile', json={"first_grade_year": 2012}, headers=headers)
    assert update.status_code == 200
    assert update.get_json()['user']['first_grade_year'] == 2012

    profile = client.get('/api/profile', headers=headers)
    assert profile.status_code == 200
    assert profile.get_json()['user']['first_grade_year'] == 2012


def test_profile_update_unauthenticated(client):
    r = client.patch('/api/profile', json={"first_grade_year": 2012})
    assert r.status_code == 401


def test_profile_update_invalid_inputs(client):
    headers = register_and_login(client, "profbad", "profbad@example.com", "password123")

    for bad_year in [True, False, "2012", 1949, 2101]:
        r = client.patch('/api/profile', json={"first_grade_year": bad_year}, headers=headers)
        assert r.status_code == 400, f"expected 400 for first_grade_year={bad_year!r}"

    # Missing key entirely
    r = client.patch('/api/profile', json={"other": "field"}, headers=headers)
    assert r.status_code == 400


def test_profile_update_clears_year(client):
    headers = register_and_login(client, "profclear", "profclear@example.com", "password123", 2010)

    r = client.patch('/api/profile', json={"first_grade_year": None}, headers=headers)
    assert r.status_code == 200
    assert r.get_json()['user']['first_grade_year'] is None


def test_leaderboard_empty(client):
    r = client.get('/api/leaderboard')
    assert r.status_code == 200
    data = r.get_json()
    assert data['global_entries'] == []
    assert data['grouped_entries'] == []


def test_leaderboard_invalid_filter(client):
    r = client.get('/api/leaderboard?first_grade_year=notanumber')
    assert r.status_code == 400

    r2 = client.get('/api/leaderboard?first_grade_year=1900')
    assert r2.status_code == 400

    r3 = client.get('/api/leaderboard?first_grade_year=2200')
    assert r3.status_code == 400


def test_leaderboard_global_grouping_filter_and_unclassified(client):
    users = [
        ("alice", "alice@example.com", 2010, 900),
        ("bob", "bob@example.com", 2010, 600),
        ("cara", "cara@example.com", 2011, 800),
        ("dave", "dave@example.com", None, 700),
    ]

    for username, email, year, score in users:
        headers = register_and_login(client, username, email, "password123", year)
        r = client.post('/api/high-score', json={"score": score}, headers=headers)
        assert r.status_code == 200

    leaderboard = client.get('/api/leaderboard')
    assert leaderboard.status_code == 200
    data = leaderboard.get_json()

    assert [entry['username'] for entry in data['global_entries']] == ["alice", "cara", "dave", "bob"]
    assert all('high_score' in entry for entry in data['global_entries'])

    grouped = {entry['label']: entry['entries'] for entry in data['grouped_entries']}
    assert "2010" in grouped
    assert "2011" in grouped
    assert "unclassified" in grouped
    assert grouped["2010"][0]['rank'] == 1
    assert grouped["2010"][0]['username'] == "alice"
    assert grouped["2010"][1]['rank'] == 2
    assert grouped["2010"][1]['username'] == "bob"
    assert grouped["unclassified"][0]['username'] == "dave"
    assert grouped["unclassified"][0]['first_grade_year'] is None

    year_filter = client.get('/api/leaderboard?first_grade_year=2010')
    assert year_filter.status_code == 200
    year_data = year_filter.get_json()
    assert year_data['first_grade_year_filter'] == 2010
    assert len(year_data['grouped_entries']) == 1
    assert year_data['grouped_entries'][0]['label'] == "2010"
    assert [e['username'] for e in year_data['grouped_entries'][0]['entries']] == ["alice", "bob"]


def test_leaderboard_includes_scores_regardless_of_achieved_at_age(client):
    """Regression test: `achieved_at` only reflects when a personal best was
    last improved, not when the player last played, so the leaderboard must
    not filter entries out based on it (see get_leaderboard docstring)."""
    recent_headers = register_and_login(client, "recent", "recent@example.com", "password123", 2010)
    old_headers = register_and_login(client, "oldie", "oldie@example.com", "password123", 2011)

    recent = client.post('/api/high-score', json={"score": 700}, headers=recent_headers)
    old = client.post('/api/high-score', json={"score": 999}, headers=old_headers)
    assert recent.status_code == 200
    assert old.status_code == 200

    long_ago = (datetime.now(timezone.utc) - timedelta(days=365)).isoformat()
    score_table().update_item(
        Key={'pk': 'USER#oldie', 'sk': 'HIGHSCORE'},
        UpdateExpression='SET achieved_at = :achieved_at',
        ExpressionAttributeValues={':achieved_at': long_ago},
    )

    leaderboard = client.get('/api/leaderboard')
    assert leaderboard.status_code == 200
    data = leaderboard.get_json()

    assert [entry['username'] for entry in data['global_entries']] == ["oldie", "recent"]
    grouped = {entry['label']: entry['entries'] for entry in data['grouped_entries']}
    assert "2010" in grouped
    assert "2011" in grouped


def test_auth_login_rate_limit_is_enforced(aws_mock):
    """Regression test for the auth.py Limiter that used to be created
    separately from the one bound to the app via init_app(); that second
    instance's @limiter.limit(...) decorators never actually enforced
    anything. Uses a distinct AUTH_RATE_LIMIT value so this test's counter
    bucket can't collide with the generous limit the other tests use."""

    class LowAuthRateLimitConfig(TestingConfig):
        AUTH_RATE_LIMIT = "3/minute"

    app = create_app(LowAuthRateLimitConfig)
    test_client = app.test_client()

    statuses = [
        test_client.post(
            '/api/auth/login', json={"username": "nouser", "password": "wrongpassword"}
        ).status_code
        for _ in range(5)
    ]

    assert statuses[:3] == [401, 401, 401]
    assert statuses[3:] == [429, 429]


def test_auth_rate_limit_persists_via_dynamodb_storage(aws_mock):
    """Regression test for the dynamodb:// storage backend used in
    production so rate-limit counters survive across Lambda's separate,
    concurrent execution environments instead of resetting per-instance
    like memory:// would."""

    class DynamoRateLimitConfig(TestingConfig):
        AUTH_RATE_LIMIT = "2/minute"
        RATELIMIT_STORAGE_URI = "dynamodb://" + os.environ['DYNAMODB_RATELIMIT_TABLE']

    app = create_app(DynamoRateLimitConfig)
    test_client = app.test_client()

    statuses = [
        test_client.post(
            '/api/auth/login', json={"username": "nouser", "password": "wrongpassword"}
        ).status_code
        for _ in range(4)
    ]

    assert statuses == [401, 401, 429, 429]

    ratelimit_table = boto3.resource('dynamodb', region_name='eu-central-1').Table(
        os.environ['DYNAMODB_RATELIMIT_TABLE']
    )
    items = ratelimit_table.scan()['Items']
    assert any(int(item['counter']) >= 2 for item in items)


def test_resend_verification_rate_limited_per_target_email_not_just_ip(aws_mock):
    """Regression test for the per-recipient-email limit on
    resend-verification/forgot-password (app/config.py's
    EMAIL_TARGET_RATE_LIMIT, keyed by _email_rate_limit_key in auth.py).
    Without this, AUTH_RATE_LIMIT alone (per source IP) would let a single
    caller keep re-sending verification emails to one victim address
    forever, since every request here comes from the same test client IP
    but targets the same email — the per-email limit must trip well before
    the generous per-IP TestingConfig limit ever would."""

    class LowEmailTargetRateLimitConfig(TestingConfig):
        EMAIL_TARGET_RATE_LIMIT = "3/minute"

    app = create_app(LowEmailTargetRateLimitConfig)
    test_client = app.test_client()

    statuses = [
        test_client.post(
            '/api/auth/resend-verification', json={"email": "samevictim@example.com"}
        ).status_code
        for _ in range(5)
    ]

    assert statuses[:3] == [200, 200, 200]
    assert statuses[3:] == [429, 429]

    # A different target email is a different rate-limit bucket, so it's
    # unaffected by the above victim's requests having exhausted theirs.
    other_status = test_client.post(
        '/api/auth/resend-verification', json={"email": "different@example.com"}
    ).status_code
    assert other_status == 200


def test_register_rejected_without_valid_captcha_when_enabled(aws_mock):
    """Regression test for Turnstile CAPTCHA enforcement (app/captcha.py,
    _check_captcha() in auth.py). TestingConfig disables this by default
    (TURNSTILE_ENABLED = False) so the rest of the suite doesn't need a
    token; this test explicitly re-enables it and stubs out the network
    call to Cloudflare's siteverify endpoint."""

    class TurnstileEnabledConfig(TestingConfig):
        TURNSTILE_ENABLED = True

    app = create_app(TurnstileEnabledConfig)
    test_client = app.test_client()

    with patch('sites.ffm.app.auth.verify_turnstile_token', return_value=False):
        r = test_client.post('/api/auth/register', json={
            "username": "captchafail", "email": "captchafail@example.com",
            "password": "password123", "turnstile_token": "bad-token",
        })
    assert r.status_code == 400
    assert r.get_json()['error'] == 'captcha_verification_failed'


def test_register_succeeds_with_valid_captcha_when_enabled(aws_mock):
    """Same enforcement path as above, but with a passing verification —
    confirms _check_captcha() doesn't block legitimate traffic when the
    token is valid."""

    class TurnstileEnabledConfig(TestingConfig):
        TURNSTILE_ENABLED = True

    app = create_app(TurnstileEnabledConfig)
    test_client = app.test_client()

    with patch('sites.ffm.app.auth.verify_turnstile_token', return_value=True):
        r = test_client.post('/api/auth/register', json={
            "username": "captchaok", "email": "captchaok@example.com",
            "password": "password123", "turnstile_token": "good-token",
        })
    assert r.status_code == 201


def test_forgot_password_rejected_without_valid_captcha_when_enabled(aws_mock):
    """Same Turnstile enforcement, exercised on forgot-password since it's
    a separate anonymous mail-triggering endpoint with its own _check_captcha
    call site."""

    class TurnstileEnabledConfig(TestingConfig):
        TURNSTILE_ENABLED = True

    app = create_app(TurnstileEnabledConfig)
    test_client = app.test_client()

    with patch('sites.ffm.app.auth.verify_turnstile_token', return_value=False):
        r = test_client.post('/api/auth/forgot-password', json={
            "email": "someone@example.com", "turnstile_token": "bad-token",
        })
    assert r.status_code == 400
    assert r.get_json()['error'] == 'captcha_verification_failed'


def test_resend_verification_rejected_without_valid_captcha_when_enabled(aws_mock):
    """Same Turnstile enforcement, exercised on resend-verification since
    it's a separate anonymous mail-triggering endpoint with its own
    _check_captcha call site."""

    class TurnstileEnabledConfig(TestingConfig):
        TURNSTILE_ENABLED = True

    app = create_app(TurnstileEnabledConfig)
    test_client = app.test_client()

    with patch('sites.ffm.app.auth.verify_turnstile_token', return_value=False):
        r = test_client.post('/api/auth/resend-verification', json={
            "email": "someone@example.com", "turnstile_token": "bad-token",
        })
    assert r.status_code == 400
    assert r.get_json()['error'] == 'captcha_verification_failed'


def test_verify_turnstile_token_fails_closed_without_secret(monkeypatch):
    """Unit test for app/captcha.py directly: an empty/unset
    TURNSTILE_SECRET_KEY must fail verification rather than silently
    succeed (fail closed, not open) — a misconfiguration should never
    accidentally disable the check."""
    monkeypatch.delenv('TURNSTILE_SECRET_KEY', raising=False)
    assert verify_turnstile_token("some-token") is False


def test_verify_turnstile_token_fails_closed_without_token():
    """Unit test for app/captcha.py: an empty token must fail verification
    without making any network call."""
    assert verify_turnstile_token("") is False
    assert verify_turnstile_token(None) is False


def test_score_history_unauthenticated(client):
    r = client.get('/api/profile/score-history')
    assert r.status_code == 401


def test_score_history_empty(client):
    headers = register_and_login(client, "historyuser", "historyuser@example.com", "password123")
    r = client.get('/api/profile/score-history', headers=headers)
    assert r.status_code == 200
    assert r.get_json() == {"history": []}


def test_score_history_multiple_submissions_ordered_by_time(client):
    headers = register_and_login(client, "multihistory", "multihistory@example.com", "password123")
    
    scores_to_submit = [100, 50, 300, 200]
    for score in scores_to_submit:
        r = client.post('/api/high-score', json={"score": score}, headers=headers)
        assert r.status_code == 200

    r = client.get('/api/profile/score-history', headers=headers)
    assert r.status_code == 200
    data = r.get_json()
    history = data['history']
    
    assert len(history) == 4
    assert [entry['score'] for entry in history] == [100, 50, 300, 200]
    
    achieved_at_times = [entry['achieved_at'] for entry in history]
    assert achieved_at_times == sorted(achieved_at_times), "achieved_at values should be in ascending order"


def test_score_history_does_not_affect_leaderboard_or_high_score(client):
    headers = register_and_login(client, "historycheck", "historycheck@example.com", "password123")
    
    scores = [100, 50, 300]
    for score in scores:
        r = client.post('/api/high-score', json={"score": score}, headers=headers)
        assert r.status_code == 200

    profile = client.get('/api/profile', headers=headers)
    assert profile.status_code == 200
    profile_data = profile.get_json()
    assert profile_data['high_score']['score'] == 300

    leaderboard = client.get('/api/leaderboard', headers=headers)
    assert leaderboard.status_code == 200
    leaderboard_data = leaderboard.get_json()
    
    user_in_leaderboard = [e for e in leaderboard_data['global_entries'] if e['username'] == 'historycheck']
    assert len(user_in_leaderboard) == 1
    assert user_in_leaderboard[0]['high_score'] == 300

    history = client.get('/api/profile/score-history', headers=headers)
    assert history.status_code == 200
    history_data = history.get_json()
    assert len(history_data['history']) == 3


def test_register_no_longer_returns_access_token(client):
    """POST /api/auth/register should not return access_token directly."""
    captured = {}
    with patch('sites.ffm.app.mailer.send_verification_email',
               side_effect=lambda to_email, username, token, **kwargs: captured.__setitem__('token', token)):
        r = client.post('/api/auth/register', json={
            "username": "newuser",
            "email": "new@example.com",
            "password": "password123",
        })
    assert r.status_code == 201
    data = r.get_json()
    assert "access_token" not in data
    assert "message" in data
    assert data['user']['username'] == 'newuser'
    # Check no Set-Cookie header for refresh_token
    assert 'Set-Cookie' not in r.headers


def test_register_new_account_is_unverified_and_cannot_login(client):
    """New accounts should be unverified and cannot log in until verified."""
    register_only(client, "unverified", "unverified@example.com", "password123")
    
    r = client.post('/api/auth/login', json={
        "username": "unverified",
        "password": "password123",
    })
    assert r.status_code == 403
    assert r.get_json()['error'] == 'email_not_verified'


def test_verify_email_success_allows_login(client):
    """Verifying email should allow login."""
    captured = {}
    with patch('sites.ffm.app.mailer.send_verification_email',
               side_effect=lambda to_email, username, token, **kwargs: captured.__setitem__('token', token)):
        register_resp = client.post('/api/auth/register', json={
            "username": "verifytest",
            "email": "verify@example.com",
            "password": "password123",
        })
    assert register_resp.status_code == 201

    verify_resp = client.post('/api/auth/verify-email', json={"token": captured['token']})
    assert verify_resp.status_code == 200
    assert verify_resp.get_json() == {"ok": True}

    login_resp = client.post('/api/auth/login', json={
        "username": "verifytest",
        "password": "password123",
    })
    assert login_resp.status_code == 200
    assert "access_token" in login_resp.get_json()


def test_verify_email_invalid_token(client):
    """Invalid verify token should return 400."""
    r = client.post('/api/auth/verify-email', json={"token": "garbage"})
    assert r.status_code == 400
    assert r.get_json()['error'] == 'invalid_or_expired_token'


def test_verify_email_token_is_single_use(client):
    """Token should be single-use; second verify should fail."""
    captured = {}
    with patch('sites.ffm.app.mailer.send_verification_email',
               side_effect=lambda to_email, username, token, **kwargs: captured.__setitem__('token', token)):
        client.post('/api/auth/register', json={
            "username": "singleuse",
            "email": "singleuse@example.com",
            "password": "password123",
        })

    token = captured['token']
    
    verify_resp1 = client.post('/api/auth/verify-email', json={"token": token})
    assert verify_resp1.status_code == 200

    verify_resp2 = client.post('/api/auth/verify-email', json={"token": token})
    assert verify_resp2.status_code == 400


def test_resend_verification_for_unverified_account_sends_new_token(client):
    """Resend verification should send a new token for unverified accounts."""
    register_only(client, "resendusr", "resend@example.com", "password123")

    captured = {}
    with patch('sites.ffm.app.mailer.send_verification_email',
               side_effect=lambda to_email, username, token, **kwargs: captured.__setitem__('token', token)):
        resend_resp = client.post('/api/auth/resend-verification', json={"email": "resend@example.com"})
    
    assert resend_resp.status_code == 200

    verify_resp = client.post('/api/auth/verify-email', json={"token": captured['token']})
    assert verify_resp.status_code == 200


def test_resend_verification_generic_response_for_unknown_email(client):
    """Resend verification should return generic response for unknown email."""
    r = client.post('/api/auth/resend-verification', json={"email": "unknown@example.com"})
    assert r.status_code == 200
    assert r.get_json()['message'] == "If that account exists and is unverified, a verification email has been sent."


def test_forgot_password_generic_response_for_unknown_email(client):
    """Forgot password should return generic response for unknown email."""
    r = client.post('/api/auth/forgot-password', json={"email": "unknown@example.com"})
    assert r.status_code == 200
    assert r.get_json()['message'] == "If that account exists, a password reset email has been sent."


def test_forgot_password_and_reset_password_success(client):
    """Reset password flow should allow changing password."""
    headers = register_and_login(client, "resetusr", "reset@example.com", "oldpass123")

    captured = {}
    with patch('sites.ffm.app.mailer.send_password_reset_email',
               side_effect=lambda to_email, username, token, **kwargs: captured.__setitem__('token', token)):
        forgot_resp = client.post('/api/auth/forgot-password', json={"email": "reset@example.com"})
    
    assert forgot_resp.status_code == 200

    reset_resp = client.post('/api/auth/reset-password', json={
        "token": captured['token'],
        "new_password": "newpass123",
    })
    assert reset_resp.status_code == 200
    assert reset_resp.get_json() == {"ok": True}

    # Old password should fail
    login_old = client.post('/api/auth/login', json={
        "username": "resetusr",
        "password": "oldpass123",
    })
    assert login_old.status_code == 401

    # New password should work
    login_new = client.post('/api/auth/login', json={
        "username": "resetusr",
        "password": "newpass123",
    })
    assert login_new.status_code == 200


def test_reset_password_invalid_token(client):
    """Invalid reset token should return 400."""
    r = client.post('/api/auth/reset-password', json={
        "token": "garbage",
        "new_password": "newpass123",
    })
    assert r.status_code == 400
    assert r.get_json()['error'] == 'invalid_or_expired_token'


def test_reset_password_token_is_single_use(client):
    """Reset password token should be single-use."""
    captured = {}
    with patch('sites.ffm.app.mailer.send_password_reset_email',
               side_effect=lambda to_email, username, token, **kwargs: captured.__setitem__('token', token)):
        register_and_login(client, "singleusereset", "singleuse_reset@example.com", "password123")
        client.post('/api/auth/forgot-password', json={"email": "singleuse_reset@example.com"})

    token = captured['token']

    reset_resp1 = client.post('/api/auth/reset-password', json={
        "token": token,
        "new_password": "newpass123",
    })
    assert reset_resp1.status_code == 200

    reset_resp2 = client.post('/api/auth/reset-password', json={
        "token": token,
        "new_password": "anotherpass123",
    })
    assert reset_resp2.status_code == 400


def test_profile_returns_email_fields(client):
    """Profile should return email, email_verified, and pending_email."""
    headers = register_and_login(client, "profileemail", "profile_email@example.com", "password123")
    
    r = client.get('/api/profile', headers=headers)
    assert r.status_code == 200
    data = r.get_json()
    assert data['user']['email'] == 'profile_email@example.com'
    assert data['user']['email_verified'] is True
    assert data['user']['pending_email'] is None


def test_profile_password_wrong_current_password(client):
    """Wrong current password should return 401."""
    headers = register_and_login(client, "pwdusr", "pwd@example.com", "password123")
    
    r = client.post('/api/profile/password', json={
        "current_password": "wrongpass",
        "new_password": "newpass123",
    }, headers=headers)
    assert r.status_code == 401
    assert r.get_json()['error'] == 'Invalid current password'


def test_profile_password_success_changes_login(client):
    """Changing password should update login credentials."""
    headers = register_and_login(client, "pwdchange", "pwd_change@example.com", "oldpass123")
    
    r = client.post('/api/profile/password', json={
        "current_password": "oldpass123",
        "new_password": "newpass123",
    }, headers=headers)
    assert r.status_code == 200
    assert r.get_json() == {"ok": True}

    # Old password should fail
    login_old = client.post('/api/auth/login', json={
        "username": "pwdchange",
        "password": "oldpass123",
    })
    assert login_old.status_code == 401

    # New password should work
    login_new = client.post('/api/auth/login', json={
        "username": "pwdchange",
        "password": "newpass123",
    })
    assert login_new.status_code == 200


def test_profile_password_unauthenticated(client):
    """Unauthenticated request to /profile/password should return 401."""
    r = client.post('/api/profile/password', json={
        "current_password": "pass",
        "new_password": "newpass",
    })
    assert r.status_code == 401


def test_profile_email_wrong_current_password(client):
    """Wrong current password should return 401."""
    headers = register_and_login(client, "emailusr", "emailusr@example.com", "password123")
    
    r = client.post('/api/profile/email', json={
        "new_email": "newemail@example.com",
        "current_password": "wrongpass",
    }, headers=headers)
    assert r.status_code == 401
    assert r.get_json()['error'] == 'Invalid current password'


def test_profile_email_same_as_current(client):
    """Changing to same email should return 400."""
    headers = register_and_login(client, "sameemail", "same@example.com", "password123")
    
    r = client.post('/api/profile/email', json={
        "new_email": "same@example.com",
        "current_password": "password123",
    }, headers=headers)
    assert r.status_code == 400
    assert r.get_json()['error'] == 'New email must be different from current email'


def test_profile_email_already_registered_to_another_account(client):
    """Email already registered should return 409."""
    headers1 = register_and_login(client, "user1", "user1@example.com", "password123")
    register_and_login(client, "user2", "user2@example.com", "password123")
    
    r = client.post('/api/profile/email', json={
        "new_email": "user2@example.com",
        "current_password": "password123",
    }, headers=headers1)
    assert r.status_code == 409
    assert r.get_json()['error'] == 'Email address already in use'


def test_profile_email_success_sets_pending_email(client):
    """Email change should set pending_email."""
    headers = register_and_login(client, "emailchange", "email_change@example.com", "password123")
    
    r = client.post('/api/profile/email', json={
        "new_email": "newemail@example.com",
        "current_password": "password123",
    }, headers=headers)
    assert r.status_code == 200
    assert r.get_json()['pending_email'] == 'newemail@example.com'

    profile = client.get('/api/profile', headers=headers)
    assert profile.status_code == 200
    data = profile.get_json()
    assert data['user']['pending_email'] == 'newemail@example.com'
    assert data['user']['email'] == 'email_change@example.com'


def test_confirm_email_change_success(client):
    """Confirming email change should update email."""
    headers = register_and_login(client, "confirmusr", "confirm@example.com", "password123")

    captured = {}
    with patch('sites.ffm.app.mailer.send_email_change_confirmation',
               side_effect=lambda to_email, username, token, **kwargs: captured.__setitem__('token', token)):
        email_resp = client.post('/api/profile/email', json={
            "new_email": "confirmed@example.com",
            "current_password": "password123",
        }, headers=headers)
    
    assert email_resp.status_code == 200

    confirm_resp = client.post('/api/auth/confirm-email-change', json={"token": captured['token']})
    assert confirm_resp.status_code == 200
    assert confirm_resp.get_json() == {"ok": True}

    profile = client.get('/api/profile', headers=headers)
    assert profile.status_code == 200
    data = profile.get_json()
    assert data['user']['email'] == 'confirmed@example.com'
    assert data['user']['pending_email'] is None


def test_confirm_email_change_invalid_token(client):
    """Invalid confirm email token should return 400."""
    r = client.post('/api/auth/confirm-email-change', json={"token": "garbage"})
    assert r.status_code == 400
    assert r.get_json()['error'] == 'invalid_or_expired_token'


def test_delete_account_wrong_password(client):
    """Wrong current password should return 401 and leave the account intact."""
    headers = register_and_login(client, "delwrongpw", "delwrongpw@example.com", "password123")

    r = client.delete('/api/profile', json={"current_password": "wrongpass"}, headers=headers)
    assert r.status_code == 401
    assert r.get_json()['error'] == 'Invalid current password'

    # Account should still be usable
    profile = client.get('/api/profile', headers=headers)
    assert profile.status_code == 200


def test_delete_account_unauthenticated(client):
    """Unauthenticated request to DELETE /profile should return 401."""
    r = client.delete('/api/profile', json={"current_password": "whatever"})
    assert r.status_code == 401


def test_delete_account_success_removes_profile_and_frees_username_and_email(client):
    """Successful deletion should remove the profile, clear the refresh
    cookie, and free up both the username and email for reuse."""
    headers = register_and_login(client, "deluser", "deluser@example.com", "password123")

    r = client.delete('/api/profile', json={"current_password": "password123"}, headers=headers)
    assert r.status_code == 200
    assert r.get_json() == {"ok": True}
    assert 'refresh_token=;' in r.headers.get('Set-Cookie', '') or 'refresh_token=' in r.headers.get('Set-Cookie', '')

    # Old access token is rejected outright by the shared JWT validator
    # (its sub no longer resolves to any user at all) -- 401, not 404. A
    # deleted account's token must never reach a route handler at all,
    # since a since-recycled username could otherwise let it resolve to a
    # brand new, unrelated account's profile.
    profile = client.get('/api/profile', headers=headers)
    assert profile.status_code == 401

    # Logging in with the old credentials should fail
    login_resp = client.post('/api/auth/login', json={
        "username": "deluser",
        "password": "password123",
    })
    assert login_resp.status_code == 401

    # Username and email should both be free for a brand-new registration
    new_headers = register_and_login(client, "deluser", "deluser@example.com", "password123")
    profile2 = client.get('/api/profile', headers=new_headers)
    assert profile2.status_code == 200
    assert profile2.get_json()['user']['email'] == 'deluser@example.com'


def test_delete_account_removes_scores(client):
    """Deleting an account should also remove its high score, level scores,
    and score history so no orphaned data remains in the scores table."""
    headers = register_and_login(client, "delscores", "delscores@example.com", "password123")

    hs_resp = client.post('/api/high-score', json={"score": 500}, headers=headers)
    assert hs_resp.status_code == 200
    level_resp = client.post('/api/score', json={"level": 1, "score": 42, "difficulty": "easy"}, headers=headers)
    assert level_resp.status_code == 200

    scores_table = boto3.resource('dynamodb', region_name='eu-central-1').Table(
        os.environ['DYNAMODB_SCORES_TABLE']
    )
    before = scores_table.query(
        KeyConditionExpression=Key('pk').eq('USER#delscores')
    )['Items']
    assert len(before) > 0

    r = client.delete('/api/profile', json={"current_password": "password123"}, headers=headers)
    assert r.status_code == 200

    after = scores_table.query(
        KeyConditionExpression=Key('pk').eq('USER#delscores')
    )['Items']
    assert after == []


def test_pre_existing_account_without_email_verified_attribute_can_login(client):
    """Pre-existing accounts without email_verified attribute should be grandfathered in."""
    import bcrypt
    
    # Create a raw user item without email_verified (simulating old data)
    users_table = boto3.resource('dynamodb', region_name='eu-central-1').Table(
        os.environ['DYNAMODB_USERS_TABLE']
    )
    
    password_hash = bcrypt.hashpw(b'oldpassword123', bcrypt.gensalt(rounds=12)).decode('utf-8')
    
    # Put user profile without email_verified
    users_table.put_item(Item={
        'pk': 'USER#olduser',
        'sk': 'PROFILE',
        'username': 'olduser',
        'email': 'olduser@example.com',
        'password_hash': password_hash,
        'created_at': '2020-01-01T00:00:00+00:00',
    })
    
    # Put email reference
    users_table.put_item(Item={
        'pk': 'EMAIL#olduser@example.com',
        'sk': 'REF',
        'username': 'olduser',
    })

    # Login should succeed (grandfathered in)
    r = client.post('/api/auth/login', json={
        "username": "olduser",
        "password": "oldpassword123",
    })
    assert r.status_code == 200
    assert "access_token" in r.get_json()


# ============ Locale propagation on auth-action emails ============
#
# register/resend-verification/forgot-password/update-email previously
# always sent English-only mail regardless of a client-selected German
# UI (found by a read-only audit). These assert: (1) a validated
# `locale` field in the request body is actually threaded through to the
# `language=` kwarg of the corresponding mailer.send_* call, (2) an
# invalid/missing locale safely falls back to the pre-existing English
# default rather than rejecting the request or raising, and (3) no new
# header/CORS mechanism was introduced -- `locale` travels as an
# ordinary JSON body field, exactly like the other fields on these
# already-JSON-POST endpoints.

def test_register_passes_validated_locale_to_verification_email(client):
    captured = {}
    with patch('sites.ffm.app.mailer.send_verification_email',
               side_effect=lambda to_email, username, token, **kwargs: captured.update(kwargs)):
        r = client.post('/api/auth/register', json={
            "username": "localeuser", "email": "localeuser@example.com",
            "password": "TestPass123!", "locale": "de",
        })
    assert r.status_code == 201
    assert captured.get('language') == 'de'


def test_register_falls_back_to_english_for_missing_locale(client):
    captured = {}
    with patch('sites.ffm.app.mailer.send_verification_email',
               side_effect=lambda to_email, username, token, **kwargs: captured.update(kwargs)):
        r = client.post('/api/auth/register', json={
            "username": "nolocaleuser", "email": "nolocaleuser@example.com",
            "password": "TestPass123!",
        })
    assert r.status_code == 201
    assert captured.get('language') == 'en'


def test_register_falls_back_to_english_for_invalid_locale(client):
    captured = {}
    with patch('sites.ffm.app.mailer.send_verification_email',
               side_effect=lambda to_email, username, token, **kwargs: captured.update(kwargs)):
        r = client.post('/api/auth/register', json={
            "username": "badlocaleuser", "email": "badlocaleuser@example.com",
            "password": "TestPass123!", "locale": "fr",
        })
    assert r.status_code == 201
    assert captured.get('language') == 'en'


def test_resend_verification_passes_validated_locale(client):
    with patch('sites.ffm.app.mailer.send_verification_email',
               side_effect=lambda to_email, username, token, **kwargs: None):
        client.post('/api/auth/register', json={
            "username": "resendlocale", "email": "resendlocale@example.com",
            "password": "TestPass123!",
        })

    captured = {}
    with patch('sites.ffm.app.mailer.send_verification_email',
               side_effect=lambda to_email, username, token, **kwargs: captured.update(kwargs)):
        r = client.post('/api/auth/resend-verification', json={
            "email": "resendlocale@example.com", "locale": "de",
        })
    assert r.status_code == 200
    assert captured.get('language') == 'de'


def test_forgot_password_passes_validated_locale(client):
    with patch('sites.ffm.app.mailer.send_verification_email',
               side_effect=lambda to_email, username, token, **kwargs: None):
        client.post('/api/auth/register', json={
            "username": "forgotlocale", "email": "forgotlocale@example.com",
            "password": "TestPass123!",
        })

    captured = {}
    with patch('sites.ffm.app.mailer.send_password_reset_email',
               side_effect=lambda to_email, username, token, **kwargs: captured.update(kwargs)):
        r = client.post('/api/auth/forgot-password', json={
            "email": "forgotlocale@example.com", "locale": "de",
        })
    assert r.status_code == 200
    assert captured.get('language') == 'de'


def test_update_email_passes_validated_locale_to_confirmation_email(client):
    headers = register_and_login(client, 'emaillocaleuser', 'emaillocaleuser@example.com', 'TestPass123!')

    captured = {}
    with patch('sites.ffm.app.mailer.send_email_change_confirmation',
               side_effect=lambda to_email, username, token, **kwargs: captured.update(kwargs)):
        r = client.post('/api/profile/email', json={
            "new_email": "newaddr@example.com", "current_password": "TestPass123!", "locale": "de",
        }, headers=headers)
    assert r.status_code == 200
    assert captured.get('language') == 'de'


def test_update_email_falls_back_to_english_for_missing_locale(client):
    headers = register_and_login(client, 'emailnolocaleuser', 'emailnolocaleuser@example.com', 'TestPass123!')

    captured = {}
    with patch('sites.ffm.app.mailer.send_email_change_confirmation',
               side_effect=lambda to_email, username, token, **kwargs: captured.update(kwargs)):
        r = client.post('/api/profile/email', json={
            "new_email": "newaddr2@example.com", "current_password": "TestPass123!",
        }, headers=headers)
    assert r.status_code == 200
    assert captured.get('language') == 'en'
