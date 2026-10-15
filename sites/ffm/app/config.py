import os
from datetime import datetime, timezone


class BaseConfig:
    SECRET_KEY = os.environ['SECRET_KEY']  # no fallback, raise KeyError if missing
    JWT_ACCESS_EXPIRES = 900  # 15 minutes in seconds
    JWT_REFRESH_EXPIRES = 2592000  # 30 days in seconds
    # Applied per-request-IP by app/extensions.py's shared Limiter instance.
    RATELIMIT_STORAGE_URI = os.environ.get('RATELIMIT_STORAGE_URI', 'memory://')
    # Tighter limit for the brute-forceable /auth/login and /auth/register
    # routes specifically (see app/auth.py). Kept apart from the app-wide
    # default so it can be tuned independently.
    AUTH_RATE_LIMIT = "10/minute"
    # Applied per-*target-email* (not per-IP) specifically to
    # /auth/resend-verification and /auth/forgot-password. AUTH_RATE_LIMIT
    # above only bounds requests per source IP, so an attacker rotating IPs
    # (or just being patient) could otherwise call either endpoint against
    # one victim's address indefinitely, using our domain to mail-bomb
    # someone who never asked for anything. This limit closes that
    # specifically by keying on the email in the request body instead of
    # the caller's IP — see _email_rate_limit_key() in auth.py.
    EMAIL_TARGET_RATE_LIMIT = "3/hour"
    DYNAMODB_USERS_TABLE = os.environ.get('DYNAMODB_USERS_TABLE', 'ffm-users')
    DYNAMODB_SCORES_TABLE = os.environ.get('DYNAMODB_SCORES_TABLE', 'ffm-scores')
    DYNAMODB_RATELIMIT_TABLE = os.environ.get('DYNAMODB_RATELIMIT_TABLE', 'ffm-ratelimits')
    SES_SENDER_EMAIL = os.environ.get('SES_SENDER_EMAIL', 'no-reply@ffm.derschweigert.de')
    # SES configuration set that tags every outgoing email so CloudWatch can
    # track Send/Bounce/Complaint/Reject counts and the alarms in
    # infra/terraform/sites/ffm/main.tf can actually fire (see app/mailer.py's
    # ConfigurationSetName usage). Empty default is fine locally/in tests —
    # SES accepts sends with no configuration set, it just won't be tracked.
    SES_CONFIGURATION_SET = os.environ.get('SES_CONFIGURATION_SET', '')
    APP_BASE_URL = os.environ.get('APP_BASE_URL', 'https://ffm.derschweigert.de')
    # Cloudflare Turnstile CAPTCHA verification, applied to the anonymous
    # mail-triggering endpoints (register/forgot-password/resend-verification,
    # see app/captcha.py and app/auth.py). TURNSTILE_SECRET_KEY is resolved
    # from Secrets Manager at Lambda cold start (see lambda/handler.py); it
    # is intentionally NOT read directly by config.py the way SES_SENDER_EMAIL
    # is, since app/captcha.py reads it from os.environ at call time instead
    # (same lazy-read pattern as mailer.py), so no config.py attribute is
    # needed for the secret value itself.
    TURNSTILE_ENABLED = True

    # Access control and billing configuration
    ACCESS_CONTROL_ENABLED = os.environ.get('ACCESS_CONTROL_ENABLED', '').lower() in ('true', '1', 'yes')
    GRANDFATHER_CUTOFF = os.environ.get('GRANDFATHER_CUTOFF', '')  # UTC ISO timestamp
    BILLING_ENABLED = os.environ.get('BILLING_ENABLED', '').lower() in ('true', '1', 'yes')
    BILLING_SALES_ENABLED = os.environ.get('BILLING_SALES_ENABLED', '').lower() in ('true', '1', 'yes')
    STRIPE_PRICE_ID = os.environ.get('STRIPE_PRICE_ID', '')
    STRIPE_PORTAL_CONFIGURATION_ID = os.environ.get('STRIPE_PORTAL_CONFIGURATION_ID', '')
    STRIPE_SECRET_KEY = None  # Lazy-loaded from os.environ at runtime if needed
    STRIPE_WEBHOOK_SECRET = None  # Lazy-loaded from os.environ at runtime if needed
    BILLING_TERMS_APPROVED = os.environ.get('BILLING_TERMS_APPROVED', '').lower() in ('true', '1', 'yes')

    # Public, unauthenticated /api/cancel-requests submission endpoint
    # (app/cancel_requests.py). Kept apart from AUTH_RATE_LIMIT/
    # EMAIL_TARGET_RATE_LIMIT since it has its own distinct abuse profile
    # (no email target, no auth) — a reasonable per-source-IP bound high
    # enough for a legitimate user submitting (and reviewing/correcting)
    # one request, without allowing unbounded anonymous durable writes.
    CANCEL_REQUEST_RATE_LIMIT = "5/minute"


class ProductionConfig(BaseConfig):
    # memory:// cannot share counters across Lambda's concurrent execution
    # environments, so production persists counters in DynamoDB instead.
    RATELIMIT_STORAGE_URI = os.environ.get('RATELIMIT_STORAGE_URI', 'dynamodb://ffm-ratelimits')


class TestingConfig(BaseConfig):
    TESTING = True
    ACCESS_CONTROL_ENABLED = False
    BILLING_ENABLED = False
    BILLING_SALES_ENABLED = False
    BILLING_TERMS_APPROVED = False
    GRANDFATHER_CUTOFF = ''
    SECRET_KEY = "test-secret-key-for-testing-only"  # ONLY override in TestingConfig
    DYNAMODB_USERS_TABLE = 'ffm-users-test'
    DYNAMODB_SCORES_TABLE = 'ffm-scores-test'
    DYNAMODB_RATELIMIT_TABLE = 'ffm-ratelimits-test'
    # High enough that the functional test suite (which calls /auth/login
    # and /auth/register many times from the same test-client IP) never
    # trips it; the real 10/minute limit is covered by a dedicated test
    # that overrides this value for just that one request cycle.
    AUTH_RATE_LIMIT = "1000/minute"
    # Same rationale as AUTH_RATE_LIMIT's test override: high enough that
    # the test suite's own repeated calls (often reusing the same test
    # email) never trip it; a dedicated test overrides this value down to
    # exercise the real limit for just that one request cycle.
    EMAIL_TARGET_RATE_LIMIT = "1000/hour"
    # Disabled by default so the existing test suite's many
    # register/forgot-password/resend-verification calls don't need a real
    # (or mocked) Turnstile token; dedicated tests re-enable this on a
    # per-test config subclass and monkeypatch captcha.verify_turnstile_token
    # to exercise the enforcement logic itself.
    TURNSTILE_ENABLED = False
    # Same rationale as AUTH_RATE_LIMIT's test override: high enough that
    # this test suite's own repeated calls never trip it; a dedicated test
    # overrides this value down to exercise the real limit for just that
    # one request cycle (see tests/test_cancel_requests.py).
    CANCEL_REQUEST_RATE_LIMIT = "1000/minute"
    CANCEL_REQUEST_RATE_LIMIT = "1000/minute"
