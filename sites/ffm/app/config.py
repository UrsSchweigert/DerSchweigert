import os


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
    DYNAMODB_USERS_TABLE = os.environ.get('DYNAMODB_USERS_TABLE', 'ffm-users')
    DYNAMODB_SCORES_TABLE = os.environ.get('DYNAMODB_SCORES_TABLE', 'ffm-scores')
    DYNAMODB_RATELIMIT_TABLE = os.environ.get('DYNAMODB_RATELIMIT_TABLE', 'ffm-ratelimits')


class ProductionConfig(BaseConfig):
    # memory:// cannot share counters across Lambda's concurrent execution
    # environments, so production persists counters in DynamoDB instead.
    RATELIMIT_STORAGE_URI = os.environ.get('RATELIMIT_STORAGE_URI', 'dynamodb://ffm-ratelimits')


class TestingConfig(BaseConfig):
    TESTING = True
    SECRET_KEY = "test-secret-key-for-testing-only"  # ONLY override in TestingConfig
    DYNAMODB_USERS_TABLE = 'ffm-users-test'
    DYNAMODB_SCORES_TABLE = 'ffm-scores-test'
    DYNAMODB_RATELIMIT_TABLE = 'ffm-ratelimits-test'
    # High enough that the functional test suite (which calls /auth/login
    # and /auth/register many times from the same test-client IP) never
    # trips it; the real 10/minute limit is covered by a dedicated test
    # that overrides this value for just that one request cycle.
    AUTH_RATE_LIMIT = "1000/minute"
