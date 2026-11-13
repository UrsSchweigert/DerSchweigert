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
    if app.config['ACCESS_CONTROL_ENABLED']:
        from datetime import datetime, timezone
        cutoff = app.config['GRANDFATHER_CUTOFF']
        if not cutoff:
            raise ValueError('A fixed GRANDFATHER_CUTOFF is required before launching paid access')
        parsed = datetime.fromisoformat(cutoff.replace('Z', '+00:00'))
        if parsed.tzinfo is None or parsed.utcoffset().total_seconds() != 0:
            raise ValueError('GRANDFATHER_CUTOFF must include the UTC timezone')
        if parsed > datetime.now(timezone.utc):
            raise ValueError('GRANDFATHER_CUTOFF cannot be in the future at launch')
    if app.config['BILLING_SALES_ENABLED']:
        if not all(app.config[key] for key in (
            'ACCESS_CONTROL_ENABLED', 'BILLING_ENABLED', 'BILLING_TERMS_APPROVED', 'STRIPE_PRICE_ID',
        )):
            raise ValueError('Sales require configured billing, access control, price and reviewed terms')

    # Propagate table names to environment so models.py reads them at call time
    os.environ['DYNAMODB_USERS_TABLE'] = app.config['DYNAMODB_USERS_TABLE']
    os.environ['DYNAMODB_SCORES_TABLE'] = app.config['DYNAMODB_SCORES_TABLE']
    os.environ['DYNAMODB_RATELIMIT_TABLE'] = app.config['DYNAMODB_RATELIMIT_TABLE']
    os.environ['SES_SENDER_EMAIL'] = app.config['SES_SENDER_EMAIL']
    os.environ['SES_CONFIGURATION_SET'] = app.config['SES_CONFIGURATION_SET']
    os.environ['BETA_WAITLIST_NOTIFY_EMAIL'] = app.config['BETA_WAITLIST_NOTIFY_EMAIL']
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
    from .billing import billing_bp
    from .cancel_requests import cancel_requests_bp
    from .withdrawal_requests import withdrawal_requests_bp
    from .beta_waitlist import beta_waitlist_bp
    app.register_blueprint(auth_bp)
    app.register_blueprint(main_bp)
    app.register_blueprint(billing_bp)
    app.register_blueprint(cancel_requests_bp)
    app.register_blueprint(withdrawal_requests_bp)
    app.register_blueprint(beta_waitlist_bp)
    from .billing_admin import register_billing_commands
    register_billing_commands(app)
    from .retention_admin import register_retention_commands
    register_retention_commands(app)
    from .beta_waitlist import register_beta_commands
    register_beta_commands(app)

    return app
