import json
import os

import pytest

from harness import status, usage
from harness.adapter import CopilotCliAdapter, WorkRequest, _Handle, build_prompt
from harness_doubles import Env

AGENT = {"input_tokens": 12000, "output_tokens": 800, "basis": "read about 40 files"}
SIZE = {"input_tokens": 3000, "output_tokens": 200}


def attempts(env, role=None):
    return [a for a in env.store.list_attempts("i1") if role in (None, a["role"])]


def finished(env):
    env.start()
    env.run_until(lambda: env.state("i1") == "Done")


# -- recording ----------------------------------------------------------------------------------------------

def test_every_agent_role_can_report_its_own_estimate(tmp_path):
    env = Env(tmp_path)
    env.adapter.agent_usage = dict(AGENT)
    finished(env)
    assert {a["role"] for a in attempts(env)} == {"implementer", "reviewer"}
    assert all(a["usage"]["agent_estimate"] == AGENT for a in attempts(env))


def test_the_adapters_size_estimate_is_kept_and_the_agents_own_figure_wins(tmp_path):
    env = Env(tmp_path)
    env.adapter.size_usage = dict(SIZE)
    finished(env)
    only_size = attempts(env, "implementer")[0]
    assert only_size["usage"]["size_estimate"] == SIZE and "agent_estimate" not in only_size["usage"]
    assert usage.attempt_tokens(only_size) == dict(SIZE, source="size_estimate") and "size only" in usage.attempt_label(only_size)
    both_dir = tmp_path / "both"
    both_dir.mkdir()
    both = Env(both_dir)
    both.adapter.size_usage, both.adapter.agent_usage = dict(SIZE), dict(AGENT)
    finished(both)
    assert usage.attempt_tokens(attempts(both, "reviewer")[0])["source"] == "agent_estimate"
    assert "agent estimate" in usage.attempt_label(attempts(both, "reviewer")[0])


@pytest.mark.parametrize("bad", ["lots", 42, [], {"input_tokens": -5, "output_tokens": 1}, {"input_tokens": True, "output_tokens": 1},
                                 {"input_tokens": 1.5, "output_tokens": 1}, {"input_tokens": 1}, {"input_tokens": 10**9, "output_tokens": 1}])
def test_a_malformed_estimate_is_ignored_and_never_fails_the_work(tmp_path, bad):
    env = Env(tmp_path)
    env.adapter.agent_usage = bad
    finished(env)
    assert all(a["outcome"] == "Succeeded" and "agent_estimate" not in (a.get("usage") or {}) for a in attempts(env))


def test_a_failed_attempt_still_records_what_it_used(tmp_path):
    env = Env(tmp_path)
    env.adapter.size_usage = dict(SIZE)
    env.adapter.script("i1", "implementer", "error:infra", "ok")
    env.start()
    env.run_until(lambda: env.state("i1") == "Done", advance=60)
    failed = attempts(env, "implementer")[0]
    assert failed["outcome"] == "Failed" and failed["usage"]["size_estimate"] == SIZE


def test_credentials_in_runtime_usage_lines_are_redacted_and_other_lines_are_dropped():
    lines = ["Reading files", "Total usage: 1 Premium request", "tokens used ghp_" + "a" * 36, "Done", "usage " + "x" * 400]
    kept = usage.runtime_lines(lines)
    assert len(kept) == 3 and all("ghp_" not in line and len(line) <= 200 for line in kept) and "[redacted]" in kept[1]
    assert usage.runtime_lines(["usage %d" % n for n in range(9)]) == ["usage %d" % n for n in range(4, 9)]


def test_the_real_adapter_estimates_from_file_sizes_and_keeps_usage_lines(tmp_path):
    class Proc:
        returncode = 0

        def poll(self):
            return 0

    (tmp_path / "prompt.txt").write_text("p" * 400)
    (tmp_path / "task.json").write_text("t" * 400)
    (tmp_path / "result.json").write_text("r" * 81)
    handle = _Handle(WorkRequest("i1#1", 1, "i1", "implementer", "low", None, {}, "b"), str(tmp_path), Proc(), "n")
    handle.tail = ["working", "Total usage est: 1 Premium request"]
    reported = CopilotCliAdapter(str(tmp_path), str(tmp_path)).usage(handle)
    assert reported == {"size_estimate": {"input_tokens": 200, "output_tokens": 21}, "runtime_lines": ["Total usage est: 1 Premium request"]}
    (tmp_path / "result.json").unlink()
    assert CopilotCliAdapter(str(tmp_path), str(tmp_path)).usage(handle)["size_estimate"]["output_tokens"] == 0


# -- reporting ----------------------------------------------------------------------------------------------------

def test_the_report_totals_estimates_by_plan_model_and_role_and_names_the_source(tmp_path):
    env = Env(tmp_path)
    env.adapter.agent_usage = dict(AGENT)
    finished(env)
    report = status.build_report(env.store.home, env.clock())
    detail = report["usage_detail"]
    assert detail["total"]["input_tokens"] == 24000 and detail["total"]["output_tokens"] == 1600
    assert detail["total"]["counts"] == {"agent_estimate": 2, "size_estimate": 0, "no_data": 0} and list(detail["plans"]) == ["fx"]
    assert {r["name"] for r in detail["total"]["by_role"]} == {"implementer", "reviewer"} and sum(r["attempts"] for r in detail["total"]["by_model"]) == 2
    assert report["usage"].startswith("estimated: ~24.0k input and ~1.6k output tokens over 2 attempts (2 agent estimates, 0 size-only")
    assert report["budgets"]["fx"]["tokens_and_cost"] == "~24.0k in / ~1.6k out tokens (estimate)"
    json.dumps(report)  # the dashboard serves this
    text = status.render(report)
    assert "usage: estimated" in text and "never from the runtime" in text and "claude-haiku-4.5: ~12.0k in" in text


def test_the_report_stays_unavailable_when_no_attempt_has_any_estimate(tmp_path):
    env = Env(tmp_path)
    finished(env)
    report = status.build_report(env.store.home, env.clock())
    assert report["usage"].startswith("unavailable") and report["budgets"]["fx"]["tokens_and_cost"] == "unavailable"
    assert report["usage_detail"]["total"]["counts"]["no_data"] == 2


def test_a_plan_filter_keeps_only_that_plans_usage(tmp_path):
    env = Env(tmp_path)
    env.adapter.agent_usage = dict(AGENT)
    finished(env)
    other = status.filter_plan(status.build_report(env.store.home, env.clock()), "fx")
    assert other["usage_detail"]["total"]["attempts"] == 2 and other["usage"].startswith("estimated")
    unknown = status.filter_plan(status.build_report(env.store.home, env.clock()), "nope")
    assert unknown["usage"].startswith("estimated")  # no such plan, so the overall figure is left alone


def test_the_issue_view_shows_each_attempts_estimate(tmp_path):
    env = Env(tmp_path)
    env.adapter.agent_usage = dict(AGENT)
    finished(env)
    shown = status.render_issue(status.issue_detail(env.store.home, "i1"))
    assert shown.count("~12.0k in / ~800 out (agent estimate)") == 2


# -- cost, only from prices the owner supplies --------------------------------------------------------------------

def write_prices(env, doc):
    with open(os.path.join(env.store.home, usage.PRICE_FILE), "w") as fh:
        fh.write(doc if isinstance(doc, str) else json.dumps(doc))


def test_cost_is_unavailable_without_a_price_file_and_says_how_to_add_one(tmp_path):
    env = Env(tmp_path)
    env.adapter.agent_usage = dict(AGENT)
    finished(env)
    cost = status.build_report(env.store.home, env.clock())["usage_detail"]["total"]["cost"]
    assert cost["status"] == "unavailable" and cost["value"] is None and usage.PRICE_FILE in cost["reason"]
    assert "cost unavailable" in status.build_report(env.store.home, env.clock())["usage"]


def test_cost_uses_the_owners_prices_and_flags_models_without_one(tmp_path):
    env = Env(tmp_path)
    env.adapter.agent_usage = {"input_tokens": 1_000_000, "output_tokens": 200_000}
    finished(env)
    write_prices(env, {"unit": "USD", "models": {"claude-haiku-4.5": {"per_million_input": 1.0, "per_million_output": 5.0}}})
    report = status.build_report(env.store.home, env.clock())
    cost = report["usage_detail"]["total"]["cost"]
    assert cost["status"] == "estimate" and cost["unit"] == "USD" and cost["unpriced_models"] == ["claude-sonnet-5"]
    assert cost["value"] == 2.0  # only the haiku attempt is priced: 1 USD of input and 1 USD of output
    assert "cost ~USD 2.00; no price for claude-sonnet-5" in report["usage"]


def test_a_per_attempt_price_covers_request_based_billing(tmp_path):
    env = Env(tmp_path)
    finished(env)
    write_prices(env, {"unit": "premium requests", "models": {"claude-haiku-4.5": {"per_attempt": 0.33}, "claude-sonnet-5": {"per_attempt": 1}}})
    cost = status.build_report(env.store.home, env.clock())["usage_detail"]["total"]["cost"]
    assert cost["value"] == 1.33 and cost["unit"] == "premium requests" and cost["unpriced_models"] == []


@pytest.mark.parametrize("doc, message", [
    ("not json", "invalid"), ({"models": {}}, "invalid"), ({"unit": "USD", "models": {"m": {"per_million_input": -1}}}, "invalid"),
    ({"unit": "USD", "models": {"m": {}}}, "invalid"), ({"unit": "USD", "models": {"m": {"per_million_input": "x"}}}, "invalid"),
])
def test_an_invalid_price_file_is_reported_and_ignored(tmp_path, doc, message):
    env = Env(tmp_path)
    write_prices(env, doc)
    prices = usage.load_prices(env.store.home)
    assert prices["status"] == "unavailable" and message in prices["reason"] and prices["models"] == {}


# -- contracts ----------------------------------------------------------------------------------------------------------

def test_every_worker_is_asked_for_an_estimate():
    for role in ("implementer", "reviewer", "refiner", "delegator", "analyst"):
        prompt = build_prompt(WorkRequest("a#1", 1, "i", role, "low", None, {}, "b"))
        assert '"usage_estimate"' in prompt and "rough estimate of the tokens" in prompt


def test_the_dashboard_script_and_page_show_the_estimate():
    root = os.path.join(os.path.dirname(__file__), "..")
    script, page = open(os.path.join(root, "gui_page.js")).read(), open(os.path.join(root, "gui_page.html")).read()
    assert "tokensText(attempt)" in script and 'byId("usage-note")' in script and 'id="usage-note"' in page
