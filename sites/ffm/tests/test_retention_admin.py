"""Tests for the data-retention cleanup CLI (app/retention_admin.py), the
daily scheduled-worker entry point (retention_admin.run_scheduled_cleanup)
invoked by the EventBridge-triggered Lambda, and the underlying
model/store functions (models.find_expired_tokens / delete_token_item,
cancel_requests_store.list_purgeable_cancel_requests /
delete_cancel_request / set_legal_hold / PurgeConflict).

Covers the approved retention policy:
- Verification/reset/email-change tokens are physically removed once
  expired (consumption already deletes them immediately — see
  test_auth_token_security.py / models.consume_token).
- Completed ("fulfilled"/"no_subscription") cancellation-request records
  are only purgeable 3 years after the end of the calendar year the case
  was closed in; still-open cases and any record under legal hold are
  never purgeable, however old.
- Both delete_token_item and delete_cancel_request are conditional on a
  snapshot (expires_at / status+processed_at+legal_hold) observed at
  listing time, so a race (consumption, reprocessing, or a legal hold set
  in between) is detected and reported as a skip/PurgeConflict, never
  silently treated as success and never allowed to recreate or corrupt a
  record.
- Every CLI command here is dry-run unless --confirm is passed, and never
  touches anything outside its own scope (no Stripe/billing_store access).
"""

import os
import json
from datetime import datetime, timedelta, timezone

import pytest
import boto3
from click.testing import CliRunner
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

from sites.ffm.app import create_app, models, cancel_requests_store as cancel_store, retention_admin
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


@pytest.fixture
def app(aws_mock):
    return create_app(TestingConfig)


def _make_request(username='alice', contact_email='c@example.com', **overrides):
    fields = {
        'contact_email': contact_email, 'account_email': 'alice@example.com',
        'username': username, 'stripe_reference': None,
        'cancellation_type': 'earliest', 'requested_date': None, 'reason': 'test',
    }
    fields.update(overrides)
    request_id = overrides.pop('request_id', None) or f'req-{username}-{contact_email}'
    item, _created = cancel_store.create_cancel_request(request_id, 'hash-' + request_id, fields, 'submitted')
    return item


# ============ models.find_expired_tokens / delete_token_item ============

def test_find_expired_tokens_only_returns_past_expiry(app):
    with app.app_context():
        token_live = models.create_token('alice', 'verify_email', ttl_seconds=3600)
        token_expired = models.create_token('bob', 'reset_password', ttl_seconds=-10)
        expired = models.find_expired_tokens()
        expired_pks = {item['pk'] for item in expired}
        assert f"TOKEN#{models._token_hash(token_expired)}" in expired_pks
        assert f"TOKEN#{models._token_hash(token_live)}" not in expired_pks


def test_find_expired_tokens_excludes_already_consumed(app):
    with app.app_context():
        token = models.create_token('alice', 'verify_email', ttl_seconds=-10)
        # Simulate it having already been consumed (deleted) before cleanup runs.
        pk = f"TOKEN#{models._token_hash(token)}"
        [item] = [i for i in models.find_expired_tokens() if i['pk'] == pk]
        models.delete_token_item(pk, item['expires_at'])
        assert models.find_expired_tokens() == []


def test_delete_token_item_removes_row(app):
    with app.app_context():
        token = models.create_token('alice', 'reset_password', ttl_seconds=-10)
        pk = f"TOKEN#{models._token_hash(token)}"
        [item] = [i for i in models.find_expired_tokens() if i['pk'] == pk]
        assert models.delete_token_item(pk, item['expires_at']) is True
        assert not any(i['pk'] == pk for i in models.find_expired_tokens())


def test_delete_token_item_rejects_non_token_pk(app):
    with app.app_context():
        with pytest.raises(ValueError):
            models.delete_token_item('USER#alice', 'irrelevant')


def test_delete_token_item_conditional_skips_if_already_gone(app):
    """Simulates the race with consume_token/a previous cleanup run:
    the snapshot's expires_at no longer matches (because the row is
    already gone), so the conditional delete must report False, not
    raise or silently treat it as deleted."""
    with app.app_context():
        token = models.create_token('alice', 'reset_password', ttl_seconds=-10)
        pk = f"TOKEN#{models._token_hash(token)}"
        [item] = [i for i in models.find_expired_tokens() if i['pk'] == pk]
        models.delete_token_item(pk, item['expires_at'])
        assert models.delete_token_item(pk, item['expires_at']) is False


# ============ cancel_requests_store retention helpers ============

def test_open_requests_never_purgeable(app):
    with app.app_context():
        _make_request(request_id='open-1')
        assert cancel_store.list_purgeable_cancel_requests() == []


def test_completed_request_not_purgeable_before_cutoff(app):
    with app.app_context():
        item = _make_request(request_id='recent-1')
        cancel_store.start_processing('recent-1', 'alice', 'sid-1', None)
        cancel_store.finalize('recent-1', 'no_subscription', {'note': 'no sub'})
        now = datetime.now(timezone.utc)
        assert cancel_store.list_purgeable_cancel_requests(now=now) == []


def test_completed_request_purgeable_after_cutoff(app):
    with app.app_context():
        _make_request(request_id='old-1')
        cancel_store.start_processing('old-1', 'alice', 'sid-1', None)
        cancel_store.finalize('old-1', 'no_subscription', {'note': 'no sub'})
        # processed_at was just set to "now"; simulate it having been
        # processed at the end of 2020 instead, so the Jan-1-2025 cutoff
        # has long passed.
        models._users().update_item(
            Key={'pk': 'CANCELREQUEST#old-1', 'sk': 'REQUEST'},
            UpdateExpression='SET processed_at = :p',
            ExpressionAttributeValues={':p': '2020-12-31T23:59:59+00:00'},
        )
        eligible = cancel_store.list_purgeable_cancel_requests(now=datetime(2026, 1, 2, tzinfo=timezone.utc))
        assert {i['request_id'] for i in eligible} == {'old-1'}
        # processed_at falls in 2020, so the cutoff is Jan 1, 2024 (end of
        # 2020 + 3 full years). Exactly at that boundary it must already be
        # eligible...
        assert cancel_store.list_purgeable_cancel_requests(now=datetime(2024, 1, 1, tzinfo=timezone.utc))
        # ...but a day before it must not be.
        assert not cancel_store.list_purgeable_cancel_requests(now=datetime(2023, 12, 31, tzinfo=timezone.utc))


def test_legal_hold_blocks_purge_regardless_of_age(app):
    with app.app_context():
        _make_request(request_id='held-1')
        cancel_store.start_processing('held-1', 'alice', 'sid-1', None)
        cancel_store.finalize('held-1', 'no_subscription', {'note': 'no sub'})
        models._users().update_item(
            Key={'pk': 'CANCELREQUEST#held-1', 'sk': 'REQUEST'},
            UpdateExpression='SET processed_at = :p',
            ExpressionAttributeValues={':p': '2015-01-01T00:00:00+00:00'},
        )
        cancel_store.set_legal_hold('held-1', hold=True)
        assert cancel_store.list_purgeable_cancel_requests(now=datetime(2026, 1, 1, tzinfo=timezone.utc)) == []
        cancel_store.set_legal_hold('held-1', hold=False)
        assert cancel_store.list_purgeable_cancel_requests(now=datetime(2026, 1, 1, tzinfo=timezone.utc))


def test_set_legal_hold_raises_for_unknown_request(app):
    with app.app_context():
        with pytest.raises(ValueError):
            cancel_store.set_legal_hold('does-not-exist', hold=True)
        # Must not have been silently created as a side effect of the
        # conditional update that raised above.
        assert cancel_store.get_cancel_request('does-not-exist') is None


def test_delete_cancel_request_removes_row(app):
    with app.app_context():
        _make_request(request_id='del-1')
        cancel_store.start_processing('del-1', 'alice', 'sid-1', None)
        cancel_store.finalize('del-1', 'no_subscription', {})
        models._users().update_item(
            Key={'pk': 'CANCELREQUEST#del-1', 'sk': 'REQUEST'},
            UpdateExpression='SET processed_at = :p',
            ExpressionAttributeValues={':p': '2015-01-01T00:00:00+00:00'},
        )
        item = cancel_store.get_cancel_request('del-1')
        cancel_store.delete_cancel_request('del-1', item['status'], item.get('processed_at'))
        assert cancel_store.get_cancel_request('del-1') is None


def test_delete_cancel_request_rejects_open_or_recent_case(app):
    with app.app_context():
        item = _make_request(request_id='keep-1')
        with pytest.raises(ValueError, match='request_not_completed'):
            cancel_store.delete_cancel_request('keep-1', item['status'], item.get('processed_at'))
        cancel_store.start_processing('keep-1', 'alice', 'sid-1', None)
        cancel_store.finalize('keep-1', 'no_subscription', {})
        item = cancel_store.get_cancel_request('keep-1')
        with pytest.raises(ValueError, match='retention_period_not_elapsed'):
            cancel_store.delete_cancel_request('keep-1', item['status'], item['processed_at'])
        assert cancel_store.get_cancel_request('keep-1') is not None


def test_delete_token_item_rejects_unexpired_token(app):
    with app.app_context():
        token = models.create_token('alice', 'reset_password', ttl_seconds=3600)
        pk = f"TOKEN#{models._token_hash(token)}"
        item = models._users().get_item(Key={'pk': pk, 'sk': 'T'})['Item']
        with pytest.raises(ValueError, match='unexpired'):
            models.delete_token_item(pk, item['expires_at'])
        assert models._users().get_item(Key={'pk': pk, 'sk': 'T'}).get('Item')


@pytest.mark.parametrize('scope', ['tokens', 'cancel_requests'])
def test_scheduled_cleanup_propagates_delete_failure(app, monkeypatch, scope):
    from sites.ffm.app import retention_admin

    def fail_delete(*args):
        raise RuntimeError('storage unavailable')

    with app.app_context():
        if scope == 'tokens':
            models.create_token('alice', 'reset_password', ttl_seconds=-10)
            monkeypatch.setattr(models, 'delete_token_item', fail_delete)
        else:
            monkeypatch.setattr(cancel_store, 'list_purgeable_cancel_requests', lambda: [{
                'request_id': 'failed-1', 'status': 'fulfilled',
                'processed_at': '2015-01-01T00:00:00+00:00',
            }])
            monkeypatch.setattr(cancel_store, 'delete_cancel_request', fail_delete)
        with pytest.raises(RuntimeError, match='storage unavailable'):
            retention_admin.run_scheduled_cleanup()


def test_delete_cancel_request_conflict_if_legal_hold_set_since_snapshot(app):
    """The exact race the conditional delete exists to close: an operator
    sets a legal hold between list_purgeable_cancel_requests() returning a
    snapshot and the caller acting on it. The delete must raise
    PurgeConflict — not delete the record, and not silently no-op."""
    with app.app_context():
        _make_request(request_id='race-1')
        cancel_store.start_processing('race-1', 'alice', 'sid-1', None)
        cancel_store.finalize('race-1', 'no_subscription', {'note': 'no sub'})
        models._users().update_item(
            Key={'pk': 'CANCELREQUEST#race-1', 'sk': 'REQUEST'},
            UpdateExpression='SET processed_at = :p',
            ExpressionAttributeValues={':p': '2015-01-01T00:00:00+00:00'},
        )
        [snapshot] = cancel_store.list_purgeable_cancel_requests(now=datetime(2026, 1, 1, tzinfo=timezone.utc))
        # Legal hold set after the snapshot was taken, before the delete runs.
        cancel_store.set_legal_hold('race-1', hold=True)
        with pytest.raises(cancel_store.PurgeConflict):
            cancel_store.delete_cancel_request('race-1', snapshot['status'], snapshot.get('processed_at'))
        assert cancel_store.get_cancel_request('race-1') is not None


def test_delete_cancel_request_conflict_if_processed_at_changed_since_snapshot(app):
    with app.app_context():
        _make_request(request_id='race-2')
        cancel_store.start_processing('race-2', 'alice', 'sid-1', None)
        cancel_store.finalize('race-2', 'no_subscription', {'note': 'no sub'})
        models._users().update_item(
            Key={'pk': 'CANCELREQUEST#race-2', 'sk': 'REQUEST'},
            UpdateExpression='SET processed_at = :p',
            ExpressionAttributeValues={':p': '2015-01-01T00:00:00+00:00'},
        )
        with pytest.raises(cancel_store.PurgeConflict):
            cancel_store.delete_cancel_request('race-2', 'no_subscription', '2010-01-01T00:00:00+00:00')
        assert cancel_store.get_cancel_request('race-2') is not None


# ============ CLI: flask retention-admin tokens ============

def test_cli_tokens_dry_run_lists_without_deleting(app):
    runner = CliRunner()
    with app.app_context():
        token = models.create_token('alice', 'reset_password', ttl_seconds=-10)
        pk = f"TOKEN#{models._token_hash(token)}"
        result = runner.invoke(app.cli, ['retention-admin', 'tokens'])
        assert result.exit_code == 0
        assert 'would be deleted' in result.output
        assert any(item['pk'] == pk for item in models.find_expired_tokens())


def test_cli_tokens_confirm_deletes(app):
    runner = CliRunner()
    with app.app_context():
        token = models.create_token('alice', 'reset_password', ttl_seconds=-10)
        pk = f"TOKEN#{models._token_hash(token)}"
        result = runner.invoke(app.cli, ['retention-admin', 'tokens', '--confirm'])
        assert result.exit_code == 0
        assert 'Deleted 1 expired token' in result.output
        assert not any(item['pk'] == pk for item in models.find_expired_tokens())


def test_cli_tokens_no_expired_tokens_reports_cleanly(app):
    runner = CliRunner()
    with app.app_context():
        models.create_token('alice', 'verify_email', ttl_seconds=3600)
        result = runner.invoke(app.cli, ['retention-admin', 'tokens'])
        assert result.exit_code == 0
        assert 'No expired' in result.output


# ============ CLI: flask retention-admin cancel-requests ============

def test_cli_cancel_requests_dry_run_lists_without_deleting(app):
    runner = CliRunner()
    with app.app_context():
        _make_request(request_id='cli-old-1')
        cancel_store.start_processing('cli-old-1', 'alice', 'sid-1', None)
        cancel_store.finalize('cli-old-1', 'no_subscription', {'note': 'no sub'})
        models._users().update_item(
            Key={'pk': 'CANCELREQUEST#cli-old-1', 'sk': 'REQUEST'},
            UpdateExpression='SET processed_at = :p',
            ExpressionAttributeValues={':p': '2015-01-01T00:00:00+00:00'},
        )
        result = runner.invoke(app.cli, ['retention-admin', 'cancel-requests'])
        assert result.exit_code == 0
        assert 'cli-old-1' in result.output
        assert 'would be deleted' in result.output
        assert cancel_store.get_cancel_request('cli-old-1') is not None


def test_cli_cancel_requests_confirm_deletes_only_eligible(app):
    runner = CliRunner()
    with app.app_context():
        _make_request(request_id='cli-old-2')
        cancel_store.start_processing('cli-old-2', 'alice', 'sid-1', None)
        cancel_store.finalize('cli-old-2', 'no_subscription', {'note': 'no sub'})
        models._users().update_item(
            Key={'pk': 'CANCELREQUEST#cli-old-2', 'sk': 'REQUEST'},
            UpdateExpression='SET processed_at = :p',
            ExpressionAttributeValues={':p': '2015-01-01T00:00:00+00:00'},
        )
        _make_request(request_id='cli-open-1')  # still "submitted" — must survive
        result = runner.invoke(app.cli, ['retention-admin', 'cancel-requests', '--confirm'])
        assert result.exit_code == 0
        assert 'Deleted 1 completed cancellation-request record' in result.output
        assert cancel_store.get_cancel_request('cli-old-2') is None
        assert cancel_store.get_cancel_request('cli-open-1') is not None


def test_cli_cancel_requests_none_eligible_reports_cleanly(app):
    runner = CliRunner()
    with app.app_context():
        _make_request(request_id='cli-open-2')
        result = runner.invoke(app.cli, ['retention-admin', 'cancel-requests'])
        assert result.exit_code == 0
        assert 'No completed cancellation-request records are past their retention period.' in result.output


def test_cli_cancel_requests_confirm_reports_skip_for_legal_hold_race(app, monkeypatch):
    """A legal hold gets set concurrently, after this run's own listing
    snapshot but immediately before its conditional delete executes
    (simulated here since CliRunner's single invocation can't interleave
    a real concurrent operator action). The CLI must report it as
    skipped, not silently report full success."""
    runner = CliRunner()
    with app.app_context():
        _make_request(request_id='cli-race-1')
        cancel_store.start_processing('cli-race-1', 'alice', 'sid-1', None)
        cancel_store.finalize('cli-race-1', 'no_subscription', {'note': 'no sub'})
        models._users().update_item(
            Key={'pk': 'CANCELREQUEST#cli-race-1', 'sk': 'REQUEST'},
            UpdateExpression='SET processed_at = :p',
            ExpressionAttributeValues={':p': '2015-01-01T00:00:00+00:00'},
        )
        original_delete = cancel_store.delete_cancel_request

        def _hold_then_delete(request_id, expected_status, expected_processed_at):
            models._users().update_item(
                Key={'pk': f'CANCELREQUEST#{request_id}', 'sk': 'REQUEST'},
                UpdateExpression='SET legal_hold = :h',
                ExpressionAttributeValues={':h': True},
            )
            return original_delete(request_id, expected_status, expected_processed_at)

        monkeypatch.setattr(cancel_store, 'delete_cancel_request', _hold_then_delete)
        result = runner.invoke(app.cli, ['retention-admin', 'cancel-requests', '--confirm'])
        assert result.exit_code == 0
        assert 'Deleted 0 completed cancellation-request record' in result.output
        assert 'Skipped 1 record' in result.output
        assert cancel_store.get_cancel_request('cli-race-1') is not None


# ============ CLI: billing-admin cancel-request legal-hold ============

def test_cli_legal_hold_set_and_lift(app):
    runner = CliRunner()
    with app.app_context():
        _make_request(request_id='hold-cli-1')
        result = runner.invoke(app.cli, ['billing-admin', 'cancel-request', 'legal-hold', 'hold-cli-1'])
        assert result.exit_code == 0
        assert cancel_store.get_cancel_request('hold-cli-1')['legal_hold'] is True

        result = runner.invoke(app.cli, ['billing-admin', 'cancel-request', 'legal-hold', 'hold-cli-1', '--lift'])
        assert result.exit_code == 0
        assert cancel_store.get_cancel_request('hold-cli-1')['legal_hold'] is False


def test_cli_legal_hold_unknown_request_errors(app):
    runner = CliRunner()
    with app.app_context():
        result = runner.invoke(app.cli, ['billing-admin', 'cancel-request', 'legal-hold', 'does-not-exist'])
        assert result.exit_code != 0


# ============ retention_admin.run_scheduled_cleanup (EventBridge worker) ============

def test_run_scheduled_cleanup_deletes_both_record_types(app):
    with app.app_context():
        models.create_token('alice', 'reset_password', ttl_seconds=-10)
        _make_request(request_id='sched-old-1')
        cancel_store.start_processing('sched-old-1', 'alice', 'sid-1', None)
        cancel_store.finalize('sched-old-1', 'no_subscription', {'note': 'no sub'})
        models._users().update_item(
            Key={'pk': 'CANCELREQUEST#sched-old-1', 'sk': 'REQUEST'},
            UpdateExpression='SET processed_at = :p',
            ExpressionAttributeValues={':p': '2015-01-01T00:00:00+00:00'},
        )
        summary = retention_admin.run_scheduled_cleanup()
        assert summary['tokens'] == {'found': 1, 'deleted': 1, 'skipped': 0, 'errors': 0}
        assert summary['cancel_requests'] == {'found': 1, 'deleted': 1, 'skipped': 0, 'errors': 0}
        assert models.find_expired_tokens() == []
        assert cancel_store.get_cancel_request('sched-old-1') is None


def test_run_scheduled_cleanup_counts_but_does_not_raise_on_legal_hold_race(app):
    with app.app_context():
        _make_request(request_id='sched-race-1')
        cancel_store.start_processing('sched-race-1', 'alice', 'sid-1', None)
        cancel_store.finalize('sched-race-1', 'no_subscription', {'note': 'no sub'})
        models._users().update_item(
            Key={'pk': 'CANCELREQUEST#sched-race-1', 'sk': 'REQUEST'},
            UpdateExpression='SET processed_at = :p',
            ExpressionAttributeValues={':p': '2015-01-01T00:00:00+00:00'},
        )
        cancel_store.set_legal_hold('sched-race-1', hold=True)
        summary = retention_admin.run_scheduled_cleanup()
        # Held, so never even listed as purgeable in the first place.
        assert summary['cancel_requests'] == {'found': 0, 'deleted': 0, 'skipped': 0, 'errors': 0}
        assert cancel_store.get_cancel_request('sched-race-1') is not None


def test_run_scheduled_cleanup_propagates_listing_failure(app, monkeypatch):
    """A failure to even list candidates (e.g. a DynamoDB outage) is a
    whole-run failure, not a per-item one — it must propagate so the
    Lambda's own invocation-failure/retry handling applies, rather than
    being swallowed into a misleadingly-clean summary."""
    with app.app_context():
        def _boom(*args, **kwargs):
            raise RuntimeError('dynamodb unavailable')

        monkeypatch.setattr(models, 'find_expired_tokens', _boom)
        with pytest.raises(RuntimeError):
            retention_admin.run_scheduled_cleanup()


def test_run_scheduled_cleanup_no_eligible_records_reports_zero(app):
    with app.app_context():
        summary = retention_admin.run_scheduled_cleanup()
        assert summary == {
            'tokens': {'found': 0, 'deleted': 0, 'skipped': 0, 'errors': 0},
            'cancel_requests': {'found': 0, 'deleted': 0, 'skipped': 0, 'errors': 0},
        }
