import os
import re

from flask import Flask
from flask_cors import CORS
from .config import BaseConfig, ProductionConfig
from .extensions import limiter
from . import ratelimit_storage  # noqa: F401 — import registers the "dynamodb://" storage scheme


def create_app(config_class=None):
    app = Flask(__name__)

    if config_class is None:
        env = os.environ.get('FLASK_ENV', 'development')
        config_class = ProductionConfig if env == 'production' else BaseConfig

    app.config.from_object(config_class)

    # Propagate table names to environment so models.py reads them at call time
    os.environ['DYNAMODB_USERS_TABLE'] = app.config['DYNAMODB_USERS_TABLE']
    os.environ['DYNAMODB_SCORES_TABLE'] = app.config['DYNAMODB_SCORES_TABLE']
    os.environ['DYNAMODB_RATELIMIT_TABLE'] = app.config['DYNAMODB_RATELIMIT_TABLE']
    os.environ['SES_SENDER_EMAIL'] = app.config['SES_SENDER_EMAIL']
    os.environ['APP_BASE_URL'] = app.config['APP_BASE_URL']

    allowed_origins = ["https://ffm.derschweigert.de"]
    if os.environ.get('FLASK_ENV') != 'production':
        allowed_origins.append(re.compile(r"http://localhost:\d+"))
        allowed_origins.append(re.compile(r"http://127\.0\.0\.1:\d+"))

    CORS(app, origins=allowed_origins, supports_credentials=True)

    # `limiter` is a single module-level instance shared with app/auth.py so
    # its per-route @limiter.limit(...) decorators are bound to the same
    # instance that gets init_app()'d here (and therefore actually enforced).
    limiter.init_app(app)

    from .auth import auth_bp
    from .main import main_bp
    app.register_blueprint(auth_bp)
    app.register_blueprint(main_bp)

    return app
