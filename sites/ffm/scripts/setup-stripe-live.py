"""One-time, interactive helper that provisions the LIVE Stripe + AWS
resources needed for the ffm site's Phase 3 billing rollout:

  - A LIVE Stripe webhook endpoint for
    https://ffm.derschweigert.de/api/billing/webhook, pinned to
    api_version 2024-06-20 (see app/stripe_provider.py), subscribed to
    the 10 events documented in sites/ffm/README.md.
  - Two AWS Secrets Manager secrets the Lambda resolves at runtime
    (sites/ffm/lambda/handler.py): ffm/stripe-secret-key and
    ffm/stripe-webhook-secret.

This script makes REAL live-mode Stripe API calls and REAL AWS writes,
but only after read-only validation passes and you type an exact
confirmation phrase. It is meant to be run locally, once, by a human
watching the terminal -- never from CI, never non-interactively, and it
accepts no flag that bypasses the typed confirmation.

Order of operations:
  1. Read-only validation (no writes, nothing yet requires the secret key):
     - The AWS caller is account 113725432218 in region eu-central-1.
     - Neither ffm/stripe-secret-key nor ffm/stripe-webhook-secret
       already exist in Secrets Manager.
  2. Prompt for the LIVE secret key (getpass, hidden; requires a real
     terminal -- refuses to fall back to echoed input).
  3. More read-only validation using that key:
     - The given LIVE Price ID is livemode, active, EUR 1.99 (unit_amount
       300), recurring every 3 months, tax_behavior=inclusive.
     - The given LIVE portal Configuration ID is livemode, active, allows
       cancellation (at_period_end) and payment method updates, and has
       subscription updates (upgrade/downgrade) disabled.
     - No existing webhook endpoint already targets the production URL.
  4. Print a summary (IDs/status only) and require a typed confirmation
     phrase before any writes.
  5. Create ffm/stripe-secret-key in Secrets Manager (plain SecretString).
  6. Create the LIVE webhook endpoint (pinned version + 10 events).
  7. Disable that endpoint. The Stripe API does not support creating an
     endpoint already disabled (WebhookEndpointCreateParams has no
     `disabled`/`status` field -- only WebhookEndpointUpdateParams does),
     so this is an immediate follow-up update instead of a single call.
     It stays disabled until the deployed backend's billing processing
     and secret configuration have been enabled and verified separately.
  8. Create ffm/stripe-webhook-secret from the signing secret Stripe
     returns at creation time (API retrieval does not return the secret;
     see the partial-failure guidance below if this step fails).

This script never echoes the Stripe secret key, the webhook signing
secret, or any raw Stripe/AWS response body/message -- only non-secret
IDs, ARNs and status fields are printed. Errors are reported by
exception type and error code only. It does not touch the repository,
Terraform state, or any deployment; see the printed next steps for that.
"""

import argparse
import getpass
import sys
import warnings

import boto3
import botocore.exceptions
import stripe

# Not imported from app/stripe_provider.py: importing that module runs
# app/__init__.py's package init, which requires a Flask SECRET_KEY env var
# this script has no business setting. Kept as a literal instead, in sync
# with API_VERSION there and with the "Pinned webhook API version" in
# sites/ffm/README.md.
API_VERSION = '2024-06-20'
WEBHOOK_URL = 'https://ffm.derschweigert.de/api/billing/webhook'
EXPECTED_ACCOUNT_ID = '113725432218'
EXPECTED_REGION = 'eu-central-1'
SECRET_KEY_NAME = 'ffm/stripe-secret-key'
WEBHOOK_SECRET_NAME = 'ffm/stripe-webhook-secret'
# Kept in sync with sites/ffm/README.md's "Events to configure" list.
WEBHOOK_EVENTS = [
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
]
CONFIRMATION_PHRASE = 'CREATE LIVE STRIPE WEBHOOK'


class ValidationError(Exception):
    """Raised for any read-only validation failure (not a write failure)."""


def _sanitize_stripe_error(error):
    # Only the exception type and Stripe's own short error code/HTTP status
    # are surfaced; `str(error)`/`.user_message` can embed request details
    # and are deliberately never printed.
    parts = [type(error).__name__]
    code = getattr(error, 'code', None)
    if code:
        parts.append(f'code={code}')
    status = getattr(error, 'http_status', None)
    if status:
        parts.append(f'http_status={status}')
    return ' '.join(parts)


def _sanitize_aws_error(error):
    if isinstance(error, botocore.exceptions.ClientError):
        aws_code = error.response.get('Error', {}).get('Code', 'Unknown')
        status = error.response.get('ResponseMetadata', {}).get('HTTPStatusCode')
        parts = [type(error).__name__, f'code={aws_code}']
        if status:
            parts.append(f'http_status={status}')
        return ' '.join(parts)
    return type(error).__name__


def _require_interactive_terminal():
    if not sys.stdin.isatty() or not sys.stdout.isatty():
        raise ValidationError(
            'This script must be run attached to a real terminal. '
            'Refusing to read the secret key from a non-interactive '
            'stream, where getpass would otherwise echo it in plain text.'
        )


def _prompt_live_secret_key():
    _require_interactive_terminal()
    with warnings.catch_warnings():
        warnings.simplefilter('error', getpass.GetPassWarning)
        try:
            key = getpass.getpass('Stripe LIVE secret key (hidden, not echoed): ').strip()
        except getpass.GetPassWarning:
            raise ValidationError('Hidden input is unavailable; refusing echoed secret input.') from None
    if not key.startswith('sk_live_'):
        raise ValidationError('Expected a key with the exact prefix sk_live_.')
    return key


def check_aws_identity(sts_client, session):
    region = session.region_name
    if region != EXPECTED_REGION:
        raise ValidationError(
            f'Configured AWS region is {region!r}, expected {EXPECTED_REGION!r}.'
        )
    identity = sts_client.get_caller_identity()
    account_id = identity.get('Account')
    if account_id != EXPECTED_ACCOUNT_ID:
        raise ValidationError(
            f'Configured AWS account is {account_id!r}, expected {EXPECTED_ACCOUNT_ID!r}.'
        )
    return account_id, region


def check_secret_absent(secretsmanager_client, name):
    try:
        secretsmanager_client.describe_secret(SecretId=name)
    except botocore.exceptions.ClientError as error:
        if error.response.get('Error', {}).get('Code') == 'ResourceNotFoundException':
            return
        raise
    raise ValidationError(
        f'Secrets Manager secret {name!r} already exists. Stopping without '
        'reading, overwriting, or duplicating it. If it is stale, delete or '
        'replace it deliberately with the AWS CLI/console first, then rerun '
        'this script.'
    )


def check_webhook_url_not_registered(stripe_client):
    for endpoint in stripe_client.v1.webhook_endpoints.list({'limit': 100}).auto_paging_iter():
        if endpoint.url == WEBHOOK_URL:
            raise ValidationError(
                f'A webhook endpoint ({endpoint.id}, status={endpoint.status}) '
                f'already targets {WEBHOOK_URL}. Stopping without creating a '
                'duplicate. Inspect/resolve the existing endpoint in the '
                'Stripe dashboard or API first, then rerun this script.'
            )


def validate_live_price(stripe_client, price_id):
    price = stripe_client.v1.prices.retrieve(price_id)
    recurring = price.recurring
    problems = []
    if not price.livemode:
        problems.append('not livemode')
    if not price.active:
        problems.append('not active')
    if price.currency != 'eur':
        problems.append(f'currency={price.currency!r} (expected eur)')
    if price.unit_amount != 199:
        problems.append(f'unit_amount={price.unit_amount!r} (expected 199)')
    if not recurring or recurring.interval != 'month' or recurring.interval_count != 3:
        problems.append('recurring is not every 3 months')
    if price.tax_behavior != 'inclusive':
        problems.append(f'tax_behavior={price.tax_behavior!r} (expected inclusive)')
    if problems:
        raise ValidationError(f'Price {price_id} failed validation: {"; ".join(problems)}.')
    return price


def validate_live_portal_configuration(stripe_client, configuration_id):
    config = stripe_client.v1.billing_portal.configurations.retrieve(configuration_id)
    features = config.features
    cancel = features.subscription_cancel
    payment_update = features.payment_method_update
    subscription_update = features.subscription_update
    problems = []
    if not config.livemode:
        problems.append('not livemode')
    if not config.active:
        problems.append('not active')
    if not (cancel and cancel.enabled and cancel.mode == 'at_period_end'):
        problems.append('cancellation is not enabled for end-of-period')
    if not (payment_update and payment_update.enabled):
        problems.append('payment method updates are not enabled')
    if subscription_update and subscription_update.enabled:
        problems.append('subscription updates (upgrade/downgrade) are enabled, expected disabled')
    if problems:
        raise ValidationError(
            f'Portal configuration {configuration_id} failed validation: {"; ".join(problems)}.'
        )
    return config


def main():
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument('--price-id', required=True, help='LIVE Stripe Price ID (price_...).')
    parser.add_argument(
        '--portal-id', required=True, help='LIVE Stripe portal Configuration ID (bpc_...).',
    )
    args = parser.parse_args()
    if not args.price_id.startswith('price_'):
        parser.error('Expected a Stripe Price ID (price_...).')
    if not args.portal_id.startswith('bpc_'):
        parser.error('Expected a Stripe billing portal Configuration ID (bpc_...).')

    try:
        session = boto3.Session()
        sts_client = session.client('sts')
        secretsmanager_client = session.client('secretsmanager')

        print('--- Read-only validation (AWS) ---')
        account_id, region = check_aws_identity(sts_client, session)
        print(f'AWS account: {account_id}  region: {region}')
        check_secret_absent(secretsmanager_client, SECRET_KEY_NAME)
        check_secret_absent(secretsmanager_client, WEBHOOK_SECRET_NAME)
        print(f'Confirmed absent: {SECRET_KEY_NAME}, {WEBHOOK_SECRET_NAME}')

        secret_key = _prompt_live_secret_key()
        stripe_client = stripe.StripeClient(secret_key, stripe_version=API_VERSION)

        print('--- Read-only validation (Stripe, LIVE mode) ---')
        price = validate_live_price(stripe_client, args.price_id)
        print(f'Price {price.id}: livemode active EUR 1.99 / 3 months, tax_behavior=inclusive — OK')
        portal = validate_live_portal_configuration(stripe_client, args.portal_id)
        print(f'Portal configuration {portal.id}: livemode active, cancel+payment-update only — OK')
        check_webhook_url_not_registered(stripe_client)
        print(f'No existing webhook endpoint targets {WEBHOOK_URL}')
    except ValidationError as error:
        print(f'STOPPED before any writes: {error}', file=sys.stderr)
        sys.exit(1)
    except (botocore.exceptions.ClientError, botocore.exceptions.BotoCoreError) as error:
        print(f'STOPPED before any writes (AWS error): {_sanitize_aws_error(error)}', file=sys.stderr)
        sys.exit(1)
    except stripe.StripeError as error:
        print(f'STOPPED before any writes (Stripe error): {_sanitize_stripe_error(error)}', file=sys.stderr)
        sys.exit(1)

    print()
    print('About to create, in this order:')
    print(f'  1. AWS Secrets Manager secret {SECRET_KEY_NAME!r} (the LIVE secret key you entered)')
    print(f'  2. A LIVE Stripe webhook endpoint for {WEBHOOK_URL}')
    print('     pinned to api_version', API_VERSION, 'with', len(WEBHOOK_EVENTS), 'events')
    print('     — created enabled, then immediately disabled until backend billing is configured)')
    print(f'  3. AWS Secrets Manager secret {WEBHOOK_SECRET_NAME!r} (that endpoint\'s signing secret)')
    print()
    print('This does not touch the repository, Terraform, or any deployment.')
    print(f'Type exactly "{CONFIRMATION_PHRASE}" to proceed, or anything else to abort.')
    try:
        confirmation = input('> ').strip()
    except EOFError:
        confirmation = ''
    if confirmation != CONFIRMATION_PHRASE:
        print('Confirmation phrase did not match. No writes were made.', file=sys.stderr)
        sys.exit(1)

    print()
    print('--- Writes ---')
    try:
        secret_key_response = secretsmanager_client.create_secret(
            Name=SECRET_KEY_NAME, SecretString=secret_key,
        )
    except (botocore.exceptions.ClientError, botocore.exceptions.BotoCoreError) as error:
        print(
            f'FAILED creating {SECRET_KEY_NAME}: {_sanitize_aws_error(error)}\n'
            f'No Stripe writes were attempted. AWS creation may have succeeded '
            f'if its response was lost; inspect {SECRET_KEY_NAME} before retrying.',
            file=sys.stderr,
        )
        sys.exit(1)
    secret_key_arn = secret_key_response['ARN']
    print(f'Created secret: {secret_key_arn}')

    try:
        endpoint = stripe_client.v1.webhook_endpoints.create({
            'url': WEBHOOK_URL,
            'enabled_events': WEBHOOK_EVENTS,
            'api_version': API_VERSION,
        })
    except stripe.StripeError as error:
        print(
            f'FAILED creating the webhook endpoint: {_sanitize_stripe_error(error)}\n'
            f'Residue: AWS secret {secret_key_arn} was already created and is NOT '
            'rolled back automatically. Stripe creation may also have succeeded '
            'if its response was lost; inspect webhooks for the production URL '
            'before retrying. Do not blindly rerun or delete resources.',
            file=sys.stderr,
        )
        sys.exit(1)
    webhook_signing_secret = endpoint.secret
    print(f'Created webhook endpoint: {endpoint.id} (status={endpoint.status})')

    try:
        endpoint = stripe_client.v1.webhook_endpoints.update(endpoint.id, {'disabled': True})
    except stripe.StripeError as error:
        print(
            f'FAILED disabling webhook endpoint {endpoint.id}: {_sanitize_stripe_error(error)}\n'
            f'Residue: AWS secret {secret_key_arn} and webhook endpoint {endpoint.id} '
            '(possibly still ENABLED) were already created and are NOT rolled back '
            'automatically. Disable the endpoint manually in the Stripe dashboard/API '
            'before any payments backend is live, then rerun the remaining steps '
            '(creating the webhook-secret AWS secret) by hand using the signing '
            'secret revealed in the Stripe dashboard. Never paste it into chat.',
            file=sys.stderr,
        )
        sys.exit(1)
    print(f'Disabled webhook endpoint: {endpoint.id} (status={endpoint.status})')

    try:
        webhook_secret_response = secretsmanager_client.create_secret(
            Name=WEBHOOK_SECRET_NAME, SecretString=webhook_signing_secret,
        )
    except (botocore.exceptions.ClientError, botocore.exceptions.BotoCoreError) as error:
        print(
            f'FAILED creating {WEBHOOK_SECRET_NAME}: {_sanitize_aws_error(error)}\n'
            f'Residue: AWS secret {secret_key_arn} and webhook endpoint {endpoint.id} '
            '(status=disabled) were already created and are NOT rolled back '
            'automatically. AWS creation may have succeeded if its response was '
            f'lost; inspect {WEBHOOK_SECRET_NAME} first. If absent, reveal the '
            "endpoint's signing secret in the Stripe dashboard and store it "
            'directly in AWS Secrets Manager, never in chat.',
            file=sys.stderr,
        )
        sys.exit(1)
    webhook_secret_arn = webhook_secret_response['ARN']
    print(f'Created secret: {webhook_secret_arn}')

    print()
    print('--- Done ---')
    print(f'Secret ARN (Stripe key):     {secret_key_arn}')
    print(f'Secret ARN (webhook secret): {webhook_secret_arn}')
    print(f'Webhook endpoint:            {endpoint.id} (status={endpoint.status})')
    print()
    print('Nothing in the repository was changed, and nothing was deployed or')
    print('activated. Remaining manual steps (not performed by this script):')
    print('  - Set stripe_secret_key_arn / stripe_webhook_secret_arn Terraform')
    print('    variables to the two ARNs above when you are ready to deploy.')
    print('  - Leave the webhook endpoint disabled until the payments backend')
    print('    processing and secret configuration are enabled and verified;')
    print('    only then enable this endpoint in the Stripe dashboard.')
    print('  - This script does not run `terraform apply` or any deploy step.')


if __name__ == '__main__':
    main()
