"""Run real Stripe sandbox flows against ephemeral, mocked AWS data."""

import argparse
import getpass
import os
from pathlib import Path
import secrets

import bcrypt
import boto3
from moto import mock_aws


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--price-id', required=True)
    parser.add_argument('--portal-id', default='')
    parser.add_argument('--resume-subscription', default='')
    parser.add_argument('--offline-check', action='store_true')
    args = parser.parse_args()
    if not args.price_id.startswith('price_'):
        parser.error('Expected a Stripe test Price ID.')
    if not args.offline_check:
        key = getpass.getpass('Stripe TEST secret key (hidden): ').strip()
        if not key.startswith(('sk_test_', 'rk_test_')):
            parser.error('Only Stripe test keys are accepted.')
        webhook_secret = getpass.getpass('Stripe CLI webhook signing secret (hidden): ').strip()
        if not webhook_secret.startswith('whsec_'):
            parser.error('Expected the signing secret from stripe listen.')
        os.environ['STRIPE_SECRET_KEY'] = key
        os.environ['STRIPE_WEBHOOK_SECRET'] = webhook_secret
    else:
        os.environ.pop('STRIPE_SECRET_KEY', None)
        os.environ.pop('STRIPE_WEBHOOK_SECRET', None)

    os.environ.update({
        'SECRET_KEY': secrets.token_hex(32),
        'AWS_ACCESS_KEY_ID': 'sandbox',
        'AWS_SECRET_ACCESS_KEY': 'sandbox',
        'AWS_SESSION_TOKEN': 'sandbox',
        'AWS_DEFAULT_REGION': 'eu-central-1',
        'AWS_EC2_METADATA_DISABLED': 'true',
        'FLASK_ENV': 'development',
        'DYNAMODB_USERS_TABLE': 'ffm-sandbox-users',
        'DYNAMODB_SCORES_TABLE': 'ffm-sandbox-scores',
        'DYNAMODB_RATELIMIT_TABLE': 'ffm-sandbox-ratelimits',
        'APP_BASE_URL': 'http://127.0.0.1:8766',
        'RATELIMIT_STORAGE_URI': 'memory://',
        'SES_CONFIGURATION_SET': '',
    })
    os.environ.pop('DYNAMODB_ENDPOINT_URL', None)

    with mock_aws():
        from flask import abort, send_from_directory
        from sites.ffm.app import create_app
        from sites.ffm.app.config import BaseConfig
        from sites.ffm.app.extensions import limiter
        from sites.ffm.app import billing, billing_store, models, stripe_provider

        class SandboxConfig(BaseConfig):
            ACCESS_CONTROL_ENABLED = True
            BILLING_ENABLED = True
            BILLING_SALES_ENABLED = True
            # Consent UI is tested against draft terms; this is not launch approval.
            BILLING_TERMS_APPROVED = True
            GRANDFATHER_CUTOFF = '2020-01-01T00:00:00+00:00'
            STRIPE_PRICE_ID = args.price_id
            STRIPE_PORTAL_CONFIGURATION_ID = args.portal_id
            STRIPE_CHECKOUT_TERMS_CONSENT_ENABLED = False
            TURNSTILE_ENABLED = False

        ddb = boto3.resource('dynamodb', region_name='eu-central-1')
        for name in ('ffm-sandbox-users', 'ffm-sandbox-scores'):
            ddb.create_table(
                TableName=name,
                KeySchema=[{'AttributeName': 'pk', 'KeyType': 'HASH'},
                           {'AttributeName': 'sk', 'KeyType': 'RANGE'}],
                AttributeDefinitions=[{'AttributeName': 'pk', 'AttributeType': 'S'},
                                      {'AttributeName': 'sk', 'AttributeType': 'S'}],
                BillingMode='PAY_PER_REQUEST',
            )
        app = create_app(SandboxConfig)
        static = Path(__file__).resolve().parents[1] / 'static'

        @app.get('/')
        @limiter.exempt
        def index():
            return send_from_directory(static, 'index.html')

        @app.get('/<path:filename>')
        @limiter.exempt
        def asset(filename):
            if filename.startswith('api/'):
                abort(404)
            return send_from_directory(static, filename)

        with app.app_context():
            resumed = None
            if args.resume_subscription:
                if args.offline_check:
                    parser.error('Cannot resume a Stripe subscription during an offline check.')
                resumed = stripe_provider.get_subscription(args.resume_subscription)
                if (not resumed.get('metadata', {}).get('billing_uuid')
                        or [item['price']['id'] for item in resumed['items']['data']] != [args.price_id]):
                    parser.error('Resume requires a subscription created by this game with the selected test price.')
            password = secrets.token_urlsafe(12)
            password_hash = bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()
            for username in ('sandbox-player', 'sandbox-founder', 'sandbox-gift'):
                models.create_user(username, username + '@example.com', password_hash)
                models.set_email_verified(username, True)
                if resumed and username == 'sandbox-player':
                    models._users().update_item(
                        Key={'pk': 'USER#sandbox-player', 'sk': 'PROFILE'},
                        UpdateExpression='SET stable_id = :identity',
                        ExpressionAttributeValues={':identity': resumed['metadata']['billing_uuid']},
                    )
                models.ensure_stable_id(username)
                models._users().update_item(
                    Key={'pk': f'USER#{username}', 'sk': 'PROFILE'},
                    UpdateExpression='SET created_at = :created',
                    ExpressionAttributeValues={
                        ':created': '2019-01-01T00:00:00+00:00' if username == 'sandbox-founder'
                        else '2026-01-01T00:00:00+00:00',
                    },
                )
            codes = [billing_store.create_access_code()[0] for _ in range(3)]
            if args.offline_check:
                client = app.test_client()
                assert client.get('/api/health').status_code == 200
                assert client.get('/').status_code == 200
                assert client.get('/api/levels/3').status_code == 401
                assert client.get('/app/level_data.json').status_code == 404
                assert client.get('/game/level-fiend-allocator.html').status_code == 404
                for _ in range(60):
                    assert client.get('/styles.css').status_code == 200
                print('Offline sandbox checks passed; no Stripe requests made.')
                return
            stripe_provider.validate_price(args.price_id)
            if resumed:
                identity = resumed['metadata']['billing_uuid']
                billing_store.put_billing_username_mapping(identity, 'sandbox-player')
                billing_store.put_billing_state(identity, customer_id=resumed['customer'],
                                               subscription_id=resumed['id'])
                with billing.billing_lock(identity):
                    billing.reconcile_subscription(identity, resumed['id'])

        print('Only Stripe test payments are enabled. AWS data is mocked in memory.')
        print('Accounts and local code state reset when this server stops.')
        print('Stripe sandbox subscriptions persist; cancel them before stopping.')
        if resumed:
            print('Resumed subscription:', resumed['id'])
        print(f'Accounts: sandbox-player, sandbox-founder, sandbox-gift; local password: {password}')
        print('Three-month test codes:', ', '.join(codes))
        print('Open http://127.0.0.1:8766/ in a fresh browser tab (no simulation hooks).')
        app.run(host='127.0.0.1', port=8766, debug=False, use_reloader=False)


if __name__ == '__main__':
    main()
