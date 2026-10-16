"""Regression tests for the versioned checkout declarations and the durable
contract-confirmation record/email created once per NEW, server-verified
paid subscription (see app/legal_texts.py, app/contract_confirmation_store.py
and app/billing.py's checkout()/_ensure_contract_confirmation()).

Distinct from tests/test_billing.py's broader payment-reconciliation
coverage: this file focuses narrowly on the declarations/consent/contract-
confirmation surface the user explicitly required: exact-text/version/
language/timestamp binding, idempotency across duplicate webhook delivery,
retryable SES failure gating, renewals never re-triggering a fresh
waiver or a second email, and gift/grandfathered paths staying unaffected.
"""

import os
import json
from datetime import datetime, timezone
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
from sites.ffm.app import billing_store, contract_confirmation_store as confirmation_store, legal_texts, models
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
    app.config['GRANDFATHER_CUTOFF'] = '2020-01-01T00:00:00+00:00'
    return app


@pytest.fixture
def client(billing_app):
    return billing_app.test_client()


@pytest.fixture(autouse=True)
def mock_stripe_provider(monkeypatch):
    mock_client = MagicMock()
    monkeypatch.setattr('sites.ffm.app.stripe_provider._client', lambda: mock_client)
    return mock_client


_VALID_PRICE = {
    'id': 'price_quarterly', 'active': True, 'currency': 'eur',
    'unit_amount': 300, 'recurring': {'interval': 'month', 'interval_count': 3},
}


def _valid_checkout_payload(**overrides):
    payload = {
        'adult_confirmed': True, 'terms_accepted': True,
        'declarations_version': legal_texts.DECLARATIONS_VERSION, 'declarations_language': 'de',
        'immediate_access_confirmed': True, 'withdrawal_waiver_confirmed': True,
    }
    payload.update(overrides)
    return payload


def _make_stripe_webhook_signature(payload_str, secret):
    import hmac
    import hashlib
    import time
    timestamp = str(int(time.time()))
    signed_payload = f'{timestamp}.{payload_str}'
    signature = hmac.new(secret.encode('utf-8'), signed_payload.encode('utf-8'), hashlib.sha256).hexdigest()
    return f't={timestamp},v1={signature}'


# ============ Checkout declaration validation ============

def test_checkout_rejects_missing_declarations_language(client, billing_app, mock_stripe_provider):
    headers = register_and_login(client, 'declmissing1', 'declmissing1@example.com', 'Pass123!')
    mock_stripe_provider.prices.retrieve.return_value = _VALID_PRICE
    mock_stripe_provider.customers.create.return_value = {'id': 'cus_generic_test'}
    mock_stripe_provider.subscriptions.list.return_value.auto_paging_iter.return_value = []
    resp = client.post('/api/billing/checkout', json=_valid_checkout_payload(declarations_language=None),
                        headers=headers)
    assert resp.status_code == 400
    assert resp.get_json()['error'] == 'invalid_declarations_language'


def test_checkout_rejects_stale_declarations_version_distinctly_from_unchecked_box(client, billing_app, mock_stripe_provider):
    """A stale/mismatched version must be reported as declarations_version_mismatch
    (409) -- never conflated with "checkbox unchecked" (400) -- per the explicit
    requirement to never label a checkbox alone as merely 'expired'."""
    headers = register_and_login(client, 'declstale1', 'declstale1@example.com', 'Pass123!')
    mock_stripe_provider.prices.retrieve.return_value = _VALID_PRICE
    mock_stripe_provider.customers.create.return_value = {'id': 'cus_generic_test'}
    mock_stripe_provider.subscriptions.list.return_value.auto_paging_iter.return_value = []
    resp = client.post('/api/billing/checkout',
                        json=_valid_checkout_payload(declarations_version='old-version-1'), headers=headers)
    assert resp.status_code == 409
    assert resp.get_json()['error'] == 'declarations_version_mismatch'
    assert resp.get_json()['current_version'] == legal_texts.DECLARATIONS_VERSION


@pytest.mark.parametrize('field,short', [
    ('immediate_access_confirmed', 'declimm1'), ('withdrawal_waiver_confirmed', 'declwd1'),
])
def test_checkout_rejects_missing_digital_content_declaration(client, billing_app, mock_stripe_provider, field, short):
    headers = register_and_login(client, short, f'{short}@example.com', 'Pass123!')
    mock_stripe_provider.prices.retrieve.return_value = _VALID_PRICE
    mock_stripe_provider.customers.create.return_value = {'id': 'cus_generic_test'}
    mock_stripe_provider.subscriptions.list.return_value.auto_paging_iter.return_value = []
    resp = client.post('/api/billing/checkout', json=_valid_checkout_payload(**{field: False}), headers=headers)
    assert resp.status_code == 400
    assert resp.get_json()['error'] == 'digital_content_declarations_required'


def test_checkout_rejection_never_touches_entitlements_or_free_play(client, billing_app, mock_stripe_provider):
    """A missing/tampered declaration must only ever reject the checkout
    call itself -- it must never revoke/alter any existing entitlement or
    the baseline free-play access a user already has."""
    headers = register_and_login(client, 'declfreeplay1', 'declfreeplay1@example.com', 'Pass123!')
    with billing_app.app_context():
        stable_id = models.ensure_stable_id('declfreeplay1')
        before = dict(billing_store.get_billing_state(stable_id) or {})
    mock_stripe_provider.prices.retrieve.return_value = _VALID_PRICE
    mock_stripe_provider.customers.create.return_value = {'id': 'cus_generic_test'}
    mock_stripe_provider.subscriptions.list.return_value.auto_paging_iter.return_value = []
    resp = client.post('/api/billing/checkout',
                        json=_valid_checkout_payload(immediate_access_confirmed=False), headers=headers)
    assert resp.status_code == 400
    with billing_app.app_context():
        after = dict(billing_store.get_billing_state(stable_id) or {})
    assert before == after


def test_checkout_binds_exact_text_version_language_timestamp_to_operation_and_identity(client, billing_app, mock_stripe_provider):
    headers = register_and_login(client, 'declbind1', 'declbind1@example.com', 'Pass123!')
    with billing_app.app_context():
        stable_id = models.ensure_stable_id('declbind1')
    mock_stripe_provider.prices.retrieve.return_value = _VALID_PRICE
    mock_stripe_provider.customers.create.return_value = {'id': 'cus_generic_test'}
    mock_stripe_provider.subscriptions.list.return_value.auto_paging_iter.return_value = []
    mock_stripe_provider.checkout.sessions.create.return_value = {
        'id': 'cs_declbind1', 'url': 'https://checkout.stripe.com/pay/cs_declbind1',
    }
    resp = client.post('/api/billing/checkout', json=_valid_checkout_payload(declarations_language='en'),
                        headers=headers)
    assert resp.status_code == 200
    with billing_app.app_context():
        state = billing_store.get_billing_state(stable_id)
        operation = state['checkout_operation']
        record = confirmation_store.get_checkout_declarations(stable_id, operation)
    assert record is not None
    assert record['identity'] == stable_id
    assert record['checkout_operation'] == operation
    assert record['language'] == 'en'
    en_text = legal_texts.declarations_snapshot('en')
    for key, value in en_text.items():
        assert record[key] == value
    # UTC, immutable timestamp recorded at acceptance time.
    datetime.fromisoformat(record['accepted_at'])
    assert record['adult_confirmed'] is True and record['terms_accepted'] is True


def test_checkout_declaration_record_is_immutable_once_written(client, billing_app):
    """A retried checkout call against the same still-open operation must
    never silently overwrite the originally-accepted-at-that-moment
    declaration record."""
    with billing_app.app_context():
        texts = legal_texts.declarations_snapshot('de')
        first = confirmation_store.put_checkout_declarations(
            'stable-immut-1', 'op-immut-1', 'de', texts, adult_confirmed=True, terms_accepted=True,
        )
        second = confirmation_store.put_checkout_declarations(
            'stable-immut-1', 'op-immut-1', 'en', legal_texts.declarations_snapshot('en'),
            adult_confirmed=True, terms_accepted=True,
        )
    assert first['accepted_at'] == second['accepted_at']
    assert second['language'] == 'de'  # Original write wins, not the later "retry".


# ============ Contract confirmation: creation, idempotency, email ============

def _complete_checkout_and_pay(client, billing_app, mock_stripe_provider, username, email,
                                customer_id, subscription_id, paid_until_ts, declarations_language='de'):
    headers = register_and_login(client, username, email, 'Pass123!')
    with billing_app.app_context():
        stable_id = models.ensure_stable_id(username)
    mock_stripe_provider.prices.retrieve.return_value = _VALID_PRICE
    mock_stripe_provider.customers.create.return_value = {'id': customer_id}
    mock_stripe_provider.subscriptions.list.return_value.auto_paging_iter.return_value = []
    mock_stripe_provider.checkout.sessions.create.return_value = {
        'id': f'cs_{subscription_id}', 'url': f'https://checkout.stripe.com/pay/cs_{subscription_id}',
    }
    resp = client.post('/api/billing/checkout', json=_valid_checkout_payload(declarations_language=declarations_language),
                        headers=headers)
    assert resp.status_code == 200
    with billing_app.app_context():
        state = billing_store.get_billing_state(stable_id)
        operation = state['checkout_operation']

    sub_dict = {
        'id': subscription_id, 'customer': customer_id, 'status': 'active',
        'metadata': {'billing_uuid': stable_id, 'checkout_operation': operation},
        'items': {'data': [{'price': {'id': 'price_quarterly'}}]},
        'cancel_at_period_end': False, 'cancel_at': None,
        'current_period_end': paid_until_ts, 'trial_end': None,
    }
    mock_stripe_provider.subscriptions.retrieve.return_value = sub_dict
    mock_stripe_provider.subscriptions.list.return_value.auto_paging_iter.return_value = [sub_dict]
    invoice = {
        'id': f'inv_{subscription_id}', 'customer': customer_id, 'subscription': subscription_id,
        'status': 'paid', 'currency': 'eur', 'amount_paid': 300, 'paid': True,
        'customer_address': {'country': 'DE'}, 'charge': f'ch_{subscription_id}',
        'lines': {'data': [{
            'price': {'id': 'price_quarterly'}, 'period': {'end': paid_until_ts}, 'proration': False,
        }]},
    }
    mock_stripe_provider.invoices.list.return_value.auto_paging_iter.return_value = [invoice]
    mock_stripe_provider.charges.retrieve.return_value = {
        'id': f'ch_{subscription_id}', 'paid': True, 'refunded': False, 'amount_refunded': 0,
        'disputed': False, 'billing_details': {'address': {'country': 'DE'}},
    }
    mock_stripe_provider.invoices.retrieve.return_value = invoice
    return headers, stable_id, operation, sub_dict, invoice


def _send_invoice_event(client, billing_app, invoice, event_id):
    event_data = {'id': event_id, 'type': 'invoice.payment_succeeded', 'data': {'object': invoice}}
    payload = json.dumps(event_data)
    signature = _make_stripe_webhook_signature(payload, billing_app.config['STRIPE_WEBHOOK_SECRET'])
    return client.post('/api/billing/webhook', data=payload, content_type='application/json',
                        headers={'Stripe-Signature': signature})


def test_contract_confirmation_created_once_and_email_sent_on_new_paid_subscription(client, billing_app, mock_stripe_provider):
    headers, stable_id, operation, sub_dict, invoice = _complete_checkout_and_pay(
        client, billing_app, mock_stripe_provider, 'ccnew1', 'ccnew1@example.com',
        'cus_ccnew1', 'sub_ccnew1', int(datetime(2030, 1, 31, tzinfo=timezone.utc).timestamp()),
    )
    resp = _send_invoice_event(client, billing_app, invoice, 'evt_ccnew1')
    assert resp.status_code == 200
    with billing_app.app_context():
        confirmation = confirmation_store.get_contract_confirmation(stable_id, 'sub_ccnew1')
        state = billing_store.get_billing_state(stable_id)
    assert confirmation is not None
    assert confirmation['email_status'] == 'sent'
    assert confirmation['declarations']['checkout_operation'] == operation
    assert 'contract_reference' in confirmation
    assert 'price_and_renewal_summary_de' in confirmation
    assert 'withdrawal_instructions_de' in confirmation
    # Entitlement grant itself proceeded.
    assert state['paid_until'] == '2030-01-31T00:00:00+00:00'


def test_failed_entitlement_write_does_not_record_provisioning(client, billing_app, mock_stripe_provider, monkeypatch):
    _, stable_id, _, _, invoice = _complete_checkout_and_pay(
        client, billing_app, mock_stripe_provider, 'ccwrite1', 'ccwrite1@example.com',
        'cus_ccwrite1', 'sub_ccwrite1', int(datetime(2030, 1, 31, tzinfo=timezone.utc).timestamp()),
    )
    complete_event = billing_store.complete_billing_event

    def fail_grant(*args, **kwargs):
        raise ValueError('billing_conflict')

    monkeypatch.setattr(billing_store, 'complete_billing_event', fail_grant)
    assert _send_invoice_event(client, billing_app, invoice, 'evt_ccwrite1').status_code == 503
    with billing_app.app_context():
        confirmation = confirmation_store.get_contract_confirmation(stable_id, 'sub_ccwrite1')
        assert confirmation['email_status'] == 'sent'
        assert confirmation.get('provisioned_at') is None
        assert not billing_store.get_billing_state(stable_id).get('paid_until')

    monkeypatch.setattr(billing_store, 'complete_billing_event', complete_event)
    mark_provisioned = confirmation_store.mark_confirmation_provisioned

    def assert_granted_then_mark(identity, subscription_id):
        assert billing_store.get_billing_state(identity)['paid_until'] == '2030-01-31T00:00:00+00:00'
        return mark_provisioned(identity, subscription_id)

    monkeypatch.setattr(confirmation_store, 'mark_confirmation_provisioned', assert_granted_then_mark)
    assert _send_invoice_event(client, billing_app, invoice, 'evt_ccwrite1').status_code == 200
    with billing_app.app_context():
        assert confirmation_store.get_contract_confirmation(stable_id, 'sub_ccwrite1')['provisioned_at']


def test_contract_confirmation_email_is_sent_in_the_language_selected_at_checkout(client, billing_app, mock_stripe_provider, monkeypatch):
    """End-to-end regression guard: the persisted declarations_language
    chosen at checkout must reach the actual contract-confirmation email
    send, not just the stored snapshot's bilingual fields."""
    calls = []
    monkeypatch.setattr(
        'sites.ffm.app.billing.mailer.send_contract_confirmation_email',
        lambda *a, **kw: calls.append(a[1]),
    )
    headers, stable_id, operation, sub_dict, invoice = _complete_checkout_and_pay(
        client, billing_app, mock_stripe_provider, 'ccnewen1', 'ccnewen1@example.com',
        'cus_ccnewen1', 'sub_ccnewen1', int(datetime(2030, 1, 31, tzinfo=timezone.utc).timestamp()),
        declarations_language='en',
    )
    resp = _send_invoice_event(client, billing_app, invoice, 'evt_ccnewen1')
    assert resp.status_code == 200
    assert len(calls) == 1
    sent_confirmation = calls[0]
    assert sent_confirmation['declarations']['language'] == 'en'


def test_duplicate_webhook_delivery_never_creates_second_confirmation_or_resends_email(client, billing_app, mock_stripe_provider, monkeypatch):
    headers, stable_id, operation, sub_dict, invoice = _complete_checkout_and_pay(
        client, billing_app, mock_stripe_provider, 'ccdup1', 'ccdup1@example.com',
        'cus_ccdup1', 'sub_ccdup1', int(datetime(2030, 2, 28, tzinfo=timezone.utc).timestamp()),
    )
    send_calls = []
    import sites.ffm.app.mailer as mailer_module
    original_send = mailer_module.send_contract_confirmation_email

    def _counting_send(*args, **kwargs):
        send_calls.append(1)
        return original_send(*args, **kwargs)
    monkeypatch.setattr('sites.ffm.app.billing.mailer.send_contract_confirmation_email', _counting_send)

    first = _send_invoice_event(client, billing_app, invoice, 'evt_ccdup1_a')
    assert first.status_code == 200
    # Simulate the exact same webhook event id being redelivered by Stripe.
    second = _send_invoice_event(client, billing_app, invoice, 'evt_ccdup1_a')
    assert second.status_code == 200
    # Also simulate a *different* event (e.g. a subsequent subscription.updated)
    # referencing the same still-unchanged subscription -- must not re-create.
    third = _send_invoice_event(client, billing_app, invoice, 'evt_ccdup1_b')
    assert third.status_code == 200

    assert len(send_calls) == 1
    with billing_app.app_context():
        confirmation = confirmation_store.get_contract_confirmation(stable_id, 'sub_ccdup1')
    assert confirmation['email_status'] == 'sent'


def test_renewal_invoice_does_not_recreate_confirmation_or_require_fresh_waiver(client, billing_app, mock_stripe_provider, monkeypatch):
    """A renewal invoice on the *same* subscription_id must never trigger a
    second confirmation record or a second email -- renewals are never a
    fresh waiver event."""
    headers, stable_id, operation, sub_dict, invoice = _complete_checkout_and_pay(
        client, billing_app, mock_stripe_provider, 'ccrenew1', 'ccrenew1@example.com',
        'cus_ccrenew1', 'sub_ccrenew1', int(datetime(2030, 1, 31, tzinfo=timezone.utc).timestamp()),
    )
    send_calls = []
    import sites.ffm.app.mailer as mailer_module
    original_send = mailer_module.send_contract_confirmation_email

    def _counting_send(*args, **kwargs):
        send_calls.append(1)
        return original_send(*args, **kwargs)
    monkeypatch.setattr('sites.ffm.app.billing.mailer.send_contract_confirmation_email', _counting_send)

    first = _send_invoice_event(client, billing_app, invoice, 'evt_ccrenew1_first')
    assert first.status_code == 200
    with billing_app.app_context():
        first_confirmation = confirmation_store.get_contract_confirmation(stable_id, 'sub_ccrenew1')

    # Renewal invoice: new invoice id, later period, same subscription_id.
    renewal_paid_until_ts = int(datetime(2030, 4, 30, tzinfo=timezone.utc).timestamp())
    renewal_invoice = dict(invoice)
    renewal_invoice.update({
        'id': 'inv_ccrenew1_renewal', 'charge': 'ch_ccrenew1_renewal',
        'lines': {'data': [{
            'price': {'id': 'price_quarterly'}, 'period': {'end': renewal_paid_until_ts}, 'proration': False,
        }]},
    })
    renewed_sub = dict(sub_dict)
    renewed_sub['current_period_end'] = renewal_paid_until_ts
    mock_stripe_provider.subscriptions.retrieve.return_value = renewed_sub
    mock_stripe_provider.subscriptions.list.return_value.auto_paging_iter.return_value = [renewed_sub]
    mock_stripe_provider.invoices.list.return_value.auto_paging_iter.return_value = [invoice, renewal_invoice]
    mock_stripe_provider.charges.retrieve.return_value = {
        'id': 'ch_ccrenew1_renewal', 'paid': True, 'refunded': False, 'amount_refunded': 0,
        'disputed': False, 'billing_details': {'address': {'country': 'DE'}},
    }
    mock_stripe_provider.invoices.retrieve.return_value = renewal_invoice

    second = _send_invoice_event(client, billing_app, renewal_invoice, 'evt_ccrenew1_renewal')
    assert second.status_code == 200

    with billing_app.app_context():
        second_confirmation = confirmation_store.get_contract_confirmation(stable_id, 'sub_ccrenew1')
        state = billing_store.get_billing_state(stable_id)
    assert len(send_calls) == 1  # Still exactly one email: the renewal sent none.
    assert first_confirmation['confirmed_at'] == second_confirmation['confirmed_at']  # Same record, untouched.
    assert state['paid_until'] == '2030-04-30T00:00:00+00:00'  # Entitlement still extended correctly.


def test_ses_failure_during_contract_confirmation_blocks_entitlement_until_sent(client, billing_app, mock_stripe_provider, monkeypatch):
    """Approved strict sequence: payment verified -> durable confirmation
    persisted -> SES send *accepted* -> entitlement grant. A SES failure
    on a brand-new, declarations-gated checkout contract must therefore
    record 'failed' and durably withhold the access grant (never a paid
    customer silently stuck as if their payment had been fully
    processed) -- the webhook must respond with a retryable status so
    Stripe redelivers the event, matching the existing
    billing_retry_required/503 provider pattern used elsewhere in this
    module (e.g. 'billing_busy')."""
    headers, stable_id, operation, sub_dict, invoice = _complete_checkout_and_pay(
        client, billing_app, mock_stripe_provider, 'ccfail1', 'ccfail1@example.com',
        'cus_ccfail1', 'sub_ccfail1', int(datetime(2030, 1, 31, tzinfo=timezone.utc).timestamp()),
    )

    def boom(*args, **kwargs):
        raise ClientError(
            {'Error': {'Code': 'MessageRejected', 'Message': 'simulated SES failure'}}, 'SendEmail',
        )
    monkeypatch.setattr('sites.ffm.app.billing.mailer.send_contract_confirmation_email', boom)

    resp = _send_invoice_event(client, billing_app, invoice, 'evt_ccfail1')
    assert resp.status_code == 503
    assert resp.get_json()['error'] == 'billing_retry_required'
    with billing_app.app_context():
        confirmation = confirmation_store.get_contract_confirmation(stable_id, 'sub_ccfail1')
        state = billing_store.get_billing_state(stable_id)
    assert confirmation is not None
    assert confirmation['email_status'] == 'failed'
    assert confirmation['email_error'] == 'ClientError:MessageRejected'
    assert confirmation.get('provisioned_at') is None  # Never provisioned while gated and unsent.
    # No paid-access grant and no event completion that would prevent retry.
    assert (state or {}).get('paid_until') != '2030-01-31T00:00:00+00:00'


def test_next_reconcile_attempt_after_ses_recovers_grants_access_exactly_once(client, billing_app, mock_stripe_provider, monkeypatch):
    """After a transient SES failure, the next delivery attempt of the
    *same* webhook event (Stripe's real retry behavior) must retry the
    send -- the earlier 'existing confirmation record always short-
    circuits' bug must not resurface -- and, once SES accepts it, must
    grant access exactly once (no duplicate email, no duplicate grant)."""
    headers, stable_id, operation, sub_dict, invoice = _complete_checkout_and_pay(
        client, billing_app, mock_stripe_provider, 'ccretry1', 'ccretry1@example.com',
        'cus_ccretry1', 'sub_ccretry1', int(datetime(2030, 1, 31, tzinfo=timezone.utc).timestamp()),
    )
    send_calls = []
    attempt = {'n': 0}

    def flaky(*args, **kwargs):
        attempt['n'] += 1
        send_calls.append(1)
        if attempt['n'] == 1:
            raise ClientError(
                {'Error': {'Code': 'Throttling', 'Message': 'simulated SES throttle'}}, 'SendEmail',
            )
    monkeypatch.setattr('sites.ffm.app.billing.mailer.send_contract_confirmation_email', flaky)

    first = _send_invoice_event(client, billing_app, invoice, 'evt_ccretry1')
    assert first.status_code == 503
    with billing_app.app_context():
        assert confirmation_store.get_contract_confirmation(stable_id, 'sub_ccretry1')['email_status'] == 'failed'
        assert (billing_store.get_billing_state(stable_id) or {}).get('paid_until') is None

    # Stripe redelivers the still-unacknowledged event (same event id).
    second = _send_invoice_event(client, billing_app, invoice, 'evt_ccretry1')
    assert second.status_code == 200
    with billing_app.app_context():
        confirmation = confirmation_store.get_contract_confirmation(stable_id, 'sub_ccretry1')
        state = billing_store.get_billing_state(stable_id)
    assert confirmation['email_status'] == 'sent'
    assert confirmation.get('provisioned_at') is not None
    assert state['paid_until'] == '2030-01-31T00:00:00+00:00'  # Access granted once SES accepted.
    assert len(send_calls) == 2  # Exactly one failed attempt, one successful retry -- never more.


def test_cli_resend_email_recovers_failed_contract_confirmation(client, billing_app, mock_stripe_provider, monkeypatch):
    from click.testing import CliRunner
    headers, stable_id, operation, sub_dict, invoice = _complete_checkout_and_pay(
        client, billing_app, mock_stripe_provider, 'ccrecover1', 'ccrecover1@example.com',
        'cus_ccrecover1', 'sub_ccrecover1', int(datetime(2030, 1, 31, tzinfo=timezone.utc).timestamp()),
    )

    def boom(*args, **kwargs):
        raise ClientError(
            {'Error': {'Code': 'Throttling', 'Message': 'simulated SES throttle'}}, 'SendEmail',
        )
    monkeypatch.setattr('sites.ffm.app.billing.mailer.send_contract_confirmation_email', boom)
    resp = _send_invoice_event(client, billing_app, invoice, 'evt_ccrecover1')
    assert resp.status_code == 503  # Gated: payment valid, SES failed -- no access granted yet.
    with billing_app.app_context():
        assert confirmation_store.get_contract_confirmation(stable_id, 'sub_ccrecover1')['email_status'] == 'failed'
        assert (billing_store.get_billing_state(stable_id) or {}).get('paid_until') is None

    monkeypatch.setattr('sites.ffm.app.billing_admin.mailer.send_contract_confirmation_email', lambda *a, **kw: None)
    runner = CliRunner()
    with billing_app.app_context():
        result = runner.invoke(billing_app.cli, [
            'billing-admin', 'contract-confirmation', 'resend-email', stable_id, 'sub_ccrecover1', '--confirm',
        ])
    assert result.exit_code == 0, result.output
    with billing_app.app_context():
        assert confirmation_store.get_contract_confirmation(stable_id, 'sub_ccrecover1')['email_status'] == 'sent'

    # CLI resend only flips the email status -- it never grants access or
    # charges again; the entitlement grant itself still only happens on
    # the next reconcile attempt (e.g. the next webhook redelivery, or an
    # explicit `billing-admin reconcile`), and never re-sends the email.
    with billing_app.app_context():
        assert (billing_store.get_billing_state(stable_id) or {}).get('paid_until') is None
    resend_calls = []
    monkeypatch.setattr(
        'sites.ffm.app.billing.mailer.send_contract_confirmation_email',
        lambda *a, **kw: resend_calls.append(1),
    )
    retry = _send_invoice_event(client, billing_app, invoice, 'evt_ccrecover1')
    assert retry.status_code == 200
    assert resend_calls == []  # No extra email: email_status was already 'sent'.
    with billing_app.app_context():
        state = billing_store.get_billing_state(stable_id)
    assert state['paid_until'] == '2030-01-31T00:00:00+00:00'  # Activated without charging again.


def test_gift_redemption_path_unaffected_by_declarations_gate(client, billing_app, mock_stripe_provider):
    """Grandfathered/gift-only entitlement paths never go through the new
    checkout declarations gate (they don't call /checkout at all), so they
    must remain completely unaffected."""
    headers = register_and_login(client, 'giftunaffected1', 'giftunaffected1@example.com', 'Pass123!')
    with billing_app.app_context():
        code, _code_hash = billing_store.create_access_code(months=3)
    resp = client.post('/api/billing/redeem', json={'code': code}, headers=headers)
    # Whatever the redeem outcome, it must not be gated on declarations_version/
    # immediate_access_confirmed/withdrawal_waiver_confirmed at all.
    assert resp.status_code != 400 or resp.get_json().get('error') != 'digital_content_declarations_required'


def test_legacy_subscription_without_checkout_operation_metadata_grandfathered_unaffected(
        client, billing_app, mock_stripe_provider):
    """A subscription predating this feature (or attached through any
    path that never set the `checkout_operation` metadata `checkout()`
    binds to every *new* checkout) must never be gated on a contract
    confirmation it was never asked to produce -- access is granted
    exactly as it always was, no confirmation record is fabricated, and
    nothing is ever durably recorded as if consent had been collected."""
    username, email = 'legacysub1', 'legacysub1@example.com'
    register_and_login(client, username, email, 'Pass123!')
    with billing_app.app_context():
        stable_id = models.ensure_stable_id(username)
        billing_store.put_billing_state(stable_id, customer_id='cus_legacysub1')

    paid_until_ts = int(datetime(2030, 1, 31, tzinfo=timezone.utc).timestamp())
    sub_dict = {
        'id': 'sub_legacysub1', 'customer': 'cus_legacysub1', 'status': 'active',
        'metadata': {'billing_uuid': stable_id},  # No checkout_operation: legacy attachment.
        'items': {'data': [{'price': {'id': 'price_quarterly'}}]},
        'cancel_at_period_end': False, 'cancel_at': None,
        'current_period_end': paid_until_ts, 'trial_end': None,
    }
    mock_stripe_provider.subscriptions.retrieve.return_value = sub_dict
    invoice = {
        'id': 'inv_legacysub1', 'customer': 'cus_legacysub1', 'subscription': 'sub_legacysub1',
        'status': 'paid', 'currency': 'eur', 'amount_paid': 300, 'paid': True,
        'customer_address': {'country': 'DE'}, 'charge': 'ch_legacysub1',
        'lines': {'data': [{
            'price': {'id': 'price_quarterly'}, 'period': {'end': paid_until_ts}, 'proration': False,
        }]},
    }
    mock_stripe_provider.invoices.list.return_value.auto_paging_iter.return_value = [invoice]
    mock_stripe_provider.charges.retrieve.return_value = {
        'id': 'ch_legacysub1', 'paid': True, 'refunded': False, 'amount_refunded': 0,
        'disputed': False, 'billing_details': {'address': {'country': 'DE'}},
    }
    mock_stripe_provider.invoices.retrieve.return_value = invoice

    resp = _send_invoice_event(client, billing_app, invoice, 'evt_legacysub1')
    assert resp.status_code == 200  # Never gated/blocked, never a 503 retry.
    with billing_app.app_context():
        state = billing_store.get_billing_state(stable_id)
        confirmation = confirmation_store.get_contract_confirmation(stable_id, 'sub_legacysub1')
    assert state['paid_until'] == '2030-01-31T00:00:00+00:00'  # Access granted immediately, as before.
    assert confirmation is None  # No confirmation record fabricated for a legacy contract.
