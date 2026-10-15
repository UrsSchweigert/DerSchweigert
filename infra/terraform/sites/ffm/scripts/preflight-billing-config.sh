#!/usr/bin/env bash
# Fail-safe preflight guard for the FFM billing/access Terraform variables.
#
# Run this BEFORE `terraform apply` (CI does, via deploy-ffm) to reject
# contradictory/partial billing configuration and obvious placeholder values
# before they ever reach `terraform apply`. It does not read any secret
# *value* — only the non-secret flags, IDs and Secrets Manager ARNs that are
# also passed to Terraform as TF_VAR_* environment variables — and it never
# prints a raw config value back out (only variable *names* and normalized
# true/false flags), so a value pasted into the wrong variable by mistake
# (e.g. a secret key into a non-secret ID field) doesn't end up echoed into
# CI logs.
#
# This script intentionally never *invents* or defaults a missing value; an
# empty/false input stays empty/false. It only rejects combinations that are
# unsafe or inconsistent. It avoids bash indirect-variable-expansion
# (`${!name}`) and eval entirely — every check takes its name and value as
# explicit function arguments instead, so there is no dynamic construction of
# variable or command names from input.
#
# Usage: TF_VAR_access_control_enabled=false TF_VAR_billing_enabled=false ... \
#          infra/terraform/sites/ffm/scripts/preflight-billing-config.sh
#
# Exit code 0 = safe to proceed. Non-zero = fail the deploy.
set -euo pipefail

fail() {
  echo "::error::preflight-billing-config: $1" >&2
  exit 1
}

# Normalizes a TF_VAR_* boolean to "true"/"false"; empty is treated as
# "false" (Terraform's own default), but anything else not exactly true/false
# is rejected so a malformed repo variable can't silently fall through as
# falsy. Takes the variable's display name and its already-looked-up value as
# explicit arguments (no `${!name}` indirection) and never echoes the
# offending value back out.
bool_var() {
  local name="$1" value="$2"
  if [ -z "$value" ]; then
    echo "false"
    return 0
  fi
  case "$value" in
    true|false) echo "$value" ;;
    *) fail "$name must be exactly 'true' or 'false'." ;;
  esac
}

ACCESS_CONTROL_ENABLED=$(bool_var "access_control_enabled" "${TF_VAR_access_control_enabled:-}")
BILLING_ENABLED=$(bool_var "billing_enabled" "${TF_VAR_billing_enabled:-}")
BILLING_SALES_ENABLED=$(bool_var "billing_sales_enabled" "${TF_VAR_billing_sales_enabled:-}")
BILLING_TERMS_APPROVED=$(bool_var "billing_terms_approved" "${TF_VAR_billing_terms_approved:-}")
GRANDFATHER_CUTOFF="${TF_VAR_grandfather_cutoff:-}"
STRIPE_PRICE_ID="${TF_VAR_stripe_price_id:-}"
STRIPE_PORTAL_CONFIGURATION_ID="${TF_VAR_stripe_portal_configuration_id:-}"
STRIPE_SECRET_KEY_ARN="${TF_VAR_stripe_secret_key_arn:-}"
STRIPE_WEBHOOK_SECRET_ARN="${TF_VAR_stripe_webhook_secret_arn:-}"

# --- Known README placeholder examples: never acceptable as real IDs -------
case "$STRIPE_PRICE_ID" in
  price_1234567890ABC) fail "stripe_price_id is the README example placeholder, not a real Stripe price ID." ;;
esac
case "$STRIPE_PORTAL_CONFIGURATION_ID" in
  bpc_1234567890ABC) fail "stripe_portal_configuration_id is the README example placeholder, not a real Stripe portal configuration ID." ;;
esac

# --- Format checks (reject obviously wrong IDs/ARNs before Terraform does) --
if [ -n "$STRIPE_PRICE_ID" ] && ! [[ "$STRIPE_PRICE_ID" =~ ^price_[A-Za-z0-9]+$ ]]; then
  fail "stripe_price_id does not look like a Stripe price ID (expected price_...)."
fi
if [ -n "$STRIPE_PORTAL_CONFIGURATION_ID" ] && ! [[ "$STRIPE_PORTAL_CONFIGURATION_ID" =~ ^bpc_[A-Za-z0-9]+$ ]]; then
  fail "stripe_portal_configuration_id does not look like a Stripe portal configuration ID (expected bpc_...)."
fi

check_arn_format() {
  local name="$1" value="$2"
  if [ -n "$value" ] && ! [[ "$value" =~ ^arn:aws:secretsmanager:[a-z0-9-]+:[0-9]{12}:secret:.+$ ]]; then
    fail "$name does not look like a Secrets Manager ARN (expected arn:aws:secretsmanager:<region>:<account>:secret:<name>)."
  fi
}
check_arn_format "stripe_secret_key_arn" "$STRIPE_SECRET_KEY_ARN"
check_arn_format "stripe_webhook_secret_arn" "$STRIPE_WEBHOOK_SECRET_ARN"

# --- Known production secret naming path (ARNs only) ------------------------
# Unlike Stripe's own opaque price/portal-configuration IDs (which don't
# encode test-vs-live mode in their format at all, and must never be scanned
# for substrings — a real LIVE id can by chance contain "test"/"dev"), the
# Secrets Manager secret *names* for Stripe credentials are this repo's own
# choice, documented in sites/ffm/README.md: `ffm/stripe-secret-key` and
# `ffm/stripe-webhook-secret`. AWS appends a random 6-character suffix to the
# ARN unless the secret was created with an explicit full name, so constrain
# the check to that fixed, documented prefix before the random suffix instead
# of substring-matching the whole value (the random suffix is arbitrary and
# could itself coincidentally contain "test"/"dev").
#
# This still cannot tell whether the secret's *value* is a TEST or LIVE
# Stripe key — that is not recoverable from an ARN or ID. Confirm LIVE mode
# directly in the Stripe dashboard/API before provisioning the secret this
# ARN points at.
check_known_secret_path() {
  local name="$1" arn="$2" expected_prefix="$3"
  if [ -z "$arn" ]; then
    return 0
  fi
  local secret_path="${arn#*:secret:}"
  if ! [[ "$secret_path" =~ ^${expected_prefix}(-[A-Za-z0-9]{6})?$ ]]; then
    fail "$name's secret name does not match this repo's documented production path ('$expected_prefix', see sites/ffm/README.md); confirm it points at the intended secret before wiring it in."
  fi
}
check_known_secret_path "stripe_secret_key_arn" "$STRIPE_SECRET_KEY_ARN" "ffm/stripe-secret-key"
check_known_secret_path "stripe_webhook_secret_arn" "$STRIPE_WEBHOOK_SECRET_ARN" "ffm/stripe-webhook-secret"

# --- Strict calendar/not-future check for grandfather_cutoff -----------------
# Terraform's own regex (infra/terraform/sites/ffm/variables.tf) only checks
# the YYYY-MM-DDTHH:MM:SSZ *shape*; it accepts calendar-invalid values like
# month 13 or Feb 30, and it accepts a cutoff in the future (which would
# grandfather accounts that don't exist yet at launch time). Use the Python
# interpreter CI already provisions for this job (no new tool dependency) to
# parse it strictly and compare against the current UTC time. Only runs when
# access_control_enabled=true, i.e. when the cutoff actually takes effect.
validate_cutoff_not_future() {
  local cutoff="$1"
  if ! command -v python3 >/dev/null 2>&1; then
    fail "access_control_enabled=true requires python3 to validate grandfather_cutoff, but python3 is not on PATH."
  fi
  local status=0
  python3 - "$cutoff" >/dev/null 2>&1 <<'PY' || status=$?
import datetime
import re
import sys

if not re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z", sys.argv[1]):
    sys.exit(1)

try:
    cutoff = datetime.datetime.strptime(sys.argv[1], "%Y-%m-%dT%H:%M:%SZ").replace(
        tzinfo=datetime.timezone.utc
    )
except ValueError:
    sys.exit(1)

if cutoff > datetime.datetime.now(datetime.timezone.utc):
    sys.exit(2)
PY
  if [ "$status" -eq 2 ]; then
    fail "grandfather_cutoff must not be in the future (set it once, immediately before the actual paid launch, not in advance)."
  elif [ "$status" -ne 0 ]; then
    fail "grandfather_cutoff is not a valid UTC calendar timestamp (matches the YYYY-MM-DDTHH:MM:SSZ shape but not a real calendar date/time)."
  fi
}

# --- Contradictory/partial sales config guards ------------------------------
# billing_enabled=true alone (sales and access control both off) must keep
# working even if billing_terms_approved is false or gets flipped back to
# false later — that is the core webhook-processing/cancellation path relied
# on by the shutdown and incident-recovery runbooks (see sites/ffm/README.md
# "Sales-off rollback") for already-existing subscriptions, and it must not
# be blocked by a terms re-review. Only *opening new sales* requires the full
# approved chain.
if [ "$BILLING_ENABLED" = "true" ]; then
  require_set() {
    local name="$1" value="$2"
    if [ -z "$value" ]; then
      fail "billing_enabled=true requires $name to be set."
    fi
  }
  require_set "stripe_price_id" "$STRIPE_PRICE_ID"
  require_set "stripe_portal_configuration_id" "$STRIPE_PORTAL_CONFIGURATION_ID"
  require_set "stripe_secret_key_arn" "$STRIPE_SECRET_KEY_ARN"
  require_set "stripe_webhook_secret_arn" "$STRIPE_WEBHOOK_SECRET_ARN"
fi

if [ "$BILLING_SALES_ENABLED" = "true" ]; then
  if [ "$BILLING_ENABLED" != "true" ]; then
    fail "billing_sales_enabled=true requires billing_enabled=true."
  fi
  if [ "$ACCESS_CONTROL_ENABLED" != "true" ]; then
    fail "billing_sales_enabled=true requires access_control_enabled=true (selling without access control enforced cannot gate premium levels for non-grandfathered users)."
  fi
  if [ "$BILLING_TERMS_APPROVED" != "true" ]; then
    fail "billing_sales_enabled=true requires billing_terms_approved=true."
  fi
  if [ -z "$GRANDFATHER_CUTOFF" ]; then
    fail "billing_sales_enabled=true requires a non-empty grandfather_cutoff."
  fi
fi

if [ "$ACCESS_CONTROL_ENABLED" = "true" ]; then
  if [ "$BILLING_ENABLED" != "true" ]; then
    fail "access_control_enabled=true requires billing_enabled=true (otherwise non-grandfathered users are locked out with no way to pay)."
  fi
  if [ -z "$GRANDFATHER_CUTOFF" ]; then
    fail "access_control_enabled=true requires a non-empty grandfather_cutoff (set it once, immediately before launch)."
  fi
  validate_cutoff_not_future "$GRANDFATHER_CUTOFF"
fi

echo "preflight-billing-config: OK (access_control_enabled=$ACCESS_CONTROL_ENABLED, billing_enabled=$BILLING_ENABLED, billing_sales_enabled=$BILLING_SALES_ENABLED)"
