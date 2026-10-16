"""Durable storage for versioned checkout declarations and the resulting
contract confirmation snapshot/email delivery state.

Reuses the same single DynamoDB table as app/models.py / app/billing_store.py
(via `_users()`), under its own `BILLING#<identity>` partition with two new
sort-key prefixes so it cannot collide with existing `STATE`/`LOCK`/`MAPPING`
items:

- `DECLARATION#<checkout_operation>` -- one immutable record per checkout
  operation (see app/billing.py `checkout()`), binding the exact declaration
  text/version/language the purchaser accepted to that specific checkout
  attempt and to the account's immutable `stable_id`, with a UTC timestamp.
  Never overwritten once written (ConditionExpression attribute_not_exists).

- `CONFIRMATION#<subscription_id>` -- one immutable record per *subscription*
  (= one specific contract), created exactly once the first time a brand-new
  subscription's payment is server-verified (see app/billing.py
  `reconcile_subscription()`). Renewal invoices on the same subscription
  never create a second one and never require fresh declarations. A
  replacement subscription from a later, separate checkout gets its own new
  confirmation record, tied to its own new declarations.
"""

from datetime import datetime, timezone

from boto3.dynamodb.conditions import Attr
from botocore.exceptions import ClientError

from .models import _users


def _now_utc():
    return datetime.now(timezone.utc).isoformat()


def put_checkout_declarations(identity, checkout_operation, language, texts, adult_confirmed, terms_accepted):
    """Durably bind one checkout operation's accepted declarations. Called
    once, immediately after a checkout session is created for that
    operation (see app/billing.py `checkout()`). Idempotent: a retried
    checkout call that reuses the same still-open operation simply leaves
    the original, already-accepted-at-that-moment record in place rather
    than silently overwriting it with "now"."""
    item = {
        'pk': f'BILLING#{identity}', 'sk': f'DECLARATION#{checkout_operation}',
        'identity': identity, 'checkout_operation': checkout_operation,
        'language': language, 'accepted_at': _now_utc(),
        'adult_confirmed': bool(adult_confirmed), 'terms_accepted': bool(terms_accepted),
        **texts,
    }
    try:
        _users().put_item(Item=item, ConditionExpression=Attr('pk').not_exists() | Attr('sk').not_exists())
    except ClientError as exc:
        if exc.response['Error']['Code'] != 'ConditionalCheckFailedException':
            raise
    return get_checkout_declarations(identity, checkout_operation)


def get_checkout_declarations(identity, checkout_operation):
    if not checkout_operation:
        return None
    return _users().get_item(
        Key={'pk': f'BILLING#{identity}', 'sk': f'DECLARATION#{checkout_operation}'}, ConsistentRead=True,
    ).get('Item')


def get_contract_confirmation(identity, subscription_id):
    return _users().get_item(
        Key={'pk': f'BILLING#{identity}', 'sk': f'CONFIRMATION#{subscription_id}'}, ConsistentRead=True,
    ).get('Item')


def create_contract_confirmation(identity, subscription_id, snapshot):
    """Conditionally create the one-and-only confirmation record for this
    subscription_id. Returns (item, created): `created` is False when a
    confirmation already existed (a replayed webhook, a concurrent CLI
    `reconcile`, or a retried request after a prior crash) -- callers must
    never resend the contract-confirmation email or re-derive a new
    snapshot in that case, only resume toward the entitlement grant that
    was already associated with the existing record."""
    item = dict(snapshot)
    item.update({
        'pk': f'BILLING#{identity}', 'sk': f'CONFIRMATION#{subscription_id}',
        'identity': identity, 'subscription_id': subscription_id,
        'confirmed_at': _now_utc(), 'email_status': 'pending',
        'email_attempted_at': None, 'email_error': None,
    })
    try:
        _users().put_item(Item=item, ConditionExpression=Attr('pk').not_exists() | Attr('sk').not_exists())
        return item, True
    except ClientError as exc:
        if exc.response['Error']['Code'] != 'ConditionalCheckFailedException':
            raise
        return get_contract_confirmation(identity, subscription_id), False


def mark_confirmation_provisioned(identity, subscription_id):
    """Durably record the UTC instant the entitlement grant actually
    proceeded for this gated contract (distinct from `confirmed_at`, when
    the snapshot/declarations were durably recorded, and from
    `email_attempted_at`, when the SES send was last attempted) -- set
    once, idempotently: a replayed webhook or concurrent reconcile must
    never overwrite the original provisioning instant with a later one."""
    try:
        _users().update_item(
            Key={'pk': f'BILLING#{identity}', 'sk': f'CONFIRMATION#{subscription_id}'},
            UpdateExpression='SET provisioned_at = :now',
            ConditionExpression=Attr('pk').exists() & Attr('provisioned_at').not_exists(),
            ExpressionAttributeValues={':now': _now_utc()},
        )
    except ClientError as exc:
        if exc.response['Error']['Code'] != 'ConditionalCheckFailedException':
            raise


def set_confirmation_email_state(identity, subscription_id, status, error=None):
    """Independently durable, retryable SES delivery state for one
    confirmation record. `status` is 'sent' or 'failed'. SES accepting a
    send only means the message was accepted for delivery -- it is never
    treated as proof of inbox delivery; this merely records what the send
    *attempt* itself resulted in, for an operator to retry on 'failed'."""
    _users().update_item(
        Key={'pk': f'BILLING#{identity}', 'sk': f'CONFIRMATION#{subscription_id}'},
        UpdateExpression='SET email_status = :s, email_attempted_at = :now, email_error = :err',
        ConditionExpression=Attr('pk').exists(),
        ExpressionAttributeValues={':s': status, ':now': _now_utc(), ':err': error},
    )
