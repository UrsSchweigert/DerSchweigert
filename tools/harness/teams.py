"""Reports to the owner's private Microsoft Teams chat: tasks at once, activity in digests, status on a timer.

Delivery is a Teams **Workflows webhook** (the Power Automate trigger "When a Teams webhook request is received",
followed by "Post card in a chat or channel" to you). The harness posts an Adaptive Card to that URL, so no app
registration, no Graph permission and no token refresh are needed. The Microsoft 365 connector that Claude has is not
used: it carries no Teams permission, and it exists only inside a Claude session, while the harness is its own process.

What is sent:

* **Tasks and decisions**, immediately, with the exact command to answer them (the harness's notifier hands them in).
* **Alerts**, immediately and rate-limited: a blocked issue, a subscription limit wait, a stopped or paused run, a phase
  finished, an environment failure.
* **Activity**, as one digest every few minutes, and only when something happened.
* **Status**, as one card on a timer and at start: phases, issue counts, who is working, open tasks, art credits.

The URL is a secret (anyone holding it can post to your chat), so it lives in `<store>/teams.webhook` with mode 0600 and
is never printed. Posting happens on a background thread with a timeout, so Teams being slow or down can never stall the
run; a failed post is dropped and counted, never retried forever.
"""
from __future__ import annotations

import json
import os
import queue
import re
import tempfile
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import deque
from typing import Any, Callable, Dict, List, Optional, Tuple

from .humantasks import Notifier
from .telemetry import SECRET

FILE = "teams.webhook"
HOST_SUFFIXES = (".logic.azure.com", ".powerplatform.com", ".webhook.office.com", ".outlook.office.com")
ACTIVITY_MINUTES, STATUS_MINUTES = 15, 60
MAX_IMMEDIATE_PER_HOUR = 12
MAX_DIGEST_LINES = 25
POST_TIMEOUT_S = 15
PACE_S = 1.0  # Teams rate-limits webhooks; one card a second is well inside it
MAX_CARD_BYTES = 24_000  # the limit is 28 KB

COLORS = {"info": "Accent", "good": "Good", "warn": "Warning", "alert": "Attention"}


# -- the webhook URL --------------------------------------------------------------------------------

def path(home: str) -> str:
    return os.path.join(home, FILE)


def url_problem(url: str) -> Optional[str]:
    """Why a URL is refused. A Workflows URL is https on a Microsoft host; anything else is probably a paste mistake."""
    try:
        parts = urllib.parse.urlsplit(url.strip())
    except ValueError:
        return "that is not a URL"
    if parts.scheme != "https" or not parts.hostname:
        return "the webhook URL must start with https://"
    if parts.username or parts.password:
        return "the webhook URL must not contain credentials"
    if parts.port not in (None, 443):
        return "the webhook URL must use port 443"
    if not any(parts.hostname == s[1:] or parts.hostname.endswith(s) for s in HOST_SUFFIXES):
        return "the host %s is not a Microsoft Workflows address (expected one ending in %s)" % (parts.hostname, ", ".join(HOST_SUFFIXES))
    return None


def load_url(home: Optional[str]) -> Optional[str]:
    if not home:
        return None
    try:
        with open(path(home), encoding="utf-8") as fh:
            url = fh.read().strip()
    except OSError:
        return None
    return url if url and not url_problem(url) else None


def save_url(home: str, url: str) -> None:
    url = (url or "").strip()
    problem = url_problem(url)
    if problem:
        raise ValueError(problem)
    os.makedirs(home, mode=0o700, exist_ok=True)
    handle, tmp = tempfile.mkstemp(dir=home, prefix="teams-", suffix=".tmp")
    try:
        with os.fdopen(handle, "w", encoding="utf-8") as fh:
            fh.write(url + "\n")
        os.chmod(tmp, 0o600)
        os.replace(tmp, path(home))
    except BaseException:
        if os.path.exists(tmp):
            os.remove(tmp)
        raise


def remove_url(home: str) -> bool:
    try:
        os.remove(path(home))
        return True
    except FileNotFoundError:
        return False


def redacted(url: Optional[str]) -> str:
    if not url:
        return ""
    parts = urllib.parse.urlsplit(url)
    return "%s/...%s" % (parts.hostname, url[-4:])


# -- cards ------------------------------------------------------------------------------------------------

def clean(text: Any, limit: int = 600) -> str:
    text = SECRET.sub("[redacted]", str(text or "")).replace("\r", "").strip()
    return text if len(text) <= limit else text[:limit - 1].rstrip() + "…"


def card(title: str, level: str = "info", lines: Optional[List[str]] = None, facts: Optional[List[Tuple[str, str]]] = None,
         code: Optional[str] = None, footer: Optional[str] = None) -> Dict[str, Any]:
    """One Adaptive Card. `level` picks the title colour: info, good, warn or alert."""
    body: List[Dict[str, Any]] = [{"type": "TextBlock", "text": clean(title, 140), "weight": "Bolder", "size": "Medium",
                                   "wrap": True, "color": COLORS.get(level, "Accent")}]
    if lines:
        body.append({"type": "TextBlock", "text": "\n\n".join(clean(l, 700) for l in lines), "wrap": True})
    if facts:
        body.append({"type": "FactSet", "facts": [{"title": clean(k, 40), "value": clean(v, 300)} for k, v in facts]})
    if code:
        body.append({"type": "TextBlock", "text": clean(code, 900), "wrap": True, "fontType": "Monospace", "spacing": "Medium"})
    if footer:
        body.append({"type": "TextBlock", "text": clean(footer, 200), "wrap": True, "isSubtle": True, "size": "Small", "spacing": "Medium"})
    return {"$schema": "http://adaptivecards.io/schemas/adaptive-card.json", "type": "AdaptiveCard", "version": "1.4",
            "msteams": {"width": "Full"}, "body": body}


def envelope(content: Dict[str, Any]) -> bytes:
    return json.dumps({"type": "message", "attachments": [{"contentType": "application/vnd.microsoft.card.adaptive",
                                                          "contentUrl": None, "content": content}]}).encode("utf-8")


class Poster:
    """Posts cards to the webhook. Retries a rate limit or a server error twice, then drops the card."""

    def __init__(self, url: str, opener: Callable = urllib.request.urlopen, sleep: Callable[[float], None] = time.sleep):
        self.url, self.opener, self.sleep = url, opener, sleep
        self.sent = self.failed = 0
        self.last_error = ""

    def post(self, content: Dict[str, Any]) -> bool:
        body = envelope(content)
        if len(body) > MAX_CARD_BYTES:
            self.failed += 1
            self.last_error = "the card is larger than Teams accepts"
            return False
        for attempt in range(3):
            retry_after = None
            request = urllib.request.Request(self.url, data=body, method="POST", headers={"Content-Type": "application/json"})
            try:
                with self.opener(request, timeout=POST_TIMEOUT_S) as response:
                    status = response.status
            except urllib.error.HTTPError as exc:
                status, retry_after = exc.code, exc.headers.get("Retry-After") if exc.headers else None
            except (urllib.error.URLError, OSError, ValueError) as exc:
                status = 0
                self.last_error = type(exc).__name__  # never the message: it can contain the URL
            if 200 <= status < 300:
                self.sent += 1
                return True
            if status:
                self.last_error = "HTTP %d" % status
            if status in (0, 429, 500, 502, 503, 504) and attempt < 2:
                try:
                    wait = float(retry_after) if retry_after else 2.0 * (attempt + 1)
                except ValueError:
                    wait = 2.0
                self.sleep(min(wait, 20.0))
                continue
            break
        self.failed += 1
        return False


# -- what is worth saying -----------------------------------------------------------------------------------

IMMEDIATE = {"decision_task", "promotion_task", "usage_limit_wait", "environment_failure", "paused", "phase_done", "plan_completed",
             "phase_stalled", "merge_refused", "merge_failed", "tick_error", "stopped", "interrupted", "refiner_needs_input",
             "plan_prerequisite"}
DIGEST = {"dispatched", "refined", "in_review", "pr_opened", "review", "merged", "done", "attempt_failed", "overseer_decision",
          "analysis_ready", "split_applied", "cancelled", "model_escalated", "delegator_retry", "delegator_escalated"}


def short_model(model: Any) -> str:
    name = str(model or "")
    for family in ("haiku", "sonnet", "opus", "fable"):
        if family in name:
            return family
    return name


def is_alert(event: Dict[str, Any]) -> bool:
    name = event.get("event")
    if name == "attempt_failed":
        return event.get("action") in ("block", "pause")
    return name in IMMEDIATE


def describe(event: Dict[str, Any]) -> Tuple[str, str]:
    """(level, one line) for an event, for alerts and for the activity digest."""
    name, issue = event.get("event", ""), event.get("issue") or ""
    if name == "dispatched":
        return "info", "▶ %s started on %s (%s)" % (event.get("role", "worker"), issue, short_model(event.get("model")))
    if name == "refined":
        return "info", "✎ %s refined" % issue
    if name == "pr_opened":
        return "info", "⇡ PR #%s opened for %s" % (event.get("pr", "?"), issue)
    if name == "in_review":
        return "info", "👁 %s is in review" % issue
    if name == "review":
        return "info", "✔ review finished for %s" % issue
    if name == "merged":
        return "good", "⇣ PR #%s merged (%s)" % (event.get("pr", "?"), issue)
    if name == "done":
        return "good", "✅ %s is Done" % issue
    if name == "attempt_failed":
        action = event.get("action", "")
        return ("alert" if action in ("block", "pause") else "warn"), "✗ %s attempt failed: %s → %s" % (issue, event.get("kind", "?"), action or "retry")
    if name == "overseer_decision":
        return "info", "🧭 overseer on %s: %s (%s)" % (issue, event.get("action", "?"), event.get("cause", "?"))
    if name == "usage_limit_wait":
        return "warn", "⏳ Claude subscription limit reached; work resumes after %s" % time.strftime("%H:%M", time.localtime(event.get("resume_at", 0)))
    if name == "phase_done":
        return "good", "🏁 phase %s is done" % (event.get("phase") or "")
    if name == "plan_completed":
        return "good", "🎉 the plan is complete"
    if name == "decision_task":
        return "alert", "❗ decision needed for %s" % issue
    if name in ("paused", "stopped", "interrupted"):
        return "alert", "⏸ run %s%s" % (name, ": " + clean(event.get("reason") or event.get("plan_state") or "", 120) if event.get("reason") or event.get("plan_state") else "")
    if name in ("environment_failure", "tick_error", "merge_failed", "merge_refused", "phase_stalled", "refiner_needs_input", "plan_prerequisite"):
        return "alert", "⚠ %s %s %s" % (name.replace("_", " "), issue, clean(event.get("error") or event.get("detail") or event.get("reason") or "", 200))
    return "info", "%s %s" % (name.replace("_", " "), issue)


def answer_hint(task: Dict[str, Any]) -> str:
    """The command that answers a task, so the owner can act from the message."""
    payload, tid = task["payload"], task["task_id"]
    kind = payload.get("kind")
    if kind == "decision":
        options = payload.get("options") or []
        lines = ["%d  %s" % (n, clean(label, 60)) for n, label in enumerate(options, 1)]
        return "\n".join(lines + ["", "harness respond %s --option N" % tid, "(option 2 also takes --guidance \"...\")"])
    if kind == "manual_test":
        path = (payload.get("extra") or {}).get("asset_abspath")
        return "\n".join(([("open: %s" % path)] if path else []) + ["harness respond %s --outcome pass|fail|inconclusive" % tid])
    if kind == "asset":
        return "harness respond %s --answer source=self-made --answer license=CC0-1.0 --answer author=Me --artifact FILE" % tid
    return "harness tasks    # then: harness respond %s ..." % tid


# -- the reporter: decides what to send and when, no threads and no network ----------------------------------

class Reporter:
    def __init__(self, plan_id: str, collect: Callable[[float], Dict[str, Any]], now: float, activity_s: float = ACTIVITY_MINUTES * 60,
                 status_s: float = STATUS_MINUTES * 60):
        self.plan_id, self.collect = plan_id, collect
        self.activity_s, self.status_s = activity_s, status_s
        self.next_activity, self.next_status = now + activity_s, now + status_s
        self.pending: List[Tuple[str, str]] = []
        self.out: List[Dict[str, Any]] = []
        self._alerts: deque = deque()
        self._seen: Dict[Tuple[Any, ...], float] = {}
        self.folded = 0

    # events ---------------------------------------------------------------------------------------------
    def on_event(self, event: Dict[str, Any], now: float) -> None:
        name = event.get("event", "")
        if name not in IMMEDIATE and name not in DIGEST:
            return
        key = (name, event.get("issue"), event.get("attempt"), event.get("task"), event.get("pr"), event.get("phase"))
        if now - self._seen.get(key, -1e9) < 60:
            return  # the same thing twice inside a minute is one thing
        self._seen[key] = now
        level, line = describe(event)
        if is_alert(event) and name != "decision_task":  # a decision arrives as a task card with its answer commands
            self.alert(level, line, now)
        if name in DIGEST or name in ("phase_done", "usage_limit_wait"):
            self.pending.append((level, line))

    def alert(self, level: str, line: str, now: float) -> None:
        while self._alerts and now - self._alerts[0] > 3600:
            self._alerts.popleft()
        if len(self._alerts) >= MAX_IMMEDIATE_PER_HOUR:
            self.folded += 1
            self.pending.append((level, line))
            return
        self._alerts.append(now)
        self.out.append(card(line, level, footer=time.strftime("%H:%M:%S", time.localtime(now)) + " · " + self.plan_id))

    def on_task(self, recipient: str, subject: str, message: str, task: Dict[str, Any], now: float) -> None:
        payload = task["payload"]
        level = "alert" if subject == "action needed" else "warn"
        title = "%s: %s" % ({"action needed": "Action needed"}.get(subject, subject.capitalize()), payload.get("kind", "task"))
        facts = [("task", task["task_id"]), ("issue", ", ".join(payload.get("issue_ids") or []))]
        self.out.append(card(title, level, lines=[clean(payload.get("why") or message, 700), clean(payload.get("request"), 300)], facts=facts,
                             code=answer_hint(task), footer="for %s · %s" % (recipient, self.plan_id)))

    # timers ----------------------------------------------------------------------------------------------
    def start_card(self, now: float) -> Dict[str, Any]:
        return self.status_card(now, "Harness run started")

    def stop_card(self, reason: str, now: float) -> Dict[str, Any]:
        return self.status_card(now, "Harness run stopped", level="alert", extra=clean(reason, 200))

    def status_card(self, now: float, title: str = "Harness status", level: str = "info", extra: str = "") -> Dict[str, Any]:
        try:
            s = self.collect(now)
        except Exception as exc:  # noqa: BLE001 - a status that cannot be read is still worth saying
            return card(title, "warn", lines=["The status could not be read: %s" % type(exc).__name__])
        facts = [("plan", "%s v%s · %s" % (s["plan_id"], s["version"], s["state"])),
                 ("phases", " · ".join("%s %s" % (k, v) for k, v in s["phases"].items()) or "-"),
                 ("issues", " · ".join("%d %s" % (n, k) for k, n in sorted(s["counts"].items(), key=lambda kv: -kv[1]))),
                 ("working", ", ".join("%s (%s)" % (i, st) for i, st in s["in_flight"][:6]) or "nobody right now")]
        if s["blocked"]:
            facts.append(("blocked", ", ".join(s["blocked"][:6])))
        facts.append(("open tasks", ", ".join(s["tasks"][:5]) if s["tasks"] else "none"))
        if s.get("art"):
            facts.append(("art credits", "%(remaining)d of %(credits)d left" % s["art"]))
        if s.get("limit_wait"):
            facts.append(("subscription", "limit reached, resumes %s" % time.strftime("%H:%M", time.localtime(s["limit_wait"]))))
        lines = [extra] if extra else None
        return card(title, level, lines=lines, facts=facts, footer=time.strftime("%a %H:%M", time.localtime(now)))

    def due(self, now: float) -> List[Dict[str, Any]]:
        """Cards to send now: queued alerts and tasks, then the digest and the status if their time has come."""
        cards, self.out = self.out, []
        if now >= self.next_activity:
            self.next_activity = now + self.activity_s
            if self.pending:
                cards.append(self.digest_card(now))
        if now >= self.next_status:
            self.next_status = now + self.status_s
            cards.append(self.status_card(now))
        return cards

    def digest_card(self, now: float) -> Dict[str, Any]:
        lines = ["%s" % line for _, line in self.pending[:MAX_DIGEST_LINES]]
        more = len(self.pending) - len(lines)
        level = "alert" if any(l == "alert" for l, _ in self.pending) else "warn" if any(l == "warn" for l, _ in self.pending) else "info"
        if more > 0:
            lines.append("… and %d more" % more)
        if self.folded:
            lines.append("(%d further alerts in the last hour were folded into this digest)" % self.folded)
            self.folded = 0
        self.pending = []
        return card("Activity", level, code="\n".join(clean(l, 200) for l in lines), footer=time.strftime("%H:%M", time.localtime(now)))


# -- what the status card reads ------------------------------------------------------------------------------------

def collect_status(home: str, plan_id: str, now: float) -> Dict[str, Any]:
    """The plan's present state, read through a connection of its own (sqlite connections belong to their thread)."""
    from .store import Store
    store = Store(home, readonly=True)
    try:
        latest = store.get_plan(plan_id)
        version = latest["plan"]["version"]
        counts: Dict[str, int] = {}
        in_flight, blocked, ids = [], [], set()
        for issue in store.list_issues(plan_id):
            state = store.state("issue", issue["issue_id"])
            ids.add(issue["issue_id"])
            counts[state] = counts.get(state, 0) + 1
            if state in ("In Progress", "Refining", "In Review"):
                in_flight.append((issue["issue_id"], state))
            elif state == "Blocked":
                blocked.append(issue["issue_id"])
        phases = {r["id"].rsplit("/", 1)[-1]: r["state"] for r in store.cx.execute(
            "SELECT id, state FROM entities WHERE machine='phase' AND id LIKE ? ORDER BY id", ("%s@v%d/%%" % (plan_id, version),))}
        tasks = [t["task_id"] for t in store.human_tasks() if t.get("state") == "Requested" and set(t["payload"].get("issue_ids") or []) & ids]
        art = None
        policy = latest["plan"]["policy"]
        if policy.get("art"):
            from .artservice import Ledger
            summary = Ledger(home, plan_id, policy["art"]["credits"]).summary()
            art = {"remaining": summary["remaining"], "credits": summary["credits"]}
        wait = store.cx.execute("SELECT data FROM events WHERE plan_id=? AND type='usage_limit_wait' AND ts > ? ORDER BY ts DESC LIMIT 1",
                                (plan_id, now - 6 * 3600)).fetchone()
        resume_at = json.loads(wait["data"]).get("resume_at") if wait else None
        return {"plan_id": plan_id, "version": version, "state": store.state("plan", "%s@v%d" % (plan_id, version)), "phases": phases,
                "counts": counts, "in_flight": in_flight, "blocked": blocked, "tasks": tasks, "art": art,
                "limit_wait": resume_at if resume_at and resume_at > now else None}
    finally:
        store.close()


# -- the service: a thread that owns the network ----------------------------------------------------------------------

class TeamsNotifier(Notifier):
    """Hands the harness's task notifications (requests, reminders, escalations) to the service."""

    def __init__(self, service: "TeamsService"):
        self.service = service

    def send(self, recipient: str, subject: str, message: str, task: Dict[str, Any]) -> None:
        self.service.submit(("task", recipient, subject, message, task))


class TeamsService:
    def __init__(self, home: str, plan_id: str, poster: Poster, clock: Callable[[], float] = time.time,
                 activity_minutes: float = ACTIVITY_MINUTES, status_minutes: float = STATUS_MINUTES,
                 collect: Optional[Callable[[float], Dict[str, Any]]] = None, pace_s: float = PACE_S):
        self.poster, self.clock, self.pace_s = poster, clock, pace_s
        self.reporter = Reporter(plan_id, collect or (lambda now: collect_status(home, plan_id, now)), clock(),
                                 activity_minutes * 60, status_minutes * 60)
        self.notifier = TeamsNotifier(self)
        self._q: "queue.Queue[Tuple[Any, ...]]" = queue.Queue(maxsize=2000)
        self._thread: Optional[threading.Thread] = None
        self._stopping = threading.Event()

    def submit(self, item: Tuple[Any, ...]) -> None:
        try:
            self._q.put_nowait(item)
        except queue.Full:
            pass  # the run matters more than the chat

    def emit(self, event: Dict[str, Any]) -> None:
        self.submit(("event", event))

    def start(self) -> "TeamsService":
        self._thread = threading.Thread(target=self._loop, name="teams-reporter", daemon=True)
        self._thread.start()
        self.submit(("card", self.reporter.start_card(self.clock())))
        return self

    def stop(self, reason: str = "") -> None:
        self.submit(("card", self.reporter.stop_card(reason or "the run ended", self.clock())))
        self._stopping.set()
        if self._thread is not None:
            self._thread.join(timeout=45)

    def pump(self) -> int:
        """Handle what is queued and send what is due. The thread calls this in a loop; tests call it directly."""
        sent = 0
        while True:
            try:
                item = self._q.get_nowait()
            except queue.Empty:
                break
            now = self.clock()
            if item[0] == "event":
                self.reporter.on_event(item[1], now)
            elif item[0] == "task":
                self.reporter.on_task(item[1], item[2], item[3], item[4], now)
            elif item[0] == "card":
                self.reporter.out.append(item[1])
        for content in self.reporter.due(self.clock()):
            self.poster.post(content)
            sent += 1
            self.poster.sleep(self.pace_s)
        return sent

    def _loop(self) -> None:
        while True:
            try:
                self.pump()
            except Exception:  # noqa: BLE001 - reporting must never take the run down
                pass
            if self._stopping.is_set() and self._q.empty():
                return
            self._stopping.wait(2.0)


def settings_minutes(env: Dict[str, str]) -> Tuple[float, float]:
    def number(name: str, default: float) -> float:
        try:
            value = float(env.get(name, ""))
            return value if 1 <= value <= 24 * 60 else default
        except ValueError:
            return default
    return number("HARNESS_TEAMS_ACTIVITY_MINUTES", ACTIVITY_MINUTES), number("HARNESS_TEAMS_STATUS_MINUTES", STATUS_MINUTES)
