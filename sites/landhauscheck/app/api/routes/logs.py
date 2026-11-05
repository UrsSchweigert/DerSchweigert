"""CloudWatch logs endpoint.

Returns the most recent log entries from the ECS backend log group so the
frontend console overlay can display live server-side logs.  The endpoint
degrades gracefully when no AWS credentials are available (local dev).
"""

from __future__ import annotations

import time
from typing import Any

from fastapi import APIRouter, Header, Query

from app.api.routes.stats import _check_pin
from app.core.config import get_settings

router = APIRouter(tags=["logs"])


def _fetch_cloudwatch_logs(minutes: int) -> list[dict[str, Any]]:
    """Pull the last *minutes* of log events from CloudWatch.

    Returns an empty list when boto3 is unavailable or credentials are absent
    so local development is unaffected.
    """
    try:
        import boto3  # type: ignore[import-untyped]  # noqa: PLC0415
        from botocore.exceptions import (  # type: ignore[import-untyped]  # noqa: PLC0415
            BotoCoreError,
            ClientError,
        )
    except ImportError:
        return []

    settings = get_settings()
    start_ms = int((time.time() - minutes * 60) * 1000)

    try:
        client = boto3.client("logs", region_name=settings.aws_region)
        paginator = client.get_paginator("filter_log_events")
        page_iter = paginator.paginate(
            logGroupName=settings.cloudwatch_log_group,
            startTime=start_ms,
            PaginationConfig={"MaxItems": 200},
        )

        events: list[dict[str, Any]] = []
        for page in page_iter:
            for e in page.get("events", []):
                # Convert epoch-ms → ISO-ish HH:MM:SS for the overlay display
                ts_s = e["timestamp"] / 1000
                from datetime import UTC, datetime  # noqa: PLC0415
                dt = datetime.fromtimestamp(ts_s, tz=UTC)
                events.append({
                    "ts": dt.strftime("%H:%M:%S"),
                    "message": e["message"].rstrip("\n"),
                    "stream": e.get("logStreamName", ""),
                    "source": "cloudwatch",
                })

        # Newest first to match the frontend's reversed display
        events.sort(key=lambda x: x["ts"], reverse=True)
        return events

    except (BotoCoreError, ClientError):
        return []


@router.get("/api/v1/logs")
def get_logs(
    minutes: int = Query(default=10, ge=1, le=60),
    x_stats_pin: str | None = Header(default=None),
) -> list[dict[str, Any]]:
    """Return recent CloudWatch log entries for the console overlay.

    PIN-protected like the stats endpoints: the log group carries stack traces
    and upstream error text, so it must not be readable by anonymous visitors.
    """
    _check_pin(x_stats_pin)
    return _fetch_cloudwatch_logs(minutes)
