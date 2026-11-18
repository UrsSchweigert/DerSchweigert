"""The caller's IP address, from a source the caller cannot forge.

Every per-IP rate limit, the Turnstile `remoteip` and the visit counter key
on this value, so it must never come from a header the client controls.

`request.remote_addr` is not safe here. On an API Gateway REST API,
apig_wsgi sets REMOTE_ADDR from the *first* X-Forwarded-For entry, and that
entry is whatever the client sent: `X-Forwarded-For: 6.6.6.6` arrives as
REMOTE_ADDR 6.6.6.6, so rotating the header defeated every limit.

Requests reach the API two ways:

* Through the CloudFront distribution (the normal path). A viewer-request
  CloudFront Function writes `event.viewer.ip` into X-Viewer-Ip, replacing
  anything the client sent, and the origin adds the X-Origin-Verify secret
  (infra/terraform/sites/ffm/main.tf). X-Viewer-Ip is trusted only when that
  secret matches.
* Directly at the execute-api URL. There is no secret, so X-Viewer-Ip is
  ignored and the address API Gateway itself saw
  (`requestContext.identity.sourceIp`) is used instead.

Outside Lambda (local runs, the test client) neither source exists and the
WSGI REMOTE_ADDR is used.
"""
import hmac
import ipaddress
import os

from flask import request

ORIGIN_VERIFY_HEADER = 'X-Origin-Verify'
VIEWER_IP_HEADER = 'X-Viewer-Ip'


def _valid_ip(value):
    if not isinstance(value, str):
        return None
    value = value.strip()
    try:
        ipaddress.ip_address(value)
    except ValueError:
        return None
    return value


def _from_cloudfront():
    secret = os.environ.get('ORIGIN_VERIFY_SECRET', '')
    supplied = request.headers.get(ORIGIN_VERIFY_HEADER, '')
    if not secret or not supplied:
        return None
    if not hmac.compare_digest(supplied.encode('utf-8'), secret.encode('utf-8')):
        return None
    return _valid_ip(request.headers.get(VIEWER_IP_HEADER))


def _from_api_gateway():
    context = request.environ.get('apig_wsgi.request_context')
    if not isinstance(context, dict):
        return None
    identity = context.get('identity')
    if isinstance(identity, dict):
        return _valid_ip(identity.get('sourceIp'))
    return None


def get_client_ip():
    """Return the caller's IP address. See the module docstring for the order."""
    return _from_cloudfront() or _from_api_gateway() or request.remote_addr or '127.0.0.1'
