"""Health endpoint definitions.

These endpoints are intentionally simple in Step 1 and provide a stable
integration point for the frontend, local orchestration, and smoke checks.
"""

from datetime import UTC, datetime

from fastapi import APIRouter

router = APIRouter(tags=["health"])


@router.get("/health")
def read_health() -> dict[str, str]:
    """Return service liveness information for local and platform checks."""

    return {
        "status": "ok",
        "service": "backend",
        "timestamp": datetime.now(UTC).isoformat(),
    }
