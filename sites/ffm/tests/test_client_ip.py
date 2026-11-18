"""The caller's IP must come from a source the caller cannot forge
(app/client_ip.py). Before this, apig_wsgi's REMOTE_ADDR (the first
X-Forwarded-For entry, which the client writes) keyed every per-IP limit, so
rotating that header gave unlimited login attempts."""
import json
import os

import boto3
import pytest
from apig_wsgi import make_lambda_handler
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

from sites.ffm.app import create_app  # noqa: E402
from sites.ffm.app.client_ip import get_client_ip  # noqa: E402
from sites.ffm.app.config import TestingConfig  # noqa: E402

SECRET = 'origin-secret-for-tests'


@pytest.fixture
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
        yield


@pytest.fixture
def origin_secret(monkeypatch):
    monkeypatch.setenv('ORIGIN_VERIFY_SECRET', SECRET)


def _ip_for(app, headers=None, request_context=None, remote_addr='10.0.0.9'):
    environ = {'REMOTE_ADDR': remote_addr}
    if request_context is not None:
        environ['apig_wsgi.request_context'] = request_context
    with app.test_request_context('/', headers=headers or {}, environ_overrides=environ):
        return get_client_ip()


def test_viewer_ip_trusted_only_with_matching_origin_secret(aws_mock, origin_secret):
    app = create_app(TestingConfig)
    context = {'identity': {'sourceIp': '130.176.1.1'}}
    headers = {'X-Origin-Verify': SECRET, 'X-Viewer-Ip': '203.0.113.7'}
    assert _ip_for(app, headers, context) == '203.0.113.7'

    forged = {'X-Origin-Verify': 'guess', 'X-Viewer-Ip': '6.6.6.6'}
    assert _ip_for(app, forged, context) == '130.176.1.1'

    no_secret = {'X-Viewer-Ip': '6.6.6.6'}
    assert _ip_for(app, no_secret, context) == '130.176.1.1'


def test_viewer_ip_ignored_when_no_secret_is_configured(aws_mock, monkeypatch):
    monkeypatch.delenv('ORIGIN_VERIFY_SECRET', raising=False)
    app = create_app(TestingConfig)
    headers = {'X-Origin-Verify': '', 'X-Viewer-Ip': '6.6.6.6'}
    assert _ip_for(app, headers, {'identity': {'sourceIp': '198.51.100.4'}}) == '198.51.100.4'


def test_malformed_viewer_ip_falls_back(aws_mock, origin_secret):
    app = create_app(TestingConfig)
    headers = {'X-Origin-Verify': SECRET, 'X-Viewer-Ip': 'not-an-ip'}
    assert _ip_for(app, headers, {'identity': {'sourceIp': '198.51.100.4'}}) == '198.51.100.4'


def test_x_forwarded_for_never_decides_the_ip(aws_mock):
    app = create_app(TestingConfig)
    headers = {'X-Forwarded-For': '6.6.6.6, 198.51.100.4'}
    assert _ip_for(app, headers, {'identity': {'sourceIp': '198.51.100.4'}}) == '198.51.100.4'


def test_outside_lambda_uses_remote_addr(aws_mock):
    app = create_app(TestingConfig)
    assert _ip_for(app, remote_addr='192.0.2.3') == '192.0.2.3'


def _login_event(xff, source_ip, extra_headers=None):
    headers = {'Content-Type': 'application/json', 'X-Forwarded-For': xff, 'Host': 'ffm.derschweigert.de'}
    headers.update(extra_headers or {})
    return {
        'httpMethod': 'POST',
        'path': '/api/auth/login',
        'headers': headers,
        'multiValueHeaders': {k: [v] for k, v in headers.items()},
        'queryStringParameters': None,
        'multiValueQueryStringParameters': None,
        'body': json.dumps({'username': f'nouser-{xff}', 'password': 'wrongpassword'}),
        'isBase64Encoded': False,
        'requestContext': {'identity': {'sourceIp': source_ip}},
    }


class LowAuthRateLimitConfig(TestingConfig):
    AUTH_RATE_LIMIT = '3/minute'


def test_rotating_x_forwarded_for_no_longer_bypasses_the_login_limit(aws_mock):
    """End to end through apig_wsgi, the way the Lambda handler runs the app:
    each request claims a different X-Forwarded-For, as the bypass did."""
    handler = make_lambda_handler(create_app(LowAuthRateLimitConfig))
    statuses = [
        handler(_login_event(f'6.6.6.{i}', '198.51.100.4'), None)['statusCode']
        for i in range(5)
    ]
    assert statuses == [401, 401, 401, 429, 429]


def test_viewers_behind_cloudfront_get_separate_buckets(aws_mock, origin_secret):
    """Through CloudFront every request reaches API Gateway from an edge
    address; the stamped viewer IP keeps two viewers' limits apart."""
    handler = make_lambda_handler(create_app(LowAuthRateLimitConfig))
    edge = '130.176.1.1'

    def via_cloudfront(viewer, n):
        headers = {'X-Origin-Verify': SECRET, 'X-Viewer-Ip': viewer}
        return handler(_login_event(f'6.6.6.{n}', edge, headers), None)['statusCode']

    first = [via_cloudfront('203.0.113.7', i) for i in range(4)]
    assert first == [401, 401, 401, 429]
    assert via_cloudfront('203.0.113.8', 9) == 401


def test_login_attempts_per_account_are_limited_across_addresses(aws_mock):
    class LowAccountLimitConfig(TestingConfig):
        LOGIN_ACCOUNT_RATE_LIMIT = '3/hour'

    client = create_app(LowAccountLimitConfig).test_client()

    def attempt(username, ip):
        return client.post(
            '/api/auth/login',
            json={'username': username, 'password': 'wrongpassword'},
            environ_overrides={'REMOTE_ADDR': ip},
        ).status_code

    statuses = [attempt('victim', f'198.51.100.{i}') for i in range(5)]
    assert statuses == [401, 401, 401, 429, 429]
    # Case and surrounding spaces do not open a fresh bucket for the same account.
    assert attempt('  VICTIM ', '198.51.100.99') == 429
    assert attempt('someone-else', '198.51.100.1') == 401
