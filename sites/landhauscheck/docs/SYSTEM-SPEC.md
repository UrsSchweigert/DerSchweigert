# Landhauscheck — System Specification

> ⚠️ **Keep this file up to date.** Every push that changes behaviour, constraints, or
> requirements must include an update here. This is the prescriptive counterpart to
> `SYSTEM.md` (descriptive). If a requirement changes, update here first, then implement.

**Version**: 1.3.13  
**Last updated**: 2026-04-20

---

## 1. Purpose & Scope

**Landhauscheck** is a personal, location-aware web dashboard that displays live local
information widgets. This specification defines what the system **must** do and within what
constraints — covering functional requirements, non-functional requirements, UX rules,
security mandates, and operational boundaries.

---

## 2. Functional Requirements

### FR-1 — Location Detection

| ID | Requirement |
|---|---|
| FR-1.1 | The app **must** detect the user's location via GPS (Geolocation API) or manual address entry. |
| FR-1.2 | GPS requires explicit user consent (`lhc_consent_v1` localStorage key). |
| FR-1.3 | Manual entry **must** geocode via the backend proxy (`/api/v1/geocode`). The frontend **must never** call Google Geocoding REST API directly (blocked by Google for referrer-restricted keys). |
| FR-1.4 | When `locationSource === "manual"`, GPS `watchPosition` **must** be stopped — the map marker stays fixed on the manually chosen place permanently. |
| FR-1.5 | The location picker **must** only close via explicit user actions (GPS retry button, address pick). In-flight GPS callbacks **must not** auto-dismiss the picker. |

### FR-2 — Widgets

The app **must** render the following widgets, each in its own `<ErrorBoundary>`:

| Widget | Data Source | Refresh Interval | Max Visible Items |
|---|---|---|---|
| **Clock + Weather** | Open-Meteo (primary), Bright Sky/DWD (fallback) | 30 min | 5-hour forecast strip |
| **Traffic Map** | Google Maps TrafficLayer + 5-tab panel (🚦⛽⚡🚻🏧) | 5 min heartbeat | 6 fuel/EV, 8 restroom/ATM |
| **Bus Connections** | HERE Transit `/v8/stations` + `/v8/departures` | 30 min | All stops within radius |
| **Train Stations** | DB StaDa snapshot + Google Places fallback | 30 min | All stations within radius |
| **POI** | Google Places Nearby Search, 5 categories | 2 hours | Up to 20 fetched; **≤7 visible before scrolling** (CSS `max-height: 17rem`; `overflow-y: auto`) |
| **Garbage** | ICS files matched by haversine to `locations.json` | 60 min | Next collection dates |

#### FR-2.1 — POI Widget

| ID | Requirement |
|---|---|
| FR-2.1.1 | **Must** fetch up to 20 POIs within 7 km radius. |
| FR-2.1.2 | **Must** display icon-only filter chips for: All, Food & Drink, Essential Facilities, Shopping, Accommodation, Culture. |
| FR-2.1.3 | Available category chips **must** be derived from API data (no empty categories shown). |
| FR-2.1.4 | Default filter **must** be Food & Drink. |
| FR-2.1.5 | The list **must** show at most 7 items before requiring vertical scroll. This applies in both landscape and portrait orientations. |
| FR-2.1.6 | Tapping a POI row **must** open a walking-route overlay (Google Directions). |

#### FR-2.2 — Map Widget Panel

| ID | Requirement |
|---|---|
| FR-2.2.1 | All four non-traffic datasets (fuel, EV, restroom, ATM) **must** be fetched in parallel on first non-traffic tab open. |
| FR-2.2.2 | 15-minute client-side cache per location; cache cleared when user moves >0.5 km. |
| FR-2.2.3 | Fuel tab: Tankerkönig real-time prices for DE; Google Places locations for non-DE. |
| FR-2.2.4 | Tapping a card **must** open NavPromptSheet (driving for fuel/charger, walking for restrooms/ATMs). |
| FR-2.2.5 | `MapPanel` **must** remain mounted (hidden via `display:none`) after its first visit so that `fuelMapInstanceRef` stays bound to a live DOM node across tab switches. Unmounting and remounting `MapPanel` on every traffic↔panel switch **must not** occur. |

#### FR-2.3 — Weather Widget

| ID | Requirement |
|---|---|
| FR-2.3.1 | Primary source: Open-Meteo (8 s timeout). |
| FR-2.3.2 | Fallback: Bright Sky / DWD. **Must** transparently fall back on any `HTTPStatusError` or `RequestError`. |
| FR-2.3.3 | Bright Sky UTC timestamps **must** be normalised to local time on the frontend. |
| FR-2.3.4 | Imperial conversion (US users): °C × 9/5 + 32, done in the backend. |

#### FR-2.4 — Garbage Widget

| ID | Requirement |
|---|---|
| FR-2.4.1 | **Must** support ICS file upload via `POST /waste/contribute` (creates GitHub PR). |
| FR-2.4.2 | Content moderation: 40+ regex patterns (EN/DE/PT) **must** reject harmful content before PR creation. |
| FR-2.4.3 | Auto-review agent **must** validate VEVENT structure, inject geo headers, and squash-merge on APPROVE. |

#### FR-2.6 — Notification System

| ID | Requirement |
|---|---|
| FR-2.6.1 | App **must** show a dismissible amber banner when `GarbageWidget` fires `onTomorrowEvents` (non-empty tomorrow collection list). |
| FR-2.6.2 | App **must** offer a 🔔 notification opt-in button in the footer, visible only when the Notifications API is supported by the browser. |
| FR-2.6.3 | Notification manifest endpoint **must** be served with `Cache-Control: public, max-age=3600`. |
| FR-2.6.4 | Service worker **must** match user location to manifest entries using haversine distance ≤ 3000 m. |
| FR-2.6.5 | Notifications **must** fire at 17:00 (first alert) and 20:00 (reminder) in the user's local time. |
| FR-2.6.6 | Duplicate notifications **must** be prevented per `(date, slot)` pair using a Cache API dedup guard. |
| FR-2.6.7 | On iOS, the app **must** inform users that JavaScript timers are frozen in the background, and that the app must remain open at 17:00 and 20:00 to receive in-app reminders. |
| FR-2.6.8 | On permission grant (and via persistent 📅 button), `exportCalendar()` **must** offer the nearest ICS file to the native calendar app. On iOS this **must** use `window.location.href` so the OS intercepts it as a `text/calendar` response and shows the system "Add to Calendar" sheet. On desktop/Android it **must** trigger a file download. |
| FR-2.6.9 | Calendar export **must** be deduplicated per location: once exported, `localStorage` **must** store a flag (key = rounded `lat/lng`) so the export is not triggered again for the same location on subsequent permission grants or app restarts. Re-export **must** remain available at any time via the 📅 button. |
| FR-2.6.10 | The `GET /api/v1/waste/calendar.ics` endpoint **must** return `Content-Type: text/calendar` and `Content-Disposition: attachment`. It **must** return HTTP 404 when no ICS file is found within 5 km of the supplied coordinates. |

#### FR-2.5 — Transit Widget (Bus + Rail)

| ID | Requirement |
|---|---|
| FR-2.5.1 | **Must** show Bus and Rail as two tabs within a single widget (chip switcher). |
| FR-2.5.2 | Both tabs **must** load eagerly on location; single 30 min countdown drives both. |
| FR-2.5.3 | Bus stops: tapping a row → walking-route overlay. Train stations: tapping a row → driving-route overlay. |

### FR-3 — Internationalisation

| ID | Requirement |
|---|---|
| FR-3.1 | **Must** support DE (default), EN, PT. |
| FR-3.2 | Detection order: `localStorage.lhc_lang` → `navigator.language` prefix → DE. |
| FR-3.3 | `sites/landhauscheck/frontend/src/config/i18n.js` is the single source of truth for React app strings. **All three language blocks must be updated together** when adding/changing any user-visible string. |
| FR-3.4 | Static HTML pages (impressum, datenschutz, help, donate, release-notes, stats-login) **must** have inline trilingual dictionaries updated in sync. |

### FR-4 — Unit System

| ID | Requirement |
|---|---|
| FR-4.1 | US users (`countryCode === "US"`): imperial — °F, feet, miles. |
| FR-4.2 | All other users: metric — °C, metres, km. |
| FR-4.3 | Country code auto-detected via BigDataCloud reverse geocode. |

### FR-5 — Navigation Prompts

| ID | Requirement |
|---|---|
| FR-5.1 | Tapping interactive tiles **must** open a NavPromptSheet (bottom sheet via `createPortal`). |
| FR-5.2 | iOS: `maps://` scheme. Android: `geo:` intent (OS chooser). Desktop: Google Maps web. |
| FR-5.3 | Travel mode **must** match context: driving for fuel/charger/train, walking for restroom/ATM/POI/bus. |

### FR-6 — Stats System

| ID | Requirement |
|---|---|
| FR-6.1 | Stats **must** be PIN-protected (`X-Stats-Pin` header + CloudFront Function cookie check). |
| FR-6.2 | Developer traffic (`lhc_devmode=1` cookie) **must** be excluded from all tracking. |
| FR-6.3 | Bot requests (CloudFront health probes, crawlers) **must** be excluded from human session count. |
| FR-6.4 | Stats **must** persist to S3 (`stats_persist.json`) and survive Lambda cold starts. |

---

## 3. Non-Functional Requirements

### NFR-1 — Cost

| ID | Requirement |
|---|---|
| NFR-1.1 | Production monthly cost **must not exceed $5/month** (target: $1–3). |
| NFR-1.2 | Dev environment cost **must not exceed $1/month** (target: ~$0.10). |
| NFR-1.3 | No ALB, no ECS, no RDS — all replaced by Lambda + API Gateway + S3. |
| NFR-1.4 | Secrets **must** use SSM Parameter Store SecureString (free) — not Secrets Manager ($0.40/secret/month). |
| NFR-1.5 | Domain registration (Route 53): ~$14/year — accepted fixed cost. |
| NFR-1.6 | Notification system **must not** increase Lambda invocations beyond O(1) per hour, regardless of active user count (achieved via CloudFront-cached manifest). |

### NFR-2 — Performance

| ID | Requirement |
|---|---|
| NFR-2.1 | Lambda memory: 512 MB, ARM64 architecture. |
| NFR-2.2 | POI backend cache: 6-month TTL, file-persisted to `/tmp/poi_cache.json`. |
| NFR-2.3 | Departures backend cache: 30 min TTL, file-persisted to `/tmp/dep_cache.json`. |
| NFR-2.4 | Weather fallback timeout: 8 seconds before switching to Bright Sky. |
| NFR-2.5 | All HTML files served with `Cache-Control: no-cache, no-store, must-revalidate`. |
| NFR-2.6 | CloudFront error pages: `error_caching_min_ttl = 0` (prevents stale redirects at edge POPs). |

### NFR-3 — Security

| ID | Requirement |
|---|---|
| NFR-3.1 | HTTPS enforced everywhere (HSTS `max-age=31536000; includeSubDomains; preload`). |
| NFR-3.2 | `Content-Security-Policy` **must** allowlist only: Google Maps, HERE, Open-Meteo, BigDataCloud, `cdn.jsdelivr.net`, `unpkg.com`. |
| NFR-3.3 | `X-Frame-Options: DENY` — no embedding in iframes. |
| NFR-3.4 | `X-Content-Type-Options: nosniff`. |
| NFR-3.5 | `Referrer-Policy: strict-origin-when-cross-origin`. |
| NFR-3.6 | `Permissions-Policy: camera=(), microphone=(), geolocation=(self), payment=()`. |
| NFR-3.7 | PIN comparison **must** use `secrets.compare_digest()` (timing-safe). |
| NFR-3.8 | CI **must** run `bandit` (Python), `pip-audit`, and `npm audit --audit-level=high` on every push. |
| NFR-3.9 | Server-side API keys **must never** have referrer/domain restrictions (Lambda has no `Referer`). |
| NFR-3.10 | Browser API keys **must** have referrer restriction to `landhauscheck.com/*`. |
| NFR-3.11 | `POST /waste/contribute` content moderation: 40+ regex patterns **must** block harmful content. GitHub API URL **must** be validated as HTTPS-only (`# nosec B310`). |
| NFR-3.12 | **Never** use `aws lambda update-function-configuration --environment` for resets — it wipes all env vars. Use `--description` only. |

### NFR-4 — Availability & Resilience

| ID | Requirement |
|---|---|
| NFR-4.1 | A single widget crash **must not** blank the entire app (each wrapped in `<ErrorBoundary>`). |
| NFR-4.2 | Weather **must** have a fallback provider (Open-Meteo → Bright Sky). |
| NFR-4.3 | Train stations **must** have a fallback (DB StaDa snapshot → Google Places). |
| NFR-4.4 | Stats **must** survive Lambda cold starts (S3 persistence + `/tmp` fallback). |
| NFR-4.5 | CloudWatch log retention: 7 days. |

### NFR-5 — Accessibility & UX

| ID | Requirement |
|---|---|
| NFR-5.1 | Touch targets **must** meet Apple HIG minimum (44 px / 2.75 rem). |
| NFR-5.2 | Every widget **must** have a `?` help button (WidgetHelp.jsx, portal-based, i18n-aware). |
| NFR-5.3 | LiveBadge **must** show widget freshness: `● live` (green) → `● Update in Xm` → `● Fehler` (red) → `◌ lädt…` (grey). |
| NFR-5.4 | Pull-to-refresh: swipe ≥70 px at scroll top → spinner → reload. |
| NFR-5.5 | Screen wake lock **must** be active and re-acquired on `visibilitychange`. |
| NFR-5.6 | Portrait mode: single-column, document scroll. Landscape: grid, fills viewport. |
| NFR-5.7 | Mobile portrait banner visible only on `(max-width: 480px) and (orientation: portrait)`. |

### NFR-6 — Observability

| ID | Requirement |
|---|---|
| NFR-6.1 | Stats dashboard (`/stats.html`) **must** refresh every 30 s. |
| NFR-6.2 | Stats dashboard **must** show: summary cards, endpoint chart, daily chart, sessions-per-day chart, user map (Leaflet), sessions table, error log. |
| NFR-6.3 | Bot traffic **must** be shown as a collapsed summary row, separate from human sessions. |

---

## 4. API Contract

Base path: `/api/v1/`

### 4.1 — Public Endpoints (no auth)

| Method | Path | Required Params | Response | Cache |
|---|---|---|---|---|
| `GET` | `/health` | — | `200 OK` | — |
| `GET` | `/weather/forecast` | `lat`, `lng` | JSON: hourly forecast + moon phase | 30 min client |
| `GET` | `/transit/nearby` | `lat`, `lng` | JSON: nearby bus stops | — |
| `GET` | `/transit/departures` | `station_id` | JSON: upcoming departures | 30 min server |
| `GET` | `/transit/rail-nearby` | `lat`, `lng` | JSON: nearby train stations | 1 h sessionStorage |
| `GET` | `/transit/poi-nearby` | `lat`, `lng`, `radius`, `limit`, `lang` | JSON: POI list (≤20 items) | 6 mo server file |
| `GET` | `/waste/upcoming` | `lat`, `lng` | JSON: next waste collection dates | 60 min client |
| `POST` | `/waste/contribute` | multipart ICS file | `201` + PR URL, or `422`/`400` | — |
| `GET` | `/holidays` | `country`, `state` (optional) | JSON: public holidays | — |
| `GET` | `/geocode` | `address` | JSON: `{lat, lng, formatted_address}` | — |
| `GET` | `/fuel` | `lat`, `lng` | JSON: 4 cheapest diesel/E10 (DE only) | 15 min client |
| `GET` | `/chargers` | `lat`, `lng`, `poi_type` | JSON: nearby chargers/gas/toilet/ATM | 15 min client |
| `GET` | `/notifications/manifest` | — | JSON: tomorrow's waste collections by ICS location | CloudFront 1 h |
| `POST` | `/feature-request` | JSON body | `201` + Jira issue key | — |
| `GET` | `/logs` | — | JSON: recent request log | — |

### 4.2 — Admin Endpoints (PIN-protected)

| Method | Path | Auth | Response |
|---|---|---|---|
| `POST` | `/admin/verify-pin` | PIN in body | Sets `lhc_pin` + `lhc_devmode` cookies |
| `GET` | `/admin/stats` | `X-Stats-Pin` header | Full stats JSON |
| `POST` | `/admin/clear-devmode` | `X-Stats-Pin` header | Clears `lhc_devmode` cookie |

---

## 5. External API Budget

### 5.1 — Per Session (on page load)

| API | Calls | Notes |
|---|---|---|
| Google Maps JS | 1 (CDN) | Map tile load |
| HERE map tiles | ~12–20 | Map tile loads |
| Open-Meteo | 1 | Weather forecast |
| HERE stations | 1 | Bus stops |
| HERE departures | 1 | Bus departures |
| BigDataCloud | 1 | Reverse geocode (once per session) |
| Google Places | 3 | POI nearby (if cache miss — rare, 6-month TTL) |
| **Total on load** | **~11** (at most ~20 with cache misses) | |

### 5.2 — Per Hour (per active user)

| API | Calls/hour | Notes |
|---|---|---|
| Open-Meteo | 2 | Every 30 min |
| HERE departures | 2 | Every 30 min |
| HERE map tiles | ~5 | Periodic refreshes |
| **Total/hour** | **~9** (steady state, no tab switches) | |

### 5.3 — Cost Constraints

| Provider | Free Tier / Budget |
|---|---|
| Google Maps JS + Places | $200/month credit (Maps Platform) |
| HERE | 250 k transactions/month free |
| Open-Meteo | Unlimited (free, non-commercial) |
| Bright Sky / DWD | Unlimited (free, public data) |
| BigDataCloud | Free tier (locality lookups) |
| Tankerkönig | Free (open data) |
| DB StaDa | Free (monthly cron only) |

---

## 6. Deployment Rules

| ID | Rule |
|---|---|
| DR-1 | **Always deploy to `dev.landhauscheck.com` first.** Confirm testing before any prod deployment. `deploy.sh` enforces interactively; CI bypasses with `DEPLOY_CONFIRMED=yes`. |
| DR-2 | Lambda images **must** be built with `--platform linux/arm64`. |
| DR-3 | ECR tags are **immutable** — always use git SHA, never `latest`. |
| DR-4 | API Gateway payload format **must** be `2.0` (Mangum requirement). |
| DR-5 | CloudFront invalidation (`/*`) **must** follow every S3 sync. |
| DR-6 | Region **must** be `eu-west-1` (read from `terraform.tfvars`, not `variables.tf` default). |
| DR-7 | IaC tool: OpenTofu v1.11.5 (`tofu` command). Prod: `infra/terraform/sites/landhauscheck/`. Dev: `infra/terraform/sites/landhauscheck-dev/`. Separate state files. |
| DR-8 | `releases.json` **must** be regenerated before every frontend build (GitHub Releases API, 4-level token fallback). |

---

## 7. Overlay Implementation Rules

All route overlays (Bus, Train, POI) **must** follow these patterns:

| ID | Rule |
|---|---|
| OR-1 | Call `loadGoogleMapsScript()` then use `window.google.maps` (NOT the return value). |
| OR-2 | `useEffect(init, [])` with **empty deps only** — never pass the data object (causes re-init loop). |
| OR-3 | `selectedItem` state lives in parent widget; overlay renders when non-null. |
| OR-4 | Map initialised with `center: midpoint, zoom: 14` so `DirectionsRenderer` (`preserveViewport: false`) produces a zoom-in effect. |
| OR-5 | CSS class: `.poiRouteOverlay` / `.poiRouteOverlay--visible`. |
| OR-6 | Close: transparent div at `z-index: 1` below map (`z-index: 2`). Fade out 0.3 s. |

---

## 8. Revision History

| Date | Version | Change |
|---|---|---|
| 2026-04-15 | 1.3.11 | Added FR-2.6 (Notification System: tomorrow banner, push opt-in, manifest endpoint, service worker, haversine match, dedup guard, iOS PWA requirements). Added NFR-1.6 (notification system must not increase Lambda invocations beyond O(1)/hour). Added `/notifications/manifest` to API contract. |
| 2026-04-11 | 1.3.9 | Initial specification created. Extracted all implicit requirements from SYSTEM.md and HANDOFF.md into testable, prescriptive form. Covers: functional requirements (widgets, i18n, navigation, stats), non-functional requirements (cost ≤$5/mo, security headers, resilience, accessibility), API contract, external API budget, deployment rules, overlay implementation rules. |
