"""Structured, sanitized diagnostic events with bounded retention. No transcripts, no secrets, no invented metrics."""
from __future__ import annotations

import json
import re
import time
from typing import Any, Dict, List, Optional

from .store import Store

RETENTION_DAYS = 14
MAX_STRING = 300
MAX_KEYS = 20
SECRET = re.compile(r"(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----|Bearer\s+[A-Za-z0-9._-]{20,})")
BLOCKED_KEYS = re.compile(r"(transcript|prompt|raw|body|token|secret|password|credential|diff)", re.I)

UNAVAILABLE = "unavailable"


def sanitize(value: Any, depth: int = 0) -> Any:
    """Keep scalars and shallow structures. Redact credential-looking text and drop keys that suggest raw content."""
    if isinstance(value, str):
        return SECRET.sub("[redacted]", value)[:MAX_STRING]
    if isinstance(value, (int, float, bool)) or value is None:
        return value
    if depth >= 2:
        return "[truncated]"
    if isinstance(value, dict):
        return {str(k)[:60]: sanitize(v, depth + 1) for k, v in list(value.items())[:MAX_KEYS] if not BLOCKED_KEYS.search(str(k))}
    if isinstance(value, (list, tuple)):
        return [sanitize(v, depth + 1) for v in list(value)[:MAX_KEYS]]
    return str(value)[:MAX_STRING]


def emit(store: Store, event_type: str, *, plan_id: str = "", phase_id: str = "", issue_id: str = "", attempt_id: str = "",
         run_id: str = "", data: Optional[Dict[str, Any]] = None, now: Optional[float] = None) -> None:
    store.cx.execute(
        "INSERT INTO events(ts, type, plan_id, phase_id, issue_id, attempt_id, run_id, data) VALUES(?,?,?,?,?,?,?,?)",
        (now if now is not None else time.time(), event_type[:60], plan_id, phase_id, issue_id, attempt_id, run_id,
         json.dumps(sanitize(data or {}), sort_keys=True)))


def prune(store: Store, now: Optional[float] = None, days: int = RETENTION_DAYS) -> int:
    cutoff = (now if now is not None else time.time()) - days * 86400
    return store.cx.execute("DELETE FROM events WHERE ts < ?", (cutoff,)).rowcount


def recent(store: Store, limit: int = 20, issue_id: Optional[str] = None) -> List[Dict[str, Any]]:
    q, args = "SELECT * FROM events", []
    if issue_id:
        q, args = q + " WHERE issue_id=?", [issue_id]
    rows = store.cx.execute(q + " ORDER BY id DESC LIMIT ?", args + [limit]).fetchall()
    return [dict(r, data=json.loads(r["data"])) for r in reversed(rows)]


def count(store: Store) -> int:
    return store.cx.execute("SELECT COUNT(*) AS n FROM events").fetchone()["n"]


def metrics_report(usage_available: bool = False) -> Dict[str, Any]:
    """Metrics that the runtime does not supply are labeled unavailable and never estimated."""
    label = {"value": None, "status": UNAVAILABLE}
    return {"tokens": dict(label, reason="the runtime reports no usage to the harness"),
            "cost": dict(label, reason="the runtime reports no cost to the harness"),
            "generation_credits": dict(label, reason="no generation provider is configured")}
