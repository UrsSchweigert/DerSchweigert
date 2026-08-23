import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent


class BaseConfig:
    SQLALCHEMY_DATABASE_URI = f"sqlite:///{BASE_DIR}/ffm.db"
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    SECRET_KEY = os.environ['SECRET_KEY']  # no fallback, raise KeyError if missing
    JWT_ACCESS_EXPIRES = 900  # 15 minutes in seconds
    JWT_REFRESH_EXPIRES = 2592000  # 30 days in seconds
    RATELIMIT_DEFAULT = "10/minute"
    RATELIMIT_STORAGE_URI = "memory://"


class ProductionConfig(BaseConfig):
    SQLALCHEMY_DATABASE_URI = os.environ.get('DATABASE_URL', BaseConfig.SQLALCHEMY_DATABASE_URI)


class TestingConfig(BaseConfig):
    TESTING = True
    SQLALCHEMY_DATABASE_URI = "sqlite:///:memory:"
    SECRET_KEY = "test-secret-key-for-testing-only"  # ONLY override in TestingConfig
