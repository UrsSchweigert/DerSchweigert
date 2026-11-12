"""Tests for the public Android-beta waitlist (app/beta_waitlist.py) and its
operator CLI (`flask beta-admin export`).

The endpoint is anonymous and writes durably, so these tests pin the things
that make that acceptable: strict input validation, idempotent repeats,
per-source rate limiting, isolation from other single-table item types, and an
export path the owner can actually use to invite the addresses.
"""

import csv
import io
import json
import os

import boto3
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

from sites.ffm.app import create_app
from sites.ffm.app import beta_waitlist, models
from sites.ffm.app.config import TestingConfig

ENDPOINT = '/api/beta/android-waitlist'


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


def _cli_invoke(app, args):
    from click.testing import CliRunner
    runner = CliRunner()
    with app.app_context():
        return runner.invoke(app.cli, args)


def _stored_items():
    return models._users().scan().get('Items', [])


# ============ Sign-up ============

def test_signup_is_stored_under_its_own_prefix(client):
    resp = client.post(ENDPOINT, json={'email': 'Tester@Gmail.com'})

    assert resp.status_code == 201
    body = resp.get_json()
    assert body['ok'] is True
    assert body['status'] == 'registered'
    assert 'Beta-Liste' in body['message']

    items = _stored_items()
    assert len(items) == 1
    item = items[0]
    assert item['pk'] == 'BETAWAITLIST#tester@gmail.com'
    assert item['sk'] == 'SIGNUP'
    assert item['email'] == 'tester@gmail.com', 'address must be normalised to lower case'
    assert item['source'] == beta_waitlist.SOURCE
    assert item['locale'] == 'de'
    assert item['submitted_at']


def test_repeat_submission_is_idempotent_and_not_an_error(client):
    first = client.post(ENDPOINT, json={'email': 'repeat@gmail.com'})
    second = client.post(ENDPOINT, json={'email': '  REPEAT@gmail.com  '})

    assert first.status_code == 201
    assert second.status_code == 200
    assert second.get_json()['status'] == 'already_registered'
    assert len(_stored_items()) == 1


def test_language_of_the_receipt_follows_the_request(client):
    de = client.post(ENDPOINT, json={'email': 'de@gmail.com', 'locale': 'de'})
    en = client.post(ENDPOINT, json={'email': 'en@gmail.com', 'locale': 'en'})

    assert de.get_json()['message'].startswith('Danke!')
    assert en.get_json()['message'].startswith('Thank you!')


def test_unknown_locale_falls_back_to_german(client):
    resp = client.post(ENDPOINT, json={'email': 'fallback@gmail.com', 'locale': 'fr'})

    assert resp.status_code == 201
    assert resp.get_json()['message'].startswith('Danke!')
    assert _stored_items()[0]['locale'] == 'de'


def test_googlemail_is_accepted_and_normalised(client):
    resp = client.post(ENDPOINT, json={'email': '  Tester@GoogleMail.com '})

    assert resp.status_code == 201
    assert _stored_items()[0]['email'] == 'tester@googlemail.com'


@pytest.mark.parametrize('domain', [
    'example.com',
    'gmx.de',
    'google.com',
    'gmail.co',
    'mail.gmail.com',
    'gmail.com.example.com',
])
def test_non_google_domains_are_rejected(client, domain):
    """Play only invites Google accounts, so an address Google can never
    invite would turn into a tester who never hears back."""
    resp = client.post(ENDPOINT, json={'email': f'tester@{domain}'})

    assert resp.status_code == 400
    assert resp.get_json()['error'] == 'google_mail_required'
    assert _stored_items() == []


@pytest.mark.parametrize('payload', [
    {},
    {'email': ''},
    {'email': 'no-at-sign.example.com'},
    {'email': '@gmail.com'},
    {'email': 'name@'},
    {'email': 'two@at@gmail.com'},
    {'email': 'with space@gmail.com'},
    {'email': 'line\nbreak@gmail.com'},
    {'email': 42},
    {'email': ['name@gmail.com']},
    {'email': {'$ne': None}},
    {'email': 'a' * 250 + '@gmail.com'},
])
def test_invalid_addresses_are_rejected_and_nothing_is_stored(client, payload):
    resp = client.post(ENDPOINT, json=payload)

    assert resp.status_code == 400
    assert resp.get_json()['error'] == 'valid_email_required'
    assert _stored_items() == []


def test_a_non_json_body_is_rejected(client):
    resp = client.post(ENDPOINT, data='email=tester@gmail.com', content_type='application/x-www-form-urlencoded')

    assert resp.status_code == 400
    assert resp.get_json()['error'] == 'invalid_request'


def test_the_route_only_accepts_post(client):
    assert client.get(ENDPOINT).status_code == 405


def test_responses_are_never_cached(client):
    resp = client.post(ENDPOINT, json={'email': 'cache@gmail.com'})

    assert resp.headers['Cache-Control'] == 'private, no-store'


def test_signups_never_touch_other_single_table_items(client):
    models._users().put_item(Item={
        'pk': 'USER#someone', 'sk': 'PROFILE', 'username': 'someone', 'email': 'someone@example.com',
    })

    assert client.post(ENDPOINT, json={'email': 'someone@gmail.com'}).status_code == 201

    items = {item['pk'] for item in _stored_items()}
    assert items == {'USER#someone', 'BETAWAITLIST#someone@gmail.com'}
    profile = models._users().get_item(Key={'pk': 'USER#someone', 'sk': 'PROFILE'})['Item']
    assert profile['email'] == 'someone@example.com', 'the sign-up must not modify an account'


def test_rate_limit_bounds_submissions_per_source(aws_mock):
    """5/minute per IP, so bare public exposure cannot be turned into
    unlimited anonymous writes. A distinct low limit keeps this test's
    counter bucket away from the generous limit the other tests use."""
    class LowWaitlistRateLimitConfig(TestingConfig):
        BETA_WAITLIST_RATE_LIMIT = "5/minute"

    test_client = create_app(LowWaitlistRateLimitConfig).test_client()
    for index in range(5):
        resp = test_client.post(ENDPOINT, json={'email': f'tester{index}@gmail.com'})
        assert resp.status_code == 201

    assert test_client.post(ENDPOINT, json={'email': 'sixth@gmail.com'}).status_code == 429


# ============ Operator CLI ============

def test_export_prints_csv_for_the_play_console(client, app):
    client.post(ENDPOINT, json={'email': 'first@gmail.com'})
    client.post(ENDPOINT, json={'email': 'second@gmail.com'})

    result = _cli_invoke(app, ['beta-admin', 'export'])

    assert result.exit_code == 0, result.output
    rows = list(csv.reader(io.StringIO(result.output)))
    assert rows[0] == ['email', 'submitted_at', 'locale', 'source']
    assert [row[0] for row in rows[1:]] == ['first@gmail.com', 'second@gmail.com']


def test_export_can_emit_json(client, app):
    client.post(ENDPOINT, json={'email': 'json@gmail.com'})

    result = _cli_invoke(app, ['beta-admin', 'export', '--format', 'json'])

    assert result.exit_code == 0, result.output
    entries = json.loads(result.output)
    assert [entry['email'] for entry in entries] == ['json@gmail.com']
    assert entries[0]['source'] == beta_waitlist.SOURCE
