"""The art service: the key and the budget stay on the trusted side, and what a worker can ask for is bounded."""
import base64
import json
import os
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from types import SimpleNamespace

import pytest

from harness import artservice, cli, isolation, plans, runner
from harness.adapter import ClaudeCodeAdapter, WorkRequest, build_prompt
from harness.store import Store
from harness_doubles import FIX, REQ

PNG = b"\x89PNG\r\n\x1a\n" + b"fake-image-bytes" * 8
ART = {"generator": "fal-ai/flux-pro/kontext", "credits": 5}
CLIENT = os.path.join(os.path.dirname(__file__), "..", "worker", "art-generate")


class FakeFal:
    """Stands in for the paid call: records what the trusted side sent, never touches the network."""

    def __init__(self, png=PNG, fail=None, delay=0.0):
        self.calls, self.png, self.fail, self.delay = [], png, fail, delay

    def __call__(self, model, arguments):
        self.calls.append((model, arguments))
        time.sleep(self.delay)
        if self.fail:
            raise RuntimeError(self.fail)
        return {"png": self.png, "seed": 4242}


@pytest.fixture
def service(tmp_path):
    fal = FakeFal()
    svc = artservice.ArtService(str(tmp_path), "plan-a", ART, generate=fal, token="t0ken").start()
    svc.fal = fal
    yield svc
    svc.stop()


def call(svc, path, body=None, token="t0ken"):
    data = None if body is None else json.dumps(body).encode()
    request = urllib.request.Request("http://127.0.0.1:%d%s" % (svc.port, path), data=data, method="GET" if body is None else "POST",
                                     headers={"Authorization": "Bearer " + token} if token else {})
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            return response.status, json.load(response)
    except urllib.error.HTTPError as exc:
        return exc.code, json.load(exc)


def generate(svc, **fields):
    return call(svc, "/v1/generate", dict({"prompt": "pixel art hero idle sheet, flat magenta background"}, **fields))


# -- policy -------------------------------------------------------------------------------------------

@pytest.mark.parametrize("art, fragment", [
    ({"generator": "openai/dall-e", "credits": 5}, "fal endpoint"),
    ({"generator": "fal-ai/flux-pro/kontext"}, "credits"),
    ({"generator": "fal-ai/flux-pro/kontext", "credits": 0}, "credits"),
    ({"generator": "fal-ai/flux-pro/kontext", "credits": 99999}, "credits"),
    ({"generator": "fal-ai/flux-pro/kontext", "credits": True}, "credits"),
    ({"generator": "fal-ai/flux-pro/kontext", "credits": 5, "key": "x"}, "unknown keys"),
    ("fal-ai/flux-pro/kontext", "must be an object"),
])
def test_a_bad_art_block_is_refused(art, fragment):
    assert any(fragment in problem for problem in plans.art_policy_problems(art))
    with pytest.raises(ValueError, match=fragment):
        plans.with_art(None, art)


def test_art_is_off_without_a_block_and_the_budget_is_part_of_the_approved_digest():
    assert plans.art_policy_problems(None) == [] and not artservice.enabled(plans.DEFAULT_POLICY)
    with_art = plans.with_art(None, ART)
    assert artservice.enabled(with_art) and with_art["art"] == ART and "art" not in plans.DEFAULT_POLICY
    build = lambda policy: plans.build_plan("d", 1, plans.parse_requirements(REQ), json.load(open(os.path.join(FIX, "phases.json")))["phases"], policy, fixture=True)
    assert plans.plan_digest(build(with_art)) != plans.plan_digest(build(None))
    assert plans.plan_digest(build(plans.with_art(None, dict(ART, credits=6)))) != plans.plan_digest(build(with_art))
    broken = build(with_art)
    broken["policy"]["art"] = {"generator": "x", "credits": 0}
    assert any("policy.art" in problem for problem in plans.validate_plan(broken))


# -- the service ----------------------------------------------------------------------------------------

def test_only_the_token_opens_the_service(service):
    assert call(service, "/v1/status", token=None)[0] == 401
    assert call(service, "/v1/status", token="guess")[0] == 401
    assert call(service, "/v1/generate", {"prompt": "x"}, token="guess")[0] == 401
    assert not service.fal.calls
    assert call(service, "/v1/status")[0] == 200


def test_a_generation_is_delivered_recorded_and_counted(service):
    status, doc = generate(service, seed=7, issue_id="ffmhero-art-rogue", label="rogue idle sheet")
    assert status == 200 and base64.b64decode(doc["png"]) == PNG and doc["seed"] == 4242 and doc["remaining"] == 4
    assert doc["call_id"] == "art-0001" and len(doc["sha256"]) == 64 and doc["model"] == ART["generator"]
    summary = service.ledger.summary()
    call_entry = summary["calls"][0]
    assert (summary["used"], summary["remaining"], summary["delivered"]) == (1, 4, 1)
    assert call_entry["issue_id"] == "ffmhero-art-rogue" and call_entry["label"] == "rogue idle sheet" and call_entry["sha256"] == doc["sha256"]
    assert "flat magenta" in call_entry["prompt"] and call_entry["seed"] == 4242
    assert oct(os.stat(service.ledger.path).st_mode & 0o777) == "0o600"
    assert call(service, "/v1/status")[1]["remaining"] == 4


def test_a_worker_cannot_choose_the_model_the_size_or_the_output_format(service):
    status, _ = generate(service, model="fal-ai/something-expensive", size=1024, output_format="jpeg", image_size="landscape_16_9")
    assert status == 200
    model, arguments = service.fal.calls[0]
    assert model == ART["generator"] and arguments["image_size"] == {"width": 1024, "height": 1024} and arguments["output_format"] == "png"
    assert set(arguments) <= {"prompt", "image_size", "output_format", "seed", "image_url", "image_urls"}


def test_the_budget_is_enforced_and_survives_a_restart(tmp_path):
    first = artservice.ArtService(str(tmp_path), "plan-a", dict(ART, credits=2), generate=FakeFal(), token="t0ken").start()
    try:
        assert [generate(first)[0] for _ in range(3)] == [200, 200, 402]
    finally:
        first.stop()
    second = artservice.ArtService(str(tmp_path), "plan-a", dict(ART, credits=2), generate=FakeFal(), token="t0ken").start()
    try:
        status, doc = generate(second)
        assert status == 402 and "used up" in doc["error"] and second.ledger.remaining() == 0
    finally:
        second.stop()
    other_plan = artservice.ArtService(str(tmp_path), "plan-b", dict(ART, credits=2), generate=FakeFal(), token="t0ken").start()
    try:
        assert generate(other_plan)[0] == 200, "another plan has its own budget"
    finally:
        other_plan.stop()


def test_concurrent_calls_can_never_overspend(tmp_path):
    svc = artservice.ArtService(str(tmp_path), "plan-a", dict(ART, credits=5), generate=FakeFal(delay=0.05), token="t0ken").start()
    results = []
    try:
        threads = [threading.Thread(target=lambda: results.append(generate(svc, label=str(i))[0])) for i in range(12)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()
    finally:
        svc.stop()
    assert sorted(results).count(200) == 5 and sorted(results).count(402) == 7
    assert svc.ledger.summary()["delivered"] == 5 and len({c["call_id"] for c in svc.ledger.summary()["calls"]}) == 5


def test_a_failed_generation_is_refunded(tmp_path):
    fal = FakeFal(fail="quota exceeded")
    svc = artservice.ArtService(str(tmp_path), "plan-a", ART, generate=fal, token="t0ken").start()
    try:
        status, doc = generate(svc)
        assert status == 502 and "quota exceeded" in doc["error"]
        assert svc.ledger.remaining() == 5 and svc.ledger.summary()["failed"] == 1
        fal.fail, fal.png = None, b"<html>not a png</html>"
        assert generate(svc)[0] == 502 and svc.ledger.remaining() == 5, "a reply that is not a PNG is refunded too"
        fal.png = PNG
        assert generate(svc)[0] == 200 and svc.ledger.remaining() == 4
    finally:
        svc.stop()


def png_b64(extra=b""):
    return base64.b64encode(PNG + extra).decode()


@pytest.mark.parametrize("fields, fragment", [
    ({"prompt": ""}, "prompt"),
    ({"prompt": "x" * 4001}, "prompt"),
    ({"prompt": "use ghp_" + "a" * 36}, "credential"),
    ({"size": 2048}, "size"),
    ({"size": "1024"}, "size"),
    ({"seed": -1}, "seed"),
    ({"seed": "7"}, "seed"),
    ({"seed": 2**31}, "seed"),
    ({"references": [png_b64()] * 3}, "at most 2"),
    ({"references": ["not base64!!"]}, "base64"),
    ({"references": [base64.b64encode(b"GIF89a....").decode()]}, "PNG"),
    ({"references": [png_b64(b"x" * 2_600_000)]}, "PNG of at most"),
])
def test_requests_outside_the_limits_are_refused_before_any_spend(service, fields, fragment):
    status, doc = generate(service, **fields)
    assert status == 400 and fragment in doc["error"], doc
    assert not service.fal.calls and service.ledger.remaining() == 5


def test_references_reach_the_generator_as_data_urls(service):
    assert generate(service, references=[png_b64()])[0] == 200
    _, arguments = service.fal.calls[0]
    assert arguments["image_url"].startswith("data:image/png;base64,")


def test_oversized_or_malformed_bodies_are_refused(service):
    for body, raw in (({}, b"{not json"), ({}, b"")):
        request = urllib.request.Request("http://127.0.0.1:%d/v1/generate" % service.port, data=raw, method="POST",
                                         headers={"Authorization": "Bearer t0ken", "Content-Type": "application/json"})
        with pytest.raises(urllib.error.HTTPError) as err:
            urllib.request.urlopen(request, timeout=10)
        assert err.value.code in (400, 413)
    assert call(service, "/v1/nope")[0] == 404 and not service.fal.calls


def test_the_container_gets_the_address_and_the_token_but_never_a_key(service):
    env = service.container_env()
    assert env == {"ART_SERVICE_URL": "http://host.docker.internal:%d" % service.port, "ART_SERVICE_TOKEN": "t0ken"}
    assert not any("FAL" in name for name in env)
    assert service._server.server_address[0] == "127.0.0.1", "loopback only"


# -- the worker command, against a live service ------------------------------------------------------------

def run_client(svc, *args, env_extra=None):
    env = {"PATH": os.environ["PATH"], "ART_SERVICE_URL": "http://127.0.0.1:%d" % svc.port, "ART_SERVICE_TOKEN": "t0ken"}
    env.update(env_extra or {})
    return subprocess.run([sys.executable, "-I", CLIENT, *args], capture_output=True, text=True, env=env, timeout=60)


def test_the_art_generate_command_writes_the_image_and_prints_the_provenance(service, tmp_path):
    prompt = tmp_path / "p.txt"
    prompt.write_text("pixel art rogue, flat magenta background\n")
    plate = tmp_path / "plate.png"
    plate.write_bytes(PNG)
    out = tmp_path / "sheet.png"
    done = run_client(service, "--prompt-file", str(prompt), "--reference", str(plate), "--seed", "9", "--out", str(out),
                      "--issue", "ffmhero-art-rogue", "--label", "idle")
    assert done.returncode == 0, done.stderr
    printed = json.loads(done.stdout)
    assert out.read_bytes() == PNG and printed["seed"] == 4242 and printed["call_id"] == "art-0001" and "png" not in printed
    assert service.fal.calls[0][1]["seed"] == 9 and service.fal.calls[0][1]["prompt"].startswith("pixel art rogue")
    status = run_client(service, "status")
    assert status.returncode == 0 and json.loads(status.stdout)["remaining"] == 4


def test_the_command_reports_a_used_up_budget_a_refusal_and_a_missing_service_by_exit_code(tmp_path):
    svc = artservice.ArtService(str(tmp_path), "plan-a", dict(ART, credits=1), generate=FakeFal(), token="t0ken").start()
    try:
        out = str(tmp_path / "o.png")
        assert run_client(svc, "--prompt", "one", "--out", out).returncode == 0
        used_up = run_client(svc, "--prompt", "two", "--out", out)
        assert used_up.returncode == 2 and "used up" in used_up.stderr
        refused = run_client(svc, "--prompt", "x" * 5000, "--out", out)
        assert refused.returncode == 3 and "prompt" in refused.stderr
        wrong = run_client(svc, "--prompt", "x", "--out", out, env_extra={"ART_SERVICE_TOKEN": "wrong"})
        assert wrong.returncode == 3 and "unauthorized" in wrong.stderr
    finally:
        svc.stop()
    gone = run_client(svc, "--prompt", "x", "--out", out)
    assert gone.returncode == 4 and "not reachable" in gone.stderr
    none = run_client(svc, "--prompt", "x", "--out", out, env_extra={"ART_SERVICE_URL": "", "ART_SERVICE_TOKEN": ""})
    assert none.returncode == 4 and "no art service" in none.stderr


# -- how the run wires it in -----------------------------------------------------------------------------------

def test_only_implementer_attempts_receive_the_service_and_the_host_gateway(tmp_path, monkeypatch):
    monkeypatch.setenv("HARNESS_WORK_ROOT", str(tmp_path / "w"))
    (tmp_path / "claude.token").write_text("sk-ant-oat01-x")
    src = tmp_path / "src"
    src.mkdir()
    subprocess.run(["git", "init", "-q", "-b", "main", str(src)], check=True)
    subprocess.run(["git", "-C", str(src), "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "i"], check=True)
    launched = []

    class Dummy:
        stdout = iter(())

        def poll(self):
            return 0

    real_popen = subprocess.Popen
    monkeypatch.setattr(subprocess, "Popen", lambda cmd, *a, **kw: (launched.append((cmd, kw.get("env"))) or Dummy()) if cmd[0] == "docker" else real_popen(cmd, *a, **kw))
    adapter = ClaudeCodeAdapter(str(tmp_path), str(src))
    adapter.art_env = {"ART_SERVICE_URL": "http://host.docker.internal:1234", "ART_SERVICE_TOKEN": "run-token"}
    for role in ("implementer", "reviewer", "refiner"):
        handle = adapter.start(WorkRequest("i1#%s" % role, 1, "i1", role, "low", "claude-haiku-5-5", {}, "harness/i1"))
        adapter.cleanup(handle)
    by_role = dict(zip(("implementer", "reviewer", "refiner"), launched))
    cmd, env = by_role["implementer"]
    assert "ART_SERVICE_TOKEN" in cmd and "ART_SERVICE_URL" in cmd and "run-token" not in " ".join(cmd), "forwarded by name only"
    assert cmd[cmd.index("--add-host") + 1] == "host.docker.internal:host-gateway"
    assert env["ART_SERVICE_TOKEN"] == "run-token" and "FAL_KEY" not in env
    for role in ("reviewer", "refiner"):
        cmd, env = by_role[role]
        assert "--add-host" not in cmd and "ART_SERVICE_TOKEN" not in cmd and "ART_SERVICE_TOKEN" not in env


def test_the_worker_is_told_about_art_generate_only_when_the_service_is_on():
    req = WorkRequest("i1#1", 1, "i1", "implementer", "low", "claude-haiku-5-5", {}, "harness/i1")
    assert "art-generate" not in build_prompt(req)
    on = build_prompt(req, art=True)
    assert "art-generate" in on and "asset pipeline" in on and "never look for a key" in on


def test_the_sandbox_requires_the_art_tools_and_no_art_credentials_by_default():
    assert {"art_libs", "art_generate_tool"} <= set(isolation.REQUIRED_CHECKS)
    assert "ART_SERVICE_TOKEN" in isolation.PROBE_SCRIPT and "numpy, scipy, PIL" in isolation.PROBE_SCRIPT
    assert "--add-host" not in isolation.docker_args("/tmp", ["true"])
    assert isolation.docker_args("/tmp", ["true"], host_gateway="host.docker.internal").count("--add-host") == 1
    assert "ART_SERVICE_TOKEN" not in isolation.scrub_env({"ART_SERVICE_TOKEN": "x", "PATH": "/bin"})


@pytest.fixture
def stored_plan(tmp_path):
    store = Store(str(tmp_path / "home"))
    phases = tmp_path / "phases.json"
    phases.write_text(json.dumps({"phases": json.load(open(os.path.join(FIX, "phases.json")))["phases"], "art": ART}))
    result = cli.plan_command(store, REQ, str(phases), plan_id="art-plan", fixture=True)
    assert not result["problems"], result
    yield store
    store.close()


def test_a_plan_takes_its_art_budget_from_phases_json(stored_plan):
    assert stored_plan.get_plan("art-plan", 1)["plan"]["policy"]["art"] == ART


def test_the_run_starts_the_service_only_for_a_real_run_with_a_budget(stored_plan, tmp_path):
    sched = SimpleNamespace(adapter=SimpleNamespace(art_env=None))
    assert runner.start_art_service(stored_plan, "art-plan", 1, sched, dry_run=True) is None and sched.adapter.art_env is None
    service = runner.start_art_service(stored_plan, "art-plan", 1, sched, dry_run=False)
    try:
        assert service is not None and sched.adapter.art_env == service.container_env()
        assert call(service, "/v1/status", token=service.token)[1]["credits"] == 5
    finally:
        service.stop()
    plain = Store(str(tmp_path / "plain"))
    try:
        cli.plan_command(plain, REQ, os.path.join(FIX, "phases.json"), plan_id="plain-plan", fixture=True)
        assert runner.start_art_service(plain, "plain-plan", 1, SimpleNamespace(adapter=SimpleNamespace(art_env=None)), dry_run=False) is None
    finally:
        plain.close()


def test_the_art_command_shows_the_budget_and_recent_calls(stored_plan, capsys):
    svc = artservice.ArtService(stored_plan.home, "art-plan", ART, generate=FakeFal(), token="t0ken").start()
    try:
        generate(svc, issue_id="ffmhero-art-rogue", label="rogue idle")
        generate(svc, issue_id="ffmhero-art-monk", label="monk idle")
    finally:
        svc.stop()
    assert cli.main(["--home", stored_plan.home, "art", "art-plan"]) == 0
    out = capsys.readouterr().out
    assert "2 of 5 images used, 3 left" in out and "ffmhero-art-rogue" in out and "monk idle" in out and "fal-ai/flux-pro/kontext" in out
    assert cli.main(["--home", stored_plan.home, "art", "nope"]) == 2
