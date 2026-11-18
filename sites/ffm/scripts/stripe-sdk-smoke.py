"""Exercise every function in app/stripe_provider.py against Stripe TEST mode.

Use it before merging a stripe-python major: run it under the current and the new
SDK and compare the two JSON reports (`diff`). It reports, per call, whether it
succeeded, which keys came back, and whether _plain() returned plain data.

    STRIPE_TEST_SECRET_KEY=sk_test_... STRIPE_TEST_PORTAL_CONFIGURATION_ID=bpc_... \
        SECRET_KEY=x PYTHONPATH=. python sites/ffm/scripts/stripe-sdk-smoke.py > report.json

It refuses any key that is not a test-mode key, creates one test customer (and a
matching EUR 1.99 / 3-month test price once, reused by lookup key), and deletes
the customer at the end. Secrets are never printed.

First used for the 16.1.0 -> 17.0.0 upgrade (2026-11-18): 20/20 calls passed on
both versions with identical results.
"""
import hashlib
import hmac
import json
import os
import sys
import time
import uuid

os.environ.setdefault("SECRET_KEY", "stripe-sdk-smoke-only")
from datetime import datetime, timedelta, timezone

import stripe  # noqa: E402
from flask import Flask  # noqa: E402

from sites.ffm.app import stripe_provider as sp  # noqa: E402

KEY = os.environ.get("STRIPE_TEST_SECRET_KEY", "")
if not KEY.startswith(("sk_test_", "rk_test_")):
    sys.exit("refusing: set STRIPE_TEST_SECRET_KEY to a Stripe TEST-mode key")
WHSEC = "whsec_local_smoke_" + uuid.uuid4().hex
PORTAL = os.environ.get("STRIPE_TEST_PORTAL_CONFIGURATION_ID", "")
if not PORTAL.startswith("bpc_"):
    sys.exit("refusing: set STRIPE_TEST_PORTAL_CONFIGURATION_ID to a test-mode portal configuration")
report = {"stripe_version": stripe.VERSION, "calls": {}}


def plain_ok(value, path="$"):
    """True when value is JSON-plain all the way down (what FFM stores in DynamoDB)."""
    if value is None or isinstance(value, (str, int, float, bool)):
        return True, None
    if isinstance(value, dict):
        for k, v in value.items():
            ok, where = plain_ok(v, f"{path}.{k}")
            if not ok:
                return ok, where
        return type(value) is dict, None if type(value) is dict else f"{path} is {type(value).__name__}"
    if isinstance(value, list):
        for i, v in enumerate(value):
            ok, where = plain_ok(v, f"{path}[{i}]")
            if not ok:
                return ok, where
        return True, None
    return False, f"{path} is {type(value).__name__}"


def record(name, fn, *checks):
    try:
        out = fn()
        ok, where = plain_ok(out)
        entry = {"ok": True, "plain": ok, "not_plain_at": where}
        sample = out[0] if isinstance(out, list) and out else out
        if isinstance(sample, dict):
            entry["object"] = sample.get("object")
            entry["keys"] = sorted(sample.keys())
        for label, check in checks:
            entry[label] = check(out)
        report["calls"][name] = entry
        return out
    except Exception as exc:  # noqa: BLE001
        report["calls"][name] = {"ok": False, "error": f"{type(exc).__name__}: {str(exc)[:300]}"}
        return None


app = Flask(__name__)
app.config.update(STRIPE_SECRET_KEY=KEY, STRIPE_WEBHOOK_SECRET=WHSEC)
raw = stripe.StripeClient(KEY, stripe_version=sp.API_VERSION).v1

with app.app_context():
    # A test-mode price shaped exactly like FFM's product (validate_price enforces this shape).
    found = raw.prices.list({"lookup_keys": ["ffm-sdk-smoke-quarterly"], "limit": 1}).data
    if found:
        price_id = found[0].id
    else:
        product = raw.products.create({"name": "FFM SDK smoke test (test mode)"})
        price_id = raw.prices.create({
            "product": product.id, "currency": "eur", "unit_amount": 199,
            "recurring": {"interval": "month", "interval_count": 3},
            "lookup_key": "ffm-sdk-smoke-quarterly",
        }).id

    stable = str(uuid.uuid4())
    record("validate_price", lambda: sp.validate_price(price_id))
    cust = record("create_customer", lambda: sp.create_customer(stable, f"smoke+{stable[:8]}@example.com", "cust-" + stable))
    cid = cust["id"]
    base = "https://ffm.example.test"

    co = record("create_checkout", lambda: sp.create_checkout(cid, stable, price_id, base, "co-" + stable),
                ("has_url", lambda o: bool(o.get("url"))))
    if co is None and "terms" in report["calls"]["create_checkout"].get("error", "").lower():
        app.config["STRIPE_CHECKOUT_TERMS_CONSENT_ENABLED"] = False
        report["note_terms"] = "test account has no terms URL; retried checkout without consent_collection"
        co = record("create_checkout", lambda: sp.create_checkout(cid, stable, price_id, base, "co2-" + stable),
                    ("has_url", lambda o: bool(o.get("url"))))
    if co:
        record("get_checkout", lambda: sp.get_checkout(co["id"]), ("status", lambda o: o.get("status")))
        record("expire_checkout", lambda: sp.expire_checkout(co["id"], "exp-" + stable), ("status", lambda o: o.get("status")))
    gift_until = int((datetime.now(timezone.utc) + timedelta(days=10)).timestamp())
    gco = record("create_checkout_gift_trial", lambda: sp.create_checkout(cid, stable, price_id, base, "gco-" + stable, gift_until=gift_until))
    if gco:
        sp.expire_checkout(gco["id"], "gexp-" + stable)

    record("create_portal", lambda: sp.create_portal(cid, base + "/", PORTAL), ("has_url", lambda o: bool(o.get("url"))))

    # A paid subscription, set up directly (Checkout needs a browser): test card, default payment method.
    pm = raw.payment_methods.attach("pm_card_visa", {"customer": cid})
    raw.customers.update(cid, {"invoice_settings": {"default_payment_method": pm.id}})
    sub = raw.subscriptions.create({"customer": cid, "items": [{"price": price_id}],
                                    "metadata": {"billing_uuid": stable}})
    sid = sub.id
    time.sleep(3)
    s = record("get_subscription", lambda: sp.get_subscription(sid), ("status", lambda o: o.get("status")))
    record("list_customer_subscriptions", lambda: sp.list_customer_subscriptions(cid), ("count", len))
    invs = record("list_paid_invoices", lambda: sp.list_paid_invoices(cid, sid), ("count", len))
    inv_id = (s or {}).get("latest_invoice")
    inv = record("get_invoice", lambda: sp.get_invoice(inv_id), ("status", lambda o: o.get("status")))
    charge_id = (inv or {}).get("charge")
    if charge_id:
        record("get_charge", lambda: sp.get_charge(charge_id), ("paid", lambda o: o.get("paid")))
        record("list_disputes", lambda: sp.list_disputes(charge_id), ("count", len))
        record("refund_charge", lambda: sp.refund_charge(charge_id, 50, "ref-" + stable), ("status", lambda o: o.get("status")))
    else:
        report["calls"]["get_charge"] = {"ok": False, "error": "invoice had no charge id"}
    until = (datetime.now(timezone.utc) + timedelta(days=120)).strftime("%Y-%m-%dT%H:%M:%SZ")
    record("postpone_renewal", lambda: sp.postpone_renewal(sid, until, "pp-" + stable), ("status", lambda o: o.get("status")))
    record("cancel_subscription_period_end", lambda: sp.cancel_subscription(sid, False, "cpe-" + stable),
           ("cancel_at_period_end", lambda o: o.get("cancel_at_period_end")))
    record("cancel_subscription_immediate", lambda: sp.cancel_subscription(sid, True, "cim-" + stable),
           ("status", lambda o: o.get("status")))
    record("list_all_subscriptions", lambda: sp.list_all_subscriptions("canceled"),
           ("includes_this", lambda o: any(x.get("id") == sid for x in o)))

    # Webhook verification is local HMAC; sign a realistic event the way Stripe does.
    payload = json.dumps({"id": "evt_smoke_" + stable[:8], "object": "event", "type": "customer.subscription.updated",
                          "api_version": sp.API_VERSION, "data": {"object": {"id": sid, "object": "subscription",
                          "items": {"data": [{"price": {"id": price_id}}]}}}}).encode()
    t = int(time.time())
    sig = hmac.new(WHSEC.encode(), f"{t}.".encode() + payload, hashlib.sha256).hexdigest()
    record("verify_event", lambda: sp.verify_event(payload, f"t={t},v1={sig}"), ("type", lambda o: o.get("type")))
    try:
        sp.verify_event(payload, f"t={t},v1={'0' * 64}")
        report["calls"]["verify_event_rejects_bad_signature"] = {"ok": False, "error": "accepted a bad signature"}
    except stripe.SignatureVerificationError:
        report["calls"]["verify_event_rejects_bad_signature"] = {"ok": True}

    raw.customers.delete(cid)  # test-mode cleanup; cancels nothing live

print(json.dumps(report, indent=1, sort_keys=True))
