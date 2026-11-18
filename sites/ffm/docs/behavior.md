# Arithmo Slayer: current behavior

Part of the [Arithmo Slayer system documentation](../README.md). Gameplay, practice, curriculum, auth, data model, retention, security and legal behavior as the code implements it today.

## Important current behavior

### Frontend/gameplay

- The game is a single static page with a canvas plus DOM overlays for auth, difficulty selection, level clear, game over, and input.
- `main.js` owns almost all runtime state in one module-level `state` object plus a few side arrays (`fiends`, `spawnQueue`, `requeuedFiends`, `answerTimes`, `activeLightningBolts`).
- The current curriculum is **60 levels**, not 40. The tests enforce four 15-level blocks.
- `fiendHP` is spent on milestone levels only: **2 at 20, 30 and 40, 3 at 50 and 60, 1
  everywhere else**. A fiend with more than one hit point shows one dark halo per
  point above its head and asks a new problem after each non-lethal hit. On top of
  that, `GAME_CONFIG.eliteFiendChance` still makes ~10 % of spawns elite at 3 HP on
  any level, which is where the halo occasionally appears outside the milestones.
  Changing `fiendHP` changes the level baselines: re-run
  `node sites/ffm/scripts/update-level-data.mjs` afterwards.
- Each level currently uses `waveSize: 30`, but the current loop behaves more like "30 enemies per level" than a multi-wave system:
  - `waveNumber` exists in state but is not driving any real multi-wave progression.
  - `triggerWaveClear()` immediately transitions to level clear after all queued/requeued fiends are defeated.
- Only **one fiend is allowed on screen at a time** right now because `spawnNextFiend()` returns early if any fiend is still present.
- Requeue-on-wrong-answer is implemented:
  - wrong answer or timeout hurts the hero
  - the correct equation is revealed for 2 seconds
  - the fiend retreats and is appended to `requeuedFiends`
- All arithmetic levels use multiple choice: five unique nearby answers in levels 1-10,
  ten in levels 11-60. Choices are seeded and shuffled; Shapes practice keeps four answers.
- Gameplay uses an uncropped logical 800x450 scene above answers in portrait and beside
  answers in landscape. Every menu page except Play is one framed sheet (`styles.css`,
  `.title-page:not(.title-play)`) that fills the band when its content needs the room and
  shrinks to a centred card when it does not; the sheet itself scrolls, so long lists reach
  their pagination instead of clipping (`#leaderboard-list` used to hide row eight onwards).
  Four-edge safe areas and keyboards constrain the viewport.
- Score is computed client-side from base points + speed bonus + combo bonus, with an elite multiplier for rare elite fiends.
- **Combo-ability pulsating border** (`#combo-frame`, driven by `Renderer.drawComboFrame()`):
  the DOM overlay follows `#playfield`, independent of whether answers are below or beside it.
  Its ability colors and combo thresholds remain unchanged.
- **Cooldown spells (wind, storm, earth)**: three slots render from level 1 and unlock at
  levels 1/6/11 with a 180 s base cooldown (`static/game/cooldown-abilities.js`,
  `ability-bar.js`). Storm removes `1 + storm rank` enemies **from the level itself**: they
  are taken off the spawn queue / requeue list / active slot, never counted as defeats, so
  the encounter total shrinks and the portrait sword row keeps their slots and empties
  them, so the gaps stay exactly where the removed enemies stood instead of every remaining
  sword sliding towards the middle (the last encounter always survives). Each removal adds
  a `stormRemoval` burst along the ground, a `swordLost` puff on the departing swords and
  one chained thunder cue (`playStormRemoval`); see `screen-fx-effects.js`,
  `encounter-swords.js` and `audio.js`.
- **Earned bonuses apply to the live run**: `bonusReadoutsForLevel()` replays the ladder
  (levels 2-60) into one bonus runtime. `beginAbilityRun(level)` seeds a fresh run with it,
  and `finishStartLevel()` re-applies it to the live ability runtime at every level start,
  so starting at level n — or advancing into a level — is never a downgrade: cooldown
  bonuses shorten the actual 180 s cooldown (floored at 90 s), storm rank widens
  `stormRemovals()`, the passive slow steps scale every fiend walk-in through
  `getFiendWalkSpeed()`'s multiplier, and the earth-spike target count grows (capped at 5).
  The HUD readouts and the gameplay therefore read from the same ladder. Each
  level's bonus is also announced: a pill under the header (`showBonusNotice`, twelve seconds
  of gameplay time, paused time never counts) and a `bonusFlow` glow that carries the light
  from that pill into the orb the bonus strengthened. In landscape the pill is clamped to the
  scene column, because the answer panel paints above the header there.
- **Per-stage background images**: `Renderer.setBackgroundByLevel()` swaps in one of `stage-1.png`..`stage-6.png` (one per 10-level chapter) as the level advances. `background.png` is a legacy, visually distinct scene (no longer used by any stage) kept only as a last-resort fallback if the real stage image's `Image` element fires an `error` event — it must not be loaded eagerly alongside the real image, or a network/decode race can let it flash on screen first as the "wrong" background.
- **Speedrun**: an opt-in continuous-run clock. A run starts when level 1 of the campaign
  starts and follows the campaign in order — it only continues into the next level, only
  ever moves forward, and ends at level 60, on a replay, on a jump to another level, on a
  game over or on returning to the title. Only "in level" time counts: the clock is gated
  by the same test the HUD uses to decide that a level is on screen, so pauses, the
  level-clear card, story scenes and loading never enter a time. Records (fastest time per
  level, fastest finished run) live in `localStorage` under
  `arithmoslayer:speedrun:v1`, like the locale and the story flag. The clock is off by
  default; three taps on the title's intro line open the records card, which is also
  where the clock is switched on.
- **Central speedrun records (web)**: a signed-in web player reports each finished run to
  `POST /api/speedrun/run` (sixty splits + total; the server rejects anything that is not
  sixty distinct levels, plausible times, and a total matching the splits within a 120 ms
  rounding window, because a run cannot be replayed and the time cannot be verified). The
  run becomes the player's personal best when it improves, and its splits improve the
  per-level bests. `GET /api/speedrun/records` (auth) and `GET /api/speedrun/leaderboard`
  (public) feed the "Speedrun records" block on the web ranking page — personal best,
  overall fastest runs, and the fastest single level anyone has run. The app build answers
  both with empty data and never posts: its records stay on the device. Deleting an account
  removes the records with the rest of the player's score items (same `pk`).
- Signed-in web players submit cleared-level score deltas to `/api/score` and overall
  scores to `/api/high-score`. Mobile saves cleared-level personal bests/history locally
  without online login, including the final level, and refreshes title statistics.
  Retry/replay resets the current run checkpoint, not already saved progress.
- Mobile family players have separate local progress; purchases remain device-wide.
  Switching is title-only and blocked during pending profile writes or level startup.
  Unfinished-level points are not banked. Storage failures are visible and retryable.
  Play continues at that player's first unfinished level; cleared levels can be replayed.
  All 60 completed means replay from level 1, never level 61. Native runs do not receive
  server baseline points. Defeat retry restores difficulty hearts and the timer while
  retaining the level-start score, including unscored Shapes practice.
- Readable gameplay feedback includes wrong-answer/timeout corrections, encounter progress,
  upcoming spell thresholds and healing progress. Results show first-answer accuracy and best streak;
  native summaries compare only the same player's previous level/difficulty clear. These are
  optional personal replay goals, not proficiency certification.
- The gameplay header keeps one height for the whole level: `#gameplay-feedback` always reserves its
  reveal line and the app reserves the two-row Shapes question (`data-two-row-question`). `viewport-layout.js`
  sizes the scene from the measured header, so a header that grew on a wrong answer used to rescale the
  playfield and the answer grid after every reveal.
- The title screen's "Practice" tab (German "Training") is the old Progress tab; the name follows what the
  player does there. The per-player bests and history it lists keep the word "progress" in their status copy.
  Its session panel explains the selected level from the authorized level config (operations, result ceiling,
  answer choices) and reports locked levels instead of guessing; that one-line explanation stays centred
  under the level selector.
- The score-history chart shows the total high score in the app: the sum of the player's per-level
  bests after every saved result, seeded from level bests older than the kept history window so the
  last point equals the listed bests. The web has no per-level bests to add up, so its chart plots one
  point per day holding that day's best submitted score; several results of one day collapse into
  their best. The app summary names the total high score, the web summary the best score of the
  series, both with the number of saved results behind the points.
- The Training tab's chart page is a sub-page of Practice: the tab stays lit while it is shown and
  a "Back to practice" button returns to the practice list.
- The speedrun records card is a fixed dialog whose level list is the only scroll region, so the
  Close button stays reachable once all 60 levels have a recorded time. The ability orbs show only
  the numbers of their bonus-aware readouts (storm removals, earth slow percent and targets); the
  words live in each slot's accessible name, because the two captions of a row sit side by side in
  too narrow a column for sentences.
- Earth holds its targets to **30 % of their walk speed for 10 s** at unlock (level 11). Every earth
  bonus from the level ladder also lengthens the stretch (+2 s), deepens the slow (-0.03) and adds a
  target, clamped to 30 s / 0.15 / 5 targets. Answering a slowed fiend before its stretch ends does
  not waste the rest: the leftover seconds are banked onto the next target's stretch (leftover + a
  full duration, capped at 30 s), so a quickly cleared chain keeps the field slowed.
- Buttons have three visible tiers: brass *primary* (thicker 2px line plus a drawn diamond: start practice,
  resume, next level, save a score), red *danger* (discard a score, delete a player) and quiet
  navigation/pagination, whose paging arrows are drawn with CSS borders rather than glyphs.
- Running text in dialogs is left-aligned with an 8px side inset and margin before the action; the welcome text,
  headings and one-line labels stay centred (including the practice panel's level hint). The Training tab's
  practice panel is a submenu (tab-styled summary,
  Back button and Escape) and menu labels never spill out of their buttons (tabs wrap instead of clipping).
- Menu typography comes from one scale in `static/styles.css` (`--text-button`, `--text-body`,
  `--text-option`, `--text-heading`): buttons use the title-page tab size in `system-ui`, body copy uses the
  difficulty-explanation size, and bold/ivory are reserved for headings, the selected tab and the primary
  action. Gameplay HUD, answer buttons and legal pages keep their own metrics.
- The web title screen shows both app-store listings as non-clickable "soon" badges
  (`<!-- app-omit:start -->`, so the Capacitor bundle drops them) until the listings are live.
- Authors can assign bundled songs per level without an in-app picker; see
  [mobile/MUSIC.md](../mobile/MUSIC.md) for the catalogue, credits, assignment and rebuild steps.

### Experimental practice and score comparability

Practice is deliberately separate from the scored campaign. Targeted corrections,
ten-encounter short rounds, untimed assistance, tougher elite encounters and earned
recovery trials must never submit high scores, mark campaign levels complete, unlock
content or contribute to ordinary replay comparisons. Finite Shapes practice counts
ten resolved questions; its final correction remains visible before the result.
Endless Shapes remains available. Premium practice uses the same authorization boundary
as ordinary levels. Local badges describe activities, not proficiency or certification.

The campaign keeps its existing local records and difficulty labels. A successful
dragon breath ends a campaign level on both the web and the app build: it clears every
encounter still queued, requeued or on screen, pays a deterministic baseline-per-wave
bonus for each of them, and hands off to the normal level-clear path. Practice and
Shapes keep the older present-fiends-only breath; pending spawns and retreating
correction queues survive there. Spell kills are encounter progress, not correct
replies or recovery credit; a storm cast instead takes enemies off the level
altogether, so the encounter total shrinks (and their swords leave the portrait
row) rather than the Defeated count rising. Answer latency samples only active
gameplay and resets between attempts. Web level and high scores recorded before
the web build adopted this rule are legacy records; compare them only among
themselves.

Before promoting any experimental rule into scored play, assign an explicit ruleset
identifier to the resulting records and compare scores only within the same ruleset,
level and difficulty. Preserve existing records as legacy campaign records; do not
silently reinterpret them, backfill badges from scores or mix trial results into old
leaderboards. Promotion and any backend/schema migration require a separate reviewed
change. No experimental rule is promoted by this implementation.

### Arithmetic curriculum contracts

- Levels 1–10 present five unique choices; levels 11–60 present ten. Choice generation
  is seeded, shuffles the correct answer's position, and uses operation-aware error
  candidates followed by a randomized nearby fallback. Every choice is a non-negative
  safe integer within `R = max(choiceCount - 1, ceil(abs(answer) * 0.10))` of the answer.
- `operandRange.a` and `.b` are inclusive non-negative integer ranges for the two
  operands in addition, subtraction, and multiplication. Subtraction draws `b` from its
  configured range while requiring `b <= a`; addition/subtraction results must also
  respect `maxResult`.
- Division is the deliberate exception: `operandRange.a` is the exact integer quotient
  range, and `.b` is the positive divisor range. The displayed dividend is
  `quotient * divisor`, so division remains exact. For multiplication and division,
  `maxResult` is metadata only, not a hard runtime cap: factor products and division
  dividends can legitimately exceed it in the canonical levels.
- An impossible or malformed operation/range contract raises an explicit level-specific
  error instead of silently substituting operands.
- Level 11 keeps level 10's `a: 2–12`, `b: 1–7`, `maxResult: 19`, and `+`/`-` arithmetic
  envelope while increasing the choice count to ten. Level 12 retains the next planned
  arithmetic step (`a` and `b` up to 20, `maxResult: 20`); the premium-level boundary
  and timer/scoring rules are unchanged.

### Auth/profile/leaderboard

- `api.js` stores the access token only in memory.
- Registration no longer returns an access token or logs the user in — new accounts start unverified and must click an emailed verification link before `/api/auth/login` will succeed (see "Email verification, password reset, email change" below).
- Refresh/logout depend on the `refresh_token` cookie and same-origin requests with credentials.
- Leaderboard grouping is by `first_grade_year`, not by level.
- The splash screen can prompt logged-in users without a `first_grade_year` to complete their profile so they appear in year buckets.
- Clicking the logged-in username in `#top-bar` opens an account modal (`#account-modal` in `index.html`) with three tabs: editable profile info (email change with re-verification, first grade year), change password, and high-score history (reusing the same chart renderer as the splash screen's leaderboard panel).

### Email verification, password reset, email change

- Sending is done via AWS SES (`app/mailer.py`, plain-text emails, no templates/configuration sets). Reads `SES_SENDER_EMAIL` / `SES_CONFIGURATION_SET` / `APP_BASE_URL` / `BETA_WAITLIST_NOTIFY_EMAIL` from `os.environ` at call time; each is also exposed on `app.config` and propagated into `os.environ` by `app/__init__.py`, same pattern as `DYNAMODB_*`.
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

- `static/impressum.html` / `impressum.en.html` (§ 5 DDG) and `static/datenschutz.html` / `datenschutz.en.html` (Art. 12/13 GDPR) — bilingual DE/EN legal pages, linked from the title screen's Terms tab. `.splash-legal-links` in `index.html`/`styles.css` renders that list as the same vertical stack of brass/forest chips the app shows (web-only rules under `:root[data-platform="web"]`). `static/terms.html`/`terms.en.html` load `static/legal.css` after the shared stylesheet; it mirrors the app's `mobile/legal/legal.css` (forest/ivory/brass palette, 16px monospace prose, 44px footer links). Responsible entity: Urs Schweigert; contact `info@derschweigert.de` (see "Deployment shape" below for how that mailbox exists). No VAT ID/register entry is shown (owner has neither).
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

### Android beta waitlist (no login required)

- `POST /api/beta/android-waitlist` — `{"email": "...", "locale": "de|en"}`. Stores the
  Google address for the Play test-track invitation under its own
  `BETAWAITLIST#<address>` partition key in the `ffm-users` table (app/beta_waitlist.py),
  normalises it to lower case, and is idempotent: an address that is already listed
  answers `200` with `status: "already_registered"` instead of creating a second item.
  `201` means newly registered. Only `gmail.com` and `googlemail.com` are accepted
  (`400 google_mail_required` otherwise, `400 valid_email_required` for anything
  malformed) because Play's test track only invites Google accounts.
  Rate-limited per source IP (`BETA_WAITLIST_RATE_LIMIT`, default `5/minute`); a
  rejected address writes nothing. Every *new* sign-up also emails the operator
  (`BETA_WAITLIST_NOTIFY_EMAIL`, default `info@derschweigert.de`) via
  `app/mailer.py`'s `send_beta_waitlist_notification`, so the list never has to be
  polled; a repeat submission sends nothing, and a failed send is only logged to
  stderr — the stored sign-up still succeeds. Delivery works even while SES is
  sandboxed because `derschweigert.de` is a verified SES domain identity (managed
  by the `email_forwarding` Terraform module); set the variable to an empty string
  to disable the notification. The page at `/beta/` submits this form; the list is
  read with
  `python -m flask --app sites.ffm.app:create_app beta-admin export [--format csv|json]`
  when the Play test track opens.
  Covered by `tests/test_beta_waitlist.py`.
