import os
from datetime import datetime, timedelta, timezone

import pytest
import boto3
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

from sites.ffm.app import create_app
from sites.ffm.app.config import TestingConfig


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
    register_resp = client.post('/api/auth/register', json=payload)
    assert register_resp.status_code == 201

    login_resp = client.post('/api/auth/login', json={
        "username": username,
        "password": password,
    })
    assert login_resp.status_code == 200
    token = login_resp.get_json()['access_token']
    return {"Authorization": 'Bearer ' + token}


def score_table():
    ddb = boto3.resource('dynamodb', region_name='eu-central-1')
    return ddb.Table(os.environ['DYNAMODB_SCORES_TABLE'])


def test_health(client):
    r = client.get('/api/health')
    assert r.status_code == 200
    assert r.get_json()['ok'] is True


def test_register_success_with_first_grade_year(client):
    r = client.post('/api/auth/register', json={
        "username": "testuser",
        "email": "test@example.com",
        "password": "password123",
        "first_grade_year": 2011
    })
    assert r.status_code == 201
    data = r.get_json()
    assert 'access_token' in data
    assert data['user']['username'] == 'testuser'


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


def test_leaderboard_only_shows_scores_from_last_two_weeks(client):
    recent_headers = register_and_login(client, "recent", "recent@example.com", "password123", 2010)
    old_headers = register_and_login(client, "oldie", "oldie@example.com", "password123", 2011)

    recent = client.post('/api/high-score', json={"score": 700}, headers=recent_headers)
    old = client.post('/api/high-score', json={"score": 999}, headers=old_headers)
    assert recent.status_code == 200
    assert old.status_code == 200

    cutoff_breach = (datetime.now(timezone.utc) - timedelta(days=15)).isoformat()
    score_table().update_item(
        Key={'pk': 'USER#oldie', 'sk': 'HIGHSCORE'},
        UpdateExpression='SET achieved_at = :achieved_at',
        ExpressionAttributeValues={':achieved_at': cutoff_breach},
    )

    leaderboard = client.get('/api/leaderboard')
    assert leaderboard.status_code == 200
    data = leaderboard.get_json()

    assert [entry['username'] for entry in data['global_entries']] == ["recent"]
    grouped = {entry['label']: entry['entries'] for entry in data['grouped_entries']}
    assert "2010" in grouped
    assert "2011" not in grouped


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
