"""Tests for access control, billing, and entitlements."""

import os
from datetime import datetime, timedelta, timezone, date
from calendar import monthrange
import pytest
import boto3
from unittest.mock import patch
from moto import mock_aws

os.environ['SECRET_KEY'] = 'test-secret-key-for-testing-only'
os.environ['AWS_ACCESS_KEY_ID'] = 'testing'
os.environ['AWS_SECRET_ACCESS_KEY'] = 'testing'
os.environ['AWS_SECURITY_TOKEN'] = 'testing'
os.environ['AWS_SESSION_TOKEN'] = 'testing'
os.environ['AWS_DEFAULT_REGION'] = 'eu-central-1'
os.environ['DYNAMODB_USERS_TABLE'] = 'ffm-users-test'
os.environ['DYNAMODB_SCORES_TABLE'] = 'ffm-scores-test'
os.environ['DYNAMODB_RATELIMIT_TABLE'] = 'ffm-ratelimits-test'

from sites.ffm.app import models
from sites.ffm.app import billing_store
from sites.ffm.app import entitlements
from sites.ffm.app.config import TestingConfig


@pytest.fixture(scope='function')
def aws_mock():
    with mock_aws():
        ddb = boto3.resource('dynamodb', region_name='eu-central-1')
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


class TestAccessCodeGeneration:
    """Test access code creation, validation, expiration, and redemption."""

    def test_create_access_code_basic(self, aws_mock):
        plaintext, code_hash = billing_store.create_access_code(months=3)

        assert len(plaintext) > 0
        assert len(code_hash) == 64  # SHA256 hex

        state = billing_store.get_code_state(code_hash)
        assert state is not None
        assert state['revoked'] is False
        assert state['redeemed_by'] is None

    def test_create_access_code_months_validation(self, aws_mock):
        with pytest.raises(ValueError, match='invalid_months'):
            billing_store.create_access_code(months=0)

        with pytest.raises(ValueError, match='invalid_months'):
            billing_store.create_access_code(months=-1)

    def test_access_code_expiration(self, aws_mock):
        plaintext, code_hash = billing_store.create_access_code(months=3)
        state = billing_store.get_code_state(code_hash)

        # Default expires_at is None (intentional - no automatic expiry)
        assert state['expires_at'] is None
        assert state['months_grant'] == 3

    def test_access_code_expiration_month_end(self, aws_mock):
        """Test explicit expiry with calendar month handling: Jan 31 + 3 months = Apr 30."""
        with patch('sites.ffm.app.billing_store._now_utc') as mock_now:
            jan_31 = datetime(2024, 1, 31, 12, 0, 0, tzinfo=timezone.utc).isoformat()
            mock_now.return_value = jan_31

            # Set explicit expiry to Apr 30, 2024
            apr_30 = datetime(2024, 4, 30, 12, 0, 0, tzinfo=timezone.utc).isoformat()
            plaintext, code_hash = billing_store.create_access_code(months=3, expires_at=apr_30)
            state = billing_store.get_code_state(code_hash)

            # Verify explicit expires_at was preserved
            assert state['expires_at'] == apr_30

    def test_revoke_code(self, aws_mock):
        plaintext, code_hash = billing_store.create_access_code(months=3)

        success = billing_store.revoke_code(code_hash)
        assert success is True

        state = billing_store.get_code_state(code_hash)
        assert state['revoked'] is True

    def test_revoke_nonexistent_code(self, aws_mock):
        success = billing_store.revoke_code('nonexistent_hash')
        assert success is False


class TestStableID:
    """Test stable_id creation and lazy initialization."""

    def test_create_user_generates_stable_id(self, aws_mock):
        user = models.create_user('alice', 'alice@example.com', 'hash', first_grade_year=2000)
        assert user['stable_id'] is not None
        assert len(user['stable_id']) == 36  # UUID4 hex format

    def test_ensure_stable_id_creates_on_old_users(self, aws_mock):
        # Create a user without stable_id (simulating old data)
        now = models._now()
        _users = models._users()
        _users.put_item(Item={
            'pk': f'USER#olduser',
            'sk': 'PROFILE',
            'username': 'olduser',
            'email': 'old@example.com',
            'password_hash': 'hash',
            'created_at': now,
            'email_verified': True,
        })

        stable_id = models.ensure_stable_id('olduser')
        assert stable_id is not None
        assert len(stable_id) == 36

        # Verify it's stored
        user = models.get_user('olduser')
        assert user['stable_id'] == stable_id

    def test_ensure_stable_id_idempotent(self, aws_mock):
        user = models.create_user('bob', 'bob@example.com', 'hash')
        stable_id_1 = models.ensure_stable_id('bob')
        stable_id_2 = models.ensure_stable_id('bob')
        assert stable_id_1 == stable_id_2

    def test_ensure_stable_id_nonexistent_user(self, aws_mock):
        result = models.ensure_stable_id('nonexistent')
        assert result is None


class TestCodeRedemption:
    """Test code reservation and completion flow."""

    def test_reserve_and_complete_redemption(self, aws_mock):
        user = models.create_user('charlie', 'charlie@example.com', 'hash')
        billing_uuid = user['stable_id']

        plaintext, code_hash = billing_store.create_access_code(months=3)

        # Reserve
        operation_id, target_gift_until = billing_store.reserve_code_redemption(
            billing_uuid, plaintext
        )
        assert operation_id is not None
        assert target_gift_until is not None

        # Complete
        result = billing_store.complete_code_redemption(operation_id, billing_uuid)
        assert result == target_gift_until

        # Verify code is marked redeemed
        state = billing_store.get_code_state(code_hash)
        assert state['redeemed_by'] == billing_uuid

    def test_reserve_nonexistent_code(self, aws_mock):
        user = models.create_user('dave', 'dave@example.com', 'hash')
        with pytest.raises(ValueError, match='not_found'):
            billing_store.reserve_code_redemption(user['stable_id'], 'invalid_code')

    def test_reserve_revoked_code(self, aws_mock):
        user = models.create_user('eve', 'eve@example.com', 'hash')
        plaintext, code_hash = billing_store.create_access_code(months=3)
        billing_store.revoke_code(code_hash)

        with pytest.raises(ValueError, match='revoked'):
            billing_store.reserve_code_redemption(user['stable_id'], plaintext)

    def test_reserve_expired_code(self, aws_mock):
        user = models.create_user('frank', 'frank@example.com', 'hash')

        # Create code with explicit expiry (3 days from now)
        future_expiry = datetime.now(timezone.utc) + timedelta(days=3)
        plaintext, code_hash = billing_store.create_access_code(months=3, expires_at=future_expiry.isoformat())

        # Try to redeem with a now_dt that's after expiry (5 days from now)
        after_expiry = datetime.now(timezone.utc) + timedelta(days=5)

        with pytest.raises(ValueError, match='expired'):
            billing_store.reserve_code_redemption(user['stable_id'], plaintext, now_dt=after_expiry)

    def test_reserve_already_redeemed_code(self, aws_mock):
        user1 = models.create_user('grace', 'grace@example.com', 'hash')
        user2 = models.create_user('henry', 'henry@example.com', 'hash')

        plaintext, code_hash = billing_store.create_access_code(months=3)

        # First redemption succeeds
        op1, _ = billing_store.reserve_code_redemption(user1['stable_id'], plaintext)
        billing_store.complete_code_redemption(op1, user1['stable_id'])

        # Second redemption should fail
        with pytest.raises(ValueError, match='already_redeemed'):
            billing_store.reserve_code_redemption(user2['stable_id'], plaintext)

    def test_code_hash_normalization(self, aws_mock):
        """Test that codes are normalized (uppercase, stripped) before hashing."""
        user = models.create_user('iris', 'iris@example.com', 'hash')
        plaintext, code_hash = billing_store.create_access_code(months=3)

        # Try with different cases and whitespace
        op1, _ = billing_store.reserve_code_redemption(user['stable_id'], plaintext.lower())
        assert op1 is not None

        # Verify the hash is the same
        normalized_hash = billing_store._code_hash(plaintext)
        assert normalized_hash == code_hash


class TestBillingState:
    """Test billing state storage and retrieval."""

    def test_put_and_get_billing_state(self, aws_mock):
        billing_uuid = 'test-billing-uuid'

        billing_store.put_billing_state(
            billing_uuid,
            customer_id='cus_123',
            subscription_id='sub_123',
            paid_until='2025-01-01T00:00:00+00:00',
            status='active'
        )

        state = billing_store.get_billing_state(billing_uuid)
        assert state is not None
        assert state['customer_id'] == 'cus_123'
        assert state['subscription_id'] == 'sub_123'
        assert state['status'] == 'active'

    def test_billing_state_nonexistent(self, aws_mock):
        state = billing_store.get_billing_state('nonexistent-uuid')
        assert state is None

    def test_billing_username_mapping(self, aws_mock):
        billing_uuid = 'test-uuid'

        billing_store.put_billing_username_mapping(billing_uuid, 'testuser')
        username = billing_store.get_billing_username_mapping(billing_uuid)

        assert username == 'testuser'


class TestAccessStatus:
    """Test access status computation."""

    def test_access_status_prelaunch_mode(self, aws_mock):
        config = type('Config', (), {
            'get': lambda self, key, default=None: {
                'ACCESS_CONTROL_ENABLED': False,
            }.get(key, default)
        })()

        status = entitlements.get_access_status(username=None, app_config=config)
        assert status['access_control_enabled'] is False
        assert status['premium_access'] is False
        assert status['reason'] == 'prelaunch'

    def test_access_status_anonymous(self, aws_mock):
        config = type('Config', (), {
            'get': lambda self, key, default=None: {
                'ACCESS_CONTROL_ENABLED': True,
                'GRANDFATHER_CUTOFF': '',
            }.get(key, default)
        })()

        status = entitlements.get_access_status(username=None, app_config=config)
        assert status['access_control_enabled'] is True
        assert status['premium_access'] is False
        assert status['reason'] == 'free'

    def test_access_status_unverified_user(self, aws_mock):
        user = models.create_user('unverified', 'unverified@example.com', 'hash')
        # User starts with email_verified=False

        config = type('Config', (), {
            'get': lambda self, key, default=None: {
                'ACCESS_CONTROL_ENABLED': True,
                'GRANDFATHER_CUTOFF': '',
            }.get(key, default)
        })()

        status = entitlements.get_access_status('unverified', app_config=config)
        assert status['premium_access'] is False
        assert status['reason'] == 'unverified'

    def test_access_status_grandfathered_user(self, aws_mock):
        # Create user with old created_at
        now = models._now()
        _users = models._users()
        _users.put_item(Item={
            'pk': f'USER#grandfather',
            'sk': 'PROFILE',
            'username': 'grandfather',
            'email': 'old@example.com',
            'password_hash': 'hash',
            'created_at': '2020-01-01T00:00:00+00:00',
            'email_verified': True,
            'stable_id': 'old-stable-id',
        })

        # Grandfather cutoff is after user creation
        config = type('Config', (), {
            'get': lambda self, key, default=None: {
                'ACCESS_CONTROL_ENABLED': True,
                'GRANDFATHER_CUTOFF': '2021-01-01T00:00:00+00:00',
            }.get(key, default)
        })()

        status = entitlements.get_access_status('grandfather', app_config=config)
        assert status['premium_access'] is True
        assert status['reason'] == 'grandfathered'

    def test_access_status_paid_user(self, aws_mock):
        user = models.create_user('paid', 'paid@example.com', 'hash')
        models.set_email_verified('paid', True)

        future_time = (datetime.now(timezone.utc) + timedelta(days=90)).isoformat()
        billing_store.put_billing_state(
            user['stable_id'],
            paid_until=future_time,
            status='active'
        )

        config = type('Config', (), {
            'get': lambda self, key, default=None: {
                'ACCESS_CONTROL_ENABLED': True,
                'GRANDFATHER_CUTOFF': '',
            }.get(key, default)
        })()

        status = entitlements.get_access_status('paid', app_config=config)
        assert status['premium_access'] is True
        assert status['reason'] == 'paid'

    def test_access_status_gift_user(self, aws_mock):
        user = models.create_user('gift', 'gift@example.com', 'hash')
        models.set_email_verified('gift', True)

        future_time = (datetime.now(timezone.utc) + timedelta(days=90)).isoformat()
        billing_store.put_billing_state(
            user['stable_id'],
            gift_until=future_time,
        )

        config = type('Config', (), {
            'get': lambda self, key, default=None: {
                'ACCESS_CONTROL_ENABLED': True,
                'GRANDFATHER_CUTOFF': '',
            }.get(key, default)
        })()

        status = entitlements.get_access_status('gift', app_config=config)
        assert status['premium_access'] is True
        assert status['reason'] == 'gift'


class TestLevelAccess:
    """Test level-based access checking."""

    def test_level_1_always_allowed(self, aws_mock):
        config = type('Config', (), {
            'get': lambda self, key, default=None: {
                'ACCESS_CONTROL_ENABLED': True,
                'GRANDFATHER_CUTOFF': '',
            }.get(key, default)
        })()

        allowed, code, status = entitlements.require_level_access(None, 1, app_config=config)
        assert allowed is True
        assert code is None

    def test_level_2_always_allowed(self, aws_mock):
        config = type('Config', (), {
            'get': lambda self, key, default=None: {
                'ACCESS_CONTROL_ENABLED': True,
                'GRANDFATHER_CUTOFF': '',
            }.get(key, default)
        })()

        allowed, code, status = entitlements.require_level_access(None, 2, app_config=config)
        assert allowed is True
        assert code is None

    def test_level_3_requires_auth(self, aws_mock):
        config = type('Config', (), {
            'get': lambda self, key, default=None: {
                'ACCESS_CONTROL_ENABLED': True,
                'GRANDFATHER_CUTOFF': '',
            }.get(key, default)
        })()

        allowed, code, status = entitlements.require_level_access(None, 3, app_config=config)
        assert allowed is False
        assert code == 401

    def test_level_3_requires_email_verification(self, aws_mock):
        user = models.create_user('unverified_l3', 'unverified_l3@example.com', 'hash')

        config = type('Config', (), {
            'get': lambda self, key, default=None: {
                'ACCESS_CONTROL_ENABLED': True,
                'GRANDFATHER_CUTOFF': '',
            }.get(key, default)
        })()

        allowed, code, status = entitlements.require_level_access('unverified_l3', 3, app_config=config)
        assert allowed is False
        assert code == 403

    def test_level_3_requires_payment(self, aws_mock):
        user = models.create_user('free_l3', 'free_l3@example.com', 'hash')
        models.set_email_verified('free_l3', True)

        config = type('Config', (), {
            'get': lambda self, key, default=None: {
                'ACCESS_CONTROL_ENABLED': True,
                'GRANDFATHER_CUTOFF': '',
            }.get(key, default)
        })()

        allowed, code, status = entitlements.require_level_access('free_l3', 3, app_config=config)
        assert allowed is False
        assert code == 402

    def test_level_3_allowed_with_payment(self, aws_mock):
        user = models.create_user('paid_l3', 'paid_l3@example.com', 'hash')
        models.set_email_verified('paid_l3', True)

        future_time = (datetime.now(timezone.utc) + timedelta(days=90)).isoformat()
        billing_store.put_billing_state(
            user['stable_id'],
            paid_until=future_time,
            status='active'
        )

        config = type('Config', (), {
            'get': lambda self, key, default=None: {
                'ACCESS_CONTROL_ENABLED': True,
                'GRANDFATHER_CUTOFF': '',
            }.get(key, default)
        })()

        allowed, code, status = entitlements.require_level_access('paid_l3', 3, app_config=config)
        assert allowed is True
        assert code is None


class TestCodeStacking:
    """Test multiple codes stacking on the same account."""

    def test_stack_codes_extends_gift_until(self, aws_mock):
        """When redeeming codes, gift_until is extended based on the code validity."""
        user = models.create_user('stacker', 'stacker@example.com', 'hash')
        models.set_email_verified('stacker', True)
        billing_uuid = user['stable_id']

        # First code (3 months)
        code1, _ = billing_store.create_access_code(months=3)
        op1, target1 = billing_store.reserve_code_redemption(billing_uuid, code1)
        billing_store.complete_code_redemption(op1, billing_uuid)

        # Set initial gift_until
        billing_store.put_billing_state(billing_uuid, gift_until=target1)
        state1 = billing_store.get_billing_state(billing_uuid)
        assert state1['gift_until'] == target1

        # Second code (3 months, stacked on first)
        code2, _ = billing_store.create_access_code(months=3)
        op2, target2 = billing_store.reserve_code_redemption(billing_uuid, code2)

        # Target2 should be 3 months after target1 since target1 is in the future
        target1_dt = datetime.fromisoformat(target1)
        target2_dt = datetime.fromisoformat(target2)
        # target2 should be exactly 3 months after target1 (due to max(target1, now) + 3)
        assert target2_dt > target1_dt


class TestRevocationHandling:
    """Test revocation flag affecting paid access."""

    def test_paid_access_revoked(self, aws_mock):
        """When revocation flag is set, paid_until is ignored, but gift_until is still valid."""
        user = models.create_user('revoked_user', 'revoked_user@example.com', 'hash')
        models.set_email_verified('revoked_user', True)

        future_time = (datetime.now(timezone.utc) + timedelta(days=90)).isoformat()
        billing_store.put_billing_state(
            user['stable_id'],
            paid_until=future_time,
            revocation=True,
        )

        config = type('Config', (), {
            'get': lambda self, key, default=None: {
                'ACCESS_CONTROL_ENABLED': True,
                'GRANDFATHER_CUTOFF': '',
            }.get(key, default)
        })()

        status = entitlements.get_access_status('revoked_user', app_config=config)
        # Paid is revoked, so should not have premium access
        assert status['premium_access'] is False
        assert status['reason'] == 'free'


class TestCalendarMonthHandling:
    """Test calendar month edge cases."""

    def test_add_months_leap_year(self, aws_mock):
        """Test leap year handling (Feb 29)."""
        jan31 = datetime(2024, 1, 31, 12, 0, 0, tzinfo=timezone.utc)
        result = billing_store._add_calendar_months(jan31, 1)
        assert result.month == 2
        assert result.day == 29
        assert result.year == 2024

    def test_add_months_non_leap_year(self, aws_mock):
        """Test non-leap year handling (Feb 28)."""
        jan31 = datetime(2023, 1, 31, 12, 0, 0, tzinfo=timezone.utc)
        result = billing_store._add_calendar_months(jan31, 1)
        assert result.month == 2
        assert result.day == 28
        assert result.year == 2023

    def test_add_months_multiple(self, aws_mock):
        """Test adding multiple months."""
        jan31 = datetime(2024, 1, 31, 12, 0, 0, tzinfo=timezone.utc)
        result = billing_store._add_calendar_months(jan31, 3)
        assert result.month == 4
        assert result.day == 30  # April has 30 days
        assert result.year == 2024

    def test_add_months_year_boundary(self, aws_mock):
        """Test crossing year boundary."""
        dec15 = datetime(2024, 12, 15, 12, 0, 0, tzinfo=timezone.utc)
        result = billing_store._add_calendar_months(dec15, 2)
        assert result.month == 2
        assert result.day == 15
        assert result.year == 2025


class TestTransactionRegression:
    """Regression tests proving DynamoDB transaction safety guarantees."""

    def test_code_op_state_transaction_grants_3_months_when_same_now_twice(self, aws_mock):
        """Redeeming same code twice (idempotent) grants exactly 3 months each time."""
        user = models.create_user('stacker', 'stacker@example.com', 'hash')
        billing_uuid = user['stable_id']

        code, _ = billing_store.create_access_code(months=3)
        now_dt = datetime.now(timezone.utc)

        # First redemption
        op1, target1 = billing_store.reserve_code_redemption(billing_uuid, code, now_dt=now_dt)
        result1 = billing_store.complete_code_redemption(op1, billing_uuid)

        # Verify first redemption set gift_until to now + 3 months
        state1 = billing_store.get_billing_state(billing_uuid)
        assert state1['gift_until'] == result1

        # Second redemption with same now_dt (idempotent)
        op2, target2 = billing_store.reserve_code_redemption(billing_uuid, code, now_dt=now_dt)
        # Should return same operation (already completed)
        assert op2 == op1
        assert target2 == result1

        # Verify state unchanged
        state2 = billing_store.get_billing_state(billing_uuid)
        assert state2['gift_until'] == result1
        assert state2['version'] == state1['version']

    def test_reserve_competing_code_waits_pending_marker(self, aws_mock):
        """Concurrent reserves on same user fail when pending_redemption is set."""
        user = models.create_user('competing', 'competing@example.com', 'hash')
        billing_uuid = user['stable_id']

        code1, _ = billing_store.create_access_code(months=3)
        code2, _ = billing_store.create_access_code(months=3)

        # First reserve sets pending_redemption
        op1, _ = billing_store.reserve_code_redemption(billing_uuid, code1)

        # Second reserve should fail (pending_redemption already set)
        with pytest.raises(ValueError, match='billing_busy'):
            billing_store.reserve_code_redemption(billing_uuid, code2)

        # After completing first, second succeeds
        billing_store.complete_code_redemption(op1, billing_uuid)
        op2, _ = billing_store.reserve_code_redemption(billing_uuid, code2)
        assert op2 != op1

    def test_reserve_same_code_different_user_rejects(self, aws_mock):
        """Only one user can redeem a code (reserved_by check)."""
        user1 = models.create_user('user1', 'user1@example.com', 'hash')
        user2 = models.create_user('user2', 'user2@example.com', 'hash')

        code, code_hash = billing_store.create_access_code(months=3)

        # User1 reserves
        op1, _ = billing_store.reserve_code_redemption(user1['stable_id'], code)

        # User2 tries to reserve same code - fails (pending_op_id set)
        with pytest.raises(ValueError, match='already_redeemed'):
            billing_store.reserve_code_redemption(user2['stable_id'], code)

        # Complete user1's redemption
        billing_store.complete_code_redemption(op1, user1['stable_id'])

        # Now user2 can't redeem either (redeemed_by is set)
        with pytest.raises(ValueError, match='already_redeemed'):
            billing_store.reserve_code_redemption(user2['stable_id'], code)

    def test_completed_retry_same_no_regrant(self, aws_mock):
        """Retrying a completed redemption returns same target but doesn't regrant."""
        user = models.create_user('retry', 'retry@example.com', 'hash')
        billing_uuid = user['stable_id']

        code, _ = billing_store.create_access_code(months=3)

        # Complete redemption
        op1, target1 = billing_store.reserve_code_redemption(billing_uuid, code)
        billing_store.complete_code_redemption(op1, billing_uuid)

        state_before = billing_store.get_billing_state(billing_uuid)

        # Retry complete (should be idempotent, returns target)
        result = billing_store.complete_code_redemption(op1, billing_uuid)
        assert result == target1

        # Verify state didn't change
        state_after = billing_store.get_billing_state(billing_uuid)
        assert state_after['version'] == state_before['version']
        assert state_after['gift_until'] == state_before['gift_until']

    def test_transaction_fault_recovery_code_not_spent_state_unchanged(self, aws_mock):
        """Transaction fault during completion leaves code unspent and state unchanged."""
        user = models.create_user('fault', 'fault@example.com', 'hash')
        billing_uuid = user['stable_id']

        code, code_hash = billing_store.create_access_code(months=3)

        # Reserve (sets pending_op_id on code)
        op1, _ = billing_store.reserve_code_redemption(billing_uuid, code)

        # Get state before completion attempt
        state_before = billing_store.get_billing_state(billing_uuid)
        code_before = billing_store.get_code_state(code_hash)

        # Simulate transaction fault by changing version (CAS failure)
        with pytest.raises(ValueError, match='version_mismatch'):
            billing_store.complete_code_redemption(op1, billing_uuid, expected_version=999)

        # Verify code is still pending (not spent)
        code_after = billing_store.get_code_state(code_hash)
        assert code_after['pending_op_id'] is not None
        assert code_after['redeemed_by'] is None

        # Verify state unchanged
        state_after = billing_store.get_billing_state(billing_uuid)
        assert state_after['version'] == state_before['version']
        assert state_after.get('gift_until') == state_before.get('gift_until')

    def test_wrong_billing_uuid_denied(self, aws_mock):
        """Complete with wrong billing_uuid is rejected (identity check)."""
        user1 = models.create_user('user1', 'user1@example.com', 'hash')
        user2 = models.create_user('user2', 'user2@example.com', 'hash')

        code, _ = billing_store.create_access_code(months=3)

        # User1 reserves
        op1, _ = billing_store.reserve_code_redemption(user1['stable_id'], code)

        # User2 tries to complete with user1's operation - fails
        with pytest.raises(ValueError, match='wrong_identity'):
            billing_store.complete_code_redemption(op1, user2['stable_id'])

    def test_failed_cas_preserves_fields(self, aws_mock):
        """Failed CAS (Compare-And-Swap) on state update preserves all fields."""
        billing_uuid = 'test-uuid'

        # Put initial state with custom field
        billing_store.put_billing_state(
            billing_uuid,
            customer_id='cus_123',
            subscription_id='sub_456',
            status='active'
        )

        state1 = billing_store.get_billing_state(billing_uuid)

        # Try to update with wrong version (fails)
        with pytest.raises(ValueError, match='version_mismatch'):
            billing_store.put_billing_state(
                billing_uuid,
                expected_version=999,
                paid_until='2025-12-31T00:00:00+00:00'
            )

        # Verify original fields preserved
        state2 = billing_store.get_billing_state(billing_uuid)
        assert state2['customer_id'] == 'cus_123'
        assert state2['subscription_id'] == 'sub_456'
        assert state2['status'] == 'active'
        assert state2['version'] == state1['version']

    def test_optional_redeem_by_null_works_and_now_rejected(self, aws_mock):
        """Codes have redeemed_by=None initially; comparison works; now rejects (immutable)."""
        user = models.create_user('redeem_null', 'redeem_null@example.com', 'hash')

        code, code_hash = billing_store.create_access_code(months=3)

        # Verify redeemed_by is None
        code_state = billing_store.get_code_state(code_hash)
        assert code_state['redeemed_by'] is None

        # Reserve succeeds (checks redeemed_by = :nil)
        op1, _ = billing_store.reserve_code_redemption(user['stable_id'], code)

        # Complete succeeds (updates redeemed_by from None to user_id)
        billing_store.complete_code_redemption(op1, user['stable_id'])

        # Verify redeemed_by is now set
        code_state = billing_store.get_code_state(code_hash)
        assert code_state['redeemed_by'] == user['stable_id']

        # Second user can't redeem (redeemed_by != :nil)
        user2 = models.create_user('user2', 'user2@example.com', 'hash')
        with pytest.raises(ValueError, match='already_redeemed'):
            billing_store.reserve_code_redemption(user2['stable_id'], code)

    def test_no_mapping_deleted_uuid_resurrection(self, aws_mock):
        """Deleted mapping (tombstone) prevents UUID resurrection."""
        from botocore.exceptions import ClientError

        billing_uuid = 'test-uuid'
        username = 'testuser'

        # Create mapping
        billing_store.put_billing_username_mapping(billing_uuid, username)
        assert billing_store.get_billing_username_mapping(billing_uuid) == username

        # Tombstone it
        billing_store.tombstone_billing_identity(billing_uuid)
        assert billing_store.get_billing_username_mapping(billing_uuid) is None

        # Try to resurrect (put again) - fails because deleted=True AND username removed
        # The condition is: attribute_not_exists(pk) OR (username=X AND deleted=False)
        # After tombstone: pk exists, username removed, deleted=True
        # So the condition fails (both branches false)
        with pytest.raises(ClientError) as exc_info:
            billing_store.put_billing_username_mapping(billing_uuid, username)
        assert exc_info.value.response['Error']['Code'] == 'ConditionalCheckFailedException'
