import pytest
import json
import os

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


def test_health(client):
    r = client.get('/api/health')
    assert r.status_code == 200
    assert r.get_json()['ok'] is True


def test_register_success(client):
    r = client.post('/api/auth/register', json={
        "username": "testuser",
        "email": "test@example.com",
        "password": "password123"
    })
    assert r.status_code == 201
    data = r.get_json()
    assert 'access_token' in data
    assert data['user']['username'] == 'testuser'


def test_register_duplicate(client):
    client.post('/api/auth/register', json={
        "username": "dup",
        "email": "dup@example.com",
        "password": "password123"
    })
    r = client.post('/api/auth/register', json={
        "username": "dup",
        "email": "dup2@example.com",
        "password": "password123"
    })
    assert r.status_code == 409


def test_login_success(client):
    client.post('/api/auth/register', json={
        "username": "loginuser",
        "email": "login@example.com",
        "password": "mypassword1"
    })
    r = client.post('/api/auth/login', json={
        "username": "loginuser",
        "password": "mypassword1"
    })
    assert r.status_code == 200
    assert 'access_token' in r.get_json()


def test_login_wrong_password(client):
    client.post('/api/auth/register', json={
        "username": "wpass",
        "email": "wpass@example.com",
        "password": "correct123"
    })
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


def test_score_unauthenticated(client):
    r = client.post('/api/score', json={
        "level": 1,
        "score": 100,
        "difficulty": "easy"
    })
    assert r.status_code == 401


def test_score_personal_best(client):
    # Register and login
    client.post('/api/auth/register', json={
        "username": "scorer",
        "email": "scorer@example.com",
        "password": "scorepass1"
    })
    login_r = client.post('/api/auth/login', json={
        "username": "scorer",
        "password": "scorepass1"
    })
    token = login_r.get_json()['access_token']
    headers = {"Authorization": f"Bearer {token}"}
    
    # First score
    r = client.post('/api/score', json={
        "level": 1,
        "score": 500,
        "difficulty": "easy"
    }, headers=headers)
    assert r.status_code == 200
    assert r.get_json()['saved'] is True
    
    # Lower score — should not save
    r2 = client.post('/api/score', json={
        "level": 1,
        "score": 100,
        "difficulty": "easy"
    }, headers=headers)
    assert r2.status_code == 200
    assert r2.get_json()['saved'] is False
    assert r2.get_json()['personal_best'] == 500
    
    # Higher score — should save
    r3 = client.post('/api/score', json={
        "level": 1,
        "score": 1000,
        "difficulty": "easy"
    }, headers=headers)
    assert r3.status_code == 200
    assert r3.get_json()['saved'] is True
    assert r3.get_json()['personal_best'] == 1000


def test_leaderboard(client):
    r = client.get('/api/leaderboard?level=1')
    assert r.status_code == 200
    data = r.get_json()
    assert 'entries' in data
