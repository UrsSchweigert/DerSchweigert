"""The worker runtime: Claude Code CLI billed to the owner's Claude subscription.

Every worker runs `claude -p` inside the Tier A sandbox. It authenticates with a long-lived OAuth token from
`claude setup-token`, so every call draws on the subscription's session and weekly limits rather than on API
credit. The token lives only in `<store>/claude.token` (mode 0600) and travels into the container by
environment-variable name, never as an argument. `ANTHROPIC_API_KEY` is never forwarded (the scrubber drops it and
the sandbox probe checks it is absent): if it were present Claude Code would prefer it and bill the API instead.

When the subscription limit is reached Claude Code stops with a message that names the reset time. `usage_limit`
turns that message into a timestamp, so the scheduler can park the issue until the window resets instead of
burning its transient retry budget on attempts that cannot succeed.
"""
from __future__ import annotations

import datetime as dt
import json
import os
import re
import shlex
import tempfile
from typing import Any, Dict, List, Optional, Tuple

SOURCE = "claude"
TOKEN_FILE = "claude.token"
TOKEN_ENV = "CLAUDE_CODE_OAUTH_TOKEN"

# How long to park work when the limit message names no reset time we can read. A new attempt that hits the limit
# again costs one container start and no subscription usage, so a modest default is safe.
DEFAULT_WAIT_S = 30 * 60
MAX_WAIT_S = 8 * 24 * 3600  # a weekly window plus slack; anything longer is a misparse

LIMIT_TEXT = re.compile(
    r"usage limit reached|(?:5-hour|five-hour|session|weekly|opus|sonnet)\s+limit reached|"
    r"you(?:'|’)ve (?:hit|reached) your (?:usage |session |weekly )?limit|out of extra usage",
    re.I)
EPOCH_FORM = re.compile(r"usage limit reached\|(\d{9,11})", re.I)
RESETS_FORM = re.compile(
    r"resets?\s+(?:at\s+|on\s+)?(?:(mon|tue|wed|thu|fri|sat|sun)[a-z]*\s+)?"
    r"(?:(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(\d{1,2}),?\s+(?:at\s+)?)?"
    r"(\d{1,2})(?::(\d{2}))?\s*(am|pm)?(?:\s*\(([A-Za-z_]+/[A-Za-z_/+-]+|UTC)\))?",
    re.I)
CREDENTIAL_TEXT = re.compile(r"invalid api key|please run /login|oauth token (?:has )?(?:expired|revoked|is invalid)|"
                             r"authentication_error|not logged in", re.I)
DAYS = ("mon", "tue", "wed", "thu", "fri", "sat", "sun")
MONTHS = ("jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec")


# -- the token ------------------------------------------------------------------

def token_path(home: str) -> str:
    return os.path.join(home, TOKEN_FILE)


def has_token(home: Optional[str]) -> bool:
    return bool(home) and bool(_read(token_path(home)))


def _read(path: str) -> str:
    try:
        with open(path, encoding="utf-8") as fh:
            return fh.read().strip()
    except OSError:
        return ""


def save_token(home: str, token: str) -> None:
    """Write the token atomically with mode 0600, like the other store secrets."""
    token = (token or "").strip()
    if not token:
        raise ValueError("the token is empty")
    if any(c.isspace() for c in token):
        raise ValueError("the token contains whitespace; paste only the value `claude setup-token` printed")
    if token.startswith("sk-ant-api"):
        raise ValueError("that is an API key, which bills API credit; run `claude setup-token` for a subscription token")
    os.makedirs(home, mode=0o700, exist_ok=True)
    handle, tmp = tempfile.mkstemp(dir=home, prefix="claude-", suffix=".token")
    try:
        with os.fdopen(handle, "w", encoding="utf-8") as fh:
            fh.write(token + "\n")
        os.chmod(tmp, 0o600)
        os.replace(tmp, token_path(home))
    except BaseException:
        if os.path.exists(tmp):
            os.remove(tmp)
        raise


def remove_token(home: str) -> bool:
    try:
        os.remove(token_path(home))
        return True
    except FileNotFoundError:
        return False


def redacted(home: Optional[str]) -> str:
    token = _read(token_path(home)) if home else ""
    return ("*" * 8 + token[-4:]) if len(token) > 8 else ("present" if token else "")


def env_for(home: Optional[str]) -> Optional[Dict[str, str]]:
    """The credential environment for a Claude Code worker, or None when no token is stored."""
    token = _read(token_path(home)) if home else ""
    return {TOKEN_ENV: token} if token else None


# -- the command ----------------------------------------------------------------

def work_command(model_id: Optional[str]) -> str:
    """The shell line that runs one worker session. Permission prompts are skipped: the sandbox is the boundary."""
    model = " --model %s" % shlex.quote(model_id) if model_id else ""
    return ('claude -p "$(cat /work/prompt.txt)"%s --dangerously-skip-permissions '
            "--output-format stream-json --verbose" % model)


def probe_command(model_id: str) -> List[str]:
    return ["claude", "-p", "reply OK", "--model", model_id, "--output-format", "json"]


# -- the output -----------------------------------------------------------------

def render(line: str) -> Tuple[Optional[str], Optional[Dict[str, Any]]]:
    """One stream-json line as (a short readable line or None, the final result event or None).

    Non-JSON lines pass through unchanged, so a CLI error printed as plain text still reaches the failure classifier.
    """
    text = line.strip()
    if not text.startswith("{"):
        return (text or None), None
    try:
        event = json.loads(text)
    except ValueError:
        return text[:300], None
    if not isinstance(event, dict):
        return None, None
    kind = event.get("type")
    if kind == "result":
        summary = str(event.get("result") or event.get("subtype") or "")
        return ("result: %s" % summary.strip().splitlines()[0][:240] if summary.strip() else "result"), event
    if kind == "assistant":
        parts = []
        for block in (event.get("message") or {}).get("content") or []:
            if not isinstance(block, dict):
                continue
            if block.get("type") == "tool_use":
                args = block.get("input") or {}
                hint = args.get("command") or args.get("file_path") or args.get("pattern") or args.get("description") or ""
                parts.append("● %s %s" % (block.get("name", "tool"), str(hint).replace("\n", " ")[:120]))
            elif block.get("type") == "text" and str(block.get("text", "")).strip():
                parts.append(str(block["text"]).strip().splitlines()[0][:200])
        return (" | ".join(parts) if parts else None), None
    if kind == "system" and event.get("subtype") == "init":
        return "session started (model %s)" % event.get("model", "?"), None
    if kind in ("rate_limit_event", "error"):
        return json.dumps(event)[:300], None
    return None, None


def result_failed(event: Optional[Dict[str, Any]]) -> bool:
    return bool(event) and (bool(event.get("is_error")) or str(event.get("subtype", "")).startswith("error"))


def measured_usage(event: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    """The token counts Claude Code itself reported for the session. Cache reads count as input: they use the limit too."""
    if not event or not isinstance(event.get("usage"), dict):
        return None
    u = event["usage"]

    def n(key: str) -> int:
        value = u.get(key)
        return value if type(value) is int and value >= 0 else 0

    out: Dict[str, Any] = {
        "input_tokens": n("input_tokens") + n("cache_creation_input_tokens") + n("cache_read_input_tokens"),
        "output_tokens": n("output_tokens"),
        "basis": "reported by Claude Code (subscription usage)",
    }
    cost = event.get("total_cost_usd")
    if isinstance(cost, (int, float)) and cost >= 0:
        out["api_equivalent_usd"] = round(float(cost), 4)  # what the same tokens would cost on the API; not billed
    return out


def usage_limit(texts: List[str], now: float, tz: Optional[dt.tzinfo] = None) -> Optional[float]:
    """When the subscription limit stopped the worker, the time it resets (never in the past); otherwise None."""
    joined = "\n".join(t for t in texts if t)
    if not LIMIT_TEXT.search(joined):
        return None
    epoch = EPOCH_FORM.search(joined)
    if epoch:
        return _clamp(float(epoch.group(1)), now)
    match = RESETS_FORM.search(joined)
    if not match:
        return now + DEFAULT_WAIT_S
    return _clamp(_next_reset(match, now, tz), now)


def _clamp(at: float, now: float) -> float:
    if at - now > MAX_WAIT_S:
        return now + DEFAULT_WAIT_S  # a misparse; check back soon rather than parking work for weeks
    if at <= now:
        return now + 60
    return at + 60  # a minute of slack so the first attempt after the reset does not race it


def _zone(name: Optional[str], fallback: Optional[dt.tzinfo]) -> Optional[dt.tzinfo]:
    if name:
        if name.upper() == "UTC":
            return dt.timezone.utc
        try:
            from zoneinfo import ZoneInfo
            return ZoneInfo(name)
        except Exception:  # noqa: BLE001 - an unknown zone falls back to local time
            pass
    return fallback


def _next_reset(match: "re.Match[str]", now: float, tz: Optional[dt.tzinfo]) -> float:
    day, month, mday, hour, minute, ampm, zone = match.groups()
    zone_info = _zone(zone, tz)
    current = dt.datetime.fromtimestamp(now, zone_info) if zone_info else dt.datetime.fromtimestamp(now)
    h = int(hour) % 24
    if ampm:
        h = (h % 12) + (12 if ampm.lower() == "pm" else 0)
    m = int(minute or 0)
    if h > 23 or m > 59:
        return now + DEFAULT_WAIT_S
    if month and mday:
        try:
            target = current.replace(month=MONTHS.index(month.lower()[:3]) + 1, day=int(mday), hour=h, minute=m, second=0, microsecond=0)
        except ValueError:
            return now + DEFAULT_WAIT_S
        if target.timestamp() <= now:
            target = target.replace(year=target.year + 1)
        return target.timestamp()
    target = current.replace(hour=h, minute=m, second=0, microsecond=0)
    if day:
        ahead = (DAYS.index(day.lower()[:3]) - current.weekday()) % 7
        target += dt.timedelta(days=ahead)
        if target.timestamp() <= now:
            target += dt.timedelta(days=7)
    elif target.timestamp() <= now:
        target += dt.timedelta(days=1)
    return target.timestamp()
