"""Durable storage for public, unauthenticated subscription-cancellation
*requests*.

Deliberately isolated from billing_store.py's authenticated billing state:
a public submission recorded here never touches Stripe, never looks up or
confirms whether an account/email exists (no account enumeration), and
never advances past "submitted"/"needs_review" until a human operator has
manually reviewed the submitter's identity and bound it to an immutable
account `stable_id` (see app/billing_admin.py's `cancel-request` command
group — the only code path that is allowed to call
billing.cancel_future_renewals() on behalf of one of these requests).

Single-table design: reuses the same DynamoDB table as app/models.py and
app/billing_store.py (via `_users()`), under its own `CANCELREQUEST#<uuid>`
partition-key prefix so it cannot collide with `USER#`/`BILLING#`/`CODE#`
items already stored there.
"""

from datetime import datetime, timezone

from boto3.dynamodb.conditions import Attr
from botocore.exceptions import ClientError

from .models import _users

#: Statuses a request can be in. "submitted" is the normal entry state for
#: earliest-possible cancellations; "needs_review" is used instead for any
#: requested_date submission, since this module never automates a
#: date-specific cancellation (see app/billing_admin.py `process` command).
STATUSES = {'submitted', 'needs_review', 'processing', 'fulfilled', 'no_subscription'}
TERMINAL_STATUSES = {'fulfilled', 'no_subscription'}


def _now_utc():
    return datetime.now(timezone.utc).isoformat()


def _pk(request_id):
    return f'CANCELREQUEST#{request_id}'


def get_cancel_request(request_id):
    return _users().get_item(Key={'pk': _pk(request_id), 'sk': 'REQUEST'}, ConsistentRead=True).get('Item')


def create_cancel_request(request_id, payload_hash, fields, initial_status):
    """Conditionally create a new durable request keyed by the client's
    idempotency key (`request_id`, expected to be a client-generated UUID).

    Returns (item, created) where `created` is False when an identical
    payload was already durably stored under this exact id (an honest
    retry after e.g. a dropped connection replays the very same receipt,
    never creating a duplicate). Raises ValueError('idempotency_conflict')
    if the same id was already used for *different* request details —
    callers must reject this loudly rather than silently overwrite or
    silently resubmit.
    """
    if initial_status not in STATUSES:
        raise ValueError('invalid_status')
    item = dict(fields)
    item.update({
        'pk': _pk(request_id), 'sk': 'REQUEST',
        'request_id': request_id, 'payload_hash': payload_hash,
        'status': initial_status, 'submitted_at': _now_utc(),
        'reviewed_username': None, 'reviewed_stable_id': None, 'reviewed_at': None,
        'reviewed_subscription_id': None, 'reviewed_subscription_id_bound': False,
        'outcome': None, 'outcome_detail': None, 'processed_at': None,
        'ack_email_status': None, 'ack_email_attempted_at': None, 'ack_email_error': None,
    })
    try:
        _users().put_item(Item=item, ConditionExpression=Attr('pk').not_exists())
        return item, True
    except ClientError as exc:
        if exc.response['Error']['Code'] != 'ConditionalCheckFailedException':
            raise
        existing = get_cancel_request(request_id)
        if not existing or existing.get('payload_hash') != payload_hash:
            raise ValueError('idempotency_conflict') from exc
        return existing, False


def start_processing(request_id, username, stable_id, subscription_id, from_status='submitted'):
    """Bind a human-reviewed identity — and the subscription_id snapshot
    the operator's tooling saw *at review time* (which may legitimately be
    `None`) — to the request, moving it from `from_status` ("submitted"
    for the automated earliest-possible path, or "needs_review" for a
    requested_date request being bound ahead of a manual outcome record)
    to "processing".

    Idempotent for retries: re-invoking with the *same* username/
    stable_id after e.g. a provider failure is allowed (the request stays
    "processing" for however many retries it takes), but re-invoking with
    a *different* identity is rejected — an already-reviewed request
    cannot be silently rebound to someone else. Crucially, the originally
    bound `reviewed_subscription_id` snapshot is itself never overwritten
    by a retry's (possibly different, e.g. a replacement subscription's)
    current subscription_id — callers that need the bound snapshot for a
    safety check must re-read it via get_cancel_request() rather than
    assume the value they just passed in was actually (re-)stored.
    """
    if from_status not in ('submitted', 'needs_review'):
        raise ValueError('invalid_status')
    try:
        _users().update_item(
            Key={'pk': _pk(request_id), 'sk': 'REQUEST'},
            UpdateExpression=(
                'SET #s = :processing, reviewed_username = :u, reviewed_stable_id = :sid, '
                'reviewed_at = :now, reviewed_subscription_id = :subid, '
                'reviewed_subscription_id_bound = :bound'
            ),
            ConditionExpression='#s = :from_status',
            ExpressionAttributeNames={'#s': 'status'},
            ExpressionAttributeValues={
                ':processing': 'processing', ':from_status': from_status,
                ':u': username, ':sid': stable_id, ':now': _now_utc(),
                ':subid': subscription_id, ':bound': True,
            },
        )
        return
    except ClientError as exc:
        if exc.response['Error']['Code'] != 'ConditionalCheckFailedException':
            raise
    current = get_cancel_request(request_id)
    if not current:
        raise ValueError('not_found')
    if (current['status'] != 'processing' or current.get('reviewed_stable_id') != stable_id
            or current.get('reviewed_username') != username):
        raise ValueError('cannot_process')


def finalize(request_id, outcome, detail):
    """Record the final outcome of a processed request. Only ever called
    after billing.cancel_future_renewals() has itself durably recorded its
    result in billing_store (automated earliest-possible path), or after
    an operator has durably recorded a manually-performed outcome via
    `record_manual_outcome` below (requested_date path) — this call never
    happens before the underlying action, and never claims an outcome
    that did not actually occur.
    """
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
    """Explicit operator path for requested_date ("needs_review")
    requests, which the automated process()/cancel_future_renewals() path
    always refuses to touch (see app/billing_admin.py). This records an
    outcome the operator *actually performed themselves* (e.g. via the
    Stripe dashboard/portal on the user's stated date) — it never calls
    Stripe and never schedules anything; it is purely a durable,
    reviewed-identity-bound record of what a human has already done.

    Binds the reviewed identity first (idempotent/retry-safe exactly like
    start_processing — a different identity on retry is rejected), then
    finalizes with the given outcome/detail in one call so a
    "needs_review" request can reach a terminal status without ever
    passing through the automated process() path.
    """
    start_processing(request_id, username, stable_id, subscription_id=None, from_status='needs_review')
    finalize(request_id, outcome, detail)



def set_ack_email_state(request_id, status, error=None):
    """Independently durable, manually-triggered acknowledgement-email
    delivery state (never set automatically on submission). `status` is
    'sent' or 'failed'; retried by simply re-running the operator CLI's
    `complete-email` command."""
    _users().update_item(
        Key={'pk': _pk(request_id), 'sk': 'REQUEST'},
        UpdateExpression='SET ack_email_status = :s, ack_email_attempted_at = :now, ack_email_error = :err',
        ExpressionAttributeValues={':s': status, ':now': _now_utc(), ':err': error},
    )


def list_cancel_requests(status=None):
    """Full scan is acceptable here: these are low-volume, human-processed
    operator records, not a hot request path."""
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
