"""Teams reporting: the webhook stays secret, the run never waits for Teams, and the owner hears about what matters."""
import io
import json
import os
import time
import urllib.error
from types import SimpleNamespace

import pytest

from harness import cli, runner, teams
from harness.humantasks import MultiNotifier, TerminalNotifier
from harness_doubles import Env

URL = "https://prod-12.westeurope.logic.azure.com:443/workflows/abc/triggers/manual/paths/invoke?api-version=2016-06-01&sig=SECRETSIG1234"


# -- the webhook URL --------------------------------------------------------------------------------------

@pytest.mark.parametrize("url", [
    URL, "https://x.environment.api.powerplatform.com/powerautomate/automations/direct/workflows/1/triggers/manual/paths/invoke?sig=a",
    "https://contoso.webhook.office.com/webhookb2/abc",
])
def test_workflows_urls_are_accepted(url):
    assert teams.url_problem(url) is None


@pytest.mark.parametrize("url, fragment", [
    ("http://prod.logic.azure.com/x", "https://"), ("https://evil.example.com/hook", "not a Microsoft Workflows address"),
    ("https://logic.azure.com.evil.com/x", "not a Microsoft Workflows address"), ("https://user:pw@prod.logic.azure.com/x", "credentials"),
    ("https://prod.logic.azure.com:8443/x", "port 443"), ("not a url", "https://"), ("", "https://"),
])
def test_other_addresses_are_refused(url, fragment):
    assert fragment in teams.url_problem(url)


def test_the_url_is_stored_0600_never_shown_and_a_bad_file_is_ignored(tmp_path):
    assert teams.load_url(str(tmp_path)) is None
    teams.save_url(str(tmp_path), "  " + URL + "\n")
    assert oct(os.stat(teams.path(str(tmp_path))).st_mode & 0o777) == "0o600" and teams.load_url(str(tmp_path)) == URL
    shown = teams.redacted(URL)
    assert "SECRETSIG" not in shown and "workflows" not in shown and shown.endswith("1234") and "logic.azure.com" in shown
    with pytest.raises(ValueError, match="https"):
        teams.save_url(str(tmp_path), "http://x")
    with open(teams.path(str(tmp_path)), "w") as fh:
        fh.write("https://evil.example.com/hook")
    assert teams.load_url(str(tmp_path)) is None, "a file edited to an unknown host is not used"
    assert teams.remove_url(str(tmp_path)) and not teams.remove_url(str(tmp_path))


# -- posting ----------------------------------------------------------------------------------------------

class Opener:
    def __init__(self, *results):
        self.results, self.requests = list(results), []

    def __call__(self, request, timeout=None):
        self.requests.append((request, timeout))
        result = self.results.pop(0) if self.results else 202
        if isinstance(result, Exception):
            raise result
        if isinstance(result, tuple):
            raise urllib.error.HTTPError(request.full_url, result[0], "x", {"Retry-After": str(result[1])}, io.BytesIO(b""))
        return _Response(result)


class _Response:
    def __init__(self, status):
        self.status = status

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False


def test_a_card_is_posted_as_an_adaptive_card_message():
    opener = Opener(202)
    poster = teams.Poster(URL, opener=opener, sleep=lambda s: None)
    assert poster.post(teams.card("Hello", "good", lines=["body"], facts=[("a", "b")], code="cmd")) and poster.sent == 1
    request, timeout = opener.requests[0]
    body = json.loads(request.data)
    assert request.get_method() == "POST" and timeout == 15 and request.headers["Content-type"] == "application/json"
    assert body["type"] == "message" and body["attachments"][0]["contentType"] == "application/vnd.microsoft.card.adaptive"
    content = body["attachments"][0]["content"]
    assert content["type"] == "AdaptiveCard" and content["version"] == "1.4" and content["body"][0]["text"] == "Hello" and content["body"][0]["color"] == "Good"
    assert any(b["type"] == "FactSet" for b in content["body"]) and any(b.get("fontType") == "Monospace" for b in content["body"])


def test_a_rate_limit_is_retried_after_the_wait_and_failures_are_dropped():
    waits = []
    ok = teams.Poster(URL, opener=Opener((429, 3), 202), sleep=waits.append)
    assert ok.post(teams.card("x")) and waits == [3.0] and ok.sent == 1
    down = teams.Poster(URL, opener=Opener((503, 0), urllib.error.URLError("https://secret.example/%s" % URL), (500, 0)), sleep=lambda s: None)
    assert not down.post(teams.card("x")) and down.failed == 1 and "SECRETSIG" not in down.last_error and URL not in down.last_error
    refused = Opener((400, 0))
    assert not teams.Poster(URL, opener=refused, sleep=lambda s: None).post(teams.card("x")) and len(refused.requests) == 1, "a bad request is not retried"


def test_an_oversized_card_is_dropped_before_it_can_be_refused():
    opener = Opener()
    poster = teams.Poster(URL, opener=opener, sleep=lambda s: None)
    big = {"type": "AdaptiveCard", "body": [{"type": "TextBlock", "text": "x" * 30000}]}
    assert not poster.post(big) and not opener.requests and "larger" in poster.last_error


def test_cards_never_carry_a_credential():
    text = json.dumps(teams.card("t", lines=["token ghp_" + "a" * 36 + " and Bearer abcdefghijklmnopqrstuvwxyz"]))
    assert "ghp_" not in text and "abcdefghijklmnopqrstuvwxyz" not in text and "[redacted]" in text


# -- what is worth saying --------------------------------------------------------------------------------------

def make_reporter(now=1000.0, collect=None, activity=900, status=3600):
    return teams.Reporter("plan-a", collect or (lambda t: STATUS), now, activity, status)


STATUS = {"plan_id": "plan-a", "version": 2, "state": "Executing", "phases": {"P1": "Done", "P2": "Active"}, "counts": {"Done": 8, "Ready": 20, "In Progress": 1},
          "in_flight": [("ffmhero-selection", "In Progress")], "blocked": ["ffmhero-art-tooling"], "tasks": ["decision-x-1"], "art": {"remaining": 300, "credits": 320},
          "limit_wait": None}


def titles(cards):
    return [c["body"][0]["text"] for c in cards]


def test_blocks_and_limits_are_alerts_while_routine_activity_waits_for_the_digest():
    r = make_reporter()
    r.on_event({"event": "dispatched", "issue": "i1", "role": "implementer", "model": "claude-sonnet-5-5"}, 1001)
    r.on_event({"event": "merge_pending", "issue": "i1"}, 1002)
    r.on_event({"event": "attempt_failed", "issue": "i1", "kind": "checks_failed", "action": "retry"}, 1003)
    assert r.out == [], "nothing interrupts the owner for ordinary work"
    r.on_event({"event": "attempt_failed", "issue": "i2", "kind": "scope_violation", "action": "block"}, 1004)
    r.on_event({"event": "usage_limit_wait", "detail": "limit", "resume_at": 2000}, 1005)
    r.on_event({"event": "phase_done", "phase": "P2"}, 1006)
    assert len(r.out) == 3 and "i2 attempt failed: scope_violation → block" in titles(r.out)[0]
    assert r.out[0]["body"][0]["color"] == "Attention" and "limit reached" in titles(r.out)[1] and "phase P2 is done" in titles(r.out)[2]


def test_the_digest_comes_on_its_timer_and_only_when_something_happened():
    r = make_reporter(now=0, activity=900, status=10**9)
    assert r.due(901) == [], "an empty period sends nothing"
    r.on_event({"event": "dispatched", "issue": "i1", "role": "implementer", "model": "claude-sonnet-5-5"}, 1000)
    r.on_event({"event": "done", "issue": "i0"}, 1010)
    r.on_event({"event": "merged", "issue": "i0", "pr": 484}, 1011)
    assert r.due(1500) == [], "not due yet"
    (digest,) = r.due(1900)
    lines = [b for b in digest["body"] if b.get("fontType") == "Monospace"][0]["text"].splitlines()
    assert lines == ["▶ implementer started on i1 (sonnet)", "✅ i0 is Done", "⇣ PR #484 merged (i0)"] and digest["body"][0]["text"] == "Activity"
    assert r.due(3000) == [] and r.pending == []


def test_a_burst_of_alerts_is_folded_into_the_digest_and_repeats_are_one_event():
    r = make_reporter(now=0, activity=900, status=10**9)
    for n in range(20):
        r.on_event({"event": "merge_failed", "issue": "i%d" % n, "error": "boom"}, 100 + n * 61)
    assert len(r.out) == teams.MAX_IMMEDIATE_PER_HOUR and r.folded == 20 - teams.MAX_IMMEDIATE_PER_HOUR
    (digest,) = r.due(1400)[teams.MAX_IMMEDIATE_PER_HOUR:]
    assert "folded into this digest" in json.dumps(digest)
    twice = make_reporter()
    twice.on_event({"event": "attempt_failed", "issue": "i1", "attempt": "i1#2", "kind": "x", "action": "block"}, 1000)
    twice.on_event({"event": "attempt_failed", "issue": "i1", "attempt": "i1#2", "kind": "x", "action": "block"}, 1030)
    assert len(twice.out) == 1


def test_the_status_card_summarises_the_run_and_survives_an_unreadable_store():
    r = make_reporter()
    content = r.start_card(1000)
    facts = dict((f["title"], f["value"]) for f in [b for b in content["body"] if b["type"] == "FactSet"][0]["facts"])
    assert content["body"][0]["text"] == "Harness run started" and facts["plan"] == "plan-a v2 · Executing" and "P2 Active" in facts["phases"]
    assert facts["issues"].startswith("20 Ready") and "ffmhero-selection (In Progress)" in facts["working"] and facts["blocked"] == "ffmhero-art-tooling"
    assert facts["open tasks"] == "decision-x-1" and facts["art credits"] == "300 of 320 left"
    broken = make_reporter(collect=lambda t: 1 / 0).status_card(1000)
    assert "could not be read" in json.dumps(broken)
    assert make_reporter().stop_card("killed", 1000)["body"][0]["color"] == "Attention"
    due = make_reporter(now=0, activity=10**9, status=3600).due(3601)
    assert titles(due) == ["Harness status"]


# -- tasks ------------------------------------------------------------------------------------------------------

def task(kind, **payload):
    return {"task_id": "t-%s-1" % kind, "payload": dict({"kind": kind, "issue_ids": ["i1"], "why": "Issue i1 is blocked", "request": "Pick one.", "extra": {}}, **payload)}


def test_a_decision_task_arrives_with_its_options_and_the_command_to_answer():
    r = make_reporter()
    r.on_task("owner", "action needed", "x", task("decision", options=["retry as is", "give guidance and retry"]), 1000)
    (c,) = r.out
    text = json.dumps(c, ensure_ascii=False)
    assert c["body"][0]["text"] == "Action needed: decision" and c["body"][0]["color"] == "Attention"
    assert "1  retry as is" in text and "2  give guidance and retry" in text and "harness respond t-decision-1 --option N" in text and "--guidance" in text
    r.on_task("owner", "reminder 1", "x", task("decision", options=["a"]), 2000)
    assert r.out[-1]["body"][0]["text"] == "Reminder 1: decision" and r.out[-1]["body"][0]["color"] == "Warning"


def test_review_and_asset_tasks_say_what_to_open_and_how_to_reply():
    assert "open: /x/sheet.png" in teams.answer_hint(task("manual_test", extra={"asset_abspath": "/x/sheet.png"}))
    assert "--outcome pass|fail|inconclusive" in teams.answer_hint(task("manual_test"))
    assert "--artifact FILE" in teams.answer_hint(task("asset")) and "harness tasks" in teams.answer_hint(task("something_else"))


def test_a_decision_event_is_not_also_posted_as_an_alert():
    r = make_reporter()
    r.on_event({"event": "decision_task", "issue": "i1", "task": "d1"}, 1000)
    assert r.out == [], "the task card, with its answer commands, is the one message"


# -- the service ----------------------------------------------------------------------------------------------------

class FakePoster:
    def __init__(self):
        self.cards, self.sleep = [], lambda s: None

    def post(self, content):
        self.cards.append(content)
        return True


def make_service(clock):
    service = teams.TeamsService("/unused", "plan-a", FakePoster(), clock=clock, activity_minutes=15, status_minutes=60,
                                 collect=lambda t: STATUS, pace_s=0)
    return service


def test_events_tasks_and_timers_all_flow_through_one_queue():
    now = [1000.0]
    service = make_service(lambda: now[0])
    service.submit(("card", service.reporter.start_card(now[0])))
    service.emit({"event": "attempt_failed", "issue": "i1", "kind": "scope_violation", "action": "block"})
    service.notifier.send("owner", "action needed", "x", task("decision", options=["retry as is"]))
    service.emit({"event": "done", "issue": "i0"})
    assert service.pump() == 3
    assert titles(service.poster.cards)[0] == "Harness run started" and "scope_violation" in titles(service.poster.cards)[1] and "decision" in titles(service.poster.cards)[2]
    now[0] += 16 * 60
    assert service.pump() == 1 and service.poster.cards[-1]["body"][0]["text"] == "Activity"
    now[0] += 60 * 60
    assert service.pump() == 1 and service.poster.cards[-1]["body"][0]["text"] == "Harness status"


def test_a_full_queue_never_blocks_the_run():
    service = make_service(time.time)
    service._q.maxsize = 3
    for n in range(50):
        service.emit({"event": "done", "issue": "i%d" % n})  # must not raise or block
    assert service._q.qsize() == 3


def test_the_background_thread_posts_and_says_goodbye_on_stop():
    service = teams.TeamsService("/unused", "plan-a", FakePoster(), collect=lambda t: STATUS, pace_s=0).start()
    service.emit({"event": "attempt_failed", "issue": "i1", "kind": "x", "action": "block"})
    service.stop("test over")
    texts = titles(service.poster.cards)
    assert texts[0] == "Harness run started" and "i1 attempt failed" in texts[1] and texts[-1] == "Harness run stopped"
    assert "test over" in json.dumps(service.poster.cards[-1])
    assert not service._thread.is_alive()


def test_a_poster_that_raises_cannot_take_the_thread_down():
    class Exploding(FakePoster):
        def post(self, content):
            raise RuntimeError("teams exploded")

    service = teams.TeamsService("/unused", "plan-a", Exploding(), collect=lambda t: STATUS, pace_s=0).start()
    service.emit({"event": "attempt_failed", "issue": "i1", "kind": "x", "action": "block"})
    time.sleep(0.3)
    assert service._thread.is_alive()
    service.stop("done")


# -- the real status, and the run's wiring -----------------------------------------------------------------------------

def test_the_status_reads_the_real_store_through_its_own_connection(tmp_path):
    env = Env(tmp_path)
    status = teams.collect_status(env.store.home, "fx", env.clock())
    assert status["plan_id"] == "fx" and status["version"] == 1 and status["counts"] == {"Ready": 1} and status["art"] is None
    assert status["blocked"] == [] and status["in_flight"] == [] and status["limit_wait"] is None


def test_the_run_reports_only_with_a_webhook_and_never_in_a_rehearsal(tmp_path, monkeypatch):
    env = Env(tmp_path)
    posted = []
    monkeypatch.setattr(teams.Poster, "post", lambda self, content: posted.append(content) or True)
    sched = SimpleNamespace(notifier=TerminalNotifier(lambda m: None))
    assert runner.start_teams_service(env.store, "fx", sched, dry_run=False) is None, "no webhook, no reporting"
    teams.save_url(env.store.home, URL)
    assert runner.start_teams_service(env.store, "fx", sched, dry_run=True) is None
    service = runner.start_teams_service(env.store, "fx", sched, dry_run=False)
    try:
        assert isinstance(sched.notifier, MultiNotifier) and service.notifier in sched.notifier.notifiers and len(sched.notifier.notifiers) == 2
    finally:
        service.stop("test")
    assert titles(posted)[0] == "Harness run started" and titles(posted)[-1] == "Harness run stopped"


def test_the_intervals_come_from_the_env_file_with_safe_defaults():
    assert teams.settings_minutes({}) == (15, 60)
    assert teams.settings_minutes({"HARNESS_TEAMS_ACTIVITY_MINUTES": "5", "HARNESS_TEAMS_STATUS_MINUTES": "120"}) == (5, 120)
    assert teams.settings_minutes({"HARNESS_TEAMS_ACTIVITY_MINUTES": "0", "HARNESS_TEAMS_STATUS_MINUTES": "soon"}) == (15, 60)


# -- the command ------------------------------------------------------------------------------------------------------------

def test_teams_login_status_test_and_logout(tmp_path, monkeypatch, capsys):
    home = str(tmp_path / "h")
    assert cli.main(["--home", home, "teams", "status"]) == 1
    monkeypatch.setenv("MY_HOOK", URL)
    assert cli.main(["--home", home, "teams", "login", "--url-env", "MY_HOOK"]) == 0
    out = capsys.readouterr().out
    assert "SECRETSIG" not in out and URL not in out
    assert cli.main(["--home", home, "teams", "status"]) == 0
    shown = capsys.readouterr().out
    assert "logic.azure.com" in shown and "0o600".replace("0o", "") in shown and "SECRETSIG" not in shown
    sent = []
    monkeypatch.setattr(teams.Poster, "post", lambda self, content: sent.append(content) or True)
    assert cli.main(["--home", home, "teams", "test"]) == 0 and sent[0]["body"][0]["text"] == "Harness test message"
    monkeypatch.setattr(teams.Poster, "post", lambda self, content: False)
    assert cli.main(["--home", home, "teams", "test"]) == 1
    assert cli.main(["--home", home, "teams", "logout"]) == 0 and cli.main(["--home", home, "teams", "test"]) == 2


def test_teams_login_refuses_a_wrong_address_and_a_missing_terminal(tmp_path, monkeypatch, capsys):
    home = str(tmp_path / "h")
    monkeypatch.setenv("BAD_HOOK", "https://evil.example.com/hook")
    assert cli.main(["--home", home, "teams", "login", "--url-env", "BAD_HOOK"]) == 2
    assert "not a Microsoft Workflows address" in capsys.readouterr().err and not os.path.exists(teams.path(home))
    monkeypatch.setattr("sys.stdin", io.StringIO(""))
    assert cli.main(["--home", home, "teams", "login"]) == 2
    assert cli.main(["--home", home, "teams", "login", "--url-env", "UNSET_VAR_XYZ"]) == 2
