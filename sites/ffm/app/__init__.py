import os
import re

from flask import Flask
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
from flask_cors import CORS
from .config import BaseConfig, ProductionConfig


def create_app(config_class=None):
    app = Flask(__name__)

    if config_class is None:
        env = os.environ.get('FLASK_ENV', 'development')
        config_class = ProductionConfig if env == 'production' else BaseConfig

    app.config.from_object(config_class)

    # Propagate table names to environment so models.py reads them at call time
    os.environ['DYNAMODB_USERS_TABLE'] = app.config['DYNAMODB_USERS_TABLE']
    os.environ['DYNAMODB_SCORES_TABLE'] = app.config['DYNAMODB_SCORES_TABLE']

    allowed_origins = ["https://ffm.derschweigert.de"]
    if os.environ.get('FLASK_ENV') != 'production':
        allowed_origins.append(re.compile(r"http://localhost:\d+"))
        allowed_origins.append(re.compile(r"http://127\.0\.0\.1:\d+"))

    CORS(app, origins=allowed_origins, supports_credentials=True)

    Limiter(get_remote_address, app=app, default_limits=["200/day", "50/hour"])

    from .auth import auth_bp
    from .main import main_bp
    app.register_blueprint(auth_bp)
    app.register_blueprint(main_bp)

    return app
