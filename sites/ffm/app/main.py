from flask import Blueprint, request, jsonify, current_app, abort
import jwt
from .models import db, User, LevelScore

main_bp = Blueprint('api', __name__, url_prefix='/api')


def require_auth():
    """Helper to extract and verify JWT token, returns user_id"""
    auth_header = request.headers.get('Authorization', '')
    
    if not auth_header.startswith('Bearer '):
        abort(401, description="Unauthorized")
    
    token = auth_header[7:]  # Remove 'Bearer ' prefix
    
    try:
        payload = jwt.decode(token, current_app.config['SECRET_KEY'], algorithms=['HS256'])
        return int(payload['sub'])
    except jwt.ExpiredSignatureError:
        abort(401, description="Unauthorized")
    except jwt.InvalidTokenError:
        abort(401, description="Unauthorized")
    except (KeyError, ValueError):
        abort(401, description="Unauthorized")


@main_bp.route('/health', methods=['GET'])
def health():
    """Public health check endpoint"""
    return jsonify({"ok": True}), 200


@main_bp.route('/profile', methods=['GET'])
def profile():
    """Get user profile with all scores"""
    user_id = require_auth()
    
    user = User.query.get_or_404(user_id)
    scores = LevelScore.query.filter_by(user_id=user_id).all()
    
    return jsonify({
        "user": {
            "id": user.id,
            "username": user.username
        },
        "scores": [
            {
                "level": s.level,
                "score": s.score,
                "difficulty": s.difficulty,
                "achieved_at": s.achieved_at.isoformat()
            }
            for s in scores
        ]
    }), 200


@main_bp.route('/score', methods=['POST'])
def submit_score():
    """Submit a score for a level"""
    user_id = require_auth()
    
    data = request.get_json()
    if not data:
        return jsonify({"error": "Invalid input"}), 400
    
    level = data.get('level')
    score = data.get('score')
    difficulty = data.get('difficulty', '').strip()
    
    # Validate input
    if not isinstance(level, int) or not (1 <= level <= 40):
        return jsonify({"error": "Invalid input"}), 400
    if not isinstance(score, int) or score < 0:
        return jsonify({"error": "Invalid input"}), 400
    if difficulty not in ["easy", "medium", "hard"]:
        return jsonify({"error": "Invalid input"}), 400
    
    # Check for existing record
    existing = LevelScore.query.filter_by(
        user_id=user_id,
        level=level,
        difficulty=difficulty
    ).first()
    
    if existing:
        if score <= existing.score:
            # Not a personal best
            return jsonify({
                "saved": False,
                "personal_best": existing.score
            }), 200
        else:
            # New personal best - update
            existing.score = score
            existing.achieved_at = db.func.now()
            db.session.commit()
            return jsonify({
                "saved": True,
                "personal_best": score
            }), 200
    else:
        # New record
        new_score = LevelScore(
            user_id=user_id,
            level=level,
            score=score,
            difficulty=difficulty
        )
        db.session.add(new_score)
        db.session.commit()
        return jsonify({
            "saved": True,
            "personal_best": score
        }), 200


@main_bp.route('/leaderboard', methods=['GET'])
def leaderboard():
    """Get leaderboard, optionally filtered by level"""
    level_param = request.args.get('level')
    
    level_filter = None
    if level_param:
        try:
            level_filter = int(level_param)
            if not (1 <= level_filter <= 40):
                level_filter = None
        except ValueError:
            level_filter = None
    
    # Build query
    query = db.session.query(LevelScore, User).join(User)
    
    if level_filter:
        query = query.filter(LevelScore.level == level_filter)
    
    results = query.order_by(LevelScore.score.desc()).limit(10).all()
    
    entries = []
    for i, (score_obj, user_obj) in enumerate(results):
        entries.append({
            "rank": i + 1,
            "username": user_obj.username,
            "score": score_obj.score,
            "difficulty": score_obj.difficulty,
            "achieved_at": score_obj.achieved_at.isoformat()
        })
    
    return jsonify({
        "level": level_filter,
        "entries": entries
    }), 200
