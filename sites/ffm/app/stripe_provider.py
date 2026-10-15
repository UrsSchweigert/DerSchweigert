"""Stripe requests use an explicit API version, timeout and per-client key."""

import os
from datetime import datetime, timezone

import stripe
from flask import current_app

API_VERSION = '2024-06-20'
CHECKOUT_API_VERSION = '2025-03-31.basil'


def _secret(name):
    value = current_app.config.get(name) or os.environ.get(name)
    if not value:
        raise RuntimeError(f'{name} is not configured')
    return value


def _client():
    from stripe._http_client import new_default_http_client
    return stripe.StripeClient(
        _secret('STRIPE_SECRET_KEY'), stripe_version=API_VERSION, max_network_retries=1,
        http_client=new_default_http_client(timeout=10),
    ).v1


def _plain(value):
    if hasattr(value, 'to_dict_recursive'):
        return value.to_dict_recursive()
    elif hasattr(value, 'to_dict'):
        return value.to_dict()
    else:
        return dict(value) if value else {}


def verify_event(payload, signature):
    return _plain(stripe.Webhook.construct_event(payload, signature, _secret('STRIPE_WEBHOOK_SECRET')))


def validate_price(price_id):
    price = _plain(_client().prices.retrieve(price_id))
    recurring = price.get('recurring') or {}
    if not (price.get('active') and price.get('currency') == 'eur'
            and price.get('unit_amount') == 300 and recurring.get('interval') == 'month'
            and recurring.get('interval_count') == 3):
        raise ValueError('invalid_price')
    return price


def create_customer(stable_uuid, email, idempotency_key):
    return _plain(_client().customers.create(
        {'email': email, 'metadata': {'billing_uuid': stable_uuid}},
        options={'idempotency_key': idempotency_key},
    ))


def create_checkout(customer_id, stable_uuid, price_id, return_base_url, operation_id, gift_until=None):
    subscription_data = {'metadata': {'billing_uuid': stable_uuid}}
    if gift_until is not None:
        if gift_until <= int(datetime.now(timezone.utc).timestamp()) + 48 * 3600:
            raise ValueError('gift_period_too_short_for_checkout')
        subscription_data.update(
            trial_end=gift_until,
            trial_settings={'end_behavior': {'missing_payment_method': 'cancel'}},
        )
    params = {
        'customer': customer_id, 'mode': 'subscription',
        'managed_payments': {'enabled': False},
        'client_reference_id': stable_uuid, 'metadata': {'billing_uuid': stable_uuid},
        'line_items': [{'price': price_id, 'quantity': 1}],
        'subscription_data': subscription_data, 'payment_method_collection': 'always',
        'billing_address_collection': 'required',
        'customer_update': {'address': 'auto', 'name': 'auto'},
        'success_url': return_base_url.rstrip('/') + '/?billing=success&session_id={CHECKOUT_SESSION_ID}',
        'cancel_url': return_base_url.rstrip('/') + '/?billing=cancel',
    }
    if current_app.config.get('STRIPE_CHECKOUT_TERMS_CONSENT_ENABLED', True):
        params['consent_collection'] = {'terms_of_service': 'required'}
    return _plain(_client().checkout.sessions.create(
        params, options={'idempotency_key': operation_id, 'stripe_version': CHECKOUT_API_VERSION},
    ))


def get_checkout(session_id):
    return _plain(_client().checkout.sessions.retrieve(session_id))


def expire_checkout(session_id, operation_id):
    return _plain(_client().checkout.sessions.expire(session_id, options={'idempotency_key': operation_id}))


def create_portal(customer_id, return_url, config_id):
    if not config_id:
        raise RuntimeError('STRIPE_PORTAL_CONFIGURATION_ID is required')
    return _plain(_client().billing_portal.sessions.create({
        'customer': customer_id, 'return_url': return_url, 'configuration': config_id,
    }))


def get_subscription(subscription_id):
    return _plain(_client().subscriptions.retrieve(subscription_id))


def list_customer_subscriptions(customer_id):
    return [_plain(sub) for sub in _client().subscriptions.list({
        'customer': customer_id, 'status': 'all', 'limit': 100,
    }).auto_paging_iter()]


def get_invoice(invoice_id):
    return _plain(_client().invoices.retrieve(invoice_id))


def list_paid_invoices(customer_id, subscription_id):
    return [_plain(invoice) for invoice in _client().invoices.list({
        'customer': customer_id, 'subscription': subscription_id, 'status': 'paid', 'limit': 100,
    }).auto_paging_iter()]


def get_charge(charge_id):
    return _plain(_client().charges.retrieve(charge_id))


def list_disputes(charge_id):
    """Dispute objects for a charge, filtered server-side by Stripe (documented
    ``charge`` list parameter). Charge.disputed only means "has been disputed" --
    the actual won/lost/inquiry state lives on the Dispute object, not the charge."""
    return [_plain(dispute) for dispute in _client().disputes.list({
        'charge': charge_id, 'limit': 100,
    }).auto_paging_iter()]


def refund_charge(charge_id, amount, operation_id):
    return _plain(_client().refunds.create(
        {'charge': charge_id, 'amount': amount}, options={'idempotency_key': operation_id},
    ))


def postpone_renewal(subscription_id, until_iso, operation_id):
    trial_end = int(datetime.fromisoformat(until_iso.replace('Z', '+00:00')).timestamp())
    return _plain(_client().subscriptions.update(subscription_id, {
        'trial_end': trial_end, 'proration_behavior': 'none',
    }, options={'idempotency_key': operation_id}))


def cancel_subscription(subscription_id, immediate=False, operation_id=None):
    options = {'idempotency_key': operation_id} if operation_id else None
    if immediate:
        return _plain(_client().subscriptions.cancel(
            subscription_id, {'invoice_now': False, 'prorate': False}, options=options,
        ))
    return _plain(_client().subscriptions.update(
        subscription_id, {'cancel_at_period_end': True}, options=options,
    ))


def list_all_subscriptions(status='all'):
    return [_plain(sub) for sub in _client().subscriptions.list({
        'status': status, 'limit': 100,
    }).auto_paging_iter()]
