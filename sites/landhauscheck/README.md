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
`.github/workflows/deploy.yml` runs this site's tests (`test-lhc`) and then the
same deploy path (`deploy-lhc`). The manual commands above remain for
local/hotfix use.

### Secrets required for CI deploys

The workflow runs on the `UrsSchweigert/DerSchweigert` repository, so these must
be set there (repository settings → Secrets and variables → Actions). Secret
values do not move with code.

Required (`tofu apply` fails without them, and the job says which are missing):

- `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`
- `TF_VAR_HERE_API_KEY`, `TF_VAR_HERE_BROWSER_API_KEY`
- `TF_VAR_GOOGLE_MAPS_API_KEY`, `TF_VAR_GOOGLE_MAPS_BROWSER_API_KEY`
- `TF_VAR_DB_STADA_CLIENT_ID`, `TF_VAR_DB_STADA_API_KEY`

Optional — used if present; the backing feature degrades gracefully otherwise:

- `TF_VAR_TANKERKOENIG_API_KEY` (fuel prices), `JIRA_API_KEY` (feature requests),
  `GH_WASTE_PAT` (waste-calendar contributions and auto-merge; needs `repo` and
  `pull-requests: write`)

Also needed by the monthly station-refresh workflow: `DB_STADA_CLIENT_ID` and
`DB_STADA_API_KEY`.

The Lambda itself reads its API keys from SSM Parameter Store
(`/basicwebapp/*`, `/basicwebapp-dev/*`), so runtime keys are independent of
these build-time secrets.

`gh` can never read an existing secret's value, so each must be pasted once. If
your local `infra/terraform/sites/landhauscheck/terraform.tfvars` still holds the
values, this sets the six required ones from it:

```bash
cd infra/terraform/sites/landhauscheck
for pair in HERE_API_KEY:here_api_key \
            HERE_BROWSER_API_KEY:here_browser_api_key \
            GOOGLE_MAPS_API_KEY:google_maps_api_key \
            GOOGLE_MAPS_BROWSER_API_KEY:google_maps_browser_api_key \
            DB_STADA_CLIENT_ID:db_stada_client_id \
            DB_STADA_API_KEY:db_stada_api_key; do
  secret="TF_VAR_${pair%%:*}"; key="${pair##*:}"
  value="$(sed -n "s/^${key}[[:space:]]*=[[:space:]]*\"\(.*\)\"/\1/p" terraform.tfvars)"
  if [ -n "$value" ]; then
    gh secret set "$secret" --repo UrsSchweigert/DerSchweigert --body "$value" && echo "set $secret"
  fi
done
```

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

[![Sites: deploy to production](https://github.com/UrsSchweigert/DerSchweigert/actions/workflows/deploy.yml/badge.svg)](https://github.com/UrsSchweigert/DerSchweigert/actions/workflows/deploy.yml)
