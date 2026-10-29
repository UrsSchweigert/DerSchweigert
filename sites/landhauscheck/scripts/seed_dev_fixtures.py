#!/usr/bin/env python3
"""Seed the dev fixture cache for Mägdebergstrasse 5, Singen (Hohentwiel).

Usage
-----
1.  Start the local backend in **record** mode:

    DEV_CACHE_MODE=record docker-compose -f sites/landhauscheck/docker/docker-compose.local.yml up --build -d

    (Or: DEV_CACHE_MODE=record uvicorn app.main:app --reload  inside sites/landhauscheck/)

2.  Run this script (from the repo root or sites/landhauscheck/):

    python scripts/seed_dev_fixtures.py

3.  Inspect the generated files in sites/landhauscheck/app/data/fixtures/.

4.  Stop the backend, restart with DEV_CACHE_MODE=on to verify replay.

5.  Commit the fixture files to git.

Notes
-----
- The script calls every external-API-backed endpoint once, which is
  enough to populate all fixtures needed for development and testing.
- Re-running is safe: existing fixture files are overwritten with fresh data.
- To BYPASS the cache and force a live call during normal dev use, send the
  header   X-Dev-Cache-Bypass: 1   with any API request.
- Coordinates: 47.7632 N / 8.8376 E (approx. Mägdebergstrasse 5, Singen)
"""

import json
import sys
import time
import urllib.parse
import urllib.request

BASE_URL = "http://localhost:8000"

# Seed coordinates: Mägdebergstrasse 5, Singen (Hohentwiel), DE
# Geocoded from Google Maps — approximately 47.7632 N, 8.8376 E.
# Singen is in Baden-Württemberg, which makes it a valid DE location
# (Tankerkönig, DB stations, DE-specific code paths all exercised).
LAT = 47.7632
LNG = 8.8376

# Endpoints to seed, as (label, path_with_query_string) tuples.
# Order matters: geocode comes first so coordinates are confirmed, then
# all other endpoints in the order the frontend calls them on startup.
ENDPOINTS: list[tuple[str, str]] = [
    # Geocode — address → lat/lng (also warms up the API key path)
    (
        "geocode / Mägdebergstrasse 5 Singen",
        f"/api/v1/geocode?q={urllib.parse.quote('Mägdebergstrasse 5, Singen Hohentwiel')}",
    ),
    # Weather (metric + imperial — frontend auto-selects)
    (
        "weather / metric",
        f"/api/v1/weather/forecast?lat={LAT}&lng={LNG}&units=metric",
    ),
    (
        "weather / imperial",
        f"/api/v1/weather/forecast?lat={LAT}&lng={LNG}&units=imperial",
    ),
    # Fuel (Tankerkönig — DE only)
    (
        "fuel (Tankerkönig DE)",
        f"/api/v1/fuel?lat={LAT}&lng={LNG}&radius=5",
    ),
    # Chargers / stations (four poi_type variants)
    (
        "chargers / EV",
        f"/api/v1/chargers?lat={LAT}&lng={LNG}&radius=5&poi_type=ev",
    ),
    (
        "chargers / gas (non-DE fallback)",
        f"/api/v1/chargers?lat={LAT}&lng={LNG}&radius=5&poi_type=gas",
    ),
    (
        "chargers / toilet",
        f"/api/v1/chargers?lat={LAT}&lng={LNG}&radius=3&poi_type=toilet",
    ),
    (
        "chargers / ATM",
        f"/api/v1/chargers?lat={LAT}&lng={LNG}&radius=2&poi_type=atm",
    ),
    # Transit — bus stops near Singen
    (
        "transit / nearby (bus)",
        f"/api/v1/transit/nearby?lat={LAT}&lng={LNG}&radius=750",
    ),
    # Rail — train stations near Singen (DB snapshot + Google fallback)
    (
        "transit / rail-nearby",
        f"/api/v1/transit/rail-nearby?lat={LAT}&lng={LNG}&radius=20000&lang=de",
    ),
    # POI — restaurants, sights, shopping in Singen
    (
        "transit / poi-nearby (DE)",
        f"/api/v1/transit/poi-nearby?lat={LAT}&lng={LNG}&radius=2000&lang=de",
    ),
    (
        "transit / poi-nearby (EN)",
        f"/api/v1/transit/poi-nearby?lat={LAT}&lng={LNG}&radius=2000&lang=en",
    ),
    # Waste calendar — Singen is not covered by the bundled ICS files so this
    # will return an empty/fallback response, which is still worth recording.
    (
        "waste / upcoming",
        f"/api/v1/waste/upcoming?lat={LAT}&lng={LNG}",
    ),
    # Health (no external API — fast sanity check that the backend is up)
    (
        "health",
        "/health",
    ),
]


def _get(path: str) -> tuple[int, object]:
    """GET ``BASE_URL + path`` and return (status_code, json_body)."""
    url = BASE_URL + path
    req = urllib.request.Request(url, headers={"X-Dev-Cache-Bypass": "0"})
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            body = json.loads(resp.read())
            return resp.status, body
    except urllib.error.HTTPError as exc:
        body = {}
        try:
            body = json.loads(exc.read())
        except Exception:  # noqa: BLE001
            pass
        return exc.code, body
    except Exception as exc:  # noqa: BLE001
        return 0, {"error": str(exc)}


def main() -> int:
    print(f"\nSeeding dev fixtures from {BASE_URL}")
    print(f"Location: Mägdebergstrasse 5, Singen (Hohentwiel)  lat={LAT}  lng={LNG}\n")
    print("-" * 70)

    ok = err = 0
    for label, path in ENDPOINTS:
        status, body = _get(path)
        tag = "✓" if status in (200, 204) else "✗"
        print(f"  {tag}  [{status}]  {label}")
        if status == 0:
            # Connection refused — backend probably not running
            print(f"\n      ERROR: Could not reach {BASE_URL}")
            print("      Make sure the backend is running with DEV_CACHE_MODE=record\n")
            print("      Quick start (from repo root):")
            print("        DEV_CACHE_MODE=record docker-compose "
                  "-f sites/landhauscheck/docker/docker-compose.local.yml up --build -d\n")
            return 1
        elif status == 200:
            ok += 1
        else:
            err += 1
            # Show brief error body so the developer knows what went wrong
            snippet = json.dumps(body)[:120]
            print(f"        body: {snippet}")

        # Small delay to avoid hammering rate-limited upstream APIs
        time.sleep(0.4)

    print("-" * 70)
    print(f"\n  {ok} succeeded  /  {err} failed\n")

    if err:
        print("  Some endpoints failed.  Check that all API keys are configured")
        print("  in your local .env / docker-compose environment and re-run.\n")
        return 1

    print("  All fixtures recorded.  Next steps:")
    print("  1. Review files in sites/landhauscheck/app/data/fixtures/")
    print("  2. Restart backend with DEV_CACHE_MODE=on to verify replay")
    print("  3. Commit the fixture files to git\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
