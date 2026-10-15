"""Tests for infra/terraform/sites/ffm/scripts/preflight-billing-config.sh,
the CI guard that runs before `terraform apply` in the deploy-ffm job and
rejects contradictory/partial FFM billing-access Terraform variable
combinations and obvious placeholder values. It never reads a secret
*value*, only the non-secret flags/IDs/ARNs also passed to Terraform as
TF_VAR_*, and it never echoes a raw config value back into its own output.
"""

import os
import subprocess
import sys
from pathlib import Path

import pytest

SCRIPT = (
    Path(__file__).resolve().parents[3]
    / "infra" / "terraform" / "sites" / "ffm" / "scripts" / "preflight-billing-config.sh"
)

VALID_STRIPE_IDS = {
    "TF_VAR_stripe_price_id": "price_ABC123xyz",
    "TF_VAR_stripe_portal_configuration_id": "bpc_ABC123xyz",
    "TF_VAR_stripe_secret_key_arn": (
        "arn:aws:secretsmanager:eu-central-1:113725432218:secret:ffm/stripe-secret-key-AbCdEf"
    ),
    "TF_VAR_stripe_webhook_secret_arn": (
        "arn:aws:secretsmanager:eu-central-1:113725432218:secret:ffm/stripe-webhook-secret-AbCdEf"
    ),
}

# Core billing (checkout-adjacent infra, webhook processing, cancellation)
# with sales and access control both off — the Phase 3 preparation state,
# and also what the "sales-off rollback"/shutdown runbooks fall back to.
VALID_PREPARED_ENV = {
    "TF_VAR_billing_enabled": "true",
    **VALID_STRIPE_IDS,
}

# Full phased-activation chain: access control enforced, billing core
# running, sales open, terms approved, a real (past) cutoff set.
VALID_FULL_ACTIVATION_ENV = {
    "TF_VAR_access_control_enabled": "true",
    "TF_VAR_billing_enabled": "true",
    "TF_VAR_billing_sales_enabled": "true",
    "TF_VAR_billing_terms_approved": "true",
    "TF_VAR_grandfather_cutoff": "2020-01-01T00:00:00Z",
    **VALID_STRIPE_IDS,
}


def run_guard(env_overrides=None):
    env = {"PATH": f"{Path(sys.executable).parent}{os.pathsep}/usr/bin:/bin"}
    env.update(env_overrides or {})
    return subprocess.run(
        ["bash", str(SCRIPT)],
        env=env,
        capture_output=True,
        text=True,
        timeout=10,
    )


def test_script_exists_and_is_executable():
    assert SCRIPT.is_file()
    assert os.access(SCRIPT, os.X_OK)


def test_all_defaults_matches_current_production_and_passes():
    result = run_guard()
    assert result.returncode == 0, result.stderr
    assert "billing_enabled=false" in result.stdout


def test_fully_prepared_billing_core_with_sales_off_passes():
    result = run_guard(VALID_PREPARED_ENV)
    assert result.returncode == 0, result.stderr


def test_core_billing_allows_operation_with_terms_not_approved():
    # Shutdown/recovery preservation: core billing (webhook processing,
    # existing-subscription cancellation) with sales/access off must keep
    # working even if billing_terms_approved is false or was flipped back to
    # false — it must not require a terms re-review to keep serving existing
    # customers.
    result = run_guard({**VALID_PREPARED_ENV, "TF_VAR_billing_terms_approved": "false"})
    assert result.returncode == 0, result.stderr


def test_full_phased_activation_chain_passes():
    result = run_guard(VALID_FULL_ACTIVATION_ENV)
    assert result.returncode == 0, result.stderr


def test_does_not_echo_config_values_on_success():
    result = run_guard(VALID_FULL_ACTIVATION_ENV)
    for value in VALID_STRIPE_IDS.values():
        assert value not in result.stdout
        assert value not in result.stderr
    assert VALID_FULL_ACTIVATION_ENV["TF_VAR_grandfather_cutoff"] not in result.stdout
    assert VALID_FULL_ACTIVATION_ENV["TF_VAR_grandfather_cutoff"] not in result.stderr


@pytest.mark.parametrize(
    "overrides,expected_message",
    [
        ({"TF_VAR_billing_sales_enabled": "true"}, "billing_sales_enabled=true requires billing_enabled=true"),
        (
            {
                "TF_VAR_billing_sales_enabled": "true",
                "TF_VAR_billing_enabled": "true",
                **VALID_STRIPE_IDS,
            },
            "billing_sales_enabled=true requires access_control_enabled=true",
        ),
        (
            {
                "TF_VAR_billing_sales_enabled": "true",
                "TF_VAR_billing_enabled": "true",
                "TF_VAR_access_control_enabled": "true",
                "TF_VAR_grandfather_cutoff": "2020-01-01T00:00:00Z",
                **VALID_STRIPE_IDS,
            },
            "billing_sales_enabled=true requires billing_terms_approved=true",
        ),
        (
            {
                "TF_VAR_billing_sales_enabled": "true",
                "TF_VAR_billing_enabled": "true",
                "TF_VAR_access_control_enabled": "true",
                "TF_VAR_billing_terms_approved": "true",
                **VALID_STRIPE_IDS,
            },
            "billing_sales_enabled=true requires a non-empty grandfather_cutoff",
        ),
        ({"TF_VAR_billing_enabled": "true"}, "stripe_price_id to be set"),
        ({"TF_VAR_access_control_enabled": "true"}, "access_control_enabled=true requires billing_enabled=true"),
        (
            {**VALID_PREPARED_ENV, "TF_VAR_access_control_enabled": "true"},
            "requires a non-empty grandfather_cutoff",
        ),
        (
            {
                **VALID_PREPARED_ENV,
                "TF_VAR_access_control_enabled": "true",
                "TF_VAR_grandfather_cutoff": "2099-01-01T00:00:00Z",
            },
            "must not be in the future",
        ),
        (
            {
                **VALID_PREPARED_ENV,
                "TF_VAR_access_control_enabled": "true",
                "TF_VAR_grandfather_cutoff": "2024-02-30T00:00:00Z",
            },
            "not a valid UTC calendar timestamp",
        ),
        (
            {
                **VALID_PREPARED_ENV,
                "TF_VAR_access_control_enabled": "true",
                "TF_VAR_grandfather_cutoff": "2024-13-01T00:00:00Z",
            },
            "not a valid UTC calendar timestamp",
        ),
        (
            {
                **VALID_PREPARED_ENV,
                "TF_VAR_access_control_enabled": "true",
                "TF_VAR_grandfather_cutoff": "2024-1-1T0:0:0Z",
            },
            "not a valid UTC calendar timestamp",
        ),
        ({"TF_VAR_stripe_price_id": "price_1234567890ABC"}, "README example placeholder"),
        ({"TF_VAR_stripe_portal_configuration_id": "bpc_1234567890ABC"}, "README example placeholder"),
        ({"TF_VAR_stripe_price_id": "not-a-price-id"}, "does not look like a Stripe price ID"),
        (
            {"TF_VAR_stripe_portal_configuration_id": "not-a-portal-id"},
            "does not look like a Stripe portal configuration ID",
        ),
        ({"TF_VAR_stripe_secret_key_arn": "not-an-arn"}, "does not look like a Secrets Manager ARN"),
        ({"TF_VAR_stripe_webhook_secret_arn": "not-an-arn"}, "does not look like a Secrets Manager ARN"),
        (
            {
                "TF_VAR_stripe_secret_key_arn": (
                    "arn:aws:secretsmanager:eu-central-1:113725432218:secret:ffm/stripe-secret-test-abc"
                )
            },
            "does not match this repo's documented production path",
        ),
        (
            {
                "TF_VAR_stripe_webhook_secret_arn": (
                    "arn:aws:secretsmanager:eu-central-1:113725432218:secret:ffm-sandbox-webhook"
                )
            },
            "does not match this repo's documented production path",
        ),
        ({"TF_VAR_billing_enabled": "maybe"}, "must be exactly 'true' or 'false'"),
    ],
)
def test_rejects_unsafe_or_inconsistent_config(overrides, expected_message):
    result = run_guard(overrides)
    assert result.returncode != 0
    assert expected_message in result.stderr


def test_invalid_boolean_message_does_not_echo_the_offending_value():
    result = run_guard({"TF_VAR_billing_enabled": "s3cr3t-looking-value"})
    assert result.returncode != 0
    assert "s3cr3t-looking-value" not in result.stderr
    assert "s3cr3t-looking-value" not in result.stdout


def test_does_not_invent_or_require_stripe_ids_while_billing_disabled():
    # Phase-3 preparation: provisioning IDs ahead of activation while
    # billing_enabled stays false must remain allowed (no forced coupling).
    result = run_guard({"TF_VAR_stripe_price_id": "price_ABC123xyz"})
    assert result.returncode == 0, result.stderr


def test_does_not_scan_opaque_stripe_ids_for_test_or_dev_substrings():
    # Stripe price/portal-configuration IDs are opaque and don't encode
    # test-vs-live mode in their format; a real LIVE id can coincidentally
    # contain "test"/"dev"/"sandbox". The guard must not reject on that
    # basis — mode must be confirmed in the Stripe dashboard/API instead.
    result = run_guard(
        {
            **VALID_PREPARED_ENV,
            "TF_VAR_stripe_price_id": "price_TESTdevSandbox123",
        }
    )
    assert result.returncode == 0, result.stderr


def test_accepts_known_production_secret_path_without_random_suffix():
    result = run_guard(
        {
            **VALID_PREPARED_ENV,
            "TF_VAR_stripe_secret_key_arn": (
                "arn:aws:secretsmanager:eu-central-1:113725432218:secret:ffm/stripe-secret-key"
            ),
        }
    )
    assert result.returncode == 0, result.stderr
