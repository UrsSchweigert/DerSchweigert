#!/usr/bin/env python3
"""Download all DB railway stations from the StaDa API and write a compact
JSON snapshot to sites/landhauscheck/app/data/db_stations.json.

Usage (local):
    source .env && python scripts/refresh_stations.py

Scheduled via .github/workflows/refresh-stations.yml (first day of each month).

Environment variables required:
    DB_STADA_CLIENT_ID
    DB_STADA_API_KEY
"""

import json
import os
import sys
from pathlib import Path

import httpx

STADA_BASE = (
    "https://apis.deutschebahn.com/db-api-marketplace/apis/station-data/v2/stations"
)
OUT_FILE = Path(__file__).parent.parent / "app/data/db_stations.json"
PAGE_SIZE = 1000


def _extract_coords(station: dict):
    """Return (lat, lng) from the main EVA number, or None if missing."""
    main_coords = None
    for eva in station.get("evaNumbers", []):
        geo = eva.get("geographicCoordinates", {}).get("coordinates")
        if not geo or len(geo) < 2:
            continue
        coords = (float(geo[1]), float(geo[0]))  # GeoJSON is [lng, lat]
        if eva.get("isMain"):
            return coords
        if main_coords is None:
            main_coords = coords
    return main_coords


def fetch_all_stations(client_id: str, api_key: str) -> list[dict]:
    headers = {
        "DB-Client-Id": client_id,
        "DB-Api-Key": api_key,
        "Accept": "application/json",
    }
    stations: list[dict] = []
    offset = 0

    with httpx.Client(timeout=30.0) as client:
        while True:
            params = {"limit": PAGE_SIZE, "offset": offset}
            resp = client.get(STADA_BASE, headers=headers, params=params)
            resp.raise_for_status()
            data = resp.json()
            batch = data.get("result", [])
            print(f"  offset={offset}: got {len(batch)} stations", flush=True)

            for s in batch:
                coords = _extract_coords(s)
                if not coords:
                    continue
                stations.append(
                    {
                        "id": f"stada:{s['number']}",
                        "name": s["name"],
                        "lat": round(coords[0], 6),
                        "lng": round(coords[1], 6),
                        "category": s.get("category", 7),
                    }
                )

            if len(batch) < PAGE_SIZE:
                break
            offset += PAGE_SIZE

    return stations


def main() -> None:
    client_id = os.environ.get("DB_STADA_CLIENT_ID", "")
    api_key = os.environ.get("DB_STADA_API_KEY", "")
    if not client_id or not api_key:
        print(
            "ERROR: DB_STADA_CLIENT_ID and DB_STADA_API_KEY must be set",
            file=sys.stderr,
        )
        sys.exit(1)

    print("Fetching stations from StaDa API …")
    stations = fetch_all_stations(client_id, api_key)
    print(f"Total stations with coordinates: {len(stations)}")

    OUT_FILE.write_text(
        json.dumps(stations, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    print(f"Written → {OUT_FILE}")


if __name__ == "__main__":
    main()
