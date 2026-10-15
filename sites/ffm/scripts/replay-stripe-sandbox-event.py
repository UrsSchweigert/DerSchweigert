"""Replay one exact TEST-mode Stripe event against the local sandbox webhook.

Diagnostic aid for isolated Stripe sandbox investigations: it does not change
app/billing.py's behavior and does not itself determine why a given delivery
returned 503. It only re-delivers the *same* event, fetched read-only from
Stripe, to the sandbox listener so the 503 can be reproduced or ruled out
under controlled, single-event conditions (e.g. without other events
arriving concurrently). Root cause (lock contention, a stale/conflicting
billing state version, or an actually-unavailable Stripe/provider call) is
still determined by what the sandbox logs when this replay runs, not by this
script.

What it does, in order:
  1. Validates --event-id looks like a Stripe event id (evt_...); nothing is
     sent to Stripe or the sandbox before this.
  2. Prompts (hidden, real TTY only, no echoed fallback) for a Stripe TEST/
     restricted-TEST secret key (sk_test_/rk_test_ only -- never sk_live_/
     rk_live_) and the local `stripe listen` webhook signing secret
     (whsec_...).
  3. Fetches ONLY that event id from Stripe, read-only, pinned to API
     version 2024-06-20 (matching app/stripe_provider.py and the sandbox
     listener in sites/ffm/README.md). No other Stripe call is made.
  4. Requires the fetched event's `livemode` to be exactly False and its
     `type` to be one of the ffm billing webhook's allow-listed event
     types; anything else aborts before any POST is made.
  5. Serializes the fetched event, signs it with the signing secret using
     Stripe's own HMAC-SHA256 scheme (`t=<timestamp>,v1=<hex>`) and a fresh
     current timestamp, and POSTs it to the FIXED local sandbox address
     http://127.0.0.1:8766/api/billing/webhook only -- never a
     user-suppliable or production URL -- with redirects disabled.
  6. Retries ONLY a 503 response whose JSON body is exactly
     `{"error": "billing_retry_required"}` (the sandbox's own signal for a
     transient lock/version conflict), up to 3 attempts total with a fixed
     delay between attempts. Any other response (including a different 503,
     e.g. `billing_provider_unavailable`) is reported once, immediately, as
     a failure -- it is never retried and never treated as a quiet success.

This script never prints the secret key, the signing secret, or any
response body beyond the HTTP status code and the sandbox's own `error`
code (if present and a short known string) and whether `received` was
exactly `true`. It makes no AWS calls and writes nothing to any cloud
service; the only network calls are one read-only Stripe API GET and one
POST to the fixed localhost sandbox address above.
"""

import argparse
import getpass
import hashlib
import hmac
import json
import re
import sys
import time
import warnings

import requests
import stripe

# Kept in sync with app/stripe_provider.py and sites/ffm/README.md.
API_VERSION = '2024-06-20'
# Kept in sync with sites/ffm/README.md's "Events to configure" list and
# sites/ffm/scripts/setup-stripe-live.py's WEBHOOK_EVENTS.
ALLOWED_EVENT_TYPES = frozenset({
    'checkout.session.completed',
    'customer.subscription.created',
    'customer.subscription.updated',
    'customer.subscription.deleted',
    'invoice.paid',
    'invoice.payment_succeeded',
    'invoice.payment_failed',
    'charge.refunded',
    'charge.dispute.created',
    'charge.dispute.closed',
})
# Fixed and intentionally not overridable by any argument: this script talks
# to the local sandbox runner (sites/ffm/scripts/run-stripe-sandbox.py) only,
# never a staging/production host.
SANDBOX_WEBHOOK_URL = 'http://127.0.0.1:8766/api/billing/webhook'
EVENT_ID_RE = re.compile(r'^evt_[A-Za-z0-9]+$')
MAX_ATTEMPTS = 3
RETRY_DELAY_SECONDS = 2
RETRYABLE_ERROR_CODE = 'billing_retry_required'
REQUEST_TIMEOUT_SECONDS = 10


class ValidationError(Exception):
    """Raised for any read-only validation failure (no POST attempted yet)."""


class ReplayFailed(Exception):
    """Raised once the sandbox POST path has produced a non-retryable result."""


def validate_event_id(raw_event_id):
    if not EVENT_ID_RE.match(raw_event_id or ''):
        raise ValidationError(
            'Expected a Stripe event id matching evt_<alphanumeric>, e.g. '
            'evt_1UQnPsDYFrEur0X906nvAXLq.'
        )
    return raw_event_id


def _require_interactive_terminal():
    if not sys.stdin.isatty() or not sys.stdout.isatty():
        raise ValidationError(
            'This script must be run attached to a real terminal. Refusing to '
            'read secrets from a non-interactive stream, where getpass would '
            'otherwise echo them in plain text.'
        )


def _hidden_prompt(label):
    _require_interactive_terminal()
    with warnings.catch_warnings():
        warnings.simplefilter('error', getpass.GetPassWarning)
        try:
            return getpass.getpass(label).strip()
        except getpass.GetPassWarning:
            raise ValidationError(
                'Hidden input is unavailable; refusing echoed secret input.'
            ) from None


def prompt_test_secret_key():
    key = _hidden_prompt('Stripe TEST secret key (sk_test_/rk_test_, hidden): ')
    if not key.startswith(('sk_test_', 'rk_test_')):
        raise ValidationError('Expected a key with the exact prefix sk_test_ or rk_test_.')
    return key


def prompt_webhook_signing_secret():
    secret = _hidden_prompt("Local `stripe listen` signing secret (whsec_, hidden): ")
    if not secret.startswith('whsec_'):
        raise ValidationError('Expected the signing secret from `stripe listen` (whsec_...).')
    return secret


def _sanitize_stripe_error(error):
    # Only the exception type and Stripe's own short error code/HTTP status
    # are surfaced; `str(error)` can embed request ids/messages and is
    # deliberately never printed.
    parts = [type(error).__name__]
    code = getattr(error, 'code', None)
    if code:
        parts.append(f'code={code}')
    status = getattr(error, 'http_status', None)
    if status:
        parts.append(f'http_status={status}')
    return ' '.join(parts)


def _plain(value):
    if hasattr(value, 'to_dict_recursive'):
        return value.to_dict_recursive()
    if hasattr(value, 'to_dict'):
        return value.to_dict()
    return dict(value) if value else {}


def fetch_event(secret_key, event_id):
    client = stripe.StripeClient(secret_key, stripe_version=API_VERSION)
    return _plain(client.v1.events.retrieve(event_id))


def validate_sandbox_event(event, requested_event_id):
    """Validate the exact, single event fetched read-only from Stripe.

    Raises ValidationError, without ever attempting a POST, unless every
    check passes: the fetched event is exactly the one requested, is
    unambiguously TEST-mode (`livemode` is exactly False -- not falsy, not
    missing), and is a type this webhook is allowed to receive.
    """
    if event.get('id') != requested_event_id:
        raise ValidationError(
            f'Fetched event id {event.get("id")!r} does not match the requested '
            f'{requested_event_id!r}.'
        )
    if event.get('livemode') is not False:
        raise ValidationError(
            f'Event {requested_event_id} is not unambiguously TEST-mode '
            f'(livemode={event.get("livemode")!r}, expected exactly False). Refusing to replay.'
        )
    event_type = event.get('type')
    if event_type not in ALLOWED_EVENT_TYPES:
        raise ValidationError(
            f'Event type {event_type!r} is not one of this webhook\'s allowed billing '
            f'event types. Refusing to replay.'
        )
    return event


def sign_payload(payload_bytes, signing_secret, timestamp=None):
    timestamp = int(time.time()) if timestamp is None else timestamp
    signed_content = f'{timestamp}.'.encode() + payload_bytes
    signature = hmac.new(signing_secret.encode('utf-8'), signed_content, hashlib.sha256).hexdigest()
    return f't={timestamp},v1={signature}'


def build_signed_request(event, signing_secret):
    payload_bytes = json.dumps(event, sort_keys=True, separators=(',', ':')).encode('utf-8')
    signature_header = sign_payload(payload_bytes, signing_secret)
    return payload_bytes, signature_header


def _safe_error_code(response):
    """Best-effort, bounded extraction of the sandbox's own short error code.

    Never raises and never returns anything beyond a short known-shape
    string; the raw response body is deliberately discarded either way.
    """
    try:
        body = response.json()
    except ValueError:
        return None
    if not isinstance(body, dict):
        return None
    code = body.get('error')
    return code if isinstance(code, str) and len(code) <= 64 else None


def post_event_with_bounded_retry(payload_bytes, signature_header, session=None,
                                   max_attempts=MAX_ATTEMPTS, delay_seconds=RETRY_DELAY_SECONDS):
    """POST once, retrying ONLY the sandbox's own transient-conflict signal.

    Returns (status_code, received_true, error_code) for the final attempt.
    Raises ReplayFailed for any response that is not a bare success and not
    the retryable 503, and for any request-level failure (e.g. connection
    refused) -- those are never silently retried into an assumed success.
    """
    sender = session or requests
    headers = {'Content-Type': 'application/json', 'Stripe-Signature': signature_header}
    last_error_code = None
    for attempt in range(1, max_attempts + 1):
        try:
            response = sender.post(
                SANDBOX_WEBHOOK_URL, data=payload_bytes, headers=headers,
                timeout=REQUEST_TIMEOUT_SECONDS, allow_redirects=False,
            )
        except requests.RequestException as error:
            raise ReplayFailed(f'Request to sandbox failed: {type(error).__name__}') from None

        if response.status_code == 200:
            try:
                body = response.json()
            except ValueError:
                body = None
            received = isinstance(body, dict) and body.get('received') is True
            return response.status_code, received, None

        error_code = _safe_error_code(response)
        last_error_code = error_code
        if response.status_code == 503 and error_code == RETRYABLE_ERROR_CODE and attempt < max_attempts:
            time.sleep(delay_seconds)
            continue
        raise ReplayFailed(
            f'Sandbox returned status={response.status_code} error={error_code or "unknown"} '
            f'after {attempt} attempt(s).'
        )
    # Exhausted retries on the retryable code without ever succeeding.
    raise ReplayFailed(
        f'Sandbox kept returning {RETRYABLE_ERROR_CODE} after {max_attempts} attempts '
        f'(last error={last_error_code or "unknown"}).'
    )


def main(argv=None):
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument('--event-id', required=True, help='Exact Stripe event id to replay (evt_...).')
    args = parser.parse_args(argv)

    try:
        event_id = validate_event_id(args.event_id)
        secret_key = prompt_test_secret_key()
        signing_secret = prompt_webhook_signing_secret()

        print(f'Fetching event {event_id} from Stripe (read-only, api_version={API_VERSION})...')
        event = fetch_event(secret_key, event_id)
        validate_sandbox_event(event, event_id)
        print(f'Event {event_id} type={event["type"]} livemode=False — OK, replaying once.')

        payload_bytes, signature_header = build_signed_request(event, signing_secret)
        status, received, error_code = post_event_with_bounded_retry(payload_bytes, signature_header)
    except ValidationError as error:
        print(f'STOPPED before any sandbox POST: {error}', file=sys.stderr)
        sys.exit(1)
    except stripe.StripeError as error:
        print(f'STOPPED before any sandbox POST (Stripe error): {_sanitize_stripe_error(error)}', file=sys.stderr)
        sys.exit(1)
    except ReplayFailed as error:
        print(f'Replay FAILED: {error}', file=sys.stderr)
        sys.exit(1)

    print(f'Replay result: status={status} received={"true" if received else "false"} error={error_code or "none"}')
    if not received:
        print(
            'The sandbox accepted the request but did not report received=true; '
            'this does not confirm success. Check the sandbox terminal/logs '
            'yourself for the actual processing outcome.',
            file=sys.stderr,
        )
        sys.exit(1)


if __name__ == '__main__':
    main()
