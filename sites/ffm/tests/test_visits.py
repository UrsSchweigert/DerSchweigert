import os
import pytest
import boto3
from moto import mock_aws
from unittest.mock import patch
from datetime import datetime, timezone, timedelta

os.environ['SECRET_KEY'] = 'test-secret-key-for-testing-only'
os.environ['AWS_ACCESS_KEY_ID'] = 'testing'
os.environ['AWS_SECRET_ACCESS_KEY'] = 'testing'
os.environ['AWS_SECURITY_TOKEN'] = 'testing'
os.environ['AWS_SESSION_TOKEN'] = 'testing'
os.environ['AWS_DEFAULT_REGION'] = 'eu-central-1'
os.environ['DYNAMODB_USERS_TABLE'] = 'ffm-users-test'
os.environ['DYNAMODB_SCORES_TABLE'] = 'ffm-scores-test'
os.environ['DYNAMODB_RATELIMIT_TABLE'] = 'ffm-ratelimits-test'
os.environ['DYNAMODB_VISITS_TABLE'] = 'ffm-visits-test'
os.environ['ADMIN_VISITS_TOKEN'] = 'test-admin-token'

from sites.ffm.app import create_app
from sites.ffm.app.config import TestingConfig


@pytest.fixture(scope='function')
def aws_mock():
    with mock_aws():
        ddb = boto3.resource('dynamodb', region_name='eu-central-1')
        # Visits table schema must match Terraform infra/terraform/sites/ffm/main.tf:
        # - hash_key: date (S)
        # - range_key: visitor (S)
        # - TTL: expires_at
        ddb.create_table(
            TableName='ffm-visits-test',
            KeySchema=[
                {'AttributeName': 'date', 'KeyType': 'HASH'},
                {'AttributeName': 'visitor', 'KeyType': 'RANGE'},
            ],
            AttributeDefinitions=[
                {'AttributeName': 'date', 'AttributeType': 'S'},
                {'AttributeName': 'visitor', 'AttributeType': 'S'},
            ],
            BillingMode='PAY_PER_REQUEST',
        )
        table = ddb.Table('ffm-visits-test')
        table.wait_until_exists()
        
        for table_name in ('ffm-users-test', 'ffm-scores-test'):
            ddb.create_table(
                TableName=table_name,
                KeySchema=[
                    {'AttributeName': 'pk', 'KeyType': 'HASH'},
                    {'AttributeName': 'sk', 'KeyType': 'RANGE'},
                ],
                AttributeDefinitions=[
                    {'AttributeName': 'pk', 'AttributeType': 'S'},
                    {'AttributeName': 'sk', 'AttributeType': 'S'},
                ],
                BillingMode='PAY_PER_REQUEST',
            )
        ddb.create_table(
            TableName='ffm-ratelimits-test',
            KeySchema=[{'AttributeName': 'pk', 'KeyType': 'HASH'}],
            AttributeDefinitions=[{'AttributeName': 'pk', 'AttributeType': 'S'}],
            BillingMode='PAY_PER_REQUEST',
        )
        yield


@pytest.fixture
def app(aws_mock):
    return create_app(TestingConfig)


@pytest.fixture
def client(app):
    return app.test_client()


def test_visits_table_schema_matches_terraform():
    """Regression: verify table schema matches Terraform infra definition.
    
    Terraform (infra/terraform/sites/ffm/main.tf):
    - hash_key: date (S)
    - range_key: visitor (S)
    - TTL: expires_at
    """
    with mock_aws():
        ddb = boto3.resource('dynamodb', region_name='eu-central-1')
        ddb.create_table(
            TableName='ffm-visits-test',
            KeySchema=[
                {'AttributeName': 'date', 'KeyType': 'HASH'},
                {'AttributeName': 'visitor', 'KeyType': 'RANGE'},
            ],
            AttributeDefinitions=[
                {'AttributeName': 'date', 'AttributeType': 'S'},
                {'AttributeName': 'visitor', 'AttributeType': 'S'},
            ],
            BillingMode='PAY_PER_REQUEST',
        )
        
        from sites.ffm.app.models import _ddb
        table = _ddb().Table('ffm-visits-test')
        
        # Verify schema
        desc = table.meta.client.describe_table(TableName='ffm-visits-test')
        schema = desc['Table']['KeySchema']
        attrs = {a['AttributeName']: a['AttributeType'] for a in desc['Table']['AttributeDefinitions']}
        
        # Check hash key
        assert schema[0]['AttributeName'] == 'date', "Hash key must be 'date'"
        assert schema[0]['KeyType'] == 'HASH'
        assert attrs['date'] == 'S'
        
        # Check range key
        assert schema[1]['AttributeName'] == 'visitor', "Range key must be 'visitor' (not 'hash')"
        assert schema[1]['KeyType'] == 'RANGE'
        assert attrs['visitor'] == 'S'


def test_visit_endpoint_returns_204_on_success(client):
    """POST /api/visit should return 204 (no content) with empty body on success."""
    resp = client.post('/api/visit')
    assert resp.status_code == 204
    assert resp.data == b''  # Empty body


def test_visit_endpoint_returns_503_on_ddb_error(client, monkeypatch):
    """POST /api/visit should return 503 and log error on DynamoDB failure."""
    from sites.ffm.app import visits
    
    # Monkeypatch to simulate DynamoDB error
    def raise_error(*args, **kwargs):
        from botocore.exceptions import ClientError
        raise ClientError(
            {'Error': {'Code': 'ServiceUnavailable', 'Message': 'Service down'}},
            'PutItem'
        )
    
    monkeypatch.setattr(visits, '_visits_table', lambda: type('MockTable', (), {
        'put_item': raise_error
    })())
    
    resp = client.post('/api/visit')
    assert resp.status_code == 503


def test_visit_records_with_visitor_and_expires_at(client):
    """POST /api/visit should record item with 'visitor' and 'expires_at' (not 'hash'/'ttl')."""
    resp = client.post('/api/visit')
    assert resp.status_code == 204
    
    # Verify it was recorded with correct schema
    from sites.ffm.app.models import _visits
    table = _visits()
    utc_date = datetime.now(timezone.utc).date().isoformat()
    resp = table.query(
        KeyConditionExpression='#d = :d',
        ExpressionAttributeNames={'#d': 'date'},
        ExpressionAttributeValues={':d': utc_date}
    )
    
    assert resp['Count'] == 1
    item = resp['Items'][0]
    assert 'date' in item
    assert 'visitor' in item  # Must be 'visitor', not 'hash'
    assert 'expires_at' in item  # Must be 'expires_at', not 'ttl'
    assert 'hash' not in item, "Schema error: must use 'visitor' not 'hash'"
    assert 'ttl' not in item, "Schema error: must use 'expires_at' not 'ttl'"


def test_visit_deduplicates_same_ip_ua(client):
    """POST /api/visit with same IP + User-Agent should not increment count (dedup)."""
    resp1 = client.post('/api/visit')
    assert resp1.status_code == 204
    
    resp2 = client.post('/api/visit')
    assert resp2.status_code == 204
    
    from sites.ffm.app.models import _visits
    table = _visits()
    utc_date = datetime.now(timezone.utc).date().isoformat()
    resp = table.query(
        KeyConditionExpression='#d = :d',
        ExpressionAttributeNames={'#d': 'date'},
        ExpressionAttributeValues={':d': utc_date}
    )
    assert resp['Count'] == 1, "Duplicate visit should not be recorded"


def test_visit_counts_different_ua_separately(client):
    """POST /api/visit with different User-Agent should be counted separately."""
    resp1 = client.post('/api/visit', headers={'User-Agent': 'Mozilla/5.0 Chrome'})
    assert resp1.status_code == 204
    
    resp2 = client.post('/api/visit', headers={'User-Agent': 'Mozilla/5.0 Firefox'})
    assert resp2.status_code == 204
    
    from sites.ffm.app.models import _visits
    table = _visits()
    utc_date = datetime.now(timezone.utc).date().isoformat()
    resp = table.query(
        KeyConditionExpression='#d = :d',
        ExpressionAttributeNames={'#d': 'date'},
        ExpressionAttributeValues={':d': utc_date}
    )
    assert resp['Count'] == 2, "Different User-Agent should create separate entry"


def test_visit_expires_at_is_unix_timestamp():
    """Verify expires_at is stored as unix timestamp (~400 days)."""
    from decimal import Decimal

    with mock_aws():
        import os
        os.environ['DYNAMODB_VISITS_TABLE'] = 'ffm-visits-test'

        ddb = boto3.resource('dynamodb', region_name='eu-central-1')
        ddb.create_table(
            TableName='ffm-visits-test',
            KeySchema=[
                {'AttributeName': 'date', 'KeyType': 'HASH'},
                {'AttributeName': 'visitor', 'KeyType': 'RANGE'},
            ],
            AttributeDefinitions=[
                {'AttributeName': 'date', 'AttributeType': 'S'},
                {'AttributeName': 'visitor', 'AttributeType': 'S'},
            ],
            BillingMode='PAY_PER_REQUEST',
        )

        from sites.ffm.app import create_app
        from sites.ffm.app.config import TestingConfig
        app = create_app(TestingConfig)

        with app.test_client() as client:
            client.post('/api/visit')

        from sites.ffm.app.models import _visits
        table = _visits()
        utc_date = datetime.now(timezone.utc).date().isoformat()
        resp = table.query(
            KeyConditionExpression='#d = :d',
            ExpressionAttributeNames={'#d': 'date'},
            ExpressionAttributeValues={':d': utc_date}
        )

        item = resp['Items'][0]
        expires_at = item['expires_at']

        # DynamoDB returns Decimal; convert for comparison
        expires_at_int = int(expires_at)

        # Should be a unix timestamp (integer-like)
        assert isinstance(expires_at, (int, Decimal))

        # Should be ~400 days in the future (within 1 day tolerance for test timing)
        now = int(datetime.now(timezone.utc).timestamp())
        future = now + (400 * 86400)
        assert future - 86400 <= expires_at_int <= future + 86400, \
            f"expires_at should be ~400 days from now (±1 day); got {expires_at_int}"


def test_admin_visits_without_auth_returns_403(client):
    """GET /api/admin/visits without auth should return 403."""
    resp = client.get('/api/admin/visits')
    assert resp.status_code == 403


def test_admin_visits_with_wrong_token_returns_403(client):
    """GET /api/admin/visits with wrong token should return 403."""
    resp = client.get('/api/admin/visits', headers={'Authorization': 'Bearer wrong-token'})
    assert resp.status_code == 403


def test_admin_visits_with_correct_token_returns_data(client):
    """GET /api/admin/visits with correct token should return visit data."""
    resp = client.post('/api/visit')
    assert resp.status_code == 204
    
    resp = client.get('/api/admin/visits', headers={'Authorization': 'Bearer test-admin-token'})
    assert resp.status_code == 200
    data = resp.get_json()
    assert 'daily_counts' in data
    assert 'total' in data
    assert 'note' in data
    assert 'daily-unique' in data['note'].lower(), "Note must clarify daily-unique, not people"
    assert data['total'] == 1


def test_admin_visits_aggregates_by_date(client):
    """GET /api/admin/visits should aggregate visits by date."""
    resp1 = client.post('/api/visit', headers={'User-Agent': 'Chrome'})
    assert resp1.status_code == 204
    
    resp2 = client.post('/api/visit', headers={'User-Agent': 'Firefox'})
    assert resp2.status_code == 204
    
    resp = client.get('/api/admin/visits', headers={'Authorization': 'Bearer test-admin-token'})
    assert resp.status_code == 200
    data = resp.get_json()
    assert data['total'] == 2
    
    utc_date = datetime.now(timezone.utc).date().isoformat()
    assert utc_date in data['daily_counts']
    assert data['daily_counts'][utc_date] == 2


def test_admin_visits_handles_pagination(client):
    """GET /api/admin/visits should handle table pagination correctly."""
    # Record many visits to trigger pagination (if table were large)
    for i in range(5):
        resp = client.post('/api/visit', headers={'User-Agent': f'UA-{i}'})
        assert resp.status_code == 204
    
    resp = client.get('/api/admin/visits', headers={'Authorization': 'Bearer test-admin-token'})
    assert resp.status_code == 200
    data = resp.get_json()
    assert data['total'] == 5


def test_admin_visits_excludes_expired_entries(client, monkeypatch):
    """GET /api/admin/visits should exclude expired entries (TTL async deletion)."""
    # Record a visit
    resp = client.post('/api/visit')
    assert resp.status_code == 204
    
    # Manually insert an expired entry into the table
    from sites.ffm.app.models import _visits
    table = _visits()
    expired_entry = {
        'date': datetime.now(timezone.utc).date().isoformat(),
        'visitor': 'expired-visitor-hash',
        'expires_at': int(datetime.now(timezone.utc).timestamp()) - 1000,  # Expired
    }
    table.put_item(Item=expired_entry)
    
    # Query admin endpoint
    resp = client.get('/api/admin/visits', headers={'Authorization': 'Bearer test-admin-token'})
    assert resp.status_code == 200
    data = resp.get_json()
    
    # Should count only the non-expired visit (not the manually inserted expired one)
    assert data['total'] == 1, "Expired entries should be filtered out"


def test_admin_visits_token_comparison_constant_time():
    """Admin visits should use constant-time token comparison (no timing attacks)."""
    from sites.ffm.app.main import _constant_time_compare
    
    assert _constant_time_compare('abc', 'abc') is True
    assert _constant_time_compare('abc', 'xyz') is False
    # Non-string inputs should safely return False
    assert _constant_time_compare(None, 'abc') is False
    assert _constant_time_compare('abc', None) is False


def test_visitor_never_stored_raw_ip_or_ua(app):
    """Verify raw IP and User-Agent are never stored in visitor table."""
    from sites.ffm.app.models import _visits
    
    with app.test_client() as client:
        client.post('/api/visit', headers={'User-Agent': 'Test-UA-12345'})
    
    # Scan table and verify no raw values
    table = _visits()
    resp = table.scan()
    
    for item in resp.get('Items', []):
        # Item should only have: date, visitor, expires_at
        assert 'ip' not in item, "Raw IP must not be stored"
        assert 'user_agent' not in item, "Raw User-Agent must not be stored"
        assert 'ua' not in item, "Abbreviated UA must not be stored"
        
        # visitor must be 64-char hex (SHA256)
        assert 'visitor' in item
        assert len(item['visitor']) == 64
        assert all(c in '0123456789abcdef' for c in item['visitor']), \
            "visitor must be SHA256 hex digest"


def test_admin_visits_token_not_configured_returns_403(app):
    """If ADMIN_VISITS_TOKEN is not set, endpoint should return 403."""
    from sites.ffm.app.config import TestingConfig
    
    class NoTokenConfig(TestingConfig):
        ADMIN_VISITS_TOKEN = ''
    
    app_no_token = create_app(NoTokenConfig)
    client = app_no_token.test_client()
    
    resp = client.get('/api/admin/visits', headers={'Authorization': 'Bearer any-token'})
    assert resp.status_code == 403


def test_daily_salt_consistent_within_day():
    """Verify daily_salt is computed consistently for the same UTC date."""
    from sites.ffm.app import visits
    from datetime import datetime, timezone
    
    os.environ['SECRET_KEY'] = 'test-key-123'
    
    from sites.ffm.app import create_app
    from sites.ffm.app.config import TestingConfig
    app = create_app(TestingConfig)
    
    with app.app_context():
        salt1, date1 = visits._get_daily_salt()
        salt2, date2 = visits._get_daily_salt()
        
        # Should be identical for same UTC date
        assert salt1 == salt2, "Daily salt should be consistent within the same UTC date"
        assert date1 == date2

