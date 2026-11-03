"""A validation command must be able to fail; a trailing `|| true` makes the check meaningless."""

import os
import subprocess

import pytest

from harness import plans


@pytest.mark.parametrize("command", [
    'cd sites/lesen && node --test tests/*.test.mjs || true',
    'node --test tests/a.test.mjs || :',
    'node --test tests/a.test.mjs; true',
    'node --test tests/a.test.mjs || exit 0',
    'node --test tests/a.test.mjs ||   true   ',
])
def test_a_check_that_swallows_failure_is_refused(command):
    problem = plans.command_problem(command)

    assert problem and "can never report a failure" in problem


@pytest.mark.parametrize("command", [
    'node --test tests/a.test.mjs',
    'node --test tests/a.test.mjs && node tools/build.mjs --check',
    'node --test tests/a.test.mjs || echo "checks failed"',
])
def test_a_check_that_can_fail_is_accepted(command):
    assert plans.command_problem(command) is None


# -- a greenfield plan may name files its own workers create -------------------------------------------

from harness import checks, isolation  # noqa: E402

ALLOW = ["apps/arithmoslayer/project.godot", "apps/arithmoslayer/tools/validate_data.py",
         "apps/arithmoslayer/scripts/"]


def test_a_command_naming_a_planned_path_is_not_a_configuration_error():
    assert checks._names_planned_path("python3 tools/validate_data.py", "apps/arithmoslayer", ALLOW)
    assert checks._names_planned_path("godot-test apps/arithmoslayer", ".", ALLOW)
    assert not checks._names_planned_path("python3 tools/other.py", "apps/arithmoslayer", ALLOW)
    assert not checks._names_planned_path("godot-test apps/lesen", ".", ALLOW)
    assert not checks._names_planned_path("python3 tools/validate_data.py", "apps/arithmoslayer", [])


def test_a_working_directory_the_plan_will_create_is_not_a_configuration_error():
    assert checks._planned_directory("apps/arithmoslayer", ALLOW)
    assert checks._planned_directory(".", ALLOW)
    assert not checks._planned_directory("sites/ffm", ALLOW)
    assert not checks._planned_directory("apps/arithmoslayer", [])


@pytest.mark.skipif(not (isolation.docker_available() and isolation.image_id()), reason="needs the worker image")
def test_preflight_separates_a_missing_tool_from_a_file_the_plan_creates(tmp_path):
    repo = tmp_path / "repo"
    (repo / "apps").mkdir(parents=True)
    (repo / "README.md").write_text("probe\n")
    from harness.repo import GitRepo
    subprocess.run(["git", "init", "-q", "-b", "main"], cwd=str(repo), check=True)
    subprocess.run(["git", "-C", str(repo), "-c", "user.email=a@b", "-c", "user.name=a", "add", "."], check=True)
    subprocess.run(["git", "-C", str(repo), "-c", "user.email=a@b", "-c", "user.name=a", "commit", "-qm", "base"], check=True)
    checker = checks.SandboxChecker(GitRepo(str(repo), "main"), os.path.join(str(tmp_path), "token"))
    results = checker.preflight("main", [
        {"command": "python3 apps/arithmoslayer/tools/validate_data.py", "working_directory": ".",
         "allowlist": ["apps/arithmoslayer/tools/validate_data.py"]},
        {"command": "definitely-not-a-tool --version", "working_directory": ".", "allowlist": ALLOW},
        {"command": "python3 tools/nothing.py", "working_directory": ".", "allowlist": ALLOW},
    ])
    kinds = {r["command"]: r["kind"] for r in results}
    assert kinds["python3 apps/arithmoslayer/tools/validate_data.py"] == "check"
    assert kinds["definitely-not-a-tool --version"] == "configuration"
    assert kinds["python3 tools/nothing.py"] == "configuration"  # outside the plan: still a config error


def test_preflight_runs_each_distinct_command_once(tmp_path, monkeypatch):
    """Fifty issues that repeat four commands must not pay for two hundred sandbox runs."""
    from harness.repo import GitRepo
    repo = tmp_path / "repo"
    (repo / "sub").mkdir(parents=True)
    (repo / "sub" / "keep.txt").write_text("kept\n")
    (repo / "README.md").write_text("probe\n")
    subprocess.run(["git", "init", "-q", "-b", "main"], cwd=str(repo), check=True)
    subprocess.run(["git", "-C", str(repo), "-c", "user.email=a@b", "-c", "user.name=a", "add", "."], check=True)
    subprocess.run(["git", "-C", str(repo), "-c", "user.email=a@b", "-c", "user.name=a", "commit", "-qm", "base"], check=True)
    runs = []

    class Done:
        returncode, stdout, stderr = 0, "", ""

    def fake_docker(args, timeout=120, env=None, input_text=None):
        runs.append(args)
        return Done()

    monkeypatch.setattr(checks.isolation, "_docker", fake_docker)
    checker = checks.SandboxChecker(GitRepo(str(repo), "main"), str(tmp_path / "token"))
    checks_in = [{"command": "true", "working_directory": "."}, {"command": "true", "working_directory": "."},
                 {"command": "true", "working_directory": "sub"}, {"command": "false", "working_directory": "."}]
    results = checker.preflight("main", checks_in)
    assert [r["command"] for r in results] == ["true", "true", "true", "false"]
    assert len(runs) == 3, runs
