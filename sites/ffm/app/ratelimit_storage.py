"""DynamoDB-backed storage for flask-limiter / limits.

Lambda gives every concurrent execution environment its own process
memory, so the default `memory://` storage cannot share rate-limit
counters across invocations — each cold/parallel instance starts back
at zero. This module registers a `dynamodb://<table>` storage scheme
that persists counters in the same DynamoDB account already used for
users/scores, avoiding the operational cost of standing up Redis/
ElastiCache (which would also require putting the Lambda in a VPC).

Usage: `RATELIMIT_STORAGE_URI = "dynamodb://ffm-ratelimits"`.
Simply importing this module registers the scheme with the `limits`
library's storage registry; it does not need to be called directly.
"""
import time
from decimal import Decimal
from urllib.parse import urlparse

from botocore.exceptions import ClientError
from limits.storage.base import Storage

from .models import _ddb

# How long past its window a counter row may linger before we bother
# deleting it ourselves; DynamoDB TTL cleanup is best-effort and can lag
# by hours, so counters are also treated as expired based on this
# attribute at read/write time rather than relying on TTL deletion alone.
_TTL_GRACE_SECONDS = 60


class DynamoDBStorage(Storage):
    """Fixed-window rate limit counters stored in DynamoDB.

    Table schema: hash key `pk` (string), plus `counter` (number),
    `expires_at` (number, epoch seconds marking the end of the current
    window), and `ttl` (number, epoch seconds; DynamoDB TTL attribute
    for eventual cleanup of stale rows).
    """

    STORAGE_SCHEME = ["dynamodb"]

    def __init__(self, uri=None, wrap_exceptions=False, **options):
        table_name = urlparse(uri).netloc if uri else "ffm-ratelimits"
        self._table_name = table_name
        self._table_cache = None
        super().__init__(uri, wrap_exceptions=wrap_exceptions, **options)

    def _table(self):
        if self._table_cache is None:
            self._table_cache = _ddb().Table(self._table_name)
        return self._table_cache

    @property
    def base_exceptions(self):
        return ClientError

    def incr(self, key, expiry, elastic_expiry=False, amount=1):
        now = time.time()
        table = self._table()
        ttl = int(now + expiry) + _TTL_GRACE_SECONDS

        if elastic_expiry:
            resp = table.update_item(
                Key={'pk': key},
                UpdateExpression='SET #c = if_not_exists(#c, :zero) + :amt, expires_at = :exp, #t = :ttl',
                ExpressionAttributeNames={'#c': 'counter', '#t': 'ttl'},
                ExpressionAttributeValues={
                    ':amt': Decimal(amount), ':zero': Decimal(0),
                    ':exp': Decimal(str(now + expiry)), ':ttl': ttl,
                },
                ReturnValues='UPDATED_NEW',
            )
            return int(resp['Attributes']['counter'])

        # Fixed window: keep incrementing the same counter while the
        # current window is still open; start a fresh window (reset the
        # counter) once it has passed, without waiting for DynamoDB's
        # best-effort TTL sweep to actually remove the old row.
        try:
            resp = table.update_item(
                Key={'pk': key},
                UpdateExpression='SET #c = #c + :amt, #t = :ttl',
                ConditionExpression='attribute_exists(pk) AND expires_at > :now',
                ExpressionAttributeNames={'#c': 'counter', '#t': 'ttl'},
                ExpressionAttributeValues={':amt': Decimal(amount), ':ttl': ttl, ':now': Decimal(str(now))},
                ReturnValues='UPDATED_NEW',
            )
            return int(resp['Attributes']['counter'])
        except ClientError as exc:
            if exc.response['Error']['Code'] != 'ConditionalCheckFailedException':
                raise

        resp = table.update_item(
            Key={'pk': key},
            UpdateExpression='SET #c = :amt, expires_at = :exp, #t = :ttl',
            ExpressionAttributeNames={'#c': 'counter', '#t': 'ttl'},
            ExpressionAttributeValues={':amt': Decimal(amount), ':exp': Decimal(str(now + expiry)), ':ttl': ttl},
            ReturnValues='UPDATED_NEW',
        )
        return int(resp['Attributes']['counter'])

    def get(self, key):
        item = self._table().get_item(Key={'pk': key}).get('Item')
        if not item or float(item['expires_at']) <= time.time():
            return 0
        return int(item['counter'])

    def get_expiry(self, key):
        item = self._table().get_item(Key={'pk': key}).get('Item')
        if not item:
            return time.time()
        return float(item['expires_at'])

    def check(self):
        try:
            self._table().get_item(Key={'pk': '__health_check__'})
            return True
        except ClientError:
            return False

    def reset(self):
        table = self._table()
        deleted = 0
        scan_kwargs = {'ProjectionExpression': 'pk'}
        while True:
            resp = table.scan(**scan_kwargs)
            with table.batch_writer() as batch:
                for item in resp.get('Items', []):
                    batch.delete_item(Key={'pk': item['pk']})
                    deleted += 1
            if 'LastEvaluatedKey' not in resp:
                break
            scan_kwargs['ExclusiveStartKey'] = resp['LastEvaluatedKey']
        return deleted

    def clear(self, key):
        self._table().delete_item(Key={'pk': key})
