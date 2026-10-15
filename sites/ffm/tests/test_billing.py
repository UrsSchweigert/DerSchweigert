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
                          json={'adult_confirmed': True, 'terms_accepted': True},
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
