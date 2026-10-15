"""Tests for billing admin CLI commands."""

import os
import json
from datetime import datetime, timedelta, timezone
from unittest.mock import patch, MagicMock

import pytest
import boto3
from moto import mock_aws
import stripe

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
from sites.ffm.app import billing_store, models
from .test_app import register_and_login


@pytest.fixture(scope='function')
def aws_mock():
    """Mock AWS services for testing."""
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
def billing_app(aws_mock):
    """Create app with billing enabled."""
    app = create_app(TestingConfig)
    app.config['ACCESS_CONTROL_ENABLED'] = True
    app.config['BILLING_ENABLED'] = True
    app.config['BILLING_SALES_ENABLED'] = True
    app.config['BILLING_TERMS_APPROVED'] = True
    app.config['STRIPE_PRICE_ID'] = 'price_quarterly'
    app.config['STRIPE_SECRET_KEY'] = 'sk_test_fake'
    app.config['STRIPE_WEBHOOK_SECRET'] = 'whsec_test_1234567890'
    app.config['STRIPE_PORTAL_CONFIGURATION_ID'] = 'bpc_test_config'
    return app


@pytest.fixture(autouse=True)
def mock_stripe_provider(monkeypatch):
    """Auto-mock stripe_provider._client to prevent real Stripe calls."""
    mock_client = MagicMock()
    monkeypatch.setattr('sites.ffm.app.stripe_provider._client', lambda: mock_client)
    return mock_client


# ============ Admin CLI tests ============

def test_create_code_default_expiry(billing_app):
    """Create-code with default (no) expiry."""
    from click.testing import CliRunner

    runner = CliRunner()

    with billing_app.app_context():
        result = runner.invoke(billing_app.cli, ['billing-admin', 'create-code'])

        assert result.exit_code == 0
        data = json.loads(result.output)
        assert 'code' in data
        assert 'code_hash' in data
        assert data['months'] == 3
        assert len(data['code']) == 32

        # Verify stored correctly
        code_state = billing_store.get_code_state(data['code_hash'])
        assert code_state is not None
        assert code_state['expires_at'] is None


def test_create_code_with_expiry(billing_app):
    """Create-code with custom expiry timestamp."""
    from click.testing import CliRunner

    runner = CliRunner()

    with billing_app.app_context():
        future_iso = (datetime.now(timezone.utc) + timedelta(days=30)).isoformat()
        result = runner.invoke(billing_app.cli, ['billing-admin', 'create-code', '--expires-at', future_iso])

        assert result.exit_code == 0
        data = json.loads(result.output)

        # Verify expiry stored
        code_state = billing_store.get_code_state(data['code_hash'])
        assert code_state['expires_at'] is not None


def test_revoke_code_success(billing_app):
    """Revoke-code CLI command succeeds for existing code."""
    from click.testing import CliRunner

    runner = CliRunner()

    with billing_app.app_context():
        code, code_hash = billing_store.create_access_code(months=3)

        result = runner.invoke(billing_app.cli, ['billing-admin', 'revoke-code', code_hash])

        assert result.exit_code == 0
        assert 'Code revoked' in result.output

        code_state = billing_store.get_code_state(code_hash)
        assert code_state['revoked'] is True


def test_revoke_code_not_found(billing_app):
    """Revoke-code fails gracefully for non-existent code."""
    from click.testing import CliRunner

    runner = CliRunner()

    with billing_app.app_context():
        result = runner.invoke(billing_app.cli, ['billing-admin', 'revoke-code', 'nonexistent'])

        assert result.exit_code != 0
        assert 'not found' in result.output.lower() or 'no revocation' in result.output.lower()


def test_reconcile_with_confirm_flag(billing_app, mock_stripe_provider):
    """Reconcile requires --confirm flag."""
    from click.testing import CliRunner

    runner = CliRunner()

    with billing_app.app_context():
        # Without --confirm should fail
        result = runner.invoke(billing_app.cli, ['billing-admin', 'reconcile'])
        assert result.exit_code != 0

        # Mock provider for reconcile to work
        mock_stripe_provider.subscriptions.list.return_value.auto_paging_iter.return_value = []

        # With --confirm should work
        result = runner.invoke(billing_app.cli, ['billing-admin', 'reconcile', '--confirm'])
        assert result.exit_code == 0


def test_shutdown_requires_billing_disabled(billing_app):
    """Shutdown command requires BILLING_SALES_ENABLED=False."""
    from click.testing import CliRunner

    runner = CliRunner()

    with billing_app.app_context():
        # With billing enabled, should fail
        billing_app.config['BILLING_SALES_ENABLED'] = True
        result = runner.invoke(billing_app.cli, ['billing-admin', 'shutdown', '--confirm'])
        assert result.exit_code != 0
        assert 'Disable BILLING_SALES_ENABLED' in result.output


def test_shutdown_requires_price_id(billing_app):
    """Shutdown command requires STRIPE_PRICE_ID configured."""
    from click.testing import CliRunner

    runner = CliRunner()

    with billing_app.app_context():
        billing_app.config['BILLING_SALES_ENABLED'] = False
        billing_app.config['STRIPE_PRICE_ID'] = ''

        result = runner.invoke(billing_app.cli, ['billing-admin', 'shutdown', '--confirm'])
        assert result.exit_code != 0
        assert 'STRIPE_PRICE_ID' in result.output


def test_shutdown_cancels_matching_subscriptions(billing_app, mock_stripe_provider):
    """Shutdown cancels subscriptions matching configured price_id."""
    from click.testing import CliRunner

    runner = CliRunner()

    with billing_app.app_context():
        billing_app.config['BILLING_SALES_ENABLED'] = False

        # Mock subscriptions to return one matching our price
        mock_stripe_provider.subscriptions.list.return_value.auto_paging_iter.return_value = [
            {
                'id': 'sub_to_cancel',
                'status': 'active',
                'items': {
                    'data': [
                        {'price': {'id': 'price_quarterly'}},
                    ]
                }
            }
        ]

        # Mock cancel to succeed
        mock_stripe_provider.subscriptions.cancel.return_value = {
            'id': 'sub_to_cancel',
            'status': 'canceled',
        }

        result = runner.invoke(billing_app.cli, ['billing-admin', 'shutdown', '--confirm'])

        # Should have called cancel
        assert mock_stripe_provider.subscriptions.cancel.called
