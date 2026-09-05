"""Transactional email sending via SES v1 (not SESv2 — kept consistent
with using the simplest boto3 client API for this small set of plain-text
transactional emails).

Reads APP_BASE_URL / SES_SENDER_EMAIL / SES_CONFIGURATION_SET from
os.environ at call time (not at import time) so tests can override them
per-test via monkeypatch/os.environ, matching how app/models.py reads
DYNAMODB_USERS_TABLE.
"""
import os

import boto3


def _ses_client():
    return boto3.client(
        'ses',
        region_name=os.environ.get('AWS_DEFAULT_REGION', 'eu-central-1'),
    )


def _sender():
    return os.environ.get('SES_SENDER_EMAIL', 'no-reply@ffm.derschweigert.de')


def _base_url():
    return os.environ.get('APP_BASE_URL', 'https://ffm.derschweigert.de')


def _configuration_set():
    return os.environ.get('SES_CONFIGURATION_SET', '')


def _send(to_email, subject, body_text):
    """Send a plain-text email. Callers are expected to wrap this in
    try/except so a transient SES failure doesn't 500 the whole request —
    this function itself does not swallow errors, it just performs the send."""
    kwargs = {
        'Source': _sender(),
        'Destination': {'ToAddresses': [to_email]},
        'Message': {
            'Subject': {'Data': subject, 'Charset': 'UTF-8'},
            'Body': {'Text': {'Data': body_text, 'Charset': 'UTF-8'}},
        },
    }
    # Tagging the send with our configuration set is what lets CloudWatch
    # track Send/Bounce/Complaint/Reject counts and the alarms in
    # infra/terraform/sites/ffm/main.tf actually fire. Omitted (rather than
    # sent as an empty string) when unset, since SES rejects an empty
    # ConfigurationSetName — local/dev/test runs simply aren't tracked.
    configuration_set = _configuration_set()
    if configuration_set:
        kwargs['ConfigurationSetName'] = configuration_set
    _ses_client().send_email(**kwargs)


def send_verification_email(to_email, username, token):
    link = f"{_base_url()}/?verify_token={token}"
    _send(
        to_email,
        subject="Verify your Arithmo Slayer account",
        body_text=(
            f"Hi {username},\n\n"
            f"Please verify your email address by visiting the link below:\n"
            f"{link}\n\n"
            f"This link expires in 24 hours. If you didn't create this account, "
            f"you can ignore this email.\n"
        ),
    )


def send_password_reset_email(to_email, username, token):
    link = f"{_base_url()}/?reset_token={token}"
    _send(
        to_email,
        subject="Reset your Arithmo Slayer password",
        body_text=(
            f"Hi {username},\n\n"
            f"We received a request to reset your password. Visit the link below "
            f"to choose a new one:\n"
            f"{link}\n\n"
            f"This link expires in 1 hour. If you didn't request this, "
            f"you can ignore this email.\n"
        ),
    )


def send_email_change_confirmation(to_email, username, token):
    link = f"{_base_url()}/?confirm_email_token={token}"
    _send(
        to_email,
        subject="Confirm your new email address for Arithmo Slayer",
        body_text=(
            f"Hi {username},\n\n"
            f"Please confirm this is your new email address by visiting the link below:\n"
            f"{link}\n\n"
            f"This link expires in 24 hours. If you didn't request this change, "
            f"you can ignore this email — your account will keep using its current address.\n"
        ),
    )
