import copy
import json
import os

import pytest

from harness import cli, models, plans, schemas
from harness_doubles import FIX, REQ

PHASES = os.path.join(FIX, "phases.json")


def draft_phases():
    with open(PHASES, encoding="utf-8") as fh:
        return json.load(fh)["phases"]


def plan_with(sources, **kw):
    return plans.build_plan("d", 1, plans.parse_requirements(REQ), draft_phases(), fixture=True, model_sources=sources, **kw)


# -- the catalog and the menu -------------------------------------------------------------------------

def test_the_default_policy_is_the_copilot_menu():
    assert plans.DEFAULT_POLICY["model_sources"] == ["copilot"]
    assert plans.DEFAULT_POLICY["model_tiers"] == models.menu_for(["copilot"])


def test_sources_combine_into_one_menu_without_duplicates():
    menu = models.menu_for(["deepseek", "local"])
    assert menu["strong"] == ["deepseek/deepseek-v4-pro", "ollama-models/gemma4:cloud"]
    assert menu["low"][0] == "deepseek/deepseek-flash" and "ollama-models/qwen3:4b" in menu["low"]
    assert models.menu_for(["deepseek", "deepseek"]) == models.menu_for(["deepseek"])
    assert models.menu_for(["local", "deepseek"])["strong"] == ["ollama-models/gemma4:cloud", "deepseek/deepseek-v4-pro"]  # source order


def test_an_empty_or_unknown_source_is_rejected():
    with pytest.raises(ValueError, match="at least one"):
        models.menu_for([])
    with pytest.raises(ValueError, match="unknown model source"):
        models.menu_for(["mainframe"])


def test_a_store_catalog_replaces_one_source_tier(tmp_path):
    (tmp_path / models.CATALOG_FILE).write_text(json.dumps({"local": {"strong": ["my-local-strong"]}}))
    catalog = models.load_catalog(str(tmp_path))
    assert catalog["local"]["strong"] == ["my-local-strong"]
    assert catalog["local"]["low"] == models.MODEL_CATALOG["local"]["low"]
    assert catalog["copilot"] == models.MODEL_CATALOG["copilot"]
    assert models.menu_for(["local"], catalog)["strong"] == ["my-local-strong"]


def test_a_store_catalog_with_an_unknown_source_is_rejected(tmp_path):
    (tmp_path / models.CATALOG_FILE).write_text(json.dumps({"mainframe": {"low": ["x"]}}))
    with pytest.raises(schemas.SchemaError, match="unknown keys"):
        models.load_catalog(str(tmp_path))


# -- the plan policy ----------------------------------------------------------------------------------

def test_the_plan_binds_the_sources_and_derives_the_menu():
    copilot, local = plan_with(["copilot"]), plan_with(["local"])
    assert local["policy"]["model_sources"] == ["local"]
    assert local["policy"]["model_tiers"] == models.menu_for(["local"])
    assert not plans.validate_plan(local)
    assert plans.plan_digest(local) != plans.plan_digest(copilot)  # approval covers the menu


def test_validate_plan_rejects_unknown_and_empty_tiers():
    unknown = plan_with(["local"])
    unknown["policy"]["model_sources"] = ["mainframe"]
    assert any("unknown sources" in problem for problem in plans.validate_plan(unknown))
    empty = plan_with(["local"])
    empty["policy"]["model_tiers"] = {"low": [], "standard": ["x"], "strong": ["x"]}
    assert any("empty tier" in problem for problem in plans.validate_plan(empty))
    blank = plan_with(["local"])
    blank["policy"]["model_sources"] = []
    assert any("is empty" in problem for problem in plans.validate_plan(blank))


# -- the command line ---------------------------------------------------------------------------------

def test_the_plan_takes_the_source_choice_from_the_investigator_draft(tmp_path):
    phases = tmp_path / "phases.json"
    phases.write_text(json.dumps({"phases": draft_phases(), "model_sources": ["deepseek", "local"]}))
    result = cli.plan_command(None, REQ, str(phases), plan_id="d", fixture=True, dry_run=True)
    assert result["model_sources"] == ["deepseek", "local"] and result["state"] == "Proposed" and not result["problems"]


def test_an_explicit_choice_overrides_the_draft(tmp_path, capsys):
    phases = tmp_path / "phases.json"
    phases.write_text(json.dumps({"phases": draft_phases(), "model_sources": ["deepseek", "local"]}))
    home = tmp_path / "home"
    home.mkdir()
    rc = cli.main(["--home", str(home), "plan", "--requirements", REQ, "--phases", str(phases), "--fixture", "--dry-run",
                   "--model-source", "deepseek", "--model-source", "local"])
    assert rc == 0
    assert json.loads(capsys.readouterr().out)["model_sources"] == ["deepseek", "local"]


def test_the_cli_rejects_an_unknown_source(tmp_path):
    with pytest.raises(SystemExit) as exc:
        cli.main(["--home", str(tmp_path), "plan", "--requirements", REQ, "--phases", PHASES, "--model-source", "mainframe"])
    assert exc.value.code == 2


def test_the_plan_without_a_draft_choice_keeps_copilot():
    result = cli.plan_command(None, REQ, PHASES, plan_id="d", fixture=True, dry_run=True)
    assert result["model_sources"] == ["copilot"]


def test_a_policy_without_sources_still_builds():
    policy = copy.deepcopy(plans.DEFAULT_POLICY)
    policy.pop("model_sources")  # plans approved before model sources existed
    plan = plans.build_plan("d", 1, plans.parse_requirements(REQ), draft_phases(), policy, fixture=True)
    assert "model_sources" not in plan["policy"] and not plans.validate_plan(plan)


def test_a_store_catalog_changes_the_default_menu_of_a_new_plan(tmp_path):
    (tmp_path / models.CATALOG_FILE).write_text(json.dumps({"copilot": {"low": ["my-copilot-low"]}}))
    plan = plans.build_plan("d", 1, plans.parse_requirements(REQ), draft_phases(), fixture=True,
                            catalog=models.load_catalog(str(tmp_path)))
    assert plan["policy"]["model_sources"] == ["copilot"]  # no flag needed: the catalog adjusts the default source
    assert plan["policy"]["model_tiers"]["low"] == ["my-copilot-low"]
    assert plan["policy"]["model_tiers"]["strong"] == models.MODEL_CATALOG["copilot"]["strong"]
    assert not plans.validate_plan(plan)


# -- the operator's standing source choice -------------------------------------------------------------

def test_no_operator_default_leaves_the_policy_default(monkeypatch):
    monkeypatch.delenv(models.SOURCES_ENV, raising=False)
    monkeypatch.delenv(models.DASHBOARD_SOURCES_ENV, raising=False)
    assert models.operator_sources() is None
    assert cli.model_sources_arg(None) is None


def test_the_operator_default_wires_every_new_run_to_deepseek(monkeypatch):
    monkeypatch.setenv(models.SOURCES_ENV, "deepseek,copilot")
    monkeypatch.delenv(models.DASHBOARD_SOURCES_ENV, raising=False)
    assert cli.model_sources_arg(None) == ["deepseek", "copilot"]
    policy = plans.with_model_sources(plans.DEFAULT_POLICY, cli.model_sources_arg(None), models.load_catalog(None))
    assert policy["model_sources"] == ["deepseek", "copilot"]
    assert "deepseek/deepseek-v4-pro" in policy["model_tiers"]["strong"]
    assert not plans.validate_plan(plans.build_plan("d", 1, plans.parse_requirements(REQ), draft_phases(), policy, fixture=True))


def test_an_explicit_flag_beats_the_operator_default(monkeypatch):
    monkeypatch.setenv(models.SOURCES_ENV, "deepseek")
    assert cli.model_sources_arg(["copilot"]) == ["copilot"]


def test_the_dashboard_key_is_the_fallback_and_unknown_names_are_dropped(monkeypatch):
    monkeypatch.delenv(models.SOURCES_ENV, raising=False)
    monkeypatch.setenv(models.DASHBOARD_SOURCES_ENV, "deepseek, mainframe")
    assert models.operator_sources() == ["deepseek"]
    monkeypatch.setenv(models.SOURCES_ENV, "mainframe")
    assert models.operator_sources() == ["deepseek"]
    monkeypatch.delenv(models.DASHBOARD_SOURCES_ENV, raising=False)
    assert models.operator_sources() is None
