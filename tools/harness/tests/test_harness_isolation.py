import json
import os

import pytest

from harness import approval, broker, cli, isolation
from harness.store import Store

FIX = os.path.join(os.path.dirname(__file__), "..", "fixtures")
REQ = os.path.join(FIX, "requirements.md")
PHASES = os.path.join(FIX, "phases.json")
KEY = b"k" * 32
OK = {"ok": True, "image_id": "sha256:abc", "checks": {c: True for c in isolation.REQUIRED_CHECKS}}
real_docker = pytest.mark.skipif(not (isolation.docker_available() and isolation.image_id()),
                                 reason="needs Docker and the built harness-worker image")


def lookup(value):
    return lambda: value


# -- launcher arguments (no Docker needed) -----------------------------------

def test_docker_args_lock_the_container_down(tmp_path):
    args = isolation.docker_args(str(tmp_path), ["echo", "hi"], pass_env=["COPILOT_GITHUB_TOKEN"])
    joined = " ".join(args)
    for flag in ("--read-only", "--cap-drop ALL", "no-new-privileges", "--user 10001:10001", "--pids-limit", "--memory"):
        assert flag in joined
    assert args.count("-v") == 1 and args[args.index("-v") + 1] == "%s:/work:rw" % os.path.realpath(str(tmp_path))
    assert "--privileged" not in args and "--network" not in args and "docker.sock" not in joined
    assert args[args.index("-e") + 1] == "COPILOT_GITHUB_TOKEN" and "=" not in args[args.index("-e") + 1]
    assert args[-3:] == [isolation.IMAGE, "echo", "hi"] or args[-2:] == ["echo", "hi"]


def test_scrub_env_is_shared_with_the_broker():
    assert broker.scrub_env is isolation.scrub_env
    assert isolation.scrub_env({"PATH": "/bin", "GH_TOKEN": "x", "COPILOT_GITHUB_TOKEN": "x"}) == {"PATH": "/bin"}


def test_async_worker_keeps_credentials_out_of_arguments(tmp_path, monkeypatch):
    token = tmp_path / "copilot.token"
    token.write_text("copilot-only-secret")
    monkeypatch.setenv("GH_TOKEN", "host-secret")
    calls = []
    def launch(args, **kwargs):
        calls.append((args, kwargs))
        return "process"
    monkeypatch.setattr(isolation.subprocess, "Popen", launch)
    assert isolation.start_worker(str(tmp_path), ["check"], str(token), name="harness-check-test") == "process"
    args, kwargs = calls[0]
    assert args[:2] == ["docker", "run"] and "--name" in args
    assert "copilot-only-secret" not in " ".join(args) and "host-secret" not in " ".join(args)
    assert kwargs["env"][isolation.COPILOT_TOKEN_ENV] == "copilot-only-secret" and "GH_TOKEN" not in kwargs["env"]


# -- attestation --------------------------------------------------------------

def test_attestation_grants_tier_a_only_when_valid(tmp_path):
    home = str(tmp_path)
    assert isolation.current_tier(home, KEY)["tier"] == "B"
    isolation.write_attestation(home, KEY, OK, now=1000)
    assert isolation.current_tier(home, KEY, now=2000, image_lookup=lookup("sha256:abc"))["tier"] == "A"
    assert oct(os.stat(isolation.attestation_path(home)).st_mode & 0o777) == "0o600"


def test_attestation_rejected_when_stale_forged_or_image_changed(tmp_path):
    home = str(tmp_path)
    isolation.write_attestation(home, KEY, OK, now=1000)
    img = lookup("sha256:abc")
    assert "expired" in isolation.current_tier(home, KEY, now=1000 + isolation.ATTESTATION_TTL_S + 1, image_lookup=img)["reason"]
    assert "image changed" in isolation.current_tier(home, KEY, now=1001, image_lookup=lookup("sha256:other"))["reason"]
    assert "image changed" in isolation.current_tier(home, KEY, now=1001, image_lookup=lookup(None))["reason"]
    assert "signature" in isolation.current_tier(home, b"x" * 32, now=1001, image_lookup=img)["reason"]
    assert isolation.current_tier(home, None, now=1001, image_lookup=img)["tier"] == "B"
    path = isolation.attestation_path(home)
    doc = json.load(open(path))
    doc["checks"]["store_path_absent"] = False
    json.dump(doc, open(path, "w"))
    assert isolation.current_tier(home, KEY, now=1001, image_lookup=img)["tier"] == "B"


def test_attestation_missing_a_required_check_is_not_tier_a(tmp_path):
    home = str(tmp_path)
    partial = dict(OK, checks={c: True for c in isolation.REQUIRED_CHECKS[:-1]})
    isolation.write_attestation(home, KEY, partial, now=1)
    assert "every required check" in isolation.current_tier(home, KEY, now=2, image_lookup=lookup("sha256:abc"))["reason"]


def test_failed_probe_cannot_be_attested(tmp_path):
    with pytest.raises(RuntimeError):
        isolation.write_attestation(str(tmp_path), KEY, {"ok": False, "reason": "nope"})


def test_tier_a_unlocks_real_plan_approval(tmp_path, monkeypatch):
    store = Store(str(tmp_path / "home"))
    cli.plan_command(store, REQ, PHASES, plan_id="real")
    with pytest.raises(approval.AuthorizationError, match="Tier B"):
        approval.approve(store, "real", None, "owner", lambda p, d: True)
    key = approval._load_key(store, True)
    isolation.write_attestation(store.home, key, OK)
    monkeypatch.setattr(isolation, "image_id", lambda image=isolation.IMAGE: "sha256:abc")
    assert approval.detect_isolation(store)["tier"] == "A"
    plan = store.get_plan("real")
    store.put_doc("check_preflight", "real@v1", {"digest": plan["digest"], "head": "a" * 40, "results": []})
    assert approval.approve(store, "real", None, "owner", lambda p, d: True)["plan_id"] == "real"
    assert approval.authorize_run(store, "real", 1)["plan_id"] == "real"
    # Tampering with the plan after approval still blocks `run` even in Tier A.
    plan = store.get_plan("real")["plan"]
    plan["policy"]["merge_policy"] = "x"
    store.cx.execute("UPDATE plans SET content=?", (json.dumps(plan),))
    with pytest.raises(approval.AuthorizationError, match="changed since approval"):
        approval.authorize_run(store, "real", 1)


def test_status_shows_isolation_tier(tmp_path):
    store = Store(str(tmp_path / "home"))
    report = cli.status_report(store.home)
    assert report["isolation"]["tier"] == "B" and report["run_permitted"] is False
    assert any("verified strict required checks" in limit for limit in report["limitations"])
    assert not any("by convention" in limit for limit in report["limitations"])


# -- real container (skipped without Docker and the built image) -------------

@real_docker
def test_real_probe_passes_with_host_canaries(tmp_path):
    result = isolation.probe(str(tmp_path / "store"))
    assert result["ok"], result
    assert set(isolation.REQUIRED_CHECKS) <= set(result["checks"])


@real_docker
def test_real_worker_sees_only_its_workdir_and_copilot_token(tmp_path, monkeypatch):
    store_home = tmp_path / "store"
    store_home.mkdir()
    (store_home / "approval.key").write_text("secret")
    token = tmp_path / "copilot.token"
    token.write_text("dummy-copilot-token")
    monkeypatch.setenv("GH_TOKEN", "canary-gh")
    monkeypatch.setenv("HARNESS_HOME", str(store_home))
    work = isolation.new_workdir("test-")
    try:
        script = "env; echo ---; ls %s 2>&1; echo ---; echo x > /work/out.txt; touch /etc/x 2>&1" % store_home
        res = isolation.run_worker(work, ["sh", "-c", script], str(token), timeout=60)
        env_part, _, rest = res.stdout.partition("---")
        names = {line.split("=", 1)[0] for line in env_part.splitlines() if "=" in line}
        assert "COPILOT_GITHUB_TOKEN" in names
        assert not {"GH_TOKEN", "GITHUB_TOKEN", "HARNESS_HOME", "SSH_AUTH_SOCK"} & names
        assert "canary-gh" not in res.stdout
        assert "No such file" in rest and "approval.key" not in rest
        assert os.listdir(work) == ["out.txt"]
    finally:
        import shutil
        shutil.rmtree(work, ignore_errors=True)
