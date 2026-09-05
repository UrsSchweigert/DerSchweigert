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


_resolve_secret_key()

import apig_wsgi
from app import create_app

flask_app = create_app()
lambda_handler = apig_wsgi.make_lambda_handler(flask_app)
