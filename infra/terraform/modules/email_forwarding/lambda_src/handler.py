"""SES inbound-email forwarder.

Triggered by an SES receipt rule's Lambda action. The rule's S3 action (run
before this Lambda action in the same rule) has already stored the full raw
MIME message in S3; the Lambda action's event only carries metadata (message
ID, headers), not the body, so this function re-fetches the raw message from
S3 before re-sending it via SES to the real mailbox.
"""
import email
import os
from email.utils import formataddr, parseaddr

import boto3

REGION = os.environ["REGION"]
INCOMING_BUCKET = os.environ["INCOMING_BUCKET"]
INCOMING_PREFIX = os.environ.get("INCOMING_PREFIX", "incoming/")
FORWARD_TO = os.environ["FORWARD_TO"]
MAIL_FROM = os.environ["MAIL_FROM"]

# Headers that would make the re-sent message invalid or would leak/duplicate
# the original delivery metadata if left in place.
_HEADERS_TO_DROP = (
    "Return-Path",
    "Sender",
    "DKIM-Signature",
    "Received-SPF",
    "Authentication-Results",
)

s3 = boto3.client("s3", region_name=REGION)
ses = boto3.client("ses", region_name=REGION)


def handler(event, context):
    for record in event.get("Records", []):
        message_id = record["ses"]["mail"]["messageId"]
        key = f"{INCOMING_PREFIX}{message_id}"

        raw = s3.get_object(Bucket=INCOMING_BUCKET, Key=key)["Body"].read()
        msg = email.message_from_bytes(raw)

        original_from = msg.get("From", "")

        for header in _HEADERS_TO_DROP:
            del msg[header]

        # Keep the original sender visible for replies, but send "as" a
        # verified identity (Gmail-style "Name via domain" display name) so
        # SES accepts the re-send and DMARC alignment doesn't break delivery.
        del msg["Reply-To"]
        msg["Reply-To"] = original_from

        display_name, addr = parseaddr(original_from)
        via_name = f"{display_name or addr or 'Unknown sender'} via {MAIL_FROM}"

        del msg["From"]
        msg["From"] = formataddr((via_name, MAIL_FROM))

        del msg["To"]
        msg["To"] = FORWARD_TO

        ses.send_raw_email(
            Source=MAIL_FROM,
            Destinations=[FORWARD_TO],
            RawMessage={"Data": msg.as_bytes()},
        )

    return {"status": "ok", "forwarded": len(event.get("Records", []))}
