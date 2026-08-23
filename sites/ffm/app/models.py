from flask_sqlalchemy import SQLAlchemy
from datetime import datetime

db = SQLAlchemy()


class User(db.Model):
    __tablename__ = 'users'
    
    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    username = db.Column(db.String(20), nullable=False, unique=True)
    email = db.Column(db.String(120), nullable=False, unique=True)
    password_hash = db.Column(db.String(128), nullable=False)
    created_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)
    
    __table_args__ = (
        db.CheckConstraint('length(username) >= 3 AND length(username) <= 20', name='check_username_length'),
    )


class LevelScore(db.Model):
    __tablename__ = 'level_scores'
    
    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    level = db.Column(db.Integer, nullable=False)
    score = db.Column(db.Integer, nullable=False)
    difficulty = db.Column(db.String(10), nullable=False)
    achieved_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)
    
    __table_args__ = (
        db.CheckConstraint('level >= 1 AND level <= 40', name='check_level_range'),
        db.CheckConstraint('score >= 0', name='check_score_positive'),
        db.UniqueConstraint('user_id', 'level', 'difficulty', name='uq_user_level_difficulty'),
    )
