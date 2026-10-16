"""Operator-only Flask CLI commands implementing the project's approved
data-retention policy for the two record types where that policy is fully
specified (see sites/ffm/README.md "Data retention"):

1. Single-use verification/reset/email-change tokens (app/models.py
   TOKEN# items) — already deleted immediately on successful consumption by
   `models.consume_token`; this command physically removes the remainder
   (tokens that expired without ever being consumed), closing the only gap
   between "invalid" and "gone".
2. Completed public cancellation-request records (app/cancel_requests_store.py
   CANCELREQUEST# items) — kept for 3 years after the end of the calendar
   year the case was closed in, per the operator-approved retention
   decision; still-open ("submitted"/"needs_review"/"processing") cases are
   never touched, and a request under legal hold (see
   `billing-admin cancel-request legal-hold`) is never touched either,
   however old.

Deliberately out of scope here (explicitly held back pending legal
classification and/or late-webhook safety, per the same approval — see
README "Financial/Stripe records retention"): Stripe webhook-event audit
rows, billing-state redemption tombstones, gift-code records and any other
financial/audit data in app/billing_store.py. Nothing in this module reads,
scans or deletes anything under the `BILLING#`/`CODE#` prefixes.

Every CLI command here is dry-run by default (it only lists what it
*would* delete) and requires an explicit `--confirm` to actually delete
anything, mirroring the existing `billing-admin` commands' safety
pattern — a human must review the dry-run output before an operator ever
passes `--confirm` against production.

This same policy also runs unattended, once a day, with no dry-run step:
`run_scheduled_cleanup` below is invoked by the EventBridge-scheduled
trigger wired to the existing FFM Lambda (see sites/ffm/lambda/handler.py
and infra/terraform/sites/ffm/main.tf's `aws_cloudwatch_event_rule` /
`aws_cloudwatch_event_target.retention_cleanup`) — there is no public
HTTP endpoint for this; only EventBridge's own IAM-authorized
`lambda:InvokeFunction` permission can trigger it. Both the CLI's
`--confirm` path and the scheduled worker funnel through the same
`_purge_*` helpers below, so they always delete under the exact same
conditional-delete safety (see models.delete_token_item /
cancel_requests_store.delete_cancel_request) and never diverge.
"""

import json
import logging

import click

from . import cancel_requests_store as cancel_store
from . import models

logger = logging.getLogger(__name__)


def _purge_expired_tokens():
    """Delete every currently-expired, unconsumed token, using the
    conditional delete in models.delete_token_item so a token that gets
    consumed (or already was) between listing and deleting is counted as
    `skipped`, not an error. Unexpected failures propagate so Lambda can
    report and retry a failed cleanup."""
    expired = models.find_expired_tokens()
    deleted = skipped = errors = 0
    for item in expired:
        if models.delete_token_item(item['pk'], item['expires_at']):
            deleted += 1
        else:
            skipped += 1
    return {'found': len(expired), 'deleted': deleted, 'skipped': skipped, 'errors': errors}


def _purge_purgeable_cancel_requests():
    """Delete every completed cancellation-request record past its 3-years-
    after-closure retention cutoff, using the conditional delete in
    cancel_requests_store.delete_cancel_request so a record that gets
    reprocessed or placed under legal hold between listing and deleting is
    counted as `skipped` (via PurgeConflict), never silently treated as
    deleted and never allowed to abort the rest of the run."""
    eligible = cancel_store.list_purgeable_cancel_requests()
    deleted = skipped = errors = 0
    for item in eligible:
        try:
            cancel_store.delete_cancel_request(item['request_id'], item['status'], item.get('processed_at'))
            deleted += 1
        except cancel_store.PurgeConflict:
            skipped += 1
            logger.warning(
                'retention-admin: skipped cancel request %s (modified since listed as purgeable)',
                item['request_id'],
            )
    return {'found': len(eligible), 'deleted': deleted, 'skipped': skipped, 'errors': errors}


def run_scheduled_cleanup():
    """Entry point for the daily EventBridge-triggered cleanup (see
    sites/ffm/lambda/handler.py). Runs both purges unattended, with no
    dry-run step and no operator confirmation — this is the one place the
    retention policy executes automatically. Per-item failures (including
    lost conditional-delete races) are logged and counted, never silently
    swallowed; a failure to list candidates at all is left to propagate so
    the Lambda's own invocation-failure handling applies. Returns a
    summary dict (also logged) rather than raising on a clean run, so a
    normal cleanup with only conditional-delete skips reports success.
    Unexpected deletion failures propagate to Lambda's retry handling."""
    summary = {
        'tokens': _purge_expired_tokens(),
        'cancel_requests': _purge_purgeable_cancel_requests(),
    }
    logger.info('retention-admin: scheduled cleanup complete: %s', json.dumps(summary))
    return summary


def register_retention_commands(app):
    @app.cli.group('retention-admin')
    def retention():
        """Data-retention cleanup for tokens and completed cancellation
        requests, using your configured environment. Dry-run by default;
        pass --confirm to actually delete anything."""

    @retention.command('tokens')
    @click.option('--confirm', is_flag=True,
                  help='Actually delete the expired tokens listed below. Without this flag, '
                       'nothing is deleted (dry-run only).')
    def cleanup_tokens(confirm):
        """Physically remove verification/reset/email-change tokens whose
        expires_at has already passed (1h for reset_password, 24h for
        verify_email/change_email). A token that was successfully used is
        already deleted immediately by consume_token() and never shows up
        here; this only ever finds ones nobody redeemed before they
        expired. Run at least weekly to keep expired tokens' time on disk
        comfortably under the approved 7-day removal window."""
        expired = models.find_expired_tokens()
        if not expired:
            click.echo('No expired, unconsumed tokens found.')
            return
        for item in expired:
            # Purpose + expiry only — never the username, to avoid putting
            # account identifiers into shell history/CI logs by default
            # (same restraint as billing-admin cancel-request list).
            click.echo(json.dumps({'purpose': item.get('purpose'), 'expires_at': item['expires_at']}))
        if not confirm:
            click.echo(f'{len(expired)} expired token(s) would be deleted. Re-run with --confirm to delete them.')
            return
        result = _purge_expired_tokens()
        click.echo(f"Deleted {result['deleted']} expired token(s).")
        if result['skipped']:
            click.echo(f"Skipped {result['skipped']} token(s) that changed since listing above (not deleted).")
        if result['errors']:
            click.echo(f"{result['errors']} token deletion(s) failed; see logs.")

    @retention.command('cancel-requests')
    @click.option('--confirm', is_flag=True,
                  help='Actually delete the records listed below. Without this flag, nothing '
                       'is deleted (dry-run only).')
    def cleanup_cancel_requests(confirm):
        """Physically remove completed ("fulfilled"/"no_subscription")
        cancellation-request records once 3 years have elapsed since the
        end of the calendar year the case was closed in (processed_at).
        Still-open cases and any record under legal hold (see
        `billing-admin cancel-request legal-hold`) are never listed or
        deleted here, no matter how old."""
        eligible = cancel_store.list_purgeable_cancel_requests()
        if not eligible:
            click.echo('No completed cancellation-request records are past their retention period.')
            return
        for item in eligible:
            click.echo(json.dumps({
                'request_id': item['request_id'], 'status': item['status'],
                'processed_at': item.get('processed_at'),
            }))
        if not confirm:
            click.echo(f'{len(eligible)} record(s) would be deleted. Re-run with --confirm to delete them.')
            return
        result = _purge_purgeable_cancel_requests()
        click.echo(f"Deleted {result['deleted']} completed cancellation-request record(s).")
        if result['skipped']:
            click.echo(
                f"Skipped {result['skipped']} record(s) that changed (e.g. a legal hold was set) "
                "since listing above (not deleted)."
            )
        if result['errors']:
            click.echo(f"{result['errors']} cancellation-request deletion(s) failed; see logs.")
