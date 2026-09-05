from flask import Blueprint, request, jsonify, current_app, abort
import bcrypt
import sys
import jwt
from .models import (
    MIN_FIRST_GRADE_YEAR, MAX_FIRST_GRADE_YEAR,
    CHANGE_EMAIL_TTL_SECONDS,
    get_user, update_user_first_grade_year,
    get_user_by_email, set_password_hash, set_pending_email,
    create_token,
    get_level_scores, put_level_score,
    get_high_score, put_high_score,
    put_score_history, get_score_history,
    get_leaderboard,
)
from .validation import is_valid_int
from . import mailer

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
            "email": user['email'],
            "email_verified": user['email_verified'],
            "pending_email": user['pending_email'],
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
        if not is_valid_int(first_grade_year, MIN_FIRST_GRADE_YEAR, MAX_FIRST_GRADE_YEAR):
            return jsonify({"error": f"first_grade_year must be between {MIN_FIRST_GRADE_YEAR} and {MAX_FIRST_GRADE_YEAR}"}), 400

    update_user_first_grade_year(username, first_grade_year)

    return jsonify({
        "user": {"username": username, "first_grade_year": first_grade_year}
    }), 200


@main_bp.route('/profile/password', methods=['POST'])
def update_password():
    username = require_auth()
    user = get_user(username)
    if not user:
        abort(404)

    data = request.get_json()
    if not data:
        return jsonify({"error": "Invalid input"}), 400

    current_password = data.get('current_password', '')
    new_password = data.get('new_password', '')

    if not bcrypt.checkpw(current_password.encode('utf-8'), user['password_hash'].encode('utf-8')):
        return jsonify({"error": "Invalid current password"}), 401

    if not new_password or len(new_password) < 8 or len(new_password) > 128:
        return jsonify({"error": "Password must be 8-128 characters"}), 400

    password_hash = bcrypt.hashpw(new_password.encode('utf-8'), bcrypt.gensalt(rounds=12)).decode('utf-8')
    set_password_hash(username, password_hash)

    return jsonify({"ok": True}), 200


@main_bp.route('/profile/email', methods=['POST'])
def update_email():
    username = require_auth()
    user = get_user(username)
    if not user:
        abort(404)

    data = request.get_json()
    if not data:
        return jsonify({"error": "Invalid input"}), 400

    new_email = data.get('new_email', '').strip()
    current_password = data.get('current_password', '')

    if not bcrypt.checkpw(current_password.encode('utf-8'), user['password_hash'].encode('utf-8')):
        return jsonify({"error": "Invalid current password"}), 401

    if not new_email or '@' not in new_email:
        return jsonify({"error": "Valid email required"}), 400

    if new_email == user['email']:
        return jsonify({"error": "New email must be different from current email"}), 400

    existing = get_user_by_email(new_email)
    if existing and existing['username'] != username:
        return jsonify({"error": "Email address already in use"}), 409

    set_pending_email(username, new_email)
    token = create_token(username, 'change_email', CHANGE_EMAIL_TTL_SECONDS, new_email=new_email)
    try:
        mailer.send_email_change_confirmation(new_email, username, token)
    except Exception as exc:
        print(f"send_email_change_confirmation failed for {username}: {exc}", file=sys.stderr)

    return jsonify({"pending_email": new_email}), 200


@main_bp.route('/score', methods=['POST'])
def submit_score():
    username = require_auth()

    data = request.get_json()
    if not data:
        return jsonify({"error": "Invalid input"}), 400

    level = data.get('level')
    score = data.get('score')
    difficulty = data.get('difficulty', '').strip()

    if not is_valid_int(level, 1, 60):
        return jsonify({"error": "Invalid input"}), 400
    if not is_valid_int(score, min_value=0):
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
    if not is_valid_int(score, min_value=0):
        return jsonify({"error": "Invalid input"}), 400

    user = get_user(username)
    first_grade_year = user['first_grade_year'] if user else None

    saved, record = put_high_score(username, score, first_grade_year)
    put_score_history(username, score)
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


@main_bp.route('/profile/score-history', methods=['GET'])
def score_history():
    username = require_auth()
    user = get_user(username)
    if not user:
        abort(404)

    history = get_score_history(username)
    return jsonify({"history": history}), 200
