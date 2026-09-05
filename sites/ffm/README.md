# Arithmo Slayer system documentation

This document describes the system as it exists in the repository today so future work can start from the code's current truth rather than the original build prompt.

## What Arithmo Slayer is

Arithmo Slayer is a browser math game shipped as:

- a static frontend under `sites/ffm/static/`
- a Flask JSON API under `sites/ffm/app/`
- an AWS deployment made of CloudFront + S3 for static assets and API Gateway + Lambda for `/api/*`

The production host is `https://ffm.derschweigert.de`.

## Current architecture at a glance

```text
Browser
  ├─ index.html + styles.css
  ├─ game/main.js
  │   ├─ levels.js      (curriculum + problem generation)
  │   ├─ renderer.js    (canvas drawing)
  │   ├─ entities.js    (hero, fiends, lightning)
  │   ├─ input.js       (answer UI + keyboard handling)
  │   ├─ audio.js       (SFX + BGM)
  │   ├─ hud.js         (hearts / score / level)
  │   └─ api.js         (auth/profile/leaderboard/high score client)
  └─ /api/*
      └─ Flask app
          ├─ auth.py    (/api/auth/*)
          ├─ main.py    (/api/health, /api/profile, /api/score, /api/high-score, /api/leaderboard)
          └─ models.py  (DynamoDB persistence helpers; despite the name, not an ORM layer)
```

## Source-of-truth files

- Game shell/UI: `sites/ffm/static/index.html`
- Frontend orchestration: `sites/ffm/static/game/main.js`
- Curriculum/problem generator: `sites/ffm/static/game/levels.js`
- Backend app factory/CORS/rate limiting wiring: `sites/ffm/app/__init__.py`
- Shared Flask extensions (the one `Limiter` instance): `sites/ffm/app/extensions.py`
- DynamoDB-backed rate limit storage: `sites/ffm/app/ratelimit_storage.py`
- Shared request-payload validation (`is_valid_int`): `sites/ffm/app/validation.py`
- Auth API: `sites/ffm/app/auth.py`
- Score/profile/leaderboard API: `sites/ffm/app/main.py`
- DynamoDB access patterns: `sites/ffm/app/models.py`
- Lambda entrypoint + cold-start secret resolution: `sites/ffm/lambda/handler.py`
- Infra stack: `infra/terraform/sites/ffm/main.tf`
- Backend tests: `sites/ffm/tests/test_app.py`
- Curriculum tests: `sites/ffm/static/game/levels.test.js`

## Important current behavior

### Frontend/gameplay

- The game is a single static page with a canvas plus DOM overlays for auth, difficulty selection, level clear, game over, and input.
- `main.js` owns almost all runtime state in one module-level `state` object plus a few side arrays (`fiends`, `spawnQueue`, `requeuedFiends`, `answerTimes`, `activeLightningBolts`).
- The current curriculum is **60 levels**, not 40. The tests enforce four 15-level blocks.
- Each level currently uses `waveSize: 30`, but the current loop behaves more like "30 enemies per level" than a multi-wave system:
  - `waveNumber` exists in state but is not driving any real multi-wave progression.
  - `triggerWaveClear()` immediately transitions to level clear after all queued/requeued fiends are defeated.
- Only **one fiend is allowed on screen at a time** right now because `spawnNextFiend()` returns early if any fiend is still present.
- Requeue-on-wrong-answer is implemented:
  - wrong answer or timeout hurts the hero
  - the correct equation is revealed for 2 seconds
  - the fiend retreats and is appended to `requeuedFiends`
- Input mode is data-driven per level:
  - `multiple-choice` uses the four DOM buttons
  - `free-text` uses the text input and Strike button
- Score is computed client-side from base points + speed bonus + combo bonus, with an elite multiplier for rare elite fiends.
- On game over the frontend posts only the **overall high score** to `/api/high-score`.
- The per-level `/api/score` endpoint exists in the backend, but the current frontend does not call it.

### Auth/profile/leaderboard

- `api.js` stores the access token only in memory.
- Registration returns an access token, but only login/refresh set the refresh cookie.
- Refresh/logout depend on the `refresh_token` cookie and same-origin requests with credentials.
- Leaderboard grouping is by `first_grade_year`, not by level.
- The splash screen can prompt logged-in users without a `first_grade_year` to complete their profile so they appear in year buckets.

### Backend/data model

- Persistence is **DynamoDB only** in the live code path.
- `sites/ffm/app/models.py` uses two tables:
  - `ffm-users`
  - `ffm-scores`
- The tables use compound keys `pk` + `sk`.
- `ffm-users` stores:
  - `USER#<username>` / `PROFILE`
  - `EMAIL#<email>` / `REF`
- `ffm-scores` stores:
  - `USER#<username>` / `LEVEL#<level>#<difficulty>`
  - `USER#<username>` / `HIGHSCORE`
- Leaderboards are produced by scanning `HIGHSCORE` items, sorting in application code, and then grouping by `first_grade_year`.
- A third table, `ffm-ratelimits`, backs rate limiting (see next section) and is accessed by `app/ratelimit_storage.py`, not `app/models.py`. It's hash-key-only (`pk`), with `counter` (Number), `expires_at` (Number, epoch seconds — end of the current fixed window), and `ttl` (Number, epoch seconds — DynamoDB TTL attribute for eventual cleanup of stale rows; TTL deletion is best-effort/delayed, so `expires_at` is what actually governs window resets, not the TTL sweep).

### Security: rate limiting and JWT secret

- A single shared `flask_limiter.Limiter` instance lives in `app/extensions.py` and is `init_app()`'d once in `app/__init__.py`. **Never instantiate a second `Limiter()` anywhere else** (e.g. in a blueprint file) — a previous version of this code did exactly that in `auth.py`, and that second instance's `@limiter.limit(...)` decorators silently never enforced anything because it was never bound to the real app via `init_app()`. This was only caught by empirically firing repeated requests at `/api/auth/login` and observing that `429` never appeared.
- `/api/auth/login` and `/api/auth/register` are rate-limited via `AUTH_RATE_LIMIT` (`app/config.py`): `10/minute` in production, `1000/minute` in `TestingConfig` (high enough that the normal test suite's many login/register calls never trip it — a dedicated regression test overrides `AUTH_RATE_LIMIT` to a low value just for itself instead).
- Every other route falls under the app-wide default limits set in `app/extensions.py`: `200/day, 50/hour` per client IP.
- Storage backend is `RATELIMIT_STORAGE_URI`: `memory://` in dev/test, `dynamodb://ffm-ratelimits` in production. This isn't cosmetic — Lambda gives each concurrent execution environment its own process memory, so `memory://` cannot share counters across concurrent/cold-started invocations and would make the rate limit far weaker than configured in practice. `app/ratelimit_storage.py` implements a small custom `limits`-library `Storage` backend (registered under the `dynamodb://` URI scheme) to solve this instead of introducing Redis/ElastiCache (which would also require putting the Lambda in a VPC).
- `SECRET_KEY` (used to sign/verify JWTs) is generated by Terraform (`random_password.jwt_secret` in `infra/terraform/sites/ffm/main.tf`), stored in Secrets Manager as `ffm/jwt-secret-key`, and passed to the Lambda as `SECRET_KEY_ARN`. `lambda/handler.py`'s `_resolve_secret_key()` fetches it at cold start and sets `os.environ['SECRET_KEY']` *before* `app.config.py` is imported (that module reads `os.environ['SECRET_KEY']` at class-definition time with no fallback, so ordering matters). Locally/in tests, just set `SECRET_KEY` directly and `_resolve_secret_key()` becomes a no-op.
- The `aws_secretsmanager_secret_version` resource has `lifecycle { ignore_changes = [secret_string] }` specifically so routine `terraform apply` runs never rotate it by accident. **Rotating this secret invalidates every existing JWT (access + refresh) and logs out all users** — expected if it's ever deliberately rotated (e.g. suspected leak), but not something that should happen as a side effect of an unrelated change.

## API summary

### Auth

- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/refresh`
- `POST /api/auth/logout`

### Game/profile

- `GET /api/health`
- `GET /api/profile`
- `PATCH /api/profile`
- `POST /api/score`
- `POST /api/high-score`
- `GET /api/leaderboard`

## Deployment shape

The dedicated FFM stack now exists under `infra/terraform/sites/ffm/`.

- Static site: shared `static_site` Terraform module
- API: shared `api_backend` Terraform module
- Lambda function name: `ffm-api`
- DynamoDB tables:
  - `ffm-users`
  - `ffm-scores`
  - `ffm-ratelimits` (flask-limiter's `dynamodb://` storage backend; see `app/ratelimit_storage.py`)
- JWT signing key: Secrets Manager secret `ffm/jwt-secret-key`, passed to the Lambda as `SECRET_KEY_ARN` and resolved at cold start in `lambda/handler.py`
- Terraform backend key: `ffm/prod/terraform.tfstate`
- CI deploy flow is in `.github/workflows/deploy.yml`

The deploy workflow currently:

1. runs FFM backend tests (`test-ffm` job, gates both PRs and pushes to `main`)
2. `terraform apply`s `infra/terraform/sites/ffm/` — provisions/updates DynamoDB tables, the Secrets Manager secret, IAM policies, the CloudFront response-headers policy, and the Lambda's environment variables
3. builds a dependency-bundled Lambda zip into `sites/ffm/ffm-lambda.zip` and pushes it with `aws lambda update-function-code`
4. syncs `sites/ffm/static/` to the site bucket
5. invalidates CloudFront
6. smoke-tests `/` and `/api/health`

**Known trade-off in step 2→3:** Terraform's own `archive_file` data source (in the shared `api_backend` module) only zips `sites/ffm/lambda/` (just `handler.py`) — it does not bundle `app/` or pip dependencies, because those need Lambda-compatible (`manylinux2014`) wheels that Terraform can't easily produce. So `terraform apply` in step 2 briefly deploys that thin, non-functional zip as the Lambda's code before step 3 overwrites it with the real, fully-bundled one moments later in the same job. In practice this means a deploy has a short window (well under a minute) where a live request could hit `ModuleNotFoundError` before step 3 completes. Acceptable for this project's traffic level, but if it ever needs to become a non-issue, the fix is to build the dependency-bundled directory *before* running `terraform apply` and point `lambda_source_dir` at that pre-built directory instead of `sites/ffm/lambda/`, then drop the separate `update-function-code` step entirely so Terraform is the single source of truth for both code and config.

### CI's AWS IAM permissions are NOT managed in this repo — read this before adding new AWS resource types

CI authenticates to AWS as IAM user `derschweigert-ci-deploy` (account `113725432218`). Its permissions come entirely from a customer-managed IAM policy, **`derschweigert-deploy-scope`, which is hand-maintained directly in AWS IAM and has no Terraform resource anywhere in this repo.** Nothing in `infra/terraform/` grants or documents these permissions, and there's no automated check that the policy covers what a given `.tf` file actually needs.

This was discovered the hard way on 2026-09-05: `deploy-ffm` had *never* run `terraform apply` before that date (it only rebuilt/pushed the Lambda zip). The moment a `terraform apply` step was added, it failed immediately — the CI user had no DynamoDB permissions at all for `ffm-users`/`ffm-scores`, tables that had existed for a while already. That's strong evidence the entire FFM Terraform stack had only ever been applied from someone's personal/broad local AWS credentials, never from CI.

**If you add a new AWS resource type to any `infra/terraform/sites/*` config that CI applies, assume the CI policy does not yet grant the permissions it needs, and check/update it before relying on a green CI run to mean the infra actually got created.** Concretely:

```bash
# Inspect current policy
aws iam get-policy --policy-arn arn:aws:iam::113725432218:policy/derschweigert-deploy-scope
aws iam get-policy-version --policy-arn arn:aws:iam::113725432218:policy/derschweigert-deploy-scope \
  --version-id <DefaultVersionId> --query 'PolicyVersion.Document'

# Update: edit the fetched document, then push a new version and make it default
aws iam create-policy-version --policy-arn arn:aws:iam::113725432218:policy/derschweigert-deploy-scope \
  --policy-document file://updated-policy.json --set-as-default
```

Customer-managed policies cap out at **5 versions** — once at capacity, `aws iam delete-policy-version --policy-arn ... --version-id vN` an old non-default one first. Also: newly-added permissions can take a minute or two to propagate; if a freshly-granted action still gets `AccessDenied` immediately after updating the policy, wait ~2 minutes and retry before assuming the policy edit was wrong (observed directly during this rollout: a `secretsmanager:GetSecretValue` read-back failed once right after being granted, then succeeded on retry with no further changes).

As of 2026-09-05 the policy is at **v8** and includes, beyond its original derschweigert/ffm S3+CloudFront+API-Gateway+Lambda+ACM+Route53 scope:
- `FfmDynamoDbTables` — full lifecycle (`CreateTable`/`DescribeTable`/`UpdateTable`/`DeleteTable`/TTL/tags, plus `DescribeContinuousBackups`/`DescribeTableReplicaAutoScaling`/`DescribeKinesisStreamingDestination`, all of which the AWS provider's table-refresh calls even though nothing in this repo's config uses backups/replicas/streams) scoped to `ffm-users`, `ffm-scores`, `ffm-ratelimits`.
- `FfmJwtSecretManage` — full lifecycle including `CreateSecret`/`PutSecretValue`/`GetSecretValue` (the provider reads a secret version back right after creating it, to populate Terraform state) scoped to `ffm/jwt-secret-key`.
- `CloudFrontAll` extended with `CreateResponseHeadersPolicy`/`UpdateResponseHeadersPolicy`/`DeleteResponseHeadersPolicy` — needed by **both** sites now that they share a response-headers-policy resource in the `static_site` module.
- `IamRoleForLambda` extended with `PutRolePolicy`/`DeleteRolePolicy` (inline role policies aren't covered by the existing `iam:Get*`/`iam:List*` wildcards) for both `ffm-lambda-role` and `derschweigert-lambda-role`.

**Recommendation, not yet done:** bring `derschweigert-deploy-scope` under Terraform management so this can't silently drift out of sync again. Skipped in the 2026-09-05 session to avoid widening the blast radius of an already-eventful production deploy.

## Local development and validation

Known-good automated checks:

- `pip install -r sites/ffm/requirements-dev.txt && SECRET_KEY=ci-test-key pytest sites/ffm/tests/ -q --tb=short`
- `node --test sites/ffm/static/game/levels.test.js`

Dependency layout: `sites/ffm/requirements.txt` is the **production** dependency set — it's what actually gets bundled into the deployed Lambda zip (see `.github/workflows/deploy.yml`'s "Build Lambda zip" step), so it must stay minimal. `sites/ffm/requirements-dev.txt` (`-r requirements.txt` plus `pytest`/`moto`/`python-dotenv`) is for local dev and CI's `test-ffm` job only — never point the Lambda build step at it.

Important local-dev caveat:

- `api.js` uses `window.location.origin + '/api'`, so the frontend expects the API on the same origin.
- Serving `sites/ffm/static/` from a plain static file server is fine for canvas-only work, but auth/high-score/leaderboard flows will fail unless that same origin also exposes the Flask API.
- Because the refresh flow relies on cookies, cross-origin hacks are brittle; for end-to-end auth work, prefer an environment that really serves both the static app and `/api/*` together.

## Historical drift / gotchas

These are the things most likely to mislead a future session:

- The original build prompt in `ffm-math-game.prompt.md` describes a **40-level** plan; the shipped code and tests use **60 levels**.
- `sites/ffm/app/models.py` is DynamoDB access code, not SQLAlchemy models.
- `sites/ffm/build/` and `sites/ffm/ffm-lambda.zip` are packaging artifacts, not source. Both are gitignored and get deleted/regenerated on every CI deploy; don't hand-edit them and don't worry if they're absent locally (they're only produced by the "Build Lambda zip" CI step or by running that step's commands yourself).
- `sites/ffm/templates/` is effectively unused by the current static-frontend/JSON-API architecture.
- Some names are stale:
  - `triggerWaveClear()` is really the level-end transition in the current implementation.
  - `waveNumber` exists in state without a corresponding multi-wave runtime.
- **Never instantiate a second `flask_limiter.Limiter()`** anywhere in `app/` — always `from .extensions import limiter`. A second, un-`init_app()`'d instance looks like it works (the decorator syntax is identical) but silently never enforces anything; this exact bug shipped for a while in `auth.py` before a 2026-09-05 audit caught it empirically.
- `deploy-ffm` did not run `terraform apply` at all before 2026-09-05 — it only rebuilt/pushed the Lambda's code. If something Terraform-managed (a table, an IAM policy, an env var) seems out of sync with what `infra/terraform/sites/ffm/main.tf` says it should be, check whether `terraform apply` has actually succeeded in CI recently (see the CI IAM permissions section above — the most common reason it silently wouldn't have).
- A `sites/ffm/.venv`-less local `pytest` run needs `boto3`+`moto` (via `requirements-dev.txt`) and a `SECRET_KEY` env var — `tests/test_app.py` sets one and mocks AWS with `moto`, but running app code directly (not through the test file) outside that harness needs the same env vars set by hand.

## Fast file map for common tasks

### Change gameplay rules or scoring

Start with:

- `sites/ffm/static/game/main.js`
- `sites/ffm/static/game/levels.js`

### Change visuals or sprites

Start with:

- `sites/ffm/static/game/renderer.js`
- `sites/ffm/static/game/entities.js`
- `sites/ffm/static/styles.css`

### Change auth/profile/leaderboard behavior

Start with:

- `sites/ffm/static/game/api.js`
- `sites/ffm/static/game/main.js`
- `sites/ffm/app/auth.py`
- `sites/ffm/app/main.py`
- `sites/ffm/app/models.py`
- `sites/ffm/app/validation.py` (shared input validation — extend this instead of adding another ad-hoc `isinstance`/`type() is` check)

### Change rate limiting or the JWT secret

Start with:

- `sites/ffm/app/extensions.py` (the one shared `Limiter`)
- `sites/ffm/app/ratelimit_storage.py` (DynamoDB storage backend)
- `sites/ffm/app/config.py` (`AUTH_RATE_LIMIT`, `RATELIMIT_STORAGE_URI`)
- `sites/ffm/lambda/handler.py` (`SECRET_KEY` resolution from Secrets Manager)
- `infra/terraform/sites/ffm/main.tf` (`ffm-ratelimits` table, `jwt-secret-key` secret)
- read the "CI's AWS IAM permissions are NOT managed in this repo" section above first if you're adding a *new* AWS resource here

### Change deployment/infrastructure

Start with:

- `infra/terraform/sites/ffm/main.tf`
- `infra/terraform/sites/ffm/variables.tf`
- `.github/workflows/deploy.yml`
- the CI IAM permissions section above — check whether `derschweigert-deploy-scope` needs updating for any new resource type before trusting a green CI run

## Recommended working order for future changes

1. Read this file.
2. Verify whether the change is frontend-only, backend-only, or cross-cutting.
3. For gameplay changes, check `main.js` and `levels.js` before touching art or API code.
4. For persistence/leaderboard changes, check both `main.py` and `models.py`; many behaviors are split between validation and DynamoDB shape decisions.
5. For any change that adds a new AWS resource, read the CI IAM permissions section above first — don't assume a green `test`/`test-ffm` CI run means `deploy`/`deploy-ffm` will also succeed.
6. Run the smallest relevant tests:
   - curriculum/problem changes -> Node test
   - auth/profile/leaderboard/backend changes -> pytest
   - cross-cutting changes -> both
