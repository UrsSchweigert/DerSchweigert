"""Regression tests for the public, no-login withdrawal ("Vertrag
widerrufen") declaration intake (app/withdrawal_requests.py +
app/withdrawal_requests_store.py) and its operator CLI (app/billing_admin.py
`withdrawal-request` command group).

Mirrors tests/test_cancel_requests.py's structure/idempotency patterns, but
covers the distinct requirements explicitly specified for this flow: an
*immediate* email receipt (not merely after an operator later closes it out),
a downloadable token-gated durable receipt reachable without login, no
automatic cancel/refund on an unverified submission, no account
enumeration, and that a checked declaration box is never auto-treated as a
legal verdict.
"""

import os
import json
from unittest.mock import MagicMock

import pytest
import boto3
from botocore.exceptions import ClientError
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

from sites.ffm.app import create_app
from sites.ffm.app.config import TestingConfig
from sites.ffm.app import billing_store, withdrawal_requests_store as withdrawal_store
from .test_app import register_and_login


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
        ses = boto3.client('ses', region_name='eu-central-1')
        ses.verify_email_identity(EmailAddress=os.environ.get('SES_SENDER_EMAIL', 'no-reply@ffm.derschweigert.de'))
        yield


@pytest.fixture
def billing_app(aws_mock):
    app = create_app(TestingConfig)
    app.config['ACCESS_CONTROL_ENABLED'] = True
    app.config['BILLING_ENABLED'] = True
    app.config['BILLING_SALES_ENABLED'] = True
    app.config['BILLING_TERMS_APPROVED'] = True
    app.config['STRIPE_PRICE_ID'] = 'price_quarterly'
    app.config['STRIPE_SECRET_KEY'] = 'sk_test_fake'
    app.config['STRIPE_WEBHOOK_SECRET'] = 'whsec_test_1234567890'
    app.config['STRIPE_PORTAL_CONFIGURATION_ID'] = 'bpc_test_config'
    return app


@pytest.fixture
def client(billing_app):
    return billing_app.test_client()


@pytest.fixture(autouse=True)
def mock_stripe_provider(monkeypatch):
    mock_client = MagicMock()
    monkeypatch.setattr('sites.ffm.app.stripe_provider._client', lambda: mock_client)
    return mock_client


def _valid_payload(**overrides):
    payload = {
        'idempotency_key': '11111111-1111-4111-8111-111111111111',
        'contact_email': 'withdrawcontact@example.com',
        'account_email': 'withdrawaccount@example.com',
        'username': None,
        'stripe_reference': None,
        'statement_language': 'de',
        'statement_confirmed': True,
        'reason': 'Ich moechte widerrufen.',
    }
    payload.update(overrides)
    return payload


# ============ Public submission + immediate receipt ============

def test_public_guest_submission_sends_immediate_email_receipt_and_token(client, billing_app, mock_stripe_provider):
    resp = client.post('/api/withdrawal-requests', json=_valid_payload())
    assert resp.status_code == 201
    data = resp.get_json()
    assert data['status'] == 'submitted'
    assert data['request_id'] == '11111111-1111-4111-8111-111111111111'
    assert 'submitted_at' in data
    assert 'receipt_token' in data and data['receipt_token']
    assert data['receipt_download_url'].endswith(f"/receipt?token={data['receipt_token']}")
    # Never asserts a legal verdict -- only a technical "received" state.
    assert 'Anfrage erhalten' in data['message']
    assert 'NICHT' in data['message']
    mock_stripe_provider.subscriptions.update.assert_not_called()
    mock_stripe_provider.subscriptions.cancel.assert_not_called()
    mock_stripe_provider.refunds.create.assert_not_called()

    with billing_app.app_context():
        stored = withdrawal_store.get_withdrawal_request(data['request_id'])
    assert stored['status'] == 'submitted'
    assert stored['receipt_email_status'] == 'sent'


def test_no_authorization_header_or_login_required(client):
    resp = client.post('/api/withdrawal-requests', json=_valid_payload(
        idempotency_key='22222222-2222-4222-8222-222222222222'))
    assert resp.status_code == 201


def test_no_account_lookup_or_enumeration_on_submit(client):
    resp = client.post('/api/withdrawal-requests', json=_valid_payload(
        idempotency_key='33333333-3333-4333-8333-333333333333',
        account_email='definitely-not-a-real-account@nowhere.invalid', username='madeupnonexistent',
    ))
    assert resp.status_code == 201
    assert resp.get_json()['status'] == 'submitted'


def test_statement_text_is_canonical_not_client_supplied(client, billing_app):
    """The client only ever selects a language -- the durably recorded
    statement text always comes from app/legal_texts.py, never anything
    the client could inject."""
    from sites.ffm.app import legal_texts
    resp = client.post('/api/withdrawal-requests', json=_valid_payload(
        idempotency_key='c0000000-0000-4000-8000-000000000001',
        statement_language='en',
    ))
    assert resp.status_code == 201
    assert resp.get_json()['statement'] == legal_texts.WITHDRAWAL_STATEMENT['en']


def test_missing_statement_confirmation_rejected(client):
    resp = client.post('/api/withdrawal-requests', json=_valid_payload(
        idempotency_key='44444444-aaaa-4aaa-8aaa-000000000001', statement_confirmed=False,
    ))
    assert resp.status_code == 400
    assert resp.get_json()['error'] == 'statement_confirmation_required'


def test_requires_at_least_one_identifying_field(client):
    resp = client.post('/api/withdrawal-requests', json=_valid_payload(
        idempotency_key='99999999-9999-4999-8999-999999999999',
        account_email=None, username=None, stripe_reference=None,
    ))
    assert resp.status_code == 400
    assert resp.get_json()['error'] == 'identifying_info_required'


# ============ Idempotency ============

def test_same_idempotency_key_retry_with_identical_payload_is_not_duplicated_and_omits_token(client):
    payload = _valid_payload(idempotency_key='44444444-4444-4444-8444-444444444444')
    first = client.post('/api/withdrawal-requests', json=payload)
    assert first.status_code == 201
    assert 'receipt_token' in first.get_json()
    second = client.post('/api/withdrawal-requests', json=payload)
    assert second.status_code == 200  # replay, not a new resource
    assert second.get_json()['request_id'] == first.get_json()['request_id']
    assert second.get_json()['submitted_at'] == first.get_json()['submitted_at']
    # The original, unrecoverable token is never re-issued on a replay.
    assert 'receipt_token' not in second.get_json()


def test_same_idempotency_key_with_different_payload_is_rejected_not_silently_resubmitted(client):
    key = '55555555-5555-4555-8555-555555555555'
    first = client.post('/api/withdrawal-requests', json=_valid_payload(idempotency_key=key, reason='first'))
    assert first.status_code == 201
    second = client.post('/api/withdrawal-requests', json=_valid_payload(idempotency_key=key, reason='different'))
    assert second.status_code == 409
    assert second.get_json()['error'] == 'idempotency_conflict'


def test_invalid_idempotency_key_rejected(client):
    resp = client.post('/api/withdrawal-requests', json=_valid_payload(idempotency_key='not-a-uuid'))
    assert resp.status_code == 400
    assert resp.get_json()['error'] == 'invalid_idempotency_key'


# ============ Immediate receipt email: failure handling ============

def test_receipt_email_failure_is_recorded_not_swallowed_and_submission_still_succeeds(client, billing_app, monkeypatch):
    def boom(*args, **kwargs):
        raise ClientError({'Error': {'Code': 'MessageRejected', 'Message': 'sim'}}, 'SendEmail')
    monkeypatch.setattr('sites.ffm.app.withdrawal_requests.mailer.send_withdrawal_request_receipt_email', boom)

    resp = client.post('/api/withdrawal-requests', json=_valid_payload(
        idempotency_key='66666666-6666-4666-8666-666666666666'))
    assert resp.status_code == 201  # Submission/durable record must not fail just because SES did.
    data = resp.get_json()
    assert 'receipt_token' in data  # Download path still available even if email failed.

    with billing_app.app_context():
        stored = withdrawal_store.get_withdrawal_request(data['request_id'])
    assert stored['receipt_email_status'] == 'failed'
    assert stored['receipt_email_error'] == 'ClientError:MessageRejected'


def test_receipt_email_is_sent_in_the_selected_statement_language_not_always_german(client, billing_app, monkeypatch):
    """The persisted statement_language choice must reach the actual
    email send call, not just the JSON response -- regression guard
    against the receipt email always defaulting to German regardless of
    what the requester selected."""
    calls = []

    def fake_send(*args, **kwargs):
        calls.append(kwargs)

    monkeypatch.setattr('sites.ffm.app.withdrawal_requests.mailer.send_withdrawal_request_receipt_email', fake_send)
    resp = client.post('/api/withdrawal-requests', json=_valid_payload(
        idempotency_key='66666666-6666-4666-8666-666666666679', statement_language='en'))
    assert resp.status_code == 201
    assert len(calls) == 1
    assert calls[0]['language'] == 'en'


def test_json_receipt_message_is_localized_to_the_selected_statement_language(client, billing_app):
    """The 'received, not confirmed' status message shown/stored in the
    JSON receipt must match the requester's own statement_language
    selection -- not a hardcoded German string regardless of it."""
    resp_de = client.post('/api/withdrawal-requests', json=_valid_payload(
        idempotency_key='66666666-6666-4666-8666-666666666680', statement_language='de'))
    assert 'Anfrage erhalten' in resp_de.get_json()['message']

    resp_en = client.post('/api/withdrawal-requests', json=_valid_payload(
        idempotency_key='66666666-6666-4666-8666-666666666681', statement_language='en'))
    data_en = resp_en.get_json()
    assert 'request received' in data_en['message']
    assert 'Anfrage erhalten' not in data_en['message']


# ============ No-login downloadable receipt ============

def test_receipt_download_succeeds_with_correct_token_no_login(client):
    resp = client.post('/api/withdrawal-requests', json=_valid_payload(
        idempotency_key='77777777-7777-4777-8777-777777777777'))
    data = resp.get_json()
    download = client.get(
        f"/api/withdrawal-requests/{data['request_id']}/receipt?token={data['receipt_token']}"
    )
    assert download.status_code == 200
    assert download.headers['Content-Type'].startswith('text/plain')
    body = download.get_data(as_text=True)
    assert data['request_id'] in body
    assert 'Widerrufserklaerung' in body


def test_receipt_download_rejects_wrong_token_with_generic_404(client):
    resp = client.post('/api/withdrawal-requests', json=_valid_payload(
        idempotency_key='88888888-8888-4888-8888-888888888888'))
    data = resp.get_json()
    wrong = client.get(f"/api/withdrawal-requests/{data['request_id']}/receipt?token=not-the-real-token")
    assert wrong.status_code == 404
    assert wrong.get_json()['error'] == 'not_found'


def test_receipt_download_nonexistent_request_id_returns_identical_generic_404(client):
    """Must be indistinguishable from the wrong-token case above -- no
    account/request enumeration via distinct error responses."""
    resp = client.get(
        '/api/withdrawal-requests/00000000-0000-4000-8000-000000000000/receipt?token=anything'
    )
    assert resp.status_code == 404
    assert resp.get_json()['error'] == 'not_found'


def test_receipt_download_without_token_returns_404(client):
    resp = client.post('/api/withdrawal-requests', json=_valid_payload(
        idempotency_key='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'))
    data = resp.get_json()
    missing = client.get(f"/api/withdrawal-requests/{data['request_id']}/receipt")
    assert missing.status_code == 404


# ============ Operator CLI: manual, non-automatic identity binding ============

def test_cli_process_requires_both_explicit_confirmation_flags(client, billing_app):
    from click.testing import CliRunner
    resp = client.post('/api/withdrawal-requests', json=_valid_payload(
        idempotency_key='b0000000-0000-4000-8000-000000000001', username='opuser1'))
    register_and_login(client, 'opuser1', 'opuser1@example.com', 'Pass123!')
    runner = CliRunner()
    with billing_app.app_context():
        # Missing --confirm-identity-reviewed and --confirm must both be required.
        result = runner.invoke(billing_app.cli, [
            'billing-admin', 'withdrawal-request', 'process',
            resp.get_json()['request_id'], '--username', 'opuser1',
        ])
    assert result.exit_code != 0


def test_cli_process_never_auto_cancels_or_refunds_without_explicit_flags(client, billing_app, mock_stripe_provider):
    """A checked declaration/statement alone is never grounds to auto-
    action a cancellation or refund -- 'process' without the optional
    action flags only records the declaration as reviewed/fulfilled."""
    from click.testing import CliRunner
    register_and_login(client, 'opuser2', 'opuser2@example.com', 'Pass123!')
    resp = client.post('/api/withdrawal-requests', json=_valid_payload(
        idempotency_key='b0000000-0000-4000-8000-000000000002', username='opuser2'))
    request_id = resp.get_json()['request_id']
    runner = CliRunner()
    with billing_app.app_context():
        result = runner.invoke(billing_app.cli, [
            'billing-admin', 'withdrawal-request', 'process', request_id,
            '--username', 'opuser2', '--confirm-identity-reviewed', '--confirm',
        ])
    assert result.exit_code == 0, result.output
    mock_stripe_provider.subscriptions.cancel.assert_not_called()
    mock_stripe_provider.refunds.create.assert_not_called()
    with billing_app.app_context():
        stored = withdrawal_store.get_withdrawal_request(request_id)
    assert stored['status'] == 'fulfilled'
    assert stored['outcome_detail']['subscription_canceled_immediately'] is False
    assert stored['outcome_detail']['refund_provider_reference'] is None


def test_cli_process_rejects_unverified_identity_implicitly_by_requiring_real_account(client, billing_app):
    """An operator cannot bind the request to a username that doesn't
    exist -- this is the closest thing to a safety net preventing a
    submission's self-reported, unverified details from driving any
    action; actual identity verification is a human judgment call the
    CLI cannot make for the operator, but it can refuse nonexistent
    accounts outright."""
    from click.testing import CliRunner
    resp = client.post('/api/withdrawal-requests', json=_valid_payload(
        idempotency_key='b0000000-0000-4000-8000-000000000003'))
    runner = CliRunner()
    with billing_app.app_context():
        result = runner.invoke(billing_app.cli, [
            'billing-admin', 'withdrawal-request', 'process', resp.get_json()['request_id'],
            '--username', 'doesnotexist404', '--confirm-identity-reviewed', '--confirm',
        ])
    assert result.exit_code != 0


def test_cli_record_manual_outcome_never_calls_stripe(client, billing_app, mock_stripe_provider):
    from click.testing import CliRunner
    register_and_login(client, 'opuser3', 'opuser3@example.com', 'Pass123!')
    resp = client.post('/api/withdrawal-requests', json=_valid_payload(
        idempotency_key='b0000000-0000-4000-8000-000000000004', username='opuser3'))
    request_id = resp.get_json()['request_id']
    runner = CliRunner()
    with billing_app.app_context():
        result = runner.invoke(billing_app.cli, [
            'billing-admin', 'withdrawal-request', 'record-manual-outcome', request_id,
            '--username', 'opuser3', '--confirm-identity-reviewed', '--outcome', 'fulfilled',
            '--note', 'handled manually in dashboard', '--confirm',
        ])
    assert result.exit_code == 0, result.output
    mock_stripe_provider.subscriptions.cancel.assert_not_called()
    mock_stripe_provider.refunds.create.assert_not_called()
    with billing_app.app_context():
        stored = withdrawal_store.get_withdrawal_request(request_id)
    assert stored['status'] == 'fulfilled'
    assert stored['outcome_detail']['manual'] is True


def test_cli_process_no_match_outcome_for_unidentifiable_requester(client, billing_app):
    """An operator who cannot verify any matching account must be able to
    durably record 'no_match' rather than being forced into a false
    'fulfilled' claim."""
    from click.testing import CliRunner
    register_and_login(client, 'opuser4', 'opuser4@example.com', 'Pass123!')
    resp = client.post('/api/withdrawal-requests', json=_valid_payload(
        idempotency_key='b0000000-0000-4000-8000-000000000005', username='opuser4'))
    request_id = resp.get_json()['request_id']
    runner = CliRunner()
    with billing_app.app_context():
        result = runner.invoke(billing_app.cli, [
            'billing-admin', 'withdrawal-request', 'record-manual-outcome', request_id,
            '--username', 'opuser4', '--confirm-identity-reviewed', '--outcome', 'no_match', '--confirm',
        ])
    assert result.exit_code == 0, result.output
    with billing_app.app_context():
        stored = withdrawal_store.get_withdrawal_request(request_id)
    assert stored['status'] == 'no_match'


# ============ Operator CLI: outcome email (separate from immediate receipt) ============

def test_cli_complete_email_blocked_until_processed(billing_app):
    from click.testing import CliRunner
    with billing_app.app_context():
        withdrawal_store.create_withdrawal_request(
            'd0000000-0000-4000-8000-000000000001', 'hash1',
            {
                'contact_email': 'x@example.com', 'account_email': None, 'username': None,
                'stripe_reference': None, 'reason': None,
                'statement_language': 'de', 'statement_text': 'stmt',
            },
            'tokhash1',
        )
    runner = CliRunner()
    with billing_app.app_context():
        result = runner.invoke(billing_app.cli, [
            'billing-admin', 'withdrawal-request', 'complete-email',
            'd0000000-0000-4000-8000-000000000001', '--confirm',
        ])
    assert result.exit_code != 0


def test_cli_complete_email_sends_after_processed_and_is_retryable_on_failure(billing_app, monkeypatch):
    from click.testing import CliRunner
    with billing_app.app_context():
        withdrawal_store.create_withdrawal_request(
            'd0000000-0000-4000-8000-000000000002', 'hash2',
            {
                'contact_email': 'y@example.com', 'account_email': None, 'username': None,
                'stripe_reference': None, 'reason': None,
                'statement_language': 'de', 'statement_text': 'stmt',
            },
            'tokhash2',
        )
        withdrawal_store.start_processing('d0000000-0000-4000-8000-000000000002', 'someop', 'stable-x', None)
        withdrawal_store.finalize('d0000000-0000-4000-8000-000000000002', 'fulfilled', {'note': 'ok'})

    def boom(*args, **kwargs):
        raise ClientError({'Error': {'Code': 'Throttling', 'Message': 'sim'}}, 'SendEmail')
    monkeypatch.setattr('sites.ffm.app.billing_admin.mailer.send_withdrawal_request_outcome_email', boom)
    runner = CliRunner()
    with billing_app.app_context():
        result = runner.invoke(billing_app.cli, [
            'billing-admin', 'withdrawal-request', 'complete-email',
            'd0000000-0000-4000-8000-000000000002', '--confirm',
        ])
    assert result.exit_code != 0
    with billing_app.app_context():
        assert withdrawal_store.get_withdrawal_request(
            'd0000000-0000-4000-8000-000000000002')['outcome_email_status'] == 'failed'

    monkeypatch.undo()
    with billing_app.app_context():
        result = runner.invoke(billing_app.cli, [
            'billing-admin', 'withdrawal-request', 'complete-email',
            'd0000000-0000-4000-8000-000000000002', '--confirm',
        ])
    assert result.exit_code == 0, result.output
    with billing_app.app_context():
        assert withdrawal_store.get_withdrawal_request(
            'd0000000-0000-4000-8000-000000000002')['outcome_email_status'] == 'sent'


def test_cli_resend_receipt_email_recovers_failed_immediate_receipt(client, billing_app, monkeypatch):
    from click.testing import CliRunner

    def boom(*args, **kwargs):
        raise ClientError({'Error': {'Code': 'MessageRejected', 'Message': 'sim'}}, 'SendEmail')
    monkeypatch.setattr('sites.ffm.app.withdrawal_requests.mailer.send_withdrawal_request_receipt_email', boom)
    resp = client.post('/api/withdrawal-requests', json=_valid_payload(
        idempotency_key='e0000000-0000-4000-8000-000000000001'))
    request_id = resp.get_json()['request_id']
    with billing_app.app_context():
        assert withdrawal_store.get_withdrawal_request(request_id)['receipt_email_status'] == 'failed'

    monkeypatch.undo()
    runner = CliRunner()
    with billing_app.app_context():
        result = runner.invoke(billing_app.cli, [
            'billing-admin', 'withdrawal-request', 'resend-receipt-email', request_id, '--confirm',
        ])
    assert result.exit_code == 0, result.output
    with billing_app.app_context():
        assert withdrawal_store.get_withdrawal_request(request_id)['receipt_email_status'] == 'sent'


def test_cli_outcome_and_resend_receipt_emails_use_the_requesters_persisted_statement_language(client, billing_app, monkeypatch):
    """Both operator-triggered recovery emails must be sent in the
    requester's own persisted statement_language, not always German --
    regression guard for the CLI recovery paths specifically (the public
    submission path is covered separately above)."""
    from click.testing import CliRunner
    resp = client.post('/api/withdrawal-requests', json=_valid_payload(
        idempotency_key='e0000000-0000-4000-8000-000000000099', statement_language='en',
        username=None, account_email='enuser@example.com'))
    request_id = resp.get_json()['request_id']

    outcome_calls = []
    receipt_calls = []
    monkeypatch.setattr(
        'sites.ffm.app.billing_admin.mailer.send_withdrawal_request_outcome_email',
        lambda *a, **kw: outcome_calls.append(kw),
    )
    monkeypatch.setattr(
        'sites.ffm.app.withdrawal_requests.mailer.send_withdrawal_request_receipt_email',
        lambda *a, **kw: receipt_calls.append(kw),
    )

    with billing_app.app_context():
        withdrawal_store.record_manual_outcome(request_id, 'opuser', 'stable-en', 'no_match', {})
    runner = CliRunner()
    with billing_app.app_context():
        result = runner.invoke(billing_app.cli, [
            'billing-admin', 'withdrawal-request', 'complete-email', request_id, '--confirm',
        ])
    assert result.exit_code == 0, result.output
    assert outcome_calls[-1]['language'] == 'en'

    with billing_app.app_context():
        result = runner.invoke(billing_app.cli, [
            'billing-admin', 'withdrawal-request', 'resend-receipt-email', request_id, '--confirm',
        ])
    assert result.exit_code == 0, result.output
    assert receipt_calls[-1]['language'] == 'en'


@pytest.mark.parametrize('language,expected_notice,expected_title', [
    ('de', 'Dieser Beleg wurde erneut vom Betreiber versendet.', 'Eingangsbestaetigung'),
    ('en', 'This receipt was resent by the operator.', 'receipt confirmation'),
])
def test_cli_resend_receipt_email_reuses_original_receipt_body_not_a_bare_notice(
        client, billing_app, monkeypatch, language, expected_notice, expected_title):
    """Regression guard for the resend-receipt-email CLI command: it must
    reuse the exact canonical receipt body (statement text, request id,
    submitted-at timestamp, status line, stripe_reference) the requester
    originally received -- not replace it with a bare 'resent' notice.
    Asserts the actual captured email body/receipt text, not merely that
    an email was sent."""
    from click.testing import CliRunner
    resp = client.post('/api/withdrawal-requests', json=_valid_payload(
        idempotency_key=f'e0000000-0000-4000-8000-0000000000{"01" if language == "de" else "02"}',
        statement_language=language, username=None, account_email=f'resend{language}@example.com',
        stripe_reference='sub_resendcheck',
    ))
    assert resp.status_code == 201
    request_id = resp.get_json()['request_id']
    with billing_app.app_context():
        item = withdrawal_store.get_withdrawal_request(request_id)

    calls = []
    monkeypatch.setattr(
        'sites.ffm.app.billing_admin.mailer.send_withdrawal_request_receipt_email',
        lambda *a, **kw: calls.append((a, kw)),
    )
    runner = CliRunner()
    with billing_app.app_context():
        result = runner.invoke(billing_app.cli, [
            'billing-admin', 'withdrawal-request', 'resend-receipt-email', request_id, '--confirm',
        ])
    assert result.exit_code == 0, result.output
    assert len(calls) == 1
    args, kwargs = calls[0]
    to_email, sent_request_id, submitted_at, statement_text, body = args[:5]
    assert to_email == item['contact_email']
    assert sent_request_id == request_id
    assert submitted_at == item['submitted_at']
    assert statement_text == item['statement_text']
    assert kwargs['language'] == language
    # Original canonical receipt content must still be present verbatim.
    assert item['statement_text'] in body
    assert item['stripe_reference'] in body
    assert item['submitted_at'] in body
    assert expected_title in body
    # The resend notice is appended, never substituted for the original.
    assert expected_notice in body


# ============ Operator CLI: retention holdback (legal-hold flag exists but no purge wired) ============

def test_cli_legal_hold_set_and_lift(client, billing_app):
    from click.testing import CliRunner
    resp = client.post('/api/withdrawal-requests', json=_valid_payload(
        idempotency_key='f0000000-0000-4000-8000-000000000001'))
    request_id = resp.get_json()['request_id']
    runner = CliRunner()
    with billing_app.app_context():
        result = runner.invoke(billing_app.cli, [
            'billing-admin', 'withdrawal-request', 'legal-hold', request_id,
        ])
    assert result.exit_code == 0, result.output
    with billing_app.app_context():
        assert withdrawal_store.get_withdrawal_request(request_id)['legal_hold'] is True
        result = runner.invoke(billing_app.cli, [
            'billing-admin', 'withdrawal-request', 'legal-hold', request_id, '--lift',
        ])
    assert result.exit_code == 0, result.output
    with billing_app.app_context():
        assert withdrawal_store.get_withdrawal_request(request_id)['legal_hold'] is False
