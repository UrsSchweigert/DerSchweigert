"""Tests for sites/ffm/scripts/setup-stripe-live.py, the one-time
interactive helper that provisions LIVE Stripe + AWS resources. Every
Stripe/AWS client and the terminal (getpass/input/isatty) are mocked —
this suite never performs a real network call. It focuses on the
safety properties the script promises: read-only checks run and stop
before any write on failure, a mismatched typed confirmation blocks all
writes, no secret/raw-response value is ever printed, and a write
failure midway reports the already-created residue without attempting
an automatic rollback.
"""

import importlib.util
import io
import sys
import types
import warnings
from pathlib import Path
from unittest.mock import MagicMock

import botocore.exceptions
import pytest
import stripe

SCRIPT_PATH = Path(__file__).resolve().parents[1] / 'scripts' / 'setup-stripe-live.py'
SPEC = importlib.util.spec_from_file_location('setup_stripe_live', SCRIPT_PATH)
setup_stripe_live = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(setup_stripe_live)

VALID_PRICE = types.SimpleNamespace(
    id='price_1UQkljDYFrEur0X9y18ekslo',
    livemode=True,
    active=True,
    currency='eur',
    unit_amount=300,
    recurring=types.SimpleNamespace(interval='month', interval_count=3),
    tax_behavior='inclusive',
)

VALID_PORTAL = types.SimpleNamespace(
    id='bpc_1UQkquDYFrEur0X9JdDK6pAG',
    livemode=True,
    active=True,
    features=types.SimpleNamespace(
        subscription_cancel=types.SimpleNamespace(enabled=True, mode='at_period_end'),
        payment_method_update=types.SimpleNamespace(enabled=True),
        subscription_update=types.SimpleNamespace(enabled=False),
    ),
)


class _TTYBuffer(io.StringIO):
    """A StringIO that reports itself as an interactive terminal, so the
    script's getpass-echo-fallback guard passes without touching the
    real process stdin/stdout (which pytest may itself have replaced)."""

    def isatty(self):
        return True


def _fake_webhook_endpoint(endpoint_id='we_123', status='enabled', secret='whsec_abc', url=None):
    return types.SimpleNamespace(
        id=endpoint_id, status=status, secret=secret,
        url=url or setup_stripe_live.WEBHOOK_URL,
    )


def _make_stripe_client(
    price=VALID_PRICE, portal=VALID_PORTAL, existing_endpoints=(),
    create_result=None, create_error=None, update_result=None, update_error=None,
):
    client = MagicMock(name='stripe_client')
    client.v1.prices.retrieve.return_value = price
    client.v1.billing_portal.configurations.retrieve.return_value = portal

    listing = MagicMock()
    listing.auto_paging_iter.return_value = iter(existing_endpoints)
    client.v1.webhook_endpoints.list.return_value = listing

    if create_error is not None:
        client.v1.webhook_endpoints.create.side_effect = create_error
    else:
        client.v1.webhook_endpoints.create.return_value = create_result or _fake_webhook_endpoint()

    if update_error is not None:
        client.v1.webhook_endpoints.update.side_effect = update_error
    else:
        client.v1.webhook_endpoints.update.return_value = (
            update_result or _fake_webhook_endpoint(status='disabled')
        )
    return client


def _make_secretsmanager_client(existing_secrets=(), create_secret_side_effects=None):
    client = MagicMock(name='secretsmanager_client')

    def describe_secret(SecretId):
        if SecretId in existing_secrets:
            return {'ARN': f'arn:aws:secretsmanager:eu-central-1:113725432218:secret:{SecretId}-x'}
        raise botocore.exceptions.ClientError(
            {'Error': {'Code': 'ResourceNotFoundException', 'Message': 'nope'}}, 'DescribeSecret',
        )

    client.describe_secret.side_effect = describe_secret
    if create_secret_side_effects is not None:
        client.create_secret.side_effect = create_secret_side_effects
    else:
        def create_secret(Name, SecretString):
            return {'ARN': f'arn:aws:secretsmanager:eu-central-1:113725432218:secret:{Name}-NEW'}
        client.create_secret.side_effect = create_secret
    return client


def _make_session(secretsmanager_client, region='eu-central-1', account_id='113725432218'):
    session = MagicMock(name='boto3_session')
    session.region_name = region
    sts_client = MagicMock(name='sts_client')
    sts_client.get_caller_identity.return_value = {'Account': account_id}

    def client(service_name):
        return {'sts': sts_client, 'secretsmanager': secretsmanager_client}[service_name]

    session.client.side_effect = client
    return session, sts_client


def _run_main(monkeypatch, price_id='price_1UQkljDYFrEur0X9y18ekslo',
              portal_id='bpc_1UQkquDYFrEur0X9JdDK6pAG', secret_key='sk_live_realkey12345',
              confirmation='CREATE LIVE STRIPE WEBHOOK', stdin_isatty=True, stdout_isatty=True,
              session=None, stripe_client=None):
    monkeypatch.setattr(sys, 'argv', ['setup-stripe-live.py', '--price-id', price_id, '--portal-id', portal_id])
    stdin = _TTYBuffer() if stdin_isatty else io.StringIO()
    stdout = _TTYBuffer() if stdout_isatty else io.StringIO()
    monkeypatch.setattr(setup_stripe_live.sys, 'stdin', stdin)
    monkeypatch.setattr(setup_stripe_live.sys, 'stdout', stdout)
    monkeypatch.setattr(setup_stripe_live.getpass, 'getpass', lambda prompt='': secret_key)
    monkeypatch.setattr('builtins.input', lambda prompt='': confirmation)
    monkeypatch.setattr(setup_stripe_live.boto3, 'Session', lambda: session)
    monkeypatch.setattr(setup_stripe_live.stripe, 'StripeClient', lambda *a, **k: stripe_client)
    return stdout


class TestValidationStopsBeforeWrites:
    def test_existing_secret_stops_before_prompting_for_key(self, monkeypatch):
        secretsmanager_client = _make_secretsmanager_client(existing_secrets={'ffm/stripe-secret-key'})
        session, _ = _make_session(secretsmanager_client)
        getpass_calls = []
        monkeypatch.setattr(setup_stripe_live.getpass, 'getpass',
                             lambda prompt='': getpass_calls.append(1) or 'sk_live_x')
        _run_main(monkeypatch, session=session, stripe_client=MagicMock())
        monkeypatch.setattr(setup_stripe_live.getpass, 'getpass',
                             lambda prompt='': getpass_calls.append(1) or 'sk_live_x')

        with pytest.raises(SystemExit) as exc:
            setup_stripe_live.main()

        assert exc.value.code == 1
        assert not getpass_calls, 'must stop before ever prompting for the live secret key'
        assert not secretsmanager_client.create_secret.called

    def test_wrong_aws_account_stops_before_writes(self, monkeypatch):
        secretsmanager_client = _make_secretsmanager_client()
        session, _ = _make_session(secretsmanager_client, account_id='999999999999')
        _run_main(monkeypatch, session=session, stripe_client=MagicMock())

        with pytest.raises(SystemExit) as exc:
            setup_stripe_live.main()

        assert exc.value.code == 1
        assert not secretsmanager_client.create_secret.called

    def test_wrong_aws_region_stops_before_writes(self, monkeypatch):
        secretsmanager_client = _make_secretsmanager_client()
        session, _ = _make_session(secretsmanager_client, region='us-east-1')
        _run_main(monkeypatch, session=session, stripe_client=MagicMock())

        with pytest.raises(SystemExit) as exc:
            setup_stripe_live.main()

        assert exc.value.code == 1
        assert not secretsmanager_client.create_secret.called

    def test_rejects_key_without_sk_live_prefix(self, monkeypatch):
        secretsmanager_client = _make_secretsmanager_client()
        session, _ = _make_session(secretsmanager_client)
        stripe_client = _make_stripe_client()
        _run_main(monkeypatch, secret_key='sk_test_notlive', session=session, stripe_client=stripe_client)

        with pytest.raises(SystemExit) as exc:
            setup_stripe_live.main()

        assert exc.value.code == 1
        assert not stripe_client.v1.prices.retrieve.called
        assert not secretsmanager_client.create_secret.called

    def test_non_tty_stdin_refuses_instead_of_echo_fallback(self, monkeypatch):
        secretsmanager_client = _make_secretsmanager_client()
        session, _ = _make_session(secretsmanager_client)
        getpass_calls = []
        stripe_client = _make_stripe_client()
        _run_main(monkeypatch, stdin_isatty=False, session=session, stripe_client=stripe_client)
        monkeypatch.setattr(setup_stripe_live.getpass, 'getpass',
                             lambda prompt='': getpass_calls.append(1) or 'sk_live_x')

        with pytest.raises(SystemExit) as exc:
            setup_stripe_live.main()

        assert exc.value.code == 1
        assert not getpass_calls, 'getpass must never be reached on a non-interactive stream'

    @pytest.mark.parametrize('field,value', [
        ('livemode', False), ('active', False), ('currency', 'usd'),
        ('unit_amount', 500), ('tax_behavior', 'exclusive'),
    ])
    def test_invalid_price_stops_before_writes(self, monkeypatch, field, value):
        bad_price = types.SimpleNamespace(**{**VALID_PRICE.__dict__, field: value})
        secretsmanager_client = _make_secretsmanager_client()
        session, _ = _make_session(secretsmanager_client)
        stripe_client = _make_stripe_client(price=bad_price)
        _run_main(monkeypatch, session=session, stripe_client=stripe_client)

        with pytest.raises(SystemExit) as exc:
            setup_stripe_live.main()

        assert exc.value.code == 1
        assert not secretsmanager_client.create_secret.called
        assert not stripe_client.v1.webhook_endpoints.create.called

    def test_portal_with_subscription_updates_enabled_stops(self, monkeypatch):
        bad_portal = types.SimpleNamespace(
            id=VALID_PORTAL.id, livemode=True, active=True,
            features=types.SimpleNamespace(
                subscription_cancel=types.SimpleNamespace(enabled=True, mode='at_period_end'),
                payment_method_update=types.SimpleNamespace(enabled=True),
                subscription_update=types.SimpleNamespace(enabled=True),
            ),
        )
        secretsmanager_client = _make_secretsmanager_client()
        session, _ = _make_session(secretsmanager_client)
        stripe_client = _make_stripe_client(portal=bad_portal)
        _run_main(monkeypatch, session=session, stripe_client=stripe_client)

        with pytest.raises(SystemExit) as exc:
            setup_stripe_live.main()

        assert exc.value.code == 1
        assert not secretsmanager_client.create_secret.called

    def test_existing_webhook_for_url_stops(self, monkeypatch):
        secretsmanager_client = _make_secretsmanager_client()
        session, _ = _make_session(secretsmanager_client)
        stripe_client = _make_stripe_client(existing_endpoints=[_fake_webhook_endpoint(endpoint_id='we_existing')])
        _run_main(monkeypatch, session=session, stripe_client=stripe_client)

        with pytest.raises(SystemExit) as exc:
            setup_stripe_live.main()

        assert exc.value.code == 1
        assert not secretsmanager_client.create_secret.called
        assert not stripe_client.v1.webhook_endpoints.create.called


class TestConfirmationGate:
    def test_mismatched_confirmation_stops_all_writes(self, monkeypatch):
        secretsmanager_client = _make_secretsmanager_client()
        session, _ = _make_session(secretsmanager_client)
        stripe_client = _make_stripe_client()
        _run_main(monkeypatch, confirmation='yes please', session=session, stripe_client=stripe_client)

        with pytest.raises(SystemExit) as exc:
            setup_stripe_live.main()

        assert exc.value.code == 1
        assert not secretsmanager_client.create_secret.called
        assert not stripe_client.v1.webhook_endpoints.create.called
        assert not stripe_client.v1.webhook_endpoints.update.called

    def test_empty_confirmation_stops_all_writes(self, monkeypatch):
        secretsmanager_client = _make_secretsmanager_client()
        session, _ = _make_session(secretsmanager_client)
        stripe_client = _make_stripe_client()
        _run_main(monkeypatch, confirmation='', session=session, stripe_client=stripe_client)

        with pytest.raises(SystemExit) as exc:
            setup_stripe_live.main()

        assert exc.value.code == 1
        assert not secretsmanager_client.create_secret.called


def test_hidden_input_failure_refuses_echo_fallback(monkeypatch):
    monkeypatch.setattr(setup_stripe_live.sys, 'stdin', _TTYBuffer())
    monkeypatch.setattr(setup_stripe_live.sys, 'stdout', _TTYBuffer())

    def unavailable_hidden_input(prompt):
        warnings.warn('Cannot control echo on the terminal.', setup_stripe_live.getpass.GetPassWarning)
        pytest.fail('Secret input must stop before echoed fallback')

    monkeypatch.setattr(setup_stripe_live.getpass, 'getpass', unavailable_hidden_input)
    with pytest.raises(setup_stripe_live.ValidationError, match='Hidden input is unavailable'):
        setup_stripe_live._prompt_live_secret_key()


class TestSuccessfulRun:
    def test_full_run_creates_secrets_and_disables_endpoint(self, monkeypatch):
        secretsmanager_client = _make_secretsmanager_client()
        session, _ = _make_session(secretsmanager_client)
        endpoint = _fake_webhook_endpoint(endpoint_id='we_new', status='enabled', secret='whsec_realvalue')
        stripe_client = _make_stripe_client(
            create_result=endpoint, update_result=_fake_webhook_endpoint(endpoint_id='we_new', status='disabled'),
        )
        stdout = _run_main(monkeypatch, secret_key='sk_live_realkey12345',
                            session=session, stripe_client=stripe_client)

        setup_stripe_live.main()

        # AWS secret for the Stripe key is created before the webhook endpoint.
        create_calls = [c.kwargs for c in secretsmanager_client.create_secret.call_args_list]
        assert create_calls[0] == {'Name': 'ffm/stripe-secret-key', 'SecretString': 'sk_live_realkey12345'}
        assert create_calls[1] == {'Name': 'ffm/stripe-webhook-secret', 'SecretString': 'whsec_realvalue'}

        create_kwargs = stripe_client.v1.webhook_endpoints.create.call_args.args[0]
        assert create_kwargs['url'] == setup_stripe_live.WEBHOOK_URL
        assert create_kwargs['api_version'] == '2024-06-20'
        assert create_kwargs['enabled_events'] == setup_stripe_live.WEBHOOK_EVENTS
        assert len(setup_stripe_live.WEBHOOK_EVENTS) == 10

        update_args = stripe_client.v1.webhook_endpoints.update.call_args.args
        assert update_args[0] == 'we_new'
        assert update_args[1] == {'disabled': True}

        output = stdout.getvalue()
        assert 'sk_live_realkey12345' not in output
        assert 'whsec_realvalue' not in output
        assert 'arn:aws:secretsmanager' in output

    def test_secret_string_is_plain_not_json(self, monkeypatch):
        secretsmanager_client = _make_secretsmanager_client()
        session, _ = _make_session(secretsmanager_client)
        stripe_client = _make_stripe_client()
        _run_main(monkeypatch, secret_key='sk_live_plainvalue', session=session, stripe_client=stripe_client)

        setup_stripe_live.main()

        first_call_kwargs = secretsmanager_client.create_secret.call_args_list[0].kwargs
        assert isinstance(first_call_kwargs['SecretString'], str)
        assert first_call_kwargs['SecretString'] == 'sk_live_plainvalue'


class TestPartialFailureReporting:
    def test_webhook_endpoint_create_failure_reports_residue_and_stops(self, monkeypatch, capsys):
        secretsmanager_client = _make_secretsmanager_client()
        session, _ = _make_session(secretsmanager_client)
        create_error = stripe.APIConnectionError(message='connection reset by peer at 10.0.0.5')
        stripe_client = _make_stripe_client(create_error=create_error)
        _run_main(monkeypatch, session=session, stripe_client=stripe_client)

        with pytest.raises(SystemExit) as exc:
            setup_stripe_live.main()

        assert exc.value.code == 1
        # The AWS secret was created (it comes first); the script does not
        # delete it automatically, and says so.
        assert secretsmanager_client.create_secret.call_count == 1
        assert not stripe_client.v1.webhook_endpoints.update.called
        captured = capsys.readouterr()
        assert 'connection reset by peer' not in captured.err
        assert 'APIConnectionError' in captured.err
        assert 'NOT' in captured.err and 'cleanup' in captured.err.lower() or 'rolled back' in captured.err.lower()

    def test_webhook_secret_creation_failure_reports_residue(self, monkeypatch, capsys):
        def create_secret_side_effect(Name, SecretString):
            if Name == 'ffm/stripe-webhook-secret':
                raise botocore.exceptions.ClientError(
                    {'Error': {'Code': 'AccessDeniedException', 'Message': 'denied for user arn:aws:iam::x'}},
                    'CreateSecret',
                )
            return {'ARN': f'arn:aws:secretsmanager:eu-central-1:113725432218:secret:{Name}-NEW'}

        secretsmanager_client = _make_secretsmanager_client(
            create_secret_side_effects=create_secret_side_effect,
        )
        session, _ = _make_session(secretsmanager_client)
        endpoint = _fake_webhook_endpoint(endpoint_id='we_partial', secret='whsec_shouldnotleak')
        stripe_client = _make_stripe_client(
            create_result=endpoint,
            update_result=_fake_webhook_endpoint(endpoint_id='we_partial', status='disabled'),
        )
        _run_main(monkeypatch, session=session, stripe_client=stripe_client)

        with pytest.raises(SystemExit) as exc:
            setup_stripe_live.main()

        assert exc.value.code == 1
        assert stripe_client.v1.webhook_endpoints.update.called, 'endpoint must still be disabled before the failure'
        captured = capsys.readouterr()
        assert 'whsec_shouldnotleak' not in captured.err
        assert 'denied for user' not in captured.err
        assert 'AccessDeniedException' in captured.err
        assert 'we_partial' in captured.err

    def test_endpoint_disable_failure_reports_residue(self, monkeypatch, capsys):
        update_error = stripe.APIError(message='internal stripe failure xyz')
        secretsmanager_client = _make_secretsmanager_client()
        session, _ = _make_session(secretsmanager_client)
        endpoint = _fake_webhook_endpoint(endpoint_id='we_enabled_residue', status='enabled')
        stripe_client = _make_stripe_client(create_result=endpoint, update_error=update_error)
        _run_main(monkeypatch, session=session, stripe_client=stripe_client)

        with pytest.raises(SystemExit) as exc:
            setup_stripe_live.main()

        assert exc.value.code == 1
        assert secretsmanager_client.create_secret.call_count == 1, \
            'the webhook-secret AWS secret must not be created while the endpoint is still enabled'
        captured = capsys.readouterr()
        assert 'internal stripe failure xyz' not in captured.err
        assert 'we_enabled_residue' in captured.err
        assert 'ENABLED' in captured.err


class TestErrorSanitization:
    def test_stripe_error_message_never_echoed(self, monkeypatch, capsys):
        secretsmanager_client = _make_secretsmanager_client()
        session, _ = _make_session(secretsmanager_client)
        secret_price = types.SimpleNamespace(**VALID_PRICE.__dict__)
        stripe_client = MagicMock()
        stripe_client.v1.prices.retrieve.side_effect = stripe.InvalidRequestError(
            message='No such price: price_abc belonging to account acct_SECRETVALUE123',
            param='price', code='resource_missing',
        )
        _run_main(monkeypatch, session=session, stripe_client=stripe_client)

        with pytest.raises(SystemExit) as exc:
            setup_stripe_live.main()

        assert exc.value.code == 1
        captured = capsys.readouterr()
        assert 'acct_SECRETVALUE123' not in captured.err
        assert 'InvalidRequestError' in captured.err
        assert 'resource_missing' in captured.err
        assert not secretsmanager_client.create_secret.called

    def test_aws_error_message_never_echoed(self, monkeypatch, capsys):
        secretsmanager_client = MagicMock()
        secretsmanager_client.describe_secret.side_effect = botocore.exceptions.ClientError(
            {'Error': {'Code': 'AccessDeniedException',
                       'Message': 'User arn:aws:iam::113725432218:user/alice is not authorized'}},
            'DescribeSecret',
        )
        session, _ = _make_session(secretsmanager_client)
        _run_main(monkeypatch, session=session, stripe_client=MagicMock())

        with pytest.raises(SystemExit) as exc:
            setup_stripe_live.main()

        assert exc.value.code == 1
        captured = capsys.readouterr()
        assert 'user/alice' not in captured.err
        assert 'AccessDeniedException' in captured.err
