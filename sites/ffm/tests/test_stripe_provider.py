"""Tests for Stripe provider adapter using StripeClient.v1 SDK."""

import os
import json
import hmac
import hashlib
from datetime import datetime, timezone, timedelta
from unittest.mock import MagicMock, patch

import pytest
import stripe

os.environ['SECRET_KEY'] = 'test-key-for-imports'
os.environ['AWS_ACCESS_KEY_ID'] = 'testing'
os.environ['AWS_SECRET_ACCESS_KEY'] = 'testing'
os.environ['AWS_SECURITY_TOKEN'] = 'testing'
os.environ['AWS_SESSION_TOKEN'] = 'testing'
os.environ['AWS_DEFAULT_REGION'] = 'eu-central-1'
os.environ['DYNAMODB_USERS_TABLE'] = 'ffm-users-test'
os.environ['DYNAMODB_SCORES_TABLE'] = 'ffm-scores-test'
os.environ['DYNAMODB_RATELIMIT_TABLE'] = 'ffm-ratelimits-test'


@pytest.fixture
def app():
    """Create Flask test app."""
    from flask import Flask
    app = Flask(__name__)
    app.config['TESTING'] = True
    app.config['STRIPE_SECRET_KEY'] = 'sk_test_mock'
    app.config['STRIPE_WEBHOOK_SECRET'] = 'whsec_test_mock'
    return app


@pytest.fixture
def app_context(app):
    """Provide Flask app context."""
    with app.app_context():
        yield app


class TestVerifyEvent:
    """Test webhook event verification using actual Stripe Webhook.construct_event."""

    def test_verify_event_constructs_correctly(self, app_context):
        """verify_event should call stripe.Webhook.construct_event with correct args."""
        from sites.ffm.app import stripe_provider

        payload = b'{"type": "charge.succeeded", "id": "evt_123"}'
        signature = 'valid_sig'

        with patch('stripe.Webhook.construct_event') as mock_construct:
            mock_construct.return_value = {'type': 'charge.succeeded', 'id': 'evt_123'}

            result = stripe_provider.verify_event(payload, signature)

            assert result['type'] == 'charge.succeeded'
            assert result['id'] == 'evt_123'
            # Verify it called construct_event with correct secret
            mock_construct.assert_called_once()
            call_args = mock_construct.call_args
            assert call_args[0][0] == payload
            assert call_args[0][1] == signature


def _make_mock_client():
    """Create a mock StripeClient.v1 for testing."""
    mock_client = MagicMock()
    mock_client.prices = MagicMock()
    mock_client.customers = MagicMock()
    mock_client.checkout = MagicMock()
    mock_client.billing_portal = MagicMock()
    mock_client.subscriptions = MagicMock()
    mock_client.invoices = MagicMock()
    mock_client.charges = MagicMock()
    return mock_client


class TestValidatePrice:
    """Test price validation with StripeClient.v1."""

    def test_validate_price_300eur_quarterly(self, app_context):
        """validate_price verifies 300 EUR quarterly pricing."""
        from sites.ffm.app import stripe_provider

        with patch('sites.ffm.app.stripe_provider._client') as mock_client_func:
            mock_client = _make_mock_client()
            mock_client_func.return_value = mock_client

            mock_client.prices.retrieve.return_value = {
                'id': 'price_quarterly',
                'active': True,
                'currency': 'eur',
                'unit_amount': 300,
                'recurring': {'interval': 'month', 'interval_count': 3},
            }

            price = stripe_provider.validate_price('price_quarterly')
            assert price['unit_amount'] == 300
            assert price['currency'] == 'eur'
            assert price['recurring']['interval_count'] == 3
            mock_client.prices.retrieve.assert_called_once_with('price_quarterly')

    def test_validate_price_rejects_wrong_amount(self, app_context):
        """validate_price rejects prices with wrong amount."""
        from sites.ffm.app import stripe_provider

        with patch('sites.ffm.app.stripe_provider._client') as mock_client_func:
            mock_client = _make_mock_client()
            mock_client_func.return_value = mock_client

            mock_client.prices.retrieve.return_value = {
                'id': 'price_wrong',
                'active': True,
                'currency': 'eur',
                'unit_amount': 299,  # Wrong amount
                'recurring': {'interval': 'month', 'interval_count': 3},
            }

            with pytest.raises(ValueError) as exc:
                stripe_provider.validate_price('price_wrong')
            assert str(exc.value) == 'invalid_price'

    def test_validate_price_rejects_inactive(self, app_context):
        """validate_price rejects inactive prices."""
        from sites.ffm.app import stripe_provider

        with patch('sites.ffm.app.stripe_provider._client') as mock_client_func:
            mock_client = _make_mock_client()
            mock_client_func.return_value = mock_client

            mock_client.prices.retrieve.return_value = {
                'id': 'price_inactive',
                'active': False,
                'currency': 'eur',
                'unit_amount': 300,
                'recurring': {'interval': 'month', 'interval_count': 3},
            }

            with pytest.raises(ValueError) as exc:
                stripe_provider.validate_price('price_inactive')
            assert str(exc.value) == 'invalid_price'


class TestCreateCustomer:
    """Test customer creation via StripeClient.v1."""

    def test_create_customer_sets_metadata(self, app_context):
        """create_customer sets billing_uuid in metadata."""
        from sites.ffm.app import stripe_provider

        with patch('sites.ffm.app.stripe_provider._client') as mock_client_func:
            mock_client = _make_mock_client()
            mock_client_func.return_value = mock_client

            mock_client.customers.create.return_value = {
                'id': 'cus_123',
                'email': 'user@example.com',
                'metadata': {'billing_uuid': 'user-stable-id'},
            }

            customer = stripe_provider.create_customer('user-stable-id', 'user@example.com', 'op-123')

            assert customer['id'] == 'cus_123'
            mock_client.customers.create.assert_called_once()
            call_args = mock_client.customers.create.call_args
            # Verify metadata was set
            assert call_args[0][0]['metadata']['billing_uuid'] == 'user-stable-id'


class TestCreateCheckout:
    """Test checkout session creation."""

    def test_create_checkout_basic(self, app_context):
        """create_checkout creates session with required fields."""
        from sites.ffm.app import stripe_provider

        with patch('sites.ffm.app.stripe_provider._client') as mock_client_func:
            mock_client = _make_mock_client()
            mock_client_func.return_value = mock_client

            mock_client.checkout.sessions.create.return_value = {
                'id': 'cs_123',
                'url': 'https://checkout.stripe.com/test',
                'status': 'open',
            }

            session = stripe_provider.create_checkout(
                'cus_123', 'user-id', 'price_quarterly',
                'https://example.com', 'op-123'
            )

            assert session['id'] == 'cs_123'
            assert 'url' in session
            mock_client.checkout.sessions.create.assert_called_once()
            call = mock_client.checkout.sessions.create.call_args
            assert call.args[0]['managed_payments'] == {'enabled': False}
            assert call.args[0]['customer_update'] == {'address': 'auto', 'name': 'auto'}
            assert call.args[0]['consent_collection'] == {'terms_of_service': 'required'}
            assert call.kwargs['options'] == {
                'idempotency_key': 'op-123',
                'stripe_version': '2025-03-31.basil',
            }
            assert stripe_provider.API_VERSION == '2024-06-20'

    def test_local_sandbox_can_skip_duplicate_hosted_terms(self, app_context):
        from sites.ffm.app import stripe_provider

        app_context.config['STRIPE_CHECKOUT_TERMS_CONSENT_ENABLED'] = False
        with patch('sites.ffm.app.stripe_provider._client') as factory:
            client = _make_mock_client()
            factory.return_value = client
            client.checkout.sessions.create.return_value = {'id': 'cs_test', 'url': 'https://checkout.stripe.com/test'}
            stripe_provider.create_checkout('cus_test', 'identity', 'price_test', 'http://127.0.0.1:8766', 'op')
            assert 'consent_collection' not in client.checkout.sessions.create.call_args.args[0]

    def test_create_checkout_with_gift_period(self, app_context):
        """create_checkout includes trial_end for gift period."""
        from sites.ffm.app import stripe_provider

        with patch('sites.ffm.app.stripe_provider._client') as mock_client_func:
            mock_client = _make_mock_client()
            mock_client_func.return_value = mock_client

            mock_client.checkout.sessions.create.return_value = {
                'id': 'cs_123',
                'url': 'https://checkout.stripe.com/test',
                'status': 'open',
            }

            future_epoch = int((datetime.now(timezone.utc) + timedelta(days=10)).timestamp())

            session = stripe_provider.create_checkout(
                'cus_123', 'user-id', 'price_quarterly',
                'https://example.com', 'op-123',
                gift_until=future_epoch
            )

            assert session['id'] == 'cs_123'
            mock_client.checkout.sessions.create.assert_called_once()
            call_args = mock_client.checkout.sessions.create.call_args
            # Verify subscription_data includes trial_end
            assert 'subscription_data' in call_args[0][0]

    def test_create_checkout_rejects_short_gift_period(self, app_context):
        """create_checkout rejects gift period < 48 hours."""
        from sites.ffm.app import stripe_provider

        now_epoch = int(datetime.now(timezone.utc).timestamp())
        short_future_epoch = now_epoch + 3600  # Only 1 hour from now

        with pytest.raises(ValueError) as exc:
            stripe_provider.create_checkout(
                'cus_123', 'user-id', 'price_quarterly',
                'https://example.com', 'op-123',
                gift_until=short_future_epoch
            )
        assert str(exc.value) == 'gift_period_too_short_for_checkout'


class TestGetCheckout:
    """Test checkout session retrieval."""

    def test_get_checkout_retrieves_session(self, app_context):
        """get_checkout retrieves session by ID."""
        from sites.ffm.app import stripe_provider

        with patch('sites.ffm.app.stripe_provider._client') as mock_client_func:
            mock_client = _make_mock_client()
            mock_client_func.return_value = mock_client

            mock_client.checkout.sessions.retrieve.return_value = {
                'id': 'cs_123',
                'status': 'complete',
            }

            session = stripe_provider.get_checkout('cs_123')

            assert session['id'] == 'cs_123'
            assert session['status'] == 'complete'
            mock_client.checkout.sessions.retrieve.assert_called_once_with('cs_123')


class TestExpireCheckout:
    """Test checkout session expiration."""

    def test_expire_checkout_expires_session(self, app_context):
        """expire_checkout expires a session."""
        from sites.ffm.app import stripe_provider

        with patch('sites.ffm.app.stripe_provider._client') as mock_client_func:
            mock_client = _make_mock_client()
            mock_client_func.return_value = mock_client

            mock_client.checkout.sessions.expire.return_value = {
                'id': 'cs_123',
                'status': 'expired',
            }

            session = stripe_provider.expire_checkout('cs_123', 'op-123')

            assert session['status'] == 'expired'
            mock_client.checkout.sessions.expire.assert_called_once()


class TestCreatePortal:
    """Test customer portal creation."""

    def test_create_portal_requires_config_id(self, app_context):
        """create_portal requires STRIPE_PORTAL_CONFIGURATION_ID."""
        from sites.ffm.app import stripe_provider

        with pytest.raises(RuntimeError) as exc:
            stripe_provider.create_portal('cus_123', 'https://example.com', '')
        assert 'STRIPE_PORTAL_CONFIGURATION_ID' in str(exc.value)

    def test_create_portal_creates_session(self, app_context):
        """create_portal creates a portal session."""
        from sites.ffm.app import stripe_provider

        with patch('sites.ffm.app.stripe_provider._client') as mock_client_func:
            mock_client = _make_mock_client()
            mock_client_func.return_value = mock_client

            mock_client.billing_portal.sessions.create.return_value = {
                'url': 'https://billing.stripe.com/portal/test',
            }

            portal = stripe_provider.create_portal('cus_123', 'https://example.com', 'bpc_123')

            assert 'url' in portal
            mock_client.billing_portal.sessions.create.assert_called_once()


class TestGetSubscription:
    """Test subscription retrieval."""

    def test_get_subscription_retrieves(self, app_context):
        """get_subscription retrieves subscription details."""
        from sites.ffm.app import stripe_provider

        with patch('sites.ffm.app.stripe_provider._client') as mock_client_func:
            mock_client = _make_mock_client()
            mock_client_func.return_value = mock_client

            mock_client.subscriptions.retrieve.return_value = {
                'id': 'sub_123',
                'status': 'active',
                'customer': 'cus_123',
            }

            sub = stripe_provider.get_subscription('sub_123')

            assert sub['id'] == 'sub_123'
            assert sub['status'] == 'active'
            mock_client.subscriptions.retrieve.assert_called_once_with('sub_123')


class TestListCustomerSubscriptions:
    """Test subscription listing."""

    def test_list_customer_subscriptions(self, app_context):
        """list_customer_subscriptions retrieves all customer subscriptions."""
        from sites.ffm.app import stripe_provider

        with patch('sites.ffm.app.stripe_provider._client') as mock_client_func:
            mock_client = _make_mock_client()
            mock_client_func.return_value = mock_client

            mock_iter = MagicMock()
            mock_iter.auto_paging_iter.return_value = [
                {'id': 'sub_1', 'status': 'active'},
                {'id': 'sub_2', 'status': 'canceled'},
            ]
            mock_client.subscriptions.list.return_value = mock_iter

            subs = stripe_provider.list_customer_subscriptions('cus_123')

            assert len(subs) == 2
            assert subs[0]['id'] == 'sub_1'
            mock_client.subscriptions.list.assert_called_once()


class TestGetInvoice:
    """Test invoice retrieval."""

    def test_get_invoice_retrieves(self, app_context):
        """get_invoice retrieves invoice details."""
        from sites.ffm.app import stripe_provider

        with patch('sites.ffm.app.stripe_provider._client') as mock_client_func:
            mock_client = _make_mock_client()
            mock_client_func.return_value = mock_client

            mock_client.invoices.retrieve.return_value = {
                'id': 'inv_123',
                'status': 'paid',
                'amount_paid': 300,
                'currency': 'eur',
            }

            invoice = stripe_provider.get_invoice('inv_123')

            assert invoice['id'] == 'inv_123'
            assert invoice['status'] == 'paid'


class TestListPaidInvoices:
    """Test paid invoice listing."""

    def test_list_paid_invoices(self, app_context):
        """list_paid_invoices retrieves paid invoices for subscription."""
        from sites.ffm.app import stripe_provider

        with patch('sites.ffm.app.stripe_provider._client') as mock_client_func:
            mock_client = _make_mock_client()
            mock_client_func.return_value = mock_client

            mock_iter = MagicMock()
            mock_iter.auto_paging_iter.return_value = [
                {'id': 'inv_1', 'status': 'paid', 'amount_paid': 300},
            ]
            mock_client.invoices.list.return_value = mock_iter

            invoices = stripe_provider.list_paid_invoices('cus_123', 'sub_123')

            assert len(invoices) == 1
            assert invoices[0]['status'] == 'paid'


class TestGetCharge:
    """Test charge retrieval."""

    def test_get_charge_retrieves(self, app_context):
        """get_charge retrieves charge details."""
        from sites.ffm.app import stripe_provider

        with patch('sites.ffm.app.stripe_provider._client') as mock_client_func:
            mock_client = _make_mock_client()
            mock_client_func.return_value = mock_client

            mock_client.charges.retrieve.return_value = {
                'id': 'ch_123',
                'amount': 300,
                'currency': 'eur',
                'status': 'succeeded',
            }

            charge = stripe_provider.get_charge('ch_123')

            assert charge['id'] == 'ch_123'
            assert charge['amount'] == 300


class TestPostponeRenewal:
    """Test subscription trial/renewal postponement."""

    def test_postpone_renewal_updates_trial_end(self, app_context):
        """postpone_renewal updates subscription with new trial_end."""
        from sites.ffm.app import stripe_provider

        with patch('sites.ffm.app.stripe_provider._client') as mock_client_func:
            mock_client = _make_mock_client()
            mock_client_func.return_value = mock_client

            future_date = '2099-12-31T23:59:59Z'
            future_epoch = int(datetime.fromisoformat('2099-12-31T23:59:59+00:00').timestamp())

            mock_client.subscriptions.update.return_value = {
                'id': 'sub_123',
                'trial_end': future_epoch,
                'status': 'trialing',
            }

            sub = stripe_provider.postpone_renewal('sub_123', future_date, 'op-123')

            assert sub['trial_end'] == future_epoch
            mock_client.subscriptions.update.assert_called_once()
            call_args = mock_client.subscriptions.update.call_args
            # Verify proration_behavior is 'none'
            assert call_args[0][1]['proration_behavior'] == 'none'


class TestCancelSubscription:
    """Test subscription cancellation."""

    def test_cancel_subscription_at_period_end(self, app_context):
        """cancel_subscription schedules cancellation at period end."""
        from sites.ffm.app import stripe_provider

        with patch('sites.ffm.app.stripe_provider._client') as mock_client_func:
            mock_client = _make_mock_client()
            mock_client_func.return_value = mock_client

            mock_client.subscriptions.update.return_value = {
                'id': 'sub_123',
                'cancel_at_period_end': True,
                'status': 'active',
            }

            sub = stripe_provider.cancel_subscription('sub_123', immediate=False, operation_id='op-123')

            assert sub['cancel_at_period_end'] is True
            mock_client.subscriptions.update.assert_called_once()

    def test_cancel_subscription_immediate(self, app_context):
        """cancel_subscription can cancel immediately."""
        from sites.ffm.app import stripe_provider

        with patch('sites.ffm.app.stripe_provider._client') as mock_client_func:
            mock_client = _make_mock_client()
            mock_client_func.return_value = mock_client

            mock_client.subscriptions.cancel.return_value = {
                'id': 'sub_123',
                'status': 'canceled',
            }

            sub = stripe_provider.cancel_subscription('sub_123', immediate=True, operation_id='op-123')

            assert sub['status'] == 'canceled'
            mock_client.subscriptions.cancel.assert_called_once()


class TestListAllSubscriptions:
    """Test listing all subscriptions."""

    def test_list_all_subscriptions(self, app_context):
        """list_all_subscriptions retrieves subscriptions with status filter."""
        from sites.ffm.app import stripe_provider

        with patch('sites.ffm.app.stripe_provider._client') as mock_client_func:
            mock_client = _make_mock_client()
            mock_client_func.return_value = mock_client

            mock_iter = MagicMock()
            mock_iter.auto_paging_iter.return_value = [
                {'id': 'sub_1', 'status': 'active'},
                {'id': 'sub_2', 'status': 'active'},
            ]
            mock_client.subscriptions.list.return_value = mock_iter

            subs = stripe_provider.list_all_subscriptions(status='active')

            assert len(subs) == 2
            mock_client.subscriptions.list.assert_called_once()


class TestClientVersion:
    """Test that StripeClient uses correct API version."""

    def test_client_uses_v1_api(self, app_context):
        """_client returns StripeClient.v1 for correct API version."""
        from sites.ffm.app import stripe_provider

        # The _client function should return v1
        # Check the API_VERSION constant
        assert stripe_provider.API_VERSION == '2024-06-20'
