"""The Claude Code runtime: subscription token, stream parsing, usage limits, and the quota wait."""
import datetime as dt
import json
import os
import subprocess

import pytest

from harness import claudecode, failures, isolation
from harness.adapter import ClaudeCodeAdapter, WorkRequest, _Handle

UTC = dt.timezone.utc
NOW = dt.datetime(2026, 11, 16, 10, 0, tzinfo=UTC).timestamp()  # a Monday


# -- the token --------------------------------------------------------------------------------------------

def test_the_token_is_stored_0600_and_becomes_the_worker_credential(tmp_path):
    assert claudecode.env_for(str(tmp_path)) is None and not claudecode.has_token(str(tmp_path))
    claudecode.save_token(str(tmp_path), "  sk-ant-oat01-abcdefghijkl\n")
    assert oct(os.stat(claudecode.token_path(str(tmp_path))).st_mode & 0o777) == "0o600"
    assert claudecode.env_for(str(tmp_path)) == {"CLAUDE_CODE_OAUTH_TOKEN": "sk-ant-oat01-abcdefghijkl"}
    assert "abcdefgh" not in claudecode.redacted(str(tmp_path)) and claudecode.redacted(str(tmp_path)).endswith("ijkl")
    assert claudecode.remove_token(str(tmp_path)) and not claudecode.has_token(str(tmp_path))


@pytest.mark.parametrize("token, message", [
    ("", "empty"), ("two words", "whitespace"), ("sk-ant-api03-xyz", "API key"),
])
def test_an_api_key_or_a_malformed_token_is_refused(tmp_path, token, message):
    with pytest.raises(ValueError, match=message):
        claudecode.save_token(str(tmp_path), token)


def test_the_scrubber_never_hands_the_api_key_to_a_worker(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "would-bill-the-api")
    env = isolation.worker_env_for_attempt({"CLAUDE_CODE_OAUTH_TOKEN": "t"})
    assert "ANTHROPIC_API_KEY" not in env and env["CLAUDE_CODE_OAUTH_TOKEN"] == "t"


# -- the command and the stream ---------------------------------------------------------------------------

def test_the_work_command_quotes_the_model_and_skips_prompts_inside_the_sandbox():
    line = claudecode.work_command("claude-sonnet-5-5; rm -rf /")
    assert "--model 'claude-sonnet-5-5; rm -rf /'" in line
    assert "--dangerously-skip-permissions" in line and "--output-format stream-json" in line
    assert "--model" not in claudecode.work_command(None)


def test_stream_events_become_readable_lines_and_the_result_is_kept():
    tool = json.dumps({"type": "assistant", "message": {"content": [{"type": "tool_use", "name": "Bash", "input": {"command": "npm test"}}]}})
    assert claudecode.render(tool) == ("● Bash npm test", None)
    assert claudecode.render(json.dumps({"type": "user", "message": {}})) == (None, None)
    assert claudecode.render("Error: plain text") == ("Error: plain text", None)
    result = {"type": "result", "subtype": "success", "is_error": False, "result": "done",
              "usage": {"input_tokens": 10, "cache_read_input_tokens": 1000, "cache_creation_input_tokens": 90, "output_tokens": 50},
              "total_cost_usd": 0.12}
    shown, event = claudecode.render(json.dumps(result))
    assert shown == "result: done" and event == result
    assert claudecode.measured_usage(event) == {"input_tokens": 1100, "output_tokens": 50,
                                                "basis": "reported by Claude Code (subscription usage)", "api_equivalent_usd": 0.12}
    assert claudecode.measured_usage(None) is None


# -- usage limits -----------------------------------------------------------------------------------------

def test_no_limit_message_means_no_wait():
    assert claudecode.usage_limit(["rate limited by a tool", "all good"], NOW) is None


def test_the_epoch_form_waits_until_that_moment():
    reset = NOW + 3 * 3600
    assert claudecode.usage_limit(["Claude AI usage limit reached|%d" % reset], NOW) == reset + 60


def test_a_session_limit_resets_later_today_or_tomorrow():
    at = claudecode.usage_limit(["5-hour limit reached ∙ resets 3pm (UTC)"], NOW)
    assert dt.datetime.fromtimestamp(at, UTC) == dt.datetime(2026, 11, 16, 15, 1, tzinfo=UTC)
    at = claudecode.usage_limit(["You've hit your limit · resets 9am (UTC)"], NOW)
    assert dt.datetime.fromtimestamp(at, UTC) == dt.datetime(2026, 11, 17, 9, 1, tzinfo=UTC)  # 9am already passed today


def test_a_weekly_limit_resets_on_the_named_day():
    at = claudecode.usage_limit(["Weekly limit reached ∙ resets Thu 8:30am (UTC)"], NOW)
    assert dt.datetime.fromtimestamp(at, UTC) == dt.datetime(2026, 11, 19, 8, 31, tzinfo=UTC)
    at = claudecode.usage_limit(["Weekly limit reached ∙ resets Nov 20, 5pm (UTC)"], NOW)
    assert dt.datetime.fromtimestamp(at, UTC) == dt.datetime(2026, 11, 20, 17, 1, tzinfo=UTC)


def test_an_unreadable_reset_time_checks_back_after_the_default_wait():
    assert claudecode.usage_limit(["Claude usage limit reached. Try again later."], NOW) == NOW + claudecode.DEFAULT_WAIT_S
    absurd = "Claude AI usage limit reached|%d" % (NOW + 90 * 86400)
    assert claudecode.usage_limit([absurd], NOW) == NOW + claudecode.DEFAULT_WAIT_S


def test_a_limit_parks_the_issue_until_the_reset_without_spending_budget():
    issue = {"not_before": 0.0}
    budgets = {"transient_retries": 0, "repair_attempts": 0}
    for _ in range(5):  # however often the limit is hit, nothing is used up and nothing blocks
        decision = failures.decide(failures.classify("usage_limit"), issue, budgets, NOW, retry_at=NOW + 7200)
        assert decision["action"] == "retry" and decision["wait"] == "usage_limit"
    assert issue["not_before"] == NOW + 7200
    assert "transient_failures" not in issue and "repair_failures" not in issue
    assert failures.decide(failures.QUOTA, {"not_before": 0.0}, budgets, NOW)["delay"] == failures.QUOTA_DEFAULT_WAIT_S


# -- the adapter ------------------------------------------------------------------------------------------

class Exited:
    def __init__(self, code):
        self.returncode = code

    def poll(self):
        return self.returncode


def handle(tmp_path, tail, event=None, code=1):
    req = WorkRequest("i1#1", 1, "i1", "implementer", "low", "claude-haiku-5-5", {}, "harness/i1")
    h = _Handle(req, str(tmp_path), Exited(code), "harness-i1")
    h.tail, h.result_event = list(tail), event
    return h


def test_a_limited_worker_reports_a_usage_limit_with_its_reset(tmp_path):
    adapter = ClaudeCodeAdapter(str(tmp_path), str(tmp_path))
    event = {"type": "result", "is_error": True, "result": "Claude AI usage limit reached|%d" % (NOW + 600)}
    poll = adapter.poll(handle(tmp_path, ["result: Claude AI usage limit reached"], event), NOW)
    assert poll.error["kind"] == "usage_limit" and poll.error["retry_at"] == NOW + 660


def test_a_rejected_token_pauses_as_a_credentials_failure(tmp_path):
    adapter = ClaudeCodeAdapter(str(tmp_path), str(tmp_path))
    poll = adapter.poll(handle(tmp_path, ["Invalid API key · Please run /login"]), NOW)
    assert poll.error["kind"] == "credentials" and failures.classify("credentials") == failures.SYSTEMIC


def test_the_measured_usage_is_recorded_and_wins_over_estimates(tmp_path):
    adapter = ClaudeCodeAdapter(str(tmp_path), str(tmp_path))
    event = {"type": "result", "usage": {"input_tokens": 5, "output_tokens": 7}}
    recorded = adapter.usage(handle(tmp_path, [], event, code=0))
    assert recorded["runtime_usage"]["input_tokens"] == 5 and recorded["runtime_usage"]["output_tokens"] == 7
    from harness import usage
    assert usage.attempt_tokens({"usage": dict(recorded, agent_estimate={"input_tokens": 1, "output_tokens": 1})})["source"] == "runtime_usage"


def test_without_a_token_the_adapter_is_unavailable_and_starts_nothing(tmp_path, monkeypatch):
    monkeypatch.setattr(isolation, "docker_available", lambda: True)
    monkeypatch.setattr(isolation, "image_id", lambda image=isolation.IMAGE: "sha256:x")
    adapter = ClaudeCodeAdapter(str(tmp_path), str(tmp_path))
    assert "harness claude login" in adapter.probe()["reason"]
    with pytest.raises(RuntimeError, match="claude.token"):
        adapter.start(WorkRequest("i1#1", 1, "i1", "implementer", "low", "claude-haiku-5-5", {}, "harness/i1"))


def test_a_probe_at_the_limit_still_accepts_the_model(tmp_path, monkeypatch):
    claudecode.save_token(str(tmp_path), "sk-ant-oat01-token")
    monkeypatch.setattr(isolation, "docker_available", lambda: True)
    monkeypatch.setattr(isolation, "image_id", lambda image=isolation.IMAGE: "sha256:x")
    monkeypatch.setenv("HARNESS_WORK_ROOT", str(tmp_path / "w"))
    seen = []

    def fake_run(workdir, command, credential=None, timeout=1800):
        seen.append((command, credential))
        out = {"claude-haiku-5-5": '{"type":"result","is_error":false,"result":"OK"}',
               "claude-sonnet-5-5": '{"type":"result","is_error":true,"result":"Claude AI usage limit reached|%d"}' % (NOW + 99),
               "claude-opus-5-5": '{"type":"result","is_error":true,"result":"model not found"}'}[command[command.index("--model") + 1]]
        return subprocess.CompletedProcess(command, 0 if "false" in out else 1, out, "")

    monkeypatch.setattr(isolation, "run_worker", fake_run)
    result = ClaudeCodeAdapter(str(tmp_path), str(tmp_path)).probe(["claude-haiku-5-5", "claude-sonnet-5-5", "claude-opus-5-5"])
    assert result["models"] == ["claude-haiku-5-5", "claude-sonnet-5-5"]
    assert all(credential == {"CLAUDE_CODE_OAUTH_TOKEN": "sk-ant-oat01-token"} for _, credential in seen)
