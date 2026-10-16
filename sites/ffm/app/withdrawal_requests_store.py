"""Durable storage for public, unauthenticated withdrawal ("Vertrag
widerrufen") declarations.

Deliberately isolated from billing_store.py's authenticated billing state
and from cancel_requests_store.py's cancellation-request records: a
withdrawal is a distinct statutory declaration (exercising a right of
withdrawal), not a cancellation of future renewals, and the two must never
be conflated in a single record or status enum. Like cancel_requests_store,
this never calls Stripe and never looks up or confirms whether an
account/email exists at submission time (no account enumeration); a
submission is only durably recorded as a *declaration* for a human operator
to manually review, bind to a verified account identity, and action (see
app/billing_admin.py's `withdrawal-request` command group).

Single-table design: reuses the same DynamoDB table as app/models.py /
app/billing_store.py (via `_users()`), under its own
`WITHDRAWAL#<uuid>` partition-key prefix.

Retention: deliberately NOT wired into app/retention_admin.py. Unlike
cancel_requests (whose 3-years-after-closure purge policy is explicitly
approved, see README.md "Data retention"), no retention period has been
separately approved for withdrawal declarations -- these are evidence of a
statutory consumer-protection declaration, not merely an operational
support ticket, and silently reusing cancel_requests' 3-year figure here
would be an unapproved assumption. Records are therefore held indefinitely
(holdback) until an operator/legal reviewer explicitly approves a retention
period and the corresponding purge logic is added.
"""

from datetime import datetime, timezone

from boto3.dynamodb.conditions import Attr
from botocore.exceptions import ClientError

from .models import _users

#: "submitted" is the entry state for every public submission (no
#: automated branching the way cancel_requests has for requested_date --
#: a withdrawal is either received or it isn't). "processing" is set once
#: an operator has bound a reviewed identity; "fulfilled"/"no_match" are
#: terminal. These are technical processing states only -- never a legal
#: verdict on whether the withdrawal was valid, timely, or still
#: available for a given order (see app/legal_texts.py).
STATUSES = {'submitted', 'processing', 'fulfilled', 'no_match'}
TERMINAL_STATUSES = {'fulfilled', 'no_match'}


def _now_utc():
    return datetime.now(timezone.utc).isoformat()


def _pk(request_id):
    return f'WITHDRAWAL#{request_id}'


def get_withdrawal_request(request_id):
    return _users().get_item(Key={'pk': _pk(request_id), 'sk': 'REQUEST'}, ConsistentRead=True).get('Item')


def create_withdrawal_request(request_id, payload_hash, fields, receipt_token_hash):
    """Conditionally create a new durable withdrawal declaration keyed by
    the client's idempotency key (`request_id`, a client-generated UUID).

    Returns (item, created) exactly like
    cancel_requests_store.create_cancel_request: `created` is False when an
    identical payload was already durably stored under this exact id (an
    honest retry replays the same receipt instead of creating a
    duplicate). Raises ValueError('idempotency_conflict') if the same id
    was already used for *different* details.
    """
    item = dict(fields)
    item.update({
        'pk': _pk(request_id), 'sk': 'REQUEST',
        'request_id': request_id, 'payload_hash': payload_hash,
        'status': 'submitted', 'submitted_at': _now_utc(),
        'receipt_token_hash': receipt_token_hash,
        'reviewed_username': None, 'reviewed_stable_id': None, 'reviewed_at': None,
        'reviewed_subscription_id': None, 'reviewed_subscription_id_bound': False,
        'outcome': None, 'outcome_detail': None, 'processed_at': None,
        'receipt_email_status': None, 'receipt_email_attempted_at': None, 'receipt_email_error': None,
        'outcome_email_status': None, 'outcome_email_attempted_at': None, 'outcome_email_error': None,
        'legal_hold': False,
    })
    try:
        _users().put_item(Item=item, ConditionExpression=Attr('pk').not_exists())
        return item, True
    except ClientError as exc:
        if exc.response['Error']['Code'] != 'ConditionalCheckFailedException':
            raise
        existing = get_withdrawal_request(request_id)
        if not existing or existing.get('payload_hash') != payload_hash:
            raise ValueError('idempotency_conflict') from exc
        return existing, False


def set_receipt_email_state(request_id, status, error=None):
    """Durable, retryable delivery state for the immediate submission
    receipt email (distinct from the operator-triggered outcome email
    below). `status` is 'sent' or 'failed'."""
    _users().update_item(
        Key={'pk': _pk(request_id), 'sk': 'REQUEST'},
        UpdateExpression='SET receipt_email_status = :s, receipt_email_attempted_at = :now, receipt_email_error = :err',
        ExpressionAttributeValues={':s': status, ':now': _now_utc(), ':err': error},
    )


def set_outcome_email_state(request_id, status, error=None):
    """Durable, retryable delivery state for the final operator-triggered
    outcome email (app/billing_admin.py `withdrawal-request
    complete-email`)."""
    _users().update_item(
        Key={'pk': _pk(request_id), 'sk': 'REQUEST'},
        UpdateExpression='SET outcome_email_status = :s, outcome_email_attempted_at = :now, outcome_email_error = :err',
        ExpressionAttributeValues={':s': status, ':now': _now_utc(), ':err': error},
    )


def start_processing(request_id, username, stable_id, subscription_id):
    """Bind a human-reviewed identity -- and the subscription_id snapshot
    the operator's tooling saw *at review time* (which may legitimately be
    `None`) -- to the request, moving it from "submitted" to "processing".
    Mirrors cancel_requests_store.start_processing's idempotent-retry and
    rebind-rejection semantics exactly."""
    try:
        _users().update_item(
            Key={'pk': _pk(request_id), 'sk': 'REQUEST'},
            UpdateExpression=(
                'SET #s = :processing, reviewed_username = :u, reviewed_stable_id = :sid, '
                'reviewed_at = :now, reviewed_subscription_id = :subid, '
                'reviewed_subscription_id_bound = :bound'
            ),
            ConditionExpression='#s = :submitted',
            ExpressionAttributeNames={'#s': 'status'},
            ExpressionAttributeValues={
                ':processing': 'processing', ':submitted': 'submitted',
                ':u': username, ':sid': stable_id, ':now': _now_utc(),
                ':subid': subscription_id, ':bound': True,
            },
        )
        return
    except ClientError as exc:
        if exc.response['Error']['Code'] != 'ConditionalCheckFailedException':
            raise
    current = get_withdrawal_request(request_id)
    if not current:
        raise ValueError('not_found')
    if (current['status'] != 'processing' or current.get('reviewed_stable_id') != stable_id
            or current.get('reviewed_username') != username):
        raise ValueError('cannot_process')


def finalize(request_id, outcome, detail):
    """Record the final outcome of a processed request -- only ever called
    after the actual action (if any) already happened/was observed; never
    before."""
    if outcome not in TERMINAL_STATUSES:
        raise ValueError('invalid_outcome')
    _users().update_item(
        Key={'pk': _pk(request_id), 'sk': 'REQUEST'},
        UpdateExpression='SET #s = :outcome, outcome = :outcome, outcome_detail = :detail, processed_at = :now',
        ConditionExpression='#s = :processing',
        ExpressionAttributeNames={'#s': 'status'},
        ExpressionAttributeValues={
            ':outcome': outcome, ':processing': 'processing', ':detail': detail, ':now': _now_utc(),
        },
    )


def record_manual_outcome(request_id, username, stable_id, outcome, detail):
    """Explicit, entirely-manual operator path: binds the reviewed
    identity (idempotent/retry-safe exactly like start_processing) and
    finalizes with an outcome the operator attests they already actually
    performed/observed themselves (e.g. directly in the Stripe
    dashboard). Never calls Stripe and never schedules anything."""
    start_processing(request_id, username, stable_id, subscription_id=None)
    finalize(request_id, outcome, detail)


def list_withdrawal_requests(status=None):
    """Full scan is acceptable here: low-volume, human-processed operator
    records, not a hot request path (mirrors cancel_requests_store)."""
    filter_expression = Attr('sk').eq('REQUEST')
    if status:
        filter_expression = filter_expression & Attr('status').eq(status)
    response = _users().scan(FilterExpression=filter_expression)
    items = list(response.get('Items', []))
    while response.get('LastEvaluatedKey'):
        response = _users().scan(FilterExpression=filter_expression,
                                 ExclusiveStartKey=response['LastEvaluatedKey'])
        items.extend(response.get('Items', []))
    items.sort(key=lambda item: item['submitted_at'])
    return items


def set_legal_hold(request_id, hold):
    """Explicit operator action; identical semantics to
    cancel_requests_store.set_legal_hold. Currently has no corresponding
    purge path (see module docstring), so this mainly future-proofs the
    record shape for whenever a retention policy is approved."""
    try:
        _users().update_item(
            Key={'pk': _pk(request_id), 'sk': 'REQUEST'},
            UpdateExpression='SET legal_hold = :h',
            ConditionExpression=Attr('pk').exists(),
            ExpressionAttributeValues={':h': bool(hold)},
        )
    except ClientError as exc:
        if exc.response['Error']['Code'] == 'ConditionalCheckFailedException':
            raise ValueError('not_found') from exc
        raise
