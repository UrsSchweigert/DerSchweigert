"""Operator-only Flask commands. These are never public HTTP endpoints."""

import json

import click
import stripe
from boto3.dynamodb.conditions import Attr
from botocore.exceptions import BotoCoreError, ClientError
from flask import current_app

from . import billing, billing_store as store, stripe_provider as provider
from . import cancel_requests_store as cancel_store
from . import mailer
from .models import _users, ensure_stable_id, get_user


def _scan(filter_expression):
    response = _users().scan(FilterExpression=filter_expression)
    yield from response.get('Items', [])
    while response.get('LastEvaluatedKey'):
        response = _users().scan(FilterExpression=filter_expression,
                                 ExclusiveStartKey=response['LastEvaluatedKey'])
        yield from response.get('Items', [])


def register_billing_commands(app):
    @app.cli.group('billing-admin')
    def admin():
        """Access-code and billing operations using your configured environment."""

    @admin.command('create-code')
    @click.option('--expires-at', default=None, help='Optional UTC ISO redeem-by timestamp.')
    def create_code(expires_at):
        code, digest = store.create_access_code(expires_at=expires_at)
        click.echo(json.dumps({'code': code, 'code_hash': digest, 'months': 3}))

    @admin.command('revoke-code')
    @click.argument('code_hash')
    def revoke_code(code_hash):
        if not store.revoke_code(code_hash):
            raise click.ClickException('Code not found or already reserved; no revocation was applied.')
        click.echo('Code revoked.')

    @admin.command('reconcile')
    @click.option('--confirm', is_flag=True, required=True, help='Allow provider calls and billing-state updates.')
    def reconcile(confirm):
        failures = []
        for state in _scan(Attr('sk').eq('STATE')):
            identity = state['pk'].removeprefix('BILLING#')
            if state.get('deleted') or not store.get_billing_username_mapping(identity):
                continue
            try:
                billing.recover_pending_redemption(identity)
                if state.get('subscription_id'):
                    with billing.billing_lock(identity):
                        billing.reconcile_subscription(identity, state['subscription_id'])
                click.echo(f'Reconciled {identity}')
            except (stripe.StripeError, ValueError) as exc:
                failures.append(identity)
                click.echo(f'FAILED {identity}: {type(exc).__name__}', err=True)
        if failures:
            raise click.ClickException(f'{len(failures)} identities require retry/operator investigation.')

    @admin.command('shutdown')
    @click.option('--confirm', is_flag=True, required=True, help='Cancel all game subscriptions immediately.')
    def shutdown(confirm):
        if current_app.config['BILLING_SALES_ENABLED']:
            raise click.ClickException('Disable BILLING_SALES_ENABLED and deploy that change before shutdown.')
        price = current_app.config['STRIPE_PRICE_ID']
        if not price:
            raise click.ClickException('STRIPE_PRICE_ID is required to scope shutdown safely.')
        failures = []
        for sub in provider.list_all_subscriptions():
            if not any(item['price']['id'] == price for item in sub['items']['data']):
                continue
            if sub['status'] not in billing._LIVE_STATES:
                continue
            try:
                result = provider.cancel_subscription(
                    sub['id'], immediate=True, operation_id=f'shutdown-{sub["id"]}',
                )
                if result['status'] != 'canceled':
                    failures.append(sub['id'])
            except stripe.StripeError:
                failures.append(sub['id'])
                click.echo(f'FAILED cancellation: {sub["id"]}', err=True)
        # A second paginated provider read proves collection has actually stopped.
        remaining = [
            sub['id'] for sub in provider.list_all_subscriptions()
            if sub['status'] in billing._LIVE_STATES
            and any(item['price']['id'] == price for item in sub['items']['data'])
        ]
        if failures or remaining:
            raise click.ClickException(f'Shutdown incomplete; retry these subscriptions: {sorted(set(failures + remaining))}')
        click.echo('All subscriptions for the configured game price are canceled. Complete subscriber notices and unused-time refunds.')

    @admin.group('cancel-request')
    def cancel_request_group():
        """Manual review and processing of public, unauthenticated
        cancellation requests submitted via /api/cancel-requests (see
        app/cancel_requests.py). Nothing here is automatic: every status
        transition requires an explicit operator flag, and a request's
        identity is only bound to an immutable account stable_id after
        --confirm-identity-reviewed is passed to `process` or
        `record-manual-outcome`. Requested-date (non-"earliest") requests
        are never processed by `process` — it always refuses them — but
        `record-manual-outcome` lets an operator durably record what they
        actually did for one by hand (e.g. in the Stripe dashboard/portal
        on the requester's stated date) so these do not sit in
        "needs_review" forever with no way to finalize/email a result."""

    @cancel_request_group.command('list')
    @click.option('--status', default=None,
                  type=click.Choice(sorted(cancel_store.STATUSES)),
                  help='Filter by status; omit to list all requests.')
    def cr_list(status):
        """Minimal listing only (no emails/username/reason) to avoid
        dumping PII into shell history/logs by default; use `show
        --reveal-pii` for one specific request after you intend to act on it."""
        for item in cancel_store.list_cancel_requests(status):
            click.echo(json.dumps({
                'request_id': item['request_id'], 'status': item['status'],
                'cancellation_type': item['cancellation_type'],
                'requested_date': item.get('requested_date'),
                'submitted_at': item['submitted_at'],
            }))

    @cancel_request_group.command('show')
    @click.argument('request_id')
    @click.option('--reveal-pii', is_flag=True,
                  help='Include contact/account email, username, Stripe reference and free-text reason.')
    def cr_show(request_id, reveal_pii):
        item = cancel_store.get_cancel_request(request_id)
        if not item:
            raise click.ClickException('Request not found.')
        safe = {
            'request_id': item['request_id'], 'status': item['status'],
            'cancellation_type': item['cancellation_type'], 'requested_date': item.get('requested_date'),
            'submitted_at': item['submitted_at'], 'reviewed_username': item.get('reviewed_username'),
            'reviewed_at': item.get('reviewed_at'), 'outcome': item.get('outcome'),
            'outcome_detail': item.get('outcome_detail'), 'processed_at': item.get('processed_at'),
            'ack_email_status': item.get('ack_email_status'), 'ack_email_attempted_at': item.get('ack_email_attempted_at'),
        }
        if reveal_pii:
            safe.update({
                'contact_email': item['contact_email'], 'account_email': item.get('account_email'),
                'username': item.get('username'), 'stripe_reference': item.get('stripe_reference'),
                'reason': item.get('reason'),
            })
        click.echo(json.dumps(safe, indent=2, default=str))

    @cancel_request_group.command('process')
    @click.argument('request_id')
    @click.option('--username', required=True,
                  help='Account username a human operator has manually verified owns this request. '
                       'Never derived automatically from the account_email the requester supplied.')
    @click.option('--confirm-identity-reviewed', is_flag=True, required=True,
                  help='Attests that a human has manually verified this username belongs to the requester.')
    @click.option('--confirm', is_flag=True, required=True, help='Execute the cancellation.')
    def cr_process(request_id, username, confirm_identity_reviewed, confirm):
        item = cancel_store.get_cancel_request(request_id)
        if not item:
            raise click.ClickException('Request not found.')
        if item['cancellation_type'] == 'requested_date':
            raise click.ClickException(
                'Requested-date cancellations are never processed by this command — this tool '
                'only automates earliest-possible cancellation via the shared '
                'cancel_future_renewals() path. Handle the requested date manually (e.g. via the '
                'Stripe dashboard/portal), then record the outcome with `cancel-request '
                'record-manual-outcome` instead.'
            )
        if item['status'] in cancel_store.TERMINAL_STATUSES:
            click.echo(f"Request is already terminal ('{item['status']}'); nothing to do.")
            return
        if item['status'] not in ('submitted', 'processing'):
            raise click.ClickException(f"Request status is '{item['status']}'; nothing to process.")
        user = get_user(username)
        if not user:
            raise click.ClickException(f'No account found for username "{username}".')
        stable_id = ensure_stable_id(username)
        if not stable_id:
            raise click.ClickException(
                f'Could not resolve a stable billing identity for "{username}" '
                '(account may have been deleted since this request was submitted).'
            )
        # Normalize any pending gift redemption first — the same idempotent
        # call cancel_future_renewals() itself makes — so the
        # subscription_id snapshot taken below reflects the same state
        # cancel_future_renewals() will see once it (again, idempotently)
        # makes this same call under its own lock.
        billing.recover_pending_redemption(stable_id)
        try:
            # Bind the reviewed identity *and* a durable snapshot of the
            # subscription_id actually present at review time (which may
            # be None) before ever calling the provider. A retry (e.g.
            # after a provider call previously succeeded but this process
            # crashed before `finalize` below ran) reuses this exact
            # already-bound snapshot — start_processing() never
            # overwrites it with whatever subscription_id happens to be
            # current at retry time.
            current_subscription_id = (store.get_billing_state(stable_id) or {}).get('subscription_id')
            cancel_store.start_processing(request_id, username, stable_id, current_subscription_id)
        except ValueError as exc:
            raise click.ClickException(
                f'Cannot bind identity ({exc}); this request may already be bound to a '
                'different reviewed username — verify with `show` before retrying.'
            ) from exc
        bound = cancel_store.get_cancel_request(request_id)
        try:
            result = billing.cancel_future_renewals(
                stable_id, expected_subscription_id=bound['reviewed_subscription_id'],
            )
        except ValueError as exc:
            if str(exc) != 'subscription_mismatch':
                raise
            raise click.ClickException(
                'The subscription currently on this account no longer matches the one bound at '
                f"review time (reviewed_subscription_id={bound['reviewed_subscription_id']!r}). "
                'This can happen if the account started a different (e.g. replacement) '
                'subscription since review. Refusing to cancel it automatically — investigate '
                'manually (e.g. `show --reveal-pii` plus the Stripe dashboard) and use '
                '`cancel-request record-manual-outcome` to durably record whatever the correct '
                'outcome actually is. No subscription was canceled by this command.'
            ) from exc
        except stripe.StripeError as exc:
            click.echo(
                f'Provider call failed: {type(exc).__name__}. Status remains "processing" and no '
                'outcome was recorded; rerun this exact command (same request id and username) to retry.',
                err=True,
            )
            raise click.ClickException('Cancellation not completed; no change was claimed.') from exc
        cancel_store.finalize(request_id, result['outcome'], result)
        click.echo(json.dumps({'request_id': request_id, 'status': result['outcome'], 'detail': result}))

    @cancel_request_group.command('record-manual-outcome')
    @click.argument('request_id')
    @click.option('--username', required=True,
                  help='Account username a human operator has manually verified owns this request. '
                       'Never derived automatically from the account_email the requester supplied.')
    @click.option('--confirm-identity-reviewed', is_flag=True, required=True,
                  help='Attests that a human has manually verified this username belongs to the requester.')
    @click.option('--outcome', required=True, type=click.Choice(sorted(cancel_store.TERMINAL_STATUSES)),
                  help='The outcome exactly as it actually happened — never a guess or intent.')
    @click.option('--effective-date', default=None, type=click.DateTime(formats=['%Y-%m-%d']),
                  help="Date (YYYY-MM-DD) the cancellation was actually configured to take effect "
                       "in Stripe (e.g. the subscription's actual current-period end), as actually "
                       "set — not the requester's originally-requested date, and not a promise that "
                       "date was honored. Required with --outcome fulfilled.")
    @click.option('--provider-reference', default=None,
                  help='Stripe subscription/invoice id (or similar reference) for the action actually taken.')
    @click.option('--note', default=None, help='Optional free-text operator note on what was actually done.')
    @click.option('--confirm', is_flag=True, required=True, help='Durably record this outcome.')
    def cr_record_manual_outcome(request_id, username, confirm_identity_reviewed, outcome,
                                  effective_date, provider_reference, note, confirm):
        """Record the outcome of a requested_date ("needs_review") request
        that an operator has handled manually (e.g. directly in the Stripe
        dashboard/customer portal on the requester's stated date), outside
        this tool's own automated `cancel_future_renewals()` path used by
        `process` above. `process` always refuses requested_date requests
        — without this command they would stay "needs_review" forever,
        with no way to finalize them or send the acknowledgement email.

        This command NEVER calls Stripe and NEVER schedules anything: it
        only durably records, bound to a manually-reviewed identity, an
        outcome an operator attests they *already actually performed or
        observed* (including "no_subscription" if none existed). It must
        never be used to assert the requester's originally-requested date
        was guaranteed or honored — `--effective-date` records what was
        actually configured, nothing more.
        """
        item = cancel_store.get_cancel_request(request_id)
        if not item:
            raise click.ClickException('Request not found.')
        if item['status'] in cancel_store.TERMINAL_STATUSES:
            click.echo(f"Request is already terminal ('{item['status']}'); nothing to do.")
            return
        if item['status'] not in ('needs_review', 'processing'):
            raise click.ClickException(
                f"Request status is '{item['status']}'; this command is only for 'needs_review' "
                "requests (or one already bound to this username via a prior attempt of this "
                "same command) that have not yet reached a terminal outcome."
            )
        if outcome == 'fulfilled' and not effective_date:
            raise click.ClickException(
                '--effective-date is required with --outcome fulfilled — record the date actually '
                'configured in Stripe; it must not be left unspecified.'
            )
        user = get_user(username)
        if not user:
            raise click.ClickException(f'No account found for username "{username}".')
        stable_id = ensure_stable_id(username)
        if not stable_id:
            raise click.ClickException(
                f'Could not resolve a stable billing identity for "{username}" '
                '(account may have been deleted since this request was submitted).'
            )
        detail = {
            'manual': True, 'recorded_by_username': username,
            'effective_date': effective_date.date().isoformat() if effective_date else None,
            'provider_reference': provider_reference, 'note': note,
        }
        try:
            cancel_store.record_manual_outcome(request_id, username, stable_id, outcome, detail)
        except ValueError as exc:
            raise click.ClickException(
                f'Cannot record outcome ({exc}); this request may already be bound to a '
                'different reviewed username — verify with `show` before retrying.'
            ) from exc
        click.echo(json.dumps({'request_id': request_id, 'status': outcome, 'detail': detail}))

    @cancel_request_group.command('complete-email')
    @click.argument('request_id')
    @click.option('--resend', is_flag=True,
                  help='Send again even though ack_email_status is already "sent" (e.g. the '
                       'requester says they never received it). Without this flag, a request '
                       'whose acknowledgement was already sent is skipped rather than re-mailed.')
    @click.option('--confirm', is_flag=True, required=True, help='Send the manual acknowledgement email now.')
    def cr_complete_email(request_id, resend, confirm):
        """Separate, explicit step: sends the final outcome acknowledgement
        to the requester's contact email. Never run automatically — only
        after `process`/`record-manual-outcome` has recorded a terminal
        outcome. Delivery state (ack_email_status/ack_email_error) is
        durable and independently retryable by re-running this command; a
        send failure is recorded, not swallowed."""
        item = cancel_store.get_cancel_request(request_id)
        if not item:
            raise click.ClickException('Request not found.')
        if item['status'] not in cancel_store.TERMINAL_STATUSES:
            raise click.ClickException(
                f"Request status is '{item['status']}'; review and process it first with "
                "'cancel-request process' or 'cancel-request record-manual-outcome'."
            )
        if item.get('ack_email_status') == 'sent' and not resend:
            click.echo(
                f'Acknowledgement for {request_id} was already sent at '
                f"{item.get('ack_email_attempted_at')}; pass --resend to send it again."
            )
            return
        try:
            mailer.send_cancel_request_ack_email(
                item['contact_email'], item['request_id'], item['submitted_at'],
                item['status'], item.get('outcome_detail'),
            )
        except (ClientError, BotoCoreError) as exc:
            # Store only the exception class/code, never the raw exception
            # text: botocore error messages can embed request parameters
            # (e.g. the destination address) and we don't want that
            # duplicated into this durable record beyond the
            # contact_email field already stored deliberately above.
            code = exc.response.get('Error', {}).get('Code') if isinstance(exc, ClientError) else None
            cancel_store.set_ack_email_state(request_id, 'failed', f'{type(exc).__name__}:{code or "unknown"}')
            raise click.ClickException(
                f'Email send failed ({type(exc).__name__}); retry this command later.'
            ) from exc
        cancel_store.set_ack_email_state(request_id, 'sent')
        click.echo(f'Acknowledgement email sent for {request_id}.')

    @cancel_request_group.command('legal-hold')
    @click.argument('request_id')
    @click.option('--lift', is_flag=True,
                  help='Lift a previously-set hold instead of setting one.')
    def cr_legal_hold(request_id, lift):
        """Suspend (default) or lift (--lift) retention cleanup for one
        request, independent of its status. A request under hold is never
        deleted by `flask retention-admin cancel-requests`, however long
        past its normal 3-years-after-closure cutoff it is, until this
        command lifts the hold. Does not itself move, process or email the
        request — purely a cleanup-eligibility flag."""
        try:
            cancel_store.set_legal_hold(request_id, hold=not lift)
        except ValueError as exc:
            raise click.ClickException(f'Request not found ({exc}).') from exc
        click.echo(f"Legal hold {'lifted' if lift else 'set'} for {request_id}.")
