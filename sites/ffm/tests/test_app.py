import os
import pytest

# Set SECRET_KEY before importing the app
os.environ['SECRET_KEY'] = 'test-secret-key-for-testing-only'

from sites.ffm.app import create_app
from sites.ffm.app.config import TestingConfig


@pytest.fixture
def app():
    app = create_app(TestingConfig)
    yield app


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


def test_login_wrong_password(client):
    register_and_login(client, "wpass", "wpass@example.com", "correct123")
    r = client.post('/api/auth/login', json={
        "username": "wpass",
        "password": "wrong"
    })
    assert r.status_code == 401
    # Same error message as wrong username
    r2 = client.post('/api/auth/login', json={
        "username": "nonexistent",
        "password": "anything"
    })
    assert r2.status_code == 401
    assert r.get_json()['error'] == r2.get_json()['error']


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


def test_profile_update_first_grade_year(client):
    headers = register_and_login(client, "profileu", "profileu@example.com", "profilepass1")

    update = client.patch('/api/profile', json={"first_grade_year": 2012}, headers=headers)
    assert update.status_code == 200
    assert update.get_json()['user']['first_grade_year'] == 2012

    profile = client.get('/api/profile', headers=headers)
    assert profile.status_code == 200
    assert profile.get_json()['user']['first_grade_year'] == 2012


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
