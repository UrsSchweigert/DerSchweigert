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

def test_the_default_policy_is_the_claude_subscription_menu():
    assert models.SOURCES == ("claude",)
    assert plans.DEFAULT_POLICY["model_sources"] == ["claude"]
    assert plans.DEFAULT_POLICY["model_tiers"] == models.menu_for(["claude"])


def test_a_repeated_source_makes_one_menu_without_duplicates():
    assert models.menu_for(["claude", "claude"]) == models.menu_for(["claude"])
    assert models.menu_for(["claude"])["strong"] == ["claude-opus-5-5"]


@pytest.mark.parametrize("retired", ["copilot", "deepseek", "local"])
def test_the_retired_sources_are_refused(retired):
    with pytest.raises(ValueError, match="unknown model source"):
        models.menu_for([retired])


def test_an_empty_or_unknown_source_is_rejected():
    with pytest.raises(ValueError, match="at least one"):
        models.menu_for([])
    with pytest.raises(ValueError, match="unknown model source"):
        models.menu_for(["mainframe"])


def test_a_store_catalog_replaces_one_source_tier(tmp_path):
    (tmp_path / models.CATALOG_FILE).write_text(json.dumps({"claude": {"strong": ["claude-opus-4-8"]}}))
    catalog = models.load_catalog(str(tmp_path))
    assert catalog["claude"]["strong"] == ["claude-opus-4-8"]
    assert catalog["claude"]["low"] == models.MODEL_CATALOG["claude"]["low"]
    assert models.menu_for(["claude"], catalog)["strong"] == ["claude-opus-4-8"]


def test_a_store_catalog_for_a_retired_source_is_ignored(tmp_path):
    (tmp_path / models.CATALOG_FILE).write_text(json.dumps({"deepseek": {"low": ["deepseek/deepseek-flash"]}}))
    assert models.load_catalog(str(tmp_path)) == models.MODEL_CATALOG
    (tmp_path / models.CATALOG_FILE).write_text(json.dumps({"local": {"low": ["x"]}, "claude": {"low": ["haiku"]}}))
    assert models.load_catalog(str(tmp_path))["claude"]["low"] == ["haiku"]


def test_a_store_catalog_with_an_unknown_source_is_rejected(tmp_path):
    (tmp_path / models.CATALOG_FILE).write_text(json.dumps({"mainframe": {"low": ["x"]}}))
    with pytest.raises(schemas.SchemaError, match="unknown keys"):
        models.load_catalog(str(tmp_path))


# -- the plan policy ----------------------------------------------------------------------------------

def test_the_plan_binds_the_sources_and_derives_the_menu():
    plan = plan_with(["claude"])
    assert plan["policy"]["model_sources"] == ["claude"]
    assert plan["policy"]["model_tiers"] == models.menu_for(["claude"])
    assert not plans.validate_plan(plan)
    changed = copy.deepcopy(plan)
    changed["policy"]["model_tiers"]["strong"] = ["claude-opus-4-8"]
    assert plans.plan_digest(plan) != plans.plan_digest(changed)  # approval covers the menu


def test_validate_plan_rejects_unknown_and_empty_tiers():
    unknown = plan_with(["claude"])
    unknown["policy"]["model_sources"] = ["copilot"]
    assert any("unknown sources" in problem for problem in plans.validate_plan(unknown))
    empty = plan_with(["claude"])
    empty["policy"]["model_tiers"] = {"low": [], "standard": ["x"], "strong": ["x"]}
    assert any("empty tier" in problem for problem in plans.validate_plan(empty))
    blank = plan_with(["claude"])
    blank["policy"]["model_sources"] = []
    assert any("is empty" in problem for problem in plans.validate_plan(blank))


# -- the command line ---------------------------------------------------------------------------------

def test_the_plan_takes_the_source_choice_from_the_investigator_draft(tmp_path):
    phases = tmp_path / "phases.json"
    phases.write_text(json.dumps({"phases": draft_phases(), "model_sources": ["claude"]}))
    result = cli.plan_command(None, REQ, str(phases), plan_id="d", fixture=True, dry_run=True)
    assert result["model_sources"] == ["claude"] and result["state"] == "Proposed" and not result["problems"]


def test_an_explicit_choice_overrides_the_draft(tmp_path, capsys):
    phases = tmp_path / "phases.json"
    phases.write_text(json.dumps({"phases": draft_phases()}))
    home = tmp_path / "home"
    home.mkdir()
    rc = cli.main(["--home", str(home), "plan", "--requirements", REQ, "--phases", str(phases), "--fixture", "--dry-run",
                   "--model-source", "claude"])
    assert rc == 0
    assert json.loads(capsys.readouterr().out)["model_sources"] == ["claude"]


def test_the_cli_rejects_an_unknown_source(tmp_path):
    with pytest.raises(SystemExit) as exc:
        cli.main(["--home", str(tmp_path), "plan", "--requirements", REQ, "--phases", PHASES, "--model-source", "copilot"])
    assert exc.value.code == 2


def test_the_plan_without_a_draft_choice_uses_claude():
    result = cli.plan_command(None, REQ, PHASES, plan_id="d", fixture=True, dry_run=True)
    assert result["model_sources"] == ["claude"]


def test_a_policy_without_sources_still_builds():
    policy = copy.deepcopy(plans.DEFAULT_POLICY)
    policy.pop("model_sources")  # plans approved before model sources existed
    plan = plans.build_plan("d", 1, plans.parse_requirements(REQ), draft_phases(), policy, fixture=True)
    assert "model_sources" not in plan["policy"] and not plans.validate_plan(plan)


def test_a_store_catalog_changes_the_default_menu_of_a_new_plan(tmp_path):
    (tmp_path / models.CATALOG_FILE).write_text(json.dumps({"claude": {"low": ["haiku"]}}))
    plan = plans.build_plan("d", 1, plans.parse_requirements(REQ), draft_phases(), fixture=True,
                            catalog=models.load_catalog(str(tmp_path)))
    assert plan["policy"]["model_sources"] == ["claude"]  # no flag needed: the catalog adjusts the default source
    assert plan["policy"]["model_tiers"]["low"] == ["haiku"]
    assert plan["policy"]["model_tiers"]["strong"] == models.MODEL_CATALOG["claude"]["strong"]
    assert not plans.validate_plan(plan)


# -- the operator's standing source choice -------------------------------------------------------------

def test_no_operator_default_leaves_the_policy_default(monkeypatch):
    monkeypatch.delenv(models.SOURCES_ENV, raising=False)
    monkeypatch.delenv(models.DASHBOARD_SOURCES_ENV, raising=False)
    assert models.operator_sources() is None
    assert cli.model_sources_arg(None) is None


def test_an_operator_default_naming_retired_sources_keeps_only_claude(monkeypatch):
    monkeypatch.setenv(models.SOURCES_ENV, "deepseek,claude,copilot")
    monkeypatch.delenv(models.DASHBOARD_SOURCES_ENV, raising=False)
    assert cli.model_sources_arg(None) == ["claude"]
    policy = plans.with_model_sources(plans.DEFAULT_POLICY, cli.model_sources_arg(None), models.load_catalog(None))
    assert policy["model_sources"] == ["claude"]
    assert "claude-opus-5-5" in policy["model_tiers"]["strong"]
    assert not plans.validate_plan(plans.build_plan("d", 1, plans.parse_requirements(REQ), draft_phases(), policy, fixture=True))


def test_an_explicit_flag_beats_the_operator_default(monkeypatch):
    monkeypatch.setenv(models.SOURCES_ENV, "mainframe")
    assert cli.model_sources_arg(["claude"]) == ["claude"]


def test_the_dashboard_key_is_the_fallback_and_unknown_names_are_dropped(monkeypatch):
    monkeypatch.delenv(models.SOURCES_ENV, raising=False)
    monkeypatch.setenv(models.DASHBOARD_SOURCES_ENV, "claude, mainframe")
    assert models.operator_sources() == ["claude"]
    monkeypatch.setenv(models.SOURCES_ENV, "mainframe")
    assert models.operator_sources() == ["claude"]
    monkeypatch.delenv(models.DASHBOARD_SOURCES_ENV, raising=False)
    assert models.operator_sources() is None
