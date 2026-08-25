from flask import Blueprint, request, jsonify, make_response, current_app
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
import bcrypt
import jwt
import datetime
from .models import (
    create_user, get_user,
    MIN_FIRST_GRADE_YEAR, MAX_FIRST_GRADE_YEAR,
)

auth_bp = Blueprint('auth', __name__, url_prefix='/api/auth')
limiter = Limiter(get_remote_address, storage_uri="memory://")


@auth_bp.route('/register', methods=['POST'])
@limiter.limit("10/minute")
def register():
    data = request.get_json()
    if not data:
        return jsonify({"error": "Invalid request"}), 400

    username = data.get('username', '').strip()
    email = data.get('email', '').strip()
    password = data.get('password', '')
    first_grade_year = data.get('first_grade_year')

    if not username or len(username) < 3 or len(username) > 20 or not username.isalnum():
        return jsonify({"error": "Username must be 3-20 alphanumeric characters"}), 400
    if not email or '@' not in email:
        return jsonify({"error": "Valid email required"}), 400
    if not password or len(password) < 8 or len(password) > 128:
        return jsonify({"error": "Password must be 8-128 characters"}), 400
    if first_grade_year is not None:
        if type(first_grade_year) is not int or not (MIN_FIRST_GRADE_YEAR <= first_grade_year <= MAX_FIRST_GRADE_YEAR):
            return jsonify({"error": f"first_grade_year must be between {MIN_FIRST_GRADE_YEAR} and {MAX_FIRST_GRADE_YEAR}"}), 400

    password_hash = bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt(rounds=12)).decode('utf-8')

    try:
        user = create_user(username, email, password_hash, first_grade_year)
    except ValueError:
        return jsonify({"error": "Username or email already taken"}), 409

    payload = {
        "sub": user['username'],
        "username": user['username'],
        "exp": datetime.datetime.utcnow() + datetime.timedelta(seconds=current_app.config['JWT_ACCESS_EXPIRES']),
    }
    token = jwt.encode(payload, current_app.config['SECRET_KEY'], algorithm='HS256')

    return jsonify({"access_token": token, "user": {"username": user['username']}}), 201


@auth_bp.route('/login', methods=['POST'])
@limiter.limit("10/minute")
def login():
    data = request.get_json()
    if not data:
        return jsonify({"error": "Invalid request"}), 400

    username = data.get('username', '').strip()
    password = data.get('password', '')

    if not username or not password:
        return jsonify({"error": "Invalid credentials"}), 401

    user = get_user(username)

    if not user or not bcrypt.checkpw(password.encode('utf-8'), user['password_hash'].encode('utf-8')):
        return jsonify({"error": "Invalid credentials"}), 401

    access_payload = {
        "sub": user['username'],
        "username": user['username'],
        "exp": datetime.datetime.utcnow() + datetime.timedelta(seconds=current_app.config['JWT_ACCESS_EXPIRES']),
    }
    access_token = jwt.encode(access_payload, current_app.config['SECRET_KEY'], algorithm='HS256')

    refresh_payload = {
        "sub": user['username'],
        "username": user['username'],
        "exp": datetime.datetime.utcnow() + datetime.timedelta(seconds=current_app.config['JWT_REFRESH_EXPIRES']),
    }
    refresh_token = jwt.encode(refresh_payload, current_app.config['SECRET_KEY'], algorithm='HS256')

    response = make_response(jsonify({"access_token": access_token, "user": {"username": user['username']}}), 200)
    response.set_cookie(
        "refresh_token", value=refresh_token,
        httponly=True, secure=True, samesite='Strict',
        max_age=current_app.config['JWT_REFRESH_EXPIRES'],
    )
    return response


@auth_bp.route('/refresh', methods=['POST'])
def refresh():
    refresh_token = request.cookies.get('refresh_token')
    if not refresh_token:
        return jsonify({"error": "No refresh token"}), 401

    try:
        payload = jwt.decode(refresh_token, current_app.config['SECRET_KEY'], algorithms=['HS256'])
        username = payload['sub']
    except (jwt.ExpiredSignatureError, jwt.InvalidTokenError):
        return jsonify({"error": "Refresh token expired or invalid"}), 401

    access_payload = {
        "sub": username, "username": username,
        "exp": datetime.datetime.utcnow() + datetime.timedelta(seconds=current_app.config['JWT_ACCESS_EXPIRES']),
    }
    new_access_token = jwt.encode(access_payload, current_app.config['SECRET_KEY'], algorithm='HS256')

    new_refresh_payload = {
        "sub": username, "username": username,
        "exp": datetime.datetime.utcnow() + datetime.timedelta(seconds=current_app.config['JWT_REFRESH_EXPIRES']),
    }
    new_refresh_token = jwt.encode(new_refresh_payload, current_app.config['SECRET_KEY'], algorithm='HS256')

    response = make_response(jsonify({"access_token": new_access_token}), 200)
    response.set_cookie(
        "refresh_token", value=new_refresh_token,
        httponly=True, secure=True, samesite='Strict',
        max_age=current_app.config['JWT_REFRESH_EXPIRES'],
    )
    return response


@auth_bp.route('/logout', methods=['POST'])
def logout():
    response = make_response(jsonify({"ok": True}), 200)
    response.set_cookie(
        "refresh_token", "",
        max_age=0, expires=0,
        httponly=True, secure=True, samesite='Strict',
    )
    return response
