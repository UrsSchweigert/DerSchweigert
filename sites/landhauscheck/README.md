# Landhauscheck

**[landhauscheck.com](https://landhauscheck.com)** — a personal, location-aware web dashboard. Enter or detect your location and get live widgets for weather, traffic, public transport, fuel prices, EV chargers, nearby POIs, and garbage collection.

Languages: **DE / EN / PT** (auto-detected, user-switchable).  
Units: metric by default, imperial for US locations (auto-detected by country code).

---

## What it does

| Widget | Data source |
|--------|-------------|
| Clock + 5-hour weather + moon phase | Open-Meteo (free) |
| Traffic map + ⛽ fuel / ⚡ chargers / 🚻 restrooms / 🏧 ATMs | Google Maps + Tankerkönig (DE fuel prices) |
| Bus departures | HERE Transit |
| Train departures | DB Timetables snapshot + Google Places fallback |
| Points of interest | Google Places |
| Garbage collection calendar | Community-contributed ICS files |

---

## Architecture

```
Browser
  └── CloudFront
        ├── /api/*  →  API Gateway  →  Lambda (FastAPI via Mangum, ARM64)
        └── /*      →  S3 (static React/Vite SPA)
```

No ALB, no ECS, no RDS, no VPC. Cost: ~$1–3/month.  
Region: `eu-west-1`. Infra managed with OpenTofu (`infra/terraform/sites/landhauscheck/`).

The Lambda is deployed as a **zip** (Python 3.12, arm64), built by
`scripts/deploy.sh` and uploaded to `s3://<site-bucket>/deployments/`. Terraform
does not manage the deployed code object (`ignore_changes = [s3_key]`), so an
infrastructure-only apply never reverts a running function.

A parallel **dev environment** (`dev.landhauscheck.com`) mirrors prod using `infra/terraform/sites/landhauscheck-dev/`.

This site lives inside the `DerSchweigert` monorepo; its state is stored in the
shared S3 backend under `landhauscheck/{prod,dev}/terraform.tfstate`.

Full system documentation: [`docs/SYSTEM.md`](docs/SYSTEM.md)

---

## Repository layout

Everything below is relative to `sites/landhauscheck/`:

```
app/                FastAPI service, routes, tests (pytest + respx)
frontend/           React 19 + Vite SPA
tests/              Backend unit tests (pytest); tests/smoke needs a live URL
e2e/                Playwright end-to-end tests
docs/               SYSTEM.md (authoritative reference), adr/, architecture/
docker/             Dockerfiles + Compose for local development
scripts/            deploy.sh — one-script deploy for local Docker and AWS
alembic/            Local-dev database migrations (prod has no database)
```

Terraform stacks live outside the site directory, next to every other site:
`infra/terraform/sites/landhauscheck/` (prod) and
`infra/terraform/sites/landhauscheck-dev/` (dev).

---

## Local development

### Prerequisites

- Docker Desktop
- Node 20+
- Python 3.12+
- AWS CLI + credentials (for AWS deploys only)

### Start the local stack

```bash
make local-launch   # builds and starts frontend + backend via Docker Compose
make local-stop     # tears it down
```

The backend runs at `http://localhost:8000` and the frontend at `http://localhost:5173` with hot reload.

### Run without Docker

```bash
# Backend (from the repository root)
cd sites/landhauscheck
pip install -r requirements.txt -r requirements-dev.txt
DEV_CACHE_MODE=on uvicorn app.main:app --reload

# Frontend (new terminal)
cd sites/landhauscheck/frontend
npm install
npm run dev
```

The backend uses fixture caching (`DEV_CACHE_MODE=on`) to replay recorded API responses — no real API keys needed for development.

---

## Deployment

All deployments go through `scripts/deploy.sh`.

```bash
# Deploy frontend to dev
bash scripts/deploy.sh aws --env dev --frontend-only

# Deploy everything to prod (requires confirmation)
DEPLOY_CONFIRMED=yes bash scripts/deploy.sh aws

# Deploy frontend only to prod
DEPLOY_CONFIRMED=yes bash scripts/deploy.sh aws --frontend-only
```

The script builds the Lambda zip (manylinux aarch64 wheels), uploads it, updates
the function code, builds the React bundle, syncs it to S3, and invalidates
CloudFront.

Pushing to `main` also deploys automatically: the monorepo's
`.github/workflows/deploy.yml` runs this site's tests and then applies the same
deploy path in `deploy-lhc`. The manual commands above remain for local/hotfix use.

---

## Tests

```bash
# Backend (from sites/landhauscheck/)
pytest

# Frontend build check
cd sites/landhauscheck/frontend && npm run build

# End-to-end (from sites/landhauscheck/e2e/)
npx playwright test
```

CI runs on every push via GitHub Actions in the monorepo's root
`.github/workflows/deploy.yml`: Ruff lint, backend pytest, frontend Vitest, and
a Vite build (`test-lhc`), followed by deploy on `main` (`deploy-lhc`).
The monthly station refresh and the waste-calendar PR review run from
`.github/workflows/refresh-stations.yml` and `waste-calendar-review.yml`.

---

## CI status

[![Deploy to production](https://github.com/UrsSchweigert/DerSchweigert/actions/workflows/deploy.yml/badge.svg)](https://github.com/UrsSchweigert/DerSchweigert/actions/workflows/deploy.yml)
