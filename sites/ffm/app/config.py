import os


class BaseConfig:
    SECRET_KEY = os.environ['SECRET_KEY']  # no fallback, raise KeyError if missing
    JWT_ACCESS_EXPIRES = 900  # 15 minutes in seconds
    JWT_REFRESH_EXPIRES = 2592000  # 30 days in seconds
    RATELIMIT_DEFAULT = "10/minute"
    RATELIMIT_STORAGE_URI = "memory://"
    DYNAMODB_USERS_TABLE = os.environ.get('DYNAMODB_USERS_TABLE', 'ffm-users')
    DYNAMODB_SCORES_TABLE = os.environ.get('DYNAMODB_SCORES_TABLE', 'ffm-scores')


class ProductionConfig(BaseConfig):
    pass


class TestingConfig(BaseConfig):
    TESTING = True
    SECRET_KEY = "test-secret-key-for-testing-only"  # ONLY override in TestingConfig
    DYNAMODB_USERS_TABLE = 'ffm-users-test'
    DYNAMODB_SCORES_TABLE = 'ffm-scores-test'
