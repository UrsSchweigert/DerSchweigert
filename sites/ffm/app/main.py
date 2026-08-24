from flask import Blueprint, request, jsonify, current_app, abort
import jwt
from .models import (
    db,
    User,
    LevelScore,
    UserHighScore,
    MIN_FIRST_GRADE_YEAR,
    MAX_FIRST_GRADE_YEAR,
)

main_bp = Blueprint('api', __name__, url_prefix='/api')
LEADERBOARD_LIMIT = 10


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
    """Get user profile with score history and high score."""
    user_id = require_auth()
    
    user = User.query.get_or_404(user_id)
    scores = LevelScore.query.filter_by(user_id=user_id).all()
    high_score = UserHighScore.query.filter_by(user_id=user_id).first()
    
    return jsonify({
        "user": {
            "id": user.id,
            "username": user.username,
            "first_grade_year": user.first_grade_year,
        },
        "high_score": {
            "score": high_score.high_score,
            "achieved_at": high_score.achieved_at.isoformat()
        } if high_score else None,
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


@main_bp.route('/profile', methods=['PATCH'])
def update_profile():
    """Update profile fields needed for leaderboard participation."""
    user_id = require_auth()
    user = User.query.get_or_404(user_id)
    data = request.get_json()
    if not data or 'first_grade_year' not in data:
        return jsonify({"error": "Invalid input"}), 400

    first_grade_year = data.get('first_grade_year')
    if first_grade_year is not None:
        if not isinstance(first_grade_year, int) or not (MIN_FIRST_GRADE_YEAR <= first_grade_year <= MAX_FIRST_GRADE_YEAR):
            return jsonify({"error": f"first_grade_year must be between {MIN_FIRST_GRADE_YEAR} and {MAX_FIRST_GRADE_YEAR}"}), 400

    user.first_grade_year = first_grade_year
    db.session.commit()

    return jsonify({
        "user": {
            "id": user.id,
            "username": user.username,
            "first_grade_year": user.first_grade_year,
        }
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
    if not isinstance(level, int) or not (1 <= level <= 60):
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


@main_bp.route('/high-score', methods=['POST'])
def submit_high_score():
    """Submit a run-end score and keep only the user's max score."""
    user_id = require_auth()
    data = request.get_json()
    if not data:
        return jsonify({"error": "Invalid input"}), 400

    score = data.get('score')
    if not isinstance(score, int) or score < 0:
        return jsonify({"error": "Invalid input"}), 400

    dialect = db.session.bind.dialect.name
    if dialect == 'sqlite':
        from sqlalchemy.dialects.sqlite import insert as dialect_insert
    elif dialect == 'postgresql':
        from sqlalchemy.dialects.postgresql import insert as dialect_insert
    else:
        dialect_insert = None

    if dialect_insert is not None:
        insert_stmt = dialect_insert(UserHighScore).values(
            user_id=user_id,
            high_score=score,
            achieved_at=db.func.now()
        )
        upsert_stmt = insert_stmt.on_conflict_do_update(
            index_elements=['user_id'],
            set_={
                'high_score': insert_stmt.excluded.high_score,
                'achieved_at': insert_stmt.excluded.achieved_at
            },
            where=insert_stmt.excluded.high_score > UserHighScore.high_score
        )
        result = db.session.execute(upsert_stmt)
        db.session.commit()
        saved = result.rowcount > 0
    else:
        current = UserHighScore.query.filter_by(user_id=user_id).first()
        if current is None:
            current = UserHighScore(user_id=user_id, high_score=score, achieved_at=db.func.now())
            db.session.add(current)
            db.session.commit()
            saved = True
        elif score > current.high_score:
            current.high_score = score
            current.achieved_at = db.func.now()
            db.session.commit()
            saved = True
        else:
            saved = False

    current = UserHighScore.query.filter_by(user_id=user_id).first()
    return jsonify({
        "saved": saved,
        "high_score": current.high_score,
        "achieved_at": current.achieved_at.isoformat()
    }), 200


@main_bp.route('/leaderboard', methods=['GET'])
def leaderboard():
    """Get global and first-grade-year grouped leaderboards."""
    first_grade_year_param = request.args.get('first_grade_year')
    first_grade_year_filter = None
    if first_grade_year_param is not None:
        try:
            first_grade_year_filter = int(first_grade_year_param)
        except ValueError:
            return jsonify({"error": "Invalid first_grade_year filter"}), 400
        if not (MIN_FIRST_GRADE_YEAR <= first_grade_year_filter <= MAX_FIRST_GRADE_YEAR):
            return jsonify({"error": "Invalid first_grade_year filter"}), 400

    global_results = (
        db.session.query(UserHighScore, User)
        .join(User, User.id == UserHighScore.user_id)
        .order_by(UserHighScore.high_score.desc(), UserHighScore.achieved_at.asc(), User.username.asc())
        .limit(LEADERBOARD_LIMIT)
        .all()
    )

    global_entries = [
        {
            "rank": i + 1,
            "username": user_obj.username,
            "high_score": score_obj.high_score,
            "first_grade_year": user_obj.first_grade_year,
            "achieved_at": score_obj.achieved_at.isoformat()
        }
        for i, (score_obj, user_obj) in enumerate(global_results)
    ]

    grouped_query = (
        db.session.query(UserHighScore, User)
        .join(User, User.id == UserHighScore.user_id)
    )
    if first_grade_year_filter is not None:
        grouped_query = grouped_query.filter(User.first_grade_year == first_grade_year_filter)

    grouped_results = grouped_query.order_by(
        User.first_grade_year.asc(),
        UserHighScore.high_score.desc(),
        UserHighScore.achieved_at.asc(),
        User.username.asc()
    ).all()

    grouped_map = {}
    for score_obj, user_obj in grouped_results:
        grouped_map.setdefault(user_obj.first_grade_year, []).append((score_obj, user_obj))

    grouped_entries = []
    for year in sorted(grouped_map.keys(), key=lambda v: (v is None, v if v is not None else 0)):
        entries = []
        for rank, (score_obj, user_obj) in enumerate(grouped_map[year][:LEADERBOARD_LIMIT], start=1):
            entries.append({
                "rank": rank,
                "username": user_obj.username,
                "high_score": score_obj.high_score,
                "first_grade_year": year,
                "achieved_at": score_obj.achieved_at.isoformat()
            })
        grouped_entries.append({
            "first_grade_year": year,
            "label": str(year) if year is not None else "unclassified",
            "entries": entries
        })

    return jsonify({
        "first_grade_year_filter": first_grade_year_filter,
        "global_entries": global_entries,
        "grouped_entries": grouped_entries
    }), 200
