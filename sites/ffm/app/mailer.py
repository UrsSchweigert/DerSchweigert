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
        subject="Welcome to Arithmo Slayer — verify your account",
        body_text=(
            f"Hi {username},\n\n"
            f"Thanks for signing up for Arithmo Slayer!\n\n"
            f"Arithmo Slayer is a fast-paced arcade game that turns mental math "
            f"practice into a reflex challenge. Fiends march toward you carrying "
            f"an arithmetic problem — solve it before the timer runs out to "
            f"strike them down. It's a fun way to sharpen addition, subtraction, "
            f"multiplication, and division under a bit of friendly time pressure, "
            f"while competing for a spot on the leaderboard.\n\n"
            f"Quick manual:\n"
            f"- Pick a difficulty on the start screen: Easy (15s / 7 hearts), "
            f"Medium (10s / 5 hearts), or Hard (5s / 3 hearts).\n"
            f"- Each fiend shows a math problem above its head. Answer it — tap "
            f"a multiple-choice button, or type the number and hit Strike! — "
            f"before the timer runs out to defeat it.\n"
            f"- A wrong answer or a timeout costs a heart and resets your combo "
            f"streak. Run out of hearts and the run ends.\n"
            f"- Chain correct answers to build a combo streak: past combo 5 you "
            f"can unleash a fireball, past combo 10 a lightning bolt, and past "
            f"combo 20 a dragon that can strike multiple fiends at once.\n"
            f"- You'll progress through 60 levels grouped into chapters, each "
            f"introducing new operations and bigger numbers — from simple "
            f"addition all the way to mixed +, -, x, / problems.\n"
            f"- Your best score is saved to your profile and shown on the "
            f"leaderboard (last 2 weeks), grouped by first grade year if you "
            f"set one in your profile.\n\n"
            f"Please verify your email address by visiting the link below:\n"
            f"{link}\n\n"
            f"This link expires in 24 hours. If you didn't create this account, "
            f"you can ignore this email.\n\n"
            f"Have fun, and good luck slaying!\n"
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
