# Landhauscheck — Session Handoff

> **Layout note (2026-10-29):** this document predates the move into the
> `DerSchweigert` monorepo. Paths below are historical — the code now lives in
> `sites/landhauscheck/` (`app/`, `frontend/`, `tests/`, `docs/`, `scripts/`,
> `docker/`), and Terraform in `infra/terraform/sites/landhauscheck{,-dev}/`.
> The Lambda is deployed as a zip rather than an ECR image. See
> `sites/landhauscheck/README.md` and `docs/SYSTEM.md` for the current layout.


## Live Endpoints
| Resource | URL |
|---|---|
| **Primary domain** | https://landhauscheck.com |
| www alias | https://www.landhauscheck.com |
| Stats dashboard | https://landhauscheck.com/stats.html |
| Impressum | https://landhauscheck.com/impressum.html |
| Datenschutz | https://landhauscheck.com/datenschutz.html |
| Donate / Feature Request | https://landhauscheck.com/donate.html |
| User Help | https://landhauscheck.com/help.html |
| Calendar Import Helper | https://landhauscheck.com/calendar-import.html |
| CloudFront | https://d1icuw9r7hb7kr.cloudfront.net |
| API Gateway (direct) | https://\<apigw-id\>.execute-api.eu-west-1.amazonaws.com |
| **Dev domain** | https://dev.landhauscheck.com |
| Dev stats | https://dev.landhauscheck.com/stats.html |

## AWS Infrastructure
- **Region**: eu-west-1 (Ireland)
- **Account**: 113725432218
- **Backend**: AWS Lambda function `basicwebapp-backend` (ARM64, 512 MB, container image from ECR)
- **ECR**: `113725432218.dkr.ecr.eu-west-1.amazonaws.com/basicwebapp-backend` (tag = git SHA)
- **API Gateway**: HTTP API → Lambda `AWS_PROXY` integration (no VPC Link, no ALB)
- **RDS**: **REMOVED** — no database in use
- **ECS**: **REMOVED** — no Fargate cluster
- **ALB**: **REMOVED** — no load balancer
- **S3 buckets**:
  - `basicwebapp-frontend-113725432218` — static frontend files
  - `basicwebapp-stats-113725432218` — persisted stats JSON (survives Lambda cold starts via `stats_persist.json`)
- **CloudFront ID**: `E1UNWNICC715F8`
- **CloudWatch log group**: `/aws/lambda/basicwebapp-backend` (7-day retention)
- **IaC tool**: OpenTofu v1.11.5 (`tofu` command); prod IaC `infra/terraform/sites/landhauscheck/`, dev IaC `infra/terraform/sites/landhauscheck-dev/` (separate state)
- **ACM cert**: `landhauscheck.com` + `www.landhauscheck.com`, validated via Route 53, issued in `us-east-1`
- **CloudFront error pages**: `error_caching_min_ttl = 0` on both 403/404 responses (prevents stale redirects being cached at edge POPs)
- **Expected monthly cost**: ~$1–3/month prod · ~$0.10/month dev (Lambda free tier; SSM Parameter Store secrets are free)

### Dev Stack — dev.landhauscheck.com
- **Lambda**: `basicwebapp-dev-backend` (same ECR repo, `basicwebapp-backend`, different function)
- **S3**: `basicwebapp-dev-frontend-113725432218` + `basicwebapp-dev-stats-113725432218`
- **CloudFront**: see `tofu -chdir=infra/terraform-dev output cloudfront_distribution_id`
- **Secrets**: SSM Parameter Store SecureString (`/basicwebapp-dev/` prefix) — **free**, no Secrets Manager cost
- **IaC**: `infra/terraform/sites/landhauscheck-dev/` with its own `terraform.tfstate` and `terraform.tfvars` (gitignored)

## AWS Registrar Cost
Route 53 is both a DNS service and a domain registrar. `landhauscheck.com` was **registered through Route 53**, so AWS bills ~$14/year as a "Registrar" line item. This is unavoidable as long as the domain is registered there. It is separate from the hosted zone ($0.50/month) and has nothing to do with the app infrastructure. To save ~$5/year you could transfer to Cloudflare Registrar (cost-price, ~$9/year) while keeping the Route 53 hosted zone — but this is optional and low priority.

## Tech Stack
- **Frontend**: React 19 + Vite 8 + `@vitejs/plugin-react` v6, Node 20 (Docker build), env baked at build: `VITE_API_BASE_URL`, `VITE_GOOGLE_MAPS_API_KEY`, `VITE_HERE_API_KEY`
- **Backend**: FastAPI 0.135.2 + Python 3.12, AWS Lambda container image (`backend.lambda.Dockerfile`), ARM64, Mangum adapter (`lambda_handler.py`)
- **Maps**: Google Maps JS API (traffic widget, `zoom=9`, fully non-interactive, no controls); **all four map instances** (traffic, bus overlay, train overlay, POI overlay) use a shared `MAP_STYLES` palette derived from the favicon (deep navy `#0e1f8c`, royal blue `#1450c4`, sky blue `#30a8fc`)
- **POI**: Google Places Nearby Search API (single request, 2× POPULARITY+DISTANCE parallel, 6-month backend file cache)
- **Restrooms / ATMs**: Google Places via `/chargers?poi_type=toilet|atm`; toilet query includes `public_bathroom`, `fast_food_restaurant`, `cafe`, `coffee_shop`, `gas_station`; integrated as icon tabs (🚻 🏧) in the map widget — no separate widget
- **Train stations**: DB StaDa snapshot (`sites/landhauscheck/app/data/db_stations.json`, ~5411 stations, haversine filter), monthly GitHub Actions refresh; Google Places fallback for non-DE locations
- **Garbage**: ICS files in `sites/landhauscheck/app/data/waste/`, matched by haversine to `locations.json`; Apple-style calendar fallback with country-aware public holidays via `holidays` Python lib
- **Weather**: Open-Meteo free API (`/v1/forecast`), 2-day forecast, moon phase calculated mathematically

## External APIs — Full List
| Provider | Used For | Call Frequency | Key |
|---|---|---|---|
| **Google Maps JS** | Traffic map widget | CDN load once per session | `VITE_GOOGLE_MAPS_API_KEY` (browser) |
| **Google Places Nearby** | POI (Unterhaltung/Restaurant/Shopping) + `public_bathroom` side-effect | Once per 6 months per ~1km cell (backend file cache) | `GOOGLE_MAPS_API_KEY` (server) |
| **Google Geocoding** | Location picker address→coords | On manual address entry | `GOOGLE_MAPS_API_KEY` (server) via `/api/v1/geocode` proxy |
| **Google Places** (chargers/toilet/ATM) | `electric_vehicle_charging_station` · multi-type toilet · `atm` | On first map panel tab open, 15min client cache | `GOOGLE_MAPS_API_KEY` (server) |
| **HERE Pedestrian Router** | Real walking time per restroom tile | Parallel with Overpass on restroom load (backend only, no longer used by frontend panel) | `HERE_API_KEY` (server) |
| **HERE map tiles** | Map tile rendering (all map widgets) | Per tile load | `VITE_HERE_API_KEY` (browser) |
| **HERE** `/v8/stations` | Bus stop nearby lookup | Once per session (sessionStorage cached), 30min refresh | `HERE_API_KEY` (server) |
| **HERE** `/v8/departures` | Live departures (batched) | Every 30 min per widget (server-side 30min cache) | `HERE_API_KEY` (server) |
| **Open-Meteo** `/v1/forecast` | Weather + moon phase | Every 30 min | none (free) |
| **BigDataCloud** | Reverse geocode (city name from lat/lng for stats + country/state for holidays) | On location change | none (free) |
| **DB StaDa** `/station-data/v2` | Monthly station snapshot refresh | GitHub Actions cron, 1st of month 03:00 UTC | `DB_STADA_API_KEY` (server) |
| **Tankerkönig** `/prices.php` | Fuel prices at 4 nearest stations (DE only) | On first ⛽ tab open, 15min client cache | `TANKERKOENIG_API_KEY` (server) |
| **Jira Cloud** REST API v3 | Create feature-request Tasks in project LHC | On `POST /api/v1/feature-request` (user-triggered) | `JIRA_API_KEY` (server) |

## Key Deployment Commands

> **Rule: always deploy to `dev.landhauscheck.com` and explicitly confirm you have tested the change there before running any prod deployment.**
> `deploy.sh` enforces this with an interactive prompt. Bypass only in CI with `DEPLOY_CONFIRMED=yes`.

```bash
# Local development
docker-compose -f sites/landhauscheck/docker/docker-compose.local.yml up --build -d

# Deploy everything to AWS
bash scripts/deploy.sh aws

# Backend only (Python/FastAPI changes — builds Lambda image, updates Lambda function)
bash scripts/deploy.sh aws --backend-only

# Frontend only (React/CSS changes)
bash scripts/deploy.sh aws --frontend-only

# Infrastructure changes only
bash scripts/deploy.sh aws --infra-only

# Dev environment
bash scripts/deploy.sh aws --env dev                  # full dev deploy
bash scripts/deploy.sh aws --env dev --backend-only   # dev Lambda update
bash scripts/deploy.sh aws --env dev --frontend-only  # dev frontend
bash scripts/deploy.sh aws --env dev --infra-only     # dev tofu apply

# Refresh DB station snapshot (also runs via GitHub Actions monthly)
make refresh-stations

# ── Dev fixture cache ─────────────────────────────────────────────────────
# Seed fixtures once (requires all API keys configured locally):
DEV_CACHE_MODE=record docker-compose -f sites/landhauscheck/docker/docker-compose.local.yml up --build -d
python scripts/seed_dev_fixtures.py
# Then commit the fixture files in sites/landhauscheck/app/data/fixtures/

# Run local dev with fixture cache (no real API calls, no quota consumed):
DEV_CACHE_MODE=on docker-compose -f sites/landhauscheck/docker/docker-compose.local.yml up -d

# Bypass the cache for a single request (live data, no fixture write):
# Send header:  X-Dev-Cache-Bypass: 1

# Terraform
make tf-plan
make tf-apply

# Force Lambda cold start (to reset in-memory stats) — safe: only changes description
aws lambda update-function-configuration \
  --function-name basicwebapp-backend \
  --description "reset-$(date +%s)" \
  --region eu-west-1

# Backend unit tests (fast, offline, no external API calls)
make test
# or: cd sites/landhauscheck && PYTHONPATH=. pytest -q

# Smoke tests against local stack
cd sites/landhauscheck && BASE_URL=http://localhost:8000 PYTHONPATH=. pytest tests/smoke/ -v

# Smoke tests against production
cd sites/landhauscheck && BASE_URL=https://landhauscheck.com PYTHONPATH=. pytest tests/smoke/ -v
```

## Architecture Notes
- CloudFront has **two origins**: S3 (default, serves frontend) + API Gateway (`/api/*` and `/health`)
- **No ALB, no VPC**: Lambda runs outside any VPC, accesses Secrets Manager via public AWS endpoint
- Lambda image is built with `backend.lambda.Dockerfile` (uses `public.ecr.aws/lambda/python:3.12-arm64` base), CMD = `app.lambda_handler.handler`. Regular `backend.Dockerfile` (uvicorn) is for local dev only.
- Always build Lambda image with `--platform linux/arm64`
- `VITE_GOOGLE_MAPS_API_KEY` fetched from Secrets Manager at frontend build time in `deploy.sh`
- **Stats persist**: `basicwebapp-stats-113725432218` S3 bucket stores `stats_persist.json`. On Lambda cold start: download from S3, fallback to `/tmp`. On every flush: write `/tmp` AND upload to S3. Survives Lambda cold starts.
- **Resetting stats**: delete `s3://basicwebapp-stats-113725432218/stats_persist.json`, then force a cold start by updating Lambda description (see commands above). Do NOT use `update-function-configuration --environment` — it replaces the entire env vars map and wipes all API keys. Use `--description` only.
- **Session location**: extracted from `lat/lng` query params in widget API calls (`/poi-nearby`, `/rail-nearby`, `/waste/upcoming`, `/weather/forecast`). NOT from `/transit/nearby` (would log station coords). Background reverse-geocode (BigDataCloud HTTPS) runs once per new session when lat/lng first arrives.
- **Session active window**: 5 minutes (`ACTIVE_WINDOW_S = 300` in `stats_store.py`)
- **Departures cache**: server-side 30min TTL keyed by HERE station ID, file-persisted to `/tmp/dep_cache.json`
- **POI cache**: server-side 6-month TTL keyed by location cell + radius + lang, file-persisted to `/tmp/poi_cache.json`
- **Bot filtering in stats.html**: CloudFront health probes (and other bots/crawlers) are identified by `ua_short` and excluded from the human session count/table. Shown separately as a collapsed summary row. ~2,880 CloudFront probes/day — zero cost (within Lambda free tier).
- **Developer traffic exclusion**: `stats-login.html` sets `lhc_devmode=1` (1-year, SameSite=Strict, Secure, not HttpOnly) via JS on successful login. CloudFront `/api/*` behavior whitelists `lhc_devmode` so Lambda receives it. Stats middleware skips all tracking when the cookie is present. `stats.html` shows an amber badge when detected via `document.cookie`; badge has "Zurücksetzen" button calling `POST /admin/clear-devmode`.
- **Developer traffic exclusion**: `stats-login.html` sets `lhc_devmode=1` (1-year, SameSite=Strict, Secure, not HttpOnly) via JS on successful login. CloudFront `/api/*` behavior whitelists `lhc_devmode` so Lambda receives it. Stats middleware skips all tracking when that cookie is present. `stats.html` shows an amber badge when the cookie is detected via `document.cookie`. `POST /admin/clear-devmode` removes it.

## Widget Interactivity (Route Overlays)
All three location-based widgets support **tap-to-route overlays**:
| Widget | Tap target | Route type | Travel mode |
|---|---|---|---|
| **POI widget** | Any POI row | User → POI | Walking |
| **Transit widget (Bus tab)** | Any bus stop row | User → bus stop | Walking |
| **Transit widget (Rail tab)** | Any station row | User → station | Driving |

All three use the **same CSS class**: `.poiRouteOverlay` / `.poiRouteOverlay--visible` / `.poiRouteOverlay__map` / `.poiRouteOverlay__closer` (defined in `styles.css`). Overlay behaviour: fades in 0.3s + scales 0.97→1.0, Google Maps DirectionsRenderer, no controls, tap transparent div to close (fade out 0.3s). Each overlay is a self-contained component using `loadGoogleMapsScript()` from `mapUtils.js`.

**Critical implementation rules for overlays:**
- Call `loadGoogleMapsScript()` then use `window.google.maps` (NOT the return value — it's a Promise, `window.google.maps` is set as a side effect)
- `useEffect(init, [])` with empty deps — never pass the `stop`/`poi`/`station` object or you get a re-init loop
- `selectedTrain`/`selectedStop`/`selectedPoi` state lives in the parent widget; overlay renders when state is non-null
- Transparent closer `div` sits at `z-index: 1` below the map (`z-index: 2`)
- All overlays initialise the Map with `center: mid` (midpoint between user and target) + `zoom: 14` so `DirectionsRenderer` (`preserveViewport: false`) produces a visible zoom-in effect. Do not skip center/zoom on init — without it there's no starting position to animate from.

## Key Source Files
| File | Purpose |
|---|---|
| `sites/landhauscheck/frontend/src/styles.css` | All styling: Liquid Glass, widget cards, portrait/landscape responsive, overlay animations, `.langSwitcher` |
| `sites/landhauscheck/frontend/src/App.jsx` | Lean orchestrator — imports 6 hooks, defines the `WIDGETS` constant array (5 entries since `routing` removed in v1.3.9: garbage / clock / map / transit / poi), renders the widget grid via a switch on `widget.id`. Adding a new widget = one new array entry + one switch case. |
| `sites/landhauscheck/frontend/src/hooks/useLocation.js` | GPS, consent (`lhc_consent_v1`), location picker visibility, reverse-geocode trigger |
| `sites/landhauscheck/frontend/src/hooks/useWakeLock.js` | Screen wake lock; re-acquires on `visibilitychange` |
| `sites/landhauscheck/frontend/src/hooks/usePullToRefresh.js` | Touch pull-to-refresh with visual indicator; `overscroll-behavior: none` on body |
| `sites/landhauscheck/frontend/src/hooks/useHealth.js` | Backend `/health` fetch |
| `sites/landhauscheck/frontend/src/hooks/useWidgetStatus.js` | All widget statuses, errors, countdowns, `lastUpdated`, stable `on*` callbacks via `useCallback` |
| `sites/landhauscheck/frontend/src/hooks/useLocation.js` | GPS, consent, location picker visibility, reverse-geocode. v1.3.4: scroll-lock (`position:fixed+top:-scrollY`) on `body` while picker open; `openLocationPicker()` increments `gpsAttemptRef` to invalidate in-flight GPS; removed `setLocationPickerOpen(false)` from GPS success callback — picker only closes via user actions. |
| `sites/landhauscheck/frontend/src/components/WidgetHelp.jsx` | Circled `?` help button rendered next to every widget title. Popup is injected via **React portal** (`createPortal` → `document.body`) to escape `overflow:hidden` widget containers. `useLayoutEffect` calculates `top`/`left` from `getBoundingClientRect` and clamps to viewport edges — popup never overflows in any language. |
| `sites/landhauscheck/frontend/src/components/AppConsole.jsx` | Diagnostics overlay JSX; fetches CloudWatch logs on mount |
| `sites/landhauscheck/frontend/src/config/i18n.js` | **Single source of truth for all UI strings** in DE, EN, PT. ⚠️ i18n: update all three language blocks whenever adding/changing any user-visible string. `soloProjectNote` + `soloProjectCoffee` keys added in v1.3.4. |
| `sites/landhauscheck/frontend/src/components/LocationPicker.jsx` | Reworked welcome screen: language switcher in header row, 6-card feature showcase grid (Abfallkalender/Clock/Karte/Bahnhof/Bus/POI with colour-coded emoji cards), solo-project donation note below feature grid (`locPicker__soloNote`), DSGVO consent section, GPS/manual-entry location picker. Geocoding calls go to `/api/v1/geocode` (Lambda proxy) — NOT directly to Google. Reset button in app footer reopens this screen without a page reload. |
| `sites/landhauscheck/frontend/src/components/GoogleMapWidget.jsx` | Google Maps traffic widget (zoom 9, non-interactive) + five-tab inline panel (traffic/fuel/charger/toilet/ATM). Reduced from 753 → 420 lines in v1.3.1 by extracting utilities and panels. `panelEverOpenedRef` tracks first panel open so `MapPanel` stays mounted (hidden via `display:none`) after first visit — prevents blank map on second panel visit (v1.3.10 fix). |
| `sites/landhauscheck/frontend/src/components/ClockWidget.jsx` | Digital clock + 5-hour weather strip (Open-Meteo) + moon phase emoji + night icons |
| `sites/landhauscheck/frontend/src/components/TransitWidget.jsx` | **Merged transit widget (v1.3.9)** — Bus tab (HERE nearby + departures, non-rail stops) and Rail tab (OSM `rail-nearby` + HERE departures, 1h sessionStorage cache). Chip switcher matches Maps/POI tab style. Both tabs load eagerly on location; single 30min countdown drives both. `StopCard` (bus) + `RailCard` (rail) sub-components. `RoutingWidget.jsx` retired. |
| ~~`sites/landhauscheck/frontend/src/components/RoutingWidget.jsx`~~ | **Retired in v1.3.9** — logic merged into `TransitWidget.jsx`. File kept on disk but no longer imported. |
| `sites/landhauscheck/frontend/src/components/PoiWidget.jsx` | Google Places POI (6-month backend file cache, 2h refresh, no localStorage); `RouteOverlay` component (walking route, center+zoom=14 on init) |
| `sites/landhauscheck/frontend/src/components/GarbageWidget.jsx` | Garbage schedule from ICS or Apple-style calendar fallback with country-aware holidays; fires `onTomorrowEvents(events)` after data load so `App.jsx` can show the tomorrow banner |
| `sites/landhauscheck/frontend/public/sw.js` | Service worker: stores user location+lang in Cache API; haversine match (≤3 km) against notification manifest; `showNotification()` at 17:00 (first alert) and 20:00 (reminder) local time; dedup guard per `(date, slot)`; handles Periodic Background Sync (`lhc-garbage-check`, 12 h interval) for Chrome/Android background wake |
| `sites/landhauscheck/frontend/src/hooks/usePushNotifications.js` | SW registration; syncs location+lang to SW; schedules `setTimeout` at 17:00/20:00 local time; auto re-arms next day; registers Periodic Background Sync; manages Notifications API permission lifecycle; `markCalendarExported()` sets localStorage dedup flag + `calExported` state (actual calendar download handled by `calendar-import.html`); returns `{ isSupported, isEnabled, isDenied, requestPermission, markCalendarExported, calExported }` |
| `sites/landhauscheck/frontend/public/calendar-import.html` | Platform-aware static helper page for native calendar import; opened from `CalendarPickerModal` in real Safari (escapes WKWebView sandbox); reads `?lat`, `?lng`, `?lang`, `?base` URL params; auto-detects platform (iOS/Android/macOS/Other); shows per-device step-by-step instructions + working ICS/webcal links; iOS: `<a target="_self">` + `Content-Disposition: attachment` → "Add to Calendar" sheet; macOS: webcal `<a>` + download fallback; Android/Other: `<a download>`; trilingual DE/EN/PT; glass morphism design |
| `sites/landhauscheck/frontend/public/stats.html` | Stats dashboard: summary cards, endpoint chart, daily chart, sessions-per-day chart, user map (Leaflet), sessions table, error log. Bot summary row shown collapsed. Refreshes every 30s. Shows amber devmode badge ("Dein Traffic wird nicht gezählt") when `lhc_devmode=1` cookie is present; badge has "Zurücksetzen" button calling `POST /admin/clear-devmode`. |
| `sites/landhauscheck/frontend/public/impressum.html` | §5 TMG Impressum — trilingual (DE/EN/PT) with inline JS i18n switcher. ⚠️ i18n: update all three language blocks. |
| `sites/landhauscheck/frontend/public/datenschutz.html` | DSGVO Datenschutzerklärung — trilingual (DE/EN/PT) with inline JS i18n switcher. No email address published. ⚠️ i18n: update all three language blocks. |
| `sites/landhauscheck/app/lambda_handler.py` | Mangum wrapper — entry point for AWS Lambda: `handler = Mangum(app, lifespan="off")` |
| `sites/landhauscheck/app/api/routes/transit/` | **Package** (7 files) — all transit routes split in v1.3.1: `__init__.py` (combined router), `bus.py` (HERE nearby + departures), `rail.py` (DB snapshot + Google fallback), `poi.py` (Google Places, file-cached 6mo), `restrooms.py` (Overpass + HERE walking), `_cache.py` (POI + restroom file caches, `# nosec B108`), `_shared.py` (constants + haversine) |
| `sites/landhauscheck/app/api/routes/weather.py` | Weather forecast (Open-Meteo 2-day) + holidays (Python lib, country-aware) + moon phase |
| `sites/landhauscheck/app/api/routes/stats.py` | Stats endpoint: sessions, endpoints, provider totals, locations, error log. **PIN-protected**: requires `X-Stats-Pin` header matching `STATS_PIN` env var. `verify_pin` sets `lhc_devmode=1` cookie (not HttpOnly) on success. `clear_devmode` removes it (PIN-protected). |
| `sites/landhauscheck/app/api/routes/waste.py` | Garbage schedule from ICS files (`GET /waste/upcoming`) |
| `sites/landhauscheck/app/api/routes/notifications.py` | Notification manifest (`GET /notifications/manifest`): scans all ICS files, returns tomorrow's collections grouped by location with lat/lng. `Cache-Control: public, max-age=3600` — CloudFront caches this for 1 h so at most 1 Lambda invocation/hour regardless of user count. |
| `sites/landhauscheck/app/api/routes/waste_contribute.py` | Calendar contribution upload (`POST /waste/contribute`): lint/validate ICS, content-moderate, create GitHub PR. `_GITHUB_API` fixed to HTTPS-only with explicit scheme validation (`# nosec B310`). |
| `scripts/review_waste_pr.py` | Auto-review agent: `_check_harmful_content()` (40+ regex patterns EN/DE/PT), VEVENT validation, `X-WR-GEO-LAT/LNG` header injection, squash-merge on APPROVE. |
| `sites/landhauscheck/app/services/stats_store.py` | In-memory stats store; persists to S3 (`basicwebapp-stats-113725432218`) + `/tmp` fallback. `ACTIVE_WINDOW_S = 300`. |
| `sites/landhauscheck/app/main.py` | FastAPI app, middleware (stats tracking, provider counting, error logging, session geo from widget params). Skips all tracking when `lhc_devmode=1` cookie present. `_LOCATION_PATHS = [poi-nearby, rail-nearby, waste/upcoming, weather/forecast]`. Reverse-geocode fires as `starlette.background.BackgroundTask` on first location fix (safe in Lambda). Registers `/api/v1/geocode` route. |
| `sites/landhauscheck/app/core/config.py` | Pydantic settings: all API keys, AWS, CORS. No DATABASE_URL. |
| `sites/landhauscheck/app/data/db_stations.json` | ~5411 DB train stations snapshot (CC BY 4.0) |
| `sites/landhauscheck/app/data/locations.json` | Garbage calendar location registry (Pfaffenhofen, Dietramszell centered on Hauptstrasse 18) |
| `sites/landhauscheck/app/data/process_inbox.py` | ICS → JSON transformer; alias-aware, strips `\;` from AWIDO LOCATION field |
| `sites/landhauscheck/tests/` | 61 unit tests (pytest + respx, no network) |\n| `sites/landhauscheck/frontend/src/test/` | 20 vitest hook tests: `useLocation.test.js` (11) + `usePullToRefresh.test.js` (9). Run: `npm test` in `sites/landhauscheck/frontend/`. |
| `sites/landhauscheck/tests/smoke/` | 14 smoke tests (real HTTP, run against any BASE_URL) |
| `sites/landhauscheck/e2e/` | Playwright E2E tests (disabled in CI via `if: false`) |
| `scripts/refresh_stations.py` | Paginates DB StaDa API, writes `db_stations.json` |
| `sites/landhauscheck/frontend/public/release-notes.html` | Glass-styled page that fetches GitHub Releases API and renders all release notes as markdown. Linked from footer. |
| `sites/landhauscheck/frontend/public/stats.html` | Admin stats dashboard — now includes API request budget section (11 on load, ~35/hour per user); dead Schulen row removed |
| `sites/landhauscheck/frontend/src/components/mapUtils.js` | Shared Google Maps utilities: `loadGoogleMapsScript()` singleton, `MAP_STYLES`, `haversineKm()`. Imported by GoogleMapWidget, RoutingWidget, TransitWidget. |
| `sites/landhauscheck/frontend/src/components/MapPanel.jsx` | Fuel/Charger/Toilet/ATM card list panel (tabs 1–4) + mini-map container. Uses `forwardRef` so parent controls the map instance. |
| `sites/landhauscheck/frontend/vite.config.js` | Injects `__APP_VERSION__` from `package.json` at build time via Vite `define`; also holds vitest config (jsdom env, globals, setupFiles, coverage) |
| `sites/landhauscheck/docker/backend.lambda.Dockerfile` | Lambda container image — `public.ecr.aws/lambda/python:3.12-arm64` base, CMD = `app.lambda_handler.handler` |
| `infra/terraform/sites/landhauscheck/lambda.tf` | Lambda function, CloudWatch log group (7d), API Gateway invoke permission, IAM execution role |
| `infra/terraform/sites/landhauscheck/apigateway.tf` | HTTP API + stage + Lambda `AWS_PROXY` integration + route (no VPC Link) |
| `infra/terraform/sites/landhauscheck/cloudfront.tf` | Two-origin CF (S3 + API GW) + ACM cert + `error_caching_min_ttl=0` on 403/404 + CloudFront Function guarding `/stats.html` (PIN cookie check) + response headers policy (6 security headers) |
| `infra/terraform/sites/landhauscheck/iam.tf` | Lambda execution role — must list ALL secret ARNs in secrets access policy |
| `infra/terraform/sites/landhauscheck/secrets.tf` | All Secrets Manager entries (no `cf-alb-secret`, no `database-url`) |
| `infra/terraform/sites/landhauscheck/s3_stats.tf` | Stats persistence S3 bucket (private, AES-256, versioned, 30-day version expiry) |
| `infra/terraform/sites/landhauscheck/alb.tf` | **Blank** — ALB removed |
| `infra/terraform/sites/landhauscheck/ecs.tf` | **Blank** — ECS removed |
| `infra/terraform/sites/landhauscheck/rds.tf` | **Blank** — RDS removed |
| `infra/terraform/sites/landhauscheck-dev/` | Dev environment IaC — mirrors prod but uses SSM Parameter Store (free) instead of Secrets Manager; `basicwebapp-dev` resource prefix; separate tfstate |
| `sites/landhauscheck/frontend/public/release-notes.html` | Glass-styled page that fetches GitHub Releases API and renders all release notes as markdown; linked from app footer `Neuigkeiten · v1.2.1` |
| `sites/landhauscheck/frontend/vite.config.js` | Injects `__APP_VERSION__` from `package.json` at build time via Vite `define` |
| `.github/workflows/ci.yml` | CI: ruff lint + 61 unit tests; bandit; pip-audit; npm audit; E2E job disabled (`if: false`) |
| `.github/workflows/waste-calendar-review.yml` | Triggered by PRs touching `sites/landhauscheck/app/data/waste/**.ics` (branch names: `waste/contrib-*`, `waste/update-*`, `waste/expire-*`); runs `scripts/review_waste_pr.py` — validates, normalises, content-moderates, posts GitHub review, squash-merges on APPROVE. Uses `GH_WASTE_PAT` secret. |
| `.github/workflows/deploy-aws.yml` | Manual-only deploy workflow (mode: full/backend/frontend/infra); smoke-prod job disabled (`if: false`) |
| `.github/workflows/refresh-stations.yml` | Monthly cron: re-downloads DB station data, auto-commits if changed |

## Portrait / Landscape Layout
- **Landscape**: 3×2 grid, fills viewport, no scroll
- **Portrait**: single column, document scroll, each widget content-height, map square (`aspect-ratio: 1/1`), widget order: Clock → Map → Busses → Trains → POI → Garbage
- `overscroll-behavior: none` on body (enables pull-to-refresh without Safari rubber-band interference)
- **Mobile portrait banner**: `<div className="appBanner">` sits at top of the glass panel, visible **only** on `(max-width: 480px) and (orientation: portrait)`. Shows the stylized L logo (`logo.png`, `mix-blend-mode: multiply` to remove white bg) + "landhauscheck" (SF Pro, weight 600, `#1d1d1f`) + "alles nah" / "all nearby" / "tudo perto" subtitle (weight 300, `lhc_lang`-aware) + a circular `?` help button (`.appBanner__helpBtn`, 28px, glass morphism, `margin-left: auto`) linking to `/help.html` with `aria-label={t.help}`. Hidden on all other viewports via CSS `display: none`. `aria-hidden` was removed from the banner div (v1.3.1) so screen readers can reach the `?` button.

## Pull-to-Refresh
Swipe down ≥ 70px when at top of page → spinner → white flash → `window.location.reload()`. Uses native touch events. `eligible` flag (set only at touchstart when `scrollY===0`) prevents Safari rubber-band from triggering it.

## Live Badges
Every widget card has a `LiveBadge` (top-right corner):
- `● live` (pulsing green) — just updated, within 5% of interval
- `● Update in Xm` (green→amber as deadline approaches)
- `● Fehler` (red) — last fetch errored
- `◌ lädt…` (grey) — still loading

Intervals: Clock=always live · Map=5min heartbeat · Trains/Busses=30min · POI=2h · Garbage=60min

## Diagnostics Console
Click the clock to open. Full-screen in portrait (100vw×100dvh), 92vw×92vh in landscape. Shows:
- System: API URL, health status, protocol, build mode, wake lock status
- Browser: language, resolution, connection type, user agent
- Location: geolocation support, permission state, source (GPS/manual), coordinates
- Widgets: all 5 widget statuses with colour coding + error messages
- API keys: Google Maps key present/missing
- App events log
- "Standort ändern" button to re-open location picker anytime

## Multilanguage Support (i18n)
- **Languages**: Deutsch (DE), English (EN), Português (PT)
- **Language detection order**: `localStorage.lhc_lang` → `navigator.language` prefix → fallback DE
- **Persistence**: stored as `lhc_lang` in localStorage, shared between the main app and static HTML pages
- **Main app strings**: all in `sites/landhauscheck/frontend/src/config/i18n.js` — one object per language key. Import `t(lang, key)` helper where needed.
- **Static pages** (`impressum.html`, `datenschutz.html`): inline `var dict = {de:{...}, en:{...}, pt:{...}}` at top of `<script>`, `applyLang()` called on switcher click and page load
- ⚠️ **Future changes**: whenever any user-visible string is added or changed, update **all three language blocks** in both `i18n.js` and the relevant static HTML files

## Consent & Legal
- **LocationPicker** shows DSGVO consent checkbox + app description before enabling GPS/search (persisted in localStorage as `lhc_consent_v1`)
- Returning users with consent skip the picker if GPS is available
- Footer: "Impressum · Datenschutz" links + language switcher [DE|EN|PT] at bottom of main panel
- **Impressum**: §5 TMG, Urs Schweigert, Am Sonnenhang 12, 85235 Pfaffenhofen an der Glonn — **no email address published** (contact by post only)
- **Datenschutz**: no email address published

## Stats Page Access (PIN Protection)
- `stats.html` and `stats-login.html` are protected by a **server-side PIN** enforced at the CloudFront edge via a CloudFront Function
- Every request to `/stats.html` is intercepted by the CF Function before S3 responds — the function checks for a `lhc_pin` cookie; if missing or wrong, it redirects to `/stats-login.html`
- **`stats-login.html`**: Apple-style PIN entry page — POSTs to `/api/v1/admin/verify-pin` (backend validates against `STATS_PIN` env var). PIN is never written in HTML source. On 200, sets `lhc_pin` cookie (30 days, Secure, SameSite=Strict) and redirects to `/stats.html`.
- **Defence in depth**: `GET /api/v1/admin/stats` also validates `X-Stats-Pin` header — stats.html reads the cookie and sends it as a header on every API fetch
- **To change PIN**: update the `DERSCHWEIGERT_ADMIN_PIN` GitHub secret (Terraform var `stats_pin`, used by both the CF Function and `STATS_PIN` in `lambda.tf`) → redeploy

## Stats Page (landhauscheck.com/stats.html)
- Summary cards: total requests, unique sessions (human only), active sessions (5min window), errors, Google/HERE/Meteo API call counts, **Abfall-Kalender** (ICS file count), **Kalender-Beiträge** (cumulative upload count)
- Bot sub-note on session card: `+ N Bot` shown in faint text next to human count
- Sessions table: human sessions only; a single collapsed row at bottom shows `N Bot/Crawler-Session(s) ausgeblendet · X Aufrufe · Amazon CloudFront`
- Bot detection: `ua_short` containing "CloudFront", "Googlebot", "bot", "crawl", "spider", "curl", "python-requests", or no UA
- CloudFront health probes: ~2,880/day → ~86,400/month — within Lambda free tier, zero cost
- Endpoint bar chart + daily totals chart + sessions-per-day chart (all persisted across Lambda cold starts via S3)
- User map (Leaflet + OSM): circles sized by unique device count, permanent count label, click for city/country/hits
- Error log: last 50 `/api/` errors (bot probes filtered out)
- Provider API reference table at bottom
- Refreshes every 30 seconds
- `stats.html` deployed with `Cache-Control: no-cache` (avoids CloudFront edge caching)

## Security — API Key Setup
Two separate Google Maps keys and two separate HERE keys are in use:

| Secret name | Terraform var | Used in | Restriction |
|---|---|---|---|
| `basicwebapp/google-maps-api-key` | `google_maps_api_key` | Lambda env `GOOGLE_MAPS_API_KEY` | API restriction: Directions + Places + Geocoding only |
| `basicwebapp/google-maps-browser-api-key` | `google_maps_browser_api_key` | `VITE_GOOGLE_MAPS_API_KEY` baked into frontend bundle | HTTP referrer: `https://landhauscheck.com/*` |
| `basicwebapp/here-api-key` | `here_api_key` | Lambda env `HERE_API_KEY` | None (server-to-server, no referrer) |
| `basicwebapp/here-browser-api-key` | `here_browser_api_key` | `VITE_HERE_API_KEY` baked into frontend bundle | Domain: `https://landhauscheck.com` |

**Critical**: never add HTTP referrer/domain restriction to the server-side keys — Lambda has no `Referer` header, so server-to-server API calls will be rejected with 403/Unauthorized.

**Also critical**: the **Google Geocoding REST API** (`/maps/api/geocode/json`) does **not** work with referrer-restricted keys even from a real browser — Google explicitly blocks it. Geocoding must be proxied through the Lambda backend (`/api/v1/geocode` route using `GOOGLE_MAPS_API_KEY`). Do NOT call the Geocoding REST API directly from the browser with a referrer-restricted key.

## Security — HTTP Headers
CloudFront response headers policy (`basicwebapp-security-headers`) is attached to all three cache behaviours and sets:
- `Strict-Transport-Security: max-age=31536000; includeSubDomains; preload`
- `Content-Security-Policy`: allowlists Google Maps, HERE, Open-Meteo, BigDataCloud, `cdn.jsdelivr.net` (Chart.js for stats page), `unpkg.com` (Leaflet for stats page map)
- `X-Frame-Options: DENY`
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy: camera=(), microphone=(), geolocation=(self), payment=()`

⚠️ If you add a new CDN or external resource to any page, **add it to the CSP in `cloudfront.tf`** and run `tofu apply` — otherwise the browser will silently block it (charts/maps on stats page will appear empty with no JS error in the network tab).

## Security — CI Scanning
Every push to `main` runs in `.github/workflows/ci.yml`:
- `bandit -r app -ll -ii --skip B108` — fails on HIGH/CRITICAL Python code findings (B108 skipped: `/tmp` path in Lambda is intentional)
- `pip-audit` — fails on any known CVE in Python dependencies
- `npm audit --audit-level=high` — fails on any HIGH/CRITICAL npm CVE

## System Documentation
Full system documentation lives in `docs/SYSTEM.md`. It covers architecture, all API routes, component map, deployment, security, and a changelog. CI warns (non-blocking) if `apps/` or `infra/` files change without `docs/SYSTEM.md` being touched. Update `docs/SYSTEM.md` on every push that changes source or infrastructure.

## Known Pitfalls
1. Always build backend Lambda image with `--platform linux/arm64` (Mac = Apple Silicon, Lambda = ARM64 Graviton)
2. Lambda uses `public.ecr.aws/lambda/python:3.12-arm64` base image — do NOT use `python:3.12-slim` for the Lambda Dockerfile (wrong entrypoint format)
3. When adding new Secrets Manager entries, **also add their ARN to the `lambda_secrets_access` policy in `iam.tf`** — omitting this causes Lambda to fail at cold start with AccessDeniedException
4. `terraform.tfvars` is gitignored — CI workflows use `TF_VAR_*` env vars instead; deploy is manual-only (`deploy.sh` locally)
5. Frontend build uses Docker (Node 20 LTS) to avoid local Node version conflicts — `deploy.sh` cleans `node_modules` before each build via `find` (macOS `rm -rf` fails on Docker-created dirs with spaces)
6. **Resetting stats**: to force a Lambda cold start (clearing in-memory stats), use `aws lambda update-function-configuration --description` only. **NEVER use `--environment` / `--variables`** — it replaces the entire env vars map and wipes all API keys. Use `tofu apply -target=aws_lambda_function.backend` to restore if this happens.
7. E2E Playwright tests disabled in CI (`if: false` in workflow files) — remove that to re-enable
8. **API key referrer restrictions**: browser keys (Google + HERE) must have the domain restriction set. Server-side keys must have NO referrer/domain restriction — Lambda calls have no `Referer` header and will be rejected. Adding a domain restriction to a shared key (used by both browser and server) breaks the transit/POI/directions backend calls immediately.
9. **`loadGoogleMapsScript()` return value**: it returns a Promise, not the Maps API object. Always use `window.google.maps` after awaiting the promise. Using the return value causes a silent crash.
10. **`useEffect` deps in overlays**: never put the `stop`/`poi`/`station` object in the deps array of the effect that initialises `google.maps.Map`. This causes a re-init loop (map DOM node destroyed and recreated on every render). Use `[]`.
11. **`normaliseStations` in TransitWidget**: must spread `lat` and `lng` from the HERE `position` object, otherwise `StationOverlay` gets `undefined` coordinates and the Directions call silently fails.
12. **`_LOCATION_PATHS` in `main.py`**: do NOT include `/transit/nearby` — that endpoint is called with the nearby station's coordinates, not the user's location. Including it logs wrong coordinates (the Haspelmoor bug).
13. **POI localStorage removed**: all caching is server-side file cache only (`/tmp/poi_cache.json`). `PoiWidget` is pure fetch→render. Do not re-add browser storage — it caused Safari bugs (empty array truthy, persisting failed fetches).
14. **`stats.html` CloudFront**: must serve with `Cache-Control: no-cache`. CloudFront was caching the 403→index.html error redirect at edge POPs, making `/stats.html` unreachable from some regions. Fixed by `error_caching_min_ttl = 0` + `no-cache` header on `stats.html` in `deploy.sh`.
15. **Overlay map zoom effect**: all three overlay map instances (`StationOverlay`, `TrainOverlay`, `RouteOverlay`) must be initialised with `center: mid` + `zoom: 13/14`. Without an initial position, `DirectionsRenderer` (`preserveViewport: false`) has no starting point to animate from, so no zoom effect occurs.
16. **i18n completeness**: `sites/landhauscheck/frontend/src/config/i18n.js` and each static HTML page's inline `dict` must always have entries for **all three languages** (de, en, pt). Missing keys render as `undefined` with no visible error.
17. **Widget titles/labels are in i18n.js**: all widget component titles, status messages, and labels are translated via the `t(lang, key)` helper. Every widget accepts a `lang` prop from `App.jsx`. Do not hardcode German strings inside widget components.
18. **`aws lambda update-function-configuration --environment`**: this replaces the ENTIRE env vars map. If you call it with only one variable, all other API keys are wiped. Always use `--description` for cold-start resets, and `tofu apply` for env var changes.
19. **`tofu` vs `terraform`**: the alias `terraform` on this machine points to HashiCorp v1.5.7. Always use `tofu` (OpenTofu v1.11.5) — the configs use OpenTofu syntax/providers.
20. **Google Geocoding REST API + referrer-restricted keys**: the Geocoding REST endpoint is explicitly blocked by Google when a referrer restriction is set on the key — even with a valid browser `Referer` header. Always proxy geocoding through Lambda (`/api/v1/geocode`). The browser key only needs `Maps JavaScript API` enabled.
21. **Stale JS bundle from cached `index.html`**: all HTML files must be uploaded with `Cache-Control: no-cache, no-store, must-revalidate`. If `index.html` is cached by the browser, users get the old JS bundle after a deploy — which may reference removed endpoints or use wrong API keys. `deploy.sh` now applies no-cache to all HTML files after every build.
22. **CSP blocks CDN resources on stats.html**: `cdn.jsdelivr.net` (Chart.js) and `unpkg.com` (Leaflet) must be in the CloudFront CSP `script-src` and `style-src`. Without them, charts and the user map render as empty white boxes with no console error visible in the network tab.
23. **Overlay `.position: relative` trap**: `.poiRouteOverlay` uses `position: absolute; inset: 0` and fills its nearest `position: relative` ancestor. If the widget's root element has `position: relative`, the overlay is trapped inside it and won't fill the full widget card. Only the `.widgetCard` glass container (which already has `position: relative`) should be the anchor. Remove `position: relative` from inner widget wrappers.
24. **Widget `?` help buttons**: `WidgetHelp.jsx` is a reusable component — pass `lang` and `helpKey` (key in `i18n.js`). Help texts must be added to all three language blocks in `i18n.js` whenever a new widget or help topic is added.
25. **ECR image immutability**: ECR is set to `IMMUTABLE` — the same tag cannot be pushed twice. `deploy.sh` uses the git SHA as the tag. Never attempt to push a `latest` alias tag.

## GitHub Secrets Required
| Secret | Used By |
|---|---|
| `AWS_ACCESS_KEY_ID` | Deploy workflow |
| `AWS_SECRET_ACCESS_KEY` | Deploy workflow |
| `AWS_REGION` | `eu-west-1` |
| `TF_VAR_HERE_API_KEY` | Deploy workflow → Terraform (Lambda server key) |
| `TF_VAR_HERE_BROWSER_API_KEY` | Deploy workflow → Terraform + frontend build (`VITE_HERE_API_KEY`) |
| `TF_VAR_GOOGLE_MAPS_API_KEY` | Deploy workflow → Terraform (Lambda server key) |
| `TF_VAR_GOOGLE_MAPS_BROWSER_API_KEY` | Deploy workflow → Terraform + frontend build (`VITE_GOOGLE_MAPS_API_KEY`) |
| `TF_VAR_DB_STADA_CLIENT_ID` | Deploy workflow → Terraform + refresh-stations cron |
| `TF_VAR_DB_STADA_API_KEY` | Deploy workflow → Terraform + refresh-stations cron |
| `GH_WASTE_PAT` | `waste-calendar-review.yml` — PAT with `repo` + `pull_requests: write` scopes; used by review agent to post reviews and squash-merge waste calendar PRs |

## Fuel & EV Charger Widget
- **Tankerkönig key**: `basicwebapp/tankerkoenig-api-key` in Secrets Manager, `TANKERKOENIG_API_KEY` Lambda env var, `tankerkoenig_api_key` in `terraform.tfvars`
- **Germany only for prices**: `countryCode === "DE"` gates Tankerkönig calls; non-DE countries use Google Places `gas_station` type (names only, no prices)
- **EV chargers**: Google Places `electric_vehicle_charging_station` type, always available
- **4 results max** for both fuel and chargers (sorted by distance, haversine)
- **15-minute client-side cache** per location — cleared when user moves >0.5 km (`lastFuelLocRef`)
- **`fuelKey` counter**: increments on each overlay open to force a fresh Google Maps instance (SDK cannot re-render into reused DOM)
- **Tab layout**: Traffic | ⛽ Tankstellen | ⚡ Ladestationen — inline tabs, no overlay, no close button needed
- **Map tab panel**: both fuel and charger panels always mounted in DOM (toggled via `display: none`), `setTimeout(resize, 50)` fires on switch to re-trigger Google Maps layout
- **Directions detail**: tapping a card opens DirectionsRenderer detail view with a back button
- **LiveBadge on map card**: positioned `bottom: 0.55rem` (not top) to avoid obscuring the tab bar

## Donation & Feature Request
- **Page**: `sites/landhauscheck/frontend/public/donate.html` (trilingual DE/EN/PT, glass-card design consistent with other static pages)
- **Flow**: Step 1 → PayPal.me button (`paypal.me/Schweigert`, opens in new tab, Friends & Family selectable by sender) → "I’ve already donated" link → Step 2: feature request form (name, optional email, textarea) → Step 3: thank-you message
- **Backend**: `POST /api/v1/feature-request` (`sites/landhauscheck/app/api/routes/feature_request.py`) — validates input, creates a Jira Task in project LHC via Atlassian REST API v3 (ADF-formatted description with donor name + email + request text)
- **Jira project**: `LHC` at `https://schweigert-dev.atlassian.net`, issue type Task (ID 10013), auth `urs.schweigert@outlook.com` + API token
- **Secret (prod)**: `basicwebapp/jira-api-key` in Secrets Manager → `JIRA_API_KEY` Lambda env var
- **Secret (dev)**: `/basicwebapp-dev/jira-api-key` SSM SecureString → `JIRA_API_KEY` Lambda env var
- **Non-secret Jira config**: `JIRA_EMAIL`, `JIRA_HOST`, `JIRA_PROJECT_KEY` are baked as plain env vars in `lambda.tf` (not sensitive)
- **Graceful degradation**: endpoint returns HTTP 503 if `JIRA_API_KEY` is empty; user-facing message says "temporarily unavailable"
- **Footer link**: "Unterstützen ❤️" / "Support ❤️" / "Apoiar ❤️" added to app footer in `App.jsx`; `donate` i18n key in `i18n.js`
- **Germany only for prices**: `countryCode === "DE"` gates Tankerkönig calls; non-DE countries use Google Places `gas_station` type (names only, no prices)
- **EV chargers**: Google Places `electric_vehicle_charging_station` type, always available
- **4 results max** for both fuel and chargers (sorted by distance, haversine)
- **15-minute client-side cache** per location — cleared when user moves >0.5 km (`lastFuelLocRef`)
- **`fuelKey` counter**: increments on each overlay open to force a fresh Google Maps instance (SDK cannot re-render into reused DOM)
- **Tab layout**: Traffic | ⛽ Tankstellen | ⚡ Ladestationen — inline tabs, no overlay, no close button needed
- **Map tab panel**: both fuel and charger panels always mounted in DOM (toggled via `display: none`), `setTimeout(resize, 50)` fires on switch to re-trigger Google Maps layout
- **Directions detail**: tapping a card opens DirectionsRenderer detail view with a back button
- **LiveBadge on map card**: positioned `bottom: 0.55rem` (not top) to avoid obscuring the tab bar

## Notification System (Tomorrow Banner + Push + Native Calendar Export)

### Architecture
Client-pull manifest model — no VAPID keys, no server-side push subscriptions:
- `GET /api/v1/notifications/manifest` returns tomorrow's waste collections for all ICS locations, served with `Cache-Control: public, max-age=3600`
- CloudFront caches the response → at most 1 Lambda invocation/hour regardless of how many users are active
- All timing logic (17:00 / 20:00 `setTimeout`) runs in the browser; the service worker fires `showNotification()`
- On permission grant, the picker opens `/calendar-import.html` (platform-aware static helper page in real Safari) so the user can import the ICS into their native calendar app; iOS Calendar then fires its own native alerts independently of the PWA

### New Files
| File | Role |
|---|---|
| `sites/landhauscheck/app/api/routes/notifications.py` | Manifest endpoint: scans `data/waste/*.ics`, returns tomorrow's events grouped by calendar location |
| `sites/landhauscheck/frontend/public/sw.js` | Service worker: location match (haversine ≤3 km), dedup guard, `showNotification()`, Periodic Background Sync |
| `sites/landhauscheck/frontend/src/hooks/usePushNotifications.js` | SW registration, permission lifecycle, `setTimeout` scheduling, PBS registration, `markCalendarExported()` |
| `sites/landhauscheck/frontend/public/calendar-import.html` | Platform-aware static helper page for native calendar import; opened in real Safari (escapes WKWebView sandbox); per-platform instructions + ICS/webcal links |

### SW State Storage (Cache API keys)
| Key | Value |
|---|---|
| `/__sw_state__/location` | `{lat, lng, lang}` JSON — synced on every location change |
| `/__sw_state__/notified/{isoDate}/{slot}` | `"1"` — dedup guard; `slot` = `"17h"` or `"20h"` |

### Bell Button UX
- Shows in app footer only when `"Notification" in window` is truthy
- 🔔 (clickable) — permission not yet granted; `onClick` calls `requestPermission()`
- 🔔 with active style — permission granted; `onClick` is no-op
- 🔕 (disabled) — permission denied by user; shows tooltip asking to unblock in browser settings
- 📅 button — shown when notifications are enabled; allows re-export of ICS to native calendar app

### Native Calendar Export
- **ICS endpoint**: `GET /api/v1/waste/calendar.ics?lat=...&lng=...` returns raw ICS file (`text/calendar`, `Content-Disposition: attachment`, 1 h CloudFront cache, 404 if nothing within 5 km). Each VEVENT carries `VALARM TRIGGER:-P0DT7H0M` (17:00 alert the evening before collection day).
- **Helper page**: `sites/landhauscheck/frontend/public/calendar-import.html` — standalone static page opened in real Safari (escapes WKWebView sandbox). Reads `?lat`, `?lng`, `?lang`, `?base` URL params. Auto-detects platform:
  - **iOS**: `<a href=icsUrl target="_self">` — `Content-Disposition: attachment` triggers iOS "Add to Calendar" system sheet → events land in personal calendar with 17:00 VALARM. **Confirmed working.**
  - **macOS**: webcal `<a>` (VALARMs honoured in macOS Calendar) + ICS download fallback
  - **Android / Other**: `<a download="abfuhrkalender.ics">` standard file download
- **PWA flow**: 📅 button → `CalendarPickerModal` → single "Kalender-Anleitung öffnen" `<a>` → helper page in real Safari
- **Dedup guard**: `markCalendarExported()` sets `localStorage.lhc_cal_{roundedLat}_{roundedLng}` when user taps the helper page link. Re-export always available via 📅 button.
- **iOS WKWebView constraint**: from a standalone PWA, `window.location.href`, `window.open()`, and `<a target="_blank">` all remain in the WKWebView sandbox — WKWebView has no download manager. The helper page escapes this by rendering in real Safari.
- **webcal on iOS**: iOS strips custom VALARM triggers from subscribed (read-only) calendars. Always use ICS import into a personal calendar for 17:00 alerts.

### iOS Requirements
- iOS 16.4+ required for Web Push permission in PWA mode
- **In-app `setTimeout` notifications only fire when the app is in the foreground at 17:00 / 20:00** — iOS freezes JS timers in the background regardless of Home Screen installation
- **Native Calendar** (via `calendar-import.html` helper page) is the recommended notification path for iOS: fires at 17:00 per VALARM, independent of the PWA

### Android
- Chrome/Edge: works in-browser; no Home Screen required
- Periodic Background Sync (`lhc-garbage-check`, `minInterval: 43200000`) wakes the SW every 12 h when the page is closed (Chrome 80+)
## Waste Calendar Contribution System
- **Endpoint**: `POST /api/v1/waste/contribute` (`sites/landhauscheck/app/api/routes/waste_contribute.py`)
- **Accepts**: multipart ICS file upload with `lat`, `lng` query params; `GH_WASTE_PAT` env var required (GitHub PAT with `repo` + `pull_requests: write` scopes)
- **Flow**: validate ICS → content-moderate → inject `X-WR-GEO-LAT/LNG` headers → create branch `waste/contrib-{lat}-{lng}-{ts}` on GitHub → create PR → return PR URL to caller
- **Duplicate detection**: `_list_matching_paths()` uses two strategies: (1) filename suffix `_{lat:.4f}_{lng:.4f}.ics`, (2) GitHub code search for `X-WR-GEO-LAT:{lat:.4f}` — creates update branch (`waste/update-*`) if duplicate found, expire branch (`waste/expire-*`) if content-flag set
- **Content moderation**: `_check_harmful_content()` — 40+ regex patterns covering slurs, extremist terms, and XSS injection (EN/DE/PT); raises `HTTPException(400)` on detection
- **Auto-review agent**: `.github/workflows/waste-calendar-review.yml` triggers on PRs touching `sites/landhauscheck/app/data/waste/**.ics` (branch prefixes `waste/contrib-*`, `waste/update-*`, `waste/expire-*`); runs `scripts/review_waste_pr.py` which validates, normalises, re-moderates, posts a GitHub review, and squash-merges on APPROVE
- **URL scheme safety**: GitHub API `urlopen` call validates `https://` scheme before calling (`# nosec B310`); non-HTTPS URL raises `ValueError`
- **Stats tracking**: each successful PR creation increments `waste_contributions_total` and `waste_contributions_by_day[date]` in `stats_store.py` (persisted to S3)
- **Frontend**: `GarbageWidget.jsx` shows always-visible upload button; expired-state detection triggers upload prompt; i18n strings in DE/EN/PT in `i18n.js`
- **Stats page cards**: `id="c-waste-cals"` (total ICS files in `data/waste/`) and `id="c-waste-contribs"` (cumulative upload count) on `stats.html`

## Imperial Units (US)
- `countryCode === "US"` gates imperial everywhere — temperature (°F), wind speed (mph), distances (ft/mi)
- `countryCode` is sourced from: (1) reverse geocode (`geoInfo.countryCode` from BigDataCloud), (2) geocode result (`address_components` country code) on manual entry — applied **immediately** without waiting for BigDataCloud round-trip
- `ClockWidget` passes `temperature_unit=fahrenheit&wind_speed_unit=mph` to Open-Meteo when `imperial=true`
- All distance-formatting widgets (`TransitWidget`, `RoutingWidget`, `PoiWidget`, `GoogleMapWidget`) accept `countryCode` prop and use a shared `fmtDist(m, imperial)` helper
- `StopCard` in `TransitWidget` is a separate function outside the `TransitWidget` closure — must receive `imperial` as an explicit prop (not read from closure)

## Known Pitfalls
26. **`StopCard` scope**: `StopCard` is defined outside `TransitWidget`, so it cannot access `TransitWidget`'s local variables. Any new prop (like `imperial` or `lang`) must be passed explicitly to `StopCard`.
27. **Deploy script raw S3 sync**: never run `aws s3 sync sites/landhauscheck/frontend/dist/ s3://...` directly — it bypasses the Docker build that fetches `VITE_GOOGLE_MAPS_API_KEY` from Secrets Manager. Always use `bash scripts/deploy.sh aws --frontend-only`.
28. **Fuel cache stale after location change**: `fuelFetchedRef.current` is only cleared when `lastFuelLocRef` detects a position change >0.5 km. If the user manually enters a new city, the cache is cleared and fresh data is fetched. Make sure `location` changes propagate correctly to `lastFuelLocRef`.
29. **`display: none` map resize**: when switching tabs in the map widget, the hidden map panel has 0px dimensions. Always call `google.maps.event.trigger(map, 'resize')` inside a `setTimeout(..., 50)` after switching to the map tab — without it the map renders as a grey box.
30. **`docs/SYSTEM.md` staleness**: CI warns (non-blocking) if `apps/` or `infra/` files change without updating `docs/SYSTEM.md`. Always update the system doc alongside the code.
31. **iOS WKWebView sandbox**: from a standalone PWA (Home Screen), `window.location.href`, `window.open()`, and `<a target="_blank">` all remain in the WKWebView sandbox. WKWebView has no download manager — `Content-Disposition: attachment` produces a blank/stalled page. The only reliable escape: navigate the user to a URL that iOS opens in real Safari. All calendar-export links must live on `calendar-import.html`, not be initiated directly from within the PWA.

## Recent Changes (this session)
| Version | Date | Summary |
|---|---|---|
| v1.2.0 | 2026-04-04 | Footer version badge + release-notes page; stats.html API budget table |
| v1.2.1 | 2026-04-04 | `NavPromptSheet` walking mode fix (restroom tiles) |
| v1.2.2 | 2026-04-04 | Progressive restroom loading: Google + OSM race, merge when second arrives |
| v1.2.3 | 2026-04-04 | Restroom tiles sorted by distance ascending; `subtitle` field; HERE pedestrian walk times |
| v1.3.11 | 2026-04-15 | Waste notification system: dismissible tomorrow-collection banner (amber, pulsing); `GET /api/v1/notifications/manifest` (CloudFront-cached 1 h, O(1) Lambda invocations); service worker (`public/sw.js`) with haversine match (3 km), dedup guard, 17:00+20:00 notify slots, Periodic Background Sync; `usePushNotifications.js` hook; 🔔/🔕 bell button in footer; i18n strings in DE/EN/PT; iOS 16.4+/Android documentation. |
| v1.3.12 | 2026-04-17 | Bell button refactor: `isPending` state moved from hook into `App.jsx`; `requestPermission` is now pure async; iOS detection simplified to `navigator.maxTouchPoints > 1 && /Apple/.test(navigator.vendor)`; toast timer cleaned up on unmount. Frontend-only deploy. |
| v1.3.13 | 2026-04-20 | iOS notification bug fixes (toast condition + `notifIOSTip` strings in 3 langs) + native calendar export: `GET /api/v1/waste/calendar.ics` endpoint; `CalendarPickerModal` + 📅 button in footer; VALARMs (`TRIGGER:-P0DT7H0M`, 17:00 alert); i18n `calExportBtn`/`calExportedTitle` in DE/EN/PT. Frontend + backend deploy. |
| calendar import fix | 2026-04-21 | iOS WKWebView fix: `CalendarPickerModal` now opens `/calendar-import.html` (platform-aware static helper page) instead of directly triggering ICS download. Escapes WKWebView sandbox. Confirmed working on iOS. `markCalendarExported()` replaces direct download path. |
| v1.3.0 | 2026-04-05 | Waste calendar contribution system: `POST /api/v1/waste/contribute`, GarbageWidget upload UI, auto-review agent (`waste-calendar-review.yml` + `review_waste_pr.py`), content moderation (40+ patterns), contribution counters in stats, 2 new stats.html cards, picker feature card descriptions updated DE/EN/PT. 61 unit tests. |
| security | 2026-04-05 | CVE-2026-24486: `python-multipart` 0.0.20 → 0.0.22 (`requirements.txt`, commit `b4c271c`); bandit B310: explicit HTTPS scheme validation before `urlopen` in `waste_contribute.py` + `# nosec B310` (commit `3dcf4fd`). CI green. |
| v1.3.1 | 2026-04-05 | Help page (`/help.html`) — trilingual (DE/EN/PT), 9 sections (location, clock/weather, map tabs, bus, train, POI, waste/upload, language, privacy), glass-morphism design with `lhc_lang` localStorage lang switcher. Portrait banner `?` button (`.appBanner__helpBtn`, 28px circular glass, `margin-left: auto`); `aria-hidden` removed from banner; help link added to footer; `help` i18n key in DE/EN/PT. `deploy.sh`: extracted `generate_releases_json()` with 4-level token fallback (GH_TOKEN → `gh auth token` → `git credential fill` → `github_token` from `terraform.tfvars`); `push_releases_json_to_s3()` added and called on backend-only prod deploys; `help.html` added to no-cache HTML upload list. `package.json` bumped `1.2.5` → `1.3.1` (was not bumped at v1.3.0 squash-merge). Tag `v1.3.1` + GitHub release ID 305431725. Deployed to prod. |
| fix | 2026-04-05 | Viewport overflow + pinch-to-zoom: `index.html` viewport meta adds `maximum-scale=1.0, user-scalable=no`; `styles.css` changes `body`/`.layout` from `min-height: 100dvh` → `height: 100dvh`; adds `html { height: 100%; overflow: hidden; touch-action: pan-x pan-y; }` and `body { overflow: hidden; touch-action: pan-x pan-y; overscroll-behavior: none; }`; portrait media query releases to `height: auto; overflow-y: auto` so single-column scroll still works. macOS duplicate files (` 2` suffix) deleted. Commit `62475ac`. Deployed to dev + prod (frontend-only). |

## Code Quality Assessment (2026-04-08, v1.3.9)

**Overall rating: 6.5 / 10**

| Dimension | Score |
|---|---|
| Backend architecture | 8/10 |
| Frontend architecture | 7/10 |
| Frontend tests | 2/10 |
| Backend tests | 6/10 |
| Error handling consistency | 5/10 |
| Security | 7/10 |
| Performance / caching | 5/10 |
| Documentation | 7/10 |
| Deployment / infra | 8/10 |
| Code hygiene (dead code, magic numbers) | 5/10 |

### Strengths
- Backend architecture is the strongest part — clean route separation, Pydantic settings with `sensitive=True`, security headers middleware, hashed sessions (no raw PII).
- Dual-provider fallback patterns (weather: Open-Meteo → Bright Sky; rail: DB snapshot → Google Places) are robust.
- Terraform state management (S3 + DynamoDB lock, tagged resources, remote ACM alias) is production-grade.
- `deploy.sh` documents its own known pitfalls. `core/config.py` is exemplary.
- CSS design system is consistent — variables, glassmorphism tokens, and chip/tab patterns applied uniformly.

### Top issues to address
1. **Frontend testing is essentially zero.** `vite.config.js` restricts coverage to `src/hooks/**` only. `WidgetHelp`, `TransitWidget`, `PoiWidget`, `GarbageWidget` — none are tested. That's the bulk of the application logic.
2. **No rate limiting on any public endpoint.** `/transit`, `/weather`, `/waste`, `/poi` are unauthenticated and mostly uncached (weather has no cache at all). A modest scraper could run up significant HERE/Google API bills.
3. **Silent failures in several places.** `_load_stations()` returns `[]` with no log on missing file. HERE ID cache read (`sessionStorage`) silently swallows exceptions. Hard to diagnose in production.
4. **`stats_store.py` threading.Lock in async middleware.** Called from `async def dispatch()` — can cause thread contention under load. Should be `asyncio.Lock`.
5. **Magic numbers scattered throughout.** 220px popup width, 250 m/min bike speed, 3.0 rating threshold, 8s HTTP timeout, `120 * 60 * 1000` for POI refresh — none are named constants or config entries.
6. **Dead/deprecated code not removed.** `RoutingWidget.jsx` still exists on disk (not imported). `db_password` in `variables.tf` and `config.py` is marked "can be deleted after cleanup" but hasn't been.
7. **No API contract / OpenAPI documentation.** FastAPI generates this for free. Not exposed or maintained — frontend/backend coupling is by convention only.
8. **`conftest.py` is 10 lines of env var stubs.** No fixture infrastructure, no DB mock factories. Tests that do exist are mostly happy-path and reach into private internals (`_POI_CACHE.clear()`).

## Handoff — Pick Up Here Tomorrow
**Status**: commit `1cd73cc` deployed to dev + prod (2026-04-21). CI green. No outstanding security issues or undeployed changes. iOS native calendar import confirmed working via `calendar-import.html` helper page.

**Next session options** (priority order):
1. **Terraform remote state** — migrate `infra/terraform/sites/landhauscheck/terraform.tfstate` and `infra/terraform/sites/landhauscheck-dev/` to S3 backend. Local-only state risks data loss if the machine is lost. ~30 min effort.
2. **`usePushNotifications.js` cleanup** — `exportCalendar(type)` still has the old webcal/blob-download split but is no longer called by any production flow. Safe to simplify to just `markCalendarExported()`.
3. **Restroom opening hours display** — OSM `opening_hours` strings are raw; could render "open now" indicator using the `opening_hours` JS library.
4. **Playwright E2E** — re-enable in CI once a widget test is written.
5. **Cloudflare registrar transfer** — optional, saves ~$5/year.

**Dev environment**: live at https://dev.landhauscheck.com and mirrors prod.
**Prod**: live at https://landhauscheck.com. Both environments running `1cd73cc` (calendar import helper page on top of v1.3.13).
**Git**: all changes committed and pushed to `main`. HEAD: `1cd73cc` (feat(calendar): replace modal picker with calendar-import.html helper page to escape WKWebView sandbox).
