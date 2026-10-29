# Local Development Guide

## Goal

Provide a reproducible local workflow that is close to the future AWS runtime model without adding unnecessary complexity in Step 1.

## Principles

1. Keep services stateless where possible.
2. Keep runtime configuration externalized via environment variables.
3. Prefer explicit interfaces between components.
4. Use health endpoints to simplify orchestration and monitoring.

## Services in Step 2

- `frontend`: React app served by Vite (`http://localhost:5173`)
- `backend`: FastAPI app served by Uvicorn (`http://localhost:8000`)
- `postgres`: PostgreSQL service (`localhost:55432` by default)

## Runtime flow

Browser -> Frontend -> Backend API -> PostgreSQL

## Environment setup

1. Copy `.env.example` to `.env`.
2. Adjust values if required for your machine.

## One-command startup

- Start everything: `make local-launch`
- Stop everything: `make local-stop`

When the stack is running:

- Frontend updates auto-refresh in the browser (Vite HMR).
- Backend Python code updates auto-reload the API process (Uvicorn `--reload`).
- You do not need to run `make local-launch` again for normal code edits.

Restart is only needed when:

- You change backend or frontend dependency lists.
- You change Dockerfiles or Compose service definitions.
- You need to rebuild images for system-level package changes.

## Running with host tooling

- Backend install: `make backend-install`
- Database migration: `make backend-db-upgrade`
- Backend run: `make backend-run`
- Frontend install: `make frontend-install`
- Frontend run: `make frontend-run`

## Running with Docker

- Start: `make docker-up`
- Stop: `make docker-down`

If your machine does not provide `docker-compose` but has Docker installed,
use `docker compose` with the same compose file path as a fallback.

## Verification checklist

1. `GET /health` returns HTTP 200 and JSON status payload.
2. `GET /api/v1/widgets` returns HTTP 200 and a JSON list.
3. Frontend page loads and displays backend status.
4. Unit tests pass for backend API.

## Migration note

This layout intentionally separates app code and infrastructure code so later AWS IaC can be added under `infra/` without refactoring application directories.
