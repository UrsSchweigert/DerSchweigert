"""Shared pytest configuration.

Environment variables are set at module level so that Pydantic Settings picks
them up when app.main is imported by the individual test modules.
"""

import os

# Provide dummy API keys so route handlers don't return 503 in tests.
# The actual external HTTP calls are intercepted by respx.mock in each test.
os.environ.setdefault("HERE_API_KEY", "test-here-key")
os.environ.setdefault("GOOGLE_MAPS_API_KEY", "test-google-key")
os.environ.setdefault("DB_STADA_API_KEY", "test-stada-key")
