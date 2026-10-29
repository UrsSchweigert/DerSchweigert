# Backend Service

## Purpose

Provide API endpoints for the web application. Step 1 implements service health and configuration baseline.

## Technology

- FastAPI
- Uvicorn
- Pydantic Settings
- SQLAlchemy
- Alembic
- Pytest

## Directory layout

- `app/main.py`: FastAPI application entrypoint
- `app/api/routes/health.py`: Health endpoint router
- `app/api/routes/widgets.py`: Database-backed sample resource router
- `app/core/config.py`: Runtime configuration model
- `app/db/`: Database engine/session setup
- `app/models/`: ORM entities
- `alembic/`: Migration environment and revision history
- `tests/`: Backend tests

## Local usage

1. Install dependencies:
   - `python -m pip install -r requirements-dev.txt`
2. Apply migrations:
   - `alembic upgrade head`
3. Start server:
   - `uvicorn app.main:app --reload --host 0.0.0.0 --port 8000`
4. Verify:
   - `curl http://localhost:8000/health`
   - `curl http://localhost:8000/api/v1/widgets`

## Testing

- Run: `pytest -q`
