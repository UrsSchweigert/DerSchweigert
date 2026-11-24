# Arithmo Slayer: file map for common tasks

Part of the [Arithmo Slayer system documentation](../README.md). Where to start for each kind of change. Read only the section for your task.

## Fast file map for common tasks

### Change gameplay rules or scoring

Start with:

- `sites/ffm/static/game/main.js`
- `sites/ffm/static/game/levels.js`

Fiend classes and their score ladder live in `static/game/difficulty-classes.js`
(`scoreValue = 50 * class id`); one class per level means level N fields class N.
`assumedDragonPathLevelScore()` / `computeDragonPathBaselineScore()` in
`static/game/level-baseline-score.js` derive a level's flawless score from that
ladder, and `node sites/ffm/scripts/update-level-data.mjs` writes those values
into `app/level_data.json` as `baseline_score` - which is what the backend serves
for a level jump. Re-run it whenever the ladder, the score scale or a level's
`waveSize`/`fiendHP` changes, and keep the shipped values honest with
`level-baseline-score.test.js`, which asserts all 60 entries match the model.

### Warden boss locks (prototype)

`sites/ffm/static/game/boss-rules.js` and `static/game/boss-problems.js` are the
engine-independent half of the planned act bosses. A Warden lock shows a few
numbered orbs and one rule; the player strikes them in an order (or picks a
subset) that completes it. Neither module touches the DOM, `main.js` or scoring
yet - they are pure logic plus their generated locks.

- `boss-rules.js` owns the seven rules (`ascending`, `descending`,
  `factorChain`, `composeTarget`, `pairSum`, `oddOneOut`, `equalShare`),
  `evaluateStrike()` (a strike is accepted only while the lock stays solvable,
  and a wrong strike clears the sequence), `solutionFor()`, `countSolutions()`
  and the `hintFor()` ladder shown after a miss. Rules return i18n keys, never
  text.
- `boss-problems.js` generates a lock for a level band from a seed, plus the
  inverse ("`? × 7 = 56`") problems a Warden poses between locks.
  `orbRangeForBand()` derives a lock's number range from an existing level config,
  so the generated locks match what that act already teaches.
- **Every generated lock has exactly one completion.** `sealLock()` enforces it
  and `boss-problems.test.js` checks 10,000 seeds per rule and 200 per band, so a
  Warden can never pose a puzzle with two right answers.
- Compose deliberately excludes `-` and `÷`: `a - b = r` also makes `a - r = b`
  true, and `a ÷ d = q` also makes `a ÷ q = d` true, which would give one set of
  orbs two valid answers. Those directions are covered by the inverse and
  `equalShare` problems instead.
- The generator is mulberry32 rather than the campaign's LCG on purpose: an
  LCG's low bits are correlated, so `state % span` over a small span repeated the
  same draw and builders could never succeed.

Boss fights are **built but not released**: `WARDENS_ENABLED` in
`static/game/boss-data.js` is false, so `initWardenMode()` returns before
mounting anything and the Wardens row never appears. `?wardens=1` opens them for
development and review; `boss-preview.html` bypasses the switch with `force`.
Flip the constant and drop the query check when they ship.

The fight itself is `static/game/boss-run.js`: an overlay on the title screen,
not a canvas mode, so a Warden needs no enemy entity, spawn queue or camera.
`boss-attempt.js` owns the phases, the per-phase Ward Clock, checkpoints, crowns
and score; `boss-progress.js` keeps the best crown and score per Warden.
`static/boss-preview.html` plays any Warden against bands copied from
`app/level_data.json`, which is the only way to try one without the level API.
It is a development page and is excluded from the app bundle.

Warden art lives in `static/game/boss/`: one arena backdrop per act (the sixth
also serves the Hollow King) and one portrait per boss, all drawn with the GPT
image model, which is the only generator tried here that produces genuine pixel
art. `scripts/boss_art.py` only crops and encodes them — pooling or quantising
would smear the pixel grid they were drawn on. See
`static/game/boss/PROVENANCE.md` for hashes and the rejected attempts.
Re-run that script rather than hand-editing a shipped image.
Each boss also has a dragon, front-facing, with one more head per act and one
again for the Hollow King. Dragons ship as 3x3 pose sheets (idle / hit / breath)
that `boss-run.js` animates by background position: a correct answer makes the
dragon flinch, a wrong one makes it breathe. The fight panels
use the title page's forest/ink/ivory/brass tokens from `styles.css :root`, not
the lore palette, so a Warden looks like another room of the same house.

### Change visuals or sprites

Start with:

- `sites/ffm/static/game/renderer.js`
- `sites/ffm/static/game/entities.js`
- `sites/ffm/static/game/hero-anim.js` (hero clip list and transform tracks)
- `sites/ffm/static/styles.css`

### Change the hero's poses or animation

The hero is drawn from a generated atlas plus a time-based animator, not from
the old fixed 6x4 sprite grid:

- `sites/ffm/scripts/hero_frames.py` builds `static/game/hero/hero-atlas.webp`
  and `static/game/hero/hero-frames.js` (per-frame rect + foot pivot) out of
  `static/game/source-assets/hero-spritesheet-clean.png` and the generated poses in
  `static/game/source-assets/hero-poses/`. Frames are extracted as their largest
  connected blob, so a neighbouring pose can never bleed into a frame, and each
  frame carries an explicit ground pivot instead of one hand-tuned offset. The
  pivot's x is the torso's centre of mass (rows 25-75% of the frame), not the
  midpoint of the bottom row: the bottom row is the two boots when standing, a
  single boot in a passing walk pose, and the blade tip whenever the blade dips
  below the feet, which moved the anchor by up to 18 px between frames of the
  same idle cycle and made the hero slide sideways while breathing. `py` stays
  the lowest opaque row, so the feet stay on `GROUND_Y`.
  Rebuild with `python3 sites/ffm/scripts/hero_frames.py`.
  The same run verifies the sword in every pose: the blade has to run straight
  from hilt to tip (cross-sections measured against the hilt-tip line, hidden
  slices skipped so a blade behind the body is still checked) and has to be
  gripped by a hand, with the number of hands compared against the pose's
  declared grip (`one` except the swing and cast poses, which are `two`). The
  table prints per-frame numbers; `--check` writes nothing, `--check --strict`
  also fails on warnings (the poses whose art still shows one hand).
- Hand-editing art: `--export-sheet sites/ffm/build/hero-edit-sheet.png` lays
  every pose out in its own cell (solid red border = the crop edge, art painted
  outside a cell is dropped, so don't cross it; dashed amber inset = the bleed
  margin) and writes a `hero-edit-sheet.json` layout next to it. Edit the PNG,
  then rebuild from it with
  `python3 sites/ffm/scripts/hero_frames.py --from-sheet sites/ffm/build/hero-edit-sheet.png`.
  The importer crops each cell, erases the guide lines (only where the guide
  actually drew them, so art that happens to share the amber/red tones survives),
  trims to content and lets `pack()` recompute the pivots, then runs the normal
  sword checks and atlas write. An unedited round trip is pixel-exact.
  Empty cells are reported and their frame is dropped; art that reaches a cell
  border gets a note because the border cuts it off.
  Frames coming back from a sheet are judged on their final, palette-flattened
  art (a hand edit no longer has the pre-flattening source), so the blade
  straightness limit is `BEND_MAX_FLAT_PX` instead of `BEND_MAX_PX`: four steel
  tones cannot place a 2-3px cross-section's centre finer than about a pixel.
  The shared palette reserves four steel tones sampled from the generated
  blades (`_steel_seeds`), because the sheet frames alone have no bright
  blue-grey and a generated blade's steel otherwise snaps to warm cream.
- `sites/ffm/static/game/hero-anim.js` holds the clips: frame durations, which
  frame fires `hit`, and the `track()` function that leans/bobs/squashes the
  pose. Timing is wall-clock based, so playback does not depend on the display
  refresh rate. A non-looping clip parks on its last frame with that frame's
  full duration and then reports `finished`, which is what hands the hero back
  to `idle`; `hero-anim.test.js` steps a clip in 16 ms slices, because a single
  large step hides an overshoot that leaves the hero stuck in his swing pose.
- `sites/ffm/static/game/hero-preview.html` plays every clip through the real
  `Hero` class (dev tool, not bundled into the app).
- The dash to and from a fiend plays the `walk` clip (main.js's `heroLunge`
  block): the hero walks out, the `swing` clip owns the strike frames, and the
  walk resumes for the way back. A `swing`/`hurt`/`dead` clip is never cut
  short by the walk; it plays out first.
- Fireball and lightning start at `castHandAnchor()` (hero-anim.js): the
  `release` frame's `fxAt`, the same point the palm glow is drawn at. They
  therefore erupt from the raised hand; moving the hand in the art moves the
  launch point with it. Raise the anchor, not a constant in main.js.
- The generated poses in `source-assets/hero-poses/` were made with
  `fal-ai/flux-pro/kontext` (approved for commercial use in
  `static/story/ART-BIBLE.md`) from a ×4 nearest-neighbour plate of the
  matching sheet frame, prompted to keep the character, scale and framing and
  to change only the weapon/arms. They are keyed off the flat magenta plate,
  despilled and stripped of the generator's baked ground shadow by the build
  script, then scaled onto the master's pixel density.

### Fiend entrance

A fiend no longer walks in from off-screen right. On most of the 60 backgrounds the
right edge is a wall, a gate, a staircase or a darkened vignette, so the slide-in
read as the sprite clipping through scenery. Instead a red portal opens on the
level's ground line at `FIEND_PORTAL_X` (`CANVAS_W - 80`, see `difficulty.js`), the
fiend appears inside it, and the walk to combat range starts from there.

The effect is the `fiendPortal` recipe in `screen-fx-effects.js`: a light pool on
the floor, an elliptical doorway (two rims plus a deep-red interior), rising
embers, rim sparks, floor motes, smoke, a shockwave and a short flash. It uses the
`glow` and `oval` primitives added to `screen-fx.js`; everything is additive because
the fx layer paints *above* the game canvas, so an opaque portal would hide the very
fiend stepping out of it.

`getFiendWalkSpeed()` is always called with `FIEND_PORTAL_X`, so the shorter walk
still finishes exactly when the level's timer runs out — moving the anchor without
that argument would make every fiend arrive early. `difficulty.test.js` asserts it.

### Fiend sprites and their ground shadow

Every fiend has two files, built together by `scripts/build_fiend_walks.py`:

- `static/game/fiend-sprites/<name>.webp`: the still. Used while the fiend stands
  at combat range, is hit or dies, and as the fallback until its strip has loaded.
- `static/game/fiend-walk/<name>.webp`: the walk cycle, `WALK_FRAMES` (8) equally
  wide frames side by side. `Fiend._drawClassSprite` plays it while the fiend walks
  in or retreats (`fiend-walk.js`: `walkFrameIndex`, 9 fps; mirrored on retreat).

60 fiends: young `set1-01` … `set1-18`, old `set2-…`, ancient `set3-…`, plus
`dragon-1` … `dragon-6`. Each is a different creature (names in `CLASS_NAMES` in
`difficulty-classes.js`, which also picks the file per level and carries the
`BOTTOM_PAD_RATIO` that puts each creature's feet on `GROUND_Y`; `calibrate.html`
fits that - align the feet, not the shadow). The calibrator has a
background-level selector (or `[` / `]`), which is what makes the check
meaningful: the 60 level images do not share one floor line, so the feet have to
be judged against the background the level actually ships with.

The art is generated (a style-matched image per creature, then an 8-frame walk
animated from it). `build_fiend_walks.py` takes the raw PNGs (`<name>_0.png` the
still, `<name>_1..8.png` the frames) and crops the still and all 8 frames with one
box per fiend, the union of what any of them draws. That is the only processing:
frames are deliberately not re-aligned or retimed, because aligning the feet frame
by frame made the walks look choppy. Because the still shares the strip's box, the
sprite's aspect ratio - which sizes the fiend and its hit box - does not change
when the walk starts. Re-run it with `--only <name> ...` to swap a single fiend.
The strips are the bulk of the art payload (about 6.7 MB for the 60); they are
listed after every still in `buildDeferredAssetManifest()`, so first paint never
waits for them.

The calibrator also moves the ground line itself, together with the hero and the
fiend (`−` / `+`, or the “Ground line (this level)” buttons). That is how a level
gets its own line without touching `GROUND_Y`, which stays the default for the
other 59:

```json
"groundY": { "31": 348, "48": 372 }
```

`levels/manifest.json` accepts this optional block (level number → canvas y,
inside 240–436). `Renderer.setBackgroundByLevel()` resolves it into
`renderer.groundY`, `startLevel()` moves the hero onto it, and every fiend spawn
and screen effect anchored to the characters uses that value, so the whole scene
moves together. “Generate + copy” in the calibrator emits the block for whatever
you tuned. A level with no entry keeps `GROUND_Y`.

The calibrator keeps a 60-level pass usable: tuning is saved in the browser as
you go (✎ marks a level tuned here, ● one the manifest already carries), the panel
shows how many levels are left, “Next untouched ▶” (`n`) jumps to the next one,
and reloading returns to the level you were on. `Clear tuning` drops the local
edits without touching the manifest; only `Generate + copy` changes what ships.

- The original art generator baked a hard-edged shadow ellipse into the sprites;
  the current art has none (it is drawn on transparency), so the script below is
  only needed for art that does. `python3 sites/ffm/scripts/feather_fiend_shadows.py` removes it: it
  looks for the tone that is common in the sprite's bottom band but absent on
  the creature, falls back to the sprite set's default shadow tone, then grows
  the removal along the dithered rim. A candidate is only accepted when the
  region is wide and flat (≥30% of the sprite's width, ≤24% of its height), which
  is what keeps a creature's own flat base and claws out of the mask. Sprites it
  cannot classify are reported and left untouched, so re-running is safe - run it
  again after adding or replacing fiend art. `--report-only` measures without
  writing.
- The runtime then draws the shadow: `drawSoftShadow(ctx, x, y, rx, ry)` in
  `entities.js`, sized per creature by `fiendShadowRadii(drawW, drawH)`. The hero
  uses the same helper, so hero and fiends stand in one light; keep both on it
  rather than baking a shadow back into art.
- Fiends drawn from code (the `Slimeling`/`Bonehead`/… fallbacks, used only when
  a class sprite is missing) call the same helper.

### Asset preload and first paint

`asset-preload.js` splits the image manifest in two, and the split is what keeps
the title screen fast:

- `buildCriticalAssetManifest()` is the hero atlas and the fireball, ~0.6 MB —
  the whole of what the title screen can show. Only that list gates
  `#loading-overlay`, so the menu is interactive in ~2.8 s on a 9 Mbps / 60 ms
  link instead of ~11 s.
- `buildDeferredAssetManifest()` is the dragon, the six chapter backgrounds and
  all 60 fiend class sprites. `main.js` starts it the moment the critical list
  settles, so it downloads while the player reads the title screen and picks a
  difficulty.
- `buildAssetManifest()` is still the union of both, and `startLevel()` still
  waits for `assetsLoaded` (both lists) before painting, so the original
  guarantee holds: a fiend never appears as the procedural placeholder and then
  pops into its art.

Keep the lists disjoint — `asset-preload.test.js` asserts the union is exactly
`buildAssetManifest()` and that no URL appears in both.

The sprites themselves are WebP (see `scripts/optimize-art.py`, `SPRITE_GLOBS`):
q88 at the source resolution, because they are drawn at 152 px wide from a
256-344 px source. Converted, the 60 files went from 6.94 MB to 1.53 MB.

### Running the calibrator

```bash
node sites/ffm/scripts/serve-calibrator.mjs
#   calibrator  http://127.0.0.1:8000/game/calibrate.html
#   game        http://127.0.0.1:8000/index.html
```

It serves `sites/ffm/static` **as committed on `origin/main`** — fetched, then
extracted into a temp dir — not whatever branch you have checked out. That default
matters: a plain `python3 -m http.server` is branch-relative, so running it on an
older feature branch serves that branch's game (no level art, an old `GROUND_Y`, a
calibrator without the level or ground controls), which is indistinguishable from
a bug in the tool. `--worktree` serves the current checkout instead and warns when
it is behind `origin/main`; `--port N` and `--offline` are the other flags.

It also sends `cache-control: no-store`, which `python3 -m http.server` does not.
That matters more than it sounds: after the files change (branch switch,
`git checkout`, pull) the browser can keep an old ES module and revalidate it as
`304`, so `main.js` arrives new while, say, `asset-preload.js` stays old. The
module graph then fails at link time with a `SyntaxError: ... does not provide an
export named ...`, `main.js` never runs, and the loading bar sits at 0% with the
music already playing — it reads like a hang, not like a stale cache. If you serve
the tree another way, hard-reload once (empty cache) after switching code.

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
   - Amount: €1.99 (final customer price; determine tax obligations before launch)
   - Tax behavior: "Inclusive of tax" (so €1.99 is the final price)
4. Copy the **Price ID** (e.g., `price_1234567890ABC`) and set it in `stripe_price_id` variable
5. **DO NOT PROCEED TO LIVE** until sandbox tests and legal/compliance review are complete.

**Webhook configuration (TEST mode):**

- Stripe webhook endpoint: `/api/billing/webhook` on an explicitly configured sandbox backend. Do not point test payments at the production game.
- Pinned webhook API version: `2026-10-28.endive` (set per endpoint when it is created; an
  existing endpoint cannot change version, it is replaced — see
  `scripts/rotate-stripe-webhook-endpoint.py`)
- Every API request, including Checkout creation, uses `2026-10-28.endive`
  (`API_VERSION` in `app/stripe_provider.py`). Checkout still sets
  `managed_payments: {enabled: false}` explicitly, preserving standard Payments +
  Billing (operator as merchant of record) regardless of dashboard defaults.
- Since `2025-03-31.basil` Stripe moved fields billing reads (`invoice.charge`,
  `invoice.paid`, `invoice.subscription`, `charge.invoice`,
  `subscription.current_period_end`, line `price`/`proration`). The shape helpers
  at the bottom of `app/stripe_provider.py` read the current shape and fall back
  to the `2024-06-20` one, so events from an endpoint on either version work.
- `STRIPE_WEBHOOK_SECRET` may hold several comma-separated signing secrets, so an
  old and a new endpoint can overlap during a rotation.
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
  `2026-10-28.endive` (Stripe renders retrieved events at the account's default version), and requires `livemode` to be exactly `False` and the event's
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
   active, EUR 1.99, recurring every 3 months, `tax_behavior=inclusive`; the
   given `--portal-id` is live, active, allows cancellation
   (end-of-period) and payment-method updates with subscription
   upgrades/downgrades disabled; and no existing webhook endpoint already
   targets the production URL (stops instead of creating a duplicate).
4. Prints a summary (IDs/status only — never secret values) and requires you
   to type an exact confirmation phrase before any write happens.
5. Creates `ffm/stripe-secret-key` in Secrets Manager (plain `SecretString`,
   not JSON-wrapped).
6. Creates the LIVE webhook endpoint for `https://ffm.derschweigert.de/api/billing/webhook`,
   pinned to `api_version` `2026-10-28.endive`, subscribed to the same 10 events
   listed above, then immediately disables it (the Stripe API has no
   create-already-disabled option) — it stays disabled until the payments
   backend billing configuration is enabled and verified; nothing in the script
   re-enables it.
7. Creates `ffm/stripe-webhook-secret` from the signing secret Stripe returns
   only at endpoint-creation time.

Run from the repository root:

```bash
AWS_DEFAULT_REGION=eu-central-1 .venv/bin/python sites/ffm/scripts/setup-stripe-live.py --price-id price_1UbiJgDYFrEur0X9xkhSMSIn --portal-id bpc_1UQkquDYFrEur0X9JdDK6pAG
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
checkout for the €1.99 / 3-calendar-month recurring price; gift-code stacking and renewal
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
"Sites: deploy to production" from the Actions tab against `main`, without needing a
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

- Free vs. paid level boundary (levels 1-6 free forever, 7-60 require Premium), cross-checked
  against `app/entitlements.py`'s actual `level <= FREE_LEVELS` gate, not assumed from memory.
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
