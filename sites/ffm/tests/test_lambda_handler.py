"""Tests for sites/ffm/lambda/handler.py's routing between a normal API
Gateway request (forwarded to the Flask app via apig_wsgi, unchanged) and
the daily EventBridge-triggered retention-cleanup invocation (routed
internally to app.retention_admin.run_scheduled_cleanup, never through
apig_wsgi/Flask and never reachable over HTTP — see
infra/terraform/sites/ffm/main.tf's aws_cloudwatch_event_rule /
aws_cloudwatch_event_target.retention_cleanup).

Loaded the same way .github/workflows/deploy.yml's "Build Lambda zip" step
lays the real deployment out — handler.py with app/ copied in right beside
it — so `from app import create_app` inside handler.py resolves exactly as
it does in production, rather than via the dotted `sites.ffm.app...` path
the rest of this test suite otherwise uses.
"""

import importlib.util
import os
import sys
from pathlib import Path

os.environ.setdefault('SECRET_KEY', 'test-secret-key-for-testing-only')
os.environ.setdefault('AWS_ACCESS_KEY_ID', 'testing')
os.environ.setdefault('AWS_SECRET_ACCESS_KEY', 'testing')
os.environ.setdefault('AWS_SECURITY_TOKEN', 'testing')
os.environ.setdefault('AWS_SESSION_TOKEN', 'testing')
os.environ.setdefault('AWS_DEFAULT_REGION', 'eu-central-1')
os.environ.setdefault('DYNAMODB_USERS_TABLE', 'ffm-users-test')
os.environ.setdefault('DYNAMODB_SCORES_TABLE', 'ffm-scores-test')
os.environ.setdefault('DYNAMODB_RATELIMIT_TABLE', 'ffm-ratelimits-test')

import pytest

FFM_ROOT = Path(__file__).resolve().parents[1]
HANDLER_PATH = FFM_ROOT / 'lambda' / 'handler.py'


@pytest.fixture
def handler():
    # pytest.ini's global `pythonpath = sites/derschweigert` would
    # otherwise let a bare `import app` resolve to derschweigert's app/
    # package instead of ffm's — insert sites/ffm ahead of it for the
    # duration of this one module load.
    sys.path.insert(0, str(FFM_ROOT))
    try:
        spec = importlib.util.spec_from_file_location('ffm_lambda_handler_under_test', HANDLER_PATH)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
    finally:
        sys.path.remove(str(FFM_ROOT))
    return module


def test_retention_cleanup_task_routes_to_scheduled_worker_not_wsgi(handler, monkeypatch):
    calls = {'cleanup': 0, 'wsgi': 0}
    monkeypatch.setattr(handler, 'run_scheduled_cleanup', lambda: calls.__setitem__('cleanup', calls['cleanup'] + 1) or {'tokens': {}, 'cancel_requests': {}})
    monkeypatch.setattr(handler, '_wsgi_handler', lambda event, context: calls.__setitem__('wsgi', calls['wsgi'] + 1))

    result = handler.lambda_handler({'task': 'ffm-retention-cleanup'}, None)

    assert calls == {'cleanup': 1, 'wsgi': 0}
    assert result == {'tokens': {}, 'cancel_requests': {}}


def test_api_gateway_event_routes_to_wsgi_not_scheduled_worker(handler, monkeypatch):
    calls = {'cleanup': 0, 'wsgi': 0}
    monkeypatch.setattr(handler, 'run_scheduled_cleanup', lambda: calls.__setitem__('cleanup', calls['cleanup'] + 1))
    monkeypatch.setattr(handler, '_wsgi_handler', lambda event, context: calls.__setitem__('wsgi', calls['wsgi'] + 1) or {'statusCode': 200, 'body': '{}'})

    api_gateway_event = {
        'httpMethod': 'GET', 'path': '/api/health', 'headers': {}, 'requestContext': {},
        'queryStringParameters': None, 'isBase64Encoded': False,
    }
    result = handler.lambda_handler(api_gateway_event, None)

    assert calls == {'cleanup': 0, 'wsgi': 1}
    assert result == {'statusCode': 200, 'body': '{}'}


def test_unrecognized_task_value_falls_back_to_wsgi(handler, monkeypatch):
    """Only the exact configured task string triggers the internal worker
    — any other payload (including one that merely happens to have a
    `task` key) is treated as a normal request, never silently run as a
    privileged cleanup."""
    calls = {'cleanup': 0, 'wsgi': 0}
    monkeypatch.setattr(handler, 'run_scheduled_cleanup', lambda: calls.__setitem__('cleanup', calls['cleanup'] + 1))
    monkeypatch.setattr(handler, '_wsgi_handler', lambda event, context: calls.__setitem__('wsgi', calls['wsgi'] + 1) or {'statusCode': 200})

    result = handler.lambda_handler({'task': 'something-else', 'httpMethod': 'GET'}, None)

    assert calls == {'cleanup': 0, 'wsgi': 1}
    assert result == {'statusCode': 200}


def test_scheduled_worker_failure_propagates_rather_than_being_swallowed(handler, monkeypatch):
    """A scheduled-cleanup failure must propagate out of lambda_handler so
    Lambda's own invocation-failure/retry handling applies — it must not
    be caught here and turned into a misleading success response."""
    def _boom():
        raise RuntimeError('cleanup failed')

    monkeypatch.setattr(handler, 'run_scheduled_cleanup', _boom)

    with pytest.raises(RuntimeError):
        handler.lambda_handler({'task': 'ffm-retention-cleanup'}, None)
