"""Durable billing state and recoverable, single-use gift redemption."""

import hashlib
import secrets
from calendar import monthrange
from datetime import datetime, timedelta, timezone

from boto3.dynamodb.conditions import Attr
from botocore.exceptions import ClientError

from .models import _users, _parse_timestamp


def _now_utc():
    return datetime.now(timezone.utc).isoformat()


def _read(pk, sk):
    return _users().get_item(Key={'pk': pk, 'sk': sk}, ConsistentRead=True).get('Item')


def _transaction(items):
    # The DynamoDB resource client's document transformer accepts native values.
    try:
        _users().meta.client.transact_write_items(TransactItems=items)
    except ClientError as exc:
        if exc.response['Error']['Code'] == 'TransactionCanceledException':
            reasons = exc.response.get('CancellationReasons', [])
            if any(reason.get('Code') == 'ConditionalCheckFailed' for reason in reasons):
                raise ValueError('billing_conflict') from exc
        raise


def _code_hash(plaintext_code):
    if not isinstance(plaintext_code, str) or not 1 <= len(plaintext_code.strip()) <= 128:
        raise ValueError('invalid_code')
    try:
        normalized = plaintext_code.strip().upper().encode('ascii')
    except UnicodeEncodeError as exc:
        raise ValueError('invalid_code') from exc
    return hashlib.sha256(normalized).hexdigest()


def create_access_code(months=3, expires_at=None):
    if type(months) is not int or months != 3:
        raise ValueError('invalid_months')
    if expires_at is not None:
        expiry = _parse_timestamp(expires_at)
        if expiry <= _parse_timestamp(_now_utc()):
            raise ValueError('invalid_expiry')
        expires_at = expiry.astimezone(timezone.utc).isoformat()
    code = secrets.token_hex(16).upper()
    code_hash = _code_hash(code)
    _users().put_item(
        Item={'pk': f'CODE#{code_hash}', 'sk': 'CODE', 'issued_at': _now_utc(),
              'expires_at': expires_at, 'months_grant': 3, 'revoked': False,
              'redeemed_by': None},
        ConditionExpression=Attr('pk').not_exists(),
    )
    return code, code_hash


def get_code_state(code_hash):
    item = _read(f'CODE#{code_hash}', 'CODE')
    return dict(item, code_hash=code_hash) if item else None


def revoke_code(code_hash):
    try:
        _users().update_item(
            Key={'pk': f'CODE#{code_hash}', 'sk': 'CODE'},
            UpdateExpression='SET revoked = :yes',
            ExpressionAttributeValues={':yes': True},
            ConditionExpression=Attr('pk').exists() & Attr('pending_op_id').not_exists(),
        )
        return True
    except ClientError as exc:
        if exc.response['Error']['Code'] == 'ConditionalCheckFailedException':
            return False
        raise


def _add_calendar_months(dt, months):
    offset = dt.year * 12 + dt.month - 1 + months
    year, month_index = divmod(offset, 12)
    month = month_index + 1
    return dt.replace(year=year, month=month, day=min(dt.day, monthrange(year, month)[1]))


def get_billing_state(billing_uuid):
    return _read(f'BILLING#{billing_uuid}', 'STATE')


def _state_put(billing_uuid, current, changes):
    item = dict(current or {})
    item.update(changes)
    item.update(pk=f'BILLING#{billing_uuid}', sk='STATE', updated_at=_now_utc(),
                version=int((current or {}).get('version', 0)) + 1)
    put = {'TableName': _users().name, 'Item': item}
    if current:
        put.update(ConditionExpression='#v = :v',
                   ExpressionAttributeNames={'#v': 'version'},
                   ExpressionAttributeValues={':v': current['version']})
    else:
        put['ConditionExpression'] = 'attribute_not_exists(pk)'
    return {'Put': put}


def put_billing_state(billing_uuid, expected_version=None, **changes):
    current = get_billing_state(billing_uuid)
    if expected_version is not None and (current or {}).get('version') != expected_version:
        raise ValueError('version_mismatch')
    try:
        _transaction([_state_put(billing_uuid, current, changes)])
    except ValueError as exc:
        if str(exc) == 'billing_conflict':
            raise ValueError('version_mismatch') from exc
        raise
    return get_billing_state(billing_uuid)


def acquire_billing_lock(billing_uuid, owner_id, now_dt=None):
    now_dt = now_dt or _parse_timestamp(_now_utc())
    try:
        _users().update_item(
            Key={'pk': f'BILLING#{billing_uuid}', 'sk': 'LOCK'},
            UpdateExpression='SET #o = :owner, lease_expires_at = :expires',
            ExpressionAttributeNames={'#o': 'owner'},
            ExpressionAttributeValues={
                ':owner': owner_id, ':expires': int((now_dt + timedelta(seconds=120)).timestamp()),
                ':now': int(now_dt.timestamp()),
            },
            ConditionExpression='attribute_not_exists(#o) OR lease_expires_at <= :now OR #o = :owner',
        )
    except ClientError as exc:
        if exc.response['Error']['Code'] == 'ConditionalCheckFailedException':
            raise ValueError('billing_busy') from exc
        raise


def release_billing_lock(billing_uuid, owner_id):
    try:
        _users().update_item(
            Key={'pk': f'BILLING#{billing_uuid}', 'sk': 'LOCK'},
            UpdateExpression='REMOVE #o, lease_expires_at',
            ExpressionAttributeNames={'#o': 'owner'},
            ExpressionAttributeValues={':owner': owner_id},
            ConditionExpression='#o = :owner',
        )
    except ClientError as exc:
        if exc.response['Error']['Code'] != 'ConditionalCheckFailedException':
            raise


def _lock_check(billing_uuid, owner_id):
    return {'ConditionCheck': {
        'TableName': _users().name,
        'Key': {'pk': f'BILLING#{billing_uuid}', 'sk': 'LOCK'},
        'ConditionExpression': '#o = :owner AND lease_expires_at > :now',
        'ExpressionAttributeNames': {'#o': 'owner'},
        'ExpressionAttributeValues': {
            ':owner': owner_id, ':now': int(_parse_timestamp(_now_utc()).timestamp()),
        },
    }}


def get_operation(operation_id):
    return _read(f'OP#{operation_id}', 'OP')


def reserve_code_redemption(billing_uuid, plaintext_code, now_dt=None):
    now_dt = now_dt or _parse_timestamp(_now_utc())
    code_hash = _code_hash(plaintext_code)
    operation_id = hashlib.sha256((billing_uuid + code_hash).encode('ascii')).hexdigest()
    existing = get_operation(operation_id)
    if existing:
        return operation_id, existing['target_gift_until']
    acquire_billing_lock(billing_uuid, operation_id)
    try:
        current = get_billing_state(billing_uuid)
        if (current or {}).get('pending_redemption'):
            raise ValueError('billing_busy')
        code = get_code_state(code_hash)
        if not code:
            raise ValueError('not_found')
        if code.get('revoked'):
            raise ValueError('revoked')
        if code.get('expires_at') and _parse_timestamp(code['expires_at']) <= now_dt:
            raise ValueError('expired')
        if code.get('redeemed_by') or code.get('pending_op_id'):
            raise ValueError('already_redeemed')
        ends = [now_dt]
        for field in ('paid_until', 'gift_until'):
            value = (current or {}).get(field)
            if value and not (field == 'paid_until' and (current or {}).get('revocation')):
                ends.append(_parse_timestamp(value))
        target = _add_calendar_months(max(ends), 3).isoformat()
        operation = {
            'pk': f'OP#{operation_id}', 'sk': 'OP', 'identity_uuid': billing_uuid,
            'code_hash': code_hash, 'target_gift_until': target,
            'created_at': _now_utc(), 'completed': False,
        }
        _transaction([
            _lock_check(billing_uuid, operation_id),
            {'Update': {
                'TableName': _users().name, 'Key': {'pk': f'CODE#{code_hash}', 'sk': 'CODE'},
                'UpdateExpression': 'SET pending_op_id = :op, reserved_by = :uuid',
                'ConditionExpression': 'attribute_not_exists(pending_op_id) AND redeemed_by = :nil AND revoked = :no',
                'ExpressionAttributeValues': {
                    ':op': operation_id, ':uuid': billing_uuid, ':nil': None, ':no': False,
                },
            }},
            {'Put': {'TableName': _users().name, 'Item': operation,
                     'ConditionExpression': 'attribute_not_exists(pk)'}},
            _state_put(billing_uuid, current, {'pending_redemption': operation_id}),
        ])
        return operation_id, target
    finally:
        release_billing_lock(billing_uuid, operation_id)


def complete_code_redemption(operation_id, billing_uuid, expected_version=None):
    operation = get_operation(operation_id)
    if not operation:
        raise ValueError('not_found')
    if operation['identity_uuid'] != billing_uuid:
        raise ValueError('wrong_identity')
    if operation['completed']:
        return operation['target_gift_until']
    acquire_billing_lock(billing_uuid, operation_id)
    try:
        current = get_billing_state(billing_uuid)
        if not current or current.get('pending_redemption') != operation_id:
            raise ValueError('billing_conflict')
        if expected_version is not None and current['version'] != expected_version:
            raise ValueError('version_mismatch')
        _transaction([
            _lock_check(billing_uuid, operation_id),
            {'Update': {
                'TableName': _users().name,
                'Key': {'pk': f'CODE#{operation["code_hash"]}', 'sk': 'CODE'},
                'UpdateExpression': 'SET redeemed_by = :uuid REMOVE pending_op_id, reserved_by',
                'ConditionExpression': 'pending_op_id = :op AND redeemed_by = :nil',
                'ExpressionAttributeValues': {':uuid': billing_uuid, ':op': operation_id, ':nil': None},
            }},
            {'Update': {
                'TableName': _users().name, 'Key': {'pk': f'OP#{operation_id}', 'sk': 'OP'},
                'UpdateExpression': 'SET completed = :yes',
                'ConditionExpression': 'completed = :no',
                'ExpressionAttributeValues': {':yes': True, ':no': False},
            }},
            _state_put(billing_uuid, current, {
                'gift_until': operation['target_gift_until'], 'pending_redemption': None,
            }),
        ])
        return operation['target_gift_until']
    finally:
        release_billing_lock(billing_uuid, operation_id)


def get_billing_username_mapping(billing_uuid):
    item = _read(f'BILLING#{billing_uuid}', 'MAPPING')
    return item.get('username') if item and not item.get('deleted') else None


def put_billing_username_mapping(billing_uuid, username):
    _users().put_item(
        Item={'pk': f'BILLING#{billing_uuid}', 'sk': 'MAPPING',
              'username': username, 'deleted': False},
        ConditionExpression=Attr('pk').not_exists() |
            (Attr('username').eq(username) & Attr('deleted').eq(False)),
    )


def tombstone_billing_identity(billing_uuid):
    _users().update_item(
        Key={'pk': f'BILLING#{billing_uuid}', 'sk': 'MAPPING'},
        UpdateExpression='SET deleted = :yes, deleted_at = :now REMOVE username',
        ExpressionAttributeValues={':yes': True, ':now': _now_utc()},
    )


def event_completed(event_id):
    return _read(f'EVENT#{event_id}', 'EVENT') is not None


def complete_billing_event(billing_uuid, event_id, owner_id, changes):
    current = get_billing_state(billing_uuid)
    if (current or {}).get('pending_redemption'):
        raise ValueError('billing_busy')
    _transaction([
        _lock_check(billing_uuid, owner_id),
        {'ConditionCheck': {
            'TableName': _users().name,
            'Key': {'pk': f'BILLING#{billing_uuid}', 'sk': 'MAPPING'},
            'ConditionExpression': 'deleted = :no',
            'ExpressionAttributeValues': {':no': False},
        }},
        _state_put(billing_uuid, current, changes),
        {'Put': {
            'TableName': _users().name,
            'Item': {'pk': f'EVENT#{event_id}', 'sk': 'EVENT', 'completed_at': _now_utc()},
            'ConditionExpression': 'attribute_not_exists(pk)',
        }},
    ])
