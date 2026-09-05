import os
import uuid
from datetime import datetime, timedelta, timezone

import boto3
from boto3.dynamodb.conditions import Attr, Key
from botocore.exceptions import ClientError

MIN_FIRST_GRADE_YEAR = 1950
MAX_FIRST_GRADE_YEAR = 2100
LEADERBOARD_WINDOW_DAYS = 14
SCORE_HISTORY_LIMIT = 100


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


def _int_or_none(val):
    return int(val) if val is not None else None


def _now():
    return datetime.now(timezone.utc).isoformat()


def _parse_timestamp(value):
    dt = datetime.fromisoformat(value)
    return dt if dt.tzinfo is not None else dt.replace(tzinfo=timezone.utc)


def _leaderboard_cutoff():
    return datetime.now(timezone.utc) - timedelta(days=LEADERBOARD_WINDOW_DAYS)


# ---------------------------------------------------------------------------
# User operations
# ---------------------------------------------------------------------------

def get_user(username):
    """Return user dict or None."""
    resp = _users().get_item(Key={'pk': f'USER#{username}', 'sk': 'PROFILE'})
    item = resp.get('Item')
    if not item:
        return None
    return {
        'username': item['username'],
        'email': item['email'],
        'password_hash': item['password_hash'],
        'first_grade_year': _int_or_none(item.get('first_grade_year')),
        'created_at': item['created_at'],
    }


def create_user(username, email, password_hash, first_grade_year=None):
    """Create user + email lock. Raises ValueError('already_exists') if username or email taken."""
    now = _now()
    user_item = {
        'pk': f'USER#{username}', 'sk': 'PROFILE',
        'username': username, 'email': email,
        'password_hash': password_hash, 'created_at': now,
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
    """Scan recent HIGHSCORE items. Returns (global_entries, grouped_entries)."""
    items = []
    kwargs = {
        'FilterExpression': Attr('sk').eq('HIGHSCORE'),
    }
    resp = _scores().scan(**kwargs)
    items.extend(resp.get('Items', []))
    while 'LastEvaluatedKey' in resp:
        resp = _scores().scan(**kwargs, ExclusiveStartKey=resp['LastEvaluatedKey'])
        items.extend(resp.get('Items', []))

    cutoff = _leaderboard_cutoff()
    items = [item for item in items if _parse_timestamp(item['achieved_at']) >= cutoff]

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
