"""Stripe requests use an explicit API version, timeout and per-client key."""

import os
from datetime import datetime, timezone
from decimal import Decimal

import stripe
from flask import current_app

# One API version for every request. Since 2025-03-31.basil several fields FFM
# reads moved (see the shape helpers at the bottom); the live webhook endpoint
# renders events at its own pinned version, so the helpers accept both shapes.
API_VERSION = '2026-10-28.endive'

# The subscription's price in cents (EUR 1.99, tax inclusive, every 3 months).
# validate_price() requires it and billing._valid_paid_end() counts only invoices
# that paid at least this much, so the two can never disagree again.
PRICE_UNIT_AMOUNT = 199


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


def _decimals_to_strings(value):
    """The SDK turns Stripe's decimal-string fields (unit_amount_decimal,
    plan.amount_decimal, ...) into Decimal, which json.dumps cannot serialize.
    Turning them back into strings restores exactly what the API sent: no float
    rounding for money, and the result stays safe for JSON and DynamoDB."""
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, dict):
        return {key: _decimals_to_strings(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_decimals_to_strings(item) for item in value]
    return value


def _plain(value):
    """Every Stripe result leaves this module as plain JSON-safe data."""
    if hasattr(value, 'to_dict_recursive'):
        value = value.to_dict_recursive()
    elif hasattr(value, 'to_dict'):
        value = value.to_dict()
    else:
        value = dict(value) if value else {}
    return _decimals_to_strings(value)


def _webhook_secrets():
    """STRIPE_WEBHOOK_SECRET may hold several comma-separated signing secrets, so
    an old and a new webhook endpoint can both deliver while one replaces the other."""
    return [part.strip() for part in _secret('STRIPE_WEBHOOK_SECRET').split(',') if part.strip()]


def verify_event(payload, signature):
    error = None
    for secret in _webhook_secrets():
        try:
            return _plain(stripe.Webhook.construct_event(payload, signature, secret))
        except stripe.SignatureVerificationError as exc:
            error = exc
    raise error or stripe.SignatureVerificationError('no webhook secret configured', signature)


def validate_price(price_id):
    price = _plain(_client().prices.retrieve(price_id))
    recurring = price.get('recurring') or {}
    if not (price.get('active') and price.get('currency') == 'eur'
            and price.get('unit_amount') == PRICE_UNIT_AMOUNT and recurring.get('interval') == 'month'
            and recurring.get('interval_count') == 3):
        raise ValueError('invalid_price')
    return price


def create_customer(stable_uuid, email, idempotency_key):
    return _plain(_client().customers.create(
        {'email': email, 'metadata': {'billing_uuid': stable_uuid}},
        options={'idempotency_key': idempotency_key},
    ))


def create_checkout(customer_id, stable_uuid, price_id, return_base_url, operation_id, gift_until=None):
    # checkout_operation lets the webhook/reconcile path look back up the
    # exact versioned declarations durably bound to this checkout attempt
    # (see app/contract_confirmation_store.py), without trusting anything
    # from the webhook payload itself.
    subscription_data = {'metadata': {'billing_uuid': stable_uuid, 'checkout_operation': operation_id}}
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
    return _plain(_client().checkout.sessions.create(params, options={'idempotency_key': operation_id}))


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
    # `payments` is only returned when expanded; get_invoice_charge_id() needs it.
    return _plain(_client().invoices.retrieve(invoice_id, {'expand': ['payments']}))


def list_paid_invoices(customer_id, subscription_id):
    return [_plain(invoice) for invoice in _client().invoices.list({
        'customer': customer_id, 'subscription': subscription_id, 'status': 'paid', 'limit': 100,
        'expand': ['data.payments'],
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


# ── Shape helpers ─────────────────────────────────────────────────────────────
# Since API version 2025-03-31.basil Stripe moved fields FFM depends on. Objects
# fetched here use API_VERSION, but webhook payloads use the endpoint's pinned
# version, so every helper reads the current shape and falls back to the
# 2024-06-20 one.

def invoice_subscription_id(invoice):
    """2024-06-20: invoice.subscription. Since basil: invoice.parent.subscription_details.subscription."""
    if invoice.get('subscription'):
        return invoice['subscription']
    return ((invoice.get('parent') or {}).get('subscription_details') or {}).get('subscription')


def invoice_is_paid(invoice):
    """2024-06-20: invoice.paid. Since basil the flag is gone; status 'paid' means the same."""
    if invoice.get('paid') is not None:
        return bool(invoice['paid'])
    return invoice.get('status') == 'paid'


def get_invoice_charge_id(invoice):
    """2024-06-20: invoice.charge. Since basil: the invoice's payments, whose payment
    is either a charge or a payment intent (whose latest charge it is)."""
    if invoice.get('charge'):
        return invoice['charge']
    payments = invoice.get('payments')
    if payments is None and invoice.get('id'):
        payments = get_invoice(invoice['id']).get('payments')
    for invoice_payment in ((payments or {}).get('data') or []):
        if invoice_payment.get('status') not in (None, 'paid'):
            continue
        payment = invoice_payment.get('payment') or {}
        if payment.get('type') == 'charge' and payment.get('charge'):
            charge = payment['charge']
            return charge['id'] if isinstance(charge, dict) else charge
        if payment.get('type') == 'payment_intent' and payment.get('payment_intent'):
            intent = payment['payment_intent']
            intent_id = intent['id'] if isinstance(intent, dict) else intent
            latest = _plain(_client().payment_intents.retrieve(intent_id)).get('latest_charge')
            if latest:
                return latest['id'] if isinstance(latest, dict) else latest
    return None


def get_charge_invoice_id(charge):
    """2024-06-20: charge.invoice. Since basil the link is an InvoicePayment, found by
    the charge's payment intent."""
    if charge.get('invoice'):
        return charge['invoice']
    intent = charge.get('payment_intent')
    if not intent:
        return None
    intent_id = intent['id'] if isinstance(intent, dict) else intent
    for invoice_payment in _client().invoice_payments.list({
        'payment': {'type': 'payment_intent', 'payment_intent': intent_id}, 'limit': 10,
    }).auto_paging_iter():
        invoice = _plain(invoice_payment).get('invoice')
        if invoice:
            return invoice['id'] if isinstance(invoice, dict) else invoice
    return None


def subscription_period_end(subscription):
    """2024-06-20: subscription.current_period_end. Since basil it lives on each item."""
    if subscription.get('current_period_end'):
        return subscription['current_period_end']
    ends = [item.get('current_period_end') for item in (subscription.get('items') or {}).get('data', [])]
    ends = [end for end in ends if end]
    return max(ends) if ends else None


def line_price_id(line):
    """2024-06-20: line.price.id. Since basil: line.pricing.price_details.price."""
    price = line.get('price')
    if isinstance(price, dict) and price.get('id'):
        return price['id']
    if isinstance(price, str):
        return price
    return ((line.get('pricing') or {}).get('price_details') or {}).get('price')


def line_is_proration(line):
    """2024-06-20: line.proration. Since basil: under the line's parent details."""
    if line.get('proration') is not None:
        return bool(line['proration'])
    parent = line.get('parent') or {}
    for details in ('subscription_item_details', 'invoice_item_details'):
        if (parent.get(details) or {}).get('proration'):
            return True
    return False
