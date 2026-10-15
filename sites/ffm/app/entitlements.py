"""Fresh server-side entitlement decisions; never embedded in JWT claims."""

from datetime import datetime, timezone

from flask import current_app

from . import billing_store, models
from .models import _parse_timestamp


def _now_utc():
    return datetime.now(timezone.utc).isoformat()


def get_access_status(username=None, app_config=None):
    config = app_config if app_config is not None else current_app.config
    enabled = config.get('ACCESS_CONTROL_ENABLED', False)
    status = {
        'access_control_enabled': enabled, 'premium_access': False,
        'reason': 'free' if enabled else 'prelaunch',
        'access_until': None, 'paid_until': None, 'gift_until': None,
        'subscription_id': None, 'subscription_status': None,
        'cancel_at_period_end': False, 'next_payment_at': None, 'can_checkout': False,
    }
    if not username:
        return status
    user = models.get_user(username)
    if not user:
        return status
    if not user['email_verified']:
        status['reason'] = 'unverified'
        return status
    cutoff = config.get('GRANDFATHER_CUTOFF')
    if enabled and (user.get('grandfathered') or (
        cutoff and _parse_timestamp(user['created_at']) < _parse_timestamp(cutoff)
    )):
        if not user.get('grandfathered'):
            models.grandfather_user(username, user['created_at'])
        status.update(premium_access=True, reason='grandfathered')
        return status
    state = billing_store.get_billing_state(user['stable_id']) if user.get('stable_id') else None
    state = state or {}
    if state.get('deleted'):
        return status
    status.update(
        paid_until=state.get('paid_until'), gift_until=state.get('gift_until'),
        subscription_id=state.get('subscription_id'), subscription_status=state.get('status'),
        cancel_at_period_end=state.get('cancel_at_period_end', False),
        next_payment_at=None if state.get('cancel_at_period_end') or state.get('status') == 'canceled'
            else state.get('next_payment_at'),
    )
    valid = []
    now = _parse_timestamp(_now_utc())
    for field, reason in (('paid_until', 'paid'), ('gift_until', 'gift')):
        value = state.get(field)
        if value and not (field == 'paid_until' and state.get('revocation')):
            end = _parse_timestamp(value)
            if end > now:
                valid.append((end, reason))
    if valid:
        end, reason = max(valid)
        status.update(premium_access=True, access_until=end.isoformat(), reason=reason)
    status['can_checkout'] = bool(
        enabled and config.get('BILLING_ENABLED') and config.get('BILLING_SALES_ENABLED')
        and config.get('BILLING_TERMS_APPROVED') and config.get('STRIPE_PRICE_ID')
        and (not state.get('subscription_id') or state.get('status') in ('canceled', 'incomplete_expired'))
        and not state.get('pending_redemption')
    )
    return status


def require_level_access(username, level, app_config=None):
    status = get_access_status(username, app_config)
    if level <= 2 or not status['access_control_enabled'] or status['premium_access']:
        return True, None, status
    if not username:
        return False, 401, status
    if status['reason'] == 'unverified':
        return False, 403, status
    return False, 402, status
