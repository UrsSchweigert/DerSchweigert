import json
import os
import stat
import struct
import zlib

import pytest

from harness import approval, assets, cli, humantasks, plans
from harness.assets import AssetService, BlenderCli, validate_entry, validate_request
from harness.broker import Broker, BrokerRejected
from harness_doubles import Env, TIER_A

POLICY = {"assets": plans.DEFAULT_POLICY["assets"], "manual_testing": plans.DEFAULT_POLICY["manual_testing"]}


def png(w, h, extra=b""):
    def chunk(t, d):
        return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)
    raw = b"".join(b"\x00" + b"\xff\x00\x00" * w for _ in range(min(h, 4)))
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b"") + extra


def glb(triangles=12, extent=1.0, uri=None, extra=""):
    doc = {"asset": {"version": "2.0"}, "meshes": [{"primitives": [{"attributes": {"POSITION": 0}, "indices": 1}]}],
           "accessors": [{"count": 8, "min": [0, 0, 0], "max": [extent, extent, extent]}, {"count": triangles * 3}], "extras": extra}
    if uri:
        doc["buffers"] = [{"uri": uri, "byteLength": 1}]
    body = json.dumps(doc).encode()
    body += b" " * (-len(body) % 4)
    return b"glTF" + struct.pack("<II", 2, 12 + 8 + len(body)) + struct.pack("<I", len(body)) + b"JSON" + body


def entry_for(root, rel, data, **over):
    path = os.path.join(root, rel)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as fh:
        fh.write(data)
    e = {"path": rel, "checksum": assets.sha256_file(path), "request_id": "r1", "issue": "i1", "source": "procedural", "source_id": "", "url": "",
         "author": "harness", "license": "CC0-1.0", "attribution": "", "tool": "blender", "tool_version": "4.2", "generator": "", "script_ref": "",
         "prompt": "", "deterministic": True, "date": "2026-10-26"}
    e.update(over)
    return e


REQ = {"request_id": "r1", "issue_id": "i1", "purpose": "a crate", "asset_class": "model3d", "format": "glb", "output_path": "assets/crate.glb",
       "source": "procedural", "script": "import bpy\nbpy.ops.mesh.primitive_cube_add()"}


# -- request policy ---------------------------------------------------------------------------------

@pytest.mark.parametrize("change,fragment", [
    ({"request_id": "../../../escaped-canary"}, "request_id"),
    ({"request_id": "/tmp/escaped-canary"}, "request_id"),
    ({"request_id": "..\\escaped-canary"}, "request_id"),
    ({"request_id": ""}, "request_id"),
    ({"asset_class": "weapon"}, "not defined"),
    ({"format": "obj"}, "not allowed for model3d"),
    ({"output_path": "../escape.glb"}, "inside assets/"),
    ({"output_path": "/etc/crate.glb"}, "inside assets/"),
    ({"output_path": "src/crate.glb"}, "inside assets/"),
    ({"output_path": "assets/Crate Bad.glb"}, "naming convention"),
    ({"output_path": "assets/crate.png"}, "naming convention"),
    ({"source": "ai"}, "paid-generation budget"),
    ({"limits": {"max_triangles": 10**7}}, "exceeds the policy maximum"),
    ({"library": {"license": "CC-BY-4.0"}}, "license"),
    ({"prompt": "use ghp_" + "q" * 30}, "credential"),
    ({"surprise": 1}, "unknown keys"),
])
def test_requests_that_violate_policy_are_rejected(change, fragment):
    problems = validate_request(POLICY, dict(REQ, **change))
    assert problems and any(fragment in p for p in problems), problems


def test_a_valid_request_passes_and_paid_generation_needs_a_named_budget():
    assert validate_request(POLICY, REQ) == []
    funded = json.loads(json.dumps(POLICY))
    funded["assets"]["paid_generation_credits"] = 50
    assert validate_request(funded, dict(REQ, source="ai")) == []


# -- deterministic validation ----------------------------------------------------------------------------

def check(tmp_path, data, rel="assets/crate.glb", cls="model3d", policy=POLICY, **over):
    e = entry_for(str(tmp_path), rel, data, **over)
    return validate_entry(str(tmp_path), e, policy, cls)


def test_a_conforming_asset_passes(tmp_path):
    assert check(tmp_path, glb()) == []
    assert check(tmp_path, png(256, 256), rel="assets/tex.png", cls="texture") == []


@pytest.mark.parametrize("data,kwargs,fragment", [
    (glb(triangles=200000), {}, "triangles exceed"),
    (glb(extent=500.0), {}, "bounding box"),
    (glb(uri="/Users/me/tex.png"), {}, "absolute"),
    (glb(uri="http://evil.example/x.bin"), {}, "external or absolute URI"),
    (glb(extra="/Users/me/Desktop/model.blend"), {}, "absolute path"),
    (glb(extra="import os; os.system('x')"), {}, "embedded script"),
    (glb(extra="ghp_" + "k" * 30), {}, "credential"),
    (glb(), {"license": "CC-BY-4.0"}, "not allowed by the policy"),
    (glb(), {"license": ""}, "unknown or ambiguous"),
    (glb(), {"license": "Unknown (various)"}, "unknown or ambiguous"),
    (glb(), {"author": ""}, "author"),
    (glb(), {"date": ""}, "date"),
    (b"not a glb", {}, "cannot be inspected"),
])
def test_validation_rejects(tmp_path, data, kwargs, fragment):
    fails = check(tmp_path, data, **kwargs)
    assert fails and any(fragment in f for f in fails), fails


def test_size_texture_checksum_and_format_limits(tmp_path):
    small = json.loads(json.dumps(POLICY))
    small["assets"]["classes"]["model3d"]["max_bytes"] = 100
    assert any("file size" in f for f in check(tmp_path, glb(extra="x" * 500), policy=small))
    assert any("exceeds 2048 px" in f for f in check(tmp_path, png(4096, 16), rel="assets/big.png", cls="texture"))
    assert any("cannot be read" in f for f in check(tmp_path, b"\x89PNG-broken", rel="assets/bad.png", cls="texture"))
    e = entry_for(str(tmp_path), "assets/crate.glb", glb())
    with open(os.path.join(str(tmp_path), "assets/crate.glb"), "ab") as fh:
        fh.write(b" ")
    assert any("checksum" in f for f in validate_entry(str(tmp_path), e, POLICY, "model3d"))
    assert any("does not exist" in f for f in validate_entry(str(tmp_path), dict(e, path="assets/none.glb"), POLICY, "model3d"))
    assert any("format" in f for f in check(tmp_path, glb(), rel="assets/crate.obj"))


def test_attribution_is_required_where_the_policy_says(tmp_path):
    p = json.loads(json.dumps(POLICY))
    p["assets"]["allowed_licenses"] = ["CC0-1.0", "CC-BY-4.0"]
    p["assets"]["attribution_required_licenses"] = ["CC-BY-4.0"]
    assert any("attribution is required" in f for f in check(tmp_path, glb(), policy=p, license="CC-BY-4.0"))
    assert check(tmp_path, glb(), policy=p, license="CC-BY-4.0", attribution="Crate by A, CC BY 4.0") == []


def test_limits_that_cannot_be_verified_fail_closed(tmp_path):
    assert any("cannot be verified" in f for f in check(tmp_path, b"RIFFxxxx", rel="assets/hdr.exr", cls="hdri"))


# -- Blender runner (a labeled test double stands in for the executable) ---------------------------------

@pytest.fixture
def fake_blender(tmp_path):
    """TEST DOUBLE: a shell script that answers --version and 'renders' a prepared file. It is not Blender."""
    good = tmp_path / "fake_output.glb"
    good.write_bytes(glb())
    exe = tmp_path / "fakeblender"
    exe.write_text('#!/bin/sh\nif [ "$1" = "--version" ]; then echo "Blender 4.2.0 (test double)"; exit 0; fi\n'
                   'env | cut -d= -f1 | sort > "$HARNESS_ASSET_OUT.env"\ncp "%s" "$HARNESS_ASSET_OUT"\n' % good)
    exe.chmod(exe.stat().st_mode | stat.S_IEXEC)
    return str(exe), good


def test_probe_without_blender_reports_what_is_missing(monkeypatch):
    info = BlenderCli("definitely-not-blender").probe()
    assert info["available"] is False and "not installed" in info["reason"] and info["blender"] is None
    assert set(info) >= {"uv", "mcp_server_entry", "mcp_addon_socket_9876", "version"}


def test_probe_with_a_working_binary(fake_blender):
    info = BlenderCli(fake_blender[0]).probe()
    assert info["available"] and info["version"].startswith("Blender 4.2")


def test_scripts_are_screened_and_blender_gets_a_clean_environment(tmp_path, fake_blender, monkeypatch):
    runner = BlenderCli(fake_blender[0], reviewed_scripts=[REQ["script"]])
    for bad in ("import os", "open('x')", "bpy.ops.wm.save_mainfile()", "exec('1')", "from subprocess import run", "__import__('os')"):
        assert runner.run_script("import bpy\n" + bad, str(tmp_path / "o.glb"))["ok"] is False
    monkeypatch.setenv("GH_TOKEN", "canary")
    monkeypatch.setenv("AWS_SECRET_ACCESS_KEY", "canary")
    out = tmp_path / "o.glb"
    assert runner.run_script("import bpy\nbpy.ops.mesh.primitive_cube_add()", str(out))["ok"]
    names = (tmp_path / "o.glb.env").read_text().split()
    assert "HARNESS_ASSET_OUT" in names and "DISABLE_TELEMETRY" in names
    assert not {"GH_TOKEN", "AWS_SECRET_ACCESS_KEY"} & set(names)


def test_unreviewed_host_script_never_starts_blender(tmp_path, fake_blender, monkeypatch):
    runner = BlenderCli(fake_blender[0])
    def forbidden_run(*args, **kwargs):
        raise AssertionError("an unreviewed script reached the host process")
    monkeypatch.setattr(assets.subprocess, "run", forbidden_run)
    result = runner.run_script(REQ["script"], str(tmp_path / "unreviewed.glb"))
    assert result["ok"] is False and "review" in result["reason"].lower()
    assert not (tmp_path / "unreviewed.glb").exists()


# -- the service ---------------------------------------------------------------------------------------

def service(env, tmp_path, runner=None, policy=None):
    root = tmp_path / "repo"
    root.mkdir(exist_ok=True)
    return AssetService(env.store, "fx", policy or POLICY, str(root), runner, owner="alice", secondary_owner="bob"), root


@pytest.mark.parametrize("relative", ["assets", "assets/scripts", "assets/crate.glb", "assets/manifest.json", "assets/manifest.json.tmp"])
def test_asset_symlinks_are_rejected_before_writing(tmp_path, fake_blender, relative):
    env = Env(tmp_path)
    svc, root = service(env, tmp_path, BlenderCli(fake_blender[0], reviewed_scripts=[REQ["script"]]))
    outside = tmp_path / "outside"
    outside.mkdir()
    link = root / relative
    link.parent.mkdir(parents=True, exist_ok=True)
    link.symlink_to(outside if relative in ("assets", "assets/scripts") else outside / "canary")
    result = svc.handle(REQ, env.clock())
    assert result["status"] == "rejected"
    assert list(outside.iterdir()) == []


def test_asset_validation_rejects_paths_outside_the_repository(tmp_path):
    root = tmp_path / "repo"
    root.mkdir()
    entry = entry_for(str(tmp_path), "outside.glb", glb())
    entry["path"] = "../outside.glb"
    problems = validate_entry(str(root), entry, POLICY, "model3d")
    assert problems and any("path" in problem.lower() for problem in problems)


def test_human_asset_rechecks_output_paths_before_copying(tmp_path):
    env = Env(tmp_path)
    svc, root = service(env, tmp_path)
    svc.handle(REQ, env.clock())
    outside = tmp_path / "outside"
    outside.mkdir()
    (root / "assets").symlink_to(outside)
    supplied = tmp_path / "supplied.glb"
    supplied.write_bytes(glb())
    result = humantasks.respond(env.store, "asset-r1", responder_ids=["alice"], source="local", now=env.clock(),
                               answers={"source": "self-made", "license": "CC0-1.0", "author": "Alice"},
                               artifacts=[str(supplied)], asset_handler=svc.accept_human_asset)
    assert result["status"] == "invalid"
    assert list(outside.iterdir()) == []


def test_procedural_asset_is_delivered_with_a_complete_manifest(tmp_path, fake_blender):
    env = Env(tmp_path)
    svc, root = service(env, tmp_path, BlenderCli(fake_blender[0], reviewed_scripts=[REQ["script"]]))
    res = svc.handle(REQ, env.clock())
    assert res["status"] == "delivered" and res["source"] == "procedural"
    [entry] = svc.manifest()["entries"]
    for field in ("path", "checksum", "request_id", "issue", "source", "source_id", "url", "author", "license", "attribution", "tool", "tool_version",
                  "generator", "script_ref", "prompt", "deterministic", "date"):
        assert field in entry
    assert entry["checksum"] == assets.sha256_file(str(root / "assets/crate.glb")) and entry["deterministic"] is True
    assert entry["license"] == "CC0-1.0" and entry["tool"] == "blender"
    assert (root / entry["script_ref"]).read_text() == REQ["script"]  # the script lives next to the manifest so it can be regenerated
    assert svc.handle(REQ, env.clock())["status"] == "delivered"  # idempotent


def test_without_blender_every_need_becomes_a_human_task(tmp_path):
    env = Env(tmp_path, issues=[("i1", "P1", ["F1.1"])])
    svc, root = service(env, tmp_path, BlenderCli("definitely-not-blender"))
    res = svc.handle(REQ, env.clock())
    assert res["status"] == "task_raised" and not (root / "assets/crate.glb").exists()
    task = env.store.get_human_task("asset-r1")
    p = task["payload"]
    assert p["kind"] == "asset" and p["owner"] == "alice" and env.state("i1") == "Blocked"
    sources = {t["source"]: t["reason"] for t in p["extra"]["tried"]}
    assert "Blender is unavailable" in sources["procedural"] and "MCP" in sources["cc0_library"] and "no existing" in sources["repository"]
    assert "crate.glb" in p["request"] and "Sources tried" in p["request"]
    assert svc.handle(REQ, env.clock())["status"] == "task_raised" and len(env.store.human_tasks()) == 1


def test_human_supplied_asset_is_validated_recorded_and_releases_the_issue(tmp_path):
    env = Env(tmp_path, issues=[("i1", "P1", ["F1.1"])])
    svc, root = service(env, tmp_path, None)
    svc.handle(REQ, env.clock())
    f = tmp_path / "mine.glb"
    f.write_bytes(glb())
    answers = {"source": "self-made", "license": "CC0-1.0", "author": "Alice"}
    res = humantasks.respond(env.store, "asset-r1", responder_ids=["alice"], source="local", answers=answers, artifacts=[str(f)],
                             now=env.clock(), asset_handler=svc.accept_human_asset)
    assert res["status"] == "resolved" and env.state("i1") == "Ready" and env.store.get_issue("i1")["assets"] == ["mine.glb"]
    assert (root / "assets/crate.glb").exists()
    entry = svc.manifest()["entries"][0]
    assert entry["source"] == "self-made" and entry["author"] == "Alice" and entry["tool"] == "human-supplied"


def test_invalid_human_assets_are_refused_and_not_left_behind(tmp_path):
    env = Env(tmp_path, issues=[("i1", "P1", ["F1.1"])])
    svc, root = service(env, tmp_path, None)
    svc.handle(REQ, env.clock())
    f = tmp_path / "mine.glb"
    f.write_bytes(glb())
    res = humantasks.respond(env.store, "asset-r1", responder_ids=["alice"], source="local", now=env.clock(), artifacts=[str(f)],
                             answers={"source": "web", "license": "CC-BY-4.0", "author": "Bob"}, asset_handler=svc.accept_human_asset)
    assert res["status"] == "invalid" and "not allowed by the policy" in res["reason"]
    assert not (root / "assets/crate.glb").exists() and env.state("i1") == "Blocked"


def test_validation_failing_twice_raises_a_task(tmp_path, fake_blender):
    env = Env(tmp_path, issues=[("i1", "P1", ["F1.1"])])
    tight = json.loads(json.dumps(POLICY))
    tight["assets"]["classes"]["model3d"]["max_triangles"] = 5  # the double always produces 12 triangles
    svc, root = service(env, tmp_path, BlenderCli(fake_blender[0], reviewed_scripts=[REQ["script"]]), tight)
    first = svc.handle(REQ, env.clock())
    assert first["status"] == "validation_failed" and not (root / "assets/crate.glb").exists() and env.store.human_tasks() == []
    second = svc.handle(REQ, env.clock())
    assert second["status"] == "task_raised"
    assert "validation failed" in " ".join(t["reason"] for t in env.store.get_human_task("asset-r1")["payload"]["extra"]["tried"])


def test_repository_assets_are_reused_only_with_provenance(tmp_path, fake_blender):
    env = Env(tmp_path, issues=[("i1", "P1", ["F1.1"]), ("i2", "P1", ["F1.2"])])
    svc, root = service(env, tmp_path, BlenderCli(fake_blender[0], reviewed_scripts=[REQ["script"]]))
    svc.handle(REQ, env.clock())
    reuse = dict(REQ, request_id="r2", issue_id="i2", output_path="assets/crate-copy.glb", existing_path="assets/crate.glb", source="repository")
    res = svc.handle(reuse, env.clock())
    assert res["status"] == "delivered" and res["source"] == "repository"
    (root / "assets" / "orphan.glb").write_bytes(glb())
    orphan = dict(reuse, request_id="r3", existing_path="assets/orphan.glb", script=None)
    orphan.pop("script")
    no_blender, _ = service(env, tmp_path, None)
    res = no_blender.handle(orphan, env.clock())
    assert res["status"] == "task_raised"
    assert any("no manifest entry" in t["reason"] for t in env.store.get_human_task("asset-r3")["payload"]["extra"]["tried"])


def test_paid_generation_is_never_used_without_budget(tmp_path):
    env = Env(tmp_path)
    svc, _ = service(env, tmp_path, None)
    res = svc.handle(dict(REQ, source="ai", prompt="a crate"), env.clock())
    assert res["status"] == "rejected" and any("budget" in p for p in res["problems"])
    funded = json.loads(json.dumps(POLICY))
    funded["assets"]["paid_generation_credits"] = 10
    svc2, _ = service(env, tmp_path, None, funded)
    out = svc2.handle(dict(REQ, request_id="r9", source="ai", prompt="a crate"), env.clock())
    assert out["status"] == "task_raised"  # budget exists but no provider is configured, so a human is asked
    assert any(t["source"] == "ai" and "provider" in t["reason"] for t in out["tried"])


def test_visual_fit_can_require_a_human_with_the_asset_attached(tmp_path, fake_blender):
    env = Env(tmp_path, issues=[("i1", "P1", ["F1.1"])])
    p = json.loads(json.dumps(POLICY))
    p["assets"]["visual_fit_needs_human"] = True
    svc, root = service(env, tmp_path, BlenderCli(fake_blender[0], reviewed_scripts=[REQ["script"]]), p)
    res = svc.handle(REQ, env.clock())
    task_id = res["review_task"]
    task = env.store.get_human_task(task_id)
    checksum = task["payload"]["extra"]["tested_head"]
    assert checksum == svc.manifest()["entries"][0]["checksum"]
    ok = humantasks.respond(env.store, task_id, responder_ids=["alice"], source="local", now=env.clock(),
                            answers={"outcome": "pass", "tester": "alice", "revision": checksum})
    assert ok["status"] == "resolved" and env.store.evidence("i1", "asset_review")[0]["verdict"] == "pass"


# -- the broker boundary ----------------------------------------------------------------------------------

def broker_env(tmp_path, fake_blender, authorized=True):
    env = Env(tmp_path, issues=[("i1", "P1", ["F1.1"])])
    svc, root = service(env, tmp_path, BlenderCli(fake_blender[0], reviewed_scripts=[REQ["script"]]))
    lease = env.store.claim("worker", "r", now=env.clock())
    env.store.start(lease.attempt_id, lease.epoch, env.clock())
    b = Broker(env.store, None, "fx", 1, ["owner"], isolation=TIER_A, assets=svc)
    prop = {"attempt_id": lease.attempt_id, "epoch": lease.epoch, "action": "asset_request", "target": "asset", "payload": REQ}
    return env, b, prop, root


def test_workers_reach_blender_only_through_the_broker(tmp_path, fake_blender):
    env, b, prop, root = broker_env(tmp_path, fake_blender)
    dry = b.execute(prop, env.clock(), dry_run=True)
    assert dry["status"] == "valid" and not (root / "assets/crate.glb").exists()
    assert b.execute(prop, env.clock())["status"] == "delivered" and (root / "assets/crate.glb").exists()
    bad = dict(prop, payload=dict(REQ, request_id="r2", format="obj"))
    assert b.execute(bad, env.clock())["status"] == "rejected"
    with pytest.raises(BrokerRejected, match="unknown issue"):
        b.execute(dict(prop, payload=dict(REQ, issue_id="nope")), env.clock())


def test_asset_requests_need_authorization(tmp_path, fake_blender):
    env, b, prop, root = broker_env(tmp_path, fake_blender)
    plan = env.store.get_plan("fx")
    assert "asset_requests" in plan["plan"]["policy"]["authorized_operations"]
    b2 = Broker(env.store, None, "fx", 1, ["owner"], isolation=TIER_A, assets=None)
    with pytest.raises(BrokerRejected, match="not configured"):
        b2.execute(prop, env.clock())


def test_cli_asset_probe_runs_without_blender(capsys):
    assert cli.main(["assets", "probe"]) == 0
    out = json.loads(capsys.readouterr().out)
    assert "available" in out and "reason" in out
