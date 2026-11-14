"""Regression tests for billing endpoints and Stripe integration."""

import os
import json
from datetime import datetime, timedelta, timezone
from unittest.mock import patch, MagicMock, ANY
import hmac
import hashlib

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
from sites.ffm.app import billing_store, models, stripe_provider
from sites.ffm.app import legal_texts
from sites.ffm.app.billing import _iso
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
    app.config['GRANDFATHER_CUTOFF'] = '2020-01-01T00:00:00+00:00'
    return app


@pytest.fixture
def client(billing_app):
    """Create a test client."""
    return billing_app.test_client()


@pytest.fixture(autouse=True)
def mock_stripe_provider(monkeypatch):
    """Auto-mock stripe_provider._client to prevent real Stripe calls."""
    mock_client = MagicMock()
    monkeypatch.setattr('sites.ffm.app.stripe_provider._client', lambda: mock_client)
    return mock_client


#: Valid Stripe Price object matching TestingConfig's STRIPE_PRICE_ID, used by
#: tests that exercise the /checkout route past the adult/terms gate (it calls
#: provider.validate_price, which previously-added tests never reached).
_VALID_PRICE = {
    'id': 'price_quarterly', 'active': True, 'currency': 'eur',
    'unit_amount': 199, 'recurring': {'interval': 'month', 'interval_count': 3},
}

#: Full, currently-valid checkout request body (adult/terms plus the two
#: versioned digital-content declarations from app/legal_texts.py). Tests
#: that need to reach past the declarations gate use this instead of
#: hand-rolling the adult_confirmed/terms_accepted dict, so a future
#: DECLARATIONS_VERSION bump only needs updating in one place.
def _valid_checkout_payload(**overrides):
    payload = {
        'adult_confirmed': True, 'terms_accepted': True,
        'declarations_version': legal_texts.DECLARATIONS_VERSION, 'declarations_language': 'de',
        'immediate_access_confirmed': True, 'withdrawal_waiver_confirmed': True,
    }
    payload.update(overrides)
    return payload


def _make_stripe_webhook_signature(payload_str, secret):
    """Create a valid Stripe webhook signature."""
    timestamp = int(datetime.now(timezone.utc).timestamp())
    signed_content = f'{timestamp}.{payload_str}'
    signature = hmac.new(
        secret.encode('utf-8'),
        signed_content.encode('utf-8'),
        hashlib.sha256
    ).hexdigest()
    return f't={timestamp},v1={signature}'


# ============ Basic status and authentication tests ============

def test_status_unauthenticated(client):
    """GET /api/billing/status without auth should return basic status."""
    response = client.get('/api/billing/status')
    assert response.status_code == 200
    data = response.get_json()
    assert 'access_control_enabled' in data
    assert 'premium_access' in data


def test_status_authenticated(client):
    """GET /api/billing/status with auth should return detailed status."""
    headers = register_and_login(client, 'user1', 'user1@example.com', 'Pass123!')
    response = client.get('/api/billing/status', headers=headers)
    assert response.status_code == 200
    data = response.get_json()
    assert 'access_control_enabled' in data
    assert 'premium_access' in data
    assert 'paid_until' in data
    assert 'gift_until' in data


@pytest.mark.parametrize('invoice_country,charge_country,expected', [
    (None, 'DE', 'DE'),
    ('FR', 'DE', 'FR'),
    (None, None, None),
])
def test_invoice_country_uses_payment_snapshot_only(billing_app, invoice_country, charge_country, expected):
    from sites.ffm.app.billing import _invoice_country

    with billing_app.app_context():
        assert _invoice_country(
            {'customer_address': {'country': invoice_country}},
            {'billing_details': {'address': {'country': charge_country}}},
        ) == expected


def test_checkout_requires_adult_confirmation(client):
    """POST /api/billing/checkout requires adult_confirmed=True."""
    headers = register_and_login(client, 'user2', 'user2@example.com', 'Pass123!')
    response = client.post('/api/billing/checkout',
                          json={'adult_confirmed': False, 'terms_accepted': True},
                          headers=headers)
    assert response.status_code == 400
    assert response.get_json()['error'] == 'adult_and_terms_confirmation_required'


def test_checkout_requires_terms_acceptance(client):
    """POST /api/billing/checkout requires terms_accepted=True."""
    headers = register_and_login(client, 'user3', 'user3@example.com', 'Pass123!')
    response = client.post('/api/billing/checkout',
                          json={'adult_confirmed': True, 'terms_accepted': False},
                          headers=headers)
    assert response.status_code == 400
    assert response.get_json()['error'] == 'adult_and_terms_confirmation_required'


def test_redeem_requires_verification(client):
    """POST /api/billing/redeem requires verified email."""
    response = client.post('/api/billing/redeem',
                          json={'code': 'TESTCODE123'})
    assert response.status_code == 401


def test_redeem_invalid_code_format(client):
    """POST /api/billing/redeem with invalid code format should fail."""
    headers = register_and_login(client, 'user5', 'user5@example.com', 'Pass123!')
    response = client.post('/api/billing/redeem',
                          json={'code': ''},
                          headers=headers)
    assert response.status_code == 400


def test_create_access_code(client, billing_app):
    """Creating and validating access codes."""
    with billing_app.app_context():
        code, code_hash = billing_store.create_access_code(months=3)
        assert len(code) == 32
        assert code.isupper()

        code_state = billing_store.get_code_state(code_hash)
        assert code_state is not None
        assert code_state['months_grant'] == 3
        assert code_state['redeemed_by'] is None


def test_revoke_code(client, billing_app):
    """Revoking access codes."""
    with billing_app.app_context():
        code, code_hash = billing_store.create_access_code(months=3)
        result = billing_store.revoke_code(code_hash)
        assert result is True

        code_state = billing_store.get_code_state(code_hash)
        assert code_state['revoked'] is True


def test_webhook_signature_verification_invalid(client, billing_app):
    """POST /api/billing/webhook rejects invalid signatures."""
    event_data = {
        'type': 'charge.succeeded',
        'id': 'evt_test123',
        'data': {'object': {'id': 'ch_test123'}}
    }
    payload_str = json.dumps(event_data)
    bad_signature = 't=123,v1=invalid'

    response = client.post('/api/billing/webhook',
                          data=payload_str,
                          content_type='application/json',
                          headers={'Stripe-Signature': bad_signature})

    assert response.status_code == 400
    assert response.get_json()['error'] == 'invalid_webhook_signature'


@pytest.mark.parametrize('reason', ['billing_busy', 'billing_conflict', 'version_mismatch'])
def test_webhook_retryable_conflict_logs_sanitized_warning(client, billing_app, monkeypatch, caplog, reason):
    """A retryable ValueError from process_event returns 503 and logs a
    warning with only the known, allow-listed reason and the event id --
    never the raw event payload, headers, or any secret."""
    from sites.ffm.app import billing

    def fake_process_event(event):
        raise ValueError(reason)

    monkeypatch.setattr(billing, 'process_event', fake_process_event)
    event_data = {
        'type': 'charge.dispute.created',
        'id': 'evt_1UQnPsDYFrEur0X906nvAXLq',
        'data': {'object': {'id': 'ch_test123', 'top_secret_field': 'should-not-be-logged'}},
    }
    payload_str = json.dumps(event_data)
    signature = _make_stripe_webhook_signature(payload_str, 'whsec_test_1234567890')

    with caplog.at_level('WARNING'):
        response = client.post('/api/billing/webhook', data=payload_str, content_type='application/json',
                               headers={'Stripe-Signature': signature})

    assert response.status_code == 503
    assert response.get_json()['error'] == 'billing_retry_required'
    warnings = [r for r in caplog.records if r.levelname == 'WARNING']
    assert len(warnings) == 1
    message = warnings[0].getMessage()
    assert reason in message
    assert 'evt_1UQnPsDYFrEur0X906nvAXLq' in message
    assert 'top_secret_field' not in message
    assert 'should-not-be-logged' not in message


def test_webhook_non_retryable_conflict_does_not_log_warning(client, billing_app, monkeypatch, caplog):
    """A ValueError reason outside the retryable allow-list is re-raised
    (existing behavior) and must not produce the retry warning log."""
    from sites.ffm.app import billing

    def fake_process_event(event):
        raise ValueError('some_unexpected_reason')

    monkeypatch.setattr(billing, 'process_event', fake_process_event)
    event_data = {
        'type': 'charge.dispute.created',
        'id': 'evt_other',
        'data': {'object': {'id': 'ch_test123'}},
    }
    payload_str = json.dumps(event_data)
    signature = _make_stripe_webhook_signature(payload_str, 'whsec_test_1234567890')
    billing_app.config['PROPAGATE_EXCEPTIONS'] = False
    billing_app.config['TESTING'] = False

    with caplog.at_level('WARNING'):
        response = client.post('/api/billing/webhook', data=payload_str, content_type='application/json',
                               headers={'Stripe-Signature': signature})

    assert response.status_code == 500
    assert not [r for r in caplog.records if r.levelname == 'WARNING']


# ============ REGRESSION TEST 1: Grandfather subscription cutoff ============

def test_grandfather_cannot_checkout_before_cutoff(client, billing_app):
    """Regression 1: Users with created_at before GRANDFATHER_CUTOFF
    should get 409 on checkout, grandfather status true, persist after cutoff change."""
    with billing_app.app_context():
        headers = register_and_login(client, 'olduser', 'olduser@example.com', 'Pass123!')
        user = models.get_user('olduser')

        # Set created_at to 2019-01-01 (before 2020-01-01 cutoff)
        old_time = '2019-01-01T00:00:00+00:00'
        ddb = boto3.resource('dynamodb', region_name='eu-central-1')
        users_table = ddb.Table('ffm-users-test')
        users_table.update_item(
            Key={'pk': f'USER#{user["username"]}', 'sk': 'PROFILE'},
            UpdateExpression='SET created_at = :dt',
            ExpressionAttributeValues={':dt': old_time}
        )

        # Re-fetch to verify
        user = models.get_user('olduser')
        assert user['created_at'] < billing_app.config['GRANDFATHER_CUTOFF']

    # Try checkout with grandfather user
    response = client.post('/api/billing/checkout',
                          json=_valid_checkout_payload(),
                          headers=headers)

    # Should return 409 subscription_not_needed
    assert response.status_code == 409
    assert response.get_json()['error'] == 'subscription_not_needed'

    # Status should show grandfathered
    status_resp = client.get('/api/billing/status', headers=headers)
    assert status_resp.status_code == 200
    assert status_resp.get_json()['reason'] == 'grandfathered'


# ============ REGRESSION TEST 2: Invoice webhook with UUID mapping ============

@pytest.mark.parametrize('invoice_schema', ['legacy', 'parent'])
@pytest.mark.parametrize('invoice_country', ['DE', None])
def test_paid_gift_extends_from_paid_until_exact_dates(client, billing_app, mock_stripe_provider, monkeypatch, invoice_schema, invoice_country):
    """Regression 2: Fixed-date E2E test with exact invoicing, dual redemptions,
    calendar month extension, trial_end matching gift_until, and code consumption."""
    with billing_app.app_context():
        headers = register_and_login(client, 'giftpaiduser', 'giftpaid@example.com', 'Pass123!')
        stable_id = models.ensure_stable_id('giftpaiduser')
        billing_store.put_billing_username_mapping(stable_id, 'giftpaiduser')

        code1, code1_hash = billing_store.create_access_code(months=3)
        code2, code2_hash = billing_store.create_access_code(months=3)

        billing_store.put_billing_state(
            stable_id,
            customer_id='cus_paid_gift',
            subscription_id='sub_paid_gift',
            status='active'
        )

        monkeypatch.setattr(billing_store, '_now_utc', lambda: '2030-01-01T00:00:00+00:00')
        paid_until_ts = int(datetime(2030, 1, 31, tzinfo=timezone.utc).timestamp())
        first_end = datetime(2030, 4, 30, tzinfo=timezone.utc)
        second_end = datetime(2030, 7, 30, tzinfo=timezone.utc)

        sub_dict = {
            'id': 'sub_paid_gift',
            'customer': 'cus_paid_gift',
            'status': 'active',
            'metadata': {'billing_uuid': stable_id},
            'items': {'data': [{'price': {'id': 'price_quarterly'}}]},
            'cancel_at_period_end': False,
            'cancel_at': None,
            'current_period_end': paid_until_ts,
            'trial_end': None,
        }
        mock_stripe_provider.subscriptions.retrieve.return_value = sub_dict

        # Mock list_customer_subscriptions
        mock_stripe_provider.subscriptions.list.return_value.auto_paging_iter.return_value = [sub_dict]

        # Mock paid invoices with EUR300 DE charge
        invoice = {
            'id': 'inv_paid_gift',
            'customer': 'cus_paid_gift',
            'subscription': 'sub_paid_gift',
            'status': 'paid',
            'currency': 'eur',
            'amount_paid': 300,
            'paid': True,
            'customer_address': {'country': invoice_country},
            'charge': 'ch_paid_gift',
            'lines': {'data': [{
                'price': {'id': 'price_quarterly'},
                'period': {'end': paid_until_ts},
                'proration': False
            }]},
        }
        mock_stripe_provider.invoices.list.return_value.auto_paging_iter.return_value = [invoice]

        # Mock charge - valid paid proof
        mock_stripe_provider.charges.retrieve.return_value = {
            'id': 'ch_paid_gift',
            'paid': True,
            'refunded': False,
            'amount_refunded': 0,
            'disputed': False,
            'billing_details': {'address': {'country': 'DE'}},
        }

        mock_stripe_provider.invoices.retrieve.return_value = invoice
        event_invoice = invoice if invoice_schema == 'legacy' else {
            'id': invoice['id'],
            'parent': {'type': 'subscription_details',
                       'subscription_details': {'subscription': 'sub_paid_gift'}},
        }
        event_data = {
            'id': 'evt_paid_gift', 'type': 'invoice.payment_succeeded',
            'data': {'object': event_invoice},
        }
        payload = json.dumps(event_data)
        signature = _make_stripe_webhook_signature(payload, billing_app.config['STRIPE_WEBHOOK_SECRET'])
        response = client.post('/api/billing/webhook', data=payload,
                               content_type='application/json',
                               headers={'Stripe-Signature': signature})
        assert response.status_code == 200
        if invoice_schema == 'parent':
            mock_stripe_provider.invoices.retrieve.assert_called_once_with('inv_paid_gift')
        assert billing_store.get_billing_state(stable_id)['paid_until'] == '2030-01-31T00:00:00+00:00'

        first_updated = dict(sub_dict)
        first_updated['trial_end'] = int(first_end.timestamp())

        mock_stripe_provider.subscriptions.update.return_value = first_updated

        # First redemption
        response = client.post('/api/billing/redeem',
                              json={'code': code1},
                              headers=headers)
        assert response.status_code == 200
        data = response.get_json()
        gift1_actual = datetime.fromisoformat(data['gift_until'].replace('Z', '+00:00'))
        assert gift1_actual == first_end

        # Verify code1 is redeemed
        code1_state = billing_store.get_code_state(code1_hash)
        assert code1_state['redeemed_by'] == stable_id

        # Verify next_payment_at matches gift_until
        state = billing_store.get_billing_state(stable_id)
        next_payment_actual = models._parse_timestamp(state['next_payment_at'])
        assert next_payment_actual == gift1_actual

        # Verify subscriptions.update was called with trial_end
        update_calls = mock_stripe_provider.subscriptions.update.call_args_list
        assert len(update_calls) == 1
        # update is called with (subscription_id, {trial_end: ...}, options={...})
        first_call_params = update_calls[-1][0][1]
        first_call_trial_end = first_call_params.get('trial_end')
        assert first_call_trial_end == int(gift1_actual.timestamp())

        # Update mock for second redemption
        second_updated = dict(sub_dict)
        second_updated['trial_end'] = int(second_end.timestamp())
        mock_stripe_provider.subscriptions.retrieve.return_value = first_updated
        mock_stripe_provider.subscriptions.list.return_value.auto_paging_iter.return_value = [first_updated]
        mock_stripe_provider.subscriptions.update.return_value = second_updated

        # Second redemption
        response = client.post('/api/billing/redeem',
                              json={'code': code2},
                              headers=headers)
        assert response.status_code == 200
        data = response.get_json()
        gift2_actual = datetime.fromisoformat(data['gift_until'].replace('Z', '+00:00'))

        # Verify code2 consumed
        code2_state = billing_store.get_code_state(code2_hash)
        assert code2_state['redeemed_by'] == stable_id

        assert gift2_actual == second_end
        state = billing_store.get_billing_state(stable_id)
        assert models._parse_timestamp(state['next_payment_at']) == second_end
        assert mock_stripe_provider.subscriptions.update.call_count == 2
        assert mock_stripe_provider.subscriptions.update.call_args.args[1]['trial_end'] == int(second_end.timestamp())


# ============ REGRESSION TEST 3: Failed renewal (past_due status) ============

def test_failed_renewal_no_future_access(client, billing_app, mock_stripe_provider):
    """Regression 3: Failed renewal with mocked latest status past_due,
    no invoices beyond existing, old invoice periodexpired => no future access."""
    with billing_app.app_context():
        headers = register_and_login(client, 'pastdueuser', 'pastdue@example.com', 'Pass123!')
        user = models.get_user('pastdueuser')
        stable_id = models.ensure_stable_id('pastdueuser')

        billing_store.put_billing_username_mapping(stable_id, 'pastdueuser')
        billing_store.put_billing_state(
            stable_id,
            customer_id='cus_past_due',
            subscription_id='sub_past_due',
            status='past_due'
        )

    # Mock subscription as past_due (renewal failed)
    mock_stripe_provider.subscriptions.retrieve.return_value = {
        'id': 'sub_past_due',
        'customer': 'cus_past_due',
        'status': 'past_due',
        'metadata': {'billing_uuid': stable_id},
        'items': {'data': [{'price': {'id': 'price_quarterly'}}]},
        'cancel_at_period_end': False,
        'cancel_at': None,
        'current_period_end': int((datetime.now(timezone.utc) - timedelta(days=1)).timestamp()),
        'trial_end': None,
    }

    # No paid invoices
    mock_stripe_provider.invoices.list.return_value.auto_paging_iter.return_value = []

    # Trigger reconciliation via webhook
    event_data = {
        'type': 'invoice.payment_failed',
        'id': 'evt_past_due_123',
        'data': {
            'object': {
                'id': 'inv_failed',
                'subscription': 'sub_past_due',
            }
        }
    }

    payload_str = json.dumps(event_data)
    signature = _make_stripe_webhook_signature(payload_str, billing_app.config['STRIPE_WEBHOOK_SECRET'])

    response = client.post('/api/billing/webhook',
                          data=payload_str,
                          content_type='application/json',
                          headers={'Stripe-Signature': signature})

    assert response.status_code == 200

    # Check status - should not have premium access
    status_resp = client.get('/api/billing/status', headers=headers)
    assert status_resp.status_code == 200
    status_data = status_resp.get_json()
    assert status_data['premium_access'] is False


# ============ REGRESSION TEST 4: Redemption with gift period ============

def test_redemption_grants_exact_six_month_future(client, billing_app, mock_stripe_provider):
    """Regression 4: Redemption paid - exact future paid UTC, codes same frozen clock,
    provider live, gift targets 6 months from paid, next_payment +3."""
    with billing_app.app_context():
        # Create user
        headers = register_and_login(client, 'giftuser', 'gift@example.com', 'Pass123!')
        user = models.get_user('giftuser')
        stable_id = models.ensure_stable_id('giftuser')

        # Create and setup billing state
        billing_store.put_billing_username_mapping(stable_id, 'giftuser')

        # Create a redemption code
        code, code_hash = billing_store.create_access_code(months=3)

        # Setup subscription state (already paid, no gift)
        billing_store.put_billing_state(
            stable_id,
            customer_id='cus_gift',
            subscription_id='sub_gift',
            status='active'
        )

        # Mock subscription as active - must return plain dict, not MagicMock
        now_ts = int(datetime.now(timezone.utc).timestamp())
        sub_dict = {
            'id': 'sub_gift',
            'customer': 'cus_gift',
            'status': 'active',
            'metadata': {'billing_uuid': stable_id},
            'items': {'data': [{'price': {'id': 'price_quarterly'}}]},
            'cancel_at_period_end': False,
            'cancel_at': None,
            'current_period_end': now_ts + 90 * 86400,
            'trial_end': None,
        }
        mock_stripe_provider.subscriptions.retrieve.return_value = sub_dict

        # Mock postpone_renewal
        postponed_sub = dict(sub_dict)
        postponed_sub['trial_end'] = now_ts + 90 * 86400
        mock_stripe_provider.subscriptions.update.return_value = postponed_sub

    # Redeem code
    response = client.post('/api/billing/redeem',
                          json={'code': code},
                          headers=headers)

    assert response.status_code == 200
    data = response.get_json()
    assert 'gift_until' in data

    # Verify gift_until is approximately 90 days (3 months) in future
    gift_ts = datetime.fromisoformat(data['gift_until'].replace('Z', '+00:00')).timestamp()
    now_ts_check = datetime.now(timezone.utc).timestamp()
    diff_days = (gift_ts - now_ts_check) / 86400
    assert 88 < diff_days < 93  # Allow 2+ day margin for calendar month calculation


# ============ REGRESSION TEST 5: Provider failure leaves code unconsumed ============

def test_provider_failure_leaves_code_unconsumed(client, billing_app, mock_stripe_provider):
    """Regression 5: Provider failure postpone leaves pending code+OP unconsumed,
    recovery without code completes exactly one grant, clears pending, not double 3m."""
    with billing_app.app_context():
        headers = register_and_login(client, 'failuser', 'fail@example.com', 'Pass123!')
        user = models.get_user('failuser')
        stable_id = models.ensure_stable_id('failuser')

        billing_store.put_billing_username_mapping(stable_id, 'failuser')

        code, code_hash = billing_store.create_access_code(months=3)

        billing_store.put_billing_state(
            stable_id,
            customer_id='cus_fail',
            subscription_id='sub_fail',
            status='active'
        )

        # Mock subscription
        now_ts = int(datetime.now(timezone.utc).timestamp())
        mock_sub = {
            'id': 'sub_fail',
            'customer': 'cus_fail',
            'status': 'active',
            'metadata': {'billing_uuid': stable_id},
            'items': {'data': [{'price': {'id': 'price_quarterly'}}]},
            'cancel_at_period_end': False,
            'cancel_at': None,
            'current_period_end': now_ts + 90 * 86400,
            'trial_end': None,
        }
        mock_stripe_provider.subscriptions.retrieve.return_value = mock_sub
        mock_stripe_provider.subscriptions.list.return_value.auto_paging_iter.return_value = [mock_sub]

        # Make postpone_renewal fail
        mock_stripe_provider.subscriptions.update.side_effect = stripe.APIError('Network error')

    # Try redeem - should fail with Stripe error
    response = client.post('/api/billing/redeem',
                          json={'code': code},
                          headers=headers)

    # Should return 503 provider unavailable
    assert response.status_code == 503

    # Code should still be unredeemed but pending_op_id set
    with billing_app.app_context():
        code_state = billing_store.get_code_state(code_hash)
        assert code_state['redeemed_by'] is None
        assert code_state.get('pending_op_id') is not None

        state = billing_store.get_billing_state(stable_id)
        assert state.get('pending_redemption') is not None

    # Clear error and recover (no code provided in body)
    with billing_app.app_context():
        mock_stripe_provider.subscriptions.update.side_effect = None
        operation_id = state['pending_redemption']
        operation = billing_store.get_operation(operation_id)
        target = operation['target_gift_until']
        expected_trial_end = int(models._parse_timestamp(target).timestamp())
        mock_sub_recovered = dict(mock_sub)
        mock_sub_recovered['trial_end'] = expected_trial_end
        mock_stripe_provider.subscriptions.update.return_value = mock_sub_recovered

    response = client.post('/api/billing/recover', headers=headers)
    assert response.status_code == 200
    data = response.get_json()
    assert data['access'] is not None

    # Verify exactly one completed grant, pending cleared, not double-extended
    with billing_app.app_context():
        # Code should now be redeemed
        code_state = billing_store.get_code_state(code_hash)
        assert code_state['redeemed_by'] == stable_id

        # State should not have pending_redemption anymore
        state = billing_store.get_billing_state(stable_id)
        assert state.get('pending_redemption') is None

        assert state['gift_until'] == target
        assert int(models._parse_timestamp(state['next_payment_at']).timestamp()) == expected_trial_end
        assert billing_store.get_operation(operation_id)['completed'] is True
    updates_before = mock_stripe_provider.subscriptions.update.call_count
    response = client.post('/api/billing/recover', headers=headers)
    assert response.status_code == 200
    assert response.get_json()['access']['gift_until'] == target
    assert mock_stripe_provider.subscriptions.update.call_count == updates_before


# ============ REGRESSION TEST 6: Account deletion cancels subscription ============

def test_account_deletion_cancels_and_tombstones(client, billing_app, mock_stripe_provider):
    """Regression 6: Account deletion - actual local DELETE profile,
    provider list customer includes active sub, cancel raises StripeAPIError => 503."""
    with billing_app.app_context():
        headers = register_and_login(client, 'deluser', 'del@example.com', 'Pass123!')
        user = models.get_user('deluser')
        stable_id = models.ensure_stable_id('deluser')

        billing_store.put_billing_username_mapping(stable_id, 'deluser')
        billing_store.put_billing_state(
            stable_id,
            customer_id='cus_del',
            subscription_id='sub_del',
            status='active'
        )

        # Mock list_customer_subscriptions to return active sub
        mock_stripe_provider.subscriptions.list.return_value.auto_paging_iter.return_value = [
            {
                'id': 'sub_del',
                'customer': 'cus_del',
                'status': 'active',
                'metadata': {'billing_uuid': stable_id},
                'items': {'data': [{'price': {'id': 'price_quarterly'}}]},
            }
        ]

        # Mock cancel to raise StripeAPIError
        mock_stripe_provider.subscriptions.cancel.side_effect = stripe.APIError('Subscription not found')

    # Try to delete account via profile endpoint with current password
    response = client.delete('/api/profile',
                            json={'current_password': 'Pass123!'},
                            headers=headers)

    # Should return 503 when cancel fails
    assert response.status_code == 503


# ============ REGRESSION TEST 7: Code expires while checkout open ============

def test_code_expires_before_grant_checkout_open(client, billing_app, mock_stripe_provider):
    """Regression 7: Code while open checkout expires before grant.
    Open checkout is expired, subsequent paid state re-fetch catches paid."""
    with billing_app.app_context():
        headers = register_and_login(client, 'expireuser', 'expire@example.com', 'Pass123!')
        user = models.get_user('expireuser')
        stable_id = models.ensure_stable_id('expireuser')

        billing_store.put_billing_username_mapping(stable_id, 'expireuser')

        # Create code with short expiry
        expiry_time = (datetime.now(timezone.utc) + timedelta(seconds=1)).isoformat()
        code, code_hash = billing_store.create_access_code(months=3, expires_at=expiry_time)

        billing_store.put_billing_state(
            stable_id,
            customer_id='cus_expire',
            checkout_session_id='cs_open123',
            checkout_operation='op_expire'
        )

        # Mock get_checkout to return open session
        mock_stripe_provider.checkout.sessions.retrieve.return_value = {
            'id': 'cs_open123',
            'status': 'open',
            'url': 'https://checkout.stripe.com/pay/cs_open123'
        }

        # Mock expire_checkout
        mock_stripe_provider.checkout.sessions.expire.return_value = {
            'id': 'cs_open123',
            'status': 'expired',
        }

    # Wait for code to expire
    import time
    time.sleep(2)

    # Try to redeem expired code - should fail
    response = client.post('/api/billing/redeem',
                          json={'code': code},
                          headers=headers)

    # Expired codes return 400 error
    assert response.status_code == 400
    assert response.get_json()['error'] == 'expired'


# ============ REGRESSION TEST 8: Admin CLI billing-admin commands ============

def test_admin_create_code_cli(billing_app):
    """Regression 8: Admin Flask CLI create-code uses moto, hashed no billing calls."""
    from click.testing import CliRunner

    runner = CliRunner()

    with billing_app.app_context():
        # Get the CLI group
        result = runner.invoke(billing_app.cli, ['billing-admin', 'create-code'])

        assert result.exit_code == 0
        data = json.loads(result.output)
        assert 'code' in data
        assert 'code_hash' in data
        assert data['months'] == 3

        # Verify code is hashed in DB (no Stripe calls)
        code_hash = data['code_hash']
        code_state = billing_store.get_code_state(code_hash)
        assert code_state is not None
        assert code_state['months_grant'] == 3


def test_admin_revoke_code_cli(billing_app):
    """Admin revoke-code CLI command."""
    from click.testing import CliRunner

    runner = CliRunner()

    with billing_app.app_context():
        code, code_hash = billing_store.create_access_code(months=3)

        result = runner.invoke(billing_app.cli, ['billing-admin', 'revoke-code', code_hash])

        assert result.exit_code == 0
        assert 'Code revoked' in result.output

        # Verify revoked
        code_state = billing_store.get_code_state(code_hash)
        assert code_state['revoked'] is True


# ============ REGRESSION TEST 9: Foreign invoice.paid refunds triggering invoice only ============

def test_foreign_invoice_paid_refunds_only_triggering_invoice(client, billing_app, mock_stripe_provider):
    """Regression 9: Foreign invoice.paid event refunds ONLY triggering invoice,
    not all historical. Canonical invoice fetch validates subscription/customer match.
    Deterministic invoice-based refund idempotency. Preserve prior valid paid_until."""
    with billing_app.app_context():
        headers = register_and_login(client, 'foreignuser1', 'foreign1@example.com', 'Pass123!')
        user = models.get_user('foreignuser1')
        stable_id = models.ensure_stable_id('foreignuser1')

        billing_store.put_billing_username_mapping(stable_id, 'foreignuser1')

        # Setup: subscription with one paid invoice (DE, valid)
        # and one paid invoice in AT (foreign, triggering refund)
        billing_store.put_billing_state(
            stable_id,
            customer_id='cus_foreign1',
            subscription_id='sub_foreign1',
            status='active'
        )

    now_ts = int(datetime.now(timezone.utc).timestamp())

    # Mock subscription
    mock_stripe_provider.subscriptions.retrieve.return_value = {
        'id': 'sub_foreign1',
        'customer': 'cus_foreign1',
        'status': 'active',
        'metadata': {'billing_uuid': stable_id},
        'items': {'data': [{'price': {'id': 'price_quarterly'}}]},
        'cancel_at_period_end': False,
        'cancel_at': None,
        'current_period_end': now_ts + 90 * 86400,
        'trial_end': None,
    }

    # Mock list_paid_invoices to return prior DE invoice (not refunded)
    mock_stripe_provider.invoices.list.return_value.auto_paging_iter.return_value = [
        {
            'id': 'inv_de_valid',
            'customer': 'cus_foreign1',
            'subscription': 'sub_foreign1',
            'status': 'paid',
            'currency': 'eur',
            'amount_paid': 300,
            'paid': True,
            'customer_address': {'country': 'DE'},
            'charge': 'ch_de_valid',
            'lines': {'data': [{'price': {'id': 'price_quarterly'}, 'period': {'end': now_ts + 90*86400}, 'proration': False}]},
        }
    ]

    # Mock charge for DE invoice (not refunded)
    def get_charge_side_effect(charge_id):
        if charge_id == 'ch_de_valid':
            return {
                'id': 'ch_de_valid',
                'subscription': 'sub_foreign1',
                'paid': True,
                'refunded': False,
                'amount_refunded': 0,
                'disputed': False,
                'amount': 300,
                'invoice': 'inv_de_valid',
            }
        elif charge_id == 'ch_at_foreign':
            return {
                'id': 'ch_at_foreign',
                'subscription': 'sub_foreign1',
                'paid': True,
                'refunded': False,
                'amount_refunded': 0,
                'disputed': False,
                'amount': 300,
                'invoice': 'inv_at_foreign',
            }
        return {}

    mock_stripe_provider.charges.retrieve.side_effect = get_charge_side_effect

    # Mock get_invoice for canonical invoice fetch (triggering invoice)
    def get_invoice_side_effect(invoice_id):
        if invoice_id == 'inv_at_foreign':
            return {
                'id': 'inv_at_foreign',
                'customer': 'cus_foreign1',
                'subscription': 'sub_foreign1',
                'status': 'paid',
                'currency': 'eur',
                'amount_paid': 300,
                'paid': True,
                'customer_address': {'country': 'AT'},
                'charge': 'ch_at_foreign',
            }
        return {}

    mock_stripe_provider.invoices.retrieve.side_effect = get_invoice_side_effect

    # Mock refund_charge
    refund_calls = []
    def refund_charge_side_effect(charge_dict, **kwargs):
        # charge_dict is {'charge': charge_id, 'amount': amount}
        refund_calls.append({
            'charge_id': charge_dict['charge'],
            'amount': charge_dict['amount'],
            'operation_id': kwargs.get('options', {}).get('idempotency_key')
        })
        return {'id': f'ref_{charge_dict["charge"]}', 'amount': charge_dict['amount']}

    mock_stripe_provider.refunds.create.side_effect = refund_charge_side_effect

    # Create foreign invoice.paid webhook event
    event_data = {
        'type': 'invoice.paid',
        'id': 'evt_foreign_inv_1',
        'data': {
            'object': {
                'id': 'inv_at_foreign',
                'subscription': 'sub_foreign1',
                'customer': 'cus_foreign1',
                'amount_paid': 300,
                'currency': 'eur',
                'customer_address': {'country': 'AT'},
                'charge': 'ch_at_foreign',
            }
        }
    }

    payload_str = json.dumps(event_data)
    signature = _make_stripe_webhook_signature(payload_str, billing_app.config['STRIPE_WEBHOOK_SECRET'])

    response = client.post('/api/billing/webhook',
                          data=payload_str,
                          content_type='application/json',
                          headers={'Stripe-Signature': signature})

    assert response.status_code == 200

    # Verify only triggering invoice was refunded (once)
    assert len(refund_calls) == 1
    assert refund_calls[0]['charge_id'] == 'ch_at_foreign'
    assert refund_calls[0]['amount'] == 300
    assert 'ineligible-refund-inv_at_foreign' == refund_calls[0]['operation_id']

    # Verify state was updated with preserved paid_until
    with billing_app.app_context():
        state = billing_store.get_billing_state(stable_id)
        assert state['status'] == 'canceled'
        assert state['revocation'] is False
        assert state['paid_until'] is not None  # DE invoice should still count
    status = client.get('/api/billing/status', headers=headers).get_json()
    assert status['premium_access'] is True
    assert status['reason'] == 'paid'


def test_foreign_invoice_payment_succeeded_refunds_only_triggering_invoice(client, billing_app, mock_stripe_provider):
    """Regression 10: Foreign invoice.payment_succeeded event refunds ONLY triggering invoice.
    Same deterministic idempotency and validation as invoice.paid."""
    with billing_app.app_context():
        headers = register_and_login(client, 'foreignuser2', 'foreign2@example.com', 'Pass123!')
        user = models.get_user('foreignuser2')
        stable_id = models.ensure_stable_id('foreignuser2')

        billing_store.put_billing_username_mapping(stable_id, 'foreignuser2')
        billing_store.put_billing_state(
            stable_id,
            customer_id='cus_foreign2',
            subscription_id='sub_foreign2',
            status='active'
        )

    now_ts = int(datetime.now(timezone.utc).timestamp())

    mock_stripe_provider.subscriptions.retrieve.return_value = {
        'id': 'sub_foreign2',
        'customer': 'cus_foreign2',
        'status': 'active',
        'metadata': {'billing_uuid': stable_id},
        'items': {'data': [{'price': {'id': 'price_quarterly'}}]},
        'cancel_at_period_end': False,
        'cancel_at': None,
        'current_period_end': now_ts + 90 * 86400,
        'trial_end': None,
    }

    mock_stripe_provider.invoices.list.return_value.auto_paging_iter.return_value = [
        {
            'id': 'inv_de_2',
            'customer': 'cus_foreign2',
            'subscription': 'sub_foreign2',
            'status': 'paid',
            'currency': 'eur',
            'amount_paid': 300,
            'paid': True,
            'customer_address': {'country': 'DE'},
            'charge': 'ch_de_2',
            'lines': {'data': [{'price': {'id': 'price_quarterly'}, 'period': {'end': now_ts + 90*86400}, 'proration': False}]},
        }
    ]

    refund_calls = []
    def refund_charge_side_effect(charge_dict, **kwargs):
        # charge_dict is {'charge': charge_id, 'amount': amount}
        refund_calls.append({
            'charge_id': charge_dict['charge'],
            'amount': charge_dict['amount'],
            'operation_id': kwargs.get('options', {}).get('idempotency_key')
        })
        return {'id': f'ref_{charge_dict["charge"]}', 'amount': charge_dict['amount']}

    mock_stripe_provider.refunds.create.side_effect = refund_charge_side_effect
    mock_stripe_provider.charges.retrieve.return_value = {
        'id': 'ch_fr_2',
        'invoice': 'inv_fr_2',
        'paid': True,
        'refunded': False,
        'amount_refunded': 0,
        'disputed': False,
        'amount': 300,
    }

    mock_stripe_provider.invoices.retrieve.return_value = {
        'id': 'inv_fr_2',
        'customer': 'cus_foreign2',
        'subscription': 'sub_foreign2',
        'status': 'paid',
        'currency': 'eur',
        'amount_paid': 300,
        'paid': True,
        'customer_address': {'country': 'FR'},
        'charge': 'ch_fr_2',
    }

    event_data = {
        'type': 'invoice.payment_succeeded',
        'id': 'evt_foreign_inv_2',
        'data': {
            'object': {
                'id': 'inv_fr_2',
                'subscription': 'sub_foreign2',
                'customer': 'cus_foreign2',
                'amount_paid': 300,
                'currency': 'eur',
                'customer_address': {'country': 'FR'},
                'charge': 'ch_fr_2',
            }
        }
    }

    payload_str = json.dumps(event_data)
    signature = _make_stripe_webhook_signature(payload_str, billing_app.config['STRIPE_WEBHOOK_SECRET'])

    response = client.post('/api/billing/webhook',
                          data=payload_str,
                          content_type='application/json',
                          headers={'Stripe-Signature': signature})

    assert response.status_code == 200

    # Verify only triggering invoice was refunded
    assert len(refund_calls) == 1
    assert refund_calls[0]['charge_id'] == 'ch_fr_2'
    assert 'ineligible-refund-inv_fr_2' == refund_calls[0]['operation_id']


def test_foreign_checkout_session_refunds_only_session_invoice(client, billing_app, mock_stripe_provider):
    """Regression 11: Foreign checkout.session.completed uses obj.invoice reference only,
    not subscription.latest_invoice (which may be stale on replay).
    Validates canonical invoice belongs to subscription/customer."""
    with billing_app.app_context():
        headers = register_and_login(client, 'foreignuser3', 'foreign3@example.com', 'Pass123!')
        user = models.get_user('foreignuser3')
        stable_id = models.ensure_stable_id('foreignuser3')

        billing_store.put_billing_username_mapping(stable_id, 'foreignuser3')
        billing_store.put_billing_state(
            stable_id,
            customer_id='cus_foreign3',
        )

    now_ts = int(datetime.now(timezone.utc).timestamp())

    mock_stripe_provider.subscriptions.retrieve.return_value = {
        'id': 'sub_foreign3',
        'customer': 'cus_foreign3',
        'status': 'active',
        'metadata': {'billing_uuid': stable_id},
        'items': {'data': [{'price': {'id': 'price_quarterly'}}]},
        'cancel_at_period_end': False,
        'cancel_at': None,
        'current_period_end': now_ts + 90 * 86400,
        'trial_end': None,
        'latest_invoice': 'inv_stale',  # Stale reference on replay - should not be used
    }

    mock_stripe_provider.invoices.list.return_value.auto_paging_iter.return_value = []

    refund_calls = []
    def refund_charge_side_effect(charge_dict, **kwargs):
        # charge_dict is {'charge': charge_id, 'amount': amount}
        refund_calls.append({
            'charge_id': charge_dict['charge'],
            'amount': charge_dict['amount'],
            'operation_id': kwargs.get('options', {}).get('idempotency_key')
        })
        return {'id': f'ref_{charge_dict["charge"]}', 'amount': charge_dict['amount']}

    mock_stripe_provider.refunds.create.side_effect = refund_charge_side_effect

    def get_invoice_side_effect(invoice_id):
        if invoice_id == 'inv_checkout_fr':
            return {
                'id': 'inv_checkout_fr',
                'customer': 'cus_foreign3',
                'subscription': 'sub_foreign3',
                'status': 'paid',
                'currency': 'eur',
                'amount_paid': 300,
                'paid': True,
                'customer_address': {'country': 'FR'},
                'charge': 'ch_checkout_fr',
            }
        return {}

    mock_stripe_provider.invoices.retrieve.side_effect = get_invoice_side_effect

    mock_stripe_provider.charges.retrieve.return_value = {
        'id': 'ch_checkout_fr',
        'invoice': 'inv_checkout_fr',
        'paid': True,
        'refunded': False,
        'amount_refunded': 0,
        'disputed': False,
        'amount': 300,
    }

    # Checkout session event with obj.invoice (not latest_invoice)
    event_data = {
        'type': 'checkout.session.completed',
        'id': 'evt_checkout_foreign',
        'data': {
            'object': {
                'id': 'cs_foreign',
                'subscription': 'sub_foreign3',
                'invoice': 'inv_checkout_fr',  # Use obj.invoice, ignore stale latest_invoice
                'customer_details': {'address': {'country': 'FR'}},
            }
        }
    }

    payload_str = json.dumps(event_data)
    signature = _make_stripe_webhook_signature(payload_str, billing_app.config['STRIPE_WEBHOOK_SECRET'])

    response = client.post('/api/billing/webhook',
                          data=payload_str,
                          content_type='application/json',
                          headers={'Stripe-Signature': signature})

    assert response.status_code == 200

    # Verify only checkout session invoice was refunded (not stale latest_invoice)
    assert len(refund_calls) == 1
    assert refund_calls[0]['charge_id'] == 'ch_checkout_fr'
    assert 'ineligible-refund-inv_checkout_fr' == refund_calls[0]['operation_id']


def test_foreign_webhook_replay_no_duplicate_refund(client, billing_app, mock_stripe_provider):
    """Regression 12: Replay of same foreign event does not duplicate refund.
    Deterministic invoice-based refund idempotency ensures retry safety."""
    with billing_app.app_context():
        headers = register_and_login(client, 'replayuser', 'replay@example.com', 'Pass123!')
        user = models.get_user('replayuser')
        stable_id = models.ensure_stable_id('replayuser')

        billing_store.put_billing_username_mapping(stable_id, 'replayuser')
        billing_store.put_billing_state(
            stable_id,
            customer_id='cus_replay',
            subscription_id='sub_replay',
            status='active'
        )

    now_ts = int(datetime.now(timezone.utc).timestamp())

    mock_stripe_provider.subscriptions.retrieve.return_value = {
        'id': 'sub_replay',
        'customer': 'cus_replay',
        'status': 'active',
        'metadata': {'billing_uuid': stable_id},
        'items': {'data': [{'price': {'id': 'price_quarterly'}}]},
        'cancel_at_period_end': False,
        'cancel_at': None,
        'current_period_end': now_ts + 90 * 86400,
        'trial_end': None,
    }

    mock_stripe_provider.invoices.list.return_value.auto_paging_iter.return_value = []

    refund_calls = []
    def refund_charge_side_effect(charge_dict, **kwargs):
        # charge_dict is {'charge': charge_id, 'amount': amount}
        refund_calls.append({
            'charge_id': charge_dict['charge'],
            'amount': charge_dict['amount'],
            'operation_id': kwargs.get('options', {}).get('idempotency_key')
        })
        return {'id': f'ref_{charge_dict["charge"]}', 'amount': charge_dict['amount']}

    mock_stripe_provider.refunds.create.side_effect = refund_charge_side_effect

    mock_stripe_provider.invoices.retrieve.return_value = {
        'id': 'inv_replay',
        'customer': 'cus_replay',
        'subscription': 'sub_replay',
        'status': 'paid',
        'currency': 'eur',
        'amount_paid': 300,
        'paid': True,
        'customer_address': {'country': 'IT'},
        'charge': 'ch_replay',
    }

    mock_stripe_provider.charges.retrieve.return_value = {
        'id': 'ch_replay',
        'invoice': 'inv_replay',
        'paid': True,
        'refunded': False,
        'amount_refunded': 0,
        'disputed': False,
        'amount': 300,
    }

    event_data = {
        'type': 'invoice.paid',
        'id': 'evt_replay_same',  # Same event ID
        'data': {
            'object': {
                'id': 'inv_replay',
                'subscription': 'sub_replay',
                'customer': 'cus_replay',
                'amount_paid': 300,
                'currency': 'eur',
                'customer_address': {'country': 'IT'},
                'charge': 'ch_replay',
            }
        }
    }

    payload_str = json.dumps(event_data)
    signature = _make_stripe_webhook_signature(payload_str, billing_app.config['STRIPE_WEBHOOK_SECRET'])

    # First webhook call
    response1 = client.post('/api/billing/webhook',
                           data=payload_str,
                           content_type='application/json',
                           headers={'Stripe-Signature': signature})
    assert response1.status_code == 200

    # Second call with same event (replay)
    response2 = client.post('/api/billing/webhook',
                           data=payload_str,
                           content_type='application/json',
                           headers={'Stripe-Signature': signature})
    assert response2.status_code == 200

    # Should only refund once (event marked as completed on first call)
    assert len(refund_calls) == 1
    assert refund_calls[0]['operation_id'] == 'ineligible-refund-inv_replay'


def test_foreign_refund_preserves_prior_valid_invoices_gift_persistence(client, billing_app, mock_stripe_provider):
    """Regression 13: Foreign refund preserves legitimately paid invoices (DE).
    Gift persistence: gift_until survives refund and cancellation."""
    with billing_app.app_context():
        headers = register_and_login(client, 'giftpersistuser', 'giftpersist@example.com', 'Pass123!')
        user = models.get_user('giftpersistuser')
        stable_id = models.ensure_stable_id('giftpersistuser')

        billing_store.put_billing_username_mapping(stable_id, 'giftpersistuser')

        # Setup: active subscription with gift, one DE invoice, and one foreign invoice
        gift_until = (datetime.now(timezone.utc) + timedelta(days=30)).isoformat()
        billing_store.put_billing_state(
            stable_id,
            customer_id='cus_gift_persist',
            subscription_id='sub_gift_persist',
            status='active',
            gift_until=gift_until
        )

    now_ts = int(datetime.now(timezone.utc).timestamp())
    de_invoice_end = now_ts + 90 * 86400

    mock_stripe_provider.subscriptions.retrieve.return_value = {
        'id': 'sub_gift_persist',
        'customer': 'cus_gift_persist',
        'status': 'active',
        'metadata': {'billing_uuid': stable_id},
        'items': {'data': [{'price': {'id': 'price_quarterly'}}]},
        'cancel_at_period_end': False,
        'cancel_at': None,
        'current_period_end': now_ts + 90 * 86400,
        'trial_end': None,
    }

    # Mock list_paid_invoices returning both DE (valid) and foreign invoices
    mock_stripe_provider.invoices.list.return_value.auto_paging_iter.return_value = [
        {
            'id': 'inv_de_gift',
            'customer': 'cus_gift_persist',
            'subscription': 'sub_gift_persist',
            'status': 'paid',
            'currency': 'eur',
            'amount_paid': 300,
            'paid': True,
            'customer_address': {'country': 'DE'},
            'charge': 'ch_de_gift',
            'lines': {'data': [{'price': {'id': 'price_quarterly'}, 'period': {'end': de_invoice_end}, 'proration': False}]},
        }
    ]

    def get_charge_side_effect(charge_id):
        if charge_id == 'ch_de_gift':
            return {
                'id': 'ch_de_gift',
                'subscription': 'sub_gift_persist',
                'paid': True,
                'refunded': False,
                'amount_refunded': 0,
                'disputed': False,
                'amount': 300,
            }
        elif charge_id == 'ch_foreign_gift':
            return {
                'id': 'ch_foreign_gift',
                'invoice': 'inv_foreign_gift',
                'paid': True,
                'refunded': False,
                'amount_refunded': 0,
                'disputed': False,
                'amount': 300,
            }
        return {}

    mock_stripe_provider.charges.retrieve.side_effect = get_charge_side_effect

    mock_stripe_provider.invoices.retrieve.return_value = {
        'id': 'inv_foreign_gift',
        'customer': 'cus_gift_persist',
        'subscription': 'sub_gift_persist',
        'status': 'paid',
        'currency': 'eur',
        'amount_paid': 300,
        'paid': True,
        'customer_address': {'country': 'ES'},
        'charge': 'ch_foreign_gift',
    }

    mock_stripe_provider.refunds.create.return_value = {'id': 'ref_foreign_gift', 'amount': 300}

    # Foreign event triggers refund
    event_data = {
        'type': 'invoice.paid',
        'id': 'evt_gift_persist',
        'data': {
            'object': {
                'id': 'inv_foreign_gift',
                'subscription': 'sub_gift_persist',
                'customer': 'cus_gift_persist',
                'amount_paid': 300,
                'currency': 'eur',
                'customer_address': {'country': 'ES'},
                'charge': 'ch_foreign_gift',
            }
        }
    }

    payload_str = json.dumps(event_data)
    signature = _make_stripe_webhook_signature(payload_str, billing_app.config['STRIPE_WEBHOOK_SECRET'])

    response = client.post('/api/billing/webhook',
                          data=payload_str,
                          content_type='application/json',
                          headers={'Stripe-Signature': signature})

    assert response.status_code == 200

    # Verify state: cancelled, but gift_until and paid_until preserved
    with billing_app.app_context():
        state = billing_store.get_billing_state(stable_id)
        assert state['status'] == 'canceled'
        assert state['revocation'] is False
        assert state['gift_until'] == gift_until  # Gift persists
        assert state['paid_until'] is not None  # DE invoice still counts


# ============ REGRESSION TEST 14: charge.refunded webhook reconciles paid_until ============

def test_charge_refunded_webhook_excludes_refunded_charge_from_paid_until(client, billing_app, mock_stripe_provider):
    """Regression 14: A direct Stripe charge.refunded event (not the foreign-ineligible
    auto-refund path) must be routed charge -> invoice -> subscription, then reconcile
    paid_until so the now-refunded invoice's period no longer counts toward access."""
    with billing_app.app_context():
        headers = register_and_login(client, 'refundeduser', 'refunded@example.com', 'Pass123!')
        stable_id = models.ensure_stable_id('refundeduser')
        billing_store.put_billing_username_mapping(stable_id, 'refundeduser')
        billing_store.put_billing_state(
            stable_id, customer_id='cus_refunded', subscription_id='sub_refunded', status='active'
        )

    now_ts = int(datetime.now(timezone.utc).timestamp())

    mock_stripe_provider.subscriptions.retrieve.return_value = {
        'id': 'sub_refunded',
        'customer': 'cus_refunded',
        'status': 'active',
        'metadata': {'billing_uuid': stable_id},
        'items': {'data': [{'price': {'id': 'price_quarterly'}}]},
        'cancel_at_period_end': False,
        'cancel_at': None,
        'current_period_end': now_ts + 90 * 86400,
        'trial_end': None,
    }

    # Only paid invoice is the one that just got refunded.
    mock_stripe_provider.invoices.list.return_value.auto_paging_iter.return_value = [
        {
            'id': 'inv_refunded',
            'customer': 'cus_refunded',
            'subscription': 'sub_refunded',
            'status': 'paid',
            'currency': 'eur',
            'amount_paid': 300,
            'paid': True,
            'customer_address': {'country': 'DE'},
            'charge': 'ch_refunded',
            'lines': {'data': [{'price': {'id': 'price_quarterly'}, 'period': {'end': now_ts + 90 * 86400}, 'proration': False}]},
        }
    ]

    # The charge is now refunded (post-refund state), so _valid_paid_end must exclude it.
    mock_stripe_provider.charges.retrieve.return_value = {
        'id': 'ch_refunded',
        'subscription': 'sub_refunded',
        'paid': True,
        'refunded': True,
        'amount_refunded': 300,
        'disputed': False,
        'amount': 300,
        'invoice': 'inv_refunded',
    }
    mock_stripe_provider.invoices.retrieve.return_value = {
        'id': 'inv_refunded',
        'customer': 'cus_refunded',
        'subscription': 'sub_refunded',
    }

    event_data = {
        'type': 'charge.refunded',
        'id': 'evt_charge_refunded_1',
        'data': {
            'object': {
                'id': 'ch_refunded',
                'invoice': 'inv_refunded',
                'refunded': True,
                'amount_refunded': 300,
            }
        }
    }
    payload_str = json.dumps(event_data)
    signature = _make_stripe_webhook_signature(payload_str, billing_app.config['STRIPE_WEBHOOK_SECRET'])

    response = client.post('/api/billing/webhook',
                          data=payload_str,
                          content_type='application/json',
                          headers={'Stripe-Signature': signature})

    assert response.status_code == 200
    mock_stripe_provider.charges.retrieve.assert_any_call('ch_refunded')
    mock_stripe_provider.invoices.retrieve.assert_any_call('inv_refunded')

    with billing_app.app_context():
        state = billing_store.get_billing_state(stable_id)
        assert state['status'] == 'active'
        assert state['paid_until'] is None  # Only paid invoice is now refunded.

    # Replay of the same event must not be reprocessed (idempotency).
    retrieve_calls_before = mock_stripe_provider.subscriptions.retrieve.call_count
    response2 = client.post('/api/billing/webhook',
                           data=payload_str,
                           content_type='application/json',
                           headers={'Stripe-Signature': signature})
    assert response2.status_code == 200
    assert mock_stripe_provider.subscriptions.retrieve.call_count == retrieve_calls_before


# ============ REGRESSION TEST 15: charge.dispute.created webhook reconciles subscription ============

def test_charge_dispute_created_webhook_excludes_disputed_charge_from_paid_until(client, billing_app, mock_stripe_provider):
    """Regression 15: A charge.dispute.created event carries a Dispute object (not a Charge),
    whose 'charge' field must be used to resolve the charge, then invoice, then subscription.
    Once disputed, the charge's invoice period must no longer count toward paid_until."""
    with billing_app.app_context():
        headers = register_and_login(client, 'disputeduser', 'disputed@example.com', 'Pass123!')
        stable_id = models.ensure_stable_id('disputeduser')
        billing_store.put_billing_username_mapping(stable_id, 'disputeduser')
        billing_store.put_billing_state(
            stable_id, customer_id='cus_disputed', subscription_id='sub_disputed', status='active'
        )

    now_ts = int(datetime.now(timezone.utc).timestamp())

    mock_stripe_provider.subscriptions.retrieve.return_value = {
        'id': 'sub_disputed',
        'customer': 'cus_disputed',
        'status': 'active',
        'metadata': {'billing_uuid': stable_id},
        'items': {'data': [{'price': {'id': 'price_quarterly'}}]},
        'cancel_at_period_end': False,
        'cancel_at': None,
        'current_period_end': now_ts + 90 * 86400,
        'trial_end': None,
    }

    mock_stripe_provider.invoices.list.return_value.auto_paging_iter.return_value = [
        {
            'id': 'inv_disputed',
            'customer': 'cus_disputed',
            'subscription': 'sub_disputed',
            'status': 'paid',
            'currency': 'eur',
            'amount_paid': 300,
            'paid': True,
            'customer_address': {'country': 'DE'},
            'charge': 'ch_disputed',
            'lines': {'data': [{'price': {'id': 'price_quarterly'}, 'period': {'end': now_ts + 90 * 86400}, 'proration': False}]},
        }
    ]

    mock_stripe_provider.charges.retrieve.return_value = {
        'id': 'ch_disputed',
        'subscription': 'sub_disputed',
        'paid': True,
        'refunded': False,
        'amount_refunded': 0,
        'disputed': True,
        'amount': 300,
        'invoice': 'inv_disputed',
    }
    mock_stripe_provider.invoices.retrieve.return_value = {
        'id': 'inv_disputed',
        'customer': 'cus_disputed',
        'subscription': 'sub_disputed',
    }

    # The actual Dispute object for this charge is still open (needs_response), so
    # the charge must stay excluded regardless of the webhook's own dispute summary.
    mock_stripe_provider.disputes.list.return_value.auto_paging_iter.return_value = [
        {'id': 'dp_test1', 'charge': 'ch_disputed', 'status': 'needs_response'},
    ]

    # Dispute objects reference the charge via a top-level 'charge' field, unlike Charge
    # objects. The webhook object here is the Dispute, not the Charge.
    event_data = {
        'type': 'charge.dispute.created',
        'id': 'evt_dispute_created_1',
        'data': {
            'object': {
                'id': 'dp_test1',
                'charge': 'ch_disputed',
                'status': 'needs_response',
            }
        }
    }
    payload_str = json.dumps(event_data)
    signature = _make_stripe_webhook_signature(payload_str, billing_app.config['STRIPE_WEBHOOK_SECRET'])

    response = client.post('/api/billing/webhook',
                          data=payload_str,
                          content_type='application/json',
                          headers={'Stripe-Signature': signature})

    assert response.status_code == 200
    mock_stripe_provider.charges.retrieve.assert_any_call('ch_disputed')
    mock_stripe_provider.invoices.retrieve.assert_any_call('inv_disputed')

    with billing_app.app_context():
        state = billing_store.get_billing_state(stable_id)
        assert state['status'] == 'active'
        assert state['paid_until'] is None  # Only paid invoice is now disputed.


# ============ REGRESSION TEST 16: charge.dispute.closed (lost) keeps charge excluded ============

def test_charge_dispute_closed_lost_keeps_charge_excluded_from_paid_until(client, billing_app, mock_stripe_provider):
    """Regression 16: When a dispute closes as 'lost', Stripe's Charge object keeps
    disputed=True (the funds were permanently reversed to the cardholder's bank). This
    is a *mocked* provider fact, not a production assumption: ``_valid_paid_end`` only
    reads whatever ``charge.disputed`` the provider reports, so a lost dispute must keep
    excluding the charge's invoice period from paid_until. Idempotent replay is also
    verified (no duplicate subscription re-fetch)."""
    with billing_app.app_context():
        register_and_login(client, 'disputelostuser', 'disputelost@example.com', 'Pass123!')
        stable_id = models.ensure_stable_id('disputelostuser')
        billing_store.put_billing_username_mapping(stable_id, 'disputelostuser')
        billing_store.put_billing_state(
            stable_id, customer_id='cus_dispute_lost', subscription_id='sub_dispute_lost', status='active'
        )

    now_ts = int(datetime.now(timezone.utc).timestamp())

    mock_stripe_provider.subscriptions.retrieve.return_value = {
        'id': 'sub_dispute_lost',
        'customer': 'cus_dispute_lost',
        'status': 'active',
        'metadata': {'billing_uuid': stable_id},
        'items': {'data': [{'price': {'id': 'price_quarterly'}}]},
        'cancel_at_period_end': False,
        'cancel_at': None,
        'current_period_end': now_ts + 90 * 86400,
        'trial_end': None,
    }

    mock_stripe_provider.invoices.list.return_value.auto_paging_iter.return_value = [
        {
            'id': 'inv_dispute_lost',
            'customer': 'cus_dispute_lost',
            'subscription': 'sub_dispute_lost',
            'status': 'paid',
            'currency': 'eur',
            'amount_paid': 300,
            'paid': True,
            'customer_address': {'country': 'DE'},
            'charge': 'ch_dispute_lost',
            'lines': {'data': [{'price': {'id': 'price_quarterly'}, 'period': {'end': now_ts + 90 * 86400}, 'proration': False}]},
        }
    ]

    # Lost dispute: funds stay with the cardholder. disputed remains True.
    mock_stripe_provider.charges.retrieve.return_value = {
        'id': 'ch_dispute_lost',
        'subscription': 'sub_dispute_lost',
        'paid': True,
        'refunded': False,
        'amount_refunded': 0,
        'disputed': True,
        'amount': 300,
        'invoice': 'inv_dispute_lost',
    }
    mock_stripe_provider.invoices.retrieve.return_value = {
        'id': 'inv_dispute_lost',
        'customer': 'cus_dispute_lost',
        'subscription': 'sub_dispute_lost',
    }
    # The actual Dispute object for this charge resolved 'lost': the charge must stay
    # excluded (a lost dispute never grants access).
    mock_stripe_provider.disputes.list.return_value.auto_paging_iter.return_value = [
        {'id': 'dp_test_lost', 'charge': 'ch_dispute_lost', 'status': 'lost'},
    ]

    event_data = {
        'type': 'charge.dispute.closed',
        'id': 'evt_dispute_closed_lost_1',
        'data': {
            'object': {
                'id': 'dp_test_lost',
                'charge': 'ch_dispute_lost',
                'status': 'lost',
            }
        }
    }
    payload_str = json.dumps(event_data)
    signature = _make_stripe_webhook_signature(payload_str, billing_app.config['STRIPE_WEBHOOK_SECRET'])

    response = client.post('/api/billing/webhook',
                          data=payload_str,
                          content_type='application/json',
                          headers={'Stripe-Signature': signature})
    assert response.status_code == 200
    mock_stripe_provider.charges.retrieve.assert_any_call('ch_dispute_lost')
    mock_stripe_provider.invoices.retrieve.assert_any_call('inv_dispute_lost')

    with billing_app.app_context():
        state = billing_store.get_billing_state(stable_id)
        assert state['status'] == 'active'
        assert state['paid_until'] is None  # Lost dispute: charge stays excluded.

    # Replay of the same event must not be reprocessed (idempotency).
    retrieve_calls_before = mock_stripe_provider.subscriptions.retrieve.call_count
    response2 = client.post('/api/billing/webhook',
                           data=payload_str,
                           content_type='application/json',
                           headers={'Stripe-Signature': signature})
    assert response2.status_code == 200
    assert mock_stripe_provider.subscriptions.retrieve.call_count == retrieve_calls_before


# ============ REGRESSION TEST 17: charge.dispute.closed (won) restores paid_until ============

def _dispute_won_fixture(client, billing_app, mock_stripe_provider, username, email, suffix):
    """Shared setup for the won-dispute family of tests: one active subscription with
    exactly one paid, unrefunded DE invoice/charge whose Charge.disputed is True (per
    documented Stripe semantics, disputed does not revert to False on its own)."""
    with billing_app.app_context():
        register_and_login(client, username, email, 'Pass123!')
        stable_id = models.ensure_stable_id(username)
        billing_store.put_billing_username_mapping(stable_id, username)
        billing_store.put_billing_state(
            stable_id, customer_id=f'cus_{suffix}', subscription_id=f'sub_{suffix}', status='active'
        )

    now_ts = int(datetime.now(timezone.utc).timestamp())
    period_end = now_ts + 90 * 86400

    mock_stripe_provider.subscriptions.retrieve.return_value = {
        'id': f'sub_{suffix}',
        'customer': f'cus_{suffix}',
        'status': 'active',
        'metadata': {'billing_uuid': stable_id},
        'items': {'data': [{'price': {'id': 'price_quarterly'}}]},
        'cancel_at_period_end': False,
        'cancel_at': None,
        'current_period_end': period_end,
        'trial_end': None,
    }
    mock_stripe_provider.invoices.list.return_value.auto_paging_iter.return_value = [
        {
            'id': f'inv_{suffix}',
            'customer': f'cus_{suffix}',
            'subscription': f'sub_{suffix}',
            'status': 'paid',
            'currency': 'eur',
            'amount_paid': 300,
            'paid': True,
            'customer_address': {'country': 'DE'},
            'charge': f'ch_{suffix}',
            'lines': {'data': [{'price': {'id': 'price_quarterly'}, 'period': {'end': period_end}, 'proration': False}]},
        }
    ]
    mock_stripe_provider.charges.retrieve.return_value = {
        'id': f'ch_{suffix}',
        'subscription': f'sub_{suffix}',
        'paid': True,
        'refunded': False,
        'amount_refunded': 0,
        'disputed': True,
        'amount': 300,
        'invoice': f'inv_{suffix}',
    }
    mock_stripe_provider.invoices.retrieve.return_value = {
        'id': f'inv_{suffix}',
        'customer': f'cus_{suffix}',
        'subscription': f'sub_{suffix}',
    }
    return stable_id, period_end


def test_charge_dispute_closed_won_restores_paid_until(client, billing_app, mock_stripe_provider):
    """Regression 17: A dispute resolved 'won' MUST restore the otherwise-valid paid
    invoice period, even though Stripe's Charge API reference documents ``disputed``
    only as "Whether the charge has been disputed" and does not document it reverting to
    False after a 'won' closure. ``_valid_paid_end`` must not trust the webhook payload's
    own dispute summary; it must retrieve the actual Dispute object(s) for the charge via
    ``disputes.list(charge=...)`` (a documented, server-side-filtered Stripe API) and
    grant access when -- and only when -- every dispute found on the charge has
    status == 'won'. This is a mocked-provider regression test, not a substitute for
    live Stripe sandbox verification (see `scripts/replay-stripe-sandbox-event.py`);
    whether an actual won-dispute replay restores access end-to-end against the live
    Stripe test-mode API remains unverified in this environment pending that replay."""
    stable_id, period_end = _dispute_won_fixture(
        client, billing_app, mock_stripe_provider, 'disputewonuser', 'disputewon@example.com', 'dispute_won'
    )
    # The actual Dispute object for this charge resolved 'won'.
    mock_stripe_provider.disputes.list.return_value.auto_paging_iter.return_value = [
        {'id': 'dp_test_won', 'charge': 'ch_dispute_won', 'status': 'won'},
    ]

    event_data = {
        'type': 'charge.dispute.closed',
        'id': 'evt_dispute_closed_won_1',
        'data': {
            'object': {
                'id': 'dp_test_won',
                'charge': 'ch_dispute_won',
                'status': 'won',
            }
        }
    }
    payload_str = json.dumps(event_data)
    signature = _make_stripe_webhook_signature(payload_str, billing_app.config['STRIPE_WEBHOOK_SECRET'])

    response = client.post('/api/billing/webhook',
                          data=payload_str,
                          content_type='application/json',
                          headers={'Stripe-Signature': signature})
    assert response.status_code == 200
    mock_stripe_provider.charges.retrieve.assert_any_call('ch_dispute_won')
    mock_stripe_provider.invoices.retrieve.assert_any_call('inv_dispute_won')
    mock_stripe_provider.disputes.list.assert_any_call({'charge': 'ch_dispute_won', 'limit': 100})

    with billing_app.app_context():
        state = billing_store.get_billing_state(stable_id)
        assert state['status'] == 'active'
        # Won dispute: the otherwise-valid paid invoice period is restored.
        assert state['paid_until'] == _iso(period_end)


def test_charge_dispute_closed_won_does_not_restore_if_another_dispute_still_open(
    client, billing_app, mock_stripe_provider
):
    """Regression 17b: a charge can accumulate more than one dispute over its lifetime.
    If ANY dispute on the charge is not 'won' (e.g. a second, still-open dispute), the
    charge must stay excluded -- we do not grant access just because one of several
    disputes resolved in the merchant's favor."""
    stable_id, _period_end = _dispute_won_fixture(
        client, billing_app, mock_stripe_provider, 'disputemultiuser', 'disputemulti@example.com', 'dispute_multi'
    )
    mock_stripe_provider.disputes.list.return_value.auto_paging_iter.return_value = [
        {'id': 'dp_won', 'charge': 'ch_dispute_multi', 'status': 'won'},
        {'id': 'dp_open', 'charge': 'ch_dispute_multi', 'status': 'needs_response'},
    ]

    event_data = {
        'type': 'charge.dispute.closed',
        'id': 'evt_dispute_closed_multi_1',
        'data': {'object': {'id': 'dp_won', 'charge': 'ch_dispute_multi', 'status': 'won'}},
    }
    payload_str = json.dumps(event_data)
    signature = _make_stripe_webhook_signature(payload_str, billing_app.config['STRIPE_WEBHOOK_SECRET'])

    response = client.post('/api/billing/webhook',
                          data=payload_str,
                          content_type='application/json',
                          headers={'Stripe-Signature': signature})
    assert response.status_code == 200

    with billing_app.app_context():
        state = billing_store.get_billing_state(stable_id)
        assert state['paid_until'] is None  # A second, still-open dispute denies access.


def test_charge_disputed_true_but_no_dispute_object_found_denies_safely(
    client, billing_app, mock_stripe_provider
):
    """Regression 17c: disputed=True but disputes.list(charge=...) returns nothing is an
    unknown/inconsistent provider state. Fail safe: deny (exclude), never grant."""
    stable_id, _period_end = _dispute_won_fixture(
        client, billing_app, mock_stripe_provider, 'disputeunknownuser', 'disputeunknown@example.com', 'dispute_unknown'
    )
    mock_stripe_provider.disputes.list.return_value.auto_paging_iter.return_value = []

    event_data = {
        'type': 'charge.dispute.closed',
        'id': 'evt_dispute_closed_unknown_1',
        'data': {'object': {'id': 'dp_unknown', 'charge': 'ch_dispute_unknown', 'status': 'won'}},
    }
    payload_str = json.dumps(event_data)
    signature = _make_stripe_webhook_signature(payload_str, billing_app.config['STRIPE_WEBHOOK_SECRET'])

    response = client.post('/api/billing/webhook',
                          data=payload_str,
                          content_type='application/json',
                          headers={'Stripe-Signature': signature})
    assert response.status_code == 200

    with billing_app.app_context():
        state = billing_store.get_billing_state(stable_id)
        assert state['paid_until'] is None


def test_dispute_charge_mismatch_raises_invalid_dispute(
    client, billing_app, mock_stripe_provider
):
    """Regression 17d: never trust a dispute whose own 'charge' field doesn't match the
    charge it was retrieved for -- that is a provider inconsistency, not something to
    silently ignore or grant on. Must fail explicitly (surfacing as a 500 the webhook
    does not swallow), not fall through to a default allow/deny decision."""
    stable_id, _period_end = _dispute_won_fixture(
        client, billing_app, mock_stripe_provider, 'disputemismatchuser', 'disputemismatch@example.com', 'dispute_mismatch'
    )
    mock_stripe_provider.disputes.list.return_value.auto_paging_iter.return_value = [
        {'id': 'dp_wrong', 'charge': 'ch_some_other_charge', 'status': 'won'},
    ]

    event_data = {
        'type': 'charge.dispute.closed',
        'id': 'evt_dispute_closed_mismatch_1',
        'data': {'object': {'id': 'dp_wrong', 'charge': 'ch_dispute_mismatch', 'status': 'won'}},
    }
    payload_str = json.dumps(event_data)
    signature = _make_stripe_webhook_signature(payload_str, billing_app.config['STRIPE_WEBHOOK_SECRET'])
    billing_app.config['PROPAGATE_EXCEPTIONS'] = False
    billing_app.config['TESTING'] = False

    response = client.post('/api/billing/webhook',
                          data=payload_str,
                          content_type='application/json',
                          headers={'Stripe-Signature': signature})
    assert response.status_code == 500  # Non-retryable ValueError re-raised, never swallowed.

    with billing_app.app_context():
        state = billing_store.get_billing_state(stable_id)
        assert state.get('paid_until') is None  # Never granted on an unverified dispute.


# ============ REGRESSION TEST 18: partial refund still excludes the charge's invoice ============

def test_partial_refund_excludes_charge_from_paid_until(client, billing_app, mock_stripe_provider):
    """Regression 18: _valid_paid_end treats ANY non-zero amount_refunded as disqualifying
    (``charge.get('amount_refunded', 0)`` is truthy-checked, not compared against the full
    charge amount), so a partial refund must exclude the invoice period exactly like a
    full refund -- there is no pro-rating of partially refunded access."""
    with billing_app.app_context():
        register_and_login(client, 'partialrefuser', 'partialref@example.com', 'Pass123!')
        stable_id = models.ensure_stable_id('partialrefuser')
        billing_store.put_billing_username_mapping(stable_id, 'partialrefuser')
        billing_store.put_billing_state(
            stable_id, customer_id='cus_partial_ref', subscription_id='sub_partial_ref', status='active'
        )

    now_ts = int(datetime.now(timezone.utc).timestamp())

    mock_stripe_provider.subscriptions.retrieve.return_value = {
        'id': 'sub_partial_ref',
        'customer': 'cus_partial_ref',
        'status': 'active',
        'metadata': {'billing_uuid': stable_id},
        'items': {'data': [{'price': {'id': 'price_quarterly'}}]},
        'cancel_at_period_end': False,
        'cancel_at': None,
        'current_period_end': now_ts + 90 * 86400,
        'trial_end': None,
    }

    mock_stripe_provider.invoices.list.return_value.auto_paging_iter.return_value = [
        {
            'id': 'inv_partial_ref',
            'customer': 'cus_partial_ref',
            'subscription': 'sub_partial_ref',
            'status': 'paid',
            'currency': 'eur',
            'amount_paid': 300,
            'paid': True,
            'customer_address': {'country': 'DE'},
            'charge': 'ch_partial_ref',
            'lines': {'data': [{'price': {'id': 'price_quarterly'}, 'period': {'end': now_ts + 90 * 86400}, 'proration': False}]},
        }
    ]

    # Only 100 of the 300 was refunded (partial), charge not fully `refunded`.
    mock_stripe_provider.charges.retrieve.return_value = {
        'id': 'ch_partial_ref',
        'subscription': 'sub_partial_ref',
        'paid': True,
        'refunded': False,
        'amount_refunded': 100,
        'disputed': False,
        'amount': 300,
        'invoice': 'inv_partial_ref',
    }
    mock_stripe_provider.invoices.retrieve.return_value = {
        'id': 'inv_partial_ref',
        'customer': 'cus_partial_ref',
        'subscription': 'sub_partial_ref',
    }

    event_data = {
        'type': 'charge.refunded',
        'id': 'evt_partial_refund_1',
        'data': {
            'object': {
                'id': 'ch_partial_ref',
                'invoice': 'inv_partial_ref',
                'refunded': False,
                'amount_refunded': 100,
            }
        }
    }
    payload_str = json.dumps(event_data)
    signature = _make_stripe_webhook_signature(payload_str, billing_app.config['STRIPE_WEBHOOK_SECRET'])

    response = client.post('/api/billing/webhook',
                          data=payload_str,
                          content_type='application/json',
                          headers={'Stripe-Signature': signature})
    assert response.status_code == 200

    with billing_app.app_context():
        state = billing_store.get_billing_state(stable_id)
        assert state['status'] == 'active'
        assert state['paid_until'] is None  # Partial refund still disqualifies the charge.


# ============ REGRESSION TEST 19: dispute on one invoice preserves another valid invoice ============

def test_dispute_closed_lost_preserves_prior_valid_invoice_paid_until(client, billing_app, mock_stripe_provider):
    """Regression 19: Gap not covered by REGRESSION TEST 13 (which only exercises the
    foreign-refund path). When a subscription has two DE invoices and only one of them
    becomes the subject of a lost dispute, paid_until must still reflect the other,
    still-valid invoice's period end -- dispute handling must not blanket-invalidate the
    whole subscription, only the specific disputed charge's invoice."""
    with billing_app.app_context():
        register_and_login(client, 'disputekeepuser', 'disputekeep@example.com', 'Pass123!')
        stable_id = models.ensure_stable_id('disputekeepuser')
        billing_store.put_billing_username_mapping(stable_id, 'disputekeepuser')
        billing_store.put_billing_state(
            stable_id, customer_id='cus_dispute_keep', subscription_id='sub_dispute_keep', status='active'
        )

    now_ts = int(datetime.now(timezone.utc).timestamp())
    valid_end = now_ts + 180 * 86400
    disputed_end = now_ts + 90 * 86400

    mock_stripe_provider.subscriptions.retrieve.return_value = {
        'id': 'sub_dispute_keep',
        'customer': 'cus_dispute_keep',
        'status': 'active',
        'metadata': {'billing_uuid': stable_id},
        'items': {'data': [{'price': {'id': 'price_quarterly'}}]},
        'cancel_at_period_end': False,
        'cancel_at': None,
        'current_period_end': now_ts + 180 * 86400,
        'trial_end': None,
    }

    mock_stripe_provider.invoices.list.return_value.auto_paging_iter.return_value = [
        {
            'id': 'inv_dispute_keep_valid',
            'customer': 'cus_dispute_keep',
            'subscription': 'sub_dispute_keep',
            'status': 'paid',
            'currency': 'eur',
            'amount_paid': 300,
            'paid': True,
            'customer_address': {'country': 'DE'},
            'charge': 'ch_dispute_keep_valid',
            'lines': {'data': [{'price': {'id': 'price_quarterly'}, 'period': {'end': valid_end}, 'proration': False}]},
        },
        {
            'id': 'inv_dispute_keep_disputed',
            'customer': 'cus_dispute_keep',
            'subscription': 'sub_dispute_keep',
            'status': 'paid',
            'currency': 'eur',
            'amount_paid': 300,
            'paid': True,
            'customer_address': {'country': 'DE'},
            'charge': 'ch_dispute_keep_disputed',
            'lines': {'data': [{'price': {'id': 'price_quarterly'}, 'period': {'end': disputed_end}, 'proration': False}]},
        },
    ]

    def get_charge_side_effect(charge_id):
        if charge_id == 'ch_dispute_keep_valid':
            return {
                'id': 'ch_dispute_keep_valid',
                'subscription': 'sub_dispute_keep',
                'paid': True,
                'refunded': False,
                'amount_refunded': 0,
                'disputed': False,
                'amount': 300,
            }
        if charge_id == 'ch_dispute_keep_disputed':
            return {
                'id': 'ch_dispute_keep_disputed',
                'subscription': 'sub_dispute_keep',
                'paid': True,
                'refunded': False,
                'amount_refunded': 0,
                'disputed': True,  # Lost dispute: stays disputed.
                'amount': 300,
                'invoice': 'inv_dispute_keep_disputed',
            }
        return {}

    mock_stripe_provider.charges.retrieve.side_effect = get_charge_side_effect
    mock_stripe_provider.invoices.retrieve.return_value = {
        'id': 'inv_dispute_keep_disputed',
        'customer': 'cus_dispute_keep',
        'subscription': 'sub_dispute_keep',
    }

    event_data = {
        'type': 'charge.dispute.closed',
        'id': 'evt_dispute_closed_keep_1',
        'data': {
            'object': {
                'id': 'dp_test_keep',
                'charge': 'ch_dispute_keep_disputed',
                'status': 'lost',
            }
        }
    }
    payload_str = json.dumps(event_data)
    signature = _make_stripe_webhook_signature(payload_str, billing_app.config['STRIPE_WEBHOOK_SECRET'])

    response = client.post('/api/billing/webhook',
                          data=payload_str,
                          content_type='application/json',
                          headers={'Stripe-Signature': signature})
    assert response.status_code == 200

    with billing_app.app_context():
        state = billing_store.get_billing_state(stable_id)
        assert state['status'] == 'active'
        # Only the disputed invoice's period is excluded; the other DE invoice's
        # (later) period end is still used for paid_until.
        assert state['paid_until'] == _iso(valid_end)


# ============ REGRESSION TEST 20: /checkout recheckout after refund+cancel ============
# Confirmed sandbox scenario: a customer's only subscription was refunded and
# then immediately canceled (no replacement subscription exists). The stored
# billing state still has a 'complete' checkout_session_id from the original
# (now-terminal) subscription. /checkout must resolve the completed session's
# subscription against fresh provider truth and permit a brand-new checkout
# once it verifies: same customer, same identity (billing_uuid metadata), same
# price, and a terminal (canceled/incomplete_expired) status, with no live
# subscriptions for the customer.

def test_checkout_allows_recheckout_after_terminal_subscription_same_session(client, billing_app, mock_stripe_provider):
    """Repro + fix: completed checkout session whose subscription is now
    canceled (refund+cancel) must not block recheckout forever."""
    with billing_app.app_context():
        headers = register_and_login(client, 'recheckoutuser', 'recheckout@example.com', 'Pass123!')
        stable_id = models.ensure_stable_id('recheckoutuser')
        billing_store.put_billing_username_mapping(stable_id, 'recheckoutuser')
        billing_store.put_billing_state(
            stable_id,
            customer_id='cus_recheckout',
            checkout_session_id='cs_complete_terminal',
            checkout_operation='op_recheckout_old',
            subscription_id='sub_recheckout_terminal',
            status='canceled',
        )

    # Fresh provider truth: customer now has no live subscriptions.
    mock_stripe_provider.prices.retrieve.return_value = _VALID_PRICE
    mock_stripe_provider.subscriptions.list.return_value.auto_paging_iter.return_value = []

    mock_stripe_provider.checkout.sessions.retrieve.return_value = {
        'id': 'cs_complete_terminal',
        'status': 'complete',
        'customer': 'cus_recheckout',
        'subscription': 'sub_recheckout_terminal',
        'url': 'https://checkout.stripe.com/pay/cs_complete_terminal',
    }
    mock_stripe_provider.subscriptions.retrieve.return_value = {
        'id': 'sub_recheckout_terminal',
        'customer': 'cus_recheckout',
        'status': 'canceled',
        'metadata': {'billing_uuid': stable_id},
        'items': {'data': [{'price': {'id': 'price_quarterly'}}]},
        'cancel_at_period_end': False,
        'cancel_at': None,
    }
    mock_stripe_provider.checkout.sessions.create.return_value = {
        'id': 'cs_brand_new',
        'url': 'https://checkout.stripe.com/pay/cs_brand_new',
    }

    response = client.post('/api/billing/checkout',
                          json=_valid_checkout_payload(),
                          headers=headers)

    assert response.status_code == 200
    assert response.get_json()['url'] == 'https://checkout.stripe.com/pay/cs_brand_new'

    with billing_app.app_context():
        state = billing_store.get_billing_state(stable_id)
        assert state['checkout_session_id'] == 'cs_brand_new'
        # A brand new idempotency key must be used; the stale operation that
        # already produced the old (now-terminal) checkout must not be reused.
        assert state['checkout_operation'] != 'op_recheckout_old'

    create_kwargs = mock_stripe_provider.checkout.sessions.create.call_args
    assert create_kwargs is not None
    idempotency_key = create_kwargs.kwargs['options']['idempotency_key']
    assert idempotency_key != 'op_recheckout_old'


def test_checkout_still_blocks_duplicate_when_live_subscription_exists(client, billing_app, mock_stripe_provider):
    """Safety: even with a completed checkout session on file, a live (active)
    subscription for the customer must still take precedence and block
    checkout with duplicate_subscription, never silently replacing it."""
    with billing_app.app_context():
        headers = register_and_login(client, 'liveuser', 'live@example.com', 'Pass123!')
        stable_id = models.ensure_stable_id('liveuser')
        billing_store.put_billing_username_mapping(stable_id, 'liveuser')
        billing_store.put_billing_state(
            stable_id,
            customer_id='cus_live',
            checkout_session_id='cs_complete_live',
            checkout_operation='op_live_old',
            subscription_id='sub_live_active',
            status='active',
        )

    mock_stripe_provider.prices.retrieve.return_value = _VALID_PRICE
    mock_stripe_provider.subscriptions.list.return_value.auto_paging_iter.return_value = [
        {
            'id': 'sub_live_active',
            'customer': 'cus_live',
            'status': 'active',
            'metadata': {'billing_uuid': stable_id},
        }
    ]

    response = client.post('/api/billing/checkout',
                          json=_valid_checkout_payload(),
                          headers=headers)

    assert response.status_code == 409
    assert response.get_json()['error'] == 'duplicate_subscription'
    # Checkout session lookup/creation must never be reached once a live
    # subscription is already found.
    mock_stripe_provider.checkout.sessions.retrieve.assert_not_called()
    mock_stripe_provider.checkout.sessions.create.assert_not_called()


def test_checkout_preserves_pending_confirmation_when_subscription_unresolvable(client, billing_app, mock_stripe_provider):
    """Safety: a completed checkout session whose subscription cannot be
    resolved to a verified terminal subscription (e.g. still being created,
    or unlinked) must keep returning payment_confirmation_pending rather than
    guessing and creating a duplicate checkout."""
    with billing_app.app_context():
        headers = register_and_login(client, 'pendinguser', 'pending@example.com', 'Pass123!')
        stable_id = models.ensure_stable_id('pendinguser')
        billing_store.put_billing_username_mapping(stable_id, 'pendinguser')
        billing_store.put_billing_state(
            stable_id,
            customer_id='cus_pending',
            checkout_session_id='cs_complete_pending',
            checkout_operation='op_pending_old',
        )

    mock_stripe_provider.prices.retrieve.return_value = _VALID_PRICE
    mock_stripe_provider.subscriptions.list.return_value.auto_paging_iter.return_value = []
    # Session completed but has no subscription reference yet (still settling).
    mock_stripe_provider.checkout.sessions.retrieve.return_value = {
        'id': 'cs_complete_pending',
        'status': 'complete',
        'customer': 'cus_pending',
        'subscription': None,
        'url': 'https://checkout.stripe.com/pay/cs_complete_pending',
    }

    response = client.post('/api/billing/checkout',
                          json=_valid_checkout_payload(),
                          headers=headers)

    assert response.status_code == 409
    assert response.get_json()['error'] == 'payment_confirmation_pending'
    mock_stripe_provider.checkout.sessions.create.assert_not_called()

    with billing_app.app_context():
        # State must be untouched: still pointing at the same pending session.
        state = billing_store.get_billing_state(stable_id)
        assert state['checkout_session_id'] == 'cs_complete_pending'
        assert state['checkout_operation'] == 'op_pending_old'


def test_checkout_rejects_session_subscription_for_different_customer(client, billing_app, mock_stripe_provider):
    """Safety: a completed checkout session resolving to a subscription that
    belongs to a different customer/identity must never be treated as
    replaceable, even if it is terminal. Fail safe (keep pending) rather than
    trust an unverified cross-account subscription."""
    with billing_app.app_context():
        headers = register_and_login(client, 'mismatchuser', 'mismatch@example.com', 'Pass123!')
        stable_id = models.ensure_stable_id('mismatchuser')
        billing_store.put_billing_username_mapping(stable_id, 'mismatchuser')
        billing_store.put_billing_state(
            stable_id,
            customer_id='cus_mismatch',
            checkout_session_id='cs_complete_mismatch',
            checkout_operation='op_mismatch_old',
        )

    mock_stripe_provider.prices.retrieve.return_value = _VALID_PRICE
    mock_stripe_provider.subscriptions.list.return_value.auto_paging_iter.return_value = []
    mock_stripe_provider.checkout.sessions.retrieve.return_value = {
        'id': 'cs_complete_mismatch',
        'status': 'complete',
        'customer': 'cus_mismatch',
        'subscription': 'sub_other_customer',
        'url': 'https://checkout.stripe.com/pay/cs_complete_mismatch',
    }
    mock_stripe_provider.subscriptions.retrieve.return_value = {
        'id': 'sub_other_customer',
        'customer': 'cus_someone_else',  # Does not match state's customer_id.
        'status': 'canceled',
        'metadata': {'billing_uuid': 'other-identity'},
        'items': {'data': [{'price': {'id': 'price_quarterly'}}]},
    }

    response = client.post('/api/billing/checkout',
                          json=_valid_checkout_payload(),
                          headers=headers)

    assert response.status_code == 409
    assert response.get_json()['error'] == 'payment_confirmation_pending'
    mock_stripe_provider.checkout.sessions.create.assert_not_called()


# ============ Portal configuration tests ============

def test_portal_missing_configuration_returns_explicit_json_503(client, billing_app, mock_stripe_provider):
    """Repro + fix: a missing STRIPE_PORTAL_CONFIGURATION_ID (e.g. sandbox
    started without --portal-id) must never reach stripe_provider.create_portal
    (which raises RuntimeError, producing an uncaught Flask HTML 500 page that
    breaks the frontend's res.json() parsing). The route must detect the
    absent configuration itself and return an explicit, machine-readable JSON
    503 before any provider call."""
    billing_app.config['STRIPE_PORTAL_CONFIGURATION_ID'] = ''
    with billing_app.app_context():
        headers = register_and_login(client, 'portalnoconfig', 'portalnoconfig@example.com', 'Pass123!')
        stable_id = models.ensure_stable_id('portalnoconfig')
        billing_store.put_billing_username_mapping(stable_id, 'portalnoconfig')
        billing_store.put_billing_state(stable_id, customer_id='cus_portal_noconfig')

    response = client.post('/api/billing/portal', headers=headers)

    assert response.status_code == 503
    assert response.content_type.startswith('application/json')
    assert response.get_json()['error'] == 'portal_unavailable'
    mock_stripe_provider.billing_portal.sessions.create.assert_not_called()


def test_portal_configured_works_after_subscription_canceled(client, billing_app, mock_stripe_provider):
    """A canceled subscription must not block portal access: the customer
    can still reach their billing history/portal (only the configuration id
    gates portal availability, never subscription status)."""
    with billing_app.app_context():
        headers = register_and_login(client, 'portalcanceled', 'portalcanceled@example.com', 'Pass123!')
        stable_id = models.ensure_stable_id('portalcanceled')
        billing_store.put_billing_username_mapping(stable_id, 'portalcanceled')
        billing_store.put_billing_state(
            stable_id, customer_id='cus_portal_canceled', subscription_id='sub_portal_canceled',
            status='canceled',
        )

    mock_stripe_provider.billing_portal.sessions.create.return_value = {
        'id': 'bps_portal_canceled', 'url': 'https://billing.stripe.com/p/session/portal_canceled',
    }

    response = client.post('/api/billing/portal', headers=headers)

    assert response.status_code == 200
    assert response.get_json()['url'] == 'https://billing.stripe.com/p/session/portal_canceled'
    mock_stripe_provider.billing_portal.sessions.create.assert_called_once()


# ============ REGRESSION: late events for a superseded subscription must not
# ============ revoke access granted by a newer, still-live subscription ============

def test_delayed_old_subscription_deleted_preserves_new_active_subscription(client, billing_app, mock_stripe_provider):
    """Repro + fix: a late `customer.subscription.deleted` event for an old
    subscription (e.g. a sandbox/replay delay) must not overwrite billing
    state once a *different*, still-live subscription has already replaced
    it -- otherwise the old subscription's own closure revokes access that
    the newer subscription granted."""
    with billing_app.app_context():
        headers = register_and_login(client, 'oldsubdeleted', 'oldsubdeleted@example.com', 'Pass123!')
        stable_id = models.ensure_stable_id('oldsubdeleted')
        billing_store.put_billing_username_mapping(stable_id, 'oldsubdeleted')
        billing_store.put_billing_state(
            stable_id, customer_id='cus_oldnew', subscription_id='sub_new_active', status='active',
        )

    def get_subscription_side_effect(sub_id):
        return {
            'sub_old_deleted': {
                'id': 'sub_old_deleted', 'customer': 'cus_oldnew', 'status': 'canceled',
                'metadata': {'billing_uuid': stable_id},
                'items': {'data': [{'price': {'id': 'price_quarterly'}}]},
                'cancel_at_period_end': False, 'cancel_at': None,
            },
            'sub_new_active': {
                'id': 'sub_new_active', 'customer': 'cus_oldnew', 'status': 'active',
                'metadata': {'billing_uuid': stable_id},
                'items': {'data': [{'price': {'id': 'price_quarterly'}}]},
                'cancel_at_period_end': False, 'cancel_at': None,
            },
        }[sub_id]
    mock_stripe_provider.subscriptions.retrieve.side_effect = get_subscription_side_effect

    event_data = {
        'type': 'customer.subscription.deleted',
        'id': 'evt_old_sub_deleted_1',
        'data': {'object': {'id': 'sub_old_deleted', 'status': 'canceled'}},
    }
    payload_str = json.dumps(event_data)
    signature = _make_stripe_webhook_signature(payload_str, billing_app.config['STRIPE_WEBHOOK_SECRET'])

    response = client.post('/api/billing/webhook',
                          data=payload_str,
                          content_type='application/json',
                          headers={'Stripe-Signature': signature})

    assert response.status_code == 200
    with billing_app.app_context():
        state = billing_store.get_billing_state(stable_id)
        assert state['subscription_id'] == 'sub_new_active'
        assert state['status'] == 'active'

    # Replay must not be reprocessed (idempotency still holds for the skip path).
    retrieve_calls_before = mock_stripe_provider.subscriptions.retrieve.call_count
    response2 = client.post('/api/billing/webhook',
                           data=payload_str,
                           content_type='application/json',
                           headers={'Stripe-Signature': signature})
    assert response2.status_code == 200
    assert mock_stripe_provider.subscriptions.retrieve.call_count == retrieve_calls_before


def test_delayed_old_subscription_refund_preserves_new_active_subscription(client, billing_app, mock_stripe_provider):
    """Repro + fix: a late `charge.refunded` event whose invoice/subscription
    chain resolves to an old, already-replaced subscription must not
    overwrite the current, still-live subscription's state."""
    with billing_app.app_context():
        headers = register_and_login(client, 'oldsubrefund', 'oldsubrefund@example.com', 'Pass123!')
        stable_id = models.ensure_stable_id('oldsubrefund')
        billing_store.put_billing_username_mapping(stable_id, 'oldsubrefund')
        billing_store.put_billing_state(
            stable_id, customer_id='cus_oldrefund', subscription_id='sub_new_refund_active', status='active',
        )

    def get_subscription_side_effect(sub_id):
        return {
            'sub_old_refund': {
                'id': 'sub_old_refund', 'customer': 'cus_oldrefund', 'status': 'canceled',
                'metadata': {'billing_uuid': stable_id},
                'items': {'data': [{'price': {'id': 'price_quarterly'}}]},
                'cancel_at_period_end': False, 'cancel_at': None,
            },
            'sub_new_refund_active': {
                'id': 'sub_new_refund_active', 'customer': 'cus_oldrefund', 'status': 'active',
                'metadata': {'billing_uuid': stable_id},
                'items': {'data': [{'price': {'id': 'price_quarterly'}}]},
                'cancel_at_period_end': False, 'cancel_at': None,
            },
        }[sub_id]
    mock_stripe_provider.subscriptions.retrieve.side_effect = get_subscription_side_effect
    mock_stripe_provider.charges.retrieve.return_value = {
        'id': 'ch_old_refund', 'invoice': 'inv_old_refund', 'refunded': True, 'amount_refunded': 300,
    }
    mock_stripe_provider.invoices.retrieve.return_value = {
        'id': 'inv_old_refund', 'customer': 'cus_oldrefund', 'subscription': 'sub_old_refund',
    }

    event_data = {
        'type': 'charge.refunded',
        'id': 'evt_old_sub_refund_1',
        'data': {'object': {'id': 'ch_old_refund', 'invoice': 'inv_old_refund', 'refunded': True, 'amount_refunded': 300}},
    }
    payload_str = json.dumps(event_data)
    signature = _make_stripe_webhook_signature(payload_str, billing_app.config['STRIPE_WEBHOOK_SECRET'])

    response = client.post('/api/billing/webhook',
                          data=payload_str,
                          content_type='application/json',
                          headers={'Stripe-Signature': signature})

    assert response.status_code == 200
    with billing_app.app_context():
        state = billing_store.get_billing_state(stable_id)
        assert state['subscription_id'] == 'sub_new_refund_active'
        assert state['status'] == 'active'


def test_delayed_old_subscription_dispute_closure_preserves_new_active_subscription(client, billing_app, mock_stripe_provider):
    """Repro + fix: a late `charge.dispute.closed` event resolving to an old,
    already-replaced subscription must not overwrite the current, still-live
    subscription's state."""
    with billing_app.app_context():
        headers = register_and_login(client, 'oldsubdispute', 'oldsubdispute@example.com', 'Pass123!')
        stable_id = models.ensure_stable_id('oldsubdispute')
        billing_store.put_billing_username_mapping(stable_id, 'oldsubdispute')
        billing_store.put_billing_state(
            stable_id, customer_id='cus_olddispute', subscription_id='sub_new_dispute_active', status='active',
        )

    def get_subscription_side_effect(sub_id):
        return {
            'sub_old_dispute': {
                'id': 'sub_old_dispute', 'customer': 'cus_olddispute', 'status': 'canceled',
                'metadata': {'billing_uuid': stable_id},
                'items': {'data': [{'price': {'id': 'price_quarterly'}}]},
                'cancel_at_period_end': False, 'cancel_at': None,
            },
            'sub_new_dispute_active': {
                'id': 'sub_new_dispute_active', 'customer': 'cus_olddispute', 'status': 'active',
                'metadata': {'billing_uuid': stable_id},
                'items': {'data': [{'price': {'id': 'price_quarterly'}}]},
                'cancel_at_period_end': False, 'cancel_at': None,
            },
        }[sub_id]
    mock_stripe_provider.subscriptions.retrieve.side_effect = get_subscription_side_effect
    mock_stripe_provider.charges.retrieve.return_value = {
        'id': 'ch_old_dispute', 'invoice': 'inv_old_dispute', 'disputed': True,
    }
    mock_stripe_provider.invoices.retrieve.return_value = {
        'id': 'inv_old_dispute', 'customer': 'cus_olddispute', 'subscription': 'sub_old_dispute',
    }

    event_data = {
        'type': 'charge.dispute.closed',
        'id': 'evt_old_sub_dispute_1',
        'data': {'object': {'id': 'dp_old_dispute', 'charge': 'ch_old_dispute', 'status': 'lost'}},
    }
    payload_str = json.dumps(event_data)
    signature = _make_stripe_webhook_signature(payload_str, billing_app.config['STRIPE_WEBHOOK_SECRET'])

    response = client.post('/api/billing/webhook',
                          data=payload_str,
                          content_type='application/json',
                          headers={'Stripe-Signature': signature})

    assert response.status_code == 200
    with billing_app.app_context():
        state = billing_store.get_billing_state(stable_id)
        assert state['subscription_id'] == 'sub_new_dispute_active'
        assert state['status'] == 'active'


def test_replacement_checkout_webhook_attaches_new_subscription_after_old_terminal(client, billing_app, mock_stripe_provider):
    """Safety counterpart: the supersession guard must not blanket-ignore
    every event whose subscription differs from the stored one -- a
    legitimate replacement checkout's `checkout.session.completed` event must
    still attach its brand-new, live subscription once the previously stored
    subscription has itself gone terminal (canceled)."""
    with billing_app.app_context():
        headers = register_and_login(client, 'replaceattach', 'replaceattach@example.com', 'Pass123!')
        stable_id = models.ensure_stable_id('replaceattach')
        billing_store.put_billing_username_mapping(stable_id, 'replaceattach')
        billing_store.put_billing_state(
            stable_id, customer_id='cus_replaceattach', subscription_id='sub_replace_old_terminal', status='canceled',
        )

    def get_subscription_side_effect(sub_id):
        return {
            'sub_replace_old_terminal': {
                'id': 'sub_replace_old_terminal', 'customer': 'cus_replaceattach', 'status': 'canceled',
                'metadata': {'billing_uuid': stable_id},
                'items': {'data': [{'price': {'id': 'price_quarterly'}}]},
                'cancel_at_period_end': False, 'cancel_at': None,
            },
            'sub_replace_new_active': {
                'id': 'sub_replace_new_active', 'customer': 'cus_replaceattach', 'status': 'active',
                'metadata': {'billing_uuid': stable_id},
                'items': {'data': [{'price': {'id': 'price_quarterly'}}]},
                'cancel_at_period_end': False, 'cancel_at': None,
                'current_period_end': int(datetime.now(timezone.utc).timestamp()) + 90 * 86400,
                'trial_end': None,
            },
        }[sub_id]
    mock_stripe_provider.subscriptions.retrieve.side_effect = get_subscription_side_effect
    mock_stripe_provider.invoices.list.return_value.auto_paging_iter.return_value = []

    event_data = {
        'type': 'checkout.session.completed',
        'id': 'evt_replace_attach_1',
        'data': {'object': {
            'id': 'cs_replace_attach', 'subscription': 'sub_replace_new_active',
            'customer_details': {'address': {'country': 'DE'}},
        }},
    }
    payload_str = json.dumps(event_data)
    signature = _make_stripe_webhook_signature(payload_str, billing_app.config['STRIPE_WEBHOOK_SECRET'])

    response = client.post('/api/billing/webhook',
                          data=payload_str,
                          content_type='application/json',
                          headers={'Stripe-Signature': signature})

    assert response.status_code == 200
    with billing_app.app_context():
        state = billing_store.get_billing_state(stable_id)
        assert state['subscription_id'] == 'sub_replace_new_active'
        assert state['status'] == 'active'


def test_reconcile_subscription_rejects_foreign_subscription_even_when_superseded_logic_runs(
    client, billing_app, mock_stripe_provider,
):
    """Safety: the supersession guard must never mask a genuinely foreign
    subscription (wrong identity/customer). Identity/customer/price
    validation must still run -- and still raise -- before any supersession
    comparison is reached, so a random foreign subscription reference can
    never slip through just because it differs from the stored one."""
    with billing_app.app_context():
        stable_id = models.ensure_stable_id('foreignrefuser')
        billing_store.put_billing_username_mapping(stable_id, 'foreignrefuser')
        billing_store.put_billing_state(
            stable_id, customer_id='cus_foreignref', subscription_id='sub_foreignref_active', status='active',
        )

        from sites.ffm.app import billing

        mock_stripe_provider.subscriptions.retrieve.return_value = {
            'id': 'sub_totally_unrelated', 'customer': 'cus_someone_else', 'status': 'active',
            'metadata': {'billing_uuid': 'someone-elses-identity'},
            'items': {'data': [{'price': {'id': 'price_quarterly'}}]},
        }

        with pytest.raises(ValueError, match='invalid_subscription'):
            billing.reconcile_subscription(stable_id, 'sub_totally_unrelated')

        # State must be completely untouched.
        state = billing_store.get_billing_state(stable_id)
        assert state['subscription_id'] == 'sub_foreignref_active'
        assert state['status'] == 'active'
