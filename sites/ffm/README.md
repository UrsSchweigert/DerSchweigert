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
  │   ├─ story-intro.js (when the story scenes play)
  │   ├─ speedrun.js    (continuous-run clock + device records)
  │   ├─ speedrun-ui.js (hidden records card, opt-in HUD clock)
  │   └─ api.js         (auth/profile/leaderboard/high score client)
  ├─ story/             (layered paper-theatre story dioramas; see story/README.md)
  └─ /api/*
      └─ Flask app
          ├─ auth.py    (/api/auth/*)
          ├─ main.py    (/api/health, /api/profile, /api/score, /api/high-score,
          │               /api/leaderboard, /api/speedrun/*)
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
- Story dioramas (prologue, six act openings and the finish; silent text cards): `sites/ffm/static/story/`
  — art bible, scene format and pipeline in `sites/ffm/static/story/README.md`
- Store graphics (key-art masters, the compositor and the launcher-icon source):
  `sites/ffm/store-art/` — upload slots and the Pillow recipe in
  `sites/ffm/store-art/README.md`
- Marketing pack (landscape app screenshots in German and English, store copy,
  captions): `sites/ffm/marketing/` — regenerate with
  `python3 sites/ffm/marketing/tools/build.py`, see
  `sites/ffm/marketing/README.md`

## Detailed documentation

Read the README first, then only the page your change needs:

| Page | Covers |
| --- | --- |
| [docs/behavior.md](docs/behavior.md) | Gameplay and practice rules, curriculum contracts, auth/profile/leaderboard, email flows, data model and retention, rate limiting and JWT identity, legal pages and cookie consent |
| [docs/deployment.md](docs/deployment.md) | Deployment shape, CI IAM permissions for new AWS resources, promo landing page and URL routing |
| [docs/file-map.md](docs/file-map.md) | Where to start for each kind of change (gameplay, art, audio, API, mobile), plus billing and Stripe integration, the Stripe events to configure, and the legal/tax review history |

## Local development and validation

Known-good automated checks:

- `pip install -r sites/ffm/requirements-dev.txt && SECRET_KEY=ci-test-key pytest sites/ffm/tests/ -q --tb=short`
- `node --test sites/ffm/static/game/levels.test.js`

Dependency layout: `sites/ffm/requirements.in` lists the direct **production** dependencies; `sites/ffm/requirements.txt` is the fully pinned set compiled from it with `pip-compile` (Python 3.12), and it is what gets bundled into the deployed Lambda zip (see `.github/workflows/deploy.yml`'s "Build Lambda zip" step). Keep the `.in` minimal, never edit the `.txt` by hand, and regenerate it with `pip-compile --strip-extras --no-emit-index-url -o requirements.txt requirements.in` after changing the `.in`. Dependabot keeps the pins current. `sites/ffm/requirements-dev.txt` (`-r requirements.txt` plus `pytest`/`moto`/`python-dotenv`) is for local dev and CI's `test-ffm` job only — never point the Lambda build step at it.

Important local-dev caveat:

- `api.js` uses `window.location.origin + '/api'`, so the frontend expects the API on the same origin.
- Serving `sites/ffm/static/` from a plain static file server is fine for canvas-only work, but auth/high-score/leaderboard flows will fail unless that same origin also exposes the Flask API.
- Because the refresh flow relies on cookies, cross-origin hacks are brittle; for end-to-end auth work, prefer an environment that really serves both the static app and `/api/*` together.

## Historical drift / gotchas

These are the things most likely to mislead a future session:

- The original build prompt (archived in `docs/archive/ffm-original-build/`) describes a **40-level** plan; the shipped code and tests use **60 levels**.
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

## Recommended working order for future changes

1. Read this file, then the page under **Detailed documentation** that matches the change.
2. Verify whether the change is frontend-only, backend-only, or cross-cutting.
3. For gameplay changes, check `main.js` and `levels.js` before touching art or API code.
4. For persistence/leaderboard changes, check both `main.py` and `models.py`; many behaviors are split between validation and DynamoDB shape decisions.
5. For any change that adds a new AWS resource, read the CI IAM permissions section in [docs/deployment.md](docs/deployment.md) first — don't assume a green `test`/`test-ffm` CI run means `deploy`/`deploy-ffm` will also succeed.
6. Run the smallest relevant tests:
   - curriculum/problem changes -> Node test
   - auth/profile/leaderboard/backend changes -> pytest
   - cross-cutting changes -> both
