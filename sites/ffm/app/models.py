import os
import uuid
from datetime import datetime, timedelta, timezone

import boto3
from boto3.dynamodb.conditions import Attr, Key
from botocore.exceptions import ClientError
import hashlib
import secrets

MIN_FIRST_GRADE_YEAR = 1950
MAX_FIRST_GRADE_YEAR = 2100
SCORE_HISTORY_LIMIT = 100
VERIFY_EMAIL_TTL_SECONDS = 24 * 3600
RESET_PASSWORD_TTL_SECONDS = 3600
CHANGE_EMAIL_TTL_SECONDS = 24 * 3600


def _ddb():
    kwargs = {'region_name': os.environ.get('AWS_DEFAULT_REGION', 'eu-central-1')}
    endpoint = os.environ.get('DYNAMODB_ENDPOINT_URL')
    if endpoint:
        kwargs['endpoint_url'] = endpoint
    return boto3.resource('dynamodb', **kwargs)


def _users():
    return _ddb().Table(os.environ.get('DYNAMODB_USERS_TABLE', 'ffm-users'))


def _scores():
    return _ddb().Table(os.environ.get('DYNAMODB_SCORES_TABLE', 'ffm-scores'))


def _visits():
    return _ddb().Table(os.environ.get('DYNAMODB_VISITS_TABLE', 'ffm-visits'))


def _int_or_none(val):
    return int(val) if val is not None else None


def _now():
    return datetime.now(timezone.utc).isoformat()


def _parse_timestamp(value):
    dt = datetime.fromisoformat(value)
    return dt if dt.tzinfo is not None else dt.replace(tzinfo=timezone.utc)


# ---------------------------------------------------------------------------
# User operations
# ---------------------------------------------------------------------------

def get_user(username):
    """Return user dict or None."""
    resp = _users().get_item(Key={'pk': f'USER#{username}', 'sk': 'PROFILE'}, ConsistentRead=True)
    item = resp.get('Item')
    if not item:
        return None
    return {
        'username': item['username'],
        'email': item['email'],
        'password_hash': item['password_hash'],
        'first_grade_year': _int_or_none(item.get('first_grade_year')),
        'created_at': item['created_at'],
        # Pre-existing accounts created before email verification existed
        # have no `email_verified` attribute at all in DynamoDB. Defaulting
        # missing-attribute to True (not False) is what makes those
        # accounts "grandfathered in" as verified without a migration
        # script. New registrations always write the attribute explicitly
        # (see create_user), so only truly old rows hit this default.
        'email_verified': item.get('email_verified', True),
        'pending_email': item.get('pending_email'),
        'stable_id': item.get('stable_id'),
        'grandfathered': item.get('grandfathered', False),
        # Legacy profiles predating this attribute have no token_version at
        # all in DynamoDB; default missing -> 0 so the shared JWT validator
        # (app/jwt_utils.py) can still compare it against a freshly minted
        # token's `ver` claim. set_password_hash()'s `ADD token_version :one`
        # correctly bumps a missing attribute 0 -> 1 the first time it's used.
        'token_version': int(item.get('token_version', 0)),
    }


def create_user(username, email, password_hash, first_grade_year=None):
    """Create user + email lock. Raises ValueError('already_exists') if username or email taken.
    Generates and assigns a stable_id (UUID) to the new user for billing purposes."""
    now = _now()
    stable_id = str(uuid.uuid4())
    user_item = {
        'pk': f'USER#{username}', 'sk': 'PROFILE',
        'username': username, 'email': email,
        'password_hash': password_hash, 'created_at': now,
        'email_verified': False,
        'stable_id': stable_id,
    }
    if first_grade_year is not None:
        user_item['first_grade_year'] = first_grade_year

    email_item = {'pk': f'EMAIL#{email}', 'sk': 'REF', 'username': username}

    try:
        _users().put_item(
            Item=user_item,
            ConditionExpression=Attr('pk').not_exists(),
        )
    except ClientError as exc:
        if exc.response['Error']['Code'] == 'ConditionalCheckFailedException':
            raise ValueError('already_exists')
        raise

    try:
        _users().put_item(
            Item=email_item,
            ConditionExpression=Attr('pk').not_exists(),
        )
    except ClientError as exc:
        if exc.response['Error']['Code'] == 'ConditionalCheckFailedException':
            # Roll back the user record so no orphan is left
            _users().delete_item(Key={'pk': f'USER#{username}', 'sk': 'PROFILE'})
            raise ValueError('already_exists')
        raise

    return get_user(username)


def get_user_by_email(email):
    """Return user dict (same shape as get_user) or None, via the EMAIL#<email>/REF lookup item."""
    resp = _users().get_item(Key={'pk': f'EMAIL#{email}', 'sk': 'REF'})
    item = resp.get('Item')
    if not item:
        return None
    return get_user(item['username'])


def set_email_verified(username, verified):
    """Set (or clear) the email_verified flag on a user's profile."""
    _users().update_item(
        Key={'pk': f'USER#{username}', 'sk': 'PROFILE'},
        UpdateExpression='SET email_verified = :v',
        ExpressionAttributeValues={':v': verified},
    )


def delete_user(username):
    """Permanently delete a user's account: every score item (HIGHSCORE,
    LEVEL#*, HIST#*), the PROFILE item, and its EMAIL# lock — deleted in
    that order so a mid-way failure (e.g. a transient DynamoDB error)
    leaves the account still intact/usable rather than half-deleted (profile
    gone but orphaned scores left behind, or vice versa). Raises
    ValueError('not_found') if the account doesn't exist. Outstanding
    verify/reset/change-email TOKEN# items are intentionally left alone —
    they're keyed by token hash (not username), so finding them would
    require a full table scan, and consume_token already rejects them once
    expired; a token for a deleted account simply becomes unusable in
    practice since the routes that consume it re-check get_user first. Any
    such orphaned token is still physically removed like any other expired
    token by `flask retention-admin tokens` (see find_expired_tokens /
    app/retention_admin.py) — it does not need to be deleted here."""
    user = get_user(username)
    if user is None:
        raise ValueError('not_found')

    scores = _scores()
    resp = scores.query(KeyConditionExpression=Key('pk').eq(f'USER#{username}'))
    items = resp.get('Items', [])
    while 'LastEvaluatedKey' in resp:
        resp = scores.query(
            KeyConditionExpression=Key('pk').eq(f'USER#{username}'),
            ExclusiveStartKey=resp['LastEvaluatedKey'],
        )
        items.extend(resp.get('Items', []))

    with scores.batch_writer() as batch:
        for item in items:
            batch.delete_item(Key={'pk': item['pk'], 'sk': item['sk']})

    _users().delete_item(Key={'pk': f'USER#{username}', 'sk': 'PROFILE'})
    _users().delete_item(Key={'pk': f'EMAIL#{user["email"]}', 'sk': 'REF'})


def set_password_hash(username, password_hash):
    """Overwrite the stored bcrypt hash (used by /profile/password and
    /auth/reset-password), atomically incrementing token_version in the
    SAME DynamoDB update. Every access/refresh token minted before this
    call carries the old `ver` claim, so app/jwt_utils.py's shared
    validator rejects all of them on their very next use -- a password
    change or reset immediately revokes every outstanding session and
    forces re-login, with no window where the old password and an old
    still-valid token could coexist. `ADD token_version :one` is safe even
    when the attribute doesn't exist yet (legacy profiles): DynamoDB treats
    a missing numeric attribute as 0 before adding, so it becomes 1."""
    _users().update_item(
        Key={'pk': f'USER#{username}', 'sk': 'PROFILE'},
        UpdateExpression='SET password_hash = :v ADD token_version :one',
        ExpressionAttributeValues={':v': password_hash, ':one': 1},
    )


def set_pending_email(username, new_email):
    """Set pending_email on the profile, or REMOVE it entirely when new_email is None."""
    if new_email is None:
        _users().update_item(
            Key={'pk': f'USER#{username}', 'sk': 'PROFILE'},
            UpdateExpression='REMOVE pending_email',
        )
    else:
        _users().update_item(
            Key={'pk': f'USER#{username}', 'sk': 'PROFILE'},
            UpdateExpression='SET pending_email = :v',
            ExpressionAttributeValues={':v': new_email},
        )


def confirm_email_change(username, new_email):
    """Re-point the EMAIL# lookup from the user's current email to new_email,
    update the PROFILE item's email, and clear pending_email.
    Raises ValueError('already_exists') if new_email is already registered
    to a different account (leaves everything untouched in that case)."""
    user = get_user(username)
    if user is None:
        raise ValueError('not_found')
    old_email = user['email']

    new_email_item = {'pk': f'EMAIL#{new_email}', 'sk': 'REF', 'username': username}
    try:
        _users().put_item(
            Item=new_email_item,
            ConditionExpression=Attr('pk').not_exists(),
        )
    except ClientError as exc:
        if exc.response['Error']['Code'] == 'ConditionalCheckFailedException':
            raise ValueError('already_exists')
        raise

    # New ref created; now safe to update the profile and drop the old ref.
    _users().update_item(
        Key={'pk': f'USER#{username}', 'sk': 'PROFILE'},
        UpdateExpression='SET email = :e REMOVE pending_email',
        ExpressionAttributeValues={':e': new_email},
    )
    if old_email != new_email:
        _users().delete_item(Key={'pk': f'EMAIL#{old_email}', 'sk': 'REF'})


def _token_hash(token):
    return hashlib.sha256(token.encode('utf-8')).hexdigest()


def create_token(username, purpose, ttl_seconds, new_email=None):
    """Create a single-use token for the given purpose. Returns the PLAINTEXT
    token (only ever placed in an emailed link — never persisted). Only the
    SHA-256 hex digest of the token is stored as the item's pk, so a leaked
    DynamoDB read/backup cannot be used to log in or reset a password."""
    token = secrets.token_urlsafe(32)
    expires_at = (datetime.now(timezone.utc) + timedelta(seconds=ttl_seconds)).isoformat()
    item = {
        'pk': f'TOKEN#{_token_hash(token)}', 'sk': 'T',
        'username': username,
        'purpose': purpose,
        'expires_at': expires_at,
    }
    if new_email is not None:
        item['new_email'] = new_email
    _users().put_item(Item=item)
    return token


def consume_token(token, expected_purpose):
    """Validate and single-use-consume a token. Returns
    {'username': ..., 'new_email': ... or None} on success, else None.
    A token that exists but doesn't match expected_purpose (or is expired)
    is left untouched (NOT deleted) so an unrelated still-valid token for a
    different purpose isn't destroyed by a mismatched lookup attempt."""
    key = {'pk': f'TOKEN#{_token_hash(token)}', 'sk': 'T'}
    resp = _users().get_item(Key=key)
    item = resp.get('Item')
    if not item:
        return None
    if item.get('purpose') != expected_purpose:
        return None
    if _parse_timestamp(item['expires_at']) < datetime.now(timezone.utc):
        return None

    _users().delete_item(Key=key)
    return {
        'username': item['username'],
        'new_email': item.get('new_email'),
    }


def find_expired_tokens(now=None):
    """Return every TOKEN# item (any purpose: verify_email / reset_password /
    change_email) whose `expires_at` is already in the past, i.e. already
    permanently unusable per consume_token's own expiry check above — never
    an item that is still redeemable. Used by the retention-admin CLI to
    physically remove stale rows; does not delete anything itself. A table
    scan is used deliberately: tokens are keyed by SHA-256 hash (not a
    queryable attribute like username), so there is no cheaper lookup path,
    and this is a low-frequency maintenance operation, not a hot request
    path."""
    now = now or datetime.now(timezone.utc)
    kwargs = {'FilterExpression': Attr('pk').begins_with('TOKEN#') & Attr('sk').eq('T')}
    resp = _users().scan(**kwargs)
    items = list(resp.get('Items', []))
    while 'LastEvaluatedKey' in resp:
        resp = _users().scan(ExclusiveStartKey=resp['LastEvaluatedKey'], **kwargs)
        items.extend(resp.get('Items', []))
    return [item for item in items if _parse_timestamp(item['expires_at']) < now]


def delete_token_item(pk, expected_expires_at):
    """Physically remove one TOKEN# item by its exact pk (as returned by
    find_expired_tokens). Already-consumed tokens are removed immediately
    by consume_token() itself; this only ever deletes rows that were never
    consumed and are already expired.

    `pk` must be a `TOKEN#...` key — refused otherwise, since callers pass
    through scan results and this guards against ever being pointed at an
    unrelated item by a caller bug. The delete is conditional on
    `expires_at` still matching the snapshot the caller observed when it
    decided this token was expired (e.g. from find_expired_tokens): if the
    item was already removed (raced with consume_token, or a previous
    cleanup run) the condition fails and this returns False rather than
    deleting — or recreating — anything. Returns True if this call
    actually deleted the row, False if it was already gone/changed."""
    if not pk.startswith('TOKEN#'):
        raise ValueError('refusing to delete a non-token pk')
    if _parse_timestamp(expected_expires_at) >= datetime.now(timezone.utc):
        raise ValueError('refusing to delete an unexpired token')
    try:
        _users().delete_item(
            Key={'pk': pk, 'sk': 'T'},
            ConditionExpression=Attr('expires_at').eq(expected_expires_at),
        )
        return True
    except ClientError as exc:
        if exc.response['Error']['Code'] == 'ConditionalCheckFailedException':
            return False
        raise


def update_user_first_grade_year(username, first_grade_year):
    """Update first_grade_year on the profile and the denormalized high-score entry."""
    users = _users()
    if first_grade_year is None:
        users.update_item(
            Key={'pk': f'USER#{username}', 'sk': 'PROFILE'},
            UpdateExpression='REMOVE first_grade_year',
        )
    else:
        users.update_item(
            Key={'pk': f'USER#{username}', 'sk': 'PROFILE'},
            UpdateExpression='SET first_grade_year = :v',
            ExpressionAttributeValues={':v': first_grade_year},
        )
    # Keep the high-score entry in sync (ignore if it doesn't exist yet)
    try:
        scores = _scores()
        if first_grade_year is None:
            scores.update_item(
                Key={'pk': f'USER#{username}', 'sk': 'HIGHSCORE'},
                UpdateExpression='REMOVE first_grade_year',
                ConditionExpression=Attr('pk').exists(),
            )
        else:
            scores.update_item(
                Key={'pk': f'USER#{username}', 'sk': 'HIGHSCORE'},
                UpdateExpression='SET first_grade_year = :v',
                ExpressionAttributeValues={':v': first_grade_year},
                ConditionExpression=Attr('pk').exists(),
            )
    except ClientError as exc:
        if exc.response['Error']['Code'] != 'ConditionalCheckFailedException':
            raise


def ensure_stable_id(username):
    """Lazily assign an immutable billing identity without reviving deleted users."""
    from .billing_store import _transaction

    try:
        response = _users().update_item(
            Key={'pk': f'USER#{username}', 'sk': 'PROFILE'},
            UpdateExpression='SET stable_id = if_not_exists(stable_id, :sid)',
            ExpressionAttributeValues={':sid': str(uuid.uuid4())},
            ConditionExpression=Attr('pk').exists(),
            ReturnValues='ALL_NEW',
        )
    except ClientError as exc:
        if exc.response['Error']['Code'] == 'ConditionalCheckFailedException':
            return None
        raise
    stable_id = response['Attributes']['stable_id']
    _transaction([
        {'ConditionCheck': {
            'TableName': _users().name,
            'Key': {'pk': f'USER#{username}', 'sk': 'PROFILE'},
            'ConditionExpression': 'stable_id = :sid',
            'ExpressionAttributeValues': {':sid': stable_id},
        }},
        {'Put': {
            'TableName': _users().name,
            'Item': {'pk': f'BILLING#{stable_id}', 'sk': 'MAPPING',
                     'username': username, 'deleted': False},
            'ConditionExpression': 'attribute_not_exists(pk) OR (username = :name AND deleted = :no)',
            'ExpressionAttributeValues': {':name': username, ':no': False},
        }},
    ])
    return stable_id


def grandfather_user(username, created_at):
    _users().update_item(
        Key={'pk': f'USER#{username}', 'sk': 'PROFILE'},
        UpdateExpression='SET grandfathered = :yes',
        ConditionExpression='created_at = :created AND (attribute_not_exists(email_verified) OR email_verified = :yes)',
        ExpressionAttributeValues={':yes': True, ':created': created_at},
    )

# ---------------------------------------------------------------------------
# Score operations
# ---------------------------------------------------------------------------

def get_level_scores(username):
    """Return list of {level, score, difficulty, achieved_at} dicts."""
    resp = _scores().query(
        KeyConditionExpression=Key('pk').eq(f'USER#{username}') & Key('sk').begins_with('LEVEL#'),
    )
    return [
        {
            'level': int(item['level']),
            'score': int(item['score']),
            'difficulty': item['difficulty'],
            'achieved_at': item['achieved_at'],
        }
        for item in resp.get('Items', [])
    ]


def put_level_score(username, level, score, difficulty):
    """Upsert only when score improves. Returns (saved: bool, personal_best: int)."""
    key = {'pk': f'USER#{username}', 'sk': f'LEVEL#{level}#{difficulty}'}
    try:
        _scores().put_item(
            Item={**key, 'level': level, 'score': score, 'difficulty': difficulty, 'achieved_at': _now()},
            ConditionExpression=Attr('pk').not_exists() | Attr('score').lt(score),
        )
        return True, score
    except ClientError as exc:
        if exc.response['Error']['Code'] == 'ConditionalCheckFailedException':
            existing = _scores().get_item(Key=key).get('Item', {})
            return False, int(existing.get('score', score))
        raise


def get_high_score(username):
    """Return {high_score, achieved_at} or None."""
    resp = _scores().get_item(Key={'pk': f'USER#{username}', 'sk': 'HIGHSCORE'})
    item = resp.get('Item')
    if not item:
        return None
    return {'high_score': int(item['high_score']), 'achieved_at': item['achieved_at']}


def put_high_score(username, score, first_grade_year=None):
    """Upsert high score only when score improves. Returns (saved: bool, record: dict)."""
    now = _now()
    item = {
        'pk': f'USER#{username}', 'sk': 'HIGHSCORE',
        'username': username, 'high_score': score, 'achieved_at': now,
    }
    if first_grade_year is not None:
        item['first_grade_year'] = first_grade_year
    try:
        _scores().put_item(
            Item=item,
            ConditionExpression=Attr('pk').not_exists() | Attr('high_score').lt(score),
        )
        return True, {'high_score': score, 'achieved_at': now}
    except ClientError as exc:
        if exc.response['Error']['Code'] == 'ConditionalCheckFailedException':
            return False, get_high_score(username)
        raise


def put_score_history(username, score):
    """Append a score-history entry. Always writes (unlike put_high_score,
    which only writes on improvement) so the curve reflects every submission."""
    now = _now()
    suffix = uuid.uuid4().hex[:8]
    _scores().put_item(Item={
        'pk': f'USER#{username}',
        'sk': f'HIST#{now}#{suffix}',
        'username': username,
        'score': score,
        'achieved_at': now,
    })


def get_score_history(username, limit=SCORE_HISTORY_LIMIT):
    """Return up to `limit` most recent {score, achieved_at} dicts,
    ordered oldest-to-newest for charting."""
    resp = _scores().query(
        KeyConditionExpression=Key('pk').eq(f'USER#{username}') & Key('sk').begins_with('HIST#'),
        ScanIndexForward=False,
        Limit=limit,
    )
    items = resp.get('Items', [])
    items.sort(key=lambda x: x['sk'])
    return [
        {'score': int(item['score']), 'achieved_at': item['achieved_at']}
        for item in items
    ]


def get_leaderboard(first_grade_year_filter=None):
    """Scan all-time HIGHSCORE items. Returns (global_entries, grouped_entries).

    Not filtered by recency: `achieved_at` only reflects when a personal best
    was last improved, not when the player last played, so filtering on it
    would hide active players whose existing record simply hasn't been beaten
    recently.
    """
    items = []
    kwargs = {
        'FilterExpression': Attr('sk').eq('HIGHSCORE'),
    }
    resp = _scores().scan(**kwargs)
    items.extend(resp.get('Items', []))
    while 'LastEvaluatedKey' in resp:
        resp = _scores().scan(**kwargs, ExclusiveStartKey=resp['LastEvaluatedKey'])
        items.extend(resp.get('Items', []))

    items.sort(key=lambda x: (-int(x['high_score']), x['achieved_at'], x.get('username', '')))

    global_entries = [
        {
            'rank': i + 1,
            'username': item['username'],
            'high_score': int(item['high_score']),
            'first_grade_year': _int_or_none(item.get('first_grade_year')),
            'achieved_at': item['achieved_at'],
        }
        for i, item in enumerate(items[:10])
    ]

    if first_grade_year_filter is not None:
        items = [x for x in items if _int_or_none(x.get('first_grade_year')) == first_grade_year_filter]

    grouped_map = {}
    for item in items:
        year = _int_or_none(item.get('first_grade_year'))
        grouped_map.setdefault(year, []).append(item)

    grouped_entries = []
    for year in sorted(grouped_map, key=lambda v: (v is None, v if v is not None else 0)):
        entries = [
            {
                'rank': rank,
                'username': item['username'],
                'high_score': int(item['high_score']),
                'first_grade_year': year,
                'achieved_at': item['achieved_at'],
            }
            for rank, item in enumerate(grouped_map[year][:10], start=1)
        ]
        grouped_entries.append({
            'first_grade_year': year,
            'label': str(year) if year is not None else 'unclassified',
            'entries': entries,
        })

    return global_entries, grouped_entries
