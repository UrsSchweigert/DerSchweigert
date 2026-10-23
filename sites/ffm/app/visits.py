"""Cookieless unique-visitor counter for FFM game.

Design:
- Partition: date (YYYY-MM-DD UTC)
- Range: visitor = sha256(daily_salt + client_ip + user_agent) hex
- daily_salt = HMAC(UTC_DATE, SECRET_KEY or VISIT_SALT) — ensures same date
  gets same salt for deduplication, different dates get different salts
- TTL: expires_at = timestamp ~400 days hence (DynamoDB TTL deletion async)
- Never store raw IP or User-Agent
- Client IP via request.remote_addr set by apig_wsgi from X-Forwarded-For

Privacy note: Counter measures daily page-load fingerprints (IP + UA hash),
not actual people or gameplay. Estimates are daily unique page-loads, not
unique individuals. Hash changes daily (different salt), preventing multi-day
tracking. Raw IP/UA never stored to DynamoDB.
"""
import os
import hashlib
import hmac
from datetime import datetime, timezone, timedelta
from flask import request, current_app

from .models import _ddb


def _visits_table():
    """Get DynamoDB visits table resource."""
    table_name = os.environ.get('DYNAMODB_VISITS_TABLE', 'ffm-visits')
    return _ddb().Table(table_name)


def _get_daily_salt():
    """Generate HMAC-based daily salt for today's UTC date.
    
    Salt is derived from HMAC(date_string, secret_key) so that:
    - Same date gets same salt (for deduplication within a day)
    - Different dates get different salts (daily uniqueness)
    - Cannot be replayed from a different machine without the secret
    
    Computed once per request; caller ensures consistency across writes.
    """
    utc_date = datetime.now(timezone.utc).date().isoformat()
    secret = os.environ.get('VISIT_SALT') or current_app.config['SECRET_KEY']
    salt = hmac.new(
        secret.encode('utf-8'),
        utc_date.encode('utf-8'),
        hashlib.sha256
    ).digest()
    return salt, utc_date


def _get_client_ip():
    """Extract client IP from request.
    
    apig_wsgi sets REMOTE_ADDR from X-Forwarded-For header (first value
    before comma) when present, or 127.0.0.1 by default. Flask's
    request.remote_addr uses the WSGI REMOTE_ADDR value. X-Forwarded-For
    is populated by API Gateway/CloudFront (trusted upstream), not by
    arbitrary clients. Without ProxyFix middleware, Flask does not parse
    X-Forwarded-For directly; we rely on apig_wsgi's REMOTE_ADDR setup.
    """
    return request.remote_addr


def _get_client_user_agent():
    """Extract User-Agent header."""
    return request.headers.get('User-Agent', '')


def _compute_visitor_hash(daily_salt, client_ip, user_agent):
    """Compute sha256 hash of (daily_salt + client_ip + user_agent).
    
    Returns hex digest. Never stores raw IP or UA.
    """
    h = hashlib.sha256()
    h.update(daily_salt)
    h.update(client_ip.encode('utf-8'))
    h.update(user_agent.encode('utf-8'))
    return h.hexdigest()


def record_visit():
    """Record a unique visit (conditional put into DynamoDB).
    
    Uses conditional PutItem to avoid duplicates within the same day
    for the same (IP, User-Agent) pair. Logs errors; returns True if
    recorded (new or already exists).
    Raises botocore.exceptions.(ClientError, BotoCoreError) for caller
    to handle at route level.
    """
    from botocore.exceptions import ClientError, BotoCoreError
    
    daily_salt, utc_date = _get_daily_salt()
    client_ip = _get_client_ip()
    user_agent = _get_client_user_agent()
    visitor_hash = _compute_visitor_hash(daily_salt, client_ip, user_agent)
    
    # TTL: ~400 days from now
    expires_at = int((datetime.now(timezone.utc) + timedelta(days=400)).timestamp())
    
    try:
        _visits_table().put_item(
            Item={
                'date': utc_date,
                'visitor': visitor_hash,
                'expires_at': expires_at,
            },
            ConditionExpression='attribute_not_exists(#d) OR attribute_not_exists(#v)',
            ExpressionAttributeNames={'#d': 'date', '#v': 'visitor'}
        )
        return True
    except ClientError as e:
        # ConditionalCheckFailedException means already exists (duplicate)
        if e.response['Error']['Code'] == 'ConditionalCheckFailedException':
            current_app.logger.debug(f"Visit already recorded for visitor {visitor_hash[:8]}")
            return True  # Duplicate is still "ok"
        # Other errors (e.g., table not found, provisioning issues)
        current_app.logger.error(f"DynamoDB error recording visit: {e.response['Error']['Code']}")
        raise
    except BotoCoreError as e:
        current_app.logger.error(f"BotoCore error recording visit: {e}")
        raise


def get_all_daily_unique_visits():
    """Scan all visits (regardless of date) and aggregate by date.
    
    Excludes expired entries (TTL deletion is asynchronous in DynamoDB, so
    old entries may still exist briefly; skip them based on current time).
    
    Returns dict with:
    - daily_counts: dict mapping YYYY-MM-DD -> unique count
    - total: sum of all daily counts (daily-unique, not all-time-unique)
    - note: explanation that total is daily-unique, not actual people
    
    WARNING: This is a full table scan and can be expensive.
    Only call from admin endpoints with authentication.
    """
    from boto3.dynamodb.conditions import Attr
    
    table = _visits_table()
    daily_counts = {}
    now = int(datetime.now(timezone.utc).timestamp())
    
    try:
        # Scan with FilterExpression to exclude expired entries
        scan_kwargs = {
            'FilterExpression': Attr('expires_at').gt(now)
        }
        
        resp = table.scan(**scan_kwargs)
        for item in resp.get('Items', []):
            date = item.get('date')
            if date:
                daily_counts[date] = daily_counts.get(date, 0) + 1
        
        # Handle pagination
        while 'LastEvaluatedKey' in resp:
            scan_kwargs['ExclusiveStartKey'] = resp['LastEvaluatedKey']
            resp = table.scan(**scan_kwargs)
            for item in resp.get('Items', []):
                date = item.get('date')
                if date:
                    daily_counts[date] = daily_counts.get(date, 0) + 1
    except Exception as e:
        current_app.logger.error(f"Error scanning visits: {e}")
        raise
    
    total = sum(daily_counts.values())
    return {
        'daily_counts': daily_counts,
        'total': total,
    }

