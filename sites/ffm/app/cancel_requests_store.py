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


class PurgeConflict(Exception):
    """Raised by delete_cancel_request when its conditional delete loses a
    race: the record was modified (reprocessed, re-finalized, or placed
    under legal hold) since the caller observed it as purgeable. Callers
    (retention_admin.py's CLI and scheduled worker) must catch this
    explicitly and count/report it as a skip — it must never be treated
    as a successful delete, and never silently ignored."""


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
        'legal_hold': False,
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


def set_legal_hold(request_id, hold):
    """Explicit operator action: suspend (hold=True) or lift (hold=False)
    retention cleanup for one request, independent of its status. A
    request under legal hold is never returned by
    list_purgeable_cancel_requests below, however long past its normal
    retention cutoff it is — the hold must be explicitly lifted by an
    operator before it becomes eligible again.

    The existence check is enforced by the update's own
    ConditionExpression (not a separate get_item beforehand), because
    DynamoDB's UpdateItem otherwise silently *creates* a new item when the
    key doesn't exist yet — a plain check-then-act pre-check can't close
    that race. Raises ValueError('not_found') if the request doesn't
    exist; never creates a bare pk/sk/legal_hold row."""
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


def list_purgeable_cancel_requests(now=None):
    """Return terminal (fulfilled/no_subscription — i.e. "completed") case
    records eligible for physical deletion under the approved retention
    policy: 3 years after the *end of the calendar year* in which the case
    was closed (processed_at), i.e. eligible starting Jan 1 of
    `processed_at.year + 4`. Still-open ("submitted"/"needs_review"/
    "processing") requests are never returned here — unresolved cases are
    retained indefinitely until an operator actually resolves them, never
    auto-expired. Requests with `legal_hold` set are also never returned,
    regardless of age, until the hold is explicitly lifted via
    set_legal_hold().
    """
    now = now or datetime.now(timezone.utc)
    eligible = []
    for item in list_cancel_requests():
        if item['status'] not in TERMINAL_STATUSES:
            continue
        if item.get('legal_hold'):
            continue
        processed_at = item.get('processed_at')
        if not processed_at:
            continue
        processed_dt = datetime.fromisoformat(processed_at)
        if processed_dt.tzinfo is None:
            processed_dt = processed_dt.replace(tzinfo=timezone.utc)
        cutoff = datetime(processed_dt.year + 4, 1, 1, tzinfo=timezone.utc)
        if now >= cutoff:
            eligible.append(item)
    return eligible


def delete_cancel_request(request_id, expected_status, expected_processed_at):
    """Physically remove one cancellation-request record. Only ever called
    by the retention-admin CLI/scheduled worker on an id returned by
    list_purgeable_cancel_requests — never on a still-open request.

    `expected_status`/`expected_processed_at` must be the exact values
    observed on that listing call, and the delete is conditional on the
    record still matching that snapshot *and* not (now) under legal hold —
    closing the race where an operator places a legal hold, or the case
    gets reprocessed/re-finalized, between listing and deleting. Raises
    PurgeConflict (never swallowed) if that snapshot no longer matches;
    the caller must count this as a skip, not a success."""
    if expected_status not in TERMINAL_STATUSES or not expected_processed_at:
        raise ValueError('request_not_completed')
    processed_dt = datetime.fromisoformat(expected_processed_at)
    if datetime.now(timezone.utc) < datetime(processed_dt.year + 4, 1, 1, tzinfo=timezone.utc):
        raise ValueError('retention_period_not_elapsed')
    try:
        _users().delete_item(
            Key={'pk': _pk(request_id), 'sk': 'REQUEST'},
            ConditionExpression=(
                Attr('status').eq(expected_status)
                & Attr('processed_at').eq(expected_processed_at)
                & (Attr('legal_hold').eq(False) | Attr('legal_hold').not_exists())
            ),
        )
    except ClientError as exc:
        if exc.response['Error']['Code'] == 'ConditionalCheckFailedException':
            raise PurgeConflict(request_id) from exc
        raise
