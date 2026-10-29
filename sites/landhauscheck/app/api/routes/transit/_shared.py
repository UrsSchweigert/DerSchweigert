"""Shared constants and utilities used across all transit sub-modules.

Kept in a private module (prefix ``_``) to signal that these are
implementation details and should not be imported from outside the
``transit`` package.
"""

import math

# ---------------------------------------------------------------------------
# HERE API endpoints
# ---------------------------------------------------------------------------
HERE_TRANSIT_STATIONS = "https://transit.router.hereapi.com/v8/stations"
HERE_TRANSIT_DEPARTURES = "https://transit.router.hereapi.com/v8/departures"
HERE_ROUTER_URL = "https://router.hereapi.com/v8/routes"

# ---------------------------------------------------------------------------
# Google Places API endpoint
# ---------------------------------------------------------------------------
GOOGLE_PLACES_NEARBY = "https://places.googleapis.com/v1/places:searchNearby"

# ---------------------------------------------------------------------------
# OSM Overpass mirrors — queried in parallel, first non-empty result wins
# ---------------------------------------------------------------------------
OVERPASS_MIRRORS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.openstreetmap.ru/api/interpreter",
]

# OSM railway values that correspond to rail/metro/tram services
RAIL_RAILWAY_VALUES = {
    "rail", "subway", "tram", "light_rail", "monorail", "narrow_gauge", "funicular"
}


def _haversine(lat1: float, lng1: float, lat2: float, lng2: float) -> int:
    """Return the great-circle distance between two coordinates in metres."""
    R = 6_371_000
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lng2 - lng1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    return round(R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a)))
