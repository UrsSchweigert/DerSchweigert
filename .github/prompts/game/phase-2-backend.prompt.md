---
description: >
  Phase 2 LEAD — Flask REST API for the ffm math game.
  You are the LEAD agent. Decompose into worker tasks, spawn Haiku workers, review security
  and logic yourself, run pytest. You personally own the security checklist — never delegate
  security review to a worker.
tools:
  - read_file
  - list_dir
  - grep_search
  - run_in_terminal
  - get_errors
  - replace_string_in_file
  - runSubagent
---

# Phase 2 Lead — Backend REST API

## Your responsibilities

1. Read `sites/derschweigert/app/__init__.py`, `config.py`, `lambda/handler.py` to
   understand the existing factory pattern before issuing any worker briefs.
2. Read `ffm-math-game.prompt.md` backend and security sections in full.
3. Dispatch the worker tasks below in order (each worker depends on the previous).
4. After each worker: read every file it produced. Run `get_errors` on Python files.
   Review security criteria personally — never trust a worker on security.
5. Run `pytest sites/ffm/tests/test_app.py -q --tb=short` — must exit 0.
6. Report `SUCCESS` or `FAILED:<reason>`.

---

## Worker task decomposition

### Worker 1 — Data models
**File:** `sites/ffm/app/models.py`

Micro-brief must specify exact SQLAlchemy column definitions, constraints, types, and
the UniqueConstraint on `(user_id, level, difficulty)` in `LevelScore`.

### Worker 2 — App factory + config
**Files:** `sites/ffm/app/__init__.py`, `sites/ffm/app/config.py`

Micro-brief must specify: Flask factory pattern, blueprint registration (auth + api),
CORS config (`https://ffm.derschweigert.de` + `http://localhost:*` in dev),
Flask-Limiter init, SQLAlchemy init. Config classes: BaseConfig (SQLite),
ProductionConfig (env var `DATABASE_URL`), `SECRET_KEY` from env with no fallback.

### Worker 3 — Auth blueprint (register + login)
**File:** `sites/ffm/app/auth.py` (register and login routes only)

Micro-brief must specify: exact route paths `/api/auth/register` and `/api/auth/login`,
bcrypt cost factor **12** (not 10), JWT structure `{sub: user_id, exp: now+15min}`,
validation rules (username 3–20 alphanumeric, password 8–128, email contains @),
identical 401 error message for wrong user vs wrong password.

### Worker 4 — Auth blueprint (refresh + logout)
**File:** `sites/ffm/app/auth.py` (append refresh and logout routes)

Micro-brief must specify: `/api/auth/refresh` reads httpOnly cookie named `refresh_token`,
verifies JWT signature and expiry, rotates cookie (new JWT + reset expiry),
returns new access token. `/api/auth/logout` clears cookie
(set `max_age=0, expires=0`). Cookie flags: `httponly=True, secure=True, samesite='Strict'`.

### Worker 5 — API blueprint (score + profile + leaderboard + health)
**File:** `sites/ffm/app/main.py`

Micro-brief must specify: all four routes with exact request/response schemas from
the spec. Score upsert logic: only update if new score strictly greater than existing.
Health endpoint is public (no auth decorator). Leaderboard returns top 10 ordered by
score desc for the given level.

### Worker 6 — Lambda handler + requirements
**Files:** `sites/ffm/lambda/handler.py`, `sites/ffm/requirements.txt`

Micro-brief must specify: Mangum wrapper identical in pattern to derschweigert's handler
but importing from the ffm app factory. requirements.txt must list exact packages from spec.

### Worker 7 — Test suite
**File:** `sites/ffm/tests/test_app.py`

Micro-brief must specify: `pytest` with in-memory SQLite fixture, all test cases from
the spec listed verbatim. Tests must not import from derschweigert.

---

## Security checklist (lead verifies personally after Worker 4 and Worker 5)

- [ ] `bcrypt.hashpw` cost = 12
- [ ] `SECRET_KEY` loaded with `os.environ['SECRET_KEY']` — no default value
- [ ] Login 401 message identical for wrong user and wrong password
- [ ] Rate limit decorators present on `/api/auth/login` and `/api/auth/register`
- [ ] Refresh cookie: `httponly=True`, `secure=True`, `samesite='Strict'`
- [ ] `/api/score` validates `1 <= level <= 40` and `score >= 0`
- [ ] No SQL string formatting (use SQLAlchemy ORM only, no raw SQL)


- `sites/derschweigert/app/__init__.py` — Flask factory pattern to mirror
- `sites/derschweigert/app/config.py` — config pattern (BASE_DIR, env vars)
- `sites/derschweigert/lambda/handler.py` — Lambda adapter pattern to mirror
- `ffm-math-game.prompt.md` sections: "Backend REST API", "Security requirements"

## Goal

Implement a **JSON-only Flask REST API** in `sites/ffm/`. No Jinja2 templates. No HTML routes.
Every response body is `application/json`.

## Files to create

### `sites/ffm/app/__init__.py`
Flask app factory. Register blueprints (`auth`, `api`). Configure CORS to allow
`https://ffm.derschweigert.de` (+ `http://localhost:*` when `FLASK_ENV=development`).
Rate limiting via `Flask-Limiter` on auth routes (10/minute per IP).

### `sites/ffm/app/config.py`
```python
# Dev: SQLite at BASE_DIR/ffm.db
# Prod: SQLALCHEMY_DATABASE_URI from env (DynamoDB via custom adapter or switch to SQLite on /tmp)
# SECRET_KEY: from env, no fallback in prod
# JWT_ACCESS_EXPIRES: 15 minutes
# JWT_REFRESH_EXPIRES: 30 days
```

### `sites/ffm/app/models.py`
SQLAlchemy models:
```python
class User:
    id: int (PK, autoincrement)
    username: str (unique, not null, 3–20 chars)
    email: str (unique, not null)
    password_hash: str
    created_at: datetime

class LevelScore:
    id: int (PK, autoincrement)
    user_id: int (FK → users.id, not null)
    level: int (not null, check 1 ≤ level ≤ 40)
    score: int (not null, check score ≥ 0)
    difficulty: str (not null, enum: easy|medium|hard)
    achieved_at: datetime
    # UniqueConstraint('user_id', 'level', 'difficulty') — upsert keeps personal best
```

### `sites/ffm/app/auth.py`
Blueprint prefix `/api/auth`. Endpoints:

**POST `/api/auth/register`**
- Body: `{username, email, password}`
- Validate: username 3–20 alphanumeric, email contains `@`, password 8–128 chars
- Hash password with `bcrypt` cost factor 12
- Return: `{access_token, user: {id, username}}`

**POST `/api/auth/login`**
- Body: `{username, password}`
- Verify bcrypt hash; 401 on mismatch (same message for wrong user/wrong password)
- Return: `{access_token, user: {id, username}}`
- Set httpOnly, Secure, SameSite=Strict refresh token cookie (30-day expiry)

**POST `/api/auth/refresh`**
- Read refresh token from cookie, verify signature and expiry
- Issue new access JWT, rotate refresh cookie
- Return: `{access_token}`

**POST `/api/auth/logout`**
- Clear refresh cookie (set empty, expired)
- Return: `{ok: true}`

### `sites/ffm/app/main.py`
Blueprint prefix `/api`. All routes require valid Bearer access JWT in `Authorization` header.

**GET `/api/profile`**
- Return: `{user: {id, username}, scores: [{level, score, difficulty, achieved_at}]}`

**POST `/api/score`**
- Body: `{level: int, score: int, difficulty: "easy"|"medium"|"hard"}`
- Validate ranges. Upsert: if existing record for (user_id, level, difficulty) exists and
  new score > existing score, update. Otherwise ignore (personal best only).
- Return: `{saved: true|false, personal_best: int}`

**GET `/api/leaderboard`**
- Query param `?level=N` (optional; if omitted return top scores across all levels)
- Return top 10 scores for the requested level, ordered by score desc
- Response: `{level: N, entries: [{rank, username, score, difficulty, achieved_at}]}`

**GET `/api/health`**
- Public (no auth). Return `{"ok": true}`.

### `sites/ffm/lambda/handler.py`
Mangum wrapper — mirror `sites/derschweigert/lambda/handler.py` exactly but import from
`sites.ffm.app` instead.

### `sites/ffm/requirements.txt`
```
flask>=3.0
flask-sqlalchemy>=3.1
flask-limiter>=3.5
flask-cors>=4.0
bcrypt>=4.1
pyjwt>=2.8
mangum>=0.17
```

### `sites/ffm/tests/test_app.py`
Use `pytest` with a `test_client` fixture (in-memory SQLite). Cover:
- Register → 201, duplicate username → 409
- Login correct → 200 + access token, wrong password → 401
- Refresh with valid cookie → 200
- POST `/api/score` without auth → 401
- POST `/api/score` valid → 200, personal best upsert logic
- GET `/api/leaderboard?level=1` → 200 with entries list
- GET `/api/health` → 200 `{"ok": true}`

## Security checklist (verify before marking done)

- [ ] bcrypt cost = 12 (not 10)
- [ ] JWT secret loaded from env, never hardcoded
- [ ] Auth error messages do NOT distinguish "wrong user" from "wrong password"
- [ ] Rate limit decorators on `/api/auth/login` and `/api/auth/register`
- [ ] Refresh cookie flags: `httponly=True, secure=True, samesite='Strict'`
- [ ] Input length caps enforced (username 20, password 128, email 320)

## Done when

`pytest sites/ffm/tests/test_app.py -q` exits 0 with all tests passing.
