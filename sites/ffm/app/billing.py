"""Hosted billing and recoverable gift grants. No client-supplied entitlement."""

import secrets
import hashlib
from contextlib import contextmanager
from datetime import datetime, timezone

import stripe
from flask import Blueprint, current_app, jsonify, request

from . import billing_store as store, entitlements, models, stripe_provider as provider
from .extensions import limiter
from .main import require_auth

billing_bp = Blueprint('billing', __name__, url_prefix='/api/billing')
_LIVE_STATES = {'active', 'trialing', 'past_due', 'unpaid', 'incomplete', 'paused'}
#: Terminal Stripe subscription statuses: the subscription will never become
#: live again on its own. Complement of _LIVE_STATES.
_TERMINAL_STATES = {'canceled', 'incomplete_expired'}


def _iso(epoch):
    return datetime.fromtimestamp(epoch, timezone.utc).isoformat()


@contextmanager
def billing_lock(identity, owner=None):
    owner = owner or secrets.token_hex(16)
    store.acquire_billing_lock(identity, owner)
    try:
        yield owner
    finally:
        store.release_billing_lock(identity, owner)


def _verified_user():
    username = require_auth()
    user = models.get_user(username)
    if not user:
        return None, (jsonify(error='account_not_found'), 401)
    if not user['email_verified']:
        return None, (jsonify(error='verification_required'), 403)
    user['stable_id'] = models.ensure_stable_id(username)
    return user, None


def _pending_guard(state):
    if state.get('deleted'):
        raise ValueError('account_deleted')
    if state.get('pending_redemption'):
        raise ValueError('billing_busy')


def _replaceable_terminal_subscription(session, identity, customer, price):
    """True only if a completed checkout session's subscription is verified,
    against fresh provider truth, to be a terminal (canceled/incomplete_expired)
    subscription owned by this exact customer/identity/price.

    Used to recover from a completed checkout session whose subscription was
    later refunded and canceled (e.g. a sandbox refund immediately followed by
    cancellation): without this, /checkout would refuse to issue a new
    checkout forever, because a 'complete' session was treated as permanently
    pending confirmation. Any ambiguity (missing/foreign subscription, wrong
    customer, wrong identity, wrong price, or still-live status) must return
    False so the caller keeps the existing safe 'payment_confirmation_pending'
    behavior instead of risking a duplicate or cross-account subscription.
    """
    if session.get('customer') != customer:
        return False
    subscription_id = session.get('subscription')
    if not subscription_id:
        return False
    subscription = provider.get_subscription(subscription_id)
    if subscription['status'] not in _TERMINAL_STATES:
        return False
    if subscription.get('metadata', {}).get('billing_uuid') != identity:
        return False
    if subscription.get('customer') != customer:
        return False
    items = subscription.get('items', {}).get('data', [])
    if len(items) != 1 or items[0]['price']['id'] != price:
        return False
    return True


@billing_bp.after_request
def no_cache(response):
    response.headers['Cache-Control'] = 'private, no-store'
    response.vary.add('Authorization')
    return response


@billing_bp.errorhandler(ValueError)
def billing_conflict(error):
    code = str(error)
    allowed = {
        'invalid_code', 'not_found', 'revoked', 'expired', 'already_redeemed',
        'wrong_identity', 'billing_busy', 'billing_conflict', 'version_mismatch',
        'invalid_price', 'account_deleted', 'duplicate_subscription',
        'gift_period_too_short_for_checkout', 'invalid_subscription', 'subscription_mismatch',
    }
    if code not in allowed:
        raise error
    return jsonify(error=code), 409 if code in {
        'billing_busy', 'billing_conflict', 'version_mismatch', 'duplicate_subscription',
        'subscription_mismatch',
    } else 400


@billing_bp.errorhandler(stripe.StripeError)
def provider_unavailable(error):
    current_app.logger.error('Stripe operation failed: %s', type(error).__name__)
    return jsonify(error='billing_provider_unavailable', message='Please retry. No access grant was assumed.'), 503


@billing_bp.route('/status', methods=['GET'])
def status():
    username = require_auth() if request.headers.get('Authorization') else None
    return jsonify(entitlements.get_access_status(username))


@billing_bp.route('/checkout', methods=['POST'])
@limiter.limit('10/minute')
def checkout():
    user, error = _verified_user()
    if error:
        return error
    config = current_app.config
    if not all(config.get(flag) for flag in (
        'ACCESS_CONTROL_ENABLED', 'BILLING_ENABLED', 'BILLING_SALES_ENABLED', 'BILLING_TERMS_APPROVED',
    )):
        return jsonify(error='sales_unavailable'), 503
    access = entitlements.get_access_status(user['username'])
    if access['reason'] == 'grandfathered':
        return jsonify(error='subscription_not_needed', access=access), 409
    data = request.get_json(silent=True)
    if not isinstance(data, dict) or data.get('adult_confirmed') is not True or data.get('terms_accepted') is not True:
        return jsonify(error='adult_and_terms_confirmation_required'), 400
    identity = user['stable_id']
    recover_pending_redemption(identity)
    with billing_lock(identity):
        state = store.get_billing_state(identity) or {}
        _pending_guard(state)
        price = config['STRIPE_PRICE_ID']
        provider.validate_price(price)
        customer = state.get('customer_id')
        if not customer:
            customer = provider.create_customer(identity, user['email'], f'customer-{identity}')['id']
            state = store.put_billing_state(identity, customer_id=customer)
        live = [sub for sub in provider.list_customer_subscriptions(customer) if sub['status'] in _LIVE_STATES]
        if live:
            raise ValueError('duplicate_subscription')
        if state.get('checkout_session_id'):
            existing = provider.get_checkout(state['checkout_session_id'])
            if existing['status'] == 'open':
                return jsonify(url=existing['url'])
            if existing['status'] == 'complete':
                if _replaceable_terminal_subscription(existing, identity, customer, price):
                    # Retire the terminal checkout and its idempotency key together.
                    state = store.put_billing_state(identity, checkout_session_id=None, checkout_operation=None)
                else:
                    return jsonify(error='payment_confirmation_pending'), 409
        operation = state.get('checkout_operation')
        if not operation or state.get('checkout_session_id'):
            operation = f'checkout-{secrets.token_hex(16)}'
            state = store.put_billing_state(identity, checkout_operation=operation, checkout_session_id=None)
        gift_until = state.get('gift_until')
        gift_epoch = int(models._parse_timestamp(gift_until).timestamp()) if gift_until else None
        if gift_epoch and gift_epoch <= int(datetime.now(timezone.utc).timestamp()):
            gift_epoch = None
        session = provider.create_checkout(
            customer, identity, price, config['APP_BASE_URL'], operation, gift_until=gift_epoch,
        )
        store.put_billing_state(identity, checkout_session_id=session['id'])
        return jsonify(url=session['url'])


@billing_bp.route('/portal', methods=['POST'])
def portal():
    user, error = _verified_user()
    if error:
        return error
    state = store.get_billing_state(user['stable_id']) or {}
    if not state.get('customer_id'):
        return jsonify(error='no_billing_account'), 404
    # Detect missing portal configuration (e.g. a sandbox started without
    # --portal-id) before calling the provider: stripe_provider.create_portal
    # raises a bare RuntimeError in that case, which Flask turns into an
    # uncaught HTML 500 page instead of a JSON error the frontend can parse.
    # This never depends on subscription status -- a canceled subscription
    # must still be able to reach portal/billing history.
    if not current_app.config.get('STRIPE_PORTAL_CONFIGURATION_ID'):
        return jsonify(error='portal_unavailable'), 503
    result = provider.create_portal(
        state['customer_id'], current_app.config['APP_BASE_URL'],
        current_app.config['STRIPE_PORTAL_CONFIGURATION_ID'],
    )
    return jsonify(url=result['url'])


#: Sentinel distinguishing "no expected-subscription check requested" (the
#: authenticated `/cancel` route's existing behavior, unchanged) from an
#: explicitly-bound expected subscription id that may legitimately be
#: `None` (reviewed at a time the account had no live subscription).
_NO_EXPECTED_SUBSCRIPTION = object()


def cancel_future_renewals(identity, expected_subscription_id=_NO_EXPECTED_SUBSCRIPTION):
    """Cancel future renewals for a durable billing identity (stable_id).

    Shared by the authenticated `/cancel` route below and the manual
    operator `billing-admin cancel-request process` CLI command (see
    app/billing_admin.py). Recovers any pending gift redemption first so
    it is never lost, and never claims a subscription was canceled when
    none exists: callers must check the returned `outcome` rather than
    assume success just because this function didn't raise.

    `expected_subscription_id` is an optional safety check used only by
    the operator CLI: it binds the subscription_id a human reviewer saw
    *at review time* (which may be `None`) and, under the same billing
    lock used to read-then-act, requires the identity's *current*
    subscription_id to still match it before calling the provider. This
    closes a retry race: if a provider cancel call previously succeeded
    but the operator tool crashed/failed before durably recording that
    outcome, and the subscriber meanwhile started a brand-new
    (replacement) subscription, a naive retry would otherwise silently
    cancel that unrelated replacement subscription instead of refusing.
    On mismatch this raises ValueError('subscription_mismatch') rather
    than ever calling the provider against a subscription nobody
    reviewed; it never substitutes a different subscription_id of its
    own accord. The authenticated route below never passes this
    argument, so its existing behavior is unchanged.
    """
    recover_pending_redemption(identity)
    with billing_lock(identity):
        state = store.get_billing_state(identity) or {}
        _pending_guard(state)
        if expected_subscription_id is not _NO_EXPECTED_SUBSCRIPTION:
            if state.get('subscription_id') != expected_subscription_id:
                raise ValueError('subscription_mismatch')
        if state.get('subscription_id') and state.get('status') in _LIVE_STATES:
            sub = provider.cancel_subscription(
                state['subscription_id'], operation_id=f'cancel-{identity}-{state["subscription_id"]}',
            )
            store.put_billing_state(identity, cancel_at_period_end=sub.get('cancel_at_period_end', True),
                                    next_payment_at=None, status=sub['status'])
            return {
                'outcome': 'fulfilled',
                'subscription_id': state['subscription_id'],
                'cancel_at_period_end': sub.get('cancel_at_period_end', True),
                'status': sub['status'],
            }
        return {'outcome': 'no_subscription'}


@billing_bp.route('/cancel', methods=['POST'])
def cancel():
    user, error = _verified_user()
    if error:
        return error
    cancel_future_renewals(user['stable_id'])
    return jsonify(access=entitlements.get_access_status(user['username']))


def redeem_for_user(user, plaintext):
    identity = user['stable_id']
    code_hash = store._code_hash(plaintext)
    operation_id = hashlib.sha256((identity + code_hash).encode('ascii')).hexdigest()
    existing = store.get_operation(operation_id)
    if existing and existing['completed']:
        return existing['target_gift_until']
    with billing_lock(identity, operation_id):
        state = store.get_billing_state(identity) or {}
        if not state.get('pending_redemption'):
            # An open checkout predates this gift and would charge immediately.
            # Expire it before reserving; a future checkout will include the gift.
            if state.get('checkout_session_id'):
                session = provider.get_checkout(state['checkout_session_id'])
                if session['status'] == 'open':
                    provider.expire_checkout(session['id'], f'gift-expire-{operation_id}')
            if state.get('customer_id'):
                live = [sub for sub in provider.list_customer_subscriptions(state['customer_id'])
                        if sub['status'] in _LIVE_STATES]
                if len(live) > 1:
                    raise ValueError('duplicate_subscription')
                if live:
                    reconcile_subscription(identity, live[0]['id'])
        operation_id, target = store.reserve_code_redemption(identity, plaintext)
        _complete_gift_operation(identity, operation_id)
    return target


def _complete_gift_operation(identity, operation_id):
    operation = store.get_operation(operation_id)
    if not operation:
        raise ValueError('billing_busy')
    if operation['completed']:
        return operation['target_gift_until']
    target = operation['target_gift_until']
    with billing_lock(identity, operation_id):
        state = store.get_billing_state(identity) or {}
        if state.get('deleted'):
            raise ValueError('account_deleted')
        if state.get('subscription_id'):
            sub = provider.get_subscription(state['subscription_id'])
            # A canceled subscription must not be restarted by a gift.
            if sub['status'] in _LIVE_STATES and not sub.get('cancel_at_period_end') and not sub.get('cancel_at'):
                target_epoch = int(models._parse_timestamp(target).timestamp())
                if sub.get('trial_end', 0) and sub['trial_end'] >= target_epoch:
                    updated = sub
                else:
                    updated = provider.postpone_renewal(sub['id'], target, f'gift-{operation_id}')
                store.put_billing_state(identity, next_payment_at=_iso(updated['trial_end']),
                                        status=updated['status'])
            else:
                store.put_billing_state(identity, status=sub['status'],
                                        cancel_at_period_end=bool(sub.get('cancel_at_period_end') or sub.get('cancel_at')),
                                        next_payment_at=None)
        store.complete_code_redemption(operation_id, identity)
    return target


def recover_pending_redemption(identity):
    state = store.get_billing_state(identity) or {}
    if state.get('pending_redemption'):
        return _complete_gift_operation(identity, state['pending_redemption'])
    return None


@billing_bp.route('/recover', methods=['POST'])
@limiter.limit('5/minute')
def recover():
    user, error = _verified_user()
    if error:
        return error
    recover_pending_redemption(user['stable_id'])
    return jsonify(access=entitlements.get_access_status(user['username']))


@billing_bp.route('/redeem', methods=['POST'])
@limiter.limit('5/minute')
def redeem():
    user, error = _verified_user()
    if error:
        return error
    if entitlements.get_access_status(user['username'])['reason'] == 'grandfathered':
        return jsonify(error='code_not_needed'), 409
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return jsonify(error='invalid_code'), 400
    target = redeem_for_user(user, data.get('code'))
    return jsonify(gift_until=target, access=entitlements.get_access_status(user['username']))


def _invoice_country(invoice, charge=None):
    country = (invoice.get('customer_address') or {}).get('country')
    if country:
        return country
    if charge is None and invoice.get('charge'):
        charge = provider.get_charge(invoice['charge'])
    return (((charge or {}).get('billing_details') or {}).get('address') or {}).get('country')


def _charge_disqualified_by_dispute(charge_id, charge):
    """True unless every Stripe Dispute on this charge resolved as 'won'.

    Stripe's Charge API reference documents ``disputed`` only as "Whether the
    charge has been disputed" -- it does not document this flag reverting to
    False once a dispute resolves 'won' (and ``charge.dispute.closed`` webhook
    payloads must not be trusted at face value either way). So when
    disputed=True we retrieve the actual Dispute object(s) for this charge via
    ``disputes.list(charge=...)`` -- documented, server-side filtered by Stripe
    -- and only treat the charge as eligible again if every dispute found on it
    has Dispute.status == 'won'. A charge can in principle accumulate more than
    one dispute over its lifetime; any dispute that is not won (open, lost,
    inquiry, etc.) keeps the charge disqualified. Unknown or missing dispute
    state (disputed=True but no Dispute object found) also denies safely."""
    if not charge.get('disputed'):
        return False
    disputes = provider.list_disputes(charge_id)
    if not disputes:
        return True
    for dispute in disputes:
        if dispute.get('charge') != charge_id:
            raise ValueError('invalid_dispute')
        if dispute.get('status') != 'won':
            return True
    return False


def _valid_paid_end(subscription):
    price_id = current_app.config['STRIPE_PRICE_ID']
    ends = []
    for invoice in provider.list_paid_invoices(subscription['customer'], subscription['id']):
        if invoice.get('currency') != 'eur' or invoice.get('amount_paid', 0) < 300 or not invoice.get('paid'):
            continue
        charge_id = invoice.get('charge')
        if not charge_id:
            continue
        charge = provider.get_charge(charge_id)
        if _invoice_country(invoice, charge) != 'DE':
            continue
        if (not charge.get('paid') or charge.get('refunded') or charge.get('amount_refunded', 0)
                or _charge_disqualified_by_dispute(charge_id, charge)):
            continue
        for line in invoice['lines']['data']:
            if (line.get('price') or {}).get('id') == price_id and not line.get('proration'):
                ends.append(line['period']['end'])
    return _iso(max(ends)) if ends else None


def _subscription_superseded(state, subscription_id):
    """True if billing state already points at a different, still-live
    subscription than the one being reconciled.

    Always re-checks the *stored* subscription against fresh provider truth
    (never the webhook payload, which can race a replacement checkout), so a
    late lifecycle event for an old subscription -- a delayed
    customer.subscription.deleted, refund, or dispute closure -- can never
    overwrite billing state and revoke access that a subsequent, unrelated
    subscription already granted. Returns False (letting the caller proceed
    with its normal write) for same-subscription lifecycle events, first
    attach (nothing stored yet), and legitimate replacement attachment once
    the stored subscription has itself gone terminal -- only a *live*,
    *different* stored subscription outranks the one being reconciled.
    """
    current_id = state.get('subscription_id')
    if not current_id or current_id == subscription_id:
        return False
    current = provider.get_subscription(current_id)
    return current['status'] in _LIVE_STATES


def reconcile_subscription(identity, subscription_id, event_id=None, owner=None):
    """Re-fetch current provider facts, not potentially stale webhook payloads."""
    subscription = provider.get_subscription(subscription_id)
    state = store.get_billing_state(identity) or {}
    _pending_guard(state)
    if (subscription.get('metadata', {}).get('billing_uuid') != identity
            or subscription['customer'] != state.get('customer_id')):
        raise ValueError('invalid_subscription')
    items = subscription.get('items', {}).get('data', [])
    if len(items) != 1 or items[0]['price']['id'] != current_app.config['STRIPE_PRICE_ID']:
        raise ValueError('invalid_subscription')
    if _subscription_superseded(state, subscription_id):
        # This subscription has already been replaced by a newer, still-live
        # one; mark the event handled (if tracked) without touching state.
        if event_id:
            store.complete_billing_event(identity, event_id, owner, {})
        return None
    renewing = subscription['status'] in _LIVE_STATES and not (
        subscription.get('cancel_at_period_end') or subscription.get('cancel_at')
    )
    changes = {
        'subscription_id': subscription_id, 'status': subscription['status'],
        'paid_until': _valid_paid_end(subscription), 'revocation': False,
        'cancel_at_period_end': bool(subscription.get('cancel_at_period_end') or subscription.get('cancel_at')),
        'next_payment_at': _iso(subscription.get('trial_end') or subscription['current_period_end']) if renewing else None,
    }
    if event_id:
        store.complete_billing_event(identity, event_id, owner, changes)
    else:
        store.put_billing_state(identity, **changes)
    return changes


def process_event(event):
    if store.event_completed(event['id']):
        return
    obj = event['data']['object']
    event_type = event['type']
    if event_type.startswith('customer.subscription.'):
        subscription_id = obj['id']
    elif event_type.startswith('invoice.'):
        # Newer webhook versions move subscription references under parent.
        # Retrieve the invoice using our pinned API version before interpreting it.
        if 'subscription' not in obj:
            obj = provider.get_invoice(obj['id'])
        subscription_id = obj.get('subscription')
    elif event_type == 'checkout.session.completed':
        subscription_id = obj.get('subscription')
    elif event_type.startswith('charge.refund') or event_type.startswith('charge.dispute.'):
        charge = provider.get_charge(obj.get('charge') or obj['id'])
        invoice = provider.get_invoice(charge['invoice']) if charge.get('invoice') else None
        subscription_id = invoice.get('subscription') if invoice else None
    else:
        return
    if not subscription_id:
        return
    subscription = provider.get_subscription(subscription_id)
    identity = subscription.get('metadata', {}).get('billing_uuid')
    if not identity:
        return
    username = store.get_billing_username_mapping(identity)
    if not username:
        return  # Deleted/foreign identities cannot attach to a recycled username.
    user = models.get_user(username)
    if not user or user.get('stable_id') != identity:
        return
    recover_pending_redemption(identity)
    with billing_lock(identity) as owner:
        if store.event_completed(event['id']):
            return
        state = store.get_billing_state(identity) or {}
        _pending_guard(state)
        checkout_country = ((obj.get('customer_details') or {}).get('address') or {}).get('country')
        invoice_country = _invoice_country(obj) if event_type.startswith('invoice.') else None
        foreign = (event_type == 'checkout.session.completed' and checkout_country != 'DE') or (
            event_type in ('invoice.paid', 'invoice.payment_succeeded') and obj.get('amount_paid', 0) > 0 and invoice_country != 'DE'
        )
        if foreign:
            if subscription['customer'] != state.get('customer_id'):
                raise ValueError('invalid_subscription')
            provider.cancel_subscription(subscription_id, immediate=True, operation_id=f'ineligible-{event["id"]}')
            invoice_id = obj.get('invoice') if event_type == 'checkout.session.completed' else obj['id']
            if invoice_id:
                invoice = provider.get_invoice(invoice_id)
                if (invoice.get('subscription') != subscription_id
                        or invoice.get('customer') != state.get('customer_id')):
                    raise ValueError('invalid_invoice')
                if invoice.get('charge'):
                    charge = provider.get_charge(invoice['charge'])
                    if charge.get('invoice') != invoice_id:
                        raise ValueError('invalid_charge')
                    remaining = charge['amount'] - charge.get('amount_refunded', 0)
                    if remaining > 0:
                        provider.refund_charge(charge['id'], remaining, f'ineligible-refund-{invoice_id}')
            new_paid_until = _valid_paid_end(subscription)
            store.complete_billing_event(identity, event['id'], owner, {
                'subscription_id': subscription_id, 'status': 'canceled', 'paid_until': new_paid_until,
                'next_payment_at': None, 'revocation': False,
            })
            return
        reconcile_subscription(identity, subscription_id, event['id'], owner)


@billing_bp.route('/webhook', methods=['POST'])
@limiter.exempt
def webhook():
    try:
        event = provider.verify_event(request.get_data(cache=False), request.headers.get('Stripe-Signature', ''))
    except (ValueError, stripe.SignatureVerificationError):
        return jsonify(error='invalid_webhook_signature'), 400
    try:
        process_event(event)
    except ValueError as exc:
        reason = str(exc)
        retryable = {'billing_busy', 'billing_conflict', 'version_mismatch'}
        if reason not in retryable:
            raise
        # Known, allow-listed reason only -- never the raw exception/event payload -- plus
        # the event id, so a 503 burst can be correlated with Stripe's dashboard/logs
        # without risking arbitrary or secret data reaching application logs.
        event_id = event.get('id')
        if not isinstance(event_id, str) or not event_id.startswith('evt_'):
            event_id = 'unknown'
        current_app.logger.warning(
            'Billing webhook retry required: reason=%s event_id=%s', reason, event_id,
        )
        return jsonify(error='billing_retry_required'), 503
    return jsonify(received=True)


def prepare_account_deletion(username):
    user = models.get_user(username)
    if not user or not user.get('stable_id'):
        return
    identity = user['stable_id']
    recover_pending_redemption(identity)
    with billing_lock(identity):
        state = store.get_billing_state(identity) or {}
        _pending_guard(state)
        if state.get('checkout_session_id'):
            checkout_state = provider.get_checkout(state['checkout_session_id'])
            if checkout_state['status'] == 'open':
                provider.expire_checkout(checkout_state['id'], f'delete-checkout-{identity}')
        if state.get('customer_id'):
            for sub in provider.list_customer_subscriptions(state['customer_id']):
                if sub['status'] in _LIVE_STATES:
                    provider.cancel_subscription(sub['id'], immediate=True, operation_id=f'delete-{identity}-{sub["id"]}')
        store.put_billing_state(identity, deleted=True, paid_until=None, gift_until=None, next_payment_at=None)
        store.tombstone_billing_identity(identity)
