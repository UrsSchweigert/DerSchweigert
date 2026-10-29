# Landhauscheck — System Documentation

> ⚠️ **Keep this file up to date.** Every push that changes source files should include an update here.
> CI will warn if this file is not touched when `apps/` or `infra/` files change.

---


## 1. Overview

**Landhauscheck** (`landhauscheck.com`) is a personal location-aware web dashboard. It detects the user's location (GPS or manual entry) and displays live widgets for:

- **Clock + Weather** — time, 5-hour forecast, moon phase
- **Traffic Map** — Google Maps traffic layer + five-tab panel: ⛽ fuel / ⚡ EV chargers / 🚻 restrooms (Google Places) / 🏧 ATMs (Google Places)
- **Bus Connections** — live HERE transit departures
- **Train Stations** — live HERE rail departures (DB snapshot + fallback)
- **POI** — nearby Google Places points of interest
- **Garbage** — local waste collection calendar

Languages: **DE / EN / PT** (auto-detected, persisted per user).  
Units: **metric** by default, **imperial (°F / miles)** for US users (auto-detected by country code).

---

## 2. Architecture

```
Browser
  └── CloudFront (E1UNWNICC715F8)
        ├── /api/*  →  API Gateway (HTTP API)  →  Lambda (basicwebapp-backend)
        └── /*      →  S3 (basicwebapp-frontend-113725432218)
```

- **No ALB, no ECS, no RDS** — all removed to minimise cost
- **No VPC** — Lambda runs outside any VPC, reaches AWS services via public endpoints
- **Expected cost**: ~$1–3/month (Lambda free tier covers all traffic at current scale)
- **Region**: `eu-west-1` (Ireland)
- **AWS Account**: `113725432218`

---

## 3. Infrastructure Components

| Component | Resource | Notes |
|---|---|---|
| **Frontend** | S3 `basicwebapp-frontend-113725432218` | Static React/Vite SPA |
| **CDN** | CloudFront `E1UNWNICC715F8` | Two origins: S3 + API GW |
| **API** | API Gateway HTTP API | `AWS_PROXY` → Lambda |
| **Backend** | Lambda `basicwebapp-backend` | ARM64, 512MB, zip package (Python 3.12) |
| **Lambda artifact** | S3 `basicwebapp-frontend-113725432218/deployments/basicwebapp-lambda.zip` | Uploaded per deploy; Terraform does not manage the code object |
| **Stats persistence** | S3 `basicwebapp-stats-113725432218` | `stats_persist.json`, survives cold starts |
| **Secrets** | SSM Parameter Store (`/basicwebapp/` prefix, SecureString) | Free — replaces Secrets Manager (saved ~$3.60/mo) |
| **DNS** | Route 53 | `landhauscheck.com` + `www` alias |
| **TLS** | ACM `us-east-1` | `landhauscheck.com` + `www.landhauscheck.com` |
| **Logs** | CloudWatch `/aws/lambda/basicwebapp-backend` | 7-day retention |
| **IaC** | OpenTofu v1.11.5 (`tofu`) | Prod: `infra/terraform/sites/landhauscheck/` · Dev: `infra/terraform/sites/landhauscheck-dev/` |
| **Registrar** | Route 53 | Annual domain registration fee for `landhauscheck.com` |

### Dev environment — dev.landhauscheck.com
| Component | Resource | Notes |
|---|---|---|
| **Frontend** | S3 `basicwebapp-dev-frontend-113725432218` | Static React/Vite SPA (dev build) |
| **CDN** | CloudFront (see `tofu -chdir=infra/terraform/sites/landhauscheck-dev output`) | Two origins: S3 + API GW |
| **API** | API Gateway HTTP API (dev) | `AWS_PROXY` → Lambda |
| **Backend** | Lambda `basicwebapp-dev-backend` | ARM64, 512MB, zip package (Python 3.12) |
| **Stats persistence** | S3 `basicwebapp-dev-stats-113725432218` | `stats_persist.json` |
| **Secrets** | SSM Parameter Store (`/basicwebapp-dev/` prefix, SecureString) | **Free** — no Secrets Manager cost |
| **DNS** | Route 53 `dev.landhauscheck.com` | A/AAAA alias to CloudFront |
| **TLS** | ACM `us-east-1` | `dev.landhauscheck.com` |

### Removed Terraform files
| File | Reason |
|---|---|
| `alb.tf`, `ecs.tf`, `rds.tf` | ALB/ECS/RDS removed (replaced by API Gateway + Lambda; no database needed) |
| `vpc.tf` | Deleted during the monorepo migration: the VPC, subnets, IGW and route tables were leftovers from the ECS era (the Lambda runs outside a VPC). Removing the file from configuration destroyed those resources. |

---

## 4. Backend API Routes

Base path: `https://landhauscheck.com/api/v1/`

| Method | Path | Description | Auth |
|---|---|---|---|
| `GET` | `/health` | Health check | None |
| `GET` | `/weather/forecast` | 2-day weather (Open-Meteo) + moon phase | None |
| `GET` | `/transit/nearby` | Bus stops near lat/lng (HERE) | None |
| `GET` | `/transit/departures` | Live bus departures (HERE, 30min cache) | None |
| `GET` | `/transit/rail-nearby` | Train stations (DB snapshot + Google fallback) | None |
| `GET` | `/transit/poi-nearby` | Nearby POIs (Google Places, 6-month cache) | None |
| `GET` | `/waste/upcoming` | Garbage collection schedule (ICS) | None |
| `GET` | `/waste/calendar.ics` | Download the raw ICS file for the nearest calendar (for native calendar import; deduplicated by UID) | None |
| `POST` | `/waste/contribute` | Upload an ICS calendar file; creates a GitHub PR for review; requires `GH_WASTE_PAT` env var | None |
| `GET` | `/holidays` | Public holidays by country | None |
| `GET` | `/geocode` | Address → lat/lng (Google Geocoding proxy) | None |
| `GET` | `/fuel` | 4 cheapest diesel/E10 stations near lat/lng (Tankerkönig, DE only) | None |
| `GET` | `/chargers` | EV chargers, gas stations, restrooms, or ATMs near lat/lng (Google Places) – `poi_type=ev|gas|toilet|atm` | None |
| `POST` | `/admin/verify-pin` | Validates stats PIN, sets `lhc_pin` + `lhc_devmode` cookies | None (PIN in body) |
| `GET` | `/admin/stats` | Full stats JSON | `X-Stats-Pin` header required |
| `POST` | `/admin/clear-devmode` | Removes `lhc_devmode` cookie (re-enables tracking) | `X-Stats-Pin` header required |
| `GET` | `/logs` | Recent request log | None |
| `POST` | `/feature-request` | Create Jira Task in project LHC (donation thank-you) | None (PayPal redirect is implicit gate) |
| `GET` | `/notifications/manifest` | Tomorrow's waste collections for all ICS locations (CloudFront-cached 1 h) | None |

### Provider costs per route
| Route | External calls |
|---|---|
| `/transit/poi-nearby` | Google Places ×3 |
| `/transit/nearby` | HERE ×1 |
| `/transit/departures` | HERE ×1 |
| `/transit/rail-nearby` | DB snapshot (in-memory, 0 calls) |
| `/weather/forecast` | Open-Meteo ×1 (free) |
| `/geocode` | Google Geocoding ×1 |
| `/fuel` | Tankerkönig ×1 (free) |
| `/chargers` | Google Places ×1 |
| `/notifications/manifest` | 0 (ICS scan only, no external calls) |
| All others | 0 |

---

## 5. Frontend Component Map

```
App.jsx  (orchestrator, ~165 lines — owns no state directly; delegates to hooks)
├── hooks/useLocation.js        — GPS, consent, location picker visibility, reverse-geocode
├── hooks/useWidgetStatus.js    — widget statuses, errors, countdowns, on* callbacks
├── hooks/useWakeLock.js        — screen wake lock
├── hooks/usePullToRefresh.js   — pull-to-refresh
├── hooks/useHealth.js          — /health fetch
├── hooks/useAppConsole.js      — console log list
├── LocationPicker.jsx      — Reworked welcome screen: lang switcher in header, 6-card
│                             feature grid, DSGVO consent, GPS/manual entry; reset button
│                             in app footer reopens this without page reload
├── AppConsole.jsx          — Diagnostics overlay (CloudWatch logs on mount)
├── GoogleMapWidget.jsx     — Traffic map + five-tab inline panel (⛽⚡🚻🏧);
│   │                         420 lines (refactored from 753 in v1.3.1)
│   ├── MapPanel.jsx        — Card list + mini-map container for tabs 1-4;
│   │                         uses forwardRef so parent controls map instance lifecycle
│   └── mapUtils.js         — Shared utilities: loadGoogleMapsScript() singleton,
│                             MAP_STYLES palette, haversineKm(); imported by
│                             GoogleMapWidget, RoutingWidget, TransitWidget
├── ClockWidget.jsx         — Clock + 5h weather + moon phase
├── TransitWidget.jsx       — Bus departures + StationOverlay (walking route)
├── RoutingWidget.jsx       — Train departures + TrainOverlay (driving route)
├── PoiWidget.jsx           — Nearby POIs + RouteOverlay (walking route)
├── GarbageWidget.jsx       — Waste collection calendar; fires onTomorrowEvents when tomorrow
│                             has collections (used by App.jsx for the dismissible banner)
├── WidgetHelp.jsx          — Reusable ? popup (i18n-aware, all widgets)
└── LiveBadge.jsx           — Status badge (live/loading/error/countdown)

hooks/usePushNotifications.js  — SW registration; syncs location+lang to SW via postMessage;
                                 schedules setTimeout at 17:00 and 20:00 local time; fetches
                                 notification manifest and posts NOTIFY_CHECK to SW;
                                 registers Periodic Background Sync (Chrome/Android, 12 h);
                                 manages Notifications API permission lifecycle;
                                 markCalendarExported(): sets localStorage dedup flag + calExported
                                 state; actual calendar download handled by /calendar-import.html;
                                 calExported state drives 📅 button (green after first export)
public/sw.js                   — Service worker: stores user location+lang in Cache API;
                                 matches manifest entries to user location via haversine (≤3 km);
                                 dedup guard per (date, slot) pair; showNotification() at 17h/20h;
                                 handles periodicsync for Chrome/Android background wake;
                                 handles notificationclick to focus/open the app window
```

### State flow
- `App.jsx` is a lean orchestrator (~165 lines); all state lives in 6 custom hooks under `src/hooks/`
- `useLocation` — GPS, consent, location picker visibility, reverse-geocode trigger
- `useWidgetStatus` — all widget statuses, errors, countdowns, `lastUpdated`, stable `on*` callbacks
- `useWakeLock` — screen wake lock, re-acquires on `visibilitychange`
- `usePullToRefresh` — touch pull-to-refresh with visual indicator
- `useHealth` — backend `/health` fetch
- `src/config/api.js` supplies a shared absolute API base for health, widgets,
  geocoding, notifications, logs and calendar export/import links. Production
  builds always use `window.location.origin` (including `www`, dev and CloudFront
  aliases); `VITE_API_BASE_URL` overrides apply only to the Vite development
  server, which defaults to `http://localhost:8000`. AWS frontend builds do not
  embed a fixed API hostname. Keep API requests same-origin rather than relaxing
  CSP/CORS for site aliases. Both environments allow `worker-src 'self' blob:`
  for the site's service worker and map workers.
- `useAppConsole` — console log list + `addLog`; `AppConsole.jsx` renders the overlay
- Diagnostics retain the latest 100 app events, including failed frontend fetches
  (endpoint without query/fragment/credentials, method, elapsed time, HTTP status or
  browser error, same/cross-origin and online/offline context). CSP violation events
  identify enforced vs report-only policies and blocked targets. Generic fetch
  failures list possible causes without claiming to distinguish CORS, DNS, TLS or
  filtering, which browsers do not expose to JavaScript. The console shows the
  current page origin and explicitly reports failures to retrieve CloudWatch logs.
  SDK-internal and service-worker requests are not instrumented.
- `lang` and `countryCode` are passed as props to every widget
- `countryCode` drives: unit system (US → imperial), fuel tab availability (DE only for Tankerkönig prices)
- `lang` drives: all UI strings via `t(lang, key)` from `sites/landhauscheck/frontend/src/config/i18n.js`
- Adding a new widget: add one `{ id, cssClass }` entry to the `WIDGETS` constant in `App.jsx` and one `id === 'newwidget'` case in the renderer
- All six widget positions are wrapped in `<ErrorBoundary>` — a widget crash shows an inline error message without blanking the rest of the app

---

## 6. Map Widget — Icon Tab Panel

The traffic map widget has five icon-only tabs (emoji used as icon, full label in `aria-label`/`title`):

| Tab | Icon | Data source | Behaviour |
|---|---|---|---|
| Traffic | 🚦 | Google Maps TrafficLayer | Always visible |
| Fuel | ⛽ | Tankerkönig (DE, prices) · Google Places `gas_station` (non-DE, name only) | DE: real-time prices; all others: locations |
| EV Charger | ⚡ | Google Places `electric_vehicle_charging_station` | All countries |
| Restrooms | 🚻 | Google Places (`public_bathroom`, `fast_food_restaurant`, `cafe`, `coffee_shop`, `gas_station`) | All countries |
| ATM | 🏧 | Google Places `atm` | All countries |

**Behaviour:**
- All four datasets fetched in parallel on first non-traffic tab open
- 15-minute client-side cache per location; cache cleared when user moves >0.5 km
- Up to 6 results for fuel/EV, up to 8 for restrooms/ATMs (sorted by distance)
- Tapping a card → NavPromptSheet (driving for fuel/charger, walking for restrooms/ATMs)
- **Manual location fix**: when `locationSource === "manual"` the GPS `watchPosition` is stopped so the map marker stays fixed on the manually chosen place permanently
- **`MapPanel` stays mounted after first visit** (hidden via `display:none`, same pattern as the traffic map `<div>`). This keeps `fuelMapInstanceRef` bound to the same live DOM node across all tab switches; without this, returning to a non-traffic tab after visiting traffic causes the mini-map to render blank (tiles show, map tiles don't). `panelEverOpenedRef` tracks whether the panel has been opened at least once.

**Location fix behaviour:**
- `locationSource` prop passed from `useLocation` (values: `"gps"` | `"manual"`)
- A `useEffect` in `GoogleMapWidget` clears `watchPosition` immediately when source becomes `"manual"`
- A `locationSourceRef` (always-current ref, not in deps) guards the watchPosition callback against late GPS events arriving after a manual switch

---

## 7. i18n — Multilanguage Support

**Languages**: DE (default), EN, PT

**Detection order**: `localStorage.lhc_lang` → `navigator.language` prefix → DE

**Source of truth**:
- React app: `sites/landhauscheck/frontend/src/config/i18n.js` — `t(lang, key)` helper
- Static HTML pages: inline `var dict = {de:{...}, en:{...}, pt:{...}}` at top of `<script>`

**Unit system** (driven by `countryCode`):
| Country | Temperature | Distance |
|---|---|---|
| US | °F | feet / miles |
| All others | °C | metres / km |

⚠️ **Rule**: whenever any user-visible string is added or changed, update **all three language blocks** in both `i18n.js` and all relevant static HTML files.

---

## 8. Dev Fixture Cache

The backend includes a **record-and-replay fixture cache** for all outbound `httpx.AsyncClient` calls. It is **never active in production** (the `DEV_CACHE_MODE` env var defaults to `"off"` and is never set in the Lambda / Terraform configuration).

### Modes

| `DEV_CACHE_MODE` | Behaviour |
|---|---|
| `off` (default) | Normal operation — all requests go straight to the network |
| `on` | Serve pre-recorded fixture files; raise `httpx.ConnectError` on cache miss |
| `record` | Make real network calls **and** save responses as fixture files (seed mode) |

### Fixture files

- Stored in `sites/landhauscheck/app/data/fixtures/<key>.json`
- Key = first 20 hex chars of SHA-256 over `METHOD|url-without-api-keys|body`
- Committed to git so developers can work without API credentials
- Pre-seeded for **Mägdebergstrasse 5, Singen (Hohentwiel)** — lat 47.7632 / lng 8.8376

### Per-request bypass

Send header `X-Dev-Cache-Bypass: 1` with any request to skip the fixture for that call (hits the live upstream API). The FastAPI middleware propagates this into a Python `contextvars.ContextVar` so no route code is aware of it.

### Seeding / refreshing fixtures

```bash
# 1. Start local backend in record mode
DEV_CACHE_MODE=record docker-compose -f sites/landhauscheck/docker/docker-compose.local.yml up --build -d

# 2. Run the seed script
python scripts/seed_dev_fixtures.py

# 3. Commit fixtures, then switch to on for future local runs
DEV_CACHE_MODE=on docker-compose -f sites/landhauscheck/docker/docker-compose.local.yml up -d
```

### Key source files

| File | Purpose |
|---|---|
| `sites/landhauscheck/app/core/dev_cache.py` | `DevCacheTransport`, `install()` monkey-patch, contextvar, bypass logic |
| `sites/landhauscheck/app/data/fixtures/` | Pre-recorded JSON fixture files |
| `sites/landhauscheck/app/data/fixtures/README.md` | Fixture format documentation |
| `scripts/seed_dev_fixtures.py` | Seed all endpoints for the Singen reference address |
| `sites/landhauscheck/docker/docker-compose.local.yml` | `DEV_CACHE_MODE` env var (defaults to `off`) |

---

## 9. Secrets & API Keys

All secrets stored in **AWS SSM Parameter Store** (SecureString, Standard tier — free). Values are read at `tofu apply` time and baked into Lambda environment variables. Lambda does not call SSM at runtime.

Prod parameters use prefix `/basicwebapp/`; dev uses `/basicwebapp-dev/`.

| Secret name | Env var | Used in | Restriction |
|---|---|---|---|
| `/basicwebapp/google-maps-api-key` | `GOOGLE_MAPS_API_KEY` | Lambda (Directions, Places, Geocoding) | API restriction only |
| `/basicwebapp/google-maps-browser-api-key` | `VITE_GOOGLE_MAPS_API_KEY` | Frontend bundle | HTTP referrer: `landhauscheck.com/*` |
| `/basicwebapp/here-api-key` | `HERE_API_KEY` | Lambda (transit, departures) | None |
| `/basicwebapp/here-browser-api-key` | `VITE_HERE_API_KEY` | Frontend bundle | Domain: `landhauscheck.com` |
| `/basicwebapp/db-stada-api-key` | `DB_STADA_API_KEY` | Lambda + refresh-stations cron | None |
| `/basicwebapp/google-maps-browser-api-key` | — | Frontend build via `deploy.sh` | — |
| `/basicwebapp/tankerkoenig-api-key` | `TANKERKOENIG_API_KEY` | Lambda (fuel prices, DE only) | None |
| `/basicwebapp/jira-api-key` | `JIRA_API_KEY` | Lambda (`/api/v1/feature-request` — creates Jira Tasks in project LHC) | Atlassian API token; generate at id.atlassian.com |

**Critical rules:**
- **Never** add referrer/domain restriction to server-side keys — Lambda has no `Referer` header
- **Never** call Google Geocoding REST API from the browser with a referrer-restricted key — it is explicitly blocked by Google regardless of `Referer` header. Always proxy via `/api/v1/geocode`
- **Never** use `aws lambda update-function-configuration --environment` for resets — it wipes all env vars. Use `--description` only.

**Dev environment secrets (SSM Parameter Store — free)**

Both prod and dev now use SSM SecureString. Prod prefix: `/basicwebapp/`. Dev prefix: `/basicwebapp-dev/`. Same key names, same values. Values are injected at `tofu apply` time. `infra/terraform/sites/landhauscheck/ssm.tf` (prod) and `infra/terraform/sites/landhauscheck-dev/ssm.tf` (dev) define the parameters; both IAM roles have `ssm:GetParameter` on their respective prefix.

---

## 10. Security

### HTTP Security Headers (CloudFront response headers policy)
| Header | Value |
|---|---|
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains; preload` |
| `Content-Security-Policy` | Allowlists: Google Maps, HERE, Open-Meteo, BigDataCloud, `cdn.jsdelivr.net`, `unpkg.com` |
| `X-Frame-Options` | `DENY` |
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=(self), payment=()` |

### Stats Page PIN Protection
- CloudFront Function intercepts every `/stats.html` request at the edge
- Checks `lhc_pin` cookie → redirects to `/stats-login.html` if missing/wrong
- `stats-login.html` POSTs to `/api/v1/admin/verify-pin` (PIN validated server-side against `STATS_PIN` env var); on success, sets **both** `lhc_pin` and `lhc_devmode=1` cookies via JS (not HttpOnly, so client JS can read them)
- `GET /api/v1/admin/stats` also validates `X-Stats-Pin` header (defence in depth)
- PIN is never present in HTML source
- PIN comparison uses `secrets.compare_digest()` (timing-safe; prevents timing-based enumeration)

### Developer Traffic Exclusion (`lhc_devmode` cookie)
- `stats-login.html` sets `lhc_devmode=1` (1-year, SameSite=Strict, Secure) via JS on successful login
- CloudFront `/api/*` behavior whitelists `lhc_devmode` — the cookie is forwarded to Lambda
- The stats middleware in `main.py` skips all tracking (endpoint hits, session, provider costs, error log) when the request carries `lhc_devmode=1`
- `stats.html` shows an amber badge ("👤 Dein Traffic wird nicht gezählt") when the cookie is present (detected via `document.cookie`)
- `POST /api/v1/admin/clear-devmode` removes the cookie (PIN-protected via `X-Stats-Pin` header); badge shows a "Zurücksetzen" button

### CI Security Scanning (every push to main)

- Backend tests use pytest 9 with pytest-asyncio 1.4 (the old 0.26 plugin
  requires pytest <9). Runtime pins include pydantic-settings 2.14.2 and
  python-multipart 0.0.31 to clear the dependency audit. The frontend lockfile
  resolves patched dependencies within existing package ranges, including
  Vite 8.3.5 and Vitest 4.1.12; commit lockfile updates alongside dependency fixes.
- `bandit -r app -ll -ii --skip B108` — fails on HIGH/CRITICAL Python findings
- `pip-audit` — fails on any known CVE in Python dependencies
- `npm audit --audit-level=high` — fails on HIGH/CRITICAL npm CVEs

---

## 11. Deployment

> **Rule: always deploy to `dev.landhauscheck.com` and explicitly confirm you have tested the change before running any prod deployment.**
> `deploy.sh` enforces this with an interactive confirmation prompt. Bypass in CI with `DEPLOY_CONFIRMED=yes`.

### Quick reference
```bash
# Full deploy (backend + frontend + infra)
bash scripts/deploy.sh aws

# Backend only (Python/Lambda changes)
bash scripts/deploy.sh aws --backend-only

# Frontend only (React/CSS/JS changes)
bash scripts/deploy.sh aws --frontend-only

# Infrastructure only (Terraform changes)
bash scripts/deploy.sh aws --infra-only

# Dev environment
bash scripts/deploy.sh aws --env dev                  # full dev deploy
bash scripts/deploy.sh aws --env dev --backend-only   # dev Lambda update
bash scripts/deploy.sh aws --env dev --frontend-only  # dev frontend
bash scripts/deploy.sh aws --env dev --infra-only     # dev tofu apply

# Force Lambda cold start (resets in-memory stats) — safe, preserves all env vars
aws lambda update-function-configuration \
  --function-name basicwebapp-backend \
  --description "reset-$(date +%s)" \
  --region eu-west-1

# Terraform
cd infra/terraform && tofu plan
cd infra/terraform && tofu apply
```

### What deploy.sh does
1. **Backend**: builds the Lambda zip with manylinux `aarch64` wheels (`pip install --platform manylinux2014_aarch64 -t build/`, then `app/` copied in), uploads it to `s3://<site-bucket>/deployments/<app>-lambda.zip`, calls `update-function-code`, waits for `function-updated`
2. **Frontend**: builds React with Docker (Node 20), fetches `VITE_GOOGLE_MAPS_API_KEY` + `VITE_HERE_API_KEY` from SSM Parameter Store (`/basicwebapp/` or `/basicwebapp-dev/` prefix), `aws s3 sync dist/ s3://...`
3. **releases.json**: `generate_releases_json()` fetches GitHub Releases API with 4-level token fallback (GH_TOKEN env → `gh auth token` CLI → `git credential fill` → `github_token` from `terraform.tfvars`) and writes `sites/landhauscheck/frontend/public/releases.json` before the frontend build. On **backend-only** prod deploys, `push_releases_json_to_s3()` also regenerates and uploads `releases.json` directly to S3 (bypasses the frontend build) + CloudFront invalidation for `/releases.json` + `/release-notes.html`.
4. **HTML no-cache**: `index.html`, `stats.html`, `impressum.html`, `datenschutz.html`, `stats-login.html`, `release-notes.html`, `help.html`, `calendar-import.html` uploaded with `Cache-Control: no-cache, no-store, must-revalidate`
5. **CloudFront invalidation**: `/*` + all HTML paths

### Lambda packaging
The function is a zip, not a container image. `ecr.tf` and the
`backend_image_tag` variable are retained but no longer wired to the Lambda, so
the last image-based build stays available for rollback; both can be deleted once
the zip deploy is proven. Terraform sets `ignore_changes = [s3_key]` on the
function, so only the deploy pipeline changes the deployed code.

### GitHub Actions workflows
Workflows live at the monorepo root (`.github/workflows/`) and are shared across sites,
so each one gates its jobs on the changed paths.

| Workflow | Trigger | What it does |
|---|---|---|
| `deploy.yml` → `test-lhc` | Push to main / PRs touching `sites/landhauscheck/**` | Ruff lint, backend unit tests, frontend Vitest, Vite build |
| `deploy.yml` → `deploy-lhc` | Push to main (after `test-lhc`) | OpenTofu apply, Lambda zip build/upload/update, frontend build + S3 sync + CloudFront invalidation, smoke test |
| `waste-calendar-review.yml` | PR touching `sites/landhauscheck/app/data/waste/**.ics` | Runs `scripts/review_waste_pr.py`: validates ICS, content-moderates, posts GitHub review, squash-merges on APPROVE. Branch filter: `waste/contrib-*`, `waste/update-*`, `waste/expire-*`. |
| `refresh-stations.yml` | Monthly cron (1st, 03:00 UTC) | Re-downloads DB station snapshot, auto-commits if changed |

### Required GitHub Secrets
| Secret | Purpose |
|---|---|
| `AWS_ACCESS_KEY_ID` | AWS auth |
| `AWS_SECRET_ACCESS_KEY` | AWS auth |
| `AWS_REGION` | `eu-west-1` |
| `TF_VAR_HERE_API_KEY` | Lambda server key (HERE transit) |
| `TF_VAR_HERE_BROWSER_API_KEY` | Frontend build `VITE_HERE_API_KEY` |
| `TF_VAR_GOOGLE_MAPS_API_KEY` | Lambda server key (Directions/Places/Geocoding) |
| `TF_VAR_GOOGLE_MAPS_BROWSER_API_KEY` | Frontend build `VITE_GOOGLE_MAPS_API_KEY` |
| `TF_VAR_DB_STADA_CLIENT_ID` | DB station refresh |
| `TF_VAR_DB_STADA_API_KEY` | DB station refresh |
| `GH_WASTE_PAT` | `waste-calendar-review.yml` — PAT with `repo` + `pull_requests: write` scopes |

---

## 12. Local Development

```bash
# Start local stack (FastAPI on :8000, React on :5173)
docker-compose -f sites/landhauscheck/docker/docker-compose.local.yml up --build -d

# Backend tests (61 unit tests, no network)
cd sites/landhauscheck && PYTHONPATH=. pytest -q --ignore=tests/smoke

# Frontend hook tests (20 vitest tests)
cd sites/landhauscheck/frontend && npm test

# Smoke tests (against local)
cd sites/landhauscheck && BASE_URL=http://localhost:8000 PYTHONPATH=. pytest tests/smoke/ -v

# Smoke tests (against production)
cd sites/landhauscheck && BASE_URL=https://landhauscheck.com PYTHONPATH=. pytest tests/smoke/ -v
```

**Local env vars** (`sites/landhauscheck/.env` — gitignored):
```
GOOGLE_MAPS_API_KEY=...
HERE_API_KEY=...
DB_STADA_API_KEY=...
TANKERKOENIG_API_KEY=...
STATS_PIN=3009
```

---

## 13. Stats System

- **In-memory**: `stats_store.py` — endpoint hits, sessions, error log, provider counts, `waste_contributions_total`, `waste_contributions_by_day`
- **Persistence**: flushes to S3 (`stats_persist.json`) + `/tmp` on every write. Loaded on Lambda cold start.
- **Developer exclusion**: requests with `lhc_devmode=1` cookie are skipped entirely by the stats middleware — no endpoint hit, no session, no provider cost counted. Cookie set on stats login, removed via `POST /admin/clear-devmode`.
- **Waste counters**: `_record_contribution()` in `waste_contribute.py` increments both counters on every successful PR creation; `_count_waste_calendars()` in `stats.py` globs `data/waste/*.ics` on each GET
- **Session active window**: 5 minutes (`ACTIVE_WINDOW_S = 300`)
- **Session location**: extracted from `lat/lng` query params on paths in `_LOCATION_PATHS` (excludes `/transit/nearby` — those are station coordinates, not user location)
- **Bot detection**: `ua_short` containing "CloudFront", "Googlebot", "bot", "crawl", "spider", "curl", "python-requests"
- **CloudFront health probes**: ~2,880/day — excluded from human session count, shown separately in stats.html
- **Reset procedure**: delete `s3://basicwebapp-stats-113725432218/stats_persist.json`, then force cold start via `--description` (see §10)

---

## 14. Overlay Pattern (Bus / Train / POI)

All three route overlay widgets share the same pattern:

1. Parent widget renders overlay component when `selectedItem` state is non-null
2. Overlay calls `loadGoogleMapsScript()` (singleton), initialises `google.maps.Map` with `center: midpoint, zoom: 13/14`
3. `DirectionsRenderer` (`preserveViewport: false`) renders the route → zoom-in effect from mid to route bounds
4. Tap anywhere on overlay → dismiss (fade out 0.3s)
5. CSS class: `.poiRouteOverlay` / `.poiRouteOverlay--visible` (in `styles.css`)

**Critical**: `useEffect(init, [])` with empty deps — never put `stop`/`poi`/`station` object in the dep array (causes re-init loop).

---

## 15. Key Data Files

| File | Contents | Update frequency |
|---|---|---|
| `sites/landhauscheck/app/data/db_stations.json` | ~5411 DB train stations (CC BY 4.0) | Monthly via GitHub Actions |
| `sites/landhauscheck/app/data/locations.json` | Garbage calendar location registry | Manual (add new locations) |
| `sites/landhauscheck/app/data/waste/` | ICS waste calendar files | Manual + community contributions (via `POST /waste/contribute` → GitHub PR) |

---

## 16. Changelog — Major Milestones

| Date | Change |
|---|---|
| 2026-04-04 | ALB + ECS + RDS removed; Lambda + API Gateway deployed (~$1–3/month) |
| 2026-04-04 | Frontend multilanguage support (DE/EN/PT) across all widgets + static pages |
| 2026-04-04 | Split Google Maps key into browser + server keys; same for HERE |
| 2026-04-04 | Stats page PIN protection (CloudFront Function + backend validation) |
| 2026-04-04 | HTTP security headers via CloudFront response headers policy |
| 2026-04-04 | CI security scanning (bandit + pip-audit + npm audit) |
| 2026-04-04 | Fuel station overlay (Tankerkönig, DE; Google Places, global) |
| 2026-04-04 | EV charger overlay (Google Places, global) + 3-tab map widget (Traffic/⛽/⚡) |
| 2026-04-04 | Imperial units for US users (°F, mph, miles) across all 5 widgets |
| 2026-04-04 | Geocoding proxied through Lambda (fixes referrer-restriction Google block) |
| 2026-04-04 | Portrait mobile banner (L logo + "landhauscheck" / "alles nah") |
| 2026-04-04 | Widget `?` help buttons (WidgetHelp.jsx, i18n-aware, all widgets) |
| 2026-04-04 | Map colour scheme matched to favicon blue palette (MAP_STYLES) |
| 2026-04-04 | Dev environment deployed: `dev.landhauscheck.com`, `infra/terraform/sites/landhauscheck-dev/`, SSM Parameter Store secrets (free) |
| 2026-04-04 | docs/SYSTEM.md created; CI staleness check added |
| 2026-04-04 | All overlay close buttons replaced with explicit × button (fuel/charger); tap-to-close restored for bus/train/POI |
| 2026-04-04 | Dead code removed: widgets CRUD layer (routes/service/repository/schema/model + db/session), HERE-based MapWidget.jsx; test_widgets.py → test_stats.py; asyncio.ensure_future → starlette BackgroundTask |
| 2026-04-04 | `App.jsx` refactored (~800 → ~165 lines) into 6 custom hooks + `AppConsole.jsx`; `WIDGETS` constant array replaces fragile name-string matching — released as v1.0.0 |
| 2026-04-04 | Welcome screen reworked: 6-card feature showcase grid (colour-coded per widget), language switcher moved to header, DSGVO consent redesigned with welcoming copy, reset button added to app footer (reopens picker without reload); all strings in DE/EN/PT — released as v1.1.0 |
| 2026-04-04 | Navigation prompt: tap any tile (fuel/charger/station/POI/toilet) → bottom sheet → opens Apple Maps / Google Maps / HERE Maps. Implemented via `NavPromptSheet.jsx` + `createPortal` (avoids `overflow:hidden` clipping). iOS uses `maps://`, Android uses `geo:` intent (OS chooser), desktop opens Google Maps web |
| 2026-04-04 | Restroom widget: OSM Overpass (3-mirror parallel race, 4s timeout) + Google Places `public_bathroom` as parallel fallback; embedded in `/poi-nearby` response for zero-latency first paint; name fallback chain: name → operator → addr:street+number → addr:street → "Öffentliche Toilette" |
| 2026-04-04 | POI refactor: single `searchNearby` request with Unterhaltung/Restaurant/Shopping categories; dead code removed (Overpass + text-search + OSM tag maps, −219 lines) |
| 2026-04-04 | Version transparency: footer shows `v{version}` linked to `/release-notes.html` (fetches GitHub Releases API, renders markdown); `package.json` version = `1.2.0`; `__APP_VERSION__` injected via Vite `define`. Stats page gains API request budget table (11 on load, ~35/hour) — released as v1.2.0 |
| 2026-04-04 | Bug fix: `NavPromptSheet` now respects `travelMode` prop — restroom widget tiles open walking directions (iOS: `dirflg=w`, Android: `google.navigation:q=…&mode=w`, desktop: `travelmode=walking`). All other widgets continue to use driving. Version bumped to v1.2.1 |
| 2026-04-04 | Progressive restroom loading: frontend fires `source=google` and `source=osm` simultaneously; renders first winner; merges when second arrives (OSM upgrades fee/hours/wheelchair fields in-place, no flicker). HERE pedestrian routing enriches all results with real walk times. Released as v1.2.2 |
| 2026-04-04 | Restroom tiles: always sorted by distance ascending after each source merge; `subtitle` field added (OSM: `addr:street+housenumber` shown below name for location context; Google: `shortFormattedAddress`); `shortFormattedAddress` added to Google Places field mask. AWS Registrar cost explained (Route 53 domain registration, ~$14/yr, not app infra). Released as v1.2.3 |
| 2026-04-05 | Waste calendar contribution system: `POST /api/v1/waste/contribute`, GarbageWidget upload UI (always-visible upload button, expired-state detection), auto-review agent (`waste-calendar-review.yml` + `scripts/review_waste_pr.py`), content moderation (`_check_harmful_content()`, 40+ regex patterns EN/DE/PT), duplicate detection (filename suffix + GitHub code search), contribution counters (`waste_contributions_total`, `waste_contributions_by_day`) persisted to S3, 2 new stats.html cards (Abfall-Kalender + Kalender-Beiträge), picker feature card descriptions updated DE/EN/PT, 61 unit tests. Released as v1.3.0. |
| 2026-04-05 | Security: `python-multipart` 0.0.20 → 0.0.22 (CVE-2026-24486, commit `b4c271c`); bandit B310 resolved by explicit HTTPS scheme validation before `urlopen` in `waste_contribute.py` + `# nosec B310` (commit `3dcf4fd`). CI green. |
| 2026-04-05 | v1.3.1: Help page (`/help.html`) — trilingual (DE/EN/PT), 9 sections, glass-morphism design, `lhc_lang` localStorage lang switcher. Portrait banner `?` button (`.appBanner__helpBtn`, 28px circular glass); `aria-hidden` removed from banner; help link in footer; `help` i18n key in all 3 locales. `deploy.sh` `generate_releases_json()` with 4-level token fallback + `push_releases_json_to_s3()` for backend-only prod deploys; `help.html` added to no-cache list. `package.json` bumped `1.2.5` → `1.3.1`. Tag `v1.3.1` + GitHub release ID 305431725. Deployed to prod. |
| 2026-04-05 | Code quality (chore/code-quality branch, deployed to prod as merge commit `9b8f5db`): **Backend** — `transit.py` (875 lines) split into `transit/` package: `bus.py`, `rail.py`, `poi.py`, `restrooms.py`, `_cache.py`, `_shared.py`, `__init__.py`; `# nosec B108` added to all three `/tmp` paths (`_cache.py` ×2, `stats_store.py`); 61 unit tests updated and passing. **Frontend** — `GoogleMapWidget.jsx` split: utilities → `mapUtils.js` (loadGoogleMapsScript, MAP_STYLES, haversineKm), card panel → `MapPanel.jsx` (forwardRef); `GOOGLE_MAPS_API_KEY` const restored in GoogleMapWidget (blank-screen regression fix); `MapWidget` wrapped in `ErrorBoundary` in `App.jsx`; vitest + `@testing-library/react` + jsdom added; `useLocation.test.js` (11 tests) + `usePullToRefresh.test.js` (9 tests). All 20 frontend + 61 backend tests pass. |
| 2026-04-06 | v1.3.2: **Bug fix** — `useLocation.js` scroll-lock effect: portrait mode body is scrollable (`overflow-y:auto`); re-opening the location picker and typing an address caused iOS Safari to shift `window.scrollY`; on close widgets/background appeared broken (overflowing/misaligned). Fix: `position:fixed + top:-scrollY + overflow:hidden` on `body` while picker is open; restore + `scrollTo(0,0)` on close. **UX** — `LocationPicker.jsx` adds a `soloProjectNote` paragraph below the feature grid (DE/EN/PT) noting this is a solo project and inviting a donation via link to `/donate.html`; `.locPicker__soloNote` CSS added. |
| 2026-04-06 | v1.3.4: **Bug fix (location picker auto-dismiss)** — two complementary fixes in `useLocation.js`: (1) `openLocationPicker()` increments `gpsAttemptRef` before opening the picker, invalidating any in-flight `getCurrentPosition` success callback that would otherwise still pass the stale-check and call `setLocationPickerOpen(false)`; (2) removed `setLocationPickerOpen(false)` from the GPS success callback entirely — the picker is now only closed by explicit user actions (`onRetryGPS` closes it before starting GPS; `handleManualLocation` closes it on address pick). Rule: only user actions close the picker. `App.jsx` uses `openLocationPicker` for the footer 📍 button and AppConsole change-location action. **Bug fix (portrait scroll)** — scroll-lock effect added to `useLocation.js`: `position:fixed + top:-scrollY + overflow:hidden` on `body` while picker is open; `scrollTo(0,0)` on close — prevents iOS Safari from shifting `window.scrollY` via keyboard, which caused widgets/background to appear broken when the picker closed. **UX** — `LocationPicker.jsx`: solo-project donation note added below feature grid (DE/EN/PT); `soloProjectNote` uses restructured first-person sentence with verb before linked noun so the link text ("Kaffee" / "coffee" / "café") renders naturally without a suffix key; link points to `/donate.html`. `.locPicker__soloNote` CSS added. |
| 2026-04-06 | v1.3.5: **Bug fix (pull-to-refresh in location picker)** — `usePullToRefresh` now accepts a `disabled` prop; `App.jsx` passes `locationPickerOpen` so pull-to-refresh gestures are fully suppressed while the picker is open. Previously the scroll-lock (`position:fixed`) forced `window.scrollY` to `0`, meaning every downward swipe inside the picker was eligible and triggered a page reload + x-axis overflow. `ruff` E501 + F401 lint fixes in `stats.py` and `transit/rail.py`. CI green. |
| 2026-04-06 | v1.3.6: **Bug fix (Android horizontal x-overflow)** — moved scroll root from `body` to `.layout` div: `.layout` gets `height:100dvh; overflow-x:hidden; overflow-y:auto; overscroll-behavior:none` in portrait; `html` and `body` portrait overrides removed. Fixes Android Chrome bug where `overflow-x:hidden` on `body` is ignored as a clipping boundary, allowing horizontal scroll. `usePullToRefresh` hook fully removed from `App.jsx` (was picker-scoped in v1.3.5); `overscroll-behavior:none` on `.layout` suppresses native pull-to-refresh natively. **Bug fix (scroll-lock)** — `useLocation.js` scroll-lock retargeted from `body`/`window` to `.layout`: reads `layout.scrollTop`, sets `layout.style.overflowY="hidden"`, restores `layout.scrollTop=0` on close; old `position:fixed+top:-scrollY` body trick was a no-op once `.layout` became the scroll container. **Bug fix (portrait glass panel)** — portrait `.panel` gains `align-self:start` so the CSS grid no longer stretches it to `100dvh`; glass background now extends to the bottom of all widget content instead of cutting off mid-page. **UX (footer)** — app footer restructured from 2 crowded rows to 3 rows: (1) Help · Impressum · Datenschutz, (2) Donate · Release Notes, (3) lang switcher · 📍. `package.json` bumped `1.3.5` → `1.3.6`. Deployed to prod (frontend only). |
| 2026-04-06 | **Developer traffic exclusion (devmode cookie)**: `stats-login.html` sets `lhc_devmode=1` cookie (1-year, SameSite=Strict, Secure, not HttpOnly) via JS on successful PIN login. CloudFront `/api/*` behavior updated to whitelist `lhc_devmode` for forwarding to Lambda. Stats middleware (`main.py`) skips all tracking when `lhc_devmode=1` is present. `stats.html` shows an amber "👤 Dein Traffic wird nicht gezählt" badge (detected client-side via `document.cookie`). New `POST /api/v1/admin/clear-devmode` endpoint (PIN-protected) removes the cookie; badge has a "Zurücksetzen" button that calls it. Stats and Lambdas on both dev and prod reset (S3 file deleted + Lambda description recycled). |
| 2026-04-07 | v1.3.7: **Resilience — Bright Sky / DWD weather fallback**: `weather.py` now tries Open-Meteo first (8 s timeout); on any `HTTPStatusError` or `RequestError` it transparently falls back to `api.brightsky.dev` (DWD data, no API key, Central-European coverage). Bright Sky icon strings mapped to WMO codes via `_ICON_TO_WMO` dict. Bright Sky returns UTC ISO-8601 timestamps (`+00:00`); response is tagged `utc_timestamps: true` so the frontend can normalise. `ClockWidget.jsx` converts UTC slots to local-time strings via `new Date()` before slot-matching and display — no user-visible difference. Imperial temperature converted in the backend (`°C × 9/5 + 32`). 4 new tests added (fallback success, UTC timestamp format, imperial conversion, all-sources-fail → 503); 8/8 weather tests pass, 64/64 total. **CI fixes**: `deploy-aws.yml` gained `DEPLOY_CONFIRMED: "yes"` so the prod safety-gate does not hang the non-interactive runner; Vite upgraded `8.0.3 → 8.0.5` (fixes GHSA-4w7w-66w2-5vf9, GHSA-v2wj-q39q-566r, GHSA-p9ff-h696-f583 — dev-server path traversal + file read); stale `package-lock 2.json` duplicate removed. `package.json` bumped `1.3.6 → 1.3.7`. Full stack deployed to prod (Lambda + frontend). |
| 2026-04-07 | **Infra cost reduction — SSM Parameter Store replaces Secrets Manager** (prod): `infra/terraform/sites/landhauscheck/secrets.tf` deleted; `infra/terraform/sites/landhauscheck/ssm.tf` created with 9 `aws_ssm_parameter` SecureString resources under `/basicwebapp/` prefix. `lambda.tf` updated to reference `aws_ssm_parameter.*.value` instead of `data.aws_secretsmanager_secret_version.*.secret_string`. `iam.tf` gains `lambda_ssm_read` inline policy (`ssm:GetParameter` on `/basicwebapp/*`). `scripts/deploy.sh` prod frontend path now reads browser keys from SSM instead of Secrets Manager. Saves ~$3.60/month ($43/year). Zero-downtime migration: SSM parameters created first (targeted `tofu apply`), then full apply updated Lambda env vars and destroyed Secrets Manager resources. Smoke-tested: health + weather API both return 200. |
| 2026-04-21 | **iOS calendar import — WKWebView fix (HEAD, post-v1.3.13)**: `CalendarPickerModal` in `App.jsx` replaced two-option picker (direct ICS download + webcal anchor) with a single "Kalender-Anleitung öffnen" `<a>` link opening `/calendar-import.html?lat=...&lng=...&lang=...&base=...`. New file `sites/landhauscheck/frontend/public/calendar-import.html`: standalone static helper page that opens in real Safari (escaping the WKWebView sandbox); auto-detects platform (iOS/Android/macOS/Other) and shows per-device step-by-step instructions + working ICS/webcal links. iOS panel: `<a target="_self">` + `Content-Disposition: attachment` → iOS "Add to Calendar" sheet → events in personal calendar with 17:00 VALARM — **confirmed working**. macOS: webcal `<a>` (VALARMs honoured) + ICS download fallback. Android/Other: `<a download>`. Root cause: from a standalone PWA every navigation (`window.location.href`, `window.open()`, `<a target="_blank">`) stays inside the WKWebView sandbox, which has no download manager. `markCalendarExported()` in `usePushNotifications.js` replaces the direct-download path — sets localStorage dedup flag + `calExported` state only. i18n simplified to `calPickerOpenPage` + `calPickerOpenPageHint` + `calPickerCancel` in DE/EN/PT. Deployed to dev + prod. |
| 2026-04-20 | v1.3.13: **iOS notification bug fix + native calendar export** — (1) **Bug fix**: `usePushNotifications.js` — removed dead-code `isIOS && !isStandalone` condition on the toast; standalone iOS users (the only iOS users who can grant permission) were always shown the generic "Reminders enabled" toast instead of the iOS-specific one. Now any iOS device shows the correct tip after granting. (2) **Bug fix**: `notifIOSTip` strings in all 3 languages corrected from "Add to Home Screen for background notifications" (impossible with this architecture) to accurate "keep the app open at 17:00 and 20:00". (3) **Native calendar export** — new `GET /api/v1/waste/calendar.ics` backend endpoint returns the raw ICS file for the nearest location (`Content-Type: text/calendar`, 1 h CloudFront cache; 404 if no calendar within 5 km). `exportCalendar()` added to `usePushNotifications` hook: on iOS navigates to the URL (system "Add to Calendar" sheet); on desktop/Android fetches and triggers a file download. Called automatically on permission grant. localStorage dedup guard (key = rounded lat/lng, ~110 m precision) prevents re-export. Each VEVENT carries `VALARM TRIGGER:-P0DT7H0M` so iOS Calendar fires a native 17:00 alert independently of PWA. `calExported` state drives a persistent 📅 button in the app footer (visible when notifications are enabled) for re-export on demand. i18n strings `calExportBtn` + `calExportedTitle` added in DE/EN/PT. Frontend + backend deploy. |
| 2026-04-17 | v1.3.12: **Bell button refactor** — `isPending` loading state moved from `usePushNotifications` hook into `App.jsx` (UI concern belongs in UI layer). `requestPermission` in the hook is now a pure async function with no side-effects beyond updating `permState`. `handleRequestPermission` in `App.jsx` wraps the call with `try/finally` so `notifPending` always resets even if the browser rejects the permission request. iOS detection simplified to `navigator.maxTouchPoints > 1 && /Apple/.test(navigator.vendor)` (removes deprecated UA regex + `navigator.platform`). Double guard on bell `onClick` removed — `disabled` prop is the single source of control. Toast timer cleaned up on unmount via `useEffect`. Toast identity key changed from `Date.now()` to an incrementing ref counter. Frontend-only deploy. |
| 2026-04-17 | **v1.3.11 follow-up — bell button UX + glass panel fix + security**: (1) **Bell button pending/feedback UX** — `usePushNotifications.js` adds `isPending` state (`useState(false)`); `setIsPending(true/false)` wraps `Notification.requestPermission()` so the button pulses (`@keyframes notifPendingPulse`) while the OS dialog is open. `App.jsx` adds `handleRequestPermission` callback: after permission resolves, shows a 5-second toast (`notifGrantedToast` i18n string) for `granted`; on iOS non-standalone shows `notifIOSTip` guiding users to add to Home Screen for background notifications; iOS/standalone detection via `navigator.userAgent` + `navigator.maxTouchPoints` + `matchMedia("(display-mode:standalone)")`. Active bell state gains a green tint (`rgba(52,199,89,0.18)`). i18n strings `notifGrantedToast` + `notifIOSTip` added in DE/EN/PT. (2) **Glass panel `backdrop-filter` fix** — `backdrop-filter` cannot composite through a `background-attachment:fixed` ancestor on iOS/Safari. Fix applied to `release-notes.html` and `help.html`: `body` set to `background:transparent`; gradient moved into `body::before { position:fixed; inset:0; z-index:-1 }` pseudo-element so `backdrop-filter` on `.release`/`.section` cards composites correctly. (3) **Security: `python-multipart` 0.0.22 → 0.0.26** (CVE-2026-40347). (4) **CI lint fix**: `notifications_router` import in `main.py` moved alphabetically between `logs_router` and `stats_router` (ruff I001). Frontend + backend deployed to dev + prod. |
| 2026-04-15 | v1.3.11: **Waste notification system** — (1) Dismissible tomorrow-collection banner in `App.jsx`: amber pulsing bar shown when `GarbageWidget` fires `onTomorrowEvents`; dismiss stores ephemeral state in React. (2) `GET /api/v1/notifications/manifest` endpoint (`notifications.py`): scans all ICS files, returns tomorrow's collections grouped by ICS location with lat/lng; `Cache-Control: public, max-age=3600` (CloudFront-cached — at most 1 Lambda invocation/hour regardless of user count). (3) Service worker (`public/sw.js`): stores user location + lang in Cache API; haversine match (3 km radius) to manifest; `showNotification()` fired at 17:00 (first alert) and 20:00 (reminder) local time; dedup guard per `(date, slot)`; Periodic Background Sync (`lhc-garbage-check`, 12 h) for Chrome/Android background wake. (4) `usePushNotifications.js` hook: SW registration, permission lifecycle, setTimeout scheduling, PBS registration; returns `{ isSupported, isEnabled, isDenied, requestPermission }`. (5) 🔔/🔕 bell button in app footer (visible only when Notifications API supported; disabled+🔕 when denied). (6) i18n strings `wasteTomorrowAlert`, `notifEnable`, `notifEnabled`, `notifDenied` in DE/EN/PT. iOS 16.4+ supports Web Push when PWA added to Home Screen. Frontend+backend deploy. |
| 2026-04-11 | v1.3.10: **Bug fix — map widget panel blank on second visit**. `MapPanel` was unmounted every time the user switched back to the traffic tab (`tab > 0` condition). On the next visit to any non-traffic tab the component remounted with a fresh DOM node, but `fuelMapInstanceRef.current` still pointed to the old detached instance — the "already initialized" guard triggered `resize` on the dead node and returned early, leaving the new div permanently blank (card list visible, map tiles absent). Fix: `MapPanel` now remains mounted once opened (`panelEverOpenedRef` tracks first open), hidden via `display:none` when `tab === 0`; `MapPanel` accepts the `style` prop and applies it to its root `<div>`. Frontend-only deploy. |
| 2026-04-11 | v1.3.9: **POI widget — scrollable list capped at 7 visible items**. `.poiWidget__list` gains `max-height: 17rem` in both landscape (default flex rules) and portrait (media-query override changed from `overflow:visible` to `overflow-y:auto`). When ≤7 POIs match the active filter the list renders at natural height with no scrollbar; when >7 match the list is capped and a native scrollbar appears. Pure CSS change — no JS or API modifications. Frontend-only deploy. |
| 2026-04-07 | v1.3.8: **POI widget overhaul — 5-category scheme with icon filter chips**. Backend (`poi.py`): `_GOOGLE_CATEGORY_TYPES` restructured into 5 categories — Food & Drink (`restaurant/cafe/bakery/bar`), Essential Facilities (`public_bathroom/pharmacy/hospital/atm`), Shopping (`supermarket/convenience_store/drugstore/electronics_store`), Accommodation (`hotel/tourist_attraction/park`), Culture (`museum/art_gallery/library/church/monument`). `_UTILITY_TYPES` frozenset bypasses `rating<3/count<3` quality filter for utility services that typically have no user reviews. `public_bathroom` no longer early-exits with `continue` — populates restroom cache as side-effect AND appears in Essential Facilities results. Default `limit` raised 12→20. Per-category fairness bucketing removed; results returned sorted by distance. Frontend (`PoiWidget.jsx`): icon-only filter chip row replaces text labels; 6 framed-gradient SVG pictograms (All, Food & Drink, Essential Facilities, Shopping, Accommodation, Culture) matching the map widget tab bar visual language (linearGradient fill + radialGradient gloss + white border rect + white icon paths, 32×32 viewBox). `availableCategories` derived via `useMemo` from API data, preserving `CATEGORY_ORDER`. Default filter set to Food & Drink. `CATEGORY_META` updated with 5-category inline list-item icons and colours. `genericFilterIcon()` fallback (grey pin) for unknown future categories. CSS: `.poiWidget__chip` uses `flex:1; min-height:2.75rem` (Apple HIG 44 px touch target); active state navy `#0e1f8c`. i18n: `poiFilterFoodDrink`, `poiFilterEssential`, `poiFilterShopping`, `poiFilterAccommodation`, `poiFilterCulture` keys added in DE/EN/PT; old `poiFilterRestaurant`/`poiFilterEntertainment` removed. `package.json` bumped `1.3.7 → 1.3.8`. Full stack deployed to prod (Lambda + frontend). |
