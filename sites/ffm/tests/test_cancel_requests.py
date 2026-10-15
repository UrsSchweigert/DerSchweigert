"""Tests for the public, unauthenticated cancellation-request flow
(app/cancel_requests.py) and its operator CLI (app/billing_admin.py's
`cancel-request` command group), including that it never bypasses manual
operator review to call Stripe and that it reuses the authenticated
cancel route's shared billing.cancel_future_renewals() primitive without
changing that route's own behavior.
"""

import os
import json
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock

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
from sites.ffm.app import billing_store, cancel_requests_store, models
from .test_app import register_and_login


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
def billing_app(aws_mock):
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


@pytest.fixture
def client(billing_app):
    return billing_app.test_client()


@pytest.fixture(autouse=True)
def mock_stripe_provider(monkeypatch):
    mock_client = MagicMock()
    monkeypatch.setattr('sites.ffm.app.stripe_provider._client', lambda: mock_client)
    return mock_client


def _valid_payload(**overrides):
    payload = {
        'idempotency_key': '11111111-1111-4111-8111-111111111111',
        'contact_email': 'contact@example.com',
        'account_email': 'account@example.com',
        'username': None,
        'stripe_reference': None,
        'cancellation_type': 'earliest',
        'requested_date': None,
        'reason': 'Bitte kuendigen, Danke.',
    }
    payload.update(overrides)
    return payload


# ============ Public submission ============

def test_public_guest_submission_creates_durable_request_without_stripe_call(client, billing_app, mock_stripe_provider):
    resp = client.post('/api/cancel-requests', json=_valid_payload())
    assert resp.status_code == 201
    data = resp.get_json()
    assert data['status'] == 'submitted'
    assert data['request_id'] == '11111111-1111-4111-8111-111111111111'
    assert 'submitted_at' in data
    assert 'Anfrage erhalten' in data['message']
    assert 'NICHT "Kuendigung bestaetigt"' in data['message']  # explicit negation, never a bare confirmation claim
    # No Stripe call of any kind must happen on public submission.
    mock_stripe_provider.subscriptions.update.assert_not_called()
    mock_stripe_provider.subscriptions.cancel.assert_not_called()

    with billing_app.app_context():
        stored = cancel_requests_store.get_cancel_request(data['request_id'])
        assert stored['status'] == 'submitted'
        assert stored['contact_email'] == 'contact@example.com'


def test_no_authorization_header_or_login_required(client):
    """Confirms the endpoint succeeds with no Authorization header and no
    prior session/login at all — submission requires neither."""
    resp = client.post('/api/cancel-requests', json=_valid_payload(
        idempotency_key='22222222-2222-4222-8222-222222222222'))
    assert resp.status_code == 201


def test_no_account_lookup_or_enumeration_on_submit(client, billing_app):
    """A completely made-up, nonexistent account_email/username must be
    accepted identically to a real one: the endpoint performs no lookup."""
    resp = client.post('/api/cancel-requests', json=_valid_payload(
        idempotency_key='33333333-3333-4333-8333-333333333333',
        account_email='definitely-not-a-real-account@nowhere.invalid',
        username='madeupnonexistent',
    ))
    assert resp.status_code == 201
    assert resp.get_json()['status'] == 'submitted'


# ============ Idempotency ============

def test_same_idempotency_key_retry_with_identical_payload_is_not_duplicated(client):
    payload = _valid_payload(idempotency_key='44444444-4444-4444-8444-444444444444')
    first = client.post('/api/cancel-requests', json=payload)
    assert first.status_code == 201
    second = client.post('/api/cancel-requests', json=payload)
    assert second.status_code == 200  # replay, not a new resource
    assert second.get_json()['request_id'] == first.get_json()['request_id']
    assert second.get_json()['submitted_at'] == first.get_json()['submitted_at']


def test_same_idempotency_key_with_different_payload_is_rejected_not_silently_resubmitted(client):
    key = '55555555-5555-4555-8555-555555555555'
    first = client.post('/api/cancel-requests', json=_valid_payload(idempotency_key=key, reason='first reason'))
    assert first.status_code == 201
    second = client.post('/api/cancel-requests', json=_valid_payload(idempotency_key=key, reason='a different reason entirely'))
    assert second.status_code == 409
    assert second.get_json()['error'] == 'idempotency_conflict'


def test_invalid_idempotency_key_rejected(client):
    resp = client.post('/api/cancel-requests', json=_valid_payload(idempotency_key='not-a-uuid'))
    assert resp.status_code == 400
    assert resp.get_json()['error'] == 'invalid_idempotency_key'


# ============ Validation / bounds ============

def test_invalid_bounds_rejects_german_formatted_date(client):
    """German dates like 15.10.2026 must be rejected; only strict ISO
    YYYY-MM-DD is accepted even though the public page's labels are German."""
    resp = client.post('/api/cancel-requests', json=_valid_payload(
        idempotency_key='66666666-6666-4666-8666-666666666666',
        cancellation_type='requested_date', requested_date='15.10.2026',
    ))
    assert resp.status_code == 400
    assert resp.get_json()['error'] == 'invalid_requested_date'


def test_invalid_bounds_rejects_past_requested_date(client):
    yesterday = (datetime.now(timezone.utc) - timedelta(days=1)).date().isoformat()
    resp = client.post('/api/cancel-requests', json=_valid_payload(
        idempotency_key='77777777-7777-4777-8777-777777777777',
        cancellation_type='requested_date', requested_date=yesterday,
    ))
    assert resp.status_code == 400
    assert resp.get_json()['error'] == 'requested_date_must_be_future'


def test_invalid_bounds_rejects_nonexistent_calendar_date(client):
    resp = client.post('/api/cancel-requests', json=_valid_payload(
        idempotency_key='88888888-8888-4888-8888-888888888888',
        cancellation_type='requested_date', requested_date='2026-02-30',
    ))
    assert resp.status_code == 400
    assert resp.get_json()['error'] == 'invalid_requested_date'


def test_requires_at_least_one_identifying_field(client):
    resp = client.post('/api/cancel-requests', json=_valid_payload(
        idempotency_key='99999999-9999-4999-8999-999999999999',
        account_email=None, username=None, stripe_reference=None,
    ))
    assert resp.status_code == 400
    assert resp.get_json()['error'] == 'identifying_info_required'


def test_rejects_oversized_reason(client):
    resp = client.post('/api/cancel-requests', json=_valid_payload(
        idempotency_key='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        reason='x' * 2001,
    ))
    assert resp.status_code == 400
    assert resp.get_json()['error'] == 'reason_too_long'


def test_rejects_invalid_contact_email(client):
    resp = client.post('/api/cancel-requests', json=_valid_payload(
        idempotency_key='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        contact_email='not-an-email',
    ))
    assert resp.status_code == 400
    assert resp.get_json()['error'] == 'valid_contact_email_required'


def test_requested_date_cancellation_always_starts_needs_review(client, billing_app):
    future_date = (datetime.now(timezone.utc) + timedelta(days=30)).date().isoformat()
    resp = client.post('/api/cancel-requests', json=_valid_payload(
        idempotency_key='cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        cancellation_type='requested_date', requested_date=future_date,
    ))
    assert resp.status_code == 201
    assert resp.get_json()['status'] == 'needs_review'


def test_rate_limit_bounds_submissions_per_source(aws_mock):
    """5/minute per-IP limiter: exceeding it returns 429, proving bare
    public exposure doesn't allow unlimited anonymous writes. Uses a
    distinct low CANCEL_REQUEST_RATE_LIMIT config (same pattern as
    test_app.py's test_auth_login_rate_limit_is_enforced) so this test's
    counter bucket can't collide with the generous limit other tests use."""
    class LowCancelRequestRateLimitConfig(TestingConfig):
        CANCEL_REQUEST_RATE_LIMIT = "5/minute"

    app = create_app(LowCancelRequestRateLimitConfig)
    test_client = app.test_client()
    for i in range(5):
        key = f'dddddddd-dddd-4ddd-8ddd-{i:012d}'
        resp = test_client.post('/api/cancel-requests', json=_valid_payload(idempotency_key=key))
        assert resp.status_code in (200, 201)
    sixth = test_client.post('/api/cancel-requests', json=_valid_payload(
        idempotency_key='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'))
    assert sixth.status_code == 429


# ============ Operator CLI ============

def _cli_invoke(app, args):
    from click.testing import CliRunner
    runner = CliRunner()
    with app.app_context():
        return runner.invoke(app.cli, args)


def test_operator_process_requires_both_explicit_confirmation_flags(client, billing_app):
    resp = client.post('/api/cancel-requests', json=_valid_payload(
        idempotency_key='f0000000-0000-4000-8000-000000000001', username='opuser1'))
    request_id = resp.get_json()['request_id']
    result = _cli_invoke(billing_app, ['billing-admin', 'cancel-request', 'process', request_id,
                                        '--username', 'opuser1'])
    assert result.exit_code != 0  # missing --confirm-identity-reviewed/--confirm


def test_operator_process_fulfills_and_preserves_paid_gift(client, billing_app, mock_stripe_provider):
    with billing_app.app_context():
        headers = register_and_login(client, 'giftuser1', 'giftuser1@example.com', 'Pass123!')
        stable_id = models.ensure_stable_id('giftuser1')
        billing_store.put_billing_username_mapping(stable_id, 'giftuser1')
        gift_until = (datetime.now(timezone.utc) + timedelta(days=90)).isoformat()
        billing_store.put_billing_state(
            stable_id, customer_id='cus_gift1', subscription_id='sub_gift1',
            status='active', gift_until=gift_until,
        )

    mock_stripe_provider.subscriptions.update.return_value = {
        'id': 'sub_gift1', 'customer': 'cus_gift1', 'status': 'active',
        'cancel_at_period_end': True,
    }

    resp = client.post('/api/cancel-requests', json=_valid_payload(
        idempotency_key='f0000000-0000-4000-8000-000000000002', username='giftuser1'))
    assert resp.status_code == 201
    request_id = resp.get_json()['request_id']

    result = _cli_invoke(billing_app, ['billing-admin', 'cancel-request', 'process', request_id,
                                        '--username', 'giftuser1',
                                        '--confirm-identity-reviewed', '--confirm'])
    assert result.exit_code == 0, result.output
    assert '"status": "fulfilled"' in result.output

    with billing_app.app_context():
        item = cancel_requests_store.get_cancel_request(request_id)
        assert item['status'] == 'fulfilled'
        assert item['reviewed_username'] == 'giftuser1'
        assert item['reviewed_stable_id'] == stable_id
        state = billing_store.get_billing_state(stable_id)
        assert state['cancel_at_period_end'] is True
        # The gift must survive a billing cancellation untouched.
        assert state['gift_until'] == gift_until

    # Authenticated status should reflect continued access via the gift.
    status_resp = client.get('/api/billing/status', headers=headers)
    assert status_resp.get_json()['premium_access'] is True
    assert status_resp.get_json()['reason'] == 'gift'


def test_operator_process_provider_failure_retries_without_claiming_fulfilled(client, billing_app, mock_stripe_provider):
    with billing_app.app_context():
        models.create_user('flakyuser', 'flakyuser@example.com', 'hash', None)
        models.set_email_verified('flakyuser', True)
        stable_id = models.ensure_stable_id('flakyuser')
        billing_store.put_billing_username_mapping(stable_id, 'flakyuser')
        billing_store.put_billing_state(
            stable_id, customer_id='cus_flaky', subscription_id='sub_flaky', status='active',
        )

    resp = client.post('/api/cancel-requests', json=_valid_payload(
        idempotency_key='f0000000-0000-4000-8000-000000000003', username='flakyuser'))
    request_id = resp.get_json()['request_id']

    import stripe
    mock_stripe_provider.subscriptions.update.side_effect = stripe.APIError('Network error')
    first = _cli_invoke(billing_app, ['billing-admin', 'cancel-request', 'process', request_id,
                                       '--username', 'flakyuser',
                                       '--confirm-identity-reviewed', '--confirm'])
    assert first.exit_code != 0
    with billing_app.app_context():
        item = cancel_requests_store.get_cancel_request(request_id)
        assert item['status'] == 'processing'
        assert item['outcome'] is None

    mock_stripe_provider.subscriptions.update.side_effect = None
    mock_stripe_provider.subscriptions.update.return_value = {
        'id': 'sub_flaky', 'customer': 'cus_flaky', 'status': 'active', 'cancel_at_period_end': True,
    }
    second = _cli_invoke(billing_app, ['billing-admin', 'cancel-request', 'process', request_id,
                                        '--username', 'flakyuser',
                                        '--confirm-identity-reviewed', '--confirm'])
    assert second.exit_code == 0, second.output
    with billing_app.app_context():
        item = cancel_requests_store.get_cancel_request(request_id)
        assert item['status'] == 'fulfilled'


def test_operator_process_no_subscription_outcome_not_claimed_as_canceled(client, billing_app):
    """An account with no live subscription must resolve to 'no_subscription',
    never be reported as a successful cancellation."""
    with billing_app.app_context():
        models.create_user('nosubuser', 'nosubuser@example.com', 'hash', None)
        models.set_email_verified('nosubuser', True)
        models.ensure_stable_id('nosubuser')

    resp = client.post('/api/cancel-requests', json=_valid_payload(
        idempotency_key='f0000000-0000-4000-8000-000000000004', username='nosubuser'))
    request_id = resp.get_json()['request_id']

    result = _cli_invoke(billing_app, ['billing-admin', 'cancel-request', 'process', request_id,
                                        '--username', 'nosubuser',
                                        '--confirm-identity-reviewed', '--confirm'])
    assert result.exit_code == 0, result.output
    assert '"status": "no_subscription"' in result.output
    with billing_app.app_context():
        item = cancel_requests_store.get_cancel_request(request_id)
        assert item['status'] == 'no_subscription'


def test_operator_process_deleted_and_recreated_username_does_not_attach_to_old_subscription(client, billing_app, mock_stripe_provider):
    """Guards against a stale request referencing a username that was
    deleted and later re-registered by someone else: processing must act
    on the *current* account's fresh stable_id (which here has no
    subscription), never the old deleted account's subscription."""
    with billing_app.app_context():
        models.create_user('reuseduser', 'original@example.com', 'hash', None)
        models.set_email_verified('reuseduser', True)
        old_stable_id = models.ensure_stable_id('reuseduser')
        billing_store.put_billing_username_mapping(old_stable_id, 'reuseduser')
        billing_store.put_billing_state(
            old_stable_id, customer_id='cus_old', subscription_id='sub_old', status='active',
        )

    resp = client.post('/api/cancel-requests', json=_valid_payload(
        idempotency_key='f0000000-0000-4000-8000-000000000005', username='reuseduser'))
    request_id = resp.get_json()['request_id']

    with billing_app.app_context():
        models.delete_user('reuseduser')
        models.create_user('reuseduser', 'newowner@example.com', 'hash', None)
        models.set_email_verified('reuseduser', True)
        new_stable_id = models.ensure_stable_id('reuseduser')
        assert new_stable_id != old_stable_id

    result = _cli_invoke(billing_app, ['billing-admin', 'cancel-request', 'process', request_id,
                                        '--username', 'reuseduser',
                                        '--confirm-identity-reviewed', '--confirm'])
    assert result.exit_code == 0, result.output
    assert '"status": "no_subscription"' in result.output
    mock_stripe_provider.subscriptions.update.assert_not_called()
    mock_stripe_provider.subscriptions.cancel.assert_not_called()

    with billing_app.app_context():
        # The old (deleted) identity's subscription must be untouched.
        old_state = billing_store.get_billing_state(old_stable_id)
        assert old_state['subscription_id'] == 'sub_old'
        assert old_state.get('cancel_at_period_end') in (None, False)


def test_operator_process_refuses_requested_date_requests(client, billing_app):
    future_date = (datetime.now(timezone.utc) + timedelta(days=10)).date().isoformat()
    resp = client.post('/api/cancel-requests', json=_valid_payload(
        idempotency_key='f0000000-0000-4000-8000-000000000006', username='someuser',
        cancellation_type='requested_date', requested_date=future_date,
    ))
    request_id = resp.get_json()['request_id']
    result = _cli_invoke(billing_app, ['billing-admin', 'cancel-request', 'process', request_id,
                                        '--username', 'someuser',
                                        '--confirm-identity-reviewed', '--confirm'])
    assert result.exit_code != 0
    assert 'never processed by this command' in result.output or 'manually' in result.output


def test_operator_list_excludes_pii_by_default(client, billing_app):
    resp = client.post('/api/cancel-requests', json=_valid_payload(
        idempotency_key='f0000000-0000-4000-8000-000000000007',
        contact_email='secretcontact@example.com',
    ))
    assert resp.status_code == 201
    result = _cli_invoke(billing_app, ['billing-admin', 'cancel-request', 'list'])
    assert result.exit_code == 0
    assert 'secretcontact@example.com' not in result.output


def test_operator_show_reveals_pii_only_with_explicit_flag(client, billing_app):
    resp = client.post('/api/cancel-requests', json=_valid_payload(
        idempotency_key='f0000000-0000-4000-8000-000000000008',
        contact_email='pii-flagged@example.com',
    ))
    request_id = resp.get_json()['request_id']
    default_result = _cli_invoke(billing_app, ['billing-admin', 'cancel-request', 'show', request_id])
    assert 'pii-flagged@example.com' not in default_result.output
    revealed_result = _cli_invoke(billing_app, ['billing-admin', 'cancel-request', 'show', request_id, '--reveal-pii'])
    assert 'pii-flagged@example.com' in revealed_result.output


def test_operator_complete_email_blocked_until_processed(billing_app):
    with billing_app.app_context():
        item, _ = cancel_requests_store.create_cancel_request(
            'f0000000-0000-4000-8000-000000000009', 'hash123',
            {'contact_email': 'x@example.com', 'account_email': None, 'username': 'someone',
             'stripe_reference': None, 'cancellation_type': 'earliest', 'requested_date': None, 'reason': None},
            'submitted',
        )
    result = _cli_invoke(billing_app, ['billing-admin', 'cancel-request', 'complete-email',
                                        item['request_id'], '--confirm'])
    assert result.exit_code != 0


def test_operator_complete_email_sends_after_processed_and_is_retryable_on_failure(billing_app, monkeypatch):
    with billing_app.app_context():
        models.create_user('emailuser', 'emailuser@example.com', 'hash', None)
        models.set_email_verified('emailuser', True)
        models.ensure_stable_id('emailuser')
        item, _ = cancel_requests_store.create_cancel_request(
            'f0000000-0000-4000-8000-00000000000a', 'hash456',
            {'contact_email': 'ackme@example.com', 'account_email': None, 'username': 'emailuser',
             'stripe_reference': None, 'cancellation_type': 'earliest', 'requested_date': None, 'reason': None},
            'submitted',
        )
        cancel_requests_store.start_processing(
            item['request_id'], 'emailuser', models.ensure_stable_id('emailuser'), None,
        )
        cancel_requests_store.finalize(item['request_id'], 'no_subscription', {'outcome': 'no_subscription'})

    from botocore.exceptions import ClientError

    def boom(*a, **kw):
        raise ClientError(
            {'Error': {'Code': 'MessageRejected', 'Message': 'raw-pii-should-not-be-stored@example.com'}},
            'SendEmail',
        )

    monkeypatch.setattr('sites.ffm.app.mailer.send_cancel_request_ack_email', boom)
    failed = _cli_invoke(billing_app, ['billing-admin', 'cancel-request', 'complete-email',
                                        item['request_id'], '--confirm'])
    assert failed.exit_code != 0
    with billing_app.app_context():
        stored = cancel_requests_store.get_cancel_request(item['request_id'])
        assert stored['ack_email_status'] == 'failed'
        # Only the sanitized exception class/code is stored — never the
        # raw exception message, which can embed request/PII content.
        assert stored['ack_email_error'] == 'ClientError:MessageRejected'
        assert 'raw-pii-should-not-be-stored' not in stored['ack_email_error']

    sent_calls = []
    monkeypatch.setattr('sites.ffm.app.mailer.send_cancel_request_ack_email',
                         lambda *a, **kw: sent_calls.append(a))
    retried = _cli_invoke(billing_app, ['billing-admin', 'cancel-request', 'complete-email',
                                         item['request_id'], '--confirm'])
    assert retried.exit_code == 0, retried.output
    assert len(sent_calls) == 1
    with billing_app.app_context():
        stored = cancel_requests_store.get_cancel_request(item['request_id'])
        assert stored['ack_email_status'] == 'sent'


def test_operator_complete_email_non_provider_exception_propagates_uncaught(billing_app, monkeypatch):
    """A bug in mailer internals (e.g. a TypeError) must not be silently
    swallowed/misreported as a provider send failure — only
    botocore.exceptions.ClientError/BotoCoreError are caught and
    recorded; anything else propagates so it gets noticed."""
    with billing_app.app_context():
        models.create_user('bugemailuser', 'bugemailuser@example.com', 'hash', None)
        models.set_email_verified('bugemailuser', True)
        models.ensure_stable_id('bugemailuser')
        item, _ = cancel_requests_store.create_cancel_request(
            'f0000000-0000-4000-8000-00000000000b', 'hash789',
            {'contact_email': 'bugemail@example.com', 'account_email': None, 'username': 'bugemailuser',
             'stripe_reference': None, 'cancellation_type': 'earliest', 'requested_date': None, 'reason': None},
            'submitted',
        )
        cancel_requests_store.start_processing(
            item['request_id'], 'bugemailuser', models.ensure_stable_id('bugemailuser'), None,
        )
        cancel_requests_store.finalize(item['request_id'], 'no_subscription', {'outcome': 'no_subscription'})

    def bug(*a, **kw):
        raise TypeError('programming bug, not a provider failure')

    monkeypatch.setattr('sites.ffm.app.mailer.send_cancel_request_ack_email', bug)
    with pytest.raises(TypeError):
        _cli_invoke_raising(billing_app, ['billing-admin', 'cancel-request', 'complete-email',
                                           item['request_id'], '--confirm'])
    with billing_app.app_context():
        stored = cancel_requests_store.get_cancel_request(item['request_id'])
        # Never claimed/recorded as a (botocore) send failure.
        assert stored['ack_email_status'] is None


def _cli_invoke_raising(app, args):
    from click.testing import CliRunner
    runner = CliRunner()
    with app.app_context():
        return runner.invoke(app.cli, args, catch_exceptions=False)


def test_operator_complete_email_skips_redundant_send_without_resend_flag(billing_app, monkeypatch):
    with billing_app.app_context():
        models.create_user('noresenduser', 'noresenduser@example.com', 'hash', None)
        models.set_email_verified('noresenduser', True)
        models.ensure_stable_id('noresenduser')
        item, _ = cancel_requests_store.create_cancel_request(
            'f0000000-0000-4000-8000-00000000000c', 'hashabc',
            {'contact_email': 'noresend@example.com', 'account_email': None, 'username': 'noresenduser',
             'stripe_reference': None, 'cancellation_type': 'earliest', 'requested_date': None, 'reason': None},
            'submitted',
        )
        cancel_requests_store.start_processing(
            item['request_id'], 'noresenduser', models.ensure_stable_id('noresenduser'), None,
        )
        cancel_requests_store.finalize(item['request_id'], 'no_subscription', {'outcome': 'no_subscription'})

    sent_calls = []
    monkeypatch.setattr('sites.ffm.app.mailer.send_cancel_request_ack_email',
                         lambda *a, **kw: sent_calls.append(a))
    first = _cli_invoke(billing_app, ['billing-admin', 'cancel-request', 'complete-email',
                                       item['request_id'], '--confirm'])
    assert first.exit_code == 0, first.output
    assert len(sent_calls) == 1

    # Without --resend, re-running after it was already sent must not mail again.
    second = _cli_invoke(billing_app, ['billing-admin', 'cancel-request', 'complete-email',
                                        item['request_id'], '--confirm'])
    assert second.exit_code == 0, second.output
    assert len(sent_calls) == 1

    # With --resend, it is explicitly sent again.
    third = _cli_invoke(billing_app, ['billing-admin', 'cancel-request', 'complete-email',
                                       item['request_id'], '--confirm', '--resend'])
    assert third.exit_code == 0, third.output
    assert len(sent_calls) == 2


# ============ Manual outcome recording (requested_date / needs_review) ============

def test_process_refuses_requested_date_even_after_manual_processing_starts(client, billing_app):
    with billing_app.app_context():
        models.create_user('dateuser', 'dateuser@example.com', 'hash', None)
        stable_id = models.ensure_stable_id('dateuser')
    resp = client.post('/api/cancel-requests', json=_valid_payload(
        username='dateuser', cancellation_type='requested_date',
        requested_date=(datetime.now(timezone.utc) + timedelta(days=10)).date().isoformat(),
    ))
    request_id = resp.get_json()['request_id']
    with billing_app.app_context():
        cancel_requests_store.start_processing(
            request_id, 'dateuser', stable_id, None, from_status='needs_review',
        )
    result = _cli_invoke(billing_app, [
        'billing-admin', 'cancel-request', 'process', request_id,
        '--username', 'dateuser', '--confirm-identity-reviewed', '--confirm',
    ])
    assert result.exit_code != 0
    with billing_app.app_context():
        assert cancel_requests_store.get_cancel_request(request_id)['status'] == 'processing'


@pytest.mark.parametrize('effective_date', ['not-a-date', '2027-02-30'])
def test_record_manual_outcome_rejects_invalid_effective_date(billing_app, effective_date):
    result = _cli_invoke(billing_app, [
        'billing-admin', 'cancel-request', 'record-manual-outcome', 'unused-request',
        '--username', 'dateuser', '--outcome', 'fulfilled', '--effective-date', effective_date,
        '--confirm-identity-reviewed', '--confirm',
    ])
    assert result.exit_code != 0
    assert 'Invalid value for' in result.output


def test_record_manual_outcome_requires_identity_confirmation_and_confirm(client, billing_app):
    resp = client.post('/api/cancel-requests', json=_valid_payload(
        idempotency_key='f0000000-0000-4000-8000-0000000000a1', username='manualuser1',
        cancellation_type='requested_date',
        requested_date=(datetime.now(timezone.utc) + timedelta(days=10)).date().isoformat(),
    ))
    request_id = resp.get_json()['request_id']
    result = _cli_invoke(billing_app, ['billing-admin', 'cancel-request', 'record-manual-outcome', request_id,
                                        '--username', 'manualuser1', '--outcome', 'fulfilled',
                                        '--effective-date', '2027-01-01'])
    assert result.exit_code != 0  # missing --confirm-identity-reviewed/--confirm


def test_record_manual_outcome_requires_effective_date_when_fulfilled(client, billing_app):
    resp = client.post('/api/cancel-requests', json=_valid_payload(
        idempotency_key='f0000000-0000-4000-8000-0000000000a2', username='manualuser2',
        cancellation_type='requested_date',
        requested_date=(datetime.now(timezone.utc) + timedelta(days=10)).date().isoformat(),
    ))
    request_id = resp.get_json()['request_id']
    result = _cli_invoke(billing_app, ['billing-admin', 'cancel-request', 'record-manual-outcome', request_id,
                                        '--username', 'manualuser2', '--outcome', 'fulfilled',
                                        '--confirm-identity-reviewed', '--confirm'])
    assert result.exit_code != 0
    assert 'effective-date' in result.output.lower() or 'effective_date' in result.output.lower()


def test_record_manual_outcome_moves_needs_review_to_terminal_with_truthful_detail(client, billing_app):
    with billing_app.app_context():
        models.create_user('manualuser3', 'manualuser3@example.com', 'hash', None)
        models.set_email_verified('manualuser3', True)
        models.ensure_stable_id('manualuser3')
    resp = client.post('/api/cancel-requests', json=_valid_payload(
        idempotency_key='f0000000-0000-4000-8000-0000000000a3', username='manualuser3',
        cancellation_type='requested_date',
        requested_date=(datetime.now(timezone.utc) + timedelta(days=10)).date().isoformat(),
    ))
    request_id = resp.get_json()['request_id']
    assert resp.get_json()['status'] == 'needs_review'

    result = _cli_invoke(billing_app, ['billing-admin', 'cancel-request', 'record-manual-outcome', request_id,
                                        '--username', 'manualuser3', '--outcome', 'fulfilled',
                                        '--effective-date', '2027-03-15', '--provider-reference', 'sub_manual1',
                                        '--note', 'Cancelled by hand in Stripe dashboard per requester date.',
                                        '--confirm-identity-reviewed', '--confirm'])
    assert result.exit_code == 0, result.output
    with billing_app.app_context():
        item = cancel_requests_store.get_cancel_request(request_id)
        assert item['status'] == 'fulfilled'
        assert item['outcome_detail']['manual'] is True
        assert item['outcome_detail']['effective_date'] == '2027-03-15'
        assert item['outcome_detail']['provider_reference'] == 'sub_manual1'
        assert item['reviewed_username'] == 'manualuser3'


def test_record_manual_outcome_rejects_rebinding_to_different_username(client, billing_app):
    with billing_app.app_context():
        models.create_user('manualuser4', 'manualuser4@example.com', 'hash', None)
        models.set_email_verified('manualuser4', True)
        models.ensure_stable_id('manualuser4')
        models.create_user('otheruser4', 'otheruser4@example.com', 'hash', None)
        models.set_email_verified('otheruser4', True)
        models.ensure_stable_id('otheruser4')
    resp = client.post('/api/cancel-requests', json=_valid_payload(
        idempotency_key='f0000000-0000-4000-8000-0000000000a4', username='manualuser4',
        cancellation_type='requested_date',
        requested_date=(datetime.now(timezone.utc) + timedelta(days=10)).date().isoformat(),
    ))
    request_id = resp.get_json()['request_id']
    bound = _cli_invoke(billing_app, ['billing-admin', 'cancel-request', 'record-manual-outcome', request_id,
                                       '--username', 'manualuser4', '--outcome', 'no_subscription',
                                       '--confirm-identity-reviewed', '--confirm'])
    assert bound.exit_code == 0, bound.output
    different_identity = _cli_invoke(billing_app, ['billing-admin', 'cancel-request',
                                                     'record-manual-outcome', request_id,
                                                     '--username', 'otheruser4', '--outcome', 'fulfilled',
                                                     '--effective-date', '2027-01-01',
                                                     '--confirm-identity-reviewed', '--confirm'])
    assert different_identity.exit_code == 0  # already terminal → echoed as no-op, not rebound
    with billing_app.app_context():
        item = cancel_requests_store.get_cancel_request(request_id)
        assert item['reviewed_username'] == 'manualuser4'
        assert item['status'] == 'no_subscription'


def test_record_manual_outcome_rejects_automated_process_command(client, billing_app):
    """`process` must keep refusing requested_date requests even though
    `record-manual-outcome` now exists as the alternative path."""
    resp = client.post('/api/cancel-requests', json=_valid_payload(
        idempotency_key='f0000000-0000-4000-8000-0000000000a5', username='manualuser5',
        cancellation_type='requested_date',
        requested_date=(datetime.now(timezone.utc) + timedelta(days=10)).date().isoformat(),
    ))
    request_id = resp.get_json()['request_id']
    result = _cli_invoke(billing_app, ['billing-admin', 'cancel-request', 'process', request_id,
                                        '--username', 'manualuser5',
                                        '--confirm-identity-reviewed', '--confirm'])
    assert result.exit_code != 0
    assert 'record-manual-outcome' in result.output


# ============ Immutable subscription snapshot / retry safety ============

def test_process_retry_after_finalize_failure_does_not_cancel_replacement_subscription(
        client, billing_app, mock_stripe_provider, monkeypatch):
    """Simulates: operator runs `process`, the Stripe call succeeds, but
    the durable finalize() write crashes before recording the outcome
    (request stays "processing"). Before the operator reruns `process`,
    the subscriber starts a brand-new (replacement) subscription. The
    retry must detect the subscription_id mismatch against the
    originally-bound snapshot and refuse — it must NEVER cancel the new,
    unreviewed replacement subscription."""
    with billing_app.app_context():
        models.create_user('raceuser', 'raceuser@example.com', 'hash', None)
        models.set_email_verified('raceuser', True)
        stable_id = models.ensure_stable_id('raceuser')
        billing_store.put_billing_username_mapping(stable_id, 'raceuser')
        billing_store.put_billing_state(
            stable_id, customer_id='cus_race', subscription_id='sub_original', status='active',
        )

    resp = client.post('/api/cancel-requests', json=_valid_payload(
        idempotency_key='f0000000-0000-4000-8000-0000000000b1', username='raceuser'))
    request_id = resp.get_json()['request_id']

    mock_stripe_provider.subscriptions.update.return_value = {
        'id': 'sub_original', 'customer': 'cus_race', 'status': 'active', 'cancel_at_period_end': True,
    }

    original_finalize = cancel_requests_store.finalize

    def crash_finalize(*a, **kw):
        raise RuntimeError('simulated crash before durable finalize write')

    monkeypatch.setattr('sites.ffm.app.billing_admin.cancel_store.finalize', crash_finalize)
    with pytest.raises(RuntimeError):
        _cli_invoke_raising(billing_app, ['billing-admin', 'cancel-request', 'process', request_id,
                                           '--username', 'raceuser',
                                           '--confirm-identity-reviewed', '--confirm'])
    monkeypatch.setattr('sites.ffm.app.billing_admin.cancel_store.finalize', original_finalize)

    with billing_app.app_context():
        item = cancel_requests_store.get_cancel_request(request_id)
        assert item['status'] == 'processing'
        assert item['reviewed_subscription_id'] == 'sub_original'
        # The subscriber now starts a brand-new replacement subscription.
        billing_store.put_billing_state(stable_id, subscription_id='sub_replacement', status='active')

    mock_stripe_provider.subscriptions.update.reset_mock()
    retry = _cli_invoke(billing_app, ['billing-admin', 'cancel-request', 'process', request_id,
                                       '--username', 'raceuser',
                                       '--confirm-identity-reviewed', '--confirm'])
    assert retry.exit_code != 0
    assert 'record-manual-outcome' in retry.output or 'subscription' in retry.output.lower()
    mock_stripe_provider.subscriptions.cancel.assert_not_called()
    with billing_app.app_context():
        item = cancel_requests_store.get_cancel_request(request_id)
        assert item['status'] == 'processing'  # never advanced to a false "fulfilled"
        state = billing_store.get_billing_state(stable_id)
        # The replacement subscription must remain completely untouched —
        # same subscription_id and no new cancel_at_period_end write from
        # this retry (any prior value predates the replacement and is not
        # this test's concern).
        assert state['subscription_id'] == 'sub_replacement'
        mock_stripe_provider.subscriptions.update.assert_not_called()


def test_process_retry_binds_same_snapshot_and_succeeds_when_subscription_unchanged(
        client, billing_app, mock_stripe_provider):
    """A genuine retry (subscription_id unchanged) must still succeed —
    the mismatch guard only blocks retries where the actual subscription
    changed since review, not ordinary retries after a transient failure."""
    with billing_app.app_context():
        models.create_user('retryuser', 'retryuser@example.com', 'hash', None)
        models.set_email_verified('retryuser', True)
        stable_id = models.ensure_stable_id('retryuser')
        billing_store.put_billing_username_mapping(stable_id, 'retryuser')
        billing_store.put_billing_state(
            stable_id, customer_id='cus_retry', subscription_id='sub_retry', status='active',
        )

    resp = client.post('/api/cancel-requests', json=_valid_payload(
        idempotency_key='f0000000-0000-4000-8000-0000000000b2', username='retryuser'))
    request_id = resp.get_json()['request_id']

    import stripe
    mock_stripe_provider.subscriptions.update.side_effect = stripe.APIError('transient network error')
    first = _cli_invoke(billing_app, ['billing-admin', 'cancel-request', 'process', request_id,
                                       '--username', 'retryuser',
                                       '--confirm-identity-reviewed', '--confirm'])
    assert first.exit_code != 0
    with billing_app.app_context():
        item = cancel_requests_store.get_cancel_request(request_id)
        assert item['status'] == 'processing'
        assert item['reviewed_subscription_id'] == 'sub_retry'

    mock_stripe_provider.subscriptions.update.side_effect = None
    mock_stripe_provider.subscriptions.update.return_value = {
        'id': 'sub_retry', 'customer': 'cus_retry', 'status': 'active', 'cancel_at_period_end': True,
    }
    second = _cli_invoke(billing_app, ['billing-admin', 'cancel-request', 'process', request_id,
                                        '--username', 'retryuser',
                                        '--confirm-identity-reviewed', '--confirm'])
    assert second.exit_code == 0, second.output
    with billing_app.app_context():
        item = cancel_requests_store.get_cancel_request(request_id)
        assert item['status'] == 'fulfilled'


def test_process_binds_none_snapshot_when_no_subscription_at_review_time(client, billing_app, mock_stripe_provider):
    """If the reviewed identity had no subscription at review time
    (reviewed_subscription_id is None, bound explicitly rather than left
    unset), a later subscription appearing before retry must still be
    detected as a mismatch rather than silently canceled."""
    with billing_app.app_context():
        models.create_user('nonerace', 'nonerace@example.com', 'hash', None)
        models.set_email_verified('nonerace', True)
        models.ensure_stable_id('nonerace')

    resp = client.post('/api/cancel-requests', json=_valid_payload(
        idempotency_key='f0000000-0000-4000-8000-0000000000b3', username='nonerace'))
    request_id = resp.get_json()['request_id']

    original_finalize = cancel_requests_store.finalize

    def crash_finalize(*a, **kw):
        raise RuntimeError('simulated crash before durable finalize write')

    monkeypatch_target = 'sites.ffm.app.billing_admin.cancel_store.finalize'
    import sites.ffm.app.billing_admin as billing_admin_module
    billing_admin_module.cancel_store.finalize = crash_finalize
    try:
        with pytest.raises(RuntimeError):
            _cli_invoke_raising(billing_app, ['billing-admin', 'cancel-request', 'process', request_id,
                                               '--username', 'nonerace',
                                               '--confirm-identity-reviewed', '--confirm'])
    finally:
        billing_admin_module.cancel_store.finalize = original_finalize

    with billing_app.app_context():
        item = cancel_requests_store.get_cancel_request(request_id)
        assert item['status'] == 'processing'
        assert item['reviewed_subscription_id'] is None
        stable_id = models.ensure_stable_id('nonerace')
        billing_store.put_billing_username_mapping(stable_id, 'nonerace')
        billing_store.put_billing_state(
            stable_id, customer_id='cus_nonerace', subscription_id='sub_new_after_review', status='active',
        )

    retry = _cli_invoke(billing_app, ['billing-admin', 'cancel-request', 'process', request_id,
                                       '--username', 'nonerace',
                                       '--confirm-identity-reviewed', '--confirm'])
    assert retry.exit_code != 0
    mock_stripe_provider.subscriptions.cancel.assert_not_called()
    mock_stripe_provider.subscriptions.update.assert_not_called()


# ============ Authenticated route preserved ============

def test_authenticated_cancel_route_still_works_after_extraction(client, billing_app, mock_stripe_provider):
    headers = register_and_login(client, 'directcanceluser', 'directcancel@example.com', 'Pass123!')
    with billing_app.app_context():
        stable_id = models.ensure_stable_id('directcanceluser')
        billing_store.put_billing_username_mapping(stable_id, 'directcanceluser')
        billing_store.put_billing_state(
            stable_id, customer_id='cus_direct', subscription_id='sub_direct', status='active',
        )
    mock_stripe_provider.subscriptions.update.return_value = {
        'id': 'sub_direct', 'customer': 'cus_direct', 'status': 'active', 'cancel_at_period_end': True,
    }
    resp = client.post('/api/billing/cancel', headers=headers)
    assert resp.status_code == 200
    assert resp.get_json()['access']['cancel_at_period_end'] is True
