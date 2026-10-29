#!/usr/bin/env bash
# =============================================================================
# BasicWebApp — Unified Deployment Script
# =============================================================================
# Usage:
#   ./scripts/deploy.sh local               Start full local stack
#   ./scripts/deploy.sh local --stop        Stop local stack
#   ./scripts/deploy.sh aws                 Full AWS deploy (infra + backend + frontend)
#   ./scripts/deploy.sh aws --backend-only  Build/push Lambda image + update function code
#   ./scripts/deploy.sh aws --frontend-only Build/sync frontend to S3 + CloudFront
#   ./scripts/deploy.sh aws --infra-only    Run `tofu apply` only, no code deploys
#   ./scripts/deploy.sh preflight           Check all prerequisites without deploying
#
# Options:
#   --tag TAG         Docker image tag (default: short git SHA)
#   --region REGION   Override AWS region (default: read from terraform.tfvars)
#   --env ENV         Target environment: prod (default) or dev
#                     dev uses infra/terraform/sites/landhauscheck-dev/ and dev.landhauscheck.com
#
# Environment variables (alternative to terraform.tfvars flags):
#   TAG               Docker image tag
#   AWS_REGION        AWS region override
#
# =============================================================================
# KNOWN PITFALLS & LESSONS LEARNED (from first production deployment)
# =============================================================================
#
# 1. ARM64 ARCHITECTURE — Lambda runs on Graviton2 (ARM64).
#    The zip must contain aarch64 wheels, so dependencies are installed with
#    --platform manylinux2014_aarch64 (this script does it). lambda.tf must
#    contain: architectures = ["arm64"]
#
# 2. MIXED CONTENT — CloudFront serves the frontend over HTTPS.
#    Browsers block HTTP calls made from an HTTPS page (mixed content).
#    Fix: CloudFront proxies /api/* → API Gateway (HTTPS). backend_url in tofu
#         output is the CloudFront URL, not the raw API Gateway URL.
#
# 3. LAMBDA COLD START — First request after a period of inactivity takes ~500-900ms.
#    This is normal for a zip-packaged Python Lambda. Subsequent requests are fast.
#    Provisioned concurrency can eliminate cold starts ($) but is not needed here.
#
# 4. MANGUM PAYLOAD FORMAT — API Gateway HTTP API must use payload_format_version 2.0
#    in the integration. Mangum defaults to 2.0. Version 1.0 causes 500 errors.
#
# 5. SECRETS IN TFSTATE — Lambda env vars are populated from Secrets Manager at
#    tofu apply time and stored in local tfstate. Acceptable for a personal project
#    with local state. Do not commit tfstate to git (it is gitignored).
#
# 6. MISSING SECRET VERSION — If tofu apply fails after creating a Secrets Manager
#    secret container but before a value is stored, Lambda apply will fail.
#    Fix: Set the secret value in AWS Console or CLI, then re-run tofu apply.
#
# 7. REGION CONSISTENCY — All resources (S3, Lambda, CloudFront, SSM)
#    must be in the same region. Deployed region is eu-west-1 (Ireland).
#    Fix: Set aws_region = "eu-west-1" in terraform.tfvars.
#
# Current live environment (eu-west-1):
#   Frontend (custom domain):    https://landhauscheck.com
#   Frontend (CloudFront HTTPS): https://d1icuw9r7hb7kr.cloudfront.net
#   Lambda function:              basicwebapp-backend
#   API Gateway:                  (see tofu output api_gateway_invoke_url)
#   Lambda package:               zip uploaded to s3://basicwebapp-frontend-<account>/deployments/
#   S3 bucket:                    basicwebapp-frontend-113725432218
#   CloudFront distribution ID:   E1UNWNICC715F8
# =============================================================================

set -euo pipefail

# ── Colours ───────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
info()    { echo -e "${CYAN}[INFO]${NC}  $*"; }
success() { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error()   { echo -e "${RED}[ERROR]${NC} $*"; exit 1; }

# ── Paths ─────────────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SITE_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$SITE_ROOT/../.." && pwd)"
TF_DIR="$REPO_ROOT/infra/terraform/sites/landhauscheck"
COMPOSE_FILE="$SITE_ROOT/docker/docker-compose.local.yml"

# ── Defaults ──────────────────────────────────────────────────────────────────
MODE="${1:-help}"
TAG="${TAG:-$(git -C "$REPO_ROOT" rev-parse --short HEAD 2>/dev/null || echo "latest")}"
BACKEND_ONLY=false
FRONTEND_ONLY=false
INFRA_ONLY=false
STOP=false
REGION_OVERRIDE="${AWS_REGION:-}"
ENV="${DEPLOY_ENV:-prod}"

# ── Argument parsing ──────────────────────────────────────────────────────────
shift 1 || true
while [[ $# -gt 0 ]]; do
  case "$1" in
    --backend-only)  BACKEND_ONLY=true;  shift ;;
    --frontend-only) FRONTEND_ONLY=true; shift ;;
    --infra-only)    INFRA_ONLY=true;    shift ;;
    --stop)          STOP=true;          shift ;;
    --tag)           TAG="$2";           shift 2 ;;
    --region)        REGION_OVERRIDE="$2"; shift 2 ;;
    --env)           ENV="$2";           shift 2 ;;
    *) error "Unknown flag: $1. Run without args for usage." ;;
  esac
done

# Set TF_DIR based on environment
if [[ "$ENV" == "dev" ]]; then
  TF_DIR="$REPO_ROOT/infra/terraform/sites/landhauscheck-dev"
  info "Using dev environment (infra/terraform/sites/landhauscheck-dev/)"
fi

# =============================================================================
# HELPERS
# =============================================================================

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || error "Required command '$1' not found. Install it first."
}

require_file() {
  [[ -f "$1" ]] || error "Required file not found: $1"
}

# Read a value from terraform.tfvars (key = "value")
tfvar() {
  local key="$1"
  grep "^${key}" "$TF_DIR/terraform.tfvars" 2>/dev/null \
    | sed 's/.*= *"\(.*\)"/\1/' \
    | head -1
}

# Read tofu output
tf_output() {
  tofu -chdir="$TF_DIR" output -raw "$1" 2>/dev/null
}

get_region() {
  if [[ -n "$REGION_OVERRIDE" ]]; then
    echo "$REGION_OVERRIDE"
  elif [[ -n "${AWS_REGION:-}" ]]; then
    echo "$AWS_REGION"
  else
    local r
    r="$(tfvar aws_region)"
    [[ -n "$r" ]] || error "Cannot determine AWS region. Set aws_region in terraform.tfvars, AWS_REGION env var, or pass --region."
    echo "$r"
  fi
}

wait_for_url() {
  local url="$1" label="${2:-service}" retries=30
  info "Waiting for $label to respond at $url ..."
  for i in $(seq 1 $retries); do
    if curl -fsS "$url" >/dev/null 2>&1; then
      success "$label is healthy"
      return 0
    fi
    sleep 5
    [[ $((i % 6)) -eq 0 ]] && info "Still waiting... ($((i*5))s elapsed)"
  done
  warn "$label did not respond after $((retries*5))s — check logs"
}

# =============================================================================
# PREFLIGHT CHECKS
# =============================================================================

check_local_prereqs() {
  info "Checking local prerequisites..."
  require_cmd docker
  docker info >/dev/null 2>&1 || error "Docker daemon is not running."
  if docker compose version >/dev/null 2>&1; then
    COMPOSE_CMD="docker compose"
  elif command -v docker-compose >/dev/null 2>&1; then
    COMPOSE_CMD="docker-compose"
  else
    error "Neither 'docker compose' nor 'docker-compose' found."
  fi
  success "Local prerequisites satisfied"
}

check_aws_prereqs() {
  info "Checking AWS prerequisites..."
  require_cmd aws
  require_cmd tofu
  require_cmd docker
  docker info >/dev/null 2>&1 || error "Docker daemon is not running."

  # Verify AWS credentials work
  local identity
  if ! identity="$(aws sts get-caller-identity --query Account --output text 2>&1)"; then
    error "AWS credentials invalid or not configured. Run: aws configure"
  fi
  success "AWS authenticated (account: $identity)"

  # terraform.tfvars is optional in CI — TF_VAR_* env vars are used instead
  if [[ -z "${AWS_REGION:-}" ]] && [[ ! -f "$TF_DIR/terraform.tfvars" ]]; then
    error "Missing terraform.tfvars and AWS_REGION not set. Copy terraform.tfvars.example and fill in values."
  fi

  # Warn if tfstate might be out of date
  if [[ ! -f "$TF_DIR/.terraform/terraform.tfstate" ]] && [[ ! -d "$TF_DIR/.terraform" ]]; then
    warn "No .terraform directory found — you may need to run: tofu -chdir=$TF_DIR init"
  fi

  success "AWS prerequisites satisfied"
}

cmd_preflight() {
  check_local_prereqs
  check_aws_prereqs
  success "All preflight checks passed"
}

# =============================================================================
# LOCAL MODE
# =============================================================================

cmd_local_start() {
  check_local_prereqs
  cd "$SITE_ROOT"

  if [[ ! -f .env ]]; then
    if [[ -f .env.example ]]; then
      cp .env.example .env
      warn "Created .env from .env.example — review it before proceeding in production."
    else
      warn "No .env file found and no .env.example to copy from."
    fi
  fi

  info "Building and starting local stack..."
  $COMPOSE_CMD -f "$COMPOSE_FILE" up --build -d

  info "Applying database migrations..."
  $COMPOSE_CMD -f "$COMPOSE_FILE" exec -T backend alembic upgrade head

  wait_for_url "http://localhost:8000/health" "Backend"
  wait_for_url "http://localhost:5173" "Frontend"

  success "Local stack is ready"
  echo ""
  echo "  Frontend:  http://localhost:5173"
  echo "  Backend:   http://localhost:8000/health"
  echo "  API docs:  http://localhost:8000/docs"
}

cmd_local_stop() {
  check_local_prereqs
  info "Stopping local stack..."
  $COMPOSE_CMD -f "$COMPOSE_FILE" down
  success "Local stack stopped"
}

# =============================================================================
# RELEASES.JSON — generated at deploy time from GitHub API
# =============================================================================

# Writes releases.json to sites/landhauscheck/frontend/public/ so Vite bundles it into dist/
# and so it can be uploaded to S3 independently on backend-only deploys.
#
# Token resolution order (first non-empty wins):
#   1. GH_TOKEN env var
#   2. gh CLI keychain  (gh auth token)
#   3. git credential helper (osxkeychain / wincred / etc.)
#   4. github_token entry in terraform.tfvars (gitignored — safe fallback)
generate_releases_json() {
  info "Generating releases.json from GitHub releases..."
  local gh_token=""

  if [[ -n "${GH_TOKEN:-}" ]]; then
    gh_token="$GH_TOKEN"
    info "Using GH_TOKEN env var for GitHub auth"
  elif command -v gh &>/dev/null && gh auth token &>/dev/null 2>&1; then
    gh_token="$(gh auth token 2>/dev/null)"
    info "Using gh CLI token for GitHub auth"
  else
    # git credential fill returns key=value pairs; extract the password line
    gh_token="$(printf "host=github.com\nprotocol=https\n" | git credential fill 2>/dev/null | grep '^password=' | cut -d= -f2 || true)"
    [[ -n "$gh_token" ]] && info "Using git credential helper for GitHub auth"
  fi

  # Final fallback: github_token stored in terraform.tfvars (gitignored)
  if [[ -z "$gh_token" ]]; then
    local tfvars="$TF_DIR/terraform.tfvars"
    if [[ -f "$tfvars" ]]; then
      gh_token="$(grep '^github_token' "$tfvars" 2>/dev/null | sed 's/.*= *"\(.*\)"/\1/' | head -1 || true)"
      [[ -n "$gh_token" ]] && info "Using github_token from terraform.tfvars for GitHub auth"
    fi
  fi

  if [[ -n "$gh_token" ]]; then
    curl -sf \
      -H "Authorization: Bearer $gh_token" \
      -H "Accept: application/vnd.github+json" \
      "https://api.github.com/repos/UrsSchweigert/BasicWebApp/releases?per_page=20" \
      > "$SITE_ROOT/frontend/public/releases.json" 2>/dev/null && \
      success "releases.json generated ($(wc -c < "$SITE_ROOT/frontend/public/releases.json" | tr -d ' ') bytes)" || {
        echo '[]' > "$SITE_ROOT/frontend/public/releases.json"
        warn "GitHub API call failed — releases.json will be empty. Check token scopes."
      }
  else
    echo '[]' > "$SITE_ROOT/frontend/public/releases.json"
    warn "No GitHub token found — releases.json empty."
    warn "Fix: set GH_TOKEN, run 'gh auth login', configure git credential helper,"
    warn "     or add github_token = \"...\" to $TF_DIR/terraform.tfvars (gitignored)."
  fi
}

# Uploads releases.json from public/ directly to S3 + invalidates CF.
# Called on backend-only prod deploys so release-notes.html stays current
# even when a full frontend rebuild is not performed.
push_releases_json_to_s3() {
  local region s3_bucket cf_dist_id
  region="$(get_region)"

  s3_bucket="$(tf_output s3_bucket_name 2>/dev/null)" || {
    warn "Cannot read s3_bucket_name from tofu state — skipping releases.json S3 upload."
    return 0
  }
  cf_dist_id="$(tf_output cloudfront_distribution_id 2>/dev/null)" || cf_dist_id=""

  generate_releases_json

  aws s3 cp "$SITE_ROOT/frontend/public/releases.json" \
    "s3://${s3_bucket}/releases.json" \
    --cache-control "no-cache, no-store, must-revalidate" \
    --content-type "application/json" \
    --region "$region" \
    && success "releases.json uploaded to s3://${s3_bucket}"

  if [[ -n "$cf_dist_id" ]]; then
    aws cloudfront create-invalidation \
      --distribution-id "$cf_dist_id" \
      --paths "/releases.json" "/release-notes.html" \
      --output json | grep '"Status"' || true
    info "CloudFront invalidation queued for /releases.json + /release-notes.html"
  fi
}

# =============================================================================
# AWS — INFRASTRUCTURE
# =============================================================================

cmd_aws_infra() {
  # A Zip-packaged Lambda cannot be created before its artifact exists at
  # s3_key, so make sure it is there before the first apply.
  local bucket app_name
  if bucket="$(tf_output s3_bucket_name 2>/dev/null)"; then
    app_name="$(lambda_app_name)"
    if ! aws s3api head-object --bucket "$bucket" \
         --key "deployments/$app_name-lambda.zip" >/dev/null 2>&1; then
      warn "No Lambda artifact at s3://$bucket/deployments/$app_name-lambda.zip — building it first."
      build_lambda_zip
      upload_lambda_zip
    fi
  fi

  info "Running tofu apply..."

  # LESSON: backup_retention_period=0 is required for Free Tier RDS.
  # LESSON: runtime_platform CPU_ARCHITECTURE=ARM64 must be set for Apple Silicon builds.

  tofu -chdir="$TF_DIR" apply -auto-approve

  success "Infrastructure up to date"
}

# =============================================================================
# AWS — BACKEND (Lambda zip)
# =============================================================================
# The Lambda runs a zip built here, not a container image: dependencies are
# installed as manylinux aarch64 wheels (the function is arm64) and the `app`
# package is copied in beside them. The artifact is uploaded to the frontend
# bucket, then `aws lambda update-function-code` points the function at it.
#
# Terraform does not manage the deployed code (`ignore_changes = [s3_key]` in
# lambda.tf), so an `--infra-only` apply never reverts a running function to an
# older artifact. The artifact must exist before the function is first created.

# App name as Terraform knows it ("basicwebapp" / "basicwebapp-dev"), used for
# the artifact key. Derived from the Lambda name, which Terraform names
# "<app_name>-backend", so both names come from one source of truth.
lambda_app_name() {
  local function_name
  function_name="$(tf_output lambda_function_name 2>/dev/null || echo "basicwebapp-backend")"
  echo "${function_name%-backend}"
}

build_lambda_zip() {
  local app_name build_dir zip_path
  app_name="$(lambda_app_name)"
  build_dir="$SITE_ROOT/build"
  zip_path="$SITE_ROOT/$app_name-lambda.zip"

  require_cmd zip
  [[ -n "${PYTHON:-}" ]] || PYTHON="$(command -v python3.12 || command -v python3)" \
    || error "Python 3.12 not found. Set PYTHON=/path/to/python3.12."

  info "Building Lambda zip ($app_name) with manylinux aarch64 wheels..."
  rm -rf "$build_dir" "$zip_path"
  mkdir -p "$build_dir"
  # --platform manylinux2014_aarch64 matches Lambda's arm64 runtime; a native
  # macOS build would ship incompatible binaries.
  "$PYTHON" -m pip install \
    --quiet \
    --platform manylinux2014_aarch64 \
    --implementation cp \
    --python-version 3.12 \
    --only-binary=:all: \
    -t "$build_dir" \
    -r "$SITE_ROOT/requirements.txt"
  cp -R "$SITE_ROOT/app" "$build_dir/app"
  (cd "$build_dir" && zip -qr "$zip_path" .)
  success "Built $zip_path ($(du -h "$zip_path" | cut -f1))"
}

upload_lambda_zip() {
  local bucket region app_name zip_path
  bucket="$(tf_output s3_bucket_name)" \
    || error "Cannot read s3_bucket_name from tofu state. Run tofu apply first."
  region="$(get_region)"
  app_name="$(lambda_app_name)"
  zip_path="$SITE_ROOT/$app_name-lambda.zip"

  [[ -f "$zip_path" ]] || build_lambda_zip
  info "Uploading artifact to s3://$bucket/deployments/$app_name-lambda.zip ..."
  aws s3 cp "$zip_path" "s3://$bucket/deployments/$app_name-lambda.zip" --region "$region"
}

cmd_aws_backend() {
  local region function_name app_name
  region="$(get_region)"
  function_name="$(tf_output lambda_function_name 2>/dev/null || echo "basicwebapp-backend")"
  app_name="${function_name%-backend}"

  build_lambda_zip
  upload_lambda_zip

  # Bring infrastructure in line with the config (no-op unless it changed).
  info "Applying tofu..."
  tofu -chdir="$TF_DIR" apply -auto-approve

  info "Updating Lambda function code ($function_name) ..."
  aws lambda update-function-code \
    --function-name "$function_name" \
    --s3-bucket "$(tf_output s3_bucket_name)" \
    --s3-key "deployments/$app_name-lambda.zip" \
    --region "$region" \
    --output json | grep -E '"LastUpdateStatus"|"State"' | head -4

  info "Waiting for Lambda function update to complete..."
  aws lambda wait function-updated \
    --function-name "$function_name" \
    --region "$region" \
    && success "Lambda function updated" \
    || warn "Lambda wait timed out — check the console."

  local backend_url
  backend_url="$(tf_output backend_url 2>/dev/null || true)"
  if [[ -n "$backend_url" ]]; then
    wait_for_url "$backend_url/health" "Backend Lambda"
    success "Backend live: $backend_url"
  fi

  # On backend-only prod deploys, regenerate releases.json immediately so the
  # release-notes page reflects the latest GitHub releases without a full rebuild.
  if [[ "$ENV" == "prod" ]] && $BACKEND_ONLY; then
    push_releases_json_to_s3
  fi
}

# =============================================================================
# AWS — FRONTEND
# =============================================================================

cmd_aws_frontend() {
  local region
  region="$(get_region)"

  local s3_bucket cf_dist_id frontend_url
  s3_bucket="$(tf_output s3_bucket_name)"  || error "Cannot read s3_bucket_name from tofu state."
  cf_dist_id="$(tf_output cloudfront_distribution_id)" || error "Cannot read cloudfront_distribution_id."
  frontend_url="$(tf_output frontend_url 2>/dev/null || echo "https://${cf_dist_id}.cloudfront.net")"

  # Fetch browser keys — from SSM (dev) or Secrets Manager (prod)
  local here_browser_api_key google_maps_browser_api_key
  if [[ "$ENV" == "dev" ]]; then
    here_browser_api_key="$(aws ssm get-parameter \
      --name "/basicwebapp-dev/here-browser-api-key" \
      --with-decryption \
      --region "$region" \
      --query Parameter.Value \
      --output text)" || error "Cannot read /basicwebapp-dev/here-browser-api-key from SSM."

    google_maps_browser_api_key="$(aws ssm get-parameter \
      --name "/basicwebapp-dev/google-maps-browser-api-key" \
      --with-decryption \
      --region "$region" \
      --query Parameter.Value \
      --output text)" || error "Cannot read /basicwebapp-dev/google-maps-browser-api-key from SSM."
  else
    here_browser_api_key="$(aws ssm get-parameter \
      --name "/basicwebapp/here-browser-api-key" \
      --with-decryption \
      --region "$region" \
      --query Parameter.Value \
      --output text)" || error "Cannot read /basicwebapp/here-browser-api-key from SSM."

    google_maps_browser_api_key="$(aws ssm get-parameter \
      --name "/basicwebapp/google-maps-browser-api-key" \
      --with-decryption \
      --region "$region" \
      --query Parameter.Value \
      --output text)" || error "Cannot read /basicwebapp/google-maps-browser-api-key from SSM."
  fi

  # Generate releases.json from GitHub so release-notes.html works without auth
  # (the repo is private; unauthenticated GitHub API returns 404 from browsers)
  generate_releases_json

  info "Building frontend in Docker (node:20-alpine) for reproducible build..."
  # The second -v /app/node_modules mount is an anonymous Docker volume that shadows the
  # host's node_modules directory. This means npm ci writes to Docker's own storage rather
  # than the macOS APFS volume mount (which is slow for large trees and can break on
  # filenames with spaces). The dist/ output is still written back to the host via the
  # first volume mount. No host-side node_modules cleanup is needed.
  docker run --rm \
    -e VITE_API_BASE_URL="" \
    -e VITE_HERE_API_KEY="$here_browser_api_key" \
    -e VITE_GOOGLE_MAPS_API_KEY="$google_maps_browser_api_key" \
    -v "$SITE_ROOT/frontend":/app \
    -v /app/node_modules \
    -w /app \
    node:20-alpine \
    sh -c "npm ci && npm run build"

  info "Syncing to S3 bucket: $s3_bucket ..."
  aws s3 sync "$SITE_ROOT/frontend/dist/" "s3://${s3_bucket}" \
    --delete \
    --region "$region"

  # HTML files must never be cached by browsers — they contain hashed JS/CSS bundle
  # references that change on every deploy. Without no-store, browsers cache the old
  # index.html and continue loading the old JS bundle even after a new deploy.
  # LESSON: Only stats.html was no-cached before; index.html was missing — browsers
  # kept loading old bundles and saw stale geocode/API behaviour.
  for html_file in index.html stats.html impressum.html datenschutz.html stats-login.html release-notes.html help.html; do
    local_path="$SITE_ROOT/frontend/dist/${html_file}"
    if [[ -f "$local_path" ]]; then
      aws s3 cp "$local_path" \
        "s3://${s3_bucket}/${html_file}" \
        --cache-control "no-cache, no-store, must-revalidate" \
        --content-type "text/html" \
        --region "$region"
    fi
  done

  # releases.json is regenerated every deploy — never let CloudFront/browser cache it
  if [[ -f "$SITE_ROOT/frontend/dist/releases.json" ]]; then
    aws s3 cp "$SITE_ROOT/frontend/dist/releases.json" \
      "s3://${s3_bucket}/releases.json" \
      --cache-control "no-cache, no-store, must-revalidate" \
      --content-type "application/json" \
      --region "$region"
  fi

  info "Invalidating CloudFront distribution: $cf_dist_id ..."
  # LESSON: Without an invalidation, CloudFront serves the old cached index.html indefinitely.
  aws cloudfront create-invalidation \
    --distribution-id "$cf_dist_id" \
    --paths "/*" \
    --output json | grep '"Status"' || true

  success "Frontend deployed"
  success "URL: $frontend_url"
}

# =============================================================================
# DISPATCH
# =============================================================================

show_help() {
  cat <<'EOF'
Landhauscheck deployment script

Usage:
  ./scripts/deploy.sh local                 Start full local stack
  ./scripts/deploy.sh local --stop          Stop local stack

  ./scripts/deploy.sh aws                   Full deploy: infra + backend + frontend
  ./scripts/deploy.sh aws --backend-only    Build+upload Lambda zip, update function code
  ./scripts/deploy.sh aws --frontend-only   Build React app, sync to S3+CloudFront
  ./scripts/deploy.sh aws --infra-only      Run tofu apply only

  ./scripts/deploy.sh aws --env dev                  Full dev deploy
  ./scripts/deploy.sh aws --env dev --backend-only   Dev Lambda update
  ./scripts/deploy.sh aws --env dev --frontend-only  Dev frontend
  ./scripts/deploy.sh aws --env dev --infra-only     Dev tofu apply

  ./scripts/deploy.sh preflight             Check all prerequisites

Options:
  --tag TAG          Release tag recorded in logs (default: git short SHA)
  --region REGION    Override AWS region
  --env ENV          Target environment: prod (default) or dev

First-time prod setup:
  1. aws configure
  2. Fill in infra/terraform/sites/landhauscheck/terraform.tfvars (copy from .example)
  3. tofu -chdir=infra/terraform/sites/landhauscheck init
  4. ./scripts/deploy.sh aws --infra-only
  5. ./scripts/deploy.sh aws --backend-only
  6. ./scripts/deploy.sh aws --frontend-only

First-time dev setup:
  1. Fill in infra/terraform/sites/landhauscheck-dev/terraform.tfvars (copy from .example)
  2. tofu -chdir=infra/terraform/sites/landhauscheck-dev init
  3. ./scripts/deploy.sh aws --env dev --infra-only
  4. ./scripts/deploy.sh aws --env dev --backend-only
  5. ./scripts/deploy.sh aws --env dev --frontend-only
EOF
}

case "$MODE" in
  local)
    if $STOP; then
      cmd_local_stop
    else
      cmd_local_start
    fi
    ;;
  aws)
    check_aws_prereqs
    # ── Prod deployment guard ────────────────────────────────────────────────
    # Rule: always deploy to dev and confirm testing before touching prod.
    if [[ "$ENV" == "prod" ]]; then
      echo ""
      echo -e "${YELLOW}╔══════════════════════════════════════════════════════════════╗${NC}"
      echo -e "${YELLOW}║  PRODUCTION DEPLOYMENT                                       ║${NC}"
      echo -e "${YELLOW}╚══════════════════════════════════════════════════════════════╝${NC}"
      echo ""
      warn "Rule: always deploy to dev.landhauscheck.com and explicitly confirm"
      warn "      you have tested the change there before deploying to prod."
      echo ""
      if [[ "${DEPLOY_CONFIRMED:-}" == "yes" ]]; then
        info "DEPLOY_CONFIRMED=yes — skipping interactive prompt."
      else
        read -r -p "  Have you tested this change on dev? Type 'yes' to continue: " _confirm
        [[ "$_confirm" == "yes" ]] || error "Prod deployment aborted. Test on dev first: bash scripts/deploy.sh aws --env dev"
      fi
      echo ""
    fi
    if $BACKEND_ONLY; then
      cmd_aws_backend
    elif $FRONTEND_ONLY; then
      cmd_aws_frontend
    elif $INFRA_ONLY; then
      cmd_aws_infra
    else
      # Full deploy
      info "Starting full AWS deployment (tag: $TAG)"
      cmd_aws_infra
      cmd_aws_backend
      cmd_aws_frontend
      success "=============================="
      success "Full deployment complete"
      success "=============================="
      echo ""
      tf_output frontend_url 2>/dev/null && echo "  Frontend: $(tf_output frontend_url)" || true
      tf_output backend_url  2>/dev/null && echo "  Backend:  $(tf_output backend_url)" || true
    fi
    ;;
  write-db-secret)
    check_aws_prereqs
    cmd_write_db_secret
    ;;
  preflight)
    cmd_preflight
    ;;
  help|--help|-h)
    show_help
    ;;
  *)
    show_help
    exit 1
    ;;
esac
