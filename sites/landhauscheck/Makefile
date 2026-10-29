COMPOSE_CMD := $(shell if docker compose version >/dev/null 2>&1; then echo "docker compose"; elif command -v docker-compose >/dev/null 2>&1; then echo "docker-compose"; else echo ""; fi)

.PHONY: help local-launch local-stop backend-install backend-run backend-test backend-lint backend-audit backend-db-upgrade backend-db-revision frontend-install frontend-run frontend-audit docker-up docker-down process-waste refresh-stations tf-init tf-plan tf-apply tf-destroy deploy-backend deploy-frontend deploy deploy-aws deploy-aws-backend deploy-aws-frontend deploy-aws-infra preflight

help:
	@echo "Available targets:"
	@echo "  local-launch     One-command local startup (frontend, backend, postgres)"
	@echo "  local-stop       Stop local stack started by local-launch"
	@echo "  backend-install  Install backend dependencies"
	@echo "  backend-run      Run backend API locally"
	@echo "  backend-test     Run backend tests"
	@echo "  backend-lint     Run backend lint checks"
	@echo "  backend-audit    Run backend dependency audit"
	@echo "  backend-db-upgrade Apply Alembic migrations"
	@echo "  backend-db-revision Create a new Alembic migration"
	@echo "  frontend-install Install frontend dependencies"
	@echo "  frontend-run     Run frontend locally"
	@echo "  frontend-audit   Run frontend dependency audit"
	@echo "  process-waste    Process raw AWIDO ICS files from data/inbox/ into data/waste/"
	@echo "  refresh-stations Download fresh DB station snapshot from StaDa API"
	@echo "  docker-down      Stop local stack"
	@echo ""
	@echo "AWS deployment (via scripts/deploy.sh):"
	@echo "  deploy           Full AWS deploy: infra + Lambda zip + frontend"
	@echo "  deploy-aws       Alias for deploy"
	@echo "  deploy-aws-backend   Build/upload Lambda zip + update function code"
	@echo "  deploy-aws-frontend  Build React app + S3 sync + CloudFront invalidation"
	@echo "  deploy-aws-infra     tofu apply only (no code deploys)"
		@echo "  preflight            Check all prerequisites (aws, tofu, docker)"
	@echo ""
	@echo "OpenTofu targets (raw, for debugging):"
	@echo "  tf-init          tofu init    — download providers (run once)"
	@echo "  tf-plan          tofu plan    — preview changes"
	@echo "  tf-apply         tofu apply   — provision / update infrastructure"
	@echo "  tf-destroy       tofu destroy — tear everything down"

local-launch:
	@if [ -z "$(COMPOSE_CMD)" ]; then echo "No Docker Compose command found."; exit 1; fi
	@if [ ! -f .env ]; then cp .env.example .env; fi
	$(COMPOSE_CMD) -f docker/docker-compose.local.yml up --build -d
	@echo "Applying database migrations..."
	$(COMPOSE_CMD) -f docker/docker-compose.local.yml exec -T backend alembic upgrade head
	@echo "Waiting for backend to become healthy..."
	@until curl -fsS http://localhost:8000/health >/dev/null 2>&1; do sleep 1; done
	@echo "Waiting for frontend to become reachable..."
	@until curl -fsS http://localhost:5173 >/dev/null 2>&1; do sleep 1; done
	@echo "Local stack is ready"
	@echo "Frontend: http://localhost:5173"
	@echo "Backend:  http://localhost:8000/health"
	@echo "Widgets:  http://localhost:8000/api/v1/widgets"

local-stop:
	@if [ -z "$(COMPOSE_CMD)" ]; then echo "No Docker Compose command found."; exit 1; fi
	$(COMPOSE_CMD) -f docker/docker-compose.local.yml down

backend-install:
	python -m pip install -r requirements-dev.txt

backend-run:
	uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

backend-test:
	pytest -q

backend-lint:
	ruff check app tests alembic

backend-audit:
	pip-audit -r requirements.txt

backend-db-upgrade:
	alembic upgrade head

backend-db-revision:
	alembic revision --autogenerate -m "$(m)"

frontend-install:
	cd frontend && npm install

frontend-run:
	cd frontend && npm run dev

frontend-audit:
	cd frontend && npm audit

process-waste:
	python3.12 app/data/process_inbox.py

refresh-stations:
	@if [ ! -f .env ]; then echo "No .env file found. Copy .env.example and fill in credentials."; exit 1; fi
	export $$(grep -E "DB_STADA" .env | xargs) && python3 scripts/refresh_stations.py

docker-up:
	@if [ -z "$(COMPOSE_CMD)" ]; then echo "No Docker Compose command found."; exit 1; fi
	$(COMPOSE_CMD) -f docker/docker-compose.local.yml up --build

docker-down:
	@if [ -z "$(COMPOSE_CMD)" ]; then echo "No Docker Compose command found."; exit 1; fi
	$(COMPOSE_CMD) -f docker/docker-compose.local.yml down

# ── OpenTofu / AWS ───────────────────────────────────────────────────────────
# OpenTofu is the open-source Terraform fork (Linux Foundation) — drop-in replacement.
TF_DIR = ../../infra/terraform/sites/landhauscheck

tf-init:
	tofu -chdir=$(TF_DIR) init

tf-plan:
	tofu -chdir=$(TF_DIR) plan

tf-apply:
	tofu -chdir=$(TF_DIR) apply

tf-destroy:
	tofu -chdir=$(TF_DIR) destroy

# Push a new backend zip to Lambda (build → S3 artifact → update-function-code).
# Delegates to deploy.sh so the packaging rules (arm64 wheels, artifact key)
# live in exactly one place.
# Usage: make deploy-backend TAG=v1.2.3
TAG ?= latest
deploy-backend:
	./scripts/deploy.sh aws --backend-only --tag $(TAG)

# Build the React frontend and upload to S3, then bust the CloudFront cache.
# Delegates to deploy.sh for the same reason as deploy-backend.
deploy-frontend:
	./scripts/deploy.sh aws --frontend-only

# ── Unified deploy targets (delegate to scripts/deploy.sh) ───────────────────
# These targets are the recommended way to deploy — they handle all the edge cases
# learned from the first deployment (ARM64, region, ECS force-deploy, etc.).

DEPLOY_SCRIPT := ./scripts/deploy.sh

preflight:
	$(DEPLOY_SCRIPT) preflight

# Full AWS deploy: infra + backend image + frontend
deploy deploy-aws:
	$(DEPLOY_SCRIPT) aws $(if $(TAG),--tag $(TAG),)

# Push new backend image + restart ECS service
deploy-aws-backend:
	$(DEPLOY_SCRIPT) aws --backend-only $(if $(TAG),--tag $(TAG),)

# Build React app + sync to S3 + invalidate CloudFront
deploy-aws-frontend:
	$(DEPLOY_SCRIPT) aws --frontend-only

# Run tofu apply only (no code deploys)
deploy-aws-infra:
	$(DEPLOY_SCRIPT) aws --infra-only

