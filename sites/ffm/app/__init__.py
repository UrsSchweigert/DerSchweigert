from flask import Flask
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
from flask_cors import CORS
from .models import db
from .config import BaseConfig, ProductionConfig
import os
import re


def create_app(config_class=None):
    app = Flask(__name__)
    
    if config_class is None:
        env = os.environ.get('FLASK_ENV', 'development')
        config_class = ProductionConfig if env == 'production' else BaseConfig
    
    app.config.from_object(config_class)
    
    # CORS: allow ffm.derschweigert.de in production, localhost:* in dev
    allowed_origins = ["https://ffm.derschweigert.de"]
    if os.environ.get('FLASK_ENV') != 'production':
        allowed_origins.append(re.compile(r"http://localhost:\d+"))
        allowed_origins.append(re.compile(r"http://127\.0\.0\.1:\d+"))
    
    CORS(app, origins=allowed_origins, supports_credentials=True)
    
    db.init_app(app)
    
    limiter = Limiter(
        get_remote_address,
        app=app,
        default_limits=["200/day", "50/hour"]
    )
    
    from .auth import auth_bp
    from .main import main_bp
    app.register_blueprint(auth_bp)
    app.register_blueprint(main_bp)
    
    with app.app_context():
        db.create_all()
    
    return app
