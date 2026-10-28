"""Opt-in live check of the real runtime adapter: HARNESS_LIVE=1 python3 -m pytest tools/harness/tests/test_harness_live.py

Runs the real Copilot CLI in the Tier A sandbox against a throwaway repository, then inspects the result with
the real GitRepo and the real sandbox checker. It spends a small amount of Copilot usage and writes nothing to GitHub.
"""
import json
import os
import subprocess
import time

import pytest

from harness import isolation, schemas
from harness.adapter import CopilotCliAdapter, WorkRequest
from harness.checks import SandboxChecker
from harness.repo import GitRepo
from harness.store import default_home

pytestmark = pytest.mark.skipif(os.environ.get("HARNESS_LIVE") != "1", reason="set HARNESS_LIVE=1 to run against the real runtime")

ENV = dict(os.environ, GIT_AUTHOR_NAME="t", GIT_AUTHOR_EMAIL="t@t", GIT_COMMITTER_NAME="t", GIT_COMMITTER_EMAIL="t@t", GIT_CONFIG_GLOBAL=os.devnull)


def test_real_adapter_implements_a_task_and_trusted_code_verifies_it(tmp_path):
    src = tmp_path / "src"
    src.mkdir()
    run = lambda *a, cwd=str(src): subprocess.run(["git"] + list(a), cwd=cwd, env=ENV, check=True, capture_output=True)  # noqa: E731
    run("init", "-q", "-b", "main")
    (src / "README.md").write_text("demo\n")
    run("add", "-A")
    run("commit", "-q", "-m", "init")
    trusted = tmp_path / "trusted.git"
    subprocess.run(["git", "clone", "-q", "--bare", str(src), str(trusted)], check=True, env=ENV)

    home = default_home()
    adapter = CopilotCliAdapter(home, str(trusted))
    probe = adapter.probe()
    assert probe["available"], probe
    packet = {"issue_id": "live1", "phase_id": "P1", "requirement_ids": ["R1"], "role": "implementer", "tier": "low",
              "outcomes": ["A file src/hello.txt exists containing the word hi"], "acceptance_criteria": ["file exists and is committed"],
              "non_goals": ["any other change"], "code_anchors": ["src/"], "dependencies": [], "validation_commands": ["test -f src/hello.txt"],
              "path_allowlist": ["src/"], "untrusted_data": "{}"}
    schemas.validate(packet, schemas.TASK_PACKET)
    req = WorkRequest("live1#1", 1, "live1", "implementer", "low", "claude-haiku-4.5", packet, "harness/live1")
    handle = adapter.start(req)
    deadline = time.time() + 240
    poll = adapter.poll(handle, time.time())
    while poll.state == "running" and time.time() < deadline:
        time.sleep(3)
        poll = adapter.poll(handle, time.time())
    try:
        assert poll.state == "finished" and poll.error is None, poll
        schemas.validate(poll.result, schemas.WORKER_RESULT, "result")
        assert poll.result["attempt_id"] == "live1#1" and poll.result["epoch"] == 1
        repo = GitRepo(str(trusted))
        repo.fetch_branch(adapter.source_path(handle), "harness/live1")
        assert repo.branch_changed_paths("harness/live1") == ["src/hello.txt"]
        results = SandboxChecker(repo, os.path.join(home, "copilot.token")).run("live1", repo.branch_head("harness/live1"), ["test -f src/hello.txt"])
        assert results == [{"command": "test -f src/hello.txt", "exit_code": 0}]
    finally:
        adapter.cleanup(handle)
        isolation.subprocess.run(["docker", "rm", "-f", handle.name], capture_output=True)


def test_real_blender_builds_a_valid_procedural_asset(tmp_path):
    """Needs a local Blender. Uses the headless runner, never the MCP socket."""
    from harness import plans
    from harness.assets import BlenderCli, validate_entry, sha256_file

    runner = BlenderCli()
    if not runner.probe()["available"]:
        pytest.skip("Blender is not installed")
    out = tmp_path / "assets" / "cube.glb"
    out.parent.mkdir()
    script = ("import bpy\n"
              "for o in list(bpy.data.objects):\n    bpy.data.objects.remove(o, do_unlink=True)\n"
              "bpy.ops.mesh.primitive_cube_add(size=1.0)\n"
              "bpy.ops.export_scene.gltf(filepath=OUTPUT_PATH, export_format='GLB')\n")
    res = runner.run_script(script, str(out))
    assert res["ok"], res
    entry = {"path": "assets/cube.glb", "checksum": sha256_file(str(out)), "request_id": "live", "issue": "i1", "source": "procedural", "author": "harness",
             "license": "CC0-1.0", "attribution": "", "tool": "blender", "date": "2026-10-26"}
    assert validate_entry(str(tmp_path), entry, {"assets": plans.DEFAULT_POLICY["assets"]}, "model3d") == []


def test_real_investigator_drafts_a_valid_plan_for_a_small_app(tmp_path, monkeypatch):
    """Real Copilot CLI in the Tier A sandbox. It may ask a question, which is answered automatically."""
    from harness import plans, runner
    from harness.adapter import CopilotCliAdapter
    from harness.investigate import Investigator, validate_draft

    app = tmp_path / "app"
    (app / "src").mkdir(parents=True)
    (app / "tests").mkdir()
    (app / "src" / "greet.js").write_text("export function greet(name) { return 'Hello ' + name; }\n")
    (app / "tests" / "greet.test.mjs").write_text("import test from 'node:test';\nimport assert from 'node:assert';\n"
                                                  "import { greet } from '../src/greet.js';\ntest('greet', () => assert.equal(greet('A'), 'Hello A'));\n")
    (app / "package.json").write_text('{"type": "module", "scripts": {"test": "node --test tests/*.test.mjs"}}\n')
    run = lambda *a: subprocess.run(["git"] + list(a), cwd=str(app), env=ENV, check=True, capture_output=True)  # noqa: E731
    run("init", "-q", "-b", "main")
    run("add", "-A")
    run("commit", "-q", "-m", "init")
    req = tmp_path / "requirements.md"
    req.write_text("| ID | Requirement | Description |\n| :--- | :--- | :--- |\n"
                   "| **1.1** | **Polite greeting** | greet() ends with an exclamation mark. |\n"
                   "| **1.2** | **Shout option** | greet(name, {shout: true}) returns upper case. |\n")
    home = default_home()
    clone = runner.trusted_clone(str(tmp_path / "home"), str(app))
    adapter = CopilotCliAdapter(home, clone.path, "main")
    assert adapter.probe()["available"]
    policy = plans.DEFAULT_POLICY
    inv = Investigator(adapter, clone, policy, None, ask=lambda q: "Use your best judgment.", tier="low", max_attempts=4, timeout=600)
    monkeypatch.chdir(tmp_path)
    out = str(tmp_path / "plan")
    result = inv.run(str(req), out)
    assert result["status"] == "ok", result
    phases = json.load(open(os.path.join(out, "phases.json")))["phases"]
    issues = json.load(open(os.path.join(out, "issues.json")))["issues"]
    assert validate_draft({"phases": phases, "issues": issues}, plans.parse_requirements(str(req)), clone, policy) == []
    assert {r for p in phases for r in p["requirements"]} == {"1.1", "1.2"}

    # Revise with feedback: the real investigator receives the current draft and the owner's decision.
    again = inv.run(str(req), out, feedback=["Put requirement 1.2 (shout option) into its own phase P2 that depends on P1, with its own issue."])
    assert again["status"] == "ok", again
    phases = json.load(open(os.path.join(out, "phases.json")))["phases"]
    issues = json.load(open(os.path.join(out, "issues.json")))["issues"]
    assert validate_draft({"phases": phases, "issues": issues}, plans.parse_requirements(str(req)), clone, policy) == []
    assert os.path.isdir(os.path.join(out, "history", "rev-1"))
    by_req = {r: p["id"] for p in phases for r in p["requirements"]}
    assert by_req["1.1"] != by_req["1.2"]


def test_real_reviewer_reports_the_head_it_reviewed(tmp_path):
    """Regression: a real reviewer must echo reviewed_head, and its repo copy must be at that head."""
    src = tmp_path / "src"
    src.mkdir()
    run = lambda *a: subprocess.run(["git"] + list(a), cwd=str(src), env=ENV, check=True, capture_output=True, text=True)  # noqa: E731
    run("init", "-q", "-b", "main")
    (src / "greet.js").write_text("export const greet = (n) => 'Hello ' + n;\n")
    run("add", "-A")
    run("commit", "-q", "-m", "init")
    trusted = tmp_path / "trusted.git"
    subprocess.run(["git", "clone", "-q", "--bare", str(src), str(trusted)], check=True, env=ENV)
    run("checkout", "-q", "-b", "harness/rev1")
    (src / "greet.js").write_text("export const greet = (n) => 'Hello ' + n + '!';\n")
    run("add", "-A")
    run("commit", "-q", "-m", "exclaim")
    head = run("rev-parse", "HEAD").stdout.strip()
    subprocess.run(["git", "--git-dir", str(trusted), "fetch", "-q", str(src), "+refs/heads/harness/rev1:refs/heads/harness/rev1"], check=True, env=ENV)
    home = default_home()
    adapter = CopilotCliAdapter(home, str(trusted))
    diff = run("diff", "main", "harness/rev1").stdout
    packet = {"issue_id": "rev1", "phase_id": "P1", "requirement_ids": ["1.1"], "role": "reviewer", "tier": "standard", "outcomes": ["greeting ends with !"],
              "acceptance_criteria": ["greet('A') returns 'Hello A!'"], "non_goals": [], "code_anchors": ["greet.js"], "dependencies": [],
              "validation_commands": [], "path_allowlist": ["./"], "untrusted_data": json.dumps({"diff": diff}), "reviewed_head": head}
    handle = adapter.start(WorkRequest("rev1#1", 1, "rev1", "reviewer", "standard", "claude-sonnet-5", packet, "harness/rev1"))
    deadline = time.time() + 240
    poll = adapter.poll(handle, time.time())
    while poll.state == "running" and time.time() < deadline:
        time.sleep(3)
        poll = adapter.poll(handle, time.time())
    try:
        assert poll.state == "finished" and poll.error is None, poll
        schemas.validate(poll.result, schemas.WORKER_RESULT, "result")
        assert poll.result["revision"] == head, poll.result
        assert poll.result["outcome"] in ("approve", "changes_requested")
    finally:
        adapter.cleanup(handle)


def test_real_refiner_answers_ready_when_only_an_anchor_changed_and_a_new_file_is_planned(tmp_path):
    """Regression for a blocked first run: a refiner must accept anchors that name files the task will create."""
    src = tmp_path / "src"
    src.mkdir()
    run = lambda *a: subprocess.run(["git"] + list(a), cwd=str(src), env=ENV, check=True, capture_output=True, text=True)  # noqa: E731
    run("init", "-q", "-b", "main")
    (src / "index.html").write_text("<html><body><button id='speak'>Read Out Loud</button></body></html>\n")
    run("add", "-A")
    run("commit", "-q", "-m", "init")
    trusted = tmp_path / "trusted.git"
    subprocess.run(["git", "clone", "-q", "--bare", str(src), str(trusted)], check=True, env=ENV)
    home = default_home()
    adapter = CopilotCliAdapter(home, str(trusted))
    packet = {"issue_id": "tts", "phase_id": "P1", "requirement_ids": ["3.1"], "role": "refiner", "tier": "low",
              "outcomes": ["A one-time notice is shown the first time Read Out Loud is used in a session"],
              "acceptance_criteria": ["session-flags.mjs exports shouldShowNotice(flags) and markShown(flags)"], "non_goals": [],
              "code_anchors": ["index.html", "session-flags.mjs"], "dependencies": [], "validation_commands": ["node --test tests/session-flags.test.mjs"],
              "path_allowlist": ["./"],
              "untrusted_data": json.dumps({"changed_since_refinement": ["index.html"], "anchors_that_do_not_exist_yet": ["session-flags.mjs"]})}
    handle = adapter.start(WorkRequest("tts#1", 1, "tts", "refiner", "low", "claude-haiku-4.5", packet, "harness/tts"))
    deadline = time.time() + 240
    poll = adapter.poll(handle, time.time())
    while poll.state == "running" and time.time() < deadline:
        time.sleep(3)
        poll = adapter.poll(handle, time.time())
    try:
        assert poll.state == "finished" and poll.error is None, poll
        schemas.validate(poll.result, schemas.WORKER_RESULT, "result")
        assert poll.result["outcome"] == "ready", poll.result
    finally:
        adapter.cleanup(handle)


# -- the stuck-report, delegation, analysis, and usage paths ---------------------------------------------------

MODELS = ["claude-haiku-4.5", "claude-sonnet-5", "claude-opus-5", "claude-opus-4.8"]


def _trusted_clone(tmp_path, files):
    src = tmp_path / "src"
    src.mkdir()
    run = lambda *a: subprocess.run(["git"] + list(a), cwd=str(src), env=ENV, check=True, capture_output=True, text=True)  # noqa: E731
    run("init", "-q", "-b", "main")
    for name, text in files.items():
        (src / name).parent.mkdir(parents=True, exist_ok=True)
        (src / name).write_text(text)
    run("add", "-A")
    run("commit", "-q", "-m", "init")
    trusted = tmp_path / "trusted.git"
    subprocess.run(["git", "clone", "-q", "--bare", str(src), str(trusted)], check=True, env=ENV)
    return str(trusted)


def _packet(role, tier, issue_id, data, **fields):
    packet = {"issue_id": issue_id, "phase_id": "P1", "requirement_ids": ["R1", "R2"], "role": role, "tier": tier, "outcomes": ["o"],
              "acceptance_criteria": ["a"], "non_goals": [], "code_anchors": ["src/"], "dependencies": [], "validation_commands": [],
              "path_allowlist": ["src/"], "untrusted_data": json.dumps(data)}
    packet.update(fields)
    schemas.validate(packet, schemas.TASK_PACKET)
    return packet


def _finish(adapter, handle, timeout=300):
    deadline = time.time() + timeout
    poll = adapter.poll(handle, time.time())
    while poll.state == "running" and time.time() < deadline:
        time.sleep(3)
        poll = adapter.poll(handle, time.time())
    assert poll.state == "finished" and poll.error is None, poll
    schemas.validate(poll.result, schemas.WORKER_RESULT, "result")
    return poll.result


def test_real_implementer_reports_an_impossible_task_as_stuck(tmp_path):
    """A real implementer must say it is stuck, and the harness must read that as stuck rather than done."""
    from harness.scheduler import Scheduler
    trusted = _trusted_clone(tmp_path, {"src/answer.txt": "maybe\n"})
    adapter = CopilotCliAdapter(default_home(), trusted)
    packet = _packet("implementer", "low", "stuck1", {}, outcomes=["src/answer.txt contains exactly the word yes"],
                     acceptance_criteria=["src/answer.txt contains exactly the word yes", "src/answer.txt contains exactly the word no"],
                     code_anchors=["src/answer.txt"], validation_commands=["test -f src/answer.txt"])
    handle = adapter.start(WorkRequest("stuck1#1", 1, "stuck1", "implementer", "low", "claude-haiku-4.5", packet, "harness/stuck1"))
    try:
        result = _finish(adapter, handle)
        assert Scheduler._stuck_reason(result) is not None, result
    finally:
        adapter.cleanup(handle)
        isolation.subprocess.run(["docker", "rm", "-f", handle.name], capture_output=True)


def test_real_delegator_returns_a_decision_that_trusted_code_accepts(tmp_path):
    from harness import models, plans
    trusted = _trusted_clone(tmp_path, {"src/app.js": "export const run = () => 1;\n"})
    adapter = CopilotCliAdapter(default_home(), trusted)
    data = {"stuck_report": "The helper this task depends on does not exist anywhere in the repository.", "previous_failures": [],
            "attempts": [{"role": "implementer", "model": "claude-haiku-4.5", "tier": "low", "outcome": "Failed", "failure_kind": "worker_blocked"}],
            "model_options": models.model_options(plans.DEFAULT_POLICY["model_tiers"], MODELS), "strong_attempts_remaining": 1}
    packet = _packet("delegator", "standard", "deleg1", data, outcomes=["src/app.js exports a run function that uses the helper in src/helper.js"])
    handle = adapter.start(WorkRequest("deleg1#1", 1, "deleg1", "delegator", "standard", "claude-sonnet-5", packet, "harness/deleg1"))
    try:
        result = _finish(adapter, handle)
        decision = result["decision"]
        assert decision["diagnosis"].strip() and decision["action"] in ("retry", "ask_owner"), result
        if decision.get("model_choice"):
            models.resolve_choice(decision["model_choice"], plans.DEFAULT_POLICY["model_tiers"], MODELS, strong_used=0, strong_budget=1)
        reported = adapter.usage(handle)
        assert reported["size_estimate"]["input_tokens"] > 0
        print("\nagent usage_estimate:", result.get("usage_estimate"), "\nruntime usage lines:", reported["runtime_lines"])
    finally:
        adapter.cleanup(handle)
        isolation.subprocess.run(["docker", "rm", "-f", handle.name], capture_output=True)


def test_real_strong_analyst_returns_an_analysis_that_trusted_code_accepts(tmp_path):
    """Spends strong-tier usage. Whatever the model recommends, every rule the harness applies to a split must hold."""
    from harness import models, plans, splits
    trusted = _trusted_clone(tmp_path, {"src/app.js": "export const run = () => 1;\n", "src/theme.js": "export const theme = {};\n"})
    adapter = CopilotCliAdapter(default_home(), trusted)
    data = {"stuck_report": "The task covers storage, import and export, and a settings screen, which is too much for one session.",
            "delegator_diagnosis": "Too large for one session. Consider splitting it.", "previous_failures": [], "attempts": [],
            "model_options": models.model_options(plans.DEFAULT_POLICY["model_tiers"], MODELS),
            "split_rules": {"parts": "2 to 6", "diff_size_cap": 800, "requirement_ids": ["R1", "R2"], "original_dependencies": [], "existing_issue_ids": ["big1"]}}
    packet = _packet("analyst", "strong", "big1", data, outcomes=["A settings screen with persistence", "Import and export of settings as a file"],
                     acceptance_criteria=["Settings persist across reloads", "Settings can be exported and imported"])
    handle = adapter.start(WorkRequest("big1#1", 1, "big1", "analyst", "strong", "claude-opus-5", packet, "harness/big1"))
    try:
        result = _finish(adapter, handle, timeout=600)
        original = {"issue_id": "big1", "requirement_ids": ["R1", "R2"], "deps": []}
        problems = splits.validate_analysis(result["analysis"], original, {"path_allowlist": ["src/"]}, {"big1"}, GitRepo(trusted))
        assert problems == [], (problems, result["analysis"])
        print("\nanalysis recommendation:", result["analysis"]["recommendation"], "\nagent usage_estimate:", result.get("usage_estimate"))
    finally:
        adapter.cleanup(handle)
        isolation.subprocess.run(["docker", "rm", "-f", handle.name], capture_output=True)
