"""Transit route package.

Combines the four sub-module routers into a single APIRouter so that
``main.py`` can continue to import ``from app.api.routes.transit import router``
without any changes.

Sub-modules
-----------
bus       -- /transit/nearby and /transit/departures (HERE API)
rail      -- /transit/rail-nearby (in-memory DB snapshot + Google Places fallback)
poi       -- /transit/poi-nearby (Google Places)
restrooms -- /transit/restrooms-nearby (OSM Overpass + Google Places)
"""

from fastapi import APIRouter

from .bus import router as _bus_router
from .poi import router as _poi_router
from .rail import router as _rail_router
from .restrooms import router as _restrooms_router

router = APIRouter()
router.include_router(_bus_router)
router.include_router(_rail_router)
router.include_router(_poi_router)
router.include_router(_restrooms_router)
