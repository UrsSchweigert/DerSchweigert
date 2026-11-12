"""Public, unauthenticated sign-up for the Android open beta.

Google Play only invites testers by the Google account address they use for
Play, so that address is the whole payload: no name, no account, no device or
usage data, and nothing is ever sent on to Google — the owner imports the list
into Play Console when the test track opens (`flask beta-admin export`).

Single-table design: reuses the DynamoDB table behind app/models.py
(via `_users()`) under its own `BETAWAITLIST#<address>` partition-key prefix,
so a sign-up can never collide with `USER#`/`BILLING#`/`CANCELREQUEST#` items.
The route never looks up whether an account exists for the address, so it can
not be used to enumerate accounts: a repeat submission only tells the
submitter that this very address is already on the list.
"""

import csv
import io
import json
from datetime import datetime, timezone

import click
from boto3.dynamodb.conditions import Attr
from botocore.exceptions import ClientError
from flask import Blueprint, current_app, jsonify, request

from .extensions import limiter
from .models import _users
from .validation import is_google_mail_address, is_valid_email

beta_waitlist_bp = Blueprint('beta_waitlist', __name__, url_prefix='/api/beta/android-waitlist')

#: Recorded on every item so a future second intake (e.g. an in-app form or a
#: newsletter double opt-in) stays distinguishable from this page's entries.
SOURCE = 'web-beta-page'

#: German is the page's primary language and the fallback for any missing or
#: unexpected `locale` value.
_DEFAULT_LOCALE = 'de'
_LOCALES = ('de', 'en')

_MESSAGES = {
    'registered': {
        'de': 'Danke! Deine Adresse steht auf der Beta-Liste. Wir laden sie ein, sobald der Play-Test-Track offen ist.',
        'en': 'Thank you! Your address is on the beta list. We will invite it as soon as the Play test track opens.',
    },
    'already_registered': {
        'de': 'Diese Adresse steht bereits auf der Beta-Liste – du musst nichts weiter tun.',
        'en': 'This address is already on the beta list – there is nothing else to do.',
    },
}


def _pk(email):
    return f'BETAWAITLIST#{email}'


def _now_utc():
    return datetime.now(timezone.utc).isoformat()


def create_signup(email, locale=_DEFAULT_LOCALE):
    """Conditionally create the sign-up item for `email`.

    Returns (item, created); `created` is False for a repeat submission of the
    same address, which is treated as success rather than an error so a
    double-tapped form does not look like a failure.
    """
    item = {
        'pk': _pk(email), 'sk': 'SIGNUP',
        'email': email, 'locale': locale, 'source': SOURCE,
        'submitted_at': _now_utc(),
    }
    try:
        _users().put_item(Item=item, ConditionExpression=Attr('pk').not_exists())
        return item, True
    except ClientError as exc:
        if exc.response['Error']['Code'] != 'ConditionalCheckFailedException':
            raise
        stored = _users().get_item(
            Key={'pk': _pk(email), 'sk': 'SIGNUP'}, ConsistentRead=True,
        ).get('Item')
        return stored or item, False


def list_signups():
    """Every sign-up, oldest first. A full scan is acceptable: this is an
    operator-run, low-volume list, and the prefix filter keeps other item
    types out of the result."""
    items = []
    scan_kwargs = {
        'FilterExpression': Attr('sk').eq('SIGNUP') & Attr('pk').begins_with('BETAWAITLIST#'),
    }
    while True:
        page = _users().scan(**scan_kwargs)
        items.extend(page.get('Items', []))
        last_key = page.get('LastEvaluatedKey')
        if not last_key:
            break
        scan_kwargs['ExclusiveStartKey'] = last_key
    return sorted(items, key=lambda item: (item.get('submitted_at') or '', item.get('email') or ''))


@beta_waitlist_bp.after_request
def no_cache(response):
    response.headers['Cache-Control'] = 'private, no-store'
    return response


@beta_waitlist_bp.route('', methods=['POST'])
@limiter.limit(lambda: current_app.config['BETA_WAITLIST_RATE_LIMIT'])
def submit():
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return jsonify(error='invalid_request'), 400

    email = data.get('email')
    if not isinstance(email, str):
        return jsonify(error='valid_email_required'), 400
    email = email.strip().lower()
    if not is_valid_email(email):
        return jsonify(error='valid_email_required'), 400
    # Play only invites Google accounts; keeping other domains out of the list
    # means no tester waits for an invitation Google will never send.
    if not is_google_mail_address(email):
        return jsonify(error='google_mail_required'), 400

    locale = data.get('locale')
    if locale not in _LOCALES:
        locale = _DEFAULT_LOCALE

    _, created = create_signup(email, locale)
    status = 'registered' if created else 'already_registered'
    return jsonify(ok=True, status=status, message=_MESSAGES[status][locale]), (201 if created else 200)


def register_beta_commands(app):
    @app.cli.group('beta-admin')
    def admin():
        """Android beta waitlist operations (reads the configured environment)."""

    @admin.command('export')
    @click.option('--format', 'output_format', type=click.Choice(['csv', 'json']), default='csv',
                  show_default=True, help='Output format for the address list.')
    def export(output_format):
        signups = list_signups()
        if output_format == 'json':
            # Default=str keeps DynamoDB types (e.g. Decimal) serialisable.
            click.echo(json.dumps(signups, ensure_ascii=False, indent=2, default=str))
            return
        buffer = io.StringIO()
        writer = csv.writer(buffer)
        writer.writerow(['email', 'submitted_at', 'locale', 'source'])
        for signup in signups:
            writer.writerow([
                signup.get('email', ''),
                signup.get('submitted_at', ''),
                signup.get('locale', ''),
                signup.get('source', ''),
            ])
        click.echo(buffer.getvalue(), nl=False)
