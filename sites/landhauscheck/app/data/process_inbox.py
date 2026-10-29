#!/usr/bin/env python3
"""process_inbox.py — Transform raw AWIDO ICS exports into backend-ready files.

Usage:
    python sites/landhauscheck/app/data/process_inbox.py
    make process-waste

Drop any AWIDO-exported .ics file into   sites/landhauscheck/app/data/inbox/
The script will:
  1. Detect the location name from the file content.
  2. Look up coordinates in locations.json (add new locations there as needed).
  3. Inject X-WR-GEO-LAT, X-WR-GEO-LNG, X-WR-LOCATION-NAME into the file.
  4. Write the processed file to   sites/landhauscheck/app/data/waste/
  5. Remove the processed file from the inbox.

If the location is not found in locations.json the file is skipped and
a clear error message is printed.
"""

from __future__ import annotations

import json
import os
import re
import sys

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
INBOX_DIR  = os.path.join(SCRIPT_DIR, "inbox")
WASTE_DIR  = os.path.join(SCRIPT_DIR, "waste")
LOC_FILE   = os.path.join(SCRIPT_DIR, "locations.json")

GEO_ANCHOR = "CALSCALE:GREGORIAN"   # inject our headers right after this line


def load_locations() -> dict:
    with open(LOC_FILE, encoding="utf-8") as f:
        return json.load(f)


def detect_location(content: str) -> str | None:
    """Try to extract the location name from ICS content.

    Checks (in order):
    1. LOCATION: property on any VEVENT (e.g. ``LOCATION:Pfaffenhofen``)
    2. ' in X' suffix in SUMMARY lines (e.g. ``SUMMARY:Gelbe Tonne in Pfaffenhofen``)
    """
    # 1. LOCATION: field
    for line in content.splitlines():
        if line.strip().upper().startswith("LOCATION:"):
            loc = line.split(":", 1)[-1].strip()
            # Strip ICS-escaped semicolons (\;) and street detail after them
            loc = loc.split("\\;")[0].strip()
            if loc:
                return loc

    # 2. SUMMARY: … in {Location}
    for line in content.splitlines():
        if line.strip().upper().startswith("SUMMARY:"):
            summary = line.split(":", 1)[-1].strip()
            match = re.search(r"\bin\s+(.+)$", summary, re.IGNORECASE)
            if match:
                return match.group(1).strip()

    return None


def inject_geo_headers(content: str, name: str, lat: float, lng: float) -> str:
    """Insert X-WR-* headers after CALSCALE:GREGORIAN if not already present."""
    if "X-WR-GEO-LAT:" in content:
        # Already processed — update values in case they changed
        content = re.sub(r"X-WR-GEO-LAT:[^\r\n]*", f"X-WR-GEO-LAT:{lat}", content)
        content = re.sub(r"X-WR-GEO-LNG:[^\r\n]*", f"X-WR-GEO-LNG:{lng}", content)
        content = re.sub(r"X-WR-LOCATION-NAME:[^\r\n]*", f"X-WR-LOCATION-NAME:{name}", content)
        return content

    injection = (
        f"\nX-WR-LOCATION-NAME:{name}"
        f"\nX-WR-GEO-LAT:{lat}"
        f"\nX-WR-GEO-LNG:{lng}"
    )
    # Insert after the first occurrence of CALSCALE:GREGORIAN
    return content.replace(GEO_ANCHOR, GEO_ANCHOR + injection, 1)


def process_file(filepath: str, locations: dict) -> bool:
    filename = os.path.basename(filepath)
    with open(filepath, encoding="utf-8") as f:
        content = f.read()

    location_name = detect_location(content)
    if not location_name:
        print(f"  [SKIP] {filename}: could not detect location name from content.")
        return False

    # Case-insensitive lookup — also checks optional 'aliases' list per entry
    coords = None
    matched_key = None
    location_lower = location_name.lower()
    for key, val in locations.items():
        names_to_check = [key] + val.get("aliases", [])
        if any(n.lower() == location_lower for n in names_to_check):
            coords = val
            matched_key = key
            break

    if coords is None:
        print(
            f"  [SKIP] {filename}: location '{location_name}' not found in locations.json.\n"
            f"         Add it:  \"{location_name}\": {{ \"lat\": ..., \"lng\": ... }}"
        )
        return False

    enriched = inject_geo_headers(content, matched_key, coords["lat"], coords["lng"])

    out_path = os.path.join(WASTE_DIR, filename)
    with open(out_path, "w", encoding="utf-8") as f:
        f.write(enriched)

    lat, lng = coords['lat'], coords['lng']
    print(f"  [OK]   {filename}  →  waste/{filename}  ({matched_key} {lat},{lng})")
    os.remove(filepath)
    return True


def main():
    os.makedirs(WASTE_DIR, exist_ok=True)

    if not os.path.isfile(LOC_FILE):
        print(f"ERROR: locations.json not found at {LOC_FILE}")
        sys.exit(1)

    locations = load_locations()

    ics_files = [
        os.path.join(INBOX_DIR, f)
        for f in os.listdir(INBOX_DIR)
        if f.endswith(".ics")
    ]

    if not ics_files:
        print("Inbox is empty — nothing to process.")
        return

    print(f"Processing {len(ics_files)} file(s) from inbox …")
    ok = skipped = 0
    for fp in sorted(ics_files):
        if process_file(fp, locations):
            ok += 1
        else:
            skipped += 1

    print(f"\nDone: {ok} processed, {skipped} skipped.")
    if skipped:
        print("Add missing locations to sites/landhauscheck/app/data/locations.json and re-run.")


if __name__ == "__main__":
    main()
