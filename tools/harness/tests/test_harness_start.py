import json
import os
from types import SimpleNamespace

import pytest

from harness import approval, models, plans, runner, start
from harness.store import Store
from harness_doubles import FIX, REQ

PHASES = json.load(open(os.path.join(FIX, "phases.json")))["phases"]
ISSUES = [
    {"issue_id": "fx-a", "phase_id": "P1", "requirement_ids": ["F1.1", "F1.2"], "title": "A", "outcomes": ["o"],
     "acceptance_criteria": ["a"], "non_goals": [], "code_anchors": ["tools/harness/fixtures/"], "contract_paths": [],
     "deps": [], "validation_commands": [], "parallel_safe": False},
    {"issue_id": "fx-b", "phase_id": "P2", "requirement_ids": ["F2.1"], "title": "B", "outcomes": ["o"],
     "acceptance_criteria": ["a"], "non_goals": [], "code_anchors": ["tools/harness/fixtures/"], "contract_paths": [],
     "deps": ["fx-a"], "validation_commands": [], "parallel_safe": False},
]


def args(**changes):
    base = dict(home=None, requirements=None, out=None, plan_id=None, tier="standard", model_source=None, repo=None, redraft=False)
    base.update(changes)
    return SimpleNamespace(**base)


class Script:
    """Answers prompts in order and records what was asked."""

    def __init__(self, *answers):
        self.answers, self.prompts = list(answers), []

    def __call__(self, prompt):
        self.prompts.append(prompt)
        return self.answers.pop(0) if self.answers else ""


class Commands:
    """Stands in for `cli.main`: writes the files and state the real commands would write."""

    def __init__(self, store: Store, tmp_path, make_plan_proposed=True):
        self.store, self.tmp_path, self.calls = store, tmp_path, []
        self.make_plan_proposed = make_plan_proposed

    def __call__(self, argv):
        self.calls.append(list(argv))
        if argv[0] == "investigate":
            out = argv[argv.index("--out") + 1]
            os.makedirs(out, exist_ok=True)
            json.dump({"phases": PHASES}, open(os.path.join(out, "phases.json"), "w"))
            json.dump({"issues": ISSUES}, open(os.path.join(out, "issues.json"), "w"))
        if argv[0] == "plan":
            plan_id = argv[argv.index("--plan-id") + 1]
            sources = [argv[i + 1] for i, value in enumerate(argv) if value == "--model-source"]
            plan = plans.build_plan(plan_id, 1, plans.parse_requirements(argv[argv.index("--requirements") + 1]),
                                    PHASES, fixture=True, model_sources=sources or None)
            self.store.put_plan(plan, plans.plan_digest(plan))
            if self.make_plan_proposed:
                self.store.transition("plan", approval.plan_entity(plan_id, 1), "Proposed", "fake")
        if argv[0] == "approve":
            version = int(argv[argv.index("--version") + 1])
            self.store.transition("plan", approval.plan_entity(argv[1], version), "Approved", "fake")
        if argv[0] == "import-issues":
            version = int(argv[argv.index("--version") + 1])
            runner.import_issues(self.store, argv[1], version, argv[2], "base1")
        return 0


@pytest.fixture
def home(tmp_path, monkeypatch):
    store_home = tmp_path / "home"
    store_home.mkdir()
    (store_home / "copilot.token").write_text("token")
    (store_home / "models.json").write_text(json.dumps({"checked_at": 1, "candidates": ["claude-haiku-4.5"],
                                                        "models": ["claude-haiku-4.5"]}))
    monkeypatch.setattr(start.isolation, "docker_available", lambda: True)
    monkeypatch.setattr(start.isolation, "image_id", lambda: "sha256:image")
    monkeypatch.setattr(start.approval, "detect_isolation", lambda store: {"tier": "A", "reason": ""})
    monkeypatch.setattr(start.subprocess, "run", lambda *a, **k: SimpleNamespace(returncode=0))
    return str(store_home)


def start_args(home, tmp_path, **changes):
    changes.setdefault("out", str(tmp_path / "draft"))
    changes.setdefault("model_source", ["copilot"])
    return args(home=home, **changes)


def commands_for(home, tmp_path, **kw):
    store = Store(home)
    return store, Commands(store, tmp_path, **kw)


# -- the catalogue of steps -----------------------------------------------------------------------------

def test_sources_accept_commas_spaces_and_pluses():
    assert start.parse_sources("deepseek, local", ["copilot"]) == ["deepseek", "local"]
    assert start.parse_sources("deepseek local", ["copilot"]) == ["deepseek", "local"]
    assert start.parse_sources("deepseek+local", ["copilot"]) == ["deepseek", "local"]
    assert start.parse_sources("  ", ["copilot"]) == ["copilot"]
    assert start.parse_sources("local, LOCAL", ["copilot"]) == ["local"]


def test_an_unknown_source_is_rejected():
    with pytest.raises(start.Stop, match="unknown model source"):
        start.parse_sources("mainframe", ["copilot"])


# -- the guided path ------------------------------------------------------------------------------------

def test_start_walks_from_requirements_to_imported_issues(home, tmp_path, capsys):
    store, commands = commands_for(home, tmp_path)
    script = Script("", "y", "y", "3")  # default sources, approve, import, stop before running
    try:
        code = start.run_start(start_args(home, tmp_path, requirements=REQ, model_source=None), ask=script, execute=commands)
        assert code == 0
        assert [call[0] for call in commands.calls] == ["investigate", "plan", "approve", "import-issues"]
        plan = store.get_plan("requirements-md")
        assert plan and store.state("plan", "requirements-md@v1") == "Approved"
        assert sorted(issue["issue_id"] for issue in store.list_issues("requirements-md")) == ["fx-a", "fx-b"]
        assert "start it later with: harness run requirements-md --version 1" in capsys.readouterr().out
    finally:
        store.close()


def test_the_chosen_sources_reach_investigate_and_the_plan(home, tmp_path):
    store, commands = commands_for(home, tmp_path)
    try:
        start.run_start(start_args(home, tmp_path, requirements=REQ), ask=Script("y", "y", "3"), execute=commands)
        investigate = next(call for call in commands.calls if call[0] == "investigate")
        plan = next(call for call in commands.calls if call[0] == "plan")
        assert investigate[investigate.index("--model-source") + 1] == "copilot"
        assert plan[plan.index("--model-source") + 1] == "copilot"
        assert store.get_plan("requirements-md")["plan"]["policy"]["model_sources"] == ["copilot"]
    finally:
        store.close()


def test_a_rejected_source_is_explained_and_asked_again(home, tmp_path, capsys, monkeypatch):
    # An operator default would skip the prompt this test exercises.
    monkeypatch.delenv(models.SOURCES_ENV, raising=False)
    monkeypatch.delenv(models.DASHBOARD_SOURCES_ENV, raising=False)
    store, commands = commands_for(home, tmp_path)
    try:
        code = start.run_start(start_args(home, tmp_path, requirements=REQ, model_source=None),
                               ask=Script("local", "copilot", "y", "y", "3"), execute=commands)
        assert code == 0
        out = capsys.readouterr().out
        assert "none of the local ids are accepted here" in out and "harness models --source local" in out
        plan = next(call for call in commands.calls if call[0] == "plan")
        assert plan[plan.index("--model-source") + 1] == "copilot"
    finally:
        store.close()


def test_start_resumes_an_approved_plan_without_repeating_the_work(home, tmp_path):
    store, commands = commands_for(home, tmp_path)
    try:
        plan = plans.build_plan("fx", 1, plans.parse_requirements(REQ), PHASES, fixture=True)
        store.put_plan(plan, plans.plan_digest(plan))
        store.transition("plan", "fx@v1", "Proposed", "t")
        store.transition("plan", "fx@v1", "Approved", "t")
        code = start.run_start(start_args(home, tmp_path, plan_id="fx"), ask=Script("1"), execute=commands)
        assert code == 0
        assert commands.calls == [["run", "fx", "--version", "1"]]
    finally:
        store.close()


def test_the_dashboard_can_start_the_run_instead(home, tmp_path):
    store, commands = commands_for(home, tmp_path)
    try:
        plan = plans.build_plan("fx", 1, plans.parse_requirements(REQ), PHASES, fixture=True)
        store.put_plan(plan, plans.plan_digest(plan))
        store.transition("plan", "fx@v1", "Proposed", "t")
        store.transition("plan", "fx@v1", "Approved", "t")
        start.run_start(start_args(home, tmp_path, plan_id="fx"), ask=Script("2"), execute=commands)
        assert commands.calls == [["gui"]]
    finally:
        store.close()


def test_declining_approval_stops_before_importing(home, tmp_path):
    store, commands = commands_for(home, tmp_path)
    try:
        code = start.run_start(start_args(home, tmp_path, requirements=REQ), ask=Script("n"), execute=commands)
        assert code == 2
        assert [call[0] for call in commands.calls] == ["investigate", "plan"]
        assert store.state("plan", "requirements-md@v1") == "Proposed"
        assert store.list_issues("requirements-md") == []
    finally:
        store.close()


def test_an_invalid_draft_stops_with_the_problems(home, tmp_path):
    store, commands = commands_for(home, tmp_path, make_plan_proposed=False)
    try:
        code = start.run_start(start_args(home, tmp_path, requirements=REQ), ask=Script(), execute=commands)
        assert code == 2
        assert [call[0] for call in commands.calls] == ["investigate", "plan"]
    finally:
        store.close()


def test_missing_docker_stops_before_any_step(home, tmp_path, monkeypatch, capsys):
    monkeypatch.setattr(start.isolation, "docker_available", lambda: False)
    store, commands = commands_for(home, tmp_path)
    try:
        code = start.run_start(start_args(home, tmp_path, requirements=REQ), ask=Script(), execute=commands)
        assert code == 2 and commands.calls == []
        assert "Docker is not available" in capsys.readouterr().err
    finally:
        store.close()


def test_an_unverified_sandbox_is_verified_on_request(home, tmp_path, monkeypatch):
    tiers = iter([{"tier": "B", "reason": "attestation expired"}, {"tier": "A", "reason": "ok"}])
    monkeypatch.setattr(start.approval, "detect_isolation", lambda store: next(tiers))
    store, commands = commands_for(home, tmp_path)
    try:
        code = start.run_start(start_args(home, tmp_path, requirements=REQ), ask=Script("y", "y", "y", "3"), execute=commands)
        assert code == 0
        assert commands.calls[0] == ["isolation", "verify"]
        assert [call[0] for call in commands.calls[1:]] == ["investigate", "plan", "approve", "import-issues"]
    finally:
        store.close()


def test_a_missing_requirements_file_is_reported(home, tmp_path, capsys):
    store, commands = commands_for(home, tmp_path)
    try:
        code = start.run_start(start_args(home, tmp_path, requirements=str(tmp_path / "nope.md")), ask=Script(), execute=commands)
        assert code == 2 and "does not exist" in capsys.readouterr().err
    finally:
        store.close()


def test_a_completed_plan_is_reported_and_not_restarted(home, tmp_path, capsys):
    store, commands = commands_for(home, tmp_path)
    try:
        plan = plans.build_plan("fx", 1, plans.parse_requirements(REQ), PHASES, fixture=True)
        store.put_plan(plan, plans.plan_digest(plan))
        for state in ("Proposed", "Approved", "Executing", "Completed"):
            store.transition("plan", "fx@v1", state, "t")
        assert start.run_start(start_args(home, tmp_path, plan_id="fx"), ask=Script(), execute=commands) == 0
        assert commands.calls == [] and "already completed" in capsys.readouterr().out
    finally:
        store.close()


def test_missing_answers_stop_with_a_clear_message(home, tmp_path, capsys):
    store, commands = commands_for(home, tmp_path)

    def no_input(prompt):
        raise EOFError

    try:
        code = start.run_start(start_args(home, tmp_path, requirements=REQ, model_source=None), ask=no_input, execute=commands)
        assert code == 2 and "needs answers" in capsys.readouterr().err
    finally:
        store.close()
