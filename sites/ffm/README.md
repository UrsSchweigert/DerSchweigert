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
- **Combo-ability pulsating border** (`#combo-frame` in `index.html`/`styles.css`, driven by `Renderer.drawComboFrame()` in `renderer.js`): while the combo counter is past a threshold (`getComboFrameBand()` in `game/combo-abilities.js` — fireball at >5, lightning at >10, dragon at >20), a DOM overlay pulses a border colored to match that ability's sprite palette, telegraphing which ability is "charged". It's a DOM overlay rather than a canvas-drawn border because the HUD bar at the top is painted over the canvas edges, so a canvas border alone is only ever visible on the left/right. Its `bottom` is kept in sync with `#input-zone`'s live rendered height via a `ResizeObserver` (set up in the `Renderer` constructor) so the frame's south edge tracks the actual background-art/input-panel boundary, which shifts between the multiple-choice and free-text input layouts, instead of the fixed canvas bottom edge.
- **Per-stage background images**: `Renderer.setBackgroundByLevel()` swaps in one of `stage-1.png`..`stage-6.png` (one per 10-level chapter) as the level advances. `background.png` is a legacy, visually distinct scene (no longer used by any stage) kept only as a last-resort fallback if the real stage image's `Image` element fires an `error` event — it must not be loaded eagerly alongside the real image, or a network/decode race can let it flash on screen first as the "wrong" background.
- On game over the frontend posts only the **overall high score** to `/api/high-score`.
- The per-level `/api/score` endpoint exists in the backend, but the current frontend does not call it.

### Auth/profile/leaderboard

- `api.js` stores the access token only in memory.
- Registration no longer returns an access token or logs the user in — new accounts start unverified and must click an emailed verification link before `/api/auth/login` will succeed (see "Email verification, password reset, email change" below).
- Refresh/logout depend on the `refresh_token` cookie and same-origin requests with credentials.
- Leaderboard grouping is by `first_grade_year`, not by level.
- The splash screen can prompt logged-in users without a `first_grade_year` to complete their profile so they appear in year buckets.
- Clicking the logged-in username in `#top-bar` opens an account modal (`#account-modal` in `index.html`) with three tabs: editable profile info (email change with re-verification, first grade year), change password, and high-score history (reusing the same chart renderer as the splash screen's leaderboard panel).

### Email verification, password reset, email change

- Sending is done via AWS SES (`app/mailer.py`, plain-text emails, no templates/configuration sets). Reads `SES_SENDER_EMAIL` / `APP_BASE_URL` from `os.environ` at call time; both are also exposed on `app.config` and propagated into `os.environ` by `app/__init__.py`, same pattern as `DYNAMODB_*`.
- New accounts (`create_user`) are written with `email_verified: False`. **Pre-existing accounts created before this feature are grandfathered in as verified**: `get_user()` defaults a missing `email_verified` attribute to `True`, so no migration script was needed — only genuinely new rows can ever be `False`.
- Single-use tokens (verification / password reset / email change) are stored in `ffm-users` as `TOKEN#<sha256 hex of the token>` / `T` items — only the SHA-256 digest is ever persisted; the plaintext token exists only in the emailed link (`create_token`/`consume_token` in `models.py`). `consume_token` deletes the item on success and leaves it untouched (not deleted) on a purpose mismatch or expiry, so a still-valid token for a different purpose can't be destroyed by an unrelated lookup. TTLs: 24h for `verify_email` and `change_email`, 1h for `reset_password`.
- Endpoints: `POST /api/auth/verify-email`, `POST /api/auth/resend-verification`, `POST /api/auth/forgot-password`, `POST /api/auth/reset-password`, `POST /api/auth/confirm-email-change`, plus authenticated `POST /api/profile/password` and `POST /api/profile/email`. `resend-verification`/`forgot-password` always return a generic response regardless of whether the account/email exists, to avoid leaking which emails are registered.
- Email changes are two-phase: `POST /api/profile/email` (requires the current password) sets `pending_email` on the profile and emails a confirmation link to the *new* address; the account keeps using the old address for login until `POST /api/auth/confirm-email-change` is called with that link's token, which re-points the `EMAIL#<email>/REF` lookup item and updates `PROFILE.email`.
- Verification/reset/email-change links all point at the single static `index.html` with a distinguishing query param (`?verify_token=`, `?reset_token=`, `?confirm_email_token=`) that `main.js` parses on load, calls the matching API, and then strips via `history.replaceState` so a page refresh can't replay it.
- SES is **sandboxed** on this AWS account — it can only deliver to individually-verified recipient addresses until AWS approves production access. A production-access request was submitted directly via `aws sesv2 put-account-details --production-access-enabled ...` (region `eu-central-1`) on 2026-09-05; `aws sesv2 get-account`'s `Details.ReviewDetails.Status` was `PENDING` immediately after submission — check that field for the current status (`PENDING`/`APPROVED`/`DENIED`). The domain (`ffm.derschweigert.de`) is verified via Terraform (see next section) so the Lambda can *send* regardless of sandbox status, but real end users won't receive mail until this request is approved.

### Backend/data model

- Persistence is **DynamoDB only** in the live code path.
- `sites/ffm/app/models.py` uses two tables:
  - `ffm-users`
  - `ffm-scores`
- The tables use compound keys `pk` + `sk`.
- `ffm-users` stores:
  - `USER#<username>` / `PROFILE` (now also carries `email_verified` and, transiently, `pending_email`)
  - `EMAIL#<email>` / `REF`
  - `TOKEN#<sha256 hex>` / `T` — single-use verification/reset/email-change tokens, see above
- `ffm-scores` stores:
  - `USER#<username>` / `LEVEL#<level>#<difficulty>`
  - `USER#<username>` / `HIGHSCORE`
- Leaderboards are produced by scanning `HIGHSCORE` items, sorting in application code, and then grouping by `first_grade_year`.
- A third table, `ffm-ratelimits`, backs rate limiting (see next section) and is accessed by `app/ratelimit_storage.py`, not `app/models.py`. It's hash-key-only (`pk`), with `counter` (Number), `expires_at` (Number, epoch seconds — end of the current fixed window), and `ttl` (Number, epoch seconds — DynamoDB TTL attribute for eventual cleanup of stale rows; TTL deletion is best-effort/delayed, so `expires_at` is what actually governs window resets, not the TTL sweep).

### Security: rate limiting and JWT secret

- A single shared `flask_limiter.Limiter` instance lives in `app/extensions.py` and is `init_app()`'d once in `app/__init__.py`. **Never instantiate a second `Limiter()` anywhere else** (e.g. in a blueprint file) — a previous version of this code did exactly that in `auth.py`, and that second instance's `@limiter.limit(...)` decorators silently never enforced anything because it was never bound to the real app via `init_app()`. This was only caught by empirically firing repeated requests at `/api/auth/login` and observing that `429` never appeared.
- `/api/auth/login`, `/api/auth/register`, `/api/auth/resend-verification`, and `/api/auth/forgot-password` are rate-limited via `AUTH_RATE_LIMIT` (`app/config.py`): `10/minute` in production, `1000/minute` in `TestingConfig` (high enough that the normal test suite's many login/register calls never trip it — a dedicated regression test overrides `AUTH_RATE_LIMIT` to a low value just for itself instead).
- `/api/auth/resend-verification` and `/api/auth/forgot-password` carry a **second, independent rate limit keyed by the target email address** in the request body (`EMAIL_TARGET_RATE_LIMIT`, `3/hour` in production; see `_email_rate_limit_key()` in `auth.py`), stacked on top of the per-IP `AUTH_RATE_LIMIT` above. This closes a real mail-bombing gap: without it, an attacker rotating source IPs (or simply staying under the per-IP limit) could otherwise call either endpoint against one victim's address indefinitely, using our own SES domain to spam someone who never registered anything themselves. `AUTH_RATE_LIMIT` alone only bounds requests *per caller*, not requests *per victim*.
- Every other route falls under the app-wide default limits set in `app/extensions.py`: `200/day, 50/hour` per client IP.
- Storage backend is `RATELIMIT_STORAGE_URI`: `memory://` in dev/test, `dynamodb://ffm-ratelimits` in production. This isn't cosmetic — Lambda gives each concurrent execution environment its own process memory, so `memory://` cannot share counters across concurrent/cold-started invocations and would make the rate limit far weaker than configured in practice. `app/ratelimit_storage.py` implements a small custom `limits`-library `Storage` backend (registered under the `dynamodb://` URI scheme) to solve this instead of introducing Redis/ElastiCache (which would also require putting the Lambda in a VPC).
- `SECRET_KEY` (used to sign/verify JWTs) is generated by Terraform (`random_password.jwt_secret` in `infra/terraform/sites/ffm/main.tf`), stored in Secrets Manager as `ffm/jwt-secret-key`, and passed to the Lambda as `SECRET_KEY_ARN`. `lambda/handler.py`'s `_resolve_secret_key()` fetches it at cold start and sets `os.environ['SECRET_KEY']` *before* `app.config.py` is imported (that module reads `os.environ['SECRET_KEY']` at class-definition time with no fallback, so ordering matters). Locally/in tests, just set `SECRET_KEY` directly and `_resolve_secret_key()` becomes a no-op.
- The `aws_secretsmanager_secret_version` resource has `lifecycle { ignore_changes = [secret_string] }` specifically so routine `terraform apply` runs never rotate it by accident. **Rotating this secret invalidates every existing JWT (access + refresh) and logs out all users** — expected if it's ever deliberately rotated (e.g. suspected leak), but not something that should happen as a side effect of an unrelated change.

### Email-abuse resistance (SES)

What's in place:
- **Per-recipient-email rate limiting** on `resend-verification`/`forgot-password` (above) — the main lever an anonymous attacker has to turn our mailer into a spam/harassment tool against a third party's inbox.
- **Cloudflare Turnstile CAPTCHA** on `register`, `forgot-password`, and `resend-verification` (`app/captcha.py`, `_check_captcha()` in `app/auth.py`) — raises the cost of large-scale automated abuse. `TURNSTILE_ENABLED` is `True` in production, `False` in `TestingConfig` (so the test suite doesn't need real/mocked tokens for every call). The secret key was created directly via `aws secretsmanager create-secret --name ffm/turnstile-secret-key` (its value originates externally at Cloudflare, never written to a `.tf` file or committed) and is resolved from Secrets Manager into `TURNSTILE_SECRET_KEY` at Lambda cold start (`lambda/handler.py`'s `_resolve_turnstile_secret_key()`, mirroring `_resolve_secret_key()`). The site key (public by design) is hardcoded directly in `static/game/main.js`/`static/index.html`, same as Cloudflare's own docs recommend. Verification fails closed (rejects) on a missing token, missing secret, or any network/parsing error talking to Cloudflare — never fails open.
  - **CSP requirement**: Turnstile's script (`https://challenges.cloudflare.com/turnstile/v0/api.js`, loaded in `static/index.html`) and its challenge iframe both need to be allowed by the site's Content-Security-Policy, or the browser silently blocks the script entirely — the widget then never renders/produces a token, and because verification fails closed, *every* register/forgot-password/resend-verification request gets rejected, not just bots' (this broke in production until fixed 2026-09-06). `infra/terraform/sites/ffm/main.tf`'s `module "site"` overrides the shared `static_site` module's same-origin-only default CSP (see root `README.md`'s "Security response headers" section) to add `https://challenges.cloudflare.com` to both `script-src` and `frame-src`, per [Cloudflare's documented CSP requirements](https://developers.cloudflare.com/turnstile/reference/content-security-policy/). Applies instantly on `terraform apply` (CloudFront response-headers policies don't need a cache invalidation).
- **Registration can only ever send one verification email per victim address, ever** — `create_user`'s `EMAIL#<email>/REF` item uses a `ConditionExpression=Attr('pk').not_exists()` uniqueness check, so an attacker can't register multiple accounts against the same non-owned email to trigger repeat sends; `AUTH_RATE_LIMIT` bounds the same attacker trying many *different* victim emails from one IP.
- **No account-existence enumeration**: `resend-verification` and `forgot-password` always return the same generic message regardless of whether the email is registered/verified, so they can't be used to build a list of valid accounts.
- **Single-use, short-TTL, hashed tokens**: verification/reset/email-change tokens are SHA-256-hashed at rest (plaintext only ever exists in the emailed link), expire in 1–24h, and are deleted on first successful use — a leaked DynamoDB read or backup can't be replayed to log in or reset a password.
- **Domain authentication (SPF via SES/DKIM)**: `aws_ses_domain_dkim` is Terraform-managed for `ffm.derschweigert.de`, reducing the chance of the domain's mail being spoofed or landing in spam, which also protects sender reputation.
- **Account-level bounce/complaint suppression is on by default** (`aws sesv2 get-account`'s `SuppressionAttributes.SuppressedReasons: ["BOUNCE", "COMPLAINT"]`) — SES automatically stops sending to addresses that previously bounced or were marked as spam, which is what actually protects the account's sending reputation (and, ultimately, the production-access approval) from a flood of registrations using typo'd/fake addresses.
- **CloudWatch alarms on SES bounce/complaint/send-volume** (`infra/terraform/sites/ffm/main.tf`): an `aws_ses_configuration_set` named `ffm-transactional` with a CloudWatch event destination tracks Send/Bounce/Complaint/Reject counts (dimensioned by the `ses:configuration-set` auto-tag); `app/mailer.py` tags every send with `ConfigurationSetName` so it's actually counted. Three `aws_cloudwatch_metric_alarm`s notify an SNS topic (`ffm-alerts`, subscribed via email) on: **any** bounce in a 1-hour window (`ffm-ses-bounce`, threshold 1 — legitimate bounce rate should be ~0 for a small opt-in service), **any** complaint in a 1-hour window (`ffm-ses-complaint`, threshold 1 — more urgent than a bounce, a real recipient actively flagged the mail), and send volume exceeding 50/hour (`ffm-ses-send-volume` — a generous ceiling given expected traffic of a handful of registrations/resets per day, meant to catch abuse slipping past the app-level limits at scale or a runaway bug before SES's own 200/day sandbox cap throttles the account). **The SNS email subscription requires a one-time click on the confirmation email AWS sends to the subscribed address before alerts actually arrive** — Terraform can create the subscription but can't complete that confirmation step for you.
- **`/api/profile/email` (email-change confirmation) requires an authenticated session and the account's current password** to trigger a send, so it can't be used anonymously — an attacker would need to have already compromised the account, at which point email-sending abuse is the least of that account's problems.

### Legal/compliance pages and cookie consent

Added 2026-09-06 (Impressum/Datenschutz were entirely missing before). All of it is static; no backend/API routes were added.

- `static/impressum.html` / `impressum.en.html` (§ 5 DDG) and `static/datenschutz.html` / `datenschutz.en.html` (Art. 12/13 GDPR) — bilingual DE/EN legal pages, linked from a small footer line in the splash screen (`.splash-legal-links` in `index.html`/`styles.css`). Responsible entity: Urs Schweigert; contact `info@derschweigert.de` (see "Deployment shape" below for how that mailbox exists). No VAT ID/register entry is shown (owner has neither).
- **Cookie consent banner** (`static/game/cookie-consent.js`, a `CookieConsent` class, single instance created by an inline `<script type="module">` in `index.html`): Cloudflare Turnstile's script tag is **no longer loaded unconditionally** in `<head>` — it's dynamically injected only after the user clicks Accept on the bottom banner (decision persisted in `localStorage`). Decline (or no decision yet) leaves `window.turnstile` unset; `ensureTurnstileWidget()` in `main.js` detects a `'declined'` state and renders an inline message in the widget's container instead of polling forever. The `refresh_token` session cookie itself needs no such gate — it's disclosed in the privacy policy as a § 25(2) TDDDG strictly-necessary cookie, same legal basis as any login-session cookie.
  - **z-index note**: the banner is `position: fixed` with `z-index: 150`, deliberately higher than `.overlay`'s `z-index: 100` (the splash screen itself is a full-viewport `.overlay`) so it's actually visible on the very first screen, and lower than `#top-bar`'s `z-index: 200`.
- **Registration now requires a consent checkbox** (`#reg-consent-checkbox` in the register form, validated in `main.js`'s submit handler before the API call fires): confirms the registrant is 18+, and if the account is for a child, that the registrant is that child's parent/guardian consenting on the child's behalf. This is a **client-side-only** gate — there's no birthdate field or backend enforcement, since `first_grade_year` is a leaderboard cohort field, not an age/birthdate field.



### Auth

- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/refresh`
- `POST /api/auth/logout`
- `POST /api/auth/verify-email`
- `POST /api/auth/resend-verification`
- `POST /api/auth/forgot-password`
- `POST /api/auth/reset-password`
- `POST /api/auth/confirm-email-change`

### Game/profile

- `GET /api/health`
- `GET /api/profile`
- `PATCH /api/profile`
- `POST /api/profile/password`
- `POST /api/profile/email`
- `GET /api/profile/score-history`
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
- SES: `aws_ses_domain_identity`/`aws_ses_domain_dkim` for `ffm.derschweigert.de`, verified via Route53 TXT/CNAME records that Terraform manages directly (using the existing `data.aws_route53_zone.primary`); the Lambda role gets a scoped `ses:SendEmail`/`ses:SendRawEmail` inline policy (`ffm-lambda-ses-access`) limited to that domain identity's ARN. **SES is sandboxed on this AWS account** — domain verification lets the Lambda *send*, but real end users won't receive mail until AWS approves production access. A production-access request has already been filed (`aws sesv2 put-account-details --production-access-enabled`, submitted 2026-09-05, `TRANSACTIONAL` mail type); poll `aws sesv2 get-account --query 'Details.ReviewDetails.Status'` for its current status.
- SES monitoring/alerting: `aws_ses_configuration_set.ffm_transactional` + a CloudWatch event destination track Send/Bounce/Complaint/Reject counts; `aws_cloudwatch_metric_alarm.ffm_ses_bounce`/`ffm_ses_complaint`/`ffm_ses_send_volume` notify the `ffm-alerts` SNS topic (email subscription — **requires a one-time click on AWS's confirmation email** before it actually delivers). See "Email-abuse resistance (SES)" above for thresholds/rationale.
- Anti-abuse CAPTCHA: Cloudflare Turnstile on `register`/`forgot-password`/`resend-verification`. Its secret key lives in Secrets Manager (`ffm/turnstile-secret-key`, created directly via `aws secretsmanager create-secret`, **not** Terraform-managed since the value originates externally at Cloudflare) and is resolved into the Lambda's environment at cold start via `TURNSTILE_SECRET_KEY_ARN`, mirroring the JWT secret's `_resolve_secret_key()` pattern.
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

As of 2026-09-06 the policy is at **v12** and includes, beyond its original derschweigert/ffm S3+CloudFront+API-Gateway+Lambda+ACM+Route53 scope:
- `FfmDynamoDbTables` — full lifecycle (`CreateTable`/`DescribeTable`/`UpdateTable`/`DeleteTable`/TTL/tags, plus `DescribeContinuousBackups`/`DescribeTableReplicaAutoScaling`/`DescribeKinesisStreamingDestination`, all of which the AWS provider's table-refresh calls even though nothing in this repo's config uses backups/replicas/streams) scoped to `ffm-users`, `ffm-scores`, `ffm-ratelimits`.
- `FfmJwtSecretManage` — full lifecycle including `CreateSecret`/`PutSecretValue`/`GetSecretValue` (the provider reads a secret version back right after creating it, to populate Terraform state) scoped to `ffm/jwt-secret-key`.
- `CloudFrontAll` extended with `CreateResponseHeadersPolicy`/`UpdateResponseHeadersPolicy`/`DeleteResponseHeadersPolicy` — needed by **both** sites now that they share a response-headers-policy resource in the `static_site` module.
- `IamRoleForLambda` extended with `PutRolePolicy`/`DeleteRolePolicy` (inline role policies aren't covered by the existing `iam:Get*`/`iam:List*` wildcards) for both `ffm-lambda-role` and `derschweigert-lambda-role`.
- `FfmSesManage` (added 2026-09-05 for the email-verification feature) — `ses:VerifyDomainIdentity`/`DeleteIdentity`/`GetIdentityVerificationAttributes`/`VerifyDomainDkim`/`GetIdentityDkimAttributes`/`SetIdentityDkimEnabled` on `Resource: "*"` (SES v1 identity-management APIs don't support resource-level ARN scoping the way `ses:SendEmail` does). `Route53All`/`IamRoleForLambda` already covered the Route53 records and Lambda inline-policy needs, so no other statement changes were required. This statement grants no send capability itself — sending is authorized separately via the Lambda role's own `ffm-lambda-ses-access` inline policy (created by Terraform, scoped to the domain identity ARN).
- `FfmTurnstileSecretRead` (added 2026-09-05 for CAPTCHA, `GetResourcePolicy` added in v11) — `secretsmanager:DescribeSecret`/`ListTagsForResource`/`GetResourcePolicy` scoped to `ffm/turnstile-secret-key-*`, letting Terraform's metadata-only `data "aws_secretsmanager_secret" "turnstile_secret"` resolve the ARN. **`GetResourcePolicy` was missed in the initial v10 statement and broke `deploy-ffm`'s first CI run** (`AccessDeniedException` on `secretsmanager:GetResourcePolicy` while reading the data source) — the data source apparently calls this in addition to `DescribeSecret`/`ListTagsForResource`, same as the JWT secret's provider read-back already needed it (see `FfmJwtSecretManage`, which already had it from the start). Deliberately still **no** `GetSecretValue` here — the CI principal never needs to read the actual secret value, only the Lambda role does (via `secret_arns` in `module.api`, a separate, already-covered grant).
- `FfmSesConfigurationSetManage` (added 2026-09-05 for the SES bounce/complaint/volume alarms) — `ses:CreateConfigurationSet`/`DeleteConfigurationSet`/`DescribeConfigurationSet`/`CreateConfigurationSetEventDestination`/`UpdateConfigurationSetEventDestination`/`DeleteConfigurationSetEventDestination` on `Resource: "*"` (same SES v1 no-ARN-scoping limitation as `FfmSesManage`).
- `FfmAlertsSnsManage` / `FfmAlertsCloudWatchAlarms` (added 2026-09-05, same rollout) — SNS topic/subscription management scoped to `arn:...:sns:eu-central-1:113725432218:ffm-alerts`, and CloudWatch alarm management scoped to `arn:...:cloudwatch:eu-central-1:113725432218:alarm:ffm-ses-*`.
- **v12 (2026-09-06, `email_forwarding` module for `info@derschweigert.de`):** `S3ReadOnly`/`S3Manage`'s four separate `derschweigert-terraform-state`/`derschweigert-site-*` resource entries were consolidated into a single `arn:aws:s3:::derschweigert-*` (+ `/*`) wildcard — both to fit the new `derschweigert-de-ses-incoming` bucket under the existing statements without adding entries (the policy document was already close to IAM's 6,144-character customer-managed-policy size cap) and because "derschweigert-" is already this account's real bucket-naming convention. `S3Manage` gained `s3:PutLifecycleConfiguration`. `IamRoleForLambda` and `LambdaManage` each gained one resource ARN for the new `derschweigert-de-ses-forwarder-role`/`derschweigert-de-ses-forwarder` function. A new `FfmSesReceiptManage` statement grants `ses:*Receipt*` on `Resource: "*"` (SES receipt-rule-set/rule/active-rule-set APIs, like the other SES v1 identity APIs above, don't support resource-level ARN scoping) — deliberately a substring wildcard rather than enumerating all ~9 individual `Create`/`Delete`/`Describe`/`List`/`Set`/`Reorder`-prefixed action names, again to stay under the size cap. Freed a version slot by deleting `v7`.

Freeing a version slot (the policy sits at the 5-version cap) was done by deleting the then-oldest version each time — `v4` before pushing `v9`, then `v5` before pushing `v10`, then `v7` before pushing `v12`.

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
