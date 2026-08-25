from flask import Blueprint, request, jsonify, current_app, abort
import jwt
from .models import (
    MIN_FIRST_GRADE_YEAR, MAX_FIRST_GRADE_YEAR,
    get_user, update_user_first_grade_year,
    get_level_scores, put_level_score,
    get_high_score, put_high_score,
    get_leaderboard,
)

main_bp = Blueprint('api', __name__, url_prefix='/api')


def require_auth():
    """Verify JWT bearer token; returns username."""
    auth_header = request.headers.get('Authorization', '')
    if not auth_header.startswith('Bearer '):
        abort(401, description="Unauthorized")
    token = auth_header[7:]
    try:
        payload = jwt.decode(token, current_app.config['SECRET_KEY'], algorithms=['HS256'])
        return payload['sub']
    except (jwt.ExpiredSignatureError, jwt.InvalidTokenError, KeyError):
        abort(401, description="Unauthorized")


@main_bp.route('/health', methods=['GET'])
def health():
    return jsonify({"ok": True}), 200


@main_bp.route('/profile', methods=['GET'])
def profile():
    username = require_auth()
    user = get_user(username)
    if not user:
        abort(404)

    scores = get_level_scores(username)
    hs = get_high_score(username)

    return jsonify({
        "user": {
            "username": user['username'],
            "first_grade_year": user['first_grade_year'],
        },
        "high_score": {"score": hs['high_score'], "achieved_at": hs['achieved_at']} if hs else None,
        "scores": scores,
    }), 200


@main_bp.route('/profile', methods=['PATCH'])
def update_profile():
    username = require_auth()
    user = get_user(username)
    if not user:
        abort(404)

    data = request.get_json()
    if not data or 'first_grade_year' not in data:
        return jsonify({"error": "Invalid input"}), 400

    first_grade_year = data['first_grade_year']
    if first_grade_year is not None:
        if type(first_grade_year) is not int or not (MIN_FIRST_GRADE_YEAR <= first_grade_year <= MAX_FIRST_GRADE_YEAR):
            return jsonify({"error": f"first_grade_year must be between {MIN_FIRST_GRADE_YEAR} and {MAX_FIRST_GRADE_YEAR}"}), 400

    update_user_first_grade_year(username, first_grade_year)

    return jsonify({
        "user": {"username": username, "first_grade_year": first_grade_year}
    }), 200


@main_bp.route('/score', methods=['POST'])
def submit_score():
    username = require_auth()

    data = request.get_json()
    if not data:
        return jsonify({"error": "Invalid input"}), 400

    level = data.get('level')
    score = data.get('score')
    difficulty = data.get('difficulty', '').strip()

    if not isinstance(level, int) or not (1 <= level <= 60):
        return jsonify({"error": "Invalid input"}), 400
    if not isinstance(score, int) or score < 0:
        return jsonify({"error": "Invalid input"}), 400
    if difficulty not in ("easy", "medium", "hard"):
        return jsonify({"error": "Invalid input"}), 400

    saved, personal_best = put_level_score(username, level, score, difficulty)
    return jsonify({"saved": saved, "personal_best": personal_best}), 200


@main_bp.route('/high-score', methods=['POST'])
def submit_high_score():
    username = require_auth()

    data = request.get_json()
    if not data:
        return jsonify({"error": "Invalid input"}), 400

    score = data.get('score')
    if type(score) is not int or score < 0:
        return jsonify({"error": "Invalid input"}), 400

    user = get_user(username)
    first_grade_year = user['first_grade_year'] if user else None

    saved, record = put_high_score(username, score, first_grade_year)
    return jsonify({
        "saved": saved,
        "high_score": record['high_score'],
        "achieved_at": record['achieved_at'],
    }), 200


@main_bp.route('/leaderboard', methods=['GET'])
def leaderboard():
    first_grade_year_param = request.args.get('first_grade_year')
    first_grade_year_filter = None
    if first_grade_year_param is not None:
        try:
            first_grade_year_filter = int(first_grade_year_param)
        except ValueError:
            return jsonify({"error": "Invalid first_grade_year filter"}), 400
        if not (MIN_FIRST_GRADE_YEAR <= first_grade_year_filter <= MAX_FIRST_GRADE_YEAR):
            return jsonify({"error": "Invalid first_grade_year filter"}), 400

    global_entries, grouped_entries = get_leaderboard(first_grade_year_filter)

    return jsonify({
        "first_grade_year_filter": first_grade_year_filter,
        "global_entries": global_entries,
        "grouped_entries": grouped_entries,
    }), 200

