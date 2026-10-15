"""Public, unauthenticated subscription-cancellation request intake.

No login and no email verification are required to submit here, and this
module never calls Stripe and never looks up or confirms whether an
account/email exists (no account enumeration). A submission is only
durably recorded as a *request* for a human operator to manually review,
bind to a verified account identity, and action via the operator CLI (see
app/billing_admin.py's `cancel-request` command group, which reuses
billing.cancel_future_renewals() — the same primitive the authenticated
in-app cancel button uses).

This exists so someone who has lost access to their account (forgotten
password, an email inbox they no longer control, etc.) can still register
a timely cancellation request without needing to authenticate. The
receipt returned here explicitly says the request was *received*, not
that the subscription was canceled — see README.md for the outstanding
legal caveats this flow does not resolve (notably: whether an emailed/
CLI-processed request alone satisfies BGB Sec. 312k's required
"Kündigungsbutton" confirmation-page mechanics is NOT established by this
code and remains a qualified-legal-review item).
"""

import hashlib
import json
import re
from datetime import datetime, timezone

from flask import Blueprint, current_app, jsonify, request

from . import cancel_requests_store as store
from .extensions import limiter

cancel_requests_bp = Blueprint('cancel_requests', __name__, url_prefix='/api/cancel-requests')

MAX_EMAIL_LEN = 254
MIN_USERNAME_LEN = 3
MAX_USERNAME_LEN = 20
MAX_REFERENCE_LEN = 128
MAX_REASON_LEN = 2000
MAX_FUTURE_DAYS = 3 * 365

_UUID_RE = re.compile(r'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$')
_ISO_DATE_RE = re.compile(r'^\d{4}-\d{2}-\d{2}$')


def _valid_email(value):
    """Basic structural check only (this flow never verifies deliverability
    or account existence): a non-empty string, no whitespace or control
    characters anywhere, and exactly one '@' with a non-empty local part
    and a non-empty domain part either side of it."""
    if not isinstance(value, str) or not 3 <= len(value) <= MAX_EMAIL_LEN:
        return False
    if any(ch.isspace() or ord(ch) < 0x20 or ord(ch) == 0x7f for ch in value):
        return False
    if value.count('@') != 1:
        return False
    local, domain = value.split('@')
    return bool(local) and bool(domain)


def _valid_username(value):
    return (isinstance(value, str) and MIN_USERNAME_LEN <= len(value) <= MAX_USERNAME_LEN
            and value.isalnum())


def _strict_iso_date(value):
    """Parse strictly as YYYY-MM-DD — rejects any other format (including
    German DD.MM.YYYY) even though this public page's labels are German,
    and rejects invalid calendar dates (e.g. 2026-02-30) via strptime."""
    if not isinstance(value, str) or not _ISO_DATE_RE.match(value):
        return None
    try:
        return datetime.strptime(value, '%Y-%m-%d').date()
    except ValueError:
        return None


def _canonical_hash(fields):
    canonical = json.dumps(fields, sort_keys=True, separators=(',', ':'))
    return hashlib.sha256(canonical.encode('utf-8')).hexdigest()


def _receipt(item):
    return {
        'request_id': item['request_id'],
        'submitted_at': item['submitted_at'],
        'status': item['status'],
        'cancellation_type': item['cancellation_type'],
        'requested_date': item.get('requested_date'),
        'contact_email': item['contact_email'],
        'account_email': item.get('account_email'),
        'username': item.get('username'),
        'stripe_reference': item.get('stripe_reference'),
        'reason': item.get('reason'),
        'message': (
            'Ihre Kuendigungsanfrage wurde entgegengenommen (Status: "Anfrage erhalten", '
            'NICHT "Kuendigung bestaetigt"). Ein Mitarbeiter prueft Ihre Anfrage manuell '
            'und meldet sich bei Bedarf unter der angegebenen Kontakt-E-Mail-Adresse. '
            'Es wurde noch keine automatische Zahlungs- oder Vertragsaenderung ausgeloest.'
        ),
    }


@cancel_requests_bp.after_request
def no_cache(response):
    response.headers['Cache-Control'] = 'private, no-store'
    return response


@cancel_requests_bp.route('', methods=['POST'])
@limiter.limit(lambda: current_app.config['CANCEL_REQUEST_RATE_LIMIT'])
def submit():
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return jsonify(error='invalid_request'), 400

    idempotency_key = data.get('idempotency_key')
    if not isinstance(idempotency_key, str) or not _UUID_RE.match(idempotency_key):
        return jsonify(error='invalid_idempotency_key'), 400

    # Every field below is validated as an actual JSON string, never
    # coerced with str(): silently str()-ing a dict/list value (e.g.
    # {"$ne": null}) into "identifying info" would durably store a
    # misleading stringified-object value instead of honestly rejecting
    # the malformed request.
    contact_email = data.get('contact_email')
    if not isinstance(contact_email, str):
        return jsonify(error='valid_contact_email_required'), 400
    contact_email = contact_email.strip().lower()
    if not _valid_email(contact_email):
        return jsonify(error='valid_contact_email_required'), 400

    account_email = data.get('account_email')
    if account_email is not None:
        if not isinstance(account_email, str):
            return jsonify(error='invalid_account_email'), 400
        account_email = account_email.strip().lower()
        if account_email and not _valid_email(account_email):
            return jsonify(error='invalid_account_email'), 400
        account_email = account_email or None

    username = data.get('username')
    if username is not None:
        if not isinstance(username, str):
            return jsonify(error='invalid_username'), 400
        username = username.strip()
        if username and not _valid_username(username):
            return jsonify(error='invalid_username'), 400
        username = username or None

    stripe_reference = data.get('stripe_reference')
    if stripe_reference is not None:
        if not isinstance(stripe_reference, str):
            return jsonify(error='stripe_reference_too_long'), 400
        stripe_reference = stripe_reference.strip()
        if len(stripe_reference) > MAX_REFERENCE_LEN:
            return jsonify(error='stripe_reference_too_long'), 400
        stripe_reference = stripe_reference or None

    if not any((account_email, username, stripe_reference)):
        return jsonify(error='identifying_info_required'), 400

    cancellation_type = data.get('cancellation_type')
    if cancellation_type not in ('earliest', 'requested_date'):
        return jsonify(error='invalid_cancellation_type'), 400

    requested_date_raw = data.get('requested_date')
    if cancellation_type == 'requested_date':
        parsed = _strict_iso_date(requested_date_raw)
        if not parsed:
            return jsonify(error='invalid_requested_date'), 400
        today = datetime.now(timezone.utc).date()
        if parsed <= today:
            return jsonify(error='requested_date_must_be_future'), 400
        if (parsed - today).days > MAX_FUTURE_DAYS:
            return jsonify(error='requested_date_too_far'), 400
        requested_date = parsed.isoformat()
        # Never automate a date-specific cancellation against the stated
        # date: it always requires manual operator handling.
        initial_status = 'needs_review'
    else:
        if requested_date_raw not in (None, ''):
            return jsonify(error='requested_date_not_allowed'), 400
        requested_date = None
        initial_status = 'submitted'

    reason = data.get('reason')
    if reason is not None:
        if not isinstance(reason, str):
            return jsonify(error='reason_too_long'), 400
        reason = reason.strip()
        if len(reason) > MAX_REASON_LEN:
            return jsonify(error='reason_too_long'), 400
        reason = reason or None

    fields = {
        'contact_email': contact_email, 'account_email': account_email, 'username': username,
        'stripe_reference': stripe_reference, 'cancellation_type': cancellation_type,
        'requested_date': requested_date, 'reason': reason,
    }
    payload_hash = _canonical_hash(fields)

    try:
        item, created = store.create_cancel_request(idempotency_key, payload_hash, fields, initial_status)
    except ValueError as exc:
        if str(exc) == 'idempotency_conflict':
            return jsonify(
                error='idempotency_conflict',
                message='Diese Antrags-ID wurde bereits mit anderen Angaben verwendet. '
                        'Bitte mit einer neuen ID erneut senden.',
            ), 409
        raise

    return jsonify(_receipt(item)), 201 if created else 200
