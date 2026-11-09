"""Claude Code runtime: credentials, usage-window detection, and the scheduler waiting for the window to reopen."""
from __future__ import annotations

import pytest

from harness import adapter as adapter_mod, failures, isolation
from harness.adapter import ClaudeCodeAdapter, CopilotCliAdapter, adapter_for, usage_window_reset

from harness_doubles import Env  # noqa: F401  (same helper module the scheduler tests use)
from test_harness_runner import finished_handle


def test_window_reset_is_read_from_the_runtime_output():
    now = 1_900_000_000 - 3600
    assert usage_window_reset("Claude AI usage limit reached|1900000000", now) == 1_900_000_000
    assert usage_window_reset('{"resets_at": 1900000000000}', now) == 1_900_000_000  # milliseconds
    assert usage_window_reset("5-hour limit reached", now) is None
    assert usage_window_reset("limit reached|1800000000", now) is None  # already past
    assert usage_window_reset("limit reached|2900000000", now) is None  # farther than the weekly window


def test_a_closed_window_is_its_own_failure_class_and_spends_no_budget():
    assert failures.classify("usage_window") == failures.WINDOW
    issue = {"transient_failures": 0, "repair_failures": 0}
    assert failures.decide(failures.WINDOW, issue, {"transient_retries": 0, "repair_attempts": 0}, 0.0) == {"action": "window"}
    assert issue == {"transient_failures": 0, "repair_failures": 0}


@pytest.mark.parametrize("tail", [["Claude AI usage limit reached|1900000000"], ["You've hit your limit"], ["5-hour limit reached - resets 3pm"]])
def test_claude_poll_reports_a_closed_window(tmp_path, tail):
    a = ClaudeCodeAdapter(str(tmp_path), str(tmp_path))
    error = a.poll(finished_handle(tmp_path, 1, tail), 1_800_000_000).error
    assert error["kind"] == "usage_window"


def test_claude_poll_keeps_other_failures(tmp_path):
    a = ClaudeCodeAdapter(str(tmp_path), str(tmp_path))
    assert a.poll(finished_handle(tmp_path, 1, ["segfault"]), 0).error["kind"] == "runtime_crash"
    assert a.poll(finished_handle(tmp_path, 0, [], {"ok": 1}), 0).result == {"ok": 1}


def test_claude_needs_its_own_token_and_forwards_it_by_name(tmp_path):
    a = ClaudeCodeAdapter(str(tmp_path), str(tmp_path))
    assert a._credential(None)[0] is None and "claude.token" in a._credential(None)[1]
    (tmp_path / "claude.token").write_text("sub-secret")
    assert a._credential(None) == (str(tmp_path / "claude.token"), "")
    assert isolation.pass_env_names("t", None, isolation.CLAUDE_TOKEN_ENV) == [isolation.CLAUDE_TOKEN_ENV]
    env = isolation.worker_env_for_attempt(str(tmp_path / "claude.token"), None, isolation.CLAUDE_TOKEN_ENV)
    assert env[isolation.CLAUDE_TOKEN_ENV] == "sub-secret" and "ANTHROPIC_API_KEY" not in env


def test_runtime_follows_the_token_in_the_store(tmp_path, monkeypatch):
    monkeypatch.delenv("HARNESS_RUNTIME", raising=False)
    assert type(adapter_for(str(tmp_path), str(tmp_path))) is CopilotCliAdapter
    (tmp_path / "claude.token").write_text("x")
    assert type(adapter_for(str(tmp_path), str(tmp_path))) is ClaudeCodeAdapter
    monkeypatch.setenv("HARNESS_RUNTIME", "copilot")
    assert type(adapter_for(str(tmp_path), str(tmp_path))) is CopilotCliAdapter


def test_dispatch_waits_for_the_window_and_then_resumes(tmp_path):
    env = Env(tmp_path)
    env.adapter.script("i1", "implementer", "error:usage_window")
    env.start()
    env.tick()
    events = env.tick()
    issue = env.store.get_issue("i1")
    assert issue.get("transient_failures", 0) == 0 and issue.get("repair_failures", 0) == 0
    until = env.store.get_run("fx")["window_until"]
    assert until > env.clock() and any(e["event"] == "usage_window" for e in events)
    attempts = len(env.store.list_attempts("i1"))
    env.tick(60)
    assert len(env.store.list_attempts("i1")) == attempts  # closed: nothing new starts
    env.run_until(lambda: env.state("i1") == "Done", advance=60)
