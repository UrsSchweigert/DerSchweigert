"""Move the ffm Stripe webhook endpoint to a new API version without dropping events.

Stripe renders each webhook event at the version pinned on its endpoint, and an
endpoint's version cannot be changed: it has to be replaced. This does that in
two phases so no event is ever rejected:

  start   Create a new endpoint for the same URL with the same events and the same
          enabled/disabled status, pinned to --api-version. Store
          "<old secret>,<new secret>" in the Secrets Manager secret the Lambda reads
          (app/stripe_provider.py accepts either), then recycle the Lambda so new
          instances load it. Both endpoints now deliver; ffm de-duplicates events
          by id, so the overlap is harmless.
  finish  Delete the old endpoint, store only the new secret, recycle again.

The Stripe key comes from Secrets Manager (--key-secret-id) or a hidden prompt,
never from arguments. Nothing secret is printed. Every write needs --yes, and
without it the script only reports what it would do. Test-mode and live-mode
keys both work, so the whole procedure can be rehearsed in test mode first.

    python sites/ffm/scripts/rotate-stripe-webhook-endpoint.py start  --yes
    python sites/ffm/scripts/rotate-stripe-webhook-endpoint.py finish --yes
"""
import argparse
import getpass
import sys
import time

import boto3
import stripe

TARGET_API_VERSION = '2026-10-28.endive'  # app/stripe_provider.py API_VERSION
WEBHOOK_URL = 'https://ffm.derschweigert.de/api/billing/webhook'
REGION = 'eu-central-1'
WEBHOOK_SECRET_ID = 'ffm/stripe-webhook-secret'
STRIPE_KEY_SECRET_ID = 'ffm/stripe-secret-key'
LAMBDA_NAME = 'ffm-api'


def _stripe_key(args, secrets):
    if args.key_secret_id:
        key = secrets.get_secret_value(SecretId=args.key_secret_id)['SecretString'].strip()
    else:
        key = getpass.getpass('Stripe secret key (hidden): ').strip()
    if not key.startswith(('sk_live_', 'rk_live_', 'sk_test_', 'rk_test_')):
        sys.exit('refusing: that is not a Stripe secret or restricted key')
    return key


def _endpoints_for(client, url):
    return [e for e in client.v1.webhook_endpoints.list({'limit': 100}).auto_paging_iter() if e.url == url]


def _recycle_lambda(lam, name, note):
    """New execution environments re-read the secret at cold start (lambda/handler.py)."""
    current = lam.get_function_configuration(FunctionName=name).get('Description', '')
    base = current.split(' [webhook secret ')[0]
    lam.update_function_configuration(FunctionName=name, Description=f'{base} [webhook secret {note}]')
    lam.get_waiter('function_updated_v2').wait(FunctionName=name)


def start(args, client, secrets, lam):
    endpoints = _endpoints_for(client, args.url)
    current = [e for e in endpoints if e.api_version != args.api_version]
    already = [e for e in endpoints if e.api_version == args.api_version]
    if already:
        sys.exit(f'stop: {already[0].id} already targets {args.url} at {args.api_version}; run "finish".')
    if len(current) != 1:
        sys.exit(f'stop: expected exactly one endpoint for {args.url}, found {len(current)}.')
    old = current[0]
    print(f'old endpoint: {old.id} api_version={old.api_version} status={old.status} '
          f'events={len(old.enabled_events)} livemode={old.livemode}')
    print(f'will create:  same url and events, api_version={args.api_version}, status={old.status}')
    print(f'will store:   both signing secrets in the webhook secret, then recycle Lambda {args.lambda_name}')
    if not args.yes:
        print('dry run: nothing changed (pass --yes to apply)')
        return
    new = client.v1.webhook_endpoints.create({
        'url': args.url, 'enabled_events': list(old.enabled_events), 'api_version': args.api_version,
        'description': f'ffm billing ({args.api_version}); replaces {old.id}',
    })
    if old.status == 'disabled':
        client.v1.webhook_endpoints.update(new.id, {'disabled': True})
    old_secret = secrets.get_secret_value(SecretId=args.webhook_secret_id)['SecretString'].strip()
    secrets.put_secret_value(SecretId=args.webhook_secret_id, SecretString=f'{old_secret},{new.secret}')
    if args.lambda_name:
        _recycle_lambda(lam, args.lambda_name, f'overlap {time.strftime("%Y-%m-%dT%H:%MZ", time.gmtime())}')
    print(f'created {new.id}; both secrets accepted. Watch deliveries, then run "finish".')


def finish(args, client, secrets, lam):
    endpoints = _endpoints_for(client, args.url)
    new = [e for e in endpoints if e.api_version == args.api_version]
    old = [e for e in endpoints if e.api_version != args.api_version]
    if len(new) != 1:
        sys.exit(f'stop: expected exactly one {args.api_version} endpoint for {args.url}, found {len(new)}.')
    stored = [s.strip() for s in secrets.get_secret_value(SecretId=args.webhook_secret_id)['SecretString'].split(',')
              if s.strip()]
    if len(stored) != 2:
        sys.exit(f'stop: {args.webhook_secret_id} holds {len(stored)} secret(s), expected the two from "start".')
    print(f'keep:   {new[0].id} api_version={new[0].api_version} status={new[0].status}')
    print(f'delete: {[e.id for e in old]}; store only the new secret; recycle Lambda {args.lambda_name}')
    if not args.yes:
        print('dry run: nothing changed (pass --yes to apply)')
        return
    secrets.put_secret_value(SecretId=args.webhook_secret_id, SecretString=stored[1])
    if args.lambda_name:
        _recycle_lambda(lam, args.lambda_name, f'rotated {time.strftime("%Y-%m-%dT%H:%MZ", time.gmtime())}')
    for endpoint in old:
        client.v1.webhook_endpoints.delete(endpoint.id)
    print(f'done: only {new[0].id} ({args.api_version}) remains.')


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('phase', choices=['start', 'finish'])
    parser.add_argument('--yes', action='store_true', help='apply the changes (default: dry run)')
    parser.add_argument('--api-version', default=TARGET_API_VERSION)
    parser.add_argument('--url', default=WEBHOOK_URL)
    parser.add_argument('--region', default=REGION)
    parser.add_argument('--webhook-secret-id', default=WEBHOOK_SECRET_ID)
    parser.add_argument('--key-secret-id', default=STRIPE_KEY_SECRET_ID,
                        help='Secrets Manager id holding the Stripe key; empty to be prompted instead')
    parser.add_argument('--lambda-name', default=LAMBDA_NAME, help='empty to skip recycling the Lambda')
    args = parser.parse_args(argv)
    secrets = boto3.client('secretsmanager', region_name=args.region)
    lam = boto3.client('lambda', region_name=args.region) if args.lambda_name else None
    client = stripe.StripeClient(_stripe_key(args, secrets), stripe_version=args.api_version)
    (start if args.phase == 'start' else finish)(args, client, secrets, lam)


if __name__ == '__main__':
    main()
