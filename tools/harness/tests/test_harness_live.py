"""Opt-in live check of the real runtime adapter: HARNESS_LIVE=1 python3 -m pytest tools/harness/tests/test_harness_live.py

Runs the real Copilot CLI in the Tier A sandbox against a throwaway repository, then inspects the result with
the real GitRepo and the real sandbox checker. It spends a small amount of Copilot usage and writes nothing to GitHub.
"""
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
