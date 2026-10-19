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

### Data retention (operator instructions)

Scope: this section covers the record types whose retention policy the operator has fully
approved and is now enforced below. **Explicitly out of scope / held back pending legal
classification and late-webhook safety**: Stripe webhook-event audit rows, billing-state
redemption tombstones, and gift-code records in `app/billing_store.py` (including the 100
issued gift codes — their redemption behavior/expiry is unchanged). Nothing described below
reads, scans or deletes anything under the `BILLING#`/`CODE#` key prefixes. Financial/invoicing
retention remains unspecified per "Legal/tax approval status" above and must not be invented.

- **Account/game deletion**: unchanged — `DELETE /api/profile` (`models.delete_user`) still
  immediately and permanently removes the profile, email lock and all score/history items.
- **Verification/reset/email-change tokens**: already invalid the instant they expire or are
  used (`models.consume_token` checks `expires_at` and deletes on successful consumption).
  Tokens that expire *without* being consumed are physically removed **automatically, once a
  day** by the scheduled cleanup below; `flask --app sites.ffm.app:create_app retention-admin
  tokens` (dry-run by default; add `--confirm` to actually delete) remains available for an
  operator to inspect or run on demand between scheduled runs.
- **Rate-limit counters**: `ffm-ratelimits` already has DynamoDB TTL enabled
  (`infra/terraform/sites/ffm/main.tf`'s `aws_dynamodb_table.ratelimits`) — cleanup is
  asynchronous/best-effort by design (standard DynamoDB TTL behavior, typically within 48h of
  expiry), which is already accurately documented above; no change was needed here.
- **CloudWatch application logs**: the Lambda's `/aws/lambda/ffm-api` log group now has an
  explicit 30-day retention policy (`aws_cloudwatch_log_group.api` in
  `infra/terraform/modules/api_backend/main.tf`, `log_retention_in_days` variable, default 30)
  instead of the default "never expire". Application code must keep logging only non-sensitive
  context (see `app/billing.py`/`app/main.py`/`app/auth.py`'s existing `logger.error(...)` /
  `print(...)` calls, which already log usernames and exception class names only — never
  passwords, tokens, full Stripe payloads or email contents).
- **Public cancellation-request cases** (`app/cancel_requests_store.py`): a request is "completed"
  once it reaches a terminal status (`fulfilled`/`no_subscription`, recorded via `process` or
  `record-manual-outcome`); "unresolved" (`submitted`/`needs_review`/`processing`) requests are
  **never** auto-expired — they are retained indefinitely until an operator actually resolves
  them. A completed case's record becomes eligible for physical deletion 3 years after the end of
  the calendar year it was closed in (i.e. from Jan 1 of `processed_at.year + 4`), and is then
  purged by the same daily scheduled cleanup. `flask --app sites.ffm.app:create_app
  retention-admin cancel-requests` (dry-run by default; add `--confirm` to actually delete)
  remains available for an operator to inspect or run on demand between scheduled runs.
- **Legal holds**: `flask --app sites.ffm.app:create_app billing-admin cancel-request legal-hold
  <request_id>` suspends retention cleanup for one case regardless of age (`--lift` to release
  it again). Neither the CLI's `retention-admin cancel-requests` nor the scheduled cleanup below
  ever lists or deletes a request under hold.
- **Scheduled daily cleanup (automatic, unattended)**: an EventBridge rule
  (`aws_cloudwatch_event_rule.retention_cleanup` in `infra/terraform/sites/ffm/main.tf`) invokes
  the *existing* `ffm-api` Lambda directly once a day (`cron(0 3 * * ? *)`, 03:00 UTC) with a
  fixed `{"task": "ffm-retention-cleanup"}` payload. `sites/ffm/lambda/handler.py`'s
  `lambda_handler` recognizes that exact payload and routes it internally to
  `app.retention_admin.run_scheduled_cleanup()` — the same deletion logic the CLI's `--confirm`
  path uses — instead of to `apig_wsgi`/Flask; everything else (any API Gateway request) is
  unaffected. **There is no public HTTP endpoint for this** — only EventBridge's own
  IAM-authorized `lambda:InvokeFunction` permission (`aws_lambda_permission.retention_cleanup`)
  can trigger it, and no new Lambda function, execution role, or DynamoDB permission was added:
  it reuses the existing `ffm-api` function and `aws_iam_role_policy.lambda_dynamodb`'s existing
  `Scan`/`DeleteItem` grant. Both the tokens and cancel-requests purges use a scan via the
  existing `find_expired_tokens`/`list_purgeable_cancel_requests` pagination (bounded by the
  low-volume `ffm-users` table at this project's current scale; revisit if that table ever grows
  enough for a full table scan to become a concern) and a **conditional delete per item** —
  `models.delete_token_item`/`cancel_requests_store.delete_cancel_request` only delete if the
  item still matches the snapshot observed when it was listed as eligible (and, for cancel
  requests, is still not under legal hold) — so a race with `consume_token`, a legal hold set by
  an operator, or a case getting reprocessed between listing and deleting is detected and
  reported as a skip, never silently treated as a successful delete. Per-item delete failures
  and skips are counted and logged (never swallowed); only a failure to list candidates at all
  (e.g. a DynamoDB outage) propagates out of the run, so Lambda's own invocation-failure/retry
  handling applies to that case. **NOT YET APPLIED/VERIFIED** — see the Terraform-import and
  CI-IAM caveats below; this has only been validated with `terraform validate`/`fmt` and targeted
  pytest runs, not a real `terraform apply` or a live EventBridge invocation.
- **Safety**: both `retention-admin` CLI commands are dry-run (list-only) by default and require
  an explicit `--confirm` flag to delete anything, mirroring the existing `billing-admin`
  commands' pattern — never run `--confirm` against the production environment without first
  reviewing the dry-run output. The scheduled cleanup above is the one place this policy runs
  unattended, with no dry-run step; it still relies on the same conditional-delete safety as
  `--confirm` (never deleting a record that's changed since it was listed as eligible). That
  daily/automatic/no-dry-run tradeoff, and the Terraform in this section, has not yet been
  applied against the real backend and must be reviewed by an operator before `terraform apply`
  is run.
- Targeted tests: `SECRET_KEY=ci-test-key pytest sites/ffm/tests/test_retention_admin.py
  sites/ffm/tests/test_lambda_handler.py -q`.

### Security: rate limiting and JWT secret

- A single shared `flask_limiter.Limiter` instance lives in `app/extensions.py` and is `init_app()`'d once in `app/__init__.py`. **Never instantiate a second `Limiter()` anywhere else** (e.g. in a blueprint file) — a previous version of this code did exactly that in `auth.py`, and that second instance's `@limiter.limit(...)` decorators silently never enforced anything because it was never bound to the real app via `init_app()`. This was only caught by empirically firing repeated requests at `/api/auth/login` and observing that `429` never appeared.
- `/api/auth/login`, `/api/auth/register`, `/api/auth/resend-verification`, and `/api/auth/forgot-password` are rate-limited via `AUTH_RATE_LIMIT` (`app/config.py`): `10/minute` in production, `1000/minute` in `TestingConfig` (high enough that the normal test suite's many login/register calls never trip it — a dedicated regression test overrides `AUTH_RATE_LIMIT` to a low value just for itself instead).
- `/api/auth/resend-verification` and `/api/auth/forgot-password` carry a **second, independent rate limit keyed by the target email address** in the request body (`EMAIL_TARGET_RATE_LIMIT`, `3/hour` in production; see `_email_rate_limit_key()` in `auth.py`), stacked on top of the per-IP `AUTH_RATE_LIMIT` above. This closes a real mail-bombing gap: without it, an attacker rotating source IPs (or simply staying under the per-IP limit) could otherwise call either endpoint against one victim's address indefinitely, using our own SES domain to spam someone who never registered anything themselves. `AUTH_RATE_LIMIT` alone only bounds requests *per caller*, not requests *per victim*.
- Every other route falls under the app-wide default limits set in `app/extensions.py`: `200/day, 50/hour` per client IP.
- Storage backend is `RATELIMIT_STORAGE_URI`: `memory://` in dev/test, `dynamodb://ffm-ratelimits` in production. This isn't cosmetic — Lambda gives each concurrent execution environment its own process memory, so `memory://` cannot share counters across concurrent/cold-started invocations and would make the rate limit far weaker than configured in practice. `app/ratelimit_storage.py` implements a small custom `limits`-library `Storage` backend (registered under the `dynamodb://` URI scheme) to solve this instead of introducing Redis/ElastiCache (which would also require putting the Lambda in a VPC).
- `SECRET_KEY` (used to sign/verify JWTs) is generated by Terraform (`random_password.jwt_secret` in `infra/terraform/sites/ffm/main.tf`), stored in Secrets Manager as `ffm/jwt-secret-key`, and passed to the Lambda as `SECRET_KEY_ARN`. `lambda/handler.py`'s `_resolve_secret_key()` fetches it at cold start and sets `os.environ['SECRET_KEY']` *before* `app.config.py` is imported (that module reads `os.environ['SECRET_KEY']` at class-definition time with no fallback, so ordering matters). Locally/in tests, just set `SECRET_KEY` directly and `_resolve_secret_key()` becomes a no-op.
- The `aws_secretsmanager_secret_version` resource has `lifecycle { ignore_changes = [secret_string] }` specifically so routine `terraform apply` runs never rotate it by accident. **Rotating this secret invalidates every existing JWT (access + refresh) and logs out all users** — expected if it's ever deliberately rotated (e.g. suspected leak), but not something that should happen as a side effect of an unrelated change.

### Security: JWT identity binding (stable_id + token_version)

A **username is not a stable identity** — accounts can be deleted and the
freed username later re-registered by someone else entirely. Binding a
token only to `sub=<username>` (the original scheme) meant a still-valid
access or refresh token minted before a deletion would keep decoding
successfully against *whoever* currently sits at that username, handing
them the original owner's session (and, if billing is enabled, the
original owner's subscription/gift state).

The fix — all of it lives in `app/jwt_utils.py`, the **single** shared
module every token mint and every token validation in the whole app goes
through (`app/auth.py`'s `/auth/login` and `/auth/refresh`, and
`app/main.py`'s `require_auth()`, which `app/billing.py` and the rest of
`app/main.py` call rather than decoding JWTs themselves):
- Every access/refresh token additionally carries `stable_id` (the same
  immutable per-account billing identity minted by `models.ensure_stable_id()`,
  see "Billing data model" below) and `ver` (a persisted `token_version`
  counter) and `typ` (`"access"` or `"refresh"`).
- On every request, the validator re-fetches the user **fresh** from
  DynamoDB and requires the token's `stable_id` and `ver` to match the
  *current* row, and `typ` to match what the endpoint expects. A token
  whose username no longer resolves to any user, whose `stable_id`
  doesn't match (deleted-then-recreated account), whose `ver` doesn't
  match (password changed/reset since mint), or whose `typ` is wrong (a
  refresh token can't be used as a bearer token and vice versa) is
  rejected — the caller must log in again.
- Legacy tokens minted before this fix carry none of `stable_id`/`ver`/
  `typ` at all and are rejected outright (PyJWT's `require` option) —
  **no compatibility fallback**; anyone still holding one needs to log in
  again. This is a one-time, deliberate side effect of deploying the fix,
  not an ongoing behavior.
- `models.set_password_hash()` (used by both `/profile/password` and
  `/auth/reset-password`) atomically increments `token_version` in the
  *same* DynamoDB update as the password hash, so a password change/reset
  immediately revokes every outstanding access/refresh token for that
  account — there is no window where the old password and an old,
  still-valid token could coexist. The frontend (`static/game/main.js`)
  treats a successful password change the same way it already treats
  account deletion: it clears local session state and returns the user to
  the login form, since its own cached access token and refresh cookie
  are now dead too.
- Legacy accounts predating `stable_id`/`token_version` entirely (rows
  with neither attribute) are handled transparently: `models.get_user()`
  defaults a missing `token_version` to `0`, and `/auth/login` lazily
  backfills a missing `stable_id` via `ensure_stable_id()` (only when
  actually missing, not on every login) before minting tokens — no
  migration script needed. No new signout-all-sessions feature was added;
  revocation is strictly the by-product of a password change/reset, and
  plain `/auth/logout` still just clears the current browser's refresh
  cookie as before.

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

### Public cancellation requests (no login required)

- `POST /api/cancel-requests` — see "Public cancellation requests" under the Billing section
  below for the full field list, idempotency/validation rules, and the manual
  `billing-admin cancel-request` operator CLI that is the only thing allowed to act on these.

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

The policy is currently at **v17** (2026-10-19). Its historical versions added the following permissions beyond the original derschweigert/ffm S3+CloudFront+API-Gateway+Lambda+ACM+Route53 scope:
- `FfmDynamoDbTables` — full lifecycle (`CreateTable`/`DescribeTable`/`UpdateTable`/`DeleteTable`/TTL/tags, plus `DescribeContinuousBackups`/`DescribeTableReplicaAutoScaling`/`DescribeKinesisStreamingDestination`, all of which the AWS provider's table-refresh calls even though nothing in this repo's config uses backups/replicas/streams) scoped to `ffm-users`, `ffm-scores`, `ffm-ratelimits`.
- `FfmJwtSecretManage` — full lifecycle including `CreateSecret`/`PutSecretValue`/`GetSecretValue` (the provider reads a secret version back right after creating it, to populate Terraform state) scoped to `ffm/jwt-secret-key`.
- `CloudFrontAll` extended with `CreateResponseHeadersPolicy`/`UpdateResponseHeadersPolicy`/`DeleteResponseHeadersPolicy` — needed by **both** sites now that they share a response-headers-policy resource in the `static_site` module.
- `IamRoleForLambda` extended with `PutRolePolicy`/`DeleteRolePolicy` (inline role policies aren't covered by the existing `iam:Get*`/`iam:List*` wildcards) for both `ffm-lambda-role` and `derschweigert-lambda-role`.
- `FfmSesManage` (added 2026-09-05 for the email-verification feature) — `ses:VerifyDomainIdentity`/`DeleteIdentity`/`GetIdentityVerificationAttributes`/`VerifyDomainDkim`/`GetIdentityDkimAttributes`/`SetIdentityDkimEnabled` on `Resource: "*"` (SES v1 identity-management APIs don't support resource-level ARN scoping the way `ses:SendEmail` does). `Route53All`/`IamRoleForLambda` already covered the Route53 records and Lambda inline-policy needs, so no other statement changes were required. This statement grants no send capability itself — sending is authorized separately via the Lambda role's own `ffm-lambda-ses-access` inline policy (created by Terraform, scoped to the domain identity ARN).
- `FfmTurnstileSecretRead` (added 2026-09-05 for CAPTCHA, `GetResourcePolicy` added in v11) — `secretsmanager:DescribeSecret`/`ListTagsForResource`/`GetResourcePolicy` scoped to `ffm/turnstile-secret-key-*`, letting Terraform's metadata-only `data "aws_secretsmanager_secret" "turnstile_secret"` resolve the ARN. **`GetResourcePolicy` was missed in the initial v10 statement and broke `deploy-ffm`'s first CI run** (`AccessDeniedException` on `secretsmanager:GetResourcePolicy` while reading the data source) — the data source apparently calls this in addition to `DescribeSecret`/`ListTagsForResource`, same as the JWT secret's provider read-back already needed it (see `FfmJwtSecretManage`, which already had it from the start). Deliberately still **no** `GetSecretValue` here — the CI principal never needs to read the actual secret value, only the Lambda role does (via `secret_arns` in `module.api`, a separate, already-covered grant).
- `FfmSesConfigurationSetManage` (added 2026-09-05 for the SES bounce/complaint/volume alarms) — `ses:CreateConfigurationSet`/`DeleteConfigurationSet`/`DescribeConfigurationSet`/`CreateConfigurationSetEventDestination`/`UpdateConfigurationSetEventDestination`/`DeleteConfigurationSetEventDestination` on `Resource: "*"` (same SES v1 no-ARN-scoping limitation as `FfmSesManage`).
- `FfmAlertsSnsManage` / `FfmAlertsCloudWatchAlarms` (added 2026-09-05, same rollout) — SNS topic/subscription management scoped to `arn:...:sns:eu-central-1:113725432218:ffm-alerts`, and CloudWatch alarm management scoped to `arn:...:cloudwatch:eu-central-1:113725432218:alarm:ffm-ses-*`.
- **v12 (2026-09-06, `email_forwarding` module for `info@derschweigert.de`):** `S3ReadOnly`/`S3Manage`'s four separate `derschweigert-terraform-state`/`derschweigert-site-*` resource entries were consolidated into a single `arn:aws:s3:::derschweigert-*` (+ `/*`) wildcard — both to fit the new `derschweigert-de-ses-incoming` bucket under the existing statements without adding entries (the policy document was already close to IAM's 6,144-character customer-managed-policy size cap) and because "derschweigert-" is already this account's real bucket-naming convention. `S3Manage` gained `s3:PutLifecycleConfiguration`. `IamRoleForLambda` and `LambdaManage` each gained one resource ARN for the new `derschweigert-de-ses-forwarder-role`/`derschweigert-de-ses-forwarder` function. A new `FfmSesReceiptManage` statement grants `ses:*Receipt*` on `Resource: "*"` (SES receipt-rule-set/rule/active-rule-set APIs, like the other SES v1 identity APIs above, don't support resource-level ARN scoping) — deliberately a substring wildcard rather than enumerating all ~9 individual `Create`/`Delete`/`Describe`/`List`/`Set`/`Reorder`-prefixed action names, again to stay under the size cap. Freed a version slot by deleting `v7`.

Freeing a version slot (the policy sits at the 5-version cap) was done by deleting the then-oldest version each time — `v4` before pushing `v9`, then `v5` before pushing `v10`, then `v7` before pushing `v12`, then `v8` before pushing `v13`, `v11` before pushing `v16`, and `v12` before pushing `v17`.

- **v13 (2026-10-16, log-group retention import + daily retention-cleanup EventBridge rule):** `infra/terraform/modules/api_backend/main.tf` now also manages `aws_cloudwatch_log_group.api` (`/aws/lambda/<app_name>-api`, 30-day retention) for both `ffm-api` and `derschweigert-api`, imported via each site's top-level `import` block rather than created fresh (both groups were already auto-created by Lambda on first invoke). This needed a new `ApiLambdaLogGroups` statement — `logs:*LogGroup*`/`logs:PutRetentionPolicy`/`logs:*Tag*` scoped to `arn:aws:logs:eu-central-1:113725432218:log-group:/aws/lambda/*-api:*` (substring/prefix wildcards covering `Create`/`Delete`/`Describe`LogGroup(s) and `Tag`/`Untag`/`ListTagsFor`Resource respectively, needed for both the `import` refresh and ordinary apply). `infra/terraform/sites/ffm/main.tf` also adds `aws_cloudwatch_event_rule.retention_cleanup` + `aws_cloudwatch_event_target.retention_cleanup` + `aws_lambda_permission.retention_cleanup`, wiring a daily EventBridge trigger straight to the existing `ffm-api` Lambda (see "Data retention" above) — `lambda:AddPermission` was already covered by the existing `LambdaManage` statement's `ffm-api` resource entry, but a new `FfmRetentionRule` statement was needed for `events:*Rule`/`events:*Target*`/`events:*Tag*` scoped to `arn:aws:events:eu-central-1:113725432218:rule/ffm-retention-cleanup`. Adding these two statements verbatim would have pushed the document past the 6,144-character cap, so this version also shortened several existing statements' `Sid`s (purely cosmetic, e.g. `GitHubContactSecretMetadata` → `GitHubContactSecret`, `IamRoleForLambda` → `IamLambdaRole`; no `Action`/`Resource`/`Effect` changed) and consolidated the `secretsmanager:{List,Un}?Tag*Resource`/`dynamodb:{List,Un}?Tag*Resource` triples already present in `GitHubContactSecret`/`FfmJwtSecret`/`FfmDynamoDb` into the same `*Tag*` substring-wildcard pattern already used by `FfmSesReceiptManage`. No existing grant was narrowed, widened beyond the same action set, or removed — same permissions, more compact syntax. **This policy update has been applied and verified** (`aws iam get-policy` confirms `DefaultVersionId: v13`); it is a prerequisite for this session's `terraform apply`, not a substitute for it.
- **v16 (2026-10-19, `lesen.derschweigert.de` static site):** corrected the CloudFront Origin Access Identity action names to `cloudfront:*CloudFrontOriginAccessIdentity`, replacing the outdated `CreateOriginAccessIdentity`/`UpdateOriginAccessIdentity`/`DeleteOriginAccessIdentity` entries. The action was verified with the IAM policy simulator for OAI create/update/delete. The site bucket uses the `derschweigert-lesen-site-*` prefix so it remains within the existing `derschweigert-*` S3 resource scope; no broader S3 permissions were added. Removed the oldest non-default version (`v11`) to make room under IAM's five-version limit.
- **v17 (2026-10-19, `lesen.derschweigert.de` static site):** added `s3:PutBucketTagging` to the existing `S3Mgr` scope after Terraform was denied while applying the site's bucket tags. The resource remains limited to the existing `derschweigert-*` S3 bucket/object ARNs. Removed the oldest non-default version (`v12`) to make room under IAM's five-version limit.

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
- **Static assets had a 1-year browser cache with no cache-busting, until 2026-09-06.** `.github/workflows/deploy.yml`'s "Sync static assets to S3" step used to set `Cache-Control: public, max-age=31536000` on every file except `index.html` (which is `no-cache, no-store, must-revalidate`). Filenames aren't content-hashed, so any browser that had visited before a given deploy kept serving its stale cached `styles.css`/`main.js`/etc. for up to a year, mismatched against the freshly-deployed `index.html` — this broke the desktop splash-screen layout in production after the 2026-09-06 legal-pages deploy (a visitor's browser paired month-old CSS with brand-new markup) until they did a full cache-clearing hard reload; a CloudFront cache invalidation on deploy does **not** clear individual visitors' own browser caches. Fixed by changing that step's `--cache-control` to `no-cache, must-revalidate` (still cacheable, but forces a conditional ETag revalidation on every load instead of trusting a year-old copy). If this ever needs real long-lived caching back for performance, do it properly via content-hashed filenames (e.g. `main.abc123.js`) referenced from `index.html`, not a long `max-age` on unhashed paths.

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

### Billing and Stripe integration (pre-launch)

**Status:** Backend, private level delivery, billing UI and infrastructure are implemented. Payment processing and access enforcement are **disabled by default** and are not yet live. Automated and simulated-browser checks do not replace Stripe sandbox testing.

**Legal and tax launch approval was provided by the operator on 2026-10-15.
Deployment and paid-billing activation still require separate explicit approval.**

Configuration:

- `infra/terraform/sites/ffm/variables.tf` — boolean flags (`access_control_enabled`, `billing_enabled`, `billing_sales_enabled`, `billing_terms_approved`), fixed `grandfather_cutoff`, and Stripe IDs (`stripe_price_id`, `stripe_portal_configuration_id`)
- `infra/terraform/sites/ffm/main.tf` — optional secret ARN variables (`stripe_secret_key_arn`, `stripe_webhook_secret_arn`) and conditional IAM policy for Secrets Manager access
- `sites/ffm/lambda/handler.py` — generic secret resolution helpers that populate `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` environment variables from Secrets Manager ARNs before the Flask app imports

**Creating a Stripe TEST product (for local testing):**

1. Log in to your Stripe TEST dashboard (https://dashboard.stripe.com/test/products)
2. Create a new product:
   - Name: "Arithmo Slayer Premium"
   - Type: Standard
3. Create a price for 3-month billing:
   - Recurring: Yes
   - Billing period: Every 3 months
   - Currency: EUR
   - Amount: €3.00 (final customer price; determine tax obligations before launch)
   - Tax behavior: "Inclusive of tax" (so €3.00 is the final price)
4. Copy the **Price ID** (e.g., `price_1234567890ABC`) and set it in `stripe_price_id` variable
5. **DO NOT PROCEED TO LIVE** until sandbox tests and legal/compliance review are complete.

**Webhook configuration (TEST mode):**

- Stripe webhook endpoint: `/api/billing/webhook` on an explicitly configured sandbox backend. Do not point test payments at the production game.
- Pinned webhook API version: `2024-06-20` (configurable in Stripe dashboard per endpoint)
- Subscription/invoice reads use `2024-06-20`. Checkout creation uses
  `2025-03-31.basil` to explicitly disable Managed Payments and preserve standard
  Payments + Billing (operator as merchant of record), regardless of dashboard
  defaults. Newer invoice webhook formats are re-fetched in the pinned read
  format before processing.
  **Decision (2026-10-15):** the operator selected standard Stripe Payments +
  Billing and will handle taxes. The earlier Managed Payments migration proposal
  is withdrawn; keep `managed_payments` explicitly `False`. The implementation
  has been sandbox-tested. Legal/tax approval was provided by the operator on
  2026-10-15; production configuration and explicit activation approval remain
  required before launch.
- Events to configure: `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`, `invoice.payment_succeeded`, `invoice.payment_failed`, `charge.refunded`, `charge.dispute.created`, `charge.dispute.closed`
- Copy the **Signing Secret** and store it in AWS Secrets Manager:
  ```bash
  aws secretsmanager create-secret --name ffm/stripe-webhook-secret --secret-string "$WEBHOOK_SIGNING_SECRET" --region eu-central-1
  ```
- Set the secret ARN in `stripe_webhook_secret_arn` variable

**Portal configuration (TEST mode):**

- Stripe customer portal allows self-service cancellation and payment method updates
- Create a configuration in Stripe TEST dashboard (https://dashboard.stripe.com/test/settings/billing/portal)
- **Important:** Configure portal to allow **cancellation only** — disable subscription upgrades/downgrades to avoid complexity during pre-launch
- Copy the **Configuration ID** (e.g., `bpc_1234567890ABC`) and set it in `stripe_portal_configuration_id` variable

**Isolated local sandbox:**

The development runner uses Moto (from the existing dev requirements) for in-memory
AWS data and real Stripe **test** requests. It rejects live secret keys, binds only
to localhost, and never serves the private curriculum as static files.

In one terminal, authenticate the Stripe CLI to the selected sandbox and keep forwarding running:

```bash
stripe login
stripe listen --events checkout.session.completed,customer.subscription.created,customer.subscription.updated,customer.subscription.deleted,invoice.paid,invoice.payment_succeeded,invoice.payment_failed,charge.refunded,charge.dispute.created,charge.dispute.closed --forward-to http://127.0.0.1:8766/api/billing/webhook
```

In a second terminal at the repository root:

```bash
PYTHONPATH=. .venv/bin/python sites/ffm/scripts/run-stripe-sandbox.py --price-id <test_price_id> --portal-id <test_portal_configuration_id>
```

Enter the test secret key and the listener's webhook signing secret only at the
hidden terminal prompts, never in chat, source files, or command-line arguments.
The runner prints local login details and three single-use access codes.
Open a fresh browser tab at `http://127.0.0.1:8766/`; do not reuse a page containing
the earlier simulated fetch hooks. The `sandbox-founder` account has pre-cutoff
access; `sandbox-player` and `sandbox-gift` start without premium access.
Use `sandbox-gift` for no-card redemption checks independently of the paying
account. No real email is sent.
Only this local runner disables Stripe's additional hosted terms checkbox because
the terms are not yet publicly deployed at a production URL. The game's age/terms
consent remains mandatory. Production retains hosted terms consent and requires the
operator-approved public terms URL (see "Legal/tax approval status" above; operator
sign-off, not qualified-counsel certification) in Stripe's public business details.

**Replaying one exact sandbox event:**

`sites/ffm/scripts/replay-stripe-sandbox-event.py` re-delivers a single, specific
TEST-mode event (fetched read-only from Stripe by id) to the sandbox runner
above, to reproduce or rule out a webhook outcome (e.g. an isolated 503) under
controlled, single-event conditions. It is a diagnostic aid only: replaying an
event does not by itself identify the root cause of a given response — that
still comes from what the sandbox runner logs while the replay runs. It never
makes an AWS call, a live-mode Stripe call, or a request to any host other
than the fixed sandbox address below; it is not a substitute for the real
`stripe listen` forwarding path.

With the sandbox runner from the previous section still running (so
`http://127.0.0.1:8766/api/billing/webhook` — the **local sandbox**, never the
production `https://ffm.derschweigert.de/api/billing/webhook` — is listening),
run in a third terminal at the repository root:

```bash
PYTHONPATH=. .venv/bin/python sites/ffm/scripts/replay-stripe-sandbox-event.py --event-id evt_1UQnPsDYFrEur0X906nvAXLq
```

Enter the TEST secret key (`sk_test_`/`rk_test_` only) and the same `stripe
listen` signing secret (`whsec_...`) used above only at the hidden terminal
prompts, never in chat, source files, or command-line arguments. The script:

- Fetches only the requested event id, read-only, pinned to API version
  `2024-06-20`, and requires `livemode` to be exactly `False` and the event's
  `type` to be one of the events listed above — anything else stops before any
  POST is attempted.
- Signs the fetched event with a fresh timestamp and POSTs it once to the
  fixed local sandbox address only, with redirects disabled.
- Retries only a `503 billing_retry_required` response (the sandbox's own
  transient-lock/version-conflict signal), up to 3 attempts with a short fixed
  delay; any other response, including a different 503, is reported once and
  is never retried or assumed to be a silent success.
- Prints only the HTTP status code and the sandbox's own short error code —
  never the full response body, the event payload, or either secret.

A non-zero exit status, or any printed error, means the replay did not
confirm success; check the sandbox runner's own terminal output for what it
actually logged while handling that replay.

Local data resets on shutdown, but Stripe sandbox subscriptions do not. Cancel
the test subscriptions before stopping the server. Restarting starts a new local
dataset. To reconnect a known test subscription after a restart, add
`--resume-subscription <test_subscription_id>`; the runner restores its game UUID
mapping to `sandbox-player` and revalidates payment facts against Stripe.
Gift-code grants are local data and are not recovered by this option, so do not
restart in the middle of gift validation.
For a no-network runner check, supply `--offline-check` instead of secrets.

**LIVE Stripe + AWS provisioning (`sites/ffm/scripts/setup-stripe-live.py`):**

A separate, interactive-only script for the Phase 3 step of pinning the LIVE
webhook endpoint and storing the two production secrets. It is not the sandbox
runner above: it makes real live-mode Stripe API calls and real AWS writes, and
must be run by a human watching the terminal, never from CI or any
non-interactive context.

What it does, strictly in this order:

1. Read-only checks, no writes yet: confirms the local AWS credentials resolve
   to account `113725432218` in `eu-central-1`; confirms neither
   `ffm/stripe-secret-key` nor `ffm/stripe-webhook-secret` already exist in
   Secrets Manager (stops with explicit guidance instead of overwriting them
   if either does).
2. Prompts for the LIVE secret key at a hidden terminal prompt (`getpass`) —
   refuses to run at all if stdin/stdout aren't a real terminal, rather than
   letting the key echo in plain text. Rejects anything without the exact
   `sk_live_` prefix.
3. More read-only checks using that key: the given `--price-id` is live,
   active, EUR 3.00, recurring every 3 months, `tax_behavior=inclusive`; the
   given `--portal-id` is live, active, allows cancellation
   (end-of-period) and payment-method updates with subscription
   upgrades/downgrades disabled; and no existing webhook endpoint already
   targets the production URL (stops instead of creating a duplicate).
4. Prints a summary (IDs/status only — never secret values) and requires you
   to type an exact confirmation phrase before any write happens.
5. Creates `ffm/stripe-secret-key` in Secrets Manager (plain `SecretString`,
   not JSON-wrapped).
6. Creates the LIVE webhook endpoint for `https://ffm.derschweigert.de/api/billing/webhook`,
   pinned to `api_version` `2024-06-20`, subscribed to the same 10 events
   listed above, then immediately disables it (the Stripe API has no
   create-already-disabled option) — it stays disabled until the payments
   backend billing configuration is enabled and verified; nothing in the script
   re-enables it.
7. Creates `ffm/stripe-webhook-secret` from the signing secret Stripe returns
   only at endpoint-creation time.

Run from the repository root:

```bash
AWS_DEFAULT_REGION=eu-central-1 .venv/bin/python sites/ffm/scripts/setup-stripe-live.py --price-id price_1UQkljDYFrEur0X9y18ekslo --portal-id bpc_1UQkquDYFrEur0X9JdDK6pAG
```

Enter the LIVE secret key only at the hidden prompt, never as a CLI argument,
environment variable, or in chat/source files. The script never echoes the
secret key, the webhook signing secret, or any raw Stripe/AWS response —
only non-secret IDs/ARNs/status are printed. If any read-only check fails, or
the typed confirmation doesn't match exactly, it exits non-zero without
writing anything. If a write step fails partway through (e.g. AWS secret
created but the Stripe endpoint create fails), it reports the exact
already-created residue (ARNs/IDs) and remediation guidance on stderr and
exits non-zero; it never deletes resources automatically and never reports
success unless every step actually completed.

This script does **not** touch the repository, Terraform variables, or any
deployment — it only prints the two resulting ARNs and tells you to wire them
into `stripe_secret_key_arn`/`stripe_webhook_secret_arn` yourself when you are
ready to deploy (see "Billing and Stripe integration" configuration list
above). Targeted tests: `SECRET_KEY=ci-test-key pytest sites/ffm/tests/test_setup_stripe_live.py -q`
(all Stripe/AWS/terminal interaction is mocked; it never makes a real call).

**Legal/tax approval status (2026-10-15):** The operator (Urs Schweigert) provided approval for
`sites/ffm/static/terms.html`/`terms.en.html` and the billing/payment sections of
`sites/ffm/static/datenschutz.html`/`datenschutz.en.html`, and separately approved the tax
approach described above (operator as merchant/seller of record under standard Stripe
Payments + Billing). This is operator-provided approval, not a certification by
independently retained qualified legal or tax counsel. It is accepted as the project's
legal and tax launch sign-off; the historical review questions below are retained for
traceability, not as additional approval gates. No VAT rate, tax classification,
invoicing procedure or statutory retention duration was supplied with that approval.
These details must not be invented or inferred from it. Core billing is authorized
for Phase 3 deployment, but sales and access enforcement remain disabled;
the actual paid launch stays pending further configuration (including
setting `grandfather_cutoff`) and a separate, explicit launch approval.

**Sandbox test results (recorded 2026-10-15 from the preceding session):** Using the isolated local sandbox runner described
above against a Stripe TEST backend, the following were exercised and worked as expected:
checkout for the €3.00 / 3-calendar-month recurring price; gift-code stacking and renewal
postponement; the cancellation flow preserving access through the end of the already-paid
period; no-card gift-code redemption independent of a paying account (`sandbox-gift`); and
the Stripe customer portal (cancel-only configuration). These are functional/sandbox
verifications, not legal or tax determinations. Full webhook-event and refund coverage
has not been established by these browser checks.

**Production readiness checks (2026-10-15, sales still closed):**

- Live Phase 3 deployment: commit `0d3f0ac`, workflow run `38720608124`.
  Core billing and terms approval are enabled; sales and access enforcement
  are disabled, with no grandfather cutoff. The live webhook is enabled.
  Invalid signatures returned HTTP 400; a signed, non-mutating readiness
  probe returned HTTP 200. This probe is not a Stripe-originated event.
- The operator confirmed registration, inbox verification, login, account
  panel access, password-reset email and login with the new password for
  the `FFMPrelaunch2026` test account. Checkout remained unavailable.
- Public cancellation request `16019a4a-1308-45bd-9318-f228aac1ab9a` was
  durably submitted (HTTP 201) and replayed idempotently (HTTP 200, same ID).
  The operator processing path recorded `no_subscription`; acknowledgement
  email state was `sent`, and the operator confirmed receipt and correct
  wording. No paid subscription was created or canceled by this check.
  The labeled account/request remain as test evidence.
- Urs Schweigert accepted responsibility for daily queue review, identity
  verification, processing, outcome emails and failed-send retries. This
  routine remains manual, not scheduled by the application.
- Added mocked regression coverage for charge refunds, partial refunds,
  dispute creation/closure, replay and preservation of other valid paid
  periods. These tests do not establish real Stripe event semantics.
  Won-dispute recovery now fetches the actual dispute outcomes rather than
  treating the Charge's historical `disputed` flag as a permanent denial.
  All disputes for a disputed charge must be won before its otherwise-valid
  payment counts again.
- Stripe-originated live webhook delivery remains outstanding. Standalone
  `stripe trigger charge.*` fixtures are insufficient for entitlement checks
  because they do not represent the game's subscription invoice/period.
- Subsequent subscription-linked sandbox full-refund check: the operator
  confirmed refunding the EUR 3 payment, `charge.refunded` delivery with
  HTTP 200, and removal of premium access. This is operator-observed
  sandbox evidence, not a production refund.
- The accepted/lost sandbox dispute closure and immediate subscription
  cancellation each returned HTTP 200, with no premium access afterward.
  A later won-dispute subscription was resumed with the corrected backend;
  the operator confirmed the billing panel changed to "Zugriff bis" with the
  paid-period end. This verifies status-based entitlement recovery, not an
  independent level-3 playthrough or successful closure-event delivery.
- The original dispute-created delivery returned HTTP 503. Other events'
  HTTP 200 responses do not establish its retry success; root cause and
  exact-event recovery remain unconfirmed. Retry diagnostics and an isolated
  test-event replay helper were added. A later expired Stripe CLI OAuth token
  interrupted forwarding separately and is not evidence of a production-key
  failure.
- Local fixes also cover checkout after a terminal subscription, stale
  historical events overwriting a replacement subscription, missing portal
  configuration/HTML errors, duplicate title-screen logout controls, and
  stopping music when level access is denied. These changes require a
  separate reviewed release; they are not part of the Phase 3 baseline above.

**Pre-launch checklist:**

- [x] Legal launch sign-off for `sites/ffm/static/terms.html` (German) and `terms.en.html` (English) — operator-provided approval 2026-10-15 (see "Legal/tax approval status" above; not qualified-counsel certification)
- [x] Legal launch sign-off for billing/payment sections in `sites/ffm/static/datenschutz.html` and `datenschutz.en.html` — operator-provided approval 2026-10-15 (see "Legal/tax approval status" above; not qualified-counsel certification)
- [x] Tax launch sign-off — operator-provided approval 2026-10-15; specific VAT/invoicing configuration was not supplied
- [ ] Set the fixed `grandfather_cutoff` timestamp once, in UTC, immediately before the actual paid launch (not a rolling/moving date, not set far in advance) — accounts registered before this timestamp get free access while the service operates
- [ ] Validate implemented `/api/billing/status`, `/checkout`, `/portal`, `/cancel`, `/redeem`, `/recover`, `/webhook` and gated `/api/levels/<level>` against a sandbox backend
- [ ] Test the Stripe webhook events actually configured above (`checkout.session.completed`, `customer.subscription.*`, `invoice.paid`/`invoice.payment_succeeded`/`invoice.payment_failed`, `charge.refunded`, `charge.dispute.*`) in TEST mode
- [x] Manual sandbox testing of checkout, cancellation preserving access, gift-code redemption and the portal — see "Sandbox test results" above
- [ ] Complete refund and dispute webhook scenarios in an isolated sandbox; do not mark these covered by checkout/cancellation checks alone
- [ ] Email verification required for account before paid features can be purchased
- [ ] Ensure billing address collection (collected by Stripe at checkout, not stored as a game-account profile field) matches tax/legal requirements
- [ ] Confirm Stripe TEST and LIVE keys are separate and never mixed
- [ ] Do NOT request payment card details via chat/email — Stripe handles all PII

**Historical legal/tax review questions (operator launch sign-off recorded above):**

- **Login-free cancellation:** The public form records a durable request without login or mandatory email verification. An operator reviews identity and processes cancellation through the CLI; it never auto-cancels from emailed claims alone. The operator accepted this design for launch. This repository does not independently determine statutory compliance, including BGB §312k.
- **Withdrawal rights and consent:** The operator provided legal approval for the present disclosures and flow. No independent determination of service classification, withdrawal rights or waiver requirements is asserted.
- **Automatic renewal:** The approved implementation uses a three-calendar-month recurring subscription, with cancellation stopping future renewals while preserving paid/gifted access. No independent legal conclusion about renewal restrictions is asserted.
- **Closure, refunds and retention:** The operator approved the current approach. Exact notice procedures and retention durations are not supplied by this approval and must not be invented in configuration or public disclosures.
- **Tax and invoicing:** Standard Stripe Payments + Billing is selected, with the operator responsible for applicable taxes and invoicing. The operator supplied tax approval on 2026-10-15. This does not specify a VAT rate, tax status or invoicing configuration. Stripe Managed Payments migration is no longer planned.

The approval record reflects the operator's instructions; it does not claim independent
legal analysis or tax certification. Remaining release gates are technical configuration,
operational readiness and separate deployment/paid-activation authorization.

**Phase 1 release preparation (2026-10-15):**

- Automated validation: 218 FFM Python tests and 176 frontend tests passed.
  Local Python 3.9 emits Boto3 support-deprecation warnings; production uses Python 3.12.
- FFM Terraform formatting/validation and `git diff --check` passed.
- Required new sources include billing/access/cancellation modules and tests, the private
  `app/level_data.json` curriculum, localization modules, and public legal/cancellation pages.
  Include the relocated `dev-tools/level-fiend-allocator.*` files alongside their old-path
  deletions. Local build directories, virtual environments, secrets and Terraform state
  are not release sources.
- Static deployment excludes JS tests and named development HTML pages. The private
  curriculum stays in the Lambda package; `dev-tools/` is outside the static upload root.
  Read-only release hygiene checks found no literal credentials or accidentally included
  local artifacts in the candidate sources. This is not a comprehensive security audit.
- Rollback baseline: commit `2513b536320ef9b6ea2d15cf939a07dcfc5d89eb`, deployed successfully
  by [workflow run 35604398709](https://github.com/UrsSchweigert/DerSchweigert/actions/runs/35604398709)
  on 2026-09-21. Read-only Lambda inspection on 2026-10-15 confirmed `ffm-api` is active
  on Python 3.12, with no access/billing flags, cutoff, Stripe IDs or Stripe secret ARNs
  configured. A non-secret baseline snapshot is stored in the preparing session's artifacts.
- Phase 2 must keep access enforcement, billing and sales disabled. Restore the previous
  code/static release and matching configuration if that deployment fails; do not disable
  email verification or other protections as a rollback shortcut. After paid launch,
  an emergency sales-off action must preserve cancellation, webhook processing and
  existing access rather than reverting to the pre-billing code.
- No commit, push, Terraform apply or production deployment was performed during Phase 1.

**Phase 3 — persistent live-config wiring, preparation only (2026-10-15):**

This phase makes the already-existing Terraform billing/access variables
(`infra/terraform/sites/ffm/variables.tf`) settable from CI without editing
code, so provisioning a real Stripe ID or secret ARN later doesn't need a
source change. **It does not enable billing, access control or sales.** Every
flag defaults to `false`/empty, reproducing the current production
configuration exactly if nothing is set.

Configuration — GitHub repository variables (Settings → Secrets and variables
→ Actions → **Variables** tab, not Secrets; these are non-secret IDs/ARNs/flags
only):

| Repository variable | Maps to Terraform variable | Default if unset |
| --- | --- | --- |
| `FFM_ACCESS_CONTROL_ENABLED` | `access_control_enabled` | `false` |
| `FFM_BILLING_ENABLED` | `billing_enabled` | `false` |
| `FFM_BILLING_SALES_ENABLED` | `billing_sales_enabled` | `false` |
| `FFM_BILLING_TERMS_APPROVED` | `billing_terms_approved` | `false` |
| `FFM_GRANDFATHER_CUTOFF` | `grandfather_cutoff` | `""` (empty) |
| `FFM_STRIPE_PRICE_ID` | `stripe_price_id` | `""` (empty) |
| `FFM_STRIPE_PORTAL_CONFIGURATION_ID` | `stripe_portal_configuration_id` | `""` (empty) |
| `FFM_STRIPE_SECRET_KEY_ARN` | `stripe_secret_key_arn` | `""` (empty) |
| `FFM_STRIPE_WEBHOOK_SECRET_ARN` | `stripe_webhook_secret_arn` | `""` (empty) |

The `deploy-ffm` job in `.github/workflows/deploy.yml` maps each repository
variable to the matching `TF_VAR_*` environment variable with an explicit
`|| 'false'` / `|| ''` fallback, then runs
`infra/terraform/sites/ffm/scripts/preflight-billing-config.sh` immediately
before `terraform apply`. **Actual Stripe secret values (API key, webhook
signing secret) are never stored as repository variables or passed through
this mechanism** — only the AWS Secrets Manager ARN that points at them
(provisioned out-of-band per the "Billing and Stripe integration" section
above: `aws secretsmanager create-secret ...`, then put that secret's ARN,
not its value, into `FFM_STRIPE_SECRET_KEY_ARN`/`FFM_STRIPE_WEBHOOK_SECRET_ARN`).

The preflight guard (`infra/terraform/sites/ffm/scripts/preflight-billing-config.sh`,
covered by `sites/ffm/tests/test_billing_preflight_guard.py`) fails the deploy
before any Terraform state changes if it finds:

- a flag value other than literal `true`/`false` (the error names the
  variable, never the invalid value itself);
- `billing_enabled=true` without all four Stripe IDs/ARNs set — this gate does
  **not** depend on `billing_terms_approved`, so core billing (webhook
  processing, existing-subscription cancellation) keeps working even if terms
  approval is false or gets flipped back to false during an incident;
- `billing_sales_enabled=true` without `billing_enabled=true`,
  `access_control_enabled=true`, `billing_terms_approved=true` **and** a
  non-empty `grandfather_cutoff` — opening new sales is the only thing that
  requires the full approved chain;
- `access_control_enabled=true` without `billing_enabled=true` and a non-empty
  `grandfather_cutoff` (this flag alone gates premium levels — enabling it
  without a way to pay or a cutoff locks out non-grandfathered users), or with
  a `grandfather_cutoff` that isn't a real UTC calendar date/time (parsed
  strictly with Python, not just regex-shape-checked like Terraform's own
  variable validation) or that is in the future;
- a Stripe price/portal ID that is the README's example placeholder or doesn't
  match the expected `price_…`/`bpc_…` shape — but **not** merely for
  containing `test`/`sandbox`/`dev`: these IDs are opaque and don't encode
  live-vs-test mode in their format at all, so a real LIVE id could
  coincidentally contain one of those words, and the guard no longer guesses
  from substrings. Confirm live/test mode directly in the Stripe
  dashboard/API before provisioning;
- a Stripe secret/webhook Secrets Manager ARN that doesn't match the expected
  ARN shape, or whose secret name doesn't match this repo's own documented
  production path (`ffm/stripe-secret-key` / `ffm/stripe-webhook-secret`,
  optionally followed by AWS's random 6-character suffix) — this is a
  precise match against a name *this repo* chose and documents above, not a
  substring scan of the random suffix (which could itself coincidentally
  contain `test`/`dev`).

It does **not** require or invent values when `billing_enabled=false` — IDs and
ARNs may be provisioned and set ahead of activation (that is the point of this
phase) with sales/billing/access still off. The script also never echoes a
raw config value (only variable names and normalized `true`/`false` flags)
into CI's stdout/stderr, in case a value is accidentally pasted into the
wrong (non-secret) variable. It avoids bash indirect-variable-expansion
(`${!name}`) and `eval` entirely — every check is passed its name and value as
explicit arguments.

Because the same deploy workflow gained a `workflow_dispatch` trigger, setting
or changing one of these repository variables can be applied by re-running
"Deploy to production" from the Actions tab against `main`, without needing a
new commit/push. This runs the identical job (tests, preflight guard,
`terraform apply`, Lambda/static deploy, smoke test) — it is not a separate
code path.

**Live preparation and activation (requires configured resources and reviewed
deployment; none of these settings have been applied yet):**

1. Provision the real LIVE Stripe product/price, portal configuration and
   webhook endpoint (see "Billing and Stripe integration" above, but against
   the Stripe **LIVE** dashboard, not TEST), and the LIVE secret key +
   webhook signing secret into their own AWS Secrets Manager secrets
   (`aws secretsmanager create-secret --name ffm/stripe-secret-key ...` /
   `ffm/stripe-webhook-secret`, distinct from any sandbox secret). None of
   this repo's automation creates these — they must exist out-of-band first.
2. Set `FFM_STRIPE_PRICE_ID`, `FFM_STRIPE_PORTAL_CONFIGURATION_ID`,
   `FFM_STRIPE_SECRET_KEY_ARN`, `FFM_STRIPE_WEBHOOK_SECRET_ARN` and
   `FFM_BILLING_TERMS_APPROVED=true`, then set `FFM_BILLING_ENABLED=true`
   (sales still off) and deploy — this exercises checkout-adjacent
   infrastructure (webhook endpoint, secret resolution) while
   `billing_sales_enabled=false` keeps `can_checkout` false for everyone.
Steps 1–2 are Phase 3 preparation: checkout and access enforcement stay off.

Phase 4 requires separate paid-launch authorization. Only after preparation
is deployed and verified, set the fixed `FFM_GRANDFATHER_CUTOFF` once,
immediately before launch (not in advance — see the pre-launch checklist
above), and set `FFM_ACCESS_CONTROL_ENABLED=true` and
`FFM_BILLING_SALES_ENABLED=true` together for the same deploy. This avoids
an intermediate state that locks out new users before checkout is available.

**Operational cancellation runbook (reference — see "Operator commands and
recovery" below for the full commands):**

1. Set `FFM_BILLING_SALES_ENABLED=false` (closes new checkout; existing
   subscriptions, cancellation, webhook processing and access all keep
   working) and deploy.
2. Notify existing subscribers and arrange unused-time refunds per the
   reviewed terms and statutory rights.
3. Run `billing-admin shutdown --confirm` against the production environment
   to cancel subscriptions for the configured price (verifies cancellation;
   does not itself send notices or issue refunds).
4. Process any still-open public cancellation requests
   (`billing-admin cancel-request`, see below) manually as usual.

**Sales-off rollback (emergency, preserves webhook/cancel/access):** set
`FFM_BILLING_SALES_ENABLED=false` and redeploy. This is the single-flag,
lowest-risk rollback: `billing_enabled` stays `true` so the webhook endpoint
keeps processing Stripe events and the authenticated/public cancellation
flows keep working, and `can_checkout` becomes `false` immediately (see
`sites/ffm/app/entitlements.py`), closing new signups without touching
`access_control_enabled` or any already-granted access. Only fall back to
`FFM_BILLING_ENABLED=false` if sales-off alone does not contain an incident;
this stops billing handlers, but Lambda still resolves any configured Stripe
secret ARNs at cold start. An unavailable secret requires repairing its
access/value or explicitly clearing its repository ARN variable and redeploying;
the billing flag alone does not bypass secret resolution. Do not disable
`access_control_enabled` as a cancellation shortcut, since that would grant
free premium access to everyone rather than closing sales.

The initial local preparation made no production changes. On 2026-10-15 the
operator subsequently authorized deploying Phase 3 with live Stripe IDs and
secret ARNs, `FFM_BILLING_ENABLED=true` and `FFM_BILLING_TERMS_APPROVED=true`.
`FFM_ACCESS_CONTROL_ENABLED` and `FFM_BILLING_SALES_ENABLED` stay `false`;
`FFM_GRANDFATHER_CUTOFF` stays empty. Enable the prepared webhook only after
the deployed backend and signature verification are confirmed ready.

**Operator commands and recovery:**

Run against the deliberately selected environment with its AWS credentials, table names,
JWT secret, Stripe configuration and launch flags already set. Never use production
credentials for sandbox tests.

```bash
python -m flask --app sites.ffm.app:create_app billing-admin create-code
python -m flask --app sites.ffm.app:create_app billing-admin create-code --expires-at 2027-01-01T00:00:00Z
python -m flask --app sites.ffm.app:create_app billing-admin revoke-code <code_hash>
python -m flask --app sites.ffm.app:create_app billing-admin reconcile --confirm
```

Codes grant three calendar months, stack, and do not create subscriptions. Store/distribute
the returned plaintext code securely; the database retains only its hash. Paid subscribers'
renewal is postponed to the end of their gifted access. A failed grant can be recovered
without the original code via the Billing retry button or operator reconciliation.
Schedule reconciliation and monitor failures; investigate nonzero exits rather than
assuming webhook delivery succeeded.

For closure, first disable sales and deploy that change, notify subscribers and arrange
unused-time refunds according to reviewed terms and statutory rights. Then run
`python -m flask --app sites.ffm.app:create_app billing-admin shutdown --confirm`.
This command cancels subscriptions for the configured game price and verifies cancellation;
it does not send notices or issue closure refunds automatically.

The private curriculum is `app/level_data.json`; never sync it to the public static bucket.
To use the moved allocator locally, serve `sites/ffm/` as the HTTP root and visit
`/dev-tools/level-fiend-allocator.html`. Do not expose that development server publicly.

**Public cancellation requests (login-free intake, manual operator processing):**

`sites/ffm/static/cancel.html` exposes a permanently visible, no-login, no-mandatory-CAPTCHA
public form (two-step: review, then "Kündigung jetzt absenden") that `POST`s to
`/api/cancel-requests` (`app/cancel_requests.py`). This endpoint:

- Never calls Stripe and never looks up/confirms whether any account or email exists (no
  account enumeration) — it only durably stores the submitted fields plus a server UTC
  `submitted_at` timestamp under its own `CANCELREQUEST#<uuid>` DynamoDB partition-key prefix
  (same single table as users/billing state, via `app/cancel_requests_store.py`).
- Requires a client-generated UUID `idempotency_key`: retrying with the exact same key and
  payload durably replays the original receipt (HTTP 200, not a duplicate); retrying the same
  key with *different* details is rejected (HTTP 409 `idempotency_conflict`) rather than
  silently overwritten or silently resubmitted.
- Is rate-limited independently (`CANCEL_REQUEST_RATE_LIMIT`, default `5/minute` per source IP)
  from the auth/email-target limits.
- Strictly validates `requested_date` as ISO 8601 `YYYY-MM-DD` only (rejects German
  `DD.MM.YYYY` and invalid calendar dates) and requires at least one of `account_email`,
  `username`, or `stripe_reference` so an operator has something to review against — but never
  looks any of them up at submission time.
- Returns a JSON receipt whose `status` is `submitted` (or `needs_review` for a
  `requested_date` submission) and whose `message` explicitly states the request was
  *received*, not that the subscription was canceled.
- Sends **no email automatically** on submission (avoids an anonymous, unauthenticated
  endpoint being used to mail-bomb an arbitrary `contact_email`). The client-side JS lets the
  user download/save the JSON/plaintext receipt immediately instead.

Processing is exclusively manual via `billing-admin cancel-request`:

```bash
python -m flask --app sites.ffm.app:create_app billing-admin cancel-request list
python -m flask --app sites.ffm.app:create_app billing-admin cancel-request list --status submitted
python -m flask --app sites.ffm.app:create_app billing-admin cancel-request show <request_id>
python -m flask --app sites.ffm.app:create_app billing-admin cancel-request show <request_id> --reveal-pii
python -m flask --app sites.ffm.app:create_app billing-admin cancel-request process <request_id> \
  --username <verified_account_username> --confirm-identity-reviewed --confirm
python -m flask --app sites.ffm.app:create_app billing-admin cancel-request record-manual-outcome <request_id> \
  --username <verified_account_username> --confirm-identity-reviewed \
  --outcome fulfilled --effective-date 2025-01-31 --provider-reference <stripe_sub_or_note> --confirm
python -m flask --app sites.ffm.app:create_app billing-admin cancel-request complete-email <request_id> --confirm
```

- `list` prints only `request_id`/`status`/`cancellation_type`/`requested_date`/`submitted_at`
  by default — no emails/username/reason, so routine operator listing doesn't dump PII into
  shell history or logs. `show --reveal-pii` is the explicit, single-request opt-in to see
  contact/account email, username, Stripe reference and the free-text reason.
- `process` is the only code path allowed to call `billing.cancel_future_renewals()` — the
  **same shared primitive** the authenticated in-app `/api/billing/cancel` button calls — on
  behalf of a public request. It requires an operator to pass the **exact username** they have
  manually verified belongs to the requester (never derived automatically from the
  requester-supplied `account_email`), plus both `--confirm-identity-reviewed` (a human
  attestation) and `--confirm` (execute). The identity is bound durably and immutably to the
  request on first successful bind (conditional DynamoDB write); re-running with a *different*
  username afterwards is rejected.
- It recovers any pending gift redemption first (so a gift grant is never lost), resolves the
  account's immutable `stable_id` fresh via `ensure_stable_id(username)` at process time (so a
  request referencing a since-deleted-and-recreated username attaches to the **current**
  account, never a stale/old identity's subscription), and reports one of the typed outcomes:
  `fulfilled` (a live subscription was actually canceled — paid-until/gift access is
  preserved to its existing end), or `no_subscription` (verified account had no live
  subscription at process time — this is reported honestly rather than ever being claimed as
  a successful cancellation of something that didn't exist).
- `requested_date` submissions are **never** auto-processed against the requested date by
  `process` — it always refuses (`status` stays `needs_review`) and never silently claims a
  specific date was honored, because this flow adds **no automatic date scheduling**. Instead,
  once an operator has manually completed the cancellation out of band (e.g. via the Stripe
  dashboard/portal, honoring — or explicitly not honoring — the requester's preferred date),
  they must run `record-manual-outcome` to durably record what was *actually* done. This
  command never calls Stripe itself; it only requires `--confirm-identity-reviewed` (the same
  human-identity attestation as `process`), an `--outcome` (`fulfilled` or `no_subscription`),
  and — for `fulfilled` — a required `--effective-date` plus optional `--provider-reference`
  and free-text `--note`, so the recorded outcome and acknowledgement email state the actual
  confirmed date/reference an operator attests to, never a guaranteed match to the requester's
  originally *requested* date. Like `process`, the reviewed identity/subscription snapshot is
  bound immutably on first successful bind; rebinding to a different username is rejected.
- The request's `status` only advances to a terminal state (`fulfilled`/`no_subscription`)
  *after* `cancel_future_renewals()` has itself durably recorded its result in
  `billing_store` — never before, and never on a Stripe-call failure. A Stripe/provider
  failure leaves the request `processing` with no outcome recorded; rerunning the exact same
  `process` command (same request id, same username) retries safely.
- `complete-email` is a **separate, explicit, always-manual** step (never automatic) that sends
  a plain-text outcome acknowledgement to the requester's `contact_email` only after `process`
  or `record-manual-outcome` has recorded a terminal outcome. Delivery state
  (`ack_email_status`/`ack_email_error`) is durable and independently retryable: a send failure
  is recorded as a sanitized exception class/code only (never the raw provider error text,
  which can embed PII such as the destination address) and is never silently swallowed; simply
  re-running `complete-email` retries the send. If an email was already sent, re-running
  `complete-email` without `--resend` is a no-op (prints a skip message) so a routine re-run
  never sends a redundant duplicate acknowledgement; pass `--resend` to explicitly resend.
- There is no background worker or scheduled job anywhere in this flow — an operator must run
  these commands. If the process crashes between `cancel_future_renewals()` succeeding and the
  request's own status write, `cancel_future_renewals()`'s own idempotent Stripe
  `cancel_at_period_end` update is safe to re-issue; rerun `process` to reconcile. On any retry,
  `process`/`record-manual-outcome` act only on the **same subscription snapshot** that was
  bound to the request on its first successful bind (even if that snapshot was `None`); if the
  account's current subscription no longer matches that bound snapshot (e.g. a replacement
  subscription was created in the interim), the command refuses with a manual-review error
  instead of ever canceling a different, newer subscription than the one originally reviewed.
- **Operator queue cadence:** this flow has no automatic processing, so outstanding
  `submitted`/`needs_review` requests only advance when an operator runs `list`/`show` and then
  `process`/`record-manual-outcome` against them. Define and follow an internal SLA — e.g. a
  **daily** review of `billing-admin cancel-request list --status submitted` and
  `--status needs_review` — and always follow up a terminal outcome with `complete-email` so
  the requester actually receives an outcome acknowledgement; a request that is merely recorded
  but never reviewed or acknowledged is not "processed."
- **Known limitation:** "promptly processed" here means promptly *relative to the operator's
  review cadence*, not automatically at submission time — this flow intentionally does not
  claim the request was honored at the moment of submission, only that the request itself was
  durably recorded then. Define and follow an internal SLA/retention policy for how quickly
  outstanding `submitted`/`needs_review` requests are reviewed.
- **Timely-notice timestamp:** if any legal/consumer-protection timing requirement (e.g. a
  cancellation deadline or notice period) must be evaluated for a given request, use the
  request's **`submitted_at`** timestamp (set once, server-side, at the moment of the original
  public submission) — **never** the later `process`/`record-manual-outcome` timestamp, which
  only reflects when an operator happened to review the queue. This code makes **no legal
  determination or guarantee** about whether any given `submitted_at` satisfies a statutory
  deadline; that is a legal judgment outside this flow's scope (see the BGB §312k caveat above).

### Digital-content checkout declarations, durable contract confirmation, and public withdrawal intake

`sites/ffm/app/legal_texts.py` is the **single source of truth** for all versioned legal text
used by this flow: `DECLARATIONS_VERSION`, `SUPPORTED_LANGUAGES` (`de`/`en`), the two checkout
declaration texts, operator identity/address (sourced from `impressum.html`, never invented),
price/renewal/tax copy, the withdrawal-instructions text, and the canonical `WITHDRAWAL_STATEMENT`.
Any change to this file's text requires updating the duplicated frontend copies it is paired
with (see below) and bumping `DECLARATIONS_VERSION` if the *checkout* declarations themselves
change in substance.

**New-checkout declarations gate (`/api/billing/checkout`, `app/billing.py`):**

- Checkout now requires, in addition to the pre-existing `adult_confirmed`/`terms_accepted`
  fields, **two additional, separately-unchecked** digital-content declarations
  (`immediate_access_confirmed`, `withdrawal_waiver_confirmed`) plus a `declarations_version`
  and `declarations_language` selector. The client never sends free-text declaration wording —
  only version/language selectors — so the durably recorded text always comes from the
  server's own `legal_texts.declarations_snapshot(language)`, never anything client-supplied.
- Missing/false declarations, an unsupported `declarations_language`, or a stale
  `declarations_version` all **reject the checkout before any Stripe call or entitlement
  change** (free-play/other state stays untouched): a stale version is a distinct `409
  declarations_version_mismatch` (not a blanket 400), and a merely-unchecked box is never
  reported or treated as "expired" — see `app/billing.py`'s checkout validation and
  `tests/test_billing.py`'s `_valid_checkout_payload()` helper / negative tests.
- On acceptance, the exact text, version, language, a server UTC timestamp, and the resolved
  account `stable_id` + the specific checkout operation/session are durably and immutably bound
  together (`app/contract_confirmation_store.py`) — a retried checkout with the same payload
  reuses the same record rather than mutating it.
- This gate applies **only to new checkouts**. Existing subscriptions, gift/grandfathered
  access, and renewal invoices are never re-gated or required to re-declare anything — see
  `reconcile_subscription()` in `app/billing.py`, which calls `_ensure_contract_confirmation()`
  exactly once per **new** paid subscription (webhook and the `billing-admin reconcile` CLI
  path both go through this single call site), never on renewal invoices.
- Frontend: `static/index.html`'s checkout modal has the two new required checkboxes with the
  verbatim German legal text; `static/game/i18n.js` carries the DE text + a non-binding EN
  translation plus the new server-error-code translations; `static/game/main.js` has a
  hardcoded `CHECKOUT_DECLARATIONS_VERSION` constant that **must be kept in sync** with
  `legal_texts.DECLARATIONS_VERSION` — a comment there explains that staleness only ever causes
  a safe, explicit server-side `409` rejection, never silent acceptance of an outdated version.

**Durable contract confirmation + email (gates the grant for new checkout contracts only):**

- `app/contract_confirmation_store.py` persists one durable confirmation record per new paid
  subscription, including the operator's contract reference, the applicable price/level/renewal
  terms snapshot, applicable-taxes note, the withdrawal-instructions model text, and the exact
  bound declarations (text/version/language/timestamp) from checkout — **not** a mutable link
  or a mere Stripe receipt reference.
- `app/mailer.py` sends this confirmation via SES exactly once per new subscription, in the
  required order: Stripe payment verified server-side → durable confirmation snapshot
  persisted → SES send accepted → access/entitlement grant (`paid_until`) recorded, and
  (once granted) the actual provisioning instant is durably recorded too
  (`contract_confirmation_store.mark_confirmation_provisioned`). A `(ClientError,
  BotoCoreError)` from SES is **never swallowed**: it is logged via `current_app.logger.error`
  and durably recorded as `email_status='failed'` with an error code, and the entitlement grant
  is **withheld** until a send is accepted — `reconcile_subscription()` raises
  `ValueError('contract_confirmation_pending')`, which the webhook route maps to the existing
  `billing_retry_required`/`503` retry pattern so Stripe redelivers the event (and
  `billing-admin reconcile` likewise reports the identity as requiring retry) until SES
  succeeds. This gating applies **only** to subscriptions created through the current,
  declarations-gated `/checkout` flow (identified by the `checkout_operation` metadata
  `checkout()` attaches); existing legacy subscriptions, renewals, and gift grants that never
  went through it are never gated, never retried here, and never get a fabricated confirmation
  record — they are granted access exactly as before. SES acceptance is **not** proof of inbox
  delivery; `email_status` therefore only ever reflects `sent`/`failed`/`pending`, never a
  delivery guarantee.
- Recovery: `billing-admin contract-confirmation resend-email <stable_id_or_reference>
  --confirm` retries a failed/unsent email without re-running checkout or re-charging anything
  (mirrors the existing `cancel-request complete-email --resend` retry pattern) — it only flips
  the stored email status; the next reconcile attempt (webhook redelivery or `billing-admin
  reconcile`) is what actually performs the grant once it observes `email_status='sent'`.
- Duplicate webhook deliveries are idempotent (same `EVENT#<id>` sentinel-row pattern already
  used elsewhere in `billing.py`) and never create a second confirmation record or send a
  second email for the same subscription event.
- Retention: new-contract-consent evidence (the checkout declarations snapshot and the
  contract-confirmation record) is **held with no automatic deletion**, pending financial/legal
  classification, consistent with the existing retention posture — it is intentionally **not**
  wired into `retention_admin.py`'s purge logic.

**Public withdrawal ("Vertrag widerrufen") intake — a separate flow from cancellation:**

`sites/ffm/static/widerruf.html` exposes a permanently visible, no-login, no-CAPTCHA public form
(two-step: review, then "Widerruf jetzt absenden") that `POST`s to `/api/withdrawal-requests`
(`app/withdrawal_requests.py`/`app/withdrawal_requests_store.py`). This intentionally mirrors
the proven `cancel_requests` pattern (same idempotency-key semantics, no account enumeration,
no Stripe call at submission time, manual-only operator processing) but is **not** the same
flow — it exercises the statutory withdrawal right (§§ 355, 356 BGB), not a mere future-renewal
cancellation, and `widerruf.html`/`cancel.html` cross-link to each other so users land on the
right form:

- The withdrawal statement itself is **never free text** — the client only sends a
  `statement_language` (`de`/`en`) selector plus an explicit `statement_confirmed: true`; the
  durably recorded/emailed text always comes from the server's own canonical
  `legal_texts.WITHDRAWAL_STATEMENT`, identical to what the page displays
  (`static/game/withdrawal-request.js`'s `WITHDRAWAL_STATEMENT` constant must stay in sync).
- Unlike `cancel_requests`, this flow sends an **immediate** plain-text email receipt at
  submission time (not deferred to manual operator action) plus mints a one-time, no-login,
  token-gated downloadable receipt (`GET /api/withdrawal-requests/<id>/receipt?token=...`,
  SHA-256-hashed token, constant-time comparison, identical generic 404 for "wrong token" and
  "not found" so neither response leaks whether a given id/token exists). The receipt token is
  **not re-issued** on an idempotent replay of the same submission — `withdrawal-request.js`'s
  `renderReceipt()` hides the download link in that case, since the one and only opportunity to
  retrieve it was the original submission's response.
- SES failures on the receipt email are recorded (`email_status='failed'`), never swallowed,
  and never block the durable submission record itself from being created.
- Submission only ever durably records **that a declaration was received**, never a legal
  conclusion about whether it was effective — the UI and CLI output both say "Anfrage
  erhalten"/"received", explicitly not "confirmed"/"processed". Identity is **never**
  auto-matched: no cancellation or refund is triggered automatically from an unverified
  submission, and the endpoint never confirms/denies whether a given account/email exists.
- Operator CLI (`billing-admin withdrawal-request ...`, mirroring `cancel-request`'s shape):
  `list`, `show [--reveal-pii]`, `process <id> --username <verified> --confirm-identity-reviewed
  --confirm` (also never auto-cancels/refunds — it only durably records that an operator
  reviewed and bound the identity; actual cancellation/refund is a separate, explicit operator
  action), `record-manual-outcome <id> --outcome {fulfilled|no_match|...}
  --confirm-identity-reviewed` (never calls Stripe itself — records what an operator attests was
  actually done, e.g. via the existing `billing-admin` refund/cancel commands or the Stripe
  dashboard directly, since no dedicated "safe" automated refund helper exists for this flow),
  `complete-email`/`resend-receipt-email --confirm` (retry pattern identical to
  `cancel-request complete-email`), and `legal-hold <id> --set/--lift` (future-proofs retention
  review; no purge logic currently reads this flag).
- **Checkbox-checked is never a blanket rejection reason** — the server rejects only on
  concretely missing/invalid fields (e.g. no identifying info at all, unsupported language,
  `statement_confirmed` not `true`), never simply because a checkbox happened to be checked.
- Withdrawal instructions shown on the page use the operator's real impressum address/email,
  a reasonable standard 14-day notice period, and explicitly preserve statutory
  exceptions/`§ 356a`-style carve-outs where currently applicable — phrased generically rather
  than asserting a specific BGB paragraph number (see Known limitations below).
- **Retention is deliberately NOT wired into `retention_admin.py`'s existing 3-year purge.**
  Withdrawal-request records are a *different* class of evidence than routine cancellation
  requests and are held indefinitely pending an explicit operator/legal retention-policy
  decision (documented in `withdrawal_requests_store.py`'s module docstring); `legal-hold`
  exists to flag records for exclusion from any future purge decision once one is made, but no
  code currently deletes any withdrawal-request record.
- **All three new transactional emails (contract confirmation, withdrawal receipt, withdrawal
  outcome) are sent in the SAME language the purchaser/requester actually selected and had
  durably persisted at the time** (`declarations['language']` for contract confirmation,
  `statement_language` for both withdrawal emails) — never a hardcoded German default and never
  a UI/browser-guessed language independent of that persisted selection. The JSON receipt
  `message` field and the plaintext receipt body (`app/withdrawal_requests.py`'s
  `_RECEIPT_COPY`) are likewise localized to the requester's own selection. An
  unrecognized/missing language value safely falls back to German rather than raising or
  guessing. None of these three emails currently contain any hyperlink to another page (they
  embed the full durable text inline, per the "mutable link is not sufficient evidence"
  requirement), so there is no language-mismatched link target to misroute.

**Tests covering this flow:**

- `tests/test_mailer.py` (new) — unit tests asserting each of the three new email functions
  selects body/subject text matching the persisted language (`de`/`en`), never silently
  defaults to German when a non-German language was actually selected, and still safely falls
  back to German (rather than raising) for a missing/unsupported language value.
- `tests/test_billing.py` — regression-updated for the new required checkout declaration
  fields (`_valid_checkout_payload()` helper); confirms the pre-existing adult/terms rejection
  tests are unaffected.
- `tests/test_contract_confirmation.py` (16 tests) — declaration validation/rejection (missing
  fields, stale version, unsupported language), rejection never touching entitlements/free-play,
  exact text/version/language/timestamp binding and its immutability on retry, confirmation
  creation + SES send exactly once on first paid subscription, duplicate-webhook idempotency,
  renewal invoices never re-triggering confirmation/email, SES failure recorded as `failed` and
  withholding the entitlement grant (retryable `503`) until a later attempt's SES send is
  accepted, `contract-confirmation resend-email` recovery activating the grant on the next
  reconcile without re-charging, legacy subscriptions without `checkout_operation` metadata and
  gift/grandfathered paths unaffected (never gated, never fabricated a confirmation record).
- `tests/test_withdrawal_requests.py` (28 tests) — immediate receipt email + token, no-login/no
  account-enumeration, canonical (non-client-editable) statement text, missing/invalid field
  rejections, idempotent replay (and token omission on replay) vs. conflicting-payload rejection,
  SES failure on the receipt email not swallowed, no-login receipt download (success/wrong
  token/nonexistent id/missing token all behaving correctly), every CLI subcommand (`process`
  requires both confirm flags and never auto-cancels/refunds, `record-manual-outcome` never
  calls Stripe, `complete-email`/`resend-receipt-email` retry semantics reusing the original
  receipt body (statement/status/references/timestamp) verbatim with only the resend notice
  appended, `legal-hold` set/lift).
- `static/game/access-flow.test.js` / `static/game/i18n.test.js` — extended `startCheckout`
  payload shape, exact DE declaration text, distinct `declarations_version_mismatch` vs.
  `digital_content_declarations_required` error copy.
- `static/game/withdrawal-request.test.js` (new) — field validation, secure
  idempotency-key generation (never `Math.random()`), `submitWithdrawalRequest()` response
  validation (missing/mismatched fields, non-JSON body), the two-step review/submit DOM wiring,
  receipt rendering with and without a reissued download link, and markup assertions against
  `widerruf.html` itself (required field ids, exact statement text, cross-links to/from
  `cancel.html`).

Run the smallest relevant subset first, e.g.:

```bash
python -m pytest sites/ffm/tests/test_contract_confirmation.py sites/ffm/tests/test_withdrawal_requests.py sites/ffm/tests/test_billing.py -q
node --test sites/ffm/static/game/withdrawal-request.test.js sites/ffm/static/game/access-flow.test.js sites/ffm/static/game/i18n.test.js
```

then the full `pytest sites/ffm/tests/` and `node --test sites/ffm/static/game/*.test.js` before
considering a cross-cutting billing change complete, since this flow shares locking/idempotency
primitives and config with the rest of billing.

**Known limitations / open items (flagged for operator follow-up, not silently resolved):**

- The operator specified "§ 356(6) BGB" as the basis for the immediate-access/withdrawal-waiver
  confirmation; general knowledge of German consumer law more commonly cites § 356 Abs. 5 BGB
  for this specific digital-content waiver. `legal_texts.py` and the withdrawal-instructions
  text deliberately use generic "§ 356 BGB" phrasing (consistent with this repo's existing
  legal-disclaimer pattern elsewhere) rather than asserting one specific paragraph number as
  fact — an operator/legal reviewer should confirm and, if needed, correct the exact paragraph
  citation.
- `CHECKOUT_DECLARATIONS_VERSION` in `main.js` is a **manually synced** JS constant mirroring
  `legal_texts.DECLARATIONS_VERSION`; this is a deliberate, documented trade-off (the server is
  always authoritative and safely rejects staleness with an explicit `409`, never silent
  acceptance) but it is a sync-maintenance burden any future declaration-text change must
  remember to update in both places.
- No automated retention/purge exists yet for either contract-confirmation evidence or
  withdrawal-request records — both are held indefinitely by design pending an explicit
  operator/legal retention-policy decision, per the requirement not to silently apply the
  existing 3-year cancel-request purge policy to a different evidence class without approval.
- Withdrawal-request processing has **no automated refund/cancellation path**: there is no
  dedicated "safe" automated Stripe refund helper for this flow, so `record-manual-outcome`
  only durably records what an operator attests was actually done via the existing
  `billing-admin` refund/cancel tooling or the Stripe dashboard directly — this is the
  explicitly-approved "operator handling" model, not a gap to be closed by inventing a new
  automatic-refund code path.

### Locale propagation on pre-existing auth/cancel-request emails

A separate, read-only audit found that the emails *predating* the above feature were not
locale-aware despite the UI itself already supporting German/English via `static/game/i18n.js`'s
client-side `ffm_locale`: `send_verification_email`/`send_password_reset_email`/
`send_email_change_confirmation` were always English-only, and the public cancel-request flow's
JSON receipt `message` plus its later operator-triggered outcome email
(`send_cancel_request_ack_email`) were always German-only. This has been fixed by threading an
explicit, validated `locale` selector through each flow — reusing `app/legal_texts.SUPPORTED_LANGUAGES`
as the single allowlist everywhere, matching the project's existing JSON-POST-body pattern (no
new header/CORS mechanism was introduced):

- **Auth-action emails** (`app/auth.py`'s `register`/`resend-verification`/`forgot-password`,
  `app/main.py`'s `update_email` for the email-change confirmation): the client already sends a
  JSON body to each of these endpoints, so `static/game/api.js` now adds a `locale: getLocale()`
  field to each call. The backend validates it against `legal_texts.SUPPORTED_LANGUAGES`,
  falling back to `'en'` (these functions' pre-existing, unchanged default) for anything
  missing/invalid — a locale preference is never grounds to reject the request itself. Each
  email's SPA deep-link (`?verify_token=...`, `?reset_token=...`, `?confirm_email_token=...`)
  now also carries `&lang=<resolved-locale>`, and `static/game/i18n.js`'s `getLocale()` honors
  that `?lang=` query param as a one-time, **session-only, non-persisted** override (it never
  overwrites the user's own stored `ffm_locale` preference), so opening an emailed link reopens
  the page in the language that was actually selected when the email was triggered — even from a
  different device/browser than the one that will eventually click the link.
- **Public cancel-request submission** (`app/cancel_requests.py`): accepts an optional `locale`
  field (same allowlist, falling back to `'de'`, this flow's pre-existing default). It is
  durably persisted on the stored record (mirroring how `withdrawal_requests_store.py` gained
  `statement_language`) and used for both the immediate JSON receipt's `message` and — critically
  — the *later*, operator-triggered `cancel-request complete-email` outcome email, which always
  uses the **original submitter's** locale, never whatever locale the operator's own shell
  happens to be in when they eventually run the CLI. `locale` is deliberately excluded from the
  idempotency `payload_hash` (it's an email-language preference, not part of the
  legally/operationally significant payload), so an honest retry that omits or changes it is
  never treated as a conflicting resubmission. Pre-existing records created before this change
  have no `locale` key at all and gracefully default to German when read back.
- `send_cancel_request_ack_email`'s existing German body text keeps its established ASCII-safe
  spelling convention (e.g. "Kuendigung", not "Kündigung") unchanged — only locale *selection*
  (German vs. a newly added, properly-accented English translation) was in scope here, not a
  cosmetic rewrite of the pre-existing German copy.
- Independently re-verified (not merely taken on an audit's claim) that `app/models.py`'s
  verification/reset/email-change tokens are opaque `secrets.token_urlsafe(32)` values whose
  SHA-256 hex digest alone is stored as the DynamoDB item's key — **not** JWTs. (Only the
  separate login access/refresh tokens, `app/jwt_utils.py`'s `mint_access_token`/
  `mint_refresh_token`, are actual JWTs; these single-use action tokens are a different,
  unrelated mechanism.)

**Tests covering this:** `tests/test_mailer.py` (12 new unit tests covering body/subject/link
language selection and safe fallback for all four functions above), `tests/test_app.py` (7 new
tests asserting `locale` is actually threaded from the request body to the mailer call's
`language=` kwarg, with correct fallback for missing/invalid values), `tests/test_cancel_requests.py`
(6 new tests covering the receipt message, the submission-locale-not-operator-locale guarantee for
the outcome email, the pre-existing-record-without-`locale` fallback, and payload-hash exclusion),
and `static/game/i18n.test.js` (4 new tests for the `?lang=` URL override: takes precedence,
rejects unsupported values, and is never persisted to `localStorage`).

### Welcome/verification email "quick manual" corrections (`app/mailer.py`)

A review of the registration (verification) email's product-manual section found several player
facts missing and one inaccurate claim. The following was added to `_VERIFICATION_COPY['en']`/
`['de']` — the welcome email only, not a general rewrite of legal/declaration text (that stays in
the separate contract-confirmation email):

- Free vs. paid level boundary (levels 1-2 free forever, 3-60 require Premium), cross-checked
  against `app/entitlements.py`'s actual `level <= 2` gate, not assumed from memory.
- Price/renewal cadence, worded to match `app/legal_texts.py`'s actual constants (`PRICE_EUR`/
  `PRICE_EUR_EN`, `BILLING_INTERVAL_MONTHS`) and its existing "all applicable taxes included"
  phrasing (deliberately not VAT-specific, since the subscriber's jurisdiction/tax regime isn't
  assumed).
- Where to manage the subscription or redeem a gift/promo code: the account's Billing section
  (matches `static/index.html`'s `#billing-redeem-section`).
- That cancelling only stops future renewals (access already paid for continues to period end),
  explicitly distinguished from full account deletion (immediate loss of access) — these are two
  different account actions and must not be conflated.
- The adult-account/child-use model, phrased to match the actual policy in `static/terms.html` §1.1
  and `index.html`'s `auth.consentAdultOrGuardian` copy: the *registering* account holder must be
  18+; a child may only play under a parent's/guardian's own account and consent. This is **not**
  "18 or a minor with parental permission to register their own account" — there is no such path.
- That changing your password immediately revokes all other active sessions (`app/models.py`'s
  `set_password_hash()` bumps `token_version`, invalidating outstanding JWTs tied to the old value).
- Removed an inaccurate "(last 2 weeks)" leaderboard-window claim and clarified the optional
  grade-year grouping is for comparing similarly-aged players, not an age check. `app/models.py`'s
  `get_leaderboard()` is explicitly documented and implemented as **not** filtered by recency (it
  scans all-time high scores by design, since `achieved_at` reflects a personal best's last
  improvement, not last-played activity) — the old copy's specific timeframe claim did not match
  the backend's real behavior. Note: `static/index.html`'s leaderboard UI note ("Showing high
  scores set in the last 2 weeks.") appears to have the same pre-existing inaccuracy; it was left
  unchanged here as out of scope for this mailer-focused change and is flagged for separate
  follow-up.
- Deliberately **not** added: any "start a free trial" / "contact us about a trial" language — no
  such general free-trial offering exists anywhere in this codebase.
- Grandfather-eligibility wording was deliberately **omitted** from this email: the operator's
  configured cutoff is already in the past for any newly-registering user, so no current/future
  registrant can ever qualify — there is nothing accurate to tell a new signup about it.
- Difficulty timings/hearts (Easy 15s/7, Medium 10s/5, Hard 5s/3 — `static/index.html`'s
  `data-timer`/`data-hearts`), combo-ability thresholds (fireball >5, lightning >10, dragon >20 —
  `static/game/combo-abilities.js`), and the 60-level count were independently re-verified against
  source and found already accurate; left unchanged.

**Tests covering this:** `tests/test_mailer.py` (11 new tests) assert the corrected bullets are
present in both languages, that the price/cadence figures are sourced from `legal_texts.py`'s own
constants (so a future price change that forgets to update the email fails a test instead of
silently drifting), that the "last 2 weeks" wording is gone, that "free trial" never appears, that
the email doesn't duplicate the contract-confirmation email's legal/withdrawal boilerplate, and
that the free/paid boundary matches `entitlements.py`'s actual gate by inspecting its source.

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
