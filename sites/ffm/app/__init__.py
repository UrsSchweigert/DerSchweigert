from flask import Flask
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
from flask_cors import CORS
from .models import db
from .config import BaseConfig, ProductionConfig
import os
import re
from sqlalchemy import inspect, text


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
        _ensure_leaderboard_schema()
    
    return app


def _ensure_leaderboard_schema():
    from .models import LevelScore, UserHighScore

    inspector = inspect(db.engine)
    user_columns = {column["name"] for column in inspector.get_columns("users")}

    if "first_grade_year" not in user_columns:
        db.session.execute(text("ALTER TABLE users ADD COLUMN first_grade_year INTEGER"))
        db.session.commit()

    db.session.execute(text("CREATE INDEX IF NOT EXISTS ix_users_first_grade_year ON users(first_grade_year)"))
    UserHighScore.__table__.create(bind=db.engine, checkfirst=True)

    best_scores = (
        db.session.query(
            LevelScore.user_id,
            db.func.max(LevelScore.score).label("max_score")
        )
        .group_by(LevelScore.user_id)
        .all()
    )
    for user_id, max_score in best_scores:
        exists = UserHighScore.query.filter_by(user_id=user_id).first()
        if exists:
            continue
        best_row = (
            LevelScore.query
            .filter_by(user_id=user_id, score=max_score)
            .order_by(LevelScore.achieved_at.asc())
            .first()
        )
        if best_row:
            db.session.add(UserHighScore(
                user_id=user_id,
                high_score=max_score,
                achieved_at=best_row.achieved_at
            ))
    db.session.commit()
