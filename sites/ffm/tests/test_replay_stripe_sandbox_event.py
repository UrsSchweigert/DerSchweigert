"""Tests for sites/ffm/scripts/replay-stripe-sandbox-event.py.

Every Stripe client call and the HTTP POST to the sandbox are mocked, and
getpass/isatty are monkeypatched -- this suite makes no real network call
and prompts for no real secret. It focuses on the safety properties the
script promises: a non-TTY stream never falls back to echoed input, only
sk_test_/rk_test_ and whsec_ prefixed secrets are accepted, a livemode
event (or any other requested-vs-fetched mismatch, or disallowed event
type) stops before any POST, the POST always targets the fixed sandbox
address with redirects disabled, a 503/billing_retry_required response is
retried up to the bound and a different response is not, and nothing
beyond a status code and short known error code is ever printed.
"""

import importlib.util
import io
import sys
from pathlib import Path
from unittest.mock import MagicMock

import pytest
import stripe

SCRIPT_PATH = Path(__file__).resolve().parents[1] / 'scripts' / 'replay-stripe-sandbox-event.py'
SPEC = importlib.util.spec_from_file_location('replay_stripe_sandbox_event', SCRIPT_PATH)
replay = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(replay)


class _TTYBuffer(io.StringIO):
    """Reports itself as an interactive terminal without touching the real
    process stdin/stdout (which pytest may itself have replaced)."""

    def isatty(self):
        return True


def _valid_event(event_id='evt_1UQnPsDYFrEur0X906nvAXLq', event_type='charge.dispute.created',
                  livemode=False):
    return {
        'id': event_id, 'object': 'event', 'type': event_type, 'livemode': livemode,
        'data': {'object': {'id': 'ch_123', 'object': 'charge'}},
    }


def _run_main(monkeypatch, event_id='evt_1UQnPsDYFrEur0X906nvAXLq', secret_key='sk_test_abc',
              signing_secret='whsec_abc', stdin_isatty=True, stdout_isatty=True,
              stripe_client=None, responses=None):
    monkeypatch.setattr(sys, 'argv', ['replay-stripe-sandbox-event.py', '--event-id', event_id])
    stdin = _TTYBuffer() if stdin_isatty else io.StringIO()
    stdout = _TTYBuffer() if stdout_isatty else io.StringIO()
    monkeypatch.setattr(replay.sys, 'stdin', stdin)
    monkeypatch.setattr(replay.sys, 'stdout', stdout)
    secrets = iter([secret_key, signing_secret])
    monkeypatch.setattr(replay.getpass, 'getpass', lambda prompt='': next(secrets))
    if stripe_client is not None:
        monkeypatch.setattr(replay.stripe, 'StripeClient', lambda *a, **k: stripe_client)
    if responses is not None:
        calls = []
        remaining = list(responses)

        def fake_post(url, data=None, headers=None, timeout=None, allow_redirects=None):
            calls.append({'url': url, 'data': data, 'headers': headers,
                          'timeout': timeout, 'allow_redirects': allow_redirects})
            return remaining.pop(0) if len(remaining) > 1 else remaining[0]

        monkeypatch.setattr(replay.requests, 'post', fake_post)
        replay._test_post_calls = calls
    try:
        replay.main()
        exit_code = 0
    except SystemExit as exc:
        exit_code = exc.code
    return exit_code


def _response(status_code, body):
    response = MagicMock()
    response.status_code = status_code
    response.json.return_value = body
    return response


def test_non_tty_stdin_refuses_instead_of_echo_fallback(monkeypatch, capsys):
    getpass_calls = []
    monkeypatch.setattr(replay.getpass, 'getpass', lambda prompt='': getpass_calls.append(1) or 'sk_test_x')
    exit_code = _run_main(monkeypatch, stdin_isatty=False)
    assert exit_code == 1
    assert not getpass_calls, 'getpass must never be reached on a non-interactive stream'
    assert 'real terminal' in capsys.readouterr().err


def test_rejects_key_without_test_prefix(monkeypatch, capsys):
    exit_code = _run_main(monkeypatch, secret_key='sk_live_notallowed')
    assert exit_code == 1
    assert 'sk_test_' in capsys.readouterr().err


def test_rejects_signing_secret_without_whsec_prefix(monkeypatch, capsys):
    exit_code = _run_main(monkeypatch, signing_secret='not-a-secret')
    assert exit_code == 1
    assert 'whsec_' in capsys.readouterr().err


def test_rejects_malformed_event_id(monkeypatch, capsys):
    exit_code = _run_main(monkeypatch, event_id='not-an-event-id')
    assert exit_code == 1
    assert 'evt_' in capsys.readouterr().err


def test_hidden_input_failure_refuses_echo_fallback(monkeypatch, capsys):
    monkeypatch.setattr(replay.sys, 'stdin', _TTYBuffer())
    monkeypatch.setattr(replay.sys, 'stdout', _TTYBuffer())

    def unavailable_hidden_input(prompt=''):
        import warnings
        warnings.warn('Cannot control echo on the terminal.', replay.getpass.GetPassWarning)
        return 'sk_test_fallback'

    monkeypatch.setattr(replay.getpass, 'getpass', unavailable_hidden_input)
    monkeypatch.setattr(sys, 'argv', ['replay-stripe-sandbox-event.py', '--event-id', 'evt_abc123'])
    with pytest.raises(SystemExit) as excinfo:
        replay.main()
    assert excinfo.value.code == 1
    assert 'echoed secret' in capsys.readouterr().err


class TestValidateSandboxEvent:

    def test_livemode_true_rejected(self):
        event = _valid_event(livemode=True)
        with pytest.raises(replay.ValidationError, match='livemode'):
            replay.validate_sandbox_event(event, event['id'])

    def test_livemode_none_rejected(self):
        event = _valid_event(livemode=None)
        with pytest.raises(replay.ValidationError, match='livemode'):
            replay.validate_sandbox_event(event, event['id'])

    def test_mismatched_id_rejected(self):
        event = _valid_event()
        with pytest.raises(replay.ValidationError, match='does not match'):
            replay.validate_sandbox_event(event, 'evt_other')

    def test_disallowed_event_type_rejected(self):
        event = _valid_event(event_type='account.updated')
        with pytest.raises(replay.ValidationError, match='allowed billing'):
            replay.validate_sandbox_event(event, event['id'])

    def test_valid_event_passes(self):
        event = _valid_event()
        assert replay.validate_sandbox_event(event, event['id']) == event


def test_fetch_event_uses_pinned_api_version_and_does_not_write(monkeypatch):
    client = MagicMock()
    client.v1.events.retrieve.return_value = _valid_event()
    captured = {}

    def fake_stripe_client(key, stripe_version=None):
        captured['key'] = key
        captured['stripe_version'] = stripe_version
        return client

    monkeypatch.setattr(replay.stripe, 'StripeClient', fake_stripe_client)
    event = replay.fetch_event('sk_test_abc', 'evt_123')
    assert captured['stripe_version'] == replay.API_VERSION
    assert captured['key'] == 'sk_test_abc'
    client.v1.events.retrieve.assert_called_once_with('evt_123')
    assert event['id'] == 'evt_1UQnPsDYFrEur0X906nvAXLq'


def test_livemode_event_stops_before_any_post(monkeypatch, capsys):
    client = MagicMock()
    client.v1.events.retrieve.return_value = _valid_event(livemode=True)
    posts = []
    monkeypatch.setattr(replay.requests, 'post', lambda *a, **k: posts.append(1))
    exit_code = _run_main(monkeypatch, stripe_client=client)
    assert exit_code == 1
    assert not posts, 'must never POST once livemode validation fails'
    assert 'livemode' in capsys.readouterr().err


def test_disallowed_event_type_stops_before_any_post(monkeypatch, capsys):
    client = MagicMock()
    client.v1.events.retrieve.return_value = _valid_event(event_type='payment_intent.created')
    posts = []
    monkeypatch.setattr(replay.requests, 'post', lambda *a, **k: posts.append(1))
    exit_code = _run_main(monkeypatch, stripe_client=client)
    assert exit_code == 1
    assert not posts
    assert 'allowed billing' in capsys.readouterr().err


def test_stripe_error_never_echoes_raw_message(monkeypatch, capsys):
    client = MagicMock()
    error = stripe.InvalidRequestError('super secret request detail', param=None, code='resource_missing')
    error.http_status = 404
    client.v1.events.retrieve.side_effect = error
    exit_code = _run_main(monkeypatch, stripe_client=client)
    assert exit_code == 1
    captured = capsys.readouterr().err
    assert 'super secret request detail' not in captured
    assert 'code=resource_missing' in captured
    assert 'http_status=404' in captured


class TestSignPayload:

    def test_signature_matches_stripe_scheme(self):
        payload = b'{"id":"evt_1"}'
        header = replay.sign_payload(payload, 'whsec_test', timestamp=1700000000)
        assert header.startswith('t=1700000000,v1=')
        import hashlib
        import hmac
        expected = hmac.new(b'whsec_test', b'1700000000.' + payload, hashlib.sha256).hexdigest()
        assert header == f't=1700000000,v1={expected}'


def test_post_targets_fixed_sandbox_url_with_no_redirects(monkeypatch):
    event = _valid_event()
    client = MagicMock()
    client.v1.events.retrieve.return_value = event
    responses = [_response(200, {'received': True})]
    exit_code = _run_main(monkeypatch, stripe_client=client, responses=responses)
    assert exit_code == 0
    call = replay._test_post_calls[0]
    assert call['url'] == 'http://127.0.0.1:8766/api/billing/webhook'
    assert call['allow_redirects'] is False
    assert 'Stripe-Signature' in call['headers']


def test_retries_only_billing_retry_required_then_succeeds(monkeypatch):
    event = _valid_event()
    client = MagicMock()
    client.v1.events.retrieve.return_value = event
    responses = [
        _response(503, {'error': 'billing_retry_required'}),
        _response(503, {'error': 'billing_retry_required'}),
        _response(200, {'received': True}),
    ]
    sleeps = []
    monkeypatch.setattr(replay.time, 'sleep', lambda s: sleeps.append(s))
    exit_code = _run_main(monkeypatch, stripe_client=client, responses=responses)
    assert exit_code == 0
    assert sleeps == [replay.RETRY_DELAY_SECONDS, replay.RETRY_DELAY_SECONDS]


def test_exhausting_retries_on_billing_retry_required_fails_explicitly(monkeypatch, capsys):
    event = _valid_event()
    client = MagicMock()
    client.v1.events.retrieve.return_value = event
    responses = [_response(503, {'error': 'billing_retry_required'})] * replay.MAX_ATTEMPTS
    monkeypatch.setattr(replay.time, 'sleep', lambda s: None)
    exit_code = _run_main(monkeypatch, stripe_client=client, responses=responses)
    assert exit_code == 1
    assert 'billing_retry_required' in capsys.readouterr().err


def test_different_503_is_not_retried_and_fails_immediately(monkeypatch, capsys):
    event = _valid_event()
    client = MagicMock()
    client.v1.events.retrieve.return_value = event
    responses = [_response(503, {'error': 'billing_provider_unavailable'})]
    post_count = {'n': 0}
    real_responses = list(responses)

    def fake_post(url, data=None, headers=None, timeout=None, allow_redirects=None):
        post_count['n'] += 1
        return real_responses[0]

    monkeypatch.setattr(replay.requests, 'post', fake_post)
    exit_code = _run_main(monkeypatch, stripe_client=client)
    assert exit_code == 1
    assert post_count['n'] == 1, 'a non-retryable 503 must not be retried'
    err = capsys.readouterr().err
    assert 'billing_provider_unavailable' in err


def test_connection_error_is_not_retried_or_treated_as_success(monkeypatch, capsys):
    event = _valid_event()
    client = MagicMock()
    client.v1.events.retrieve.return_value = event
    attempts = {'n': 0}

    def failing_post(*a, **k):
        attempts['n'] += 1
        raise replay.requests.ConnectionError('refused')

    monkeypatch.setattr(replay.requests, 'post', failing_post)
    exit_code = _run_main(monkeypatch, stripe_client=client)
    assert exit_code == 1
    assert attempts['n'] == 1
    assert 'Request to sandbox failed' in capsys.readouterr().err


def test_received_false_on_200_is_reported_as_failure_not_silent_success(monkeypatch, capsys):
    event = _valid_event()
    client = MagicMock()
    client.v1.events.retrieve.return_value = event
    responses = [_response(200, {'received': False})]
    exit_code = _run_main(monkeypatch, stripe_client=client, responses=responses)
    assert exit_code == 1
    assert 'did not report received=true' in capsys.readouterr().err


def test_no_full_response_body_or_secret_ever_printed(monkeypatch, capsys):
    event = _valid_event()
    client = MagicMock()
    client.v1.events.retrieve.return_value = event
    responses = [_response(503, {'error': 'billing_provider_unavailable', 'message': 'full internal detail'})]
    exit_code = _run_main(monkeypatch, secret_key='sk_test_verysecretvalue',
                           signing_secret='whsec_verysecretvalue', stripe_client=client,
                           responses=responses)
    assert exit_code == 1
    output = capsys.readouterr()
    for leaked in ('sk_test_verysecretvalue', 'whsec_verysecretvalue', 'full internal detail'):
        assert leaked not in output.out
        assert leaked not in output.err
