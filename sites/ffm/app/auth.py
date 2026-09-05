from flask import Blueprint, request, jsonify, make_response, current_app
import bcrypt
import jwt
import datetime
import sys
from .extensions import limiter
from .models import (
    create_user, get_user, get_user_by_email,
    set_email_verified, set_password_hash,
    create_token, consume_token,
    confirm_email_change,
    MIN_FIRST_GRADE_YEAR, MAX_FIRST_GRADE_YEAR,
    VERIFY_EMAIL_TTL_SECONDS, RESET_PASSWORD_TTL_SECONDS, CHANGE_EMAIL_TTL_SECONDS,
)
from .validation import is_valid_int
from . import mailer
from .captcha import verify_turnstile_token

auth_bp = Blueprint('auth', __name__, url_prefix='/api/auth')


def _email_rate_limit_key():
    """Rate-limit key for resend-verification/forgot-password: the *target*
    email address from the request body, not the caller's IP. This bounds
    how many emails one specific address can be sent regardless of how many
    different source IPs an attacker uses — AUTH_RATE_LIMIT alone only
    bounds requests per IP, which doesn't stop a patient or IP-rotating
    attacker from mail-bombing one victim's inbox via our domain."""
    data = request.get_json(silent=True) or {}
    email = str(data.get('email', '')).strip().lower()
    return email or 'no-email'


def _check_captcha(data):
    """Verify the request's Turnstile token. Always True (no-op) when
    TURNSTILE_ENABLED is False (e.g. TestingConfig), so the existing test
    suite doesn't need a real/mocked token for every call. Applied to the
    anonymous, mail-triggering endpoints (register/forgot-password/
    resend-verification) to raise the cost of automated abuse."""
    if not current_app.config['TURNSTILE_ENABLED']:
        return True
    token = data.get('turnstile_token', '')
    return verify_turnstile_token(token, request.remote_addr)


@auth_bp.route('/register', methods=['POST'])
@limiter.limit(lambda: current_app.config['AUTH_RATE_LIMIT'])
def register():
    data = request.get_json()
    if not data:
        return jsonify({"error": "Invalid request"}), 400

    if not _check_captcha(data):
        return jsonify({"error": "captcha_verification_failed"}), 400

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
        if not is_valid_int(first_grade_year, MIN_FIRST_GRADE_YEAR, MAX_FIRST_GRADE_YEAR):
            return jsonify({"error": f"first_grade_year must be between {MIN_FIRST_GRADE_YEAR} and {MAX_FIRST_GRADE_YEAR}"}), 400

    password_hash = bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt(rounds=12)).decode('utf-8')

    try:
        user = create_user(username, email, password_hash, first_grade_year)
    except ValueError:
        return jsonify({"error": "Username or email already taken"}), 409

    token = create_token(user['username'], 'verify_email', VERIFY_EMAIL_TTL_SECONDS)
    try:
        mailer.send_verification_email(user['email'], user['username'], token)
    except Exception as exc:  # SES failures must not fail registration; the account is already created
        print(f"send_verification_email failed for {user['username']}: {exc}", file=sys.stderr)

    return jsonify({
        "message": "Check your email to verify your account.",
        "user": {"username": user['username']},
    }), 201


@auth_bp.route('/login', methods=['POST'])
@limiter.limit(lambda: current_app.config['AUTH_RATE_LIMIT'])
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

    if not user['email_verified']:
        return jsonify({"error": "email_not_verified"}), 403

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


@auth_bp.route('/resend-verification', methods=['POST'])
@limiter.limit(lambda: current_app.config['AUTH_RATE_LIMIT'])
@limiter.limit(lambda: current_app.config['EMAIL_TARGET_RATE_LIMIT'], key_func=_email_rate_limit_key)
def resend_verification():
    data = request.get_json()
    if not data:
        return jsonify({"error": "Invalid request"}), 400

    if not _check_captcha(data):
        return jsonify({"error": "captcha_verification_failed"}), 400

    email = data.get('email', '').strip()
    generic_response = jsonify({
        "message": "If that account exists and is unverified, a verification email has been sent."
    })

    if not email:
        return generic_response, 200

    user = get_user_by_email(email)
    if user and not user['email_verified']:
        token = create_token(user['username'], 'verify_email', VERIFY_EMAIL_TTL_SECONDS)
        try:
            mailer.send_verification_email(user['email'], user['username'], token)
        except Exception as exc:
            print(f"send_verification_email failed for {user['username']}: {exc}", file=sys.stderr)

    return generic_response, 200


@auth_bp.route('/verify-email', methods=['POST'])
def verify_email():
    data = request.get_json()
    if not data:
        return jsonify({"error": "Invalid request"}), 400

    token = data.get('token', '')
    result = consume_token(token, 'verify_email')
    if not result:
        return jsonify({"error": "invalid_or_expired_token"}), 400

    set_email_verified(result['username'], True)
    return jsonify({"ok": True}), 200


@auth_bp.route('/forgot-password', methods=['POST'])
@limiter.limit(lambda: current_app.config['AUTH_RATE_LIMIT'])
@limiter.limit(lambda: current_app.config['EMAIL_TARGET_RATE_LIMIT'], key_func=_email_rate_limit_key)
def forgot_password():
    data = request.get_json()
    if not data:
        return jsonify({"error": "Invalid request"}), 400

    if not _check_captcha(data):
        return jsonify({"error": "captcha_verification_failed"}), 400

    email = data.get('email', '').strip()
    generic_response = jsonify({
        "message": "If that account exists, a password reset email has been sent."
    })

    if not email:
        return generic_response, 200

    user = get_user_by_email(email)
    if user:
        token = create_token(user['username'], 'reset_password', RESET_PASSWORD_TTL_SECONDS)
        try:
            mailer.send_password_reset_email(user['email'], user['username'], token)
        except Exception as exc:
            print(f"send_password_reset_email failed for {user['username']}: {exc}", file=sys.stderr)

    return generic_response, 200


@auth_bp.route('/reset-password', methods=['POST'])
def reset_password():
    data = request.get_json()
    if not data:
        return jsonify({"error": "Invalid request"}), 400

    token = data.get('token', '')
    new_password = data.get('new_password', '')

    if not new_password or len(new_password) < 8 or len(new_password) > 128:
        return jsonify({"error": "Password must be 8-128 characters"}), 400

    result = consume_token(token, 'reset_password')
    if not result:
        return jsonify({"error": "invalid_or_expired_token"}), 400

    password_hash = bcrypt.hashpw(new_password.encode('utf-8'), bcrypt.gensalt(rounds=12)).decode('utf-8')
    set_password_hash(result['username'], password_hash)

    return jsonify({"ok": True}), 200


@auth_bp.route('/confirm-email-change', methods=['POST'])
def confirm_email_change_route():
    data = request.get_json()
    if not data:
        return jsonify({"error": "Invalid request"}), 400

    token = data.get('token', '')
    result = consume_token(token, 'change_email')
    if not result or not result.get('new_email'):
        return jsonify({"error": "invalid_or_expired_token"}), 400

    try:
        confirm_email_change(result['username'], result['new_email'])
    except ValueError:
        return jsonify({"error": "Email address already in use"}), 409

    return jsonify({"ok": True}), 200


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
