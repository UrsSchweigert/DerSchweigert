"""Public, unauthenticated withdrawal ("Vertrag widerrufen") declaration
intake -- BGB withdrawal rights, distinct from and never conflated with
app/cancel_requests.py's subscription-cancellation request intake.

No login and no email verification are required to submit here, and this
module never calls Stripe and never looks up or confirms whether an
account/email exists (no account enumeration). A submission is only
durably recorded as a *declaration* for a human operator to manually
review, bind to a verified account identity, and action via the operator
CLI (see app/billing_admin.py's `withdrawal-request` command group).
Identity is never matched/actioned automatically from the submitted
contact details alone.

Two durable, immediate confirmations are provided regardless of each
other's success, since SES accepting a send is not proof of inbox
delivery:
  1. An immediate email receipt is attempted at submission time (unlike
     cancel_requests, which only emails after an operator finalizes an
     outcome) -- its delivery status is independently tracked and
     retryable via the operator CLI, never silently dropped on failure.
  2. A one-time receipt token is returned in the JSON response, allowing
     the requester to download the durable receipt without logging in
     (via GET /<request_id>/receipt?token=...) even if the email never
     arrives. Only a SHA-256 hash of the token is ever stored.
"""

import hashlib
import hmac
import json
import re
import secrets
from datetime import datetime, timezone

from botocore.exceptions import BotoCoreError, ClientError
from flask import Blueprint, Response, current_app, jsonify, request

from . import legal_texts, mailer
from . import withdrawal_requests_store as store
from .extensions import limiter

withdrawal_requests_bp = Blueprint('withdrawal_requests', __name__, url_prefix='/api/withdrawal-requests')

MAX_EMAIL_LEN = 254
MIN_USERNAME_LEN = 3
MAX_USERNAME_LEN = 20
MAX_REFERENCE_LEN = 128
MAX_REASON_LEN = 2000

_UUID_RE = re.compile(r'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$')


def _valid_email(value):
    """Mirrors app/cancel_requests.py's _valid_email exactly -- structural
    check only, never verifies deliverability or account existence."""
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


def _canonical_hash(fields):
    canonical = json.dumps(fields, sort_keys=True, separators=(',', ':'))
    return hashlib.sha256(canonical.encode('utf-8')).hexdigest()


def _hash_token(token):
    return hashlib.sha256(token.encode('ascii')).hexdigest()


#: User-facing receipt copy (JSON 'message' field and the plaintext
#: receipt body embedded both in the email and the no-login download
#: endpoint), keyed by the requester's own persisted statement_language
#: selection -- never a UI/browser default guessed independently of it.
_RECEIPT_COPY = {
    'de': {
        'message': (
            'Ihre Widerrufserklaerung wurde entgegengenommen (Status: "Anfrage erhalten", '
            'NICHT "Widerruf bestaetigt/abgeschlossen"). Ein Mitarbeiter prueft Ihre Angaben '
            'manuell. Es wurde noch keine automatische Zahlungs-, Kuendigungs- oder '
            'Rueckerstattungsmassnahme ausgeloest.'
        ),
        'text_title': 'Widerrufserklaerung - Eingangsbestaetigung',
        'request_id_label': 'Antrags-ID',
        'submitted_label': 'Eingereicht am (UTC)',
        'status_line': 'Status: {status} (Anfrage erhalten, NICHT abgeschlossener Widerruf)',
        'contact_email_label': 'Kontakt-E-Mail',
        'account_email_label': 'Konto-E-Mail',
        'username_label': 'Benutzername',
        'reference_label': 'Referenz',
        'reason_label': 'Anmerkung',
        'statement_label': 'Erklaerung',
    },
    'en': {
        'message': (
            'Your withdrawal declaration has been received (status: "request received", '
            'NOT "withdrawal confirmed/completed"). A member of our team will manually review '
            'your details. No automatic payment, cancellation, or refund action has been '
            'triggered yet.'
        ),
        'text_title': 'Withdrawal declaration - receipt confirmation',
        'request_id_label': 'Request ID',
        'submitted_label': 'Submitted at (UTC)',
        'status_line': 'Status: {status} (request received, NOT a completed withdrawal)',
        'contact_email_label': 'Contact email',
        'account_email_label': 'Account email',
        'username_label': 'Username',
        'reference_label': 'Reference',
        'reason_label': 'Note',
        'statement_label': 'Declaration',
    },
}


def _receipt(item, receipt_token=None):
    copy = _RECEIPT_COPY.get(item['statement_language'], _RECEIPT_COPY['de'])
    receipt = {
        'request_id': item['request_id'],
        'submitted_at': item['submitted_at'],
        'status': item['status'],
        'contact_email': item['contact_email'],
        'account_email': item.get('account_email'),
        'username': item.get('username'),
        'stripe_reference': item.get('stripe_reference'),
        'reason': item.get('reason'),
        'statement_language': item['statement_language'],
        'statement': item['statement_text'],
        'message': copy['message'],
    }
    if receipt_token is not None:
        receipt['receipt_token'] = receipt_token
        receipt['receipt_download_url'] = (
            f"/api/withdrawal-requests/{item['request_id']}/receipt?token={receipt_token}"
        )
    return receipt


def receipt_text(item):
    """Build the canonical, durable receipt body text for a withdrawal
    request (statement/status/references/timestamp), in the requester's
    own persisted statement_language. Reused verbatim by the public
    submission path above and by the operator CLI's receipt-email resend
    (see app/billing_admin.py) so a resend never diverges from what the
    requester originally received/could download."""
    copy = _RECEIPT_COPY.get(item['statement_language'], _RECEIPT_COPY['de'])
    lines = [
        copy['text_title'],
        f"{copy['request_id_label']}: {item['request_id']}",
        f"{copy['submitted_label']}: {item['submitted_at']}",
        copy['status_line'].format(status=item['status']),
        f"{copy['contact_email_label']}: {item['contact_email']}",
    ]
    if item.get('account_email'):
        lines.append(f"{copy['account_email_label']}: {item['account_email']}")
    if item.get('username'):
        lines.append(f"{copy['username_label']}: {item['username']}")
    if item.get('stripe_reference'):
        lines.append(f"{copy['reference_label']}: {item['stripe_reference']}")
    if item.get('reason'):
        lines.append(f"{copy['reason_label']}: {item['reason']}")
    lines += ['', f"{copy['statement_label']}:", item['statement_text']]
    return '\n'.join(lines)


@withdrawal_requests_bp.after_request
def no_cache(response):
    response.headers['Cache-Control'] = 'private, no-store'
    return response


@withdrawal_requests_bp.route('', methods=['POST'])
@limiter.limit(lambda: current_app.config['WITHDRAWAL_REQUEST_RATE_LIMIT'])
def submit():
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return jsonify(error='invalid_request'), 400

    idempotency_key = data.get('idempotency_key')
    if not isinstance(idempotency_key, str) or not _UUID_RE.match(idempotency_key):
        return jsonify(error='invalid_idempotency_key'), 400

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

    # The actual withdrawal statement is never free text supplied by the
    # client -- only a language selector. The exact, canonical statement
    # durably recorded always comes from app/legal_texts.py.
    language = data.get('statement_language')
    if language not in legal_texts.SUPPORTED_LANGUAGES:
        return jsonify(error='invalid_statement_language'), 400
    if data.get('statement_confirmed') is not True:
        return jsonify(error='statement_confirmation_required'), 400

    reason = data.get('reason')
    if reason is not None:
        if not isinstance(reason, str):
            return jsonify(error='reason_too_long'), 400
        reason = reason.strip()
        if len(reason) > MAX_REASON_LEN:
            return jsonify(error='reason_too_long'), 400
        reason = reason or None

    statement_text = legal_texts.WITHDRAWAL_STATEMENT[language]
    fields = {
        'contact_email': contact_email, 'account_email': account_email, 'username': username,
        'stripe_reference': stripe_reference, 'reason': reason,
        'statement_language': language, 'statement_text': statement_text,
    }
    payload_hash = _canonical_hash(fields)

    # Minted fresh on every call, even for an idempotent replay of an
    # existing request -- a receipt_token is a bearer credential for the
    # no-login download endpoint, so a retried submission must not leak a
    # token tied to someone else's earlier request if payload hashes
    # happened to differ; on an honest identical-payload replay the
    # original request's own (unrecoverable) token was already shown
    # once, so the replay response below omits it rather than minting a
    # second valid token for the same record.
    receipt_token = secrets.token_urlsafe(32)
    try:
        item, created = store.create_withdrawal_request(
            idempotency_key, payload_hash, fields, _hash_token(receipt_token),
        )
    except ValueError as exc:
        if str(exc) == 'idempotency_conflict':
            return jsonify(
                error='idempotency_conflict',
                message='Diese Antrags-ID wurde bereits mit anderen Angaben verwendet. '
                        'Bitte mit einer neuen ID erneut senden.',
            ), 409
        raise

    if created:
        try:
            mailer.send_withdrawal_request_receipt_email(
                contact_email, item['request_id'], item['submitted_at'], statement_text,
                receipt_text(item), language=item['statement_language'],
            )
        except (ClientError, BotoCoreError) as exc:
            code = exc.response.get('Error', {}).get('Code') if isinstance(exc, ClientError) else None
            store.set_receipt_email_state(item['request_id'], 'failed', f'{type(exc).__name__}:{code or "unknown"}')
            current_app.logger.error(
                'Withdrawal receipt email send failed: request_id=%s error=%s',
                item['request_id'], type(exc).__name__,
            )
        else:
            store.set_receipt_email_state(item['request_id'], 'sent')

    return jsonify(_receipt(item, receipt_token if created else None)), 201 if created else 200


@withdrawal_requests_bp.route('/<request_id>/receipt', methods=['GET'])
@limiter.limit(lambda: current_app.config['WITHDRAWAL_REQUEST_RATE_LIMIT'])
def download_receipt(request_id):
    """No-login, token-gated durable receipt download. Returns an
    identical generic 404 whether the request_id doesn't exist or the
    token doesn't match, so this endpoint can never be used to enumerate
    which request ids exist."""
    token = request.args.get('token', '')
    item = store.get_withdrawal_request(request_id) if _UUID_RE.match(request_id or '') else None
    if not item or not token or not hmac.compare_digest(_hash_token(token), item.get('receipt_token_hash', '')):
        return jsonify(error='not_found'), 404
    return Response(
        receipt_text(item), mimetype='text/plain', headers={
            'Content-Disposition': f'attachment; filename="widerruf-{request_id}.txt"',
            'Cache-Control': 'private, no-store',
        },
    )
