import os


def _resolve_secret_key():
    """Populate SECRET_KEY from Secrets Manager when SECRET_KEY_ARN is set.

    Terraform provisions the JWT signing key in Secrets Manager (see
    infra/terraform/sites/ffm/main.tf) and passes its ARN to the Lambda
    as SECRET_KEY_ARN rather than the raw value, so config.py's
    `os.environ['SECRET_KEY']` read still works unchanged. Local/dev/test
    setups that export SECRET_KEY directly are unaffected since this is a
    no-op when SECRET_KEY_ARN isn't set.
    """
    if os.environ.get('SECRET_KEY'):
        return
    secret_arn = os.environ.get('SECRET_KEY_ARN')
    if not secret_arn:
        return

    import boto3
    response = boto3.client('secretsmanager').get_secret_value(SecretId=secret_arn)
    os.environ['SECRET_KEY'] = response['SecretString']


def _resolve_turnstile_secret_key():
    """Populate TURNSTILE_SECRET_KEY from Secrets Manager when
    TURNSTILE_SECRET_KEY_ARN is set. Mirrors _resolve_secret_key() above —
    the secret itself was created directly via `aws secretsmanager
    create-secret` (its value originates externally at Cloudflare, not
    from Terraform), but the Lambda still only ever receives its ARN,
    never the raw value, via Terraform's environment_variables."""
    if os.environ.get('TURNSTILE_SECRET_KEY'):
        return
    secret_arn = os.environ.get('TURNSTILE_SECRET_KEY_ARN')
    if not secret_arn:
        return

    import boto3
    response = boto3.client('secretsmanager').get_secret_value(SecretId=secret_arn)
    os.environ['TURNSTILE_SECRET_KEY'] = response['SecretString']


def _resolve_stripe_secret_key():
    """Populate STRIPE_SECRET_KEY from Secrets Manager when
    STRIPE_SECRET_KEY_ARN is set. Only invoked if the ARN is provided
    (billing_enabled=true and stripe secrets configured in Terraform)."""
    if os.environ.get('STRIPE_SECRET_KEY'):
        return
    secret_arn = os.environ.get('STRIPE_SECRET_KEY_ARN')
    if not secret_arn:
        return

    import boto3
    response = boto3.client('secretsmanager').get_secret_value(SecretId=secret_arn)
    os.environ['STRIPE_SECRET_KEY'] = response['SecretString']


def _resolve_stripe_webhook_secret():
    """Populate STRIPE_WEBHOOK_SECRET from Secrets Manager when
    STRIPE_WEBHOOK_SECRET_ARN is set. Only invoked if the ARN is provided
    (billing_enabled=true and stripe webhook secret configured in Terraform)."""
    if os.environ.get('STRIPE_WEBHOOK_SECRET'):
        return
    secret_arn = os.environ.get('STRIPE_WEBHOOK_SECRET_ARN')
    if not secret_arn:
        return

    import boto3
    response = boto3.client('secretsmanager').get_secret_value(SecretId=secret_arn)
    os.environ['STRIPE_WEBHOOK_SECRET'] = response['SecretString']


_resolve_secret_key()
_resolve_turnstile_secret_key()
_resolve_stripe_secret_key()
_resolve_stripe_webhook_secret()

import apig_wsgi
from app import create_app

flask_app = create_app()
lambda_handler = apig_wsgi.make_lambda_handler(flask_app)
