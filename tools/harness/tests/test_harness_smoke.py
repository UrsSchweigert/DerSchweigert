import os
import pathlib
import shutil
import subprocess

import pytest

from harness import isolation, smoke
from harness.tests.harness_doubles import Env

RULES = [{"name": "page", "paths": ["sites/lesen/static/"], "command": "node smoke.mjs ."}]
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))


def test_rule_applies_only_to_files_under_its_paths():
    assert smoke.commands_for(["sites/lesen/static/index.html"], RULES) == ["node smoke.mjs ."]
    assert smoke.commands_for(["sites/lesen/static/a/b.mjs", "x.py"], RULES) == ["node smoke.mjs ."]
    assert smoke.commands_for(["sites/lesen/package.json", "tools/x.py"], RULES) == []


def test_phase_allowlist_overlap_in_either_direction():
    assert smoke.commands_for_allowlist(["sites/lesen/"], RULES) == ["node smoke.mjs ."]
    assert smoke.commands_for_allowlist(["sites/lesen/static/index.html"], RULES) == ["node smoke.mjs ."]
    assert smoke.commands_for_allowlist(["tools/"], RULES) == []


def test_merge_does_not_duplicate():
    assert smoke.merge(["a", "node smoke.mjs ."], ["node smoke.mjs .", "b"]) == ["a", "node smoke.mjs .", "b"]


def test_shipped_rules_load():
    assert smoke.load_rules()


def test_smoke_runs_before_and_after_merge_for_changed_files_it_covers(tmp_path):
    env = Env(tmp_path, issues=[], allowlist=("src/",))
    env.sched.smoke_rules = [{"name": "any", "paths": ["src/"], "command": "node smoke.mjs ."}]
    env.add_issue("i1", "P1", ["F1.1"], validation_commands=["unit"])
    env.start()
    env.run_until(lambda: env.state("i1") == "Done")
    assert env.checker.commands_run[0] == ["unit", "node smoke.mjs ."]
    assert env.checker.commands_run[1] == ["unit", "node smoke.mjs ."]


def test_smoke_is_skipped_for_files_no_rule_covers(tmp_path):
    env = Env(tmp_path, issues=[], allowlist=("src/",))
    env.sched.smoke_rules = RULES
    env.add_issue("i1", "P1", ["F1.1"], validation_commands=["unit"])
    env.start()
    env.run_until(lambda: env.state("i1") == "Done")
    assert all(c == ["unit"] for c in env.checker.commands_run[:2])


def test_a_failing_browser_check_blocks_and_its_output_reaches_the_repair_attempt(tmp_path):
    env = Env(tmp_path, issues=[], allowlist=("src/",))
    env.sched.smoke_rules = [{"name": "any", "paths": ["src/"], "command": "node smoke.mjs ."}]
    env.add_issue("i1", "P1", ["F1.1"], validation_commands=["unit"])
    env.checker.fail_commands = {"node smoke.mjs ."}
    env.checker.outputs["node smoke.mjs ."] = "FAIL: the specials group has 0 letter buttons"
    env.start()
    env.run_until(lambda: any("0 letter buttons" in (f.get("detail") or "") for f in env.store.get_issue("i1").get("last_failures", [])))


@pytest.mark.skipif(not (isolation.docker_available() and isolation.image_id()), reason="needs the worker image")
@pytest.mark.parametrize("commit,expect_ok", [("849c734", True), ("d9c092e", False)])
def test_real_browser_check_separates_the_fixed_and_the_broken_page(tmp_path, commit, expect_ok):
    probe = subprocess.run(["docker", "run", "--rm", isolation.IMAGE, "sh", "-c", "ls /opt/pw-browsers"], capture_output=True, text=True)
    if probe.returncode != 0 or "chromium" not in probe.stdout:
        pytest.skip("image has no browser")
    if subprocess.run(["git", "cat-file", "-e", commit], cwd=ROOT, capture_output=True).returncode != 0:
        pytest.skip("commit not available")
    d = os.path.join(os.path.expanduser("~"), ".cache", "harness-smoke-test-" + commit)  # must be under a Docker-shared path
    shutil.rmtree(d, ignore_errors=True)
    os.makedirs(d)
    try:
        archive = subprocess.run(["git", "archive", commit, "sites/lesen/static"], cwd=ROOT, capture_output=True, check=True)
        subprocess.run(["tar", "-x", "-C", d], input=archive.stdout, check=True)
        subprocess.run(["chmod", "-R", "a+rX", d], check=True)
        r = subprocess.run(["docker", "run", "--rm", "--cap-drop", "ALL", "--read-only", "--tmpfs", "/tmp:rw,size=256m", "--user", "10001", "-v", d + ":/w:ro", "-w", "/w",
                            isolation.IMAGE, "node", "/opt/harness/smoke/lesen.mjs", "."], capture_output=True, text=True, timeout=240)
        assert (r.returncode == 0) is expect_ok, r.stdout
    finally:
        shutil.rmtree(d, ignore_errors=True)


def test_status_can_be_limited_to_one_plan():
    from harness import status
    report = {"plans": [{"plan_id": "a"}, {"plan_id": "b"}], "phases": [{"plan_id": "a"}, {"plan_id": "b"}], "requirements": [{"plan_id": "b"}],
              "budgets": {"a": 1, "b": 2}, "issues": [{"issue_id": "x", "plan_id": "a"}, {"issue_id": "y", "plan_id": "b"}],
              "queue": [{"issue_id": "x"}, {"issue_id": "y"}], "blockers": [], "failures": [], "evidence": [], "workers": [{"issue": "y"}], "human_tasks": []}
    out = status.filter_plan(report, "b")
    assert [p["plan_id"] for p in out["plans"]] == ["b"] and out["budgets"] == {"b": 2}
    assert [i["issue_id"] for i in out["issues"]] == ["y"] and out["queue"] == [{"issue_id": "y"}] and out["workers"] == [{"issue": "y"}]


def test_the_real_rule_names_the_repository_root_absolutely():
    """A phase may set a working_directory, and every command is prefixed with `cd /work/<dir> &&`.
    A relative argument would therefore resolve against that subdirectory; the script wants the repo root."""
    rules = smoke.load_rules()
    assert rules, "smoke.json has no rules"
    for rule in rules:
        command = rule["command"]
        assert " /work" in command and " ." not in command, (
            "smoke rule %r must pass an absolute repository root, not '.': %r" % (rule["name"], command))


# -- the Godot project rule ---------------------------------------------------------------------------------

def test_the_shipped_rules_cover_the_godot_app_and_nothing_else():
    rules = smoke.load_rules()
    assert smoke.commands_for(["apps/arithmoslayer/project.godot"], rules) == \
        ["sh /opt/harness/smoke/godot_project.sh /work apps/arithmoslayer"]
    assert smoke.commands_for(["apps/arithmoslayer"], rules) == \
        ["sh /opt/harness/smoke/godot_project.sh /work apps/arithmoslayer"]
    assert smoke.commands_for(["apps/other/project.godot"], rules) == []
    assert smoke.commands_for_allowlist(["apps/arithmoslayer/"], rules) == \
        ["sh /opt/harness/smoke/godot_project.sh /work apps/arithmoslayer"]


@pytest.mark.skipif(not (isolation.docker_available() and isolation.image_id()), reason="needs the worker image")
@pytest.mark.parametrize("broken", [False, True])
def test_the_real_godot_check_separates_a_working_project_from_a_broken_one(tmp_path, broken):
    project = pathlib.Path(os.path.expanduser("~/.cache/harness-godot-smoke-%s-%s" % (os.getpid(), broken)))  # must be under a Docker-shared path

    (project / "apps/arithmoslayer/scenes").mkdir(parents=True)
    (project / "apps/arithmoslayer/scripts").mkdir(parents=True)
    (project / "apps/arithmoslayer/project.godot").write_text(
        'config_version=5\n\n[application]\n\nconfig/name="probe"\nrun/main_scene="res://scenes/main.tscn"\n')
    (project / "apps/arithmoslayer/scenes/main.tscn").write_text(
        '[gd_scene load_steps=2 format=3]\n\n[ext_resource type="Script" path="res://scripts/hero.gd" id="1"]\n\n'
        '[node name="Root" type="Node2D"]\nscript = ExtResource("1")\n')
    (project / "apps/arithmoslayer/scripts/hero.gd").write_text("extends Node2D\n\nfunc speed() -> int:\n\treturn 3\n")
    if broken:
        (project / "apps/arithmoslayer/scripts/broken.gd").write_text("extends Node2D\n\nfunc broken(:\n\tpass\n")
    subprocess.run(["chmod", "-R", "a+rX", str(project)], check=True)
    try:
        r = subprocess.run(["docker", "run", "--rm", "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--read-only",
                            "--tmpfs", "/tmp:rw,exec,size=256m", "--tmpfs", "/home/worker:rw,exec,uid=10001,gid=10001,size=512m",
                            "--user", "10001", "-v", str(project) + ":/w", "-w", "/w", isolation.IMAGE,
                            "sh", "/opt/harness/smoke/godot_project.sh", "/w", "apps/arithmoslayer"],
                           capture_output=True, text=True, timeout=600)
        assert (r.returncode == 0) is not broken, r.stdout + r.stderr
        assert ("OK: godot smoke test passed" in r.stdout) is not broken
        if broken:
            assert "scripts/broken.gd does not compile" in r.stdout
    finally:
        shutil.rmtree(project, ignore_errors=True)


# -- the path-to-tests rules ----------------------------------------------------------------------------------

def test_a_change_runs_the_unit_tests_of_the_area_it_touches_and_only_that_area():
    rules = smoke.load_rules()
    lesen = "node --test /work/sites/lesen/tests/*.test.mjs"
    game = "node --test /work/sites/ffm/static/game/*.test.js"
    mobile = "node --test /work/sites/ffm/mobile/tests/*.test.mjs"
    assert lesen in smoke.commands_for(["sites/lesen/static/storage.mjs"], rules)
    assert game not in smoke.commands_for(["sites/lesen/static/storage.mjs"], rules)
    assert smoke.commands_for(["sites/ffm/static/game/main.js"], rules) == [game, mobile]
    assert smoke.commands_for(["sites/ffm/mobile/package.json"], rules) == [mobile]
    assert smoke.commands_for(["sites/ffm/app/main.py"], rules) == []
    assert smoke.commands_for(["sites/derschweigert/app/main.py"], rules) == []
    assert lesen in smoke.commands_for_allowlist(["sites/lesen/"], rules)
    assert smoke.commands_for_allowlist(["sites/ffm/mobile/"], rules) == [mobile]
