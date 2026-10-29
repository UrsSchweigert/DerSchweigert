"""Waste-collection notification manifest endpoint.

Returns a single JSON document listing every ICS calendar location that has
waste-collection events scheduled for *tomorrow*.  Client service workers
download this manifest at their locally scheduled notification times (17:00
and 20:00) and decide entirely client-side whether to show a browser
notification, based on the user's stored GPS coordinates.

Design rationale — Lambda invocation reduction
──────────────────────────────────────────────
  Traditional push notifications require one server-side Lambda invocation
  per subscriber per notification time (N_users × 2 per day).

  This manifest approach instead:
    • Emits a single shared JSON document, cached by CloudFront for one hour.
    • All clients share the same cached response — at most one Lambda
      invocation fires per hour (on a cache miss), regardless of user count.
    • Scheduling (setTimeout at 17:00 / 20:00 local time) runs in the browser.
    • No per-user push subscriptions are stored on the server.
    • No VAPID keys or Web-Push library are required.

  Effective cost: O(1) Lambda invocations per hour vs O(N) per notification.
"""

import os
from datetime import date, timedelta

from fastapi import APIRouter
from fastapi.responses import JSONResponse

router = APIRouter()

_WASTE_DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "data", "waste")


@router.get("/notifications/manifest")
async def notifications_manifest():
    """Return tomorrow's waste-collection entries grouped by calendar location.

    Response shape::

        {
            "tomorrow_date": "YYYY-MM-DD",
            "locations": [
                {
                    "name": "Musterstadt",
                    "lat": 48.123,
                    "lng": 11.456,
                    "summaries": ["Restmüll", "Biotonne"]
                },
                ...
            ]
        }

    Each entry covers one ICS file.  Clients run a local haversine check to
    find the entry closest to their stored coordinates and only show a
    notification when the distance is within the match radius (~3 km).

    Cache-Control is set to 1 hour so CloudFront serves the response from
    cache without invoking Lambda for every client.  The manifest becomes
    stale at most 1 h early on the day boundary, which is acceptable.
    """
    data_dir = os.path.normpath(_WASTE_DATA_DIR)
    tomorrow = date.today() + timedelta(days=1)
    locations: list[dict] = []

    if os.path.isdir(data_dir):
        # Lazy import avoids a load-time circular dependency with waste.py.
        from app.api.routes.waste import _parse_ics  # noqa: PLC0415

        for filename in sorted(f for f in os.listdir(data_dir) if f.endswith(".ics")):
            filepath = os.path.join(data_dir, filename)
            try:
                data = _parse_ics(filepath)
            except Exception:  # noqa: BLE001 — skip unreadable files silently
                continue

            if data["lat"] is None or data["lng"] is None:
                continue

            summaries = [
                ev["summary"]
                for ev in data["events"]
                if ev["date"] == tomorrow
            ]
            if not summaries:
                continue

            locations.append(
                {
                    "name": data["name"] or filename.rsplit(".", 1)[0],
                    "lat": data["lat"],
                    "lng": data["lng"],
                    "summaries": summaries,
                }
            )

    return JSONResponse(
        content={
            "tomorrow_date": tomorrow.isoformat(),
            "locations": locations,
        },
        headers={"Cache-Control": "public, max-age=3600"},
    )
