import base64
import http.client
import json
import hashlib
import os
from pathlib import Path
import sys
import threading
import time

import pytest

from harness import cli, gui, gui_workflow, isolation, plans
from harness.store import Store
from harness import approval, humantasks
from harness_doubles import Env, TIER_A


@pytest.fixture
def gui_server(tmp_path):
    server = gui.make_server(str(tmp_path / "home"), port=0)
    thread = threading.Thread(target=server.serve_forever, kwargs={"poll_interval": 0.01}, daemon=True)
    thread.start()
    try:
        yield server
    finally:
        server.shutdown()
        thread.join(timeout=5)
        server.server_close()


def request(server, method, path, body=None, headers=None):
    connection = http.client.HTTPConnection(*server.server_address, timeout=5)
    try:
        connection.request(method, path, body=None if body is None else json.dumps(body), headers=headers or {})
        response = connection.getresponse()
        return response.status, dict(response.getheaders()), response.read().decode()
    finally:
        connection.close()


@pytest.fixture
def dashboard_env(gui_server, tmp_path, monkeypatch):
    env = Env(tmp_path)
    gui_server.clock = env.clock
    gui_server.identity_provider = lambda: ["owner"]
    monkeypatch.setattr(approval, "detect_isolation", lambda store: TIER_A)
    try:
        yield env
    finally:
        env.store.close()


def action(server, path, body):
    return request(server, "POST", path, body, {"Content-Type": "application/json", "X-Harness-Token": server.token, "Origin": server.url})


def test_gui_serves_the_dashboard_and_read_only_status(gui_server, tmp_path):
    code, headers, body = request(gui_server, "GET", "/")
    assert code == 200 and "Harness" in body and "__CSRF__" not in body
    assert gui_server.token in body
    assert "frame-ancestors 'none'" in headers["Content-Security-Policy"]
    code, headers, body = request(gui_server, "GET", "/api/status")
    assert code == 200 and json.loads(body)["plans"] == []
    assert not (tmp_path / "home" / "harness.sqlite").exists()


def test_gui_refuses_mutations_without_the_session_token(gui_server):
    code, headers, body = request(gui_server, "POST", "/api/pause", {"plan_id": "anything"},
                                  {"Content-Type": "application/json"})
    assert code == 403
    assert "error" in json.loads(body)


def test_gui_serves_only_allowlisted_local_scripts(gui_server):
    for path in ("/app.js", "/icons.js"):
        code, headers, body = request(gui_server, "GET", path)
        assert code == 200 and body
        assert headers["Content-Type"] == "text/javascript; charset=utf-8"
        assert headers["X-Content-Type-Options"] == "nosniff"
    for path in ("/gui.py", "/../approval.key", "/%2e%2e/approval.key"):
        assert request(gui_server, "GET", path)[0] == 404


def test_gui_rejects_dns_rebinding_hosts(gui_server):
    code, headers, body = request(gui_server, "GET", "/api/status", headers={"Host": "attacker.example"})
    assert code == 403


def test_gui_cannot_bind_to_a_public_interface(tmp_path):
    with pytest.raises(ValueError, match="loopback"):
        gui.make_server(str(tmp_path), host="0.0.0.0", port=0)


def test_gui_pauses_the_selected_plan_through_existing_controls(gui_server, dashboard_env):
    env = dashboard_env
    env.adapter.script("i1", "implementer", "busy")
    env.start()
    env.tick()
    code, headers, body = action(gui_server, "/api/pause", {"plan_id": "fx", "version": 1, "now": True})
    assert code == 200 and env.store.get_run("fx")["pause_now"]
    env.tick()
    assert env.store.state("plan", "fx@v1") == "Paused"


def test_gui_cancel_requires_confirmation_and_preserves_drain(gui_server, dashboard_env):
    env = dashboard_env
    env.adapter.script("i1", "implementer", "busy")
    env.start()
    env.tick()
    payload = {"plan_id": "fx", "version": 1, "drain": True}
    assert action(gui_server, "/api/cancel", payload)[0] == 400
    assert not env.store.get_run("fx").get("cancel_requested")
    assert action(gui_server, "/api/cancel", dict(payload, confirm="fx"))[0] == 200
    assert env.store.get_run("fx")["drain"]


@pytest.mark.parametrize("boundary", ["read_only", "cross_origin", "stale_version"])
def test_gui_rejects_unsafe_management_requests(gui_server, dashboard_env, boundary):
    dashboard_env.start()
    headers = {"Content-Type": "application/json", "X-Harness-Token": gui_server.token, "Origin": gui_server.url}
    payload = {"plan_id": "fx", "version": 1}
    if boundary == "read_only":
        gui_server.read_only = True
    elif boundary == "cross_origin":
        headers["Origin"] = "https://attacker.example"
    else:
        payload["version"] = 2
    code, response_headers, body = request(gui_server, "POST", "/api/pause", payload, headers)
    assert code == (409 if boundary == "stale_version" else 403)
    assert not dashboard_env.store.get_run("fx").get("pause_requested")


@pytest.mark.parametrize("identity,expected", [("owner", 200), ("impostor", 403)])
def test_gui_task_answers_use_server_verified_identity(gui_server, dashboard_env, identity, expected):
    env = dashboard_env
    humantasks.request_task(env.store, task_id="decision", kind="decision", issue_ids=["i1"], owner="owner", now=env.clock(),
                           why="A decision is needed", request="Choose the next action", response_format={"required": ["option"]},
                           resolution_criteria="owner chooses", options=humantasks.DECISION_OPTIONS)
    gui_server.identity_provider = lambda: [identity]
    code, headers, body = request(gui_server, "GET", "/api/tasks?plan=fx")
    assert json.loads(body)[0]["options"] == humantasks.DECISION_OPTIONS
    code, headers, body = action(gui_server, "/api/respond", {"task_id": "decision", "responder_ids": ["owner"],
                                                             "answers": {"option": "retry as is"}})
    assert code == expected
    assert env.store.get_human_task("decision")["state"] == ("Resolved" if identity == "owner" else "Requested")


def test_gui_reports_pending_check_jobs_without_ownership_secrets(gui_server, dashboard_env):
    dashboard_env.store.put_run("fx", {"checks": {"integrated:i1": {"issue_id": "i1", "head_rev": "head", "base_rev": "base",
        "runner": "runner", "lease_until": dashboard_env.clock() + 90, "job_id": "private-job-token", "recovery": {"workdir": "/canary-check-recovery-directory"}}}})
    code, headers, body = request(gui_server, "GET", "/api/status")
    report = json.loads(body)
    assert code == 200 and report["checks"][0]["stage"] == "integrated"
    assert "private-job-token" not in body and "/canary-check-recovery-directory" not in body


def test_gui_asset_upload_is_validated_and_copied_before_temporary_cleanup(gui_server, dashboard_env, tmp_path):
    root = tmp_path / "repository"
    root.mkdir()
    gui_server.repo_root = root
    asset_request = {"request_id": "texture", "issue_id": "i1", "purpose": "reference texture", "asset_class": "texture",
                     "format": "png", "output_path": "assets/reference.png", "source": "repository"}
    humantasks.request_task(dashboard_env.store, task_id="texture", kind="asset", issue_ids=["i1"], owner="owner", now=dashboard_env.clock(),
        why="Texture needed", request="Supply a texture", response_format={"required": ["source", "license", "author"]},
        resolution_criteria="Validated texture", extra={"request": asset_request})
    encoded = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg=="
    code, headers, body = action(gui_server, "/api/respond", {"task_id": "texture", "answers": {"source": "self-made", "license": "CC0-1.0", "author": "owner"},
                                                            "upload": {"name": "reference.png", "data": encoded}})
    assert code == 200 and json.loads(body)["status"] == "resolved"
    assert (root / "assets/reference.png").read_bytes() == base64.b64decode(encoded)
    assert dashboard_env.state("i1") == "Ready"


@pytest.mark.parametrize("upload", [{"name": "../escape.png", "data": "AA=="}, {"name": "safe.png", "data": "not-base64"}])
def test_gui_rejects_malformed_uploads_before_submission(gui_server, dashboard_env, upload):
    humantasks.request_task(dashboard_env.store, task_id="decision", kind="decision", issue_ids=["i1"], owner="owner", now=dashboard_env.clock(),
        why="Decision needed", request="Choose", response_format={"required": ["option"]}, resolution_criteria="Owner chooses", options=humantasks.DECISION_OPTIONS)
    assert action(gui_server, "/api/respond", {"task_id": "decision", "answers": {"option": "retry as is"}, "upload": upload})[0] == 400
    assert dashboard_env.store.get_human_task("decision")["state"] == "Requested"


@pytest.mark.parametrize("stale", [False, True])
def test_gui_manual_results_remain_bound_to_the_tested_revision(gui_server, dashboard_env, stale):
    env = dashboard_env
    issue = env.store.get_issue("i1")
    issue["head_rev"] = "tested-head"
    env.store.put_issue(issue)
    humantasks.request_task(env.store, task_id="manual", kind="manual_test", issue_ids=["i1"], owner="owner", now=env.clock(),
        why="Visual judgment", request="Inspect the reviewed head", response_format={"required": ["outcome", "tester", "revision"]},
        resolution_criteria="Pass with evidence", extra={"tested_head": "tested-head", "evidence_required": ["screenshot"]}, block_issues=False)
    if stale:
        issue["head_rev"] = "replacement-head"
        env.store.put_issue(issue)
    code, headers, body = action(gui_server, "/api/respond", {"task_id": "manual", "answers": {"outcome": "pass", "tester": "owner", "revision": "tested-head", "evidence": ["screenshot-ref"]}})
    assert code == 200 and json.loads(body)["status"] == ("stale" if stale else "resolved")
    assert len(env.store.evidence("i1", "manual")) == (0 if stale else 1)


def test_gui_launches_a_fixed_approved_runner_and_refuses_duplicates(gui_server, dashboard_env):
    calls = []
    class Process:
        pid = 12345
        def poll(self):
            return None
    def launch(command, **kwargs):
        calls.append((command, kwargs))
        return Process()
    gui_server.launcher = launch
    payload = {"plan_id": "fx", "version": 1, "confirm": "fx"}
    assert action(gui_server, "/api/resume", payload)[0] == 200
    command, options = calls[0]
    assert command[-2:] == ["--", "fx"] and "resume" in command
    assert "shell" not in options and options["start_new_session"] is True
    assert action(gui_server, "/api/resume", payload)[0] == 409 and len(calls) == 1


def test_gui_cannot_launch_without_consent_or_verified_isolation(gui_server, dashboard_env, monkeypatch):
    assert action(gui_server, "/api/resume", {"plan_id": "fx", "version": 1})[0] == 400
    monkeypatch.setattr(approval, "detect_isolation", lambda store: {"tier": "B", "reason": "not verified"})
    assert action(gui_server, "/api/resume", {"plan_id": "fx", "version": 1, "confirm": "fx"})[0] == 403
    assert not (gui_server.home / "gui-runners").exists()


def test_gui_status_uses_a_stable_process_snapshot(gui_server):
    class Process:
        pid = 12345
        def poll(self):
            gui_server.processes.setdefault("later", {"process": self, "started_at": 2})
            return 0
    gui_server.processes["first"] = {"process": Process(), "started_at": 1}
    code, headers, body = request(gui_server, "GET", "/api/status")
    assert code == 200
    assert json.loads(body)["managed_runs"] == [{"plan_id": "first", "pid": 12345, "started_at": 1, "running": False, "exit_code": 0}]


def test_gui_does_not_duplicate_a_healthy_external_runner(gui_server, dashboard_env):
    dashboard_env.start()
    dashboard_env.tick()
    assert action(gui_server, "/api/resume", {"plan_id": "fx", "version": 1, "confirm": "fx"})[0] == 409
    assert not (gui_server.home / "gui-runners").exists()


def test_cli_exposes_the_local_dashboard_without_initializing_a_store(tmp_path, monkeypatch):
    from harness import cli
    calls = []
    monkeypatch.setattr(gui, "serve", lambda home, **kwargs: calls.append((home, kwargs)) or 0)
    home = str(tmp_path / "unused")
    assert cli.main(["--home", home, "gui", "--port", "9988", "--read-only", "--no-browser"]) == 0
    assert calls[0][1]["port"] == 9988 and calls[0][1]["read_only"] and not calls[0][1]["open_browser"]
    assert not (tmp_path / "unused").exists()


def new_workspace(server, text="# Wishes\n\nKeep offline support.\n\n- Add a search box\n- Show matches"):
    code, _, body = action(server, "/api/workflow/preview", {"markdown": text})
    assert code == 200
    rows = json.loads(body)["requirements"]
    code, _, body = action(server, "/api/workflow/create", {"markdown": text, "name": "Wishes.md", "requirements": rows})
    assert code == 200
    return json.loads(body)


def write_draft(server, record):
    store = Store(str(server.home))
    try:
        root = gui_workflow.directory(store, record["workspace_id"]) / "draft"
    finally:
        store.close()
    root.mkdir(exist_ok=True)
    phase = {"id": "P1", "outcomes": ["Search works"], "requirements": [r["id"] for r in record["requirements"]],
             "path_allowlist": ["sites/lesen/"], "non_goals": [], "dependencies": [], "exit_criteria": ["Tests pass"],
             "validation": ["node --test"]}
    issue = {"issue_id": "search-box", "phase_id": "P1", "requirement_ids": phase["requirements"], "title": "Search",
             "outcomes": ["Search works"], "acceptance_criteria": ["Results shown"], "non_goals": [],
             "code_anchors": ["sites/lesen/"], "validation_commands": ["node --test"]}
    (root / "phases.json").write_text(json.dumps({"phases": [phase]}))
    (root / "issues.json").write_text(json.dumps({"issues": [issue]}))
    (root / "investigation-report.md").write_text("# Search plan\n\nReview the search scope.")
    return root, phase, issue


def test_gui_extracts_and_edits_requirements_without_losing_source(gui_server):
    record = new_workspace(gui_server)
    assert [r["id"] for r in record["requirements"]] == ["R1", "R2", "R3"]
    store = Store(str(gui_server.home))
    try:
        root = gui_workflow.directory(store, record["workspace_id"])
        assert (root / "source.md").read_text().startswith("# Wishes")
        parsed = plans.parse_requirements(str(root / "requirements.md"))
        assert parsed == record["requirements"]
        rows = [dict(parsed[0], title="Edited requirement | with punctuation")]
        edited = gui_workflow.create(store, {"markdown": "Original wording.", "name": "../anything.md", "requirements": rows})
        path = gui_workflow.directory(store, edited["workspace_id"]) / "requirements.md"
        assert "Edited requirement &#124; with punctuation" in path.read_text()
        assert "Original wording." in path.read_text()
        assert path.stat().st_mode & 0o777 == 0o600
    finally:
        store.close()
    code, _, body = request(gui_server, "GET", "/api/workflow?workspace=" + record["workspace_id"])
    assert code == 200 and json.loads(body)["requirements"] == record["requirements"]


def test_gui_keeps_existing_requirement_ids_and_handles_multiline_lists(gui_server):
    text = "# Title\n\n1. First item\n   continued here\n2. Second item\n\nA whole\nparagraph."
    assert [r["title"] for r in gui_workflow.requirements_from_markdown(text)] == [
        "First item continued here", "Second item", "A whole paragraph."]
    table = "| **2.1** | **Offline** | details |\n| **R9** | **Search** |"
    assert [r["id"] for r in gui_workflow.requirements_from_markdown(table)] == ["2.1", "R9"]
    for text in ("", "  ", "# Only a heading", "a" * (1024 * 1024 + 1)):
        assert action(gui_server, "/api/workflow/preview", {"markdown": text})[0] == 400
    for rows in ([{"id": "../escape", "title": "bad"}], [{"id": "R1", "title": ""}],
                 [{"id": "R1", "title": "One"}, {"id": "R1", "title": "Two"}]):
        assert action(gui_server, "/api/workflow/create", {"markdown": "Text", "requirements": rows})[0] == 400


def test_gui_starts_fixed_noninteractive_preparation_and_blocks_duplicates(gui_server, monkeypatch):
    monkeypatch.setattr(approval, "detect_isolation", lambda store: TIER_A)
    record = new_workspace(gui_server)
    calls = []

    class Process:
        pid = os.getpid()
        def poll(self):
            return None

    def launch(command, **kwargs):
        calls.append((command, kwargs))
        return Process()

    gui_server.launcher = launch
    payload = {"workspace_id": record["workspace_id"]}
    assert action(gui_server, "/api/workflow/investigate", payload)[0] == 200
    command, options = calls[0]
    assert command[1:3] == ["-m", "harness.gui_workflow"]
    assert options["stdin"] == gui.subprocess.DEVNULL and "shell" not in options
    assert action(gui_server, "/api/workflow/investigate", payload)[0] == 409
    assert len(calls) == 1
    report = json.loads(request(gui_server, "GET", "/api/workflow?workspace=" + record["workspace_id"])[2])
    assert report["job"]["state"] == "running"
    assert report["job"]["pid"] == os.getpid()


def test_gui_workflow_reuses_preflight_signed_approval_and_import(gui_server, monkeypatch):
    monkeypatch.setattr(approval, "detect_isolation", lambda store: TIER_A)
    gui_server.identity_provider = lambda: ["trusted-local-owner"]
    record = new_workspace(gui_server)
    root, phase, issue = write_draft(gui_server, record)
    store = Store(str(gui_server.home))
    calls = []

    def preflight(store, repo_root, checks, key):
        calls.append(checks)
        return {"head": "base", "results": [], "checked_at": 1}

    monkeypatch.setattr(cli, "preflight_checks", preflight)
    try:
        record["job"] = {"id": "test", "kind": "plan", "state": "running"}
        assert gui_workflow.execute(store, record) == "succeeded"
        current = store.get_plan(record["plan_id"])
        proof = store.get_doc("check_preflight", approval.plan_entity(record["plan_id"], 1))
        assert proof["issue_digest"] == hashlib.sha256(plans.canonical([issue])).hexdigest()
        assert len(calls[0]) == 2  # Phase and issue-specific checks both preflight.
        payload = {"workspace_id": record["workspace_id"], "version": 1, "digest": current["digest"]}
        assert action(gui_server, "/api/workflow/approve", payload)[0] == 400
        assert action(gui_server, "/api/workflow/approve", dict(payload, version=2, confirm=current["digest"][:12]))[0] == 409
        payload["confirm"] = current["digest"][:12]
        assert action(gui_server, "/api/workflow/approve", payload)[0] == 200
        signed = approval.verify_approval(store, record["plan_id"], 1)
        assert signed["approver"] == "trusted-local-owner"
        assert not store.list_issues(record["plan_id"])
        record["job"] = {"kind": "import", "version": 1, "digest": current["digest"]}
        assert gui_workflow.execute(store, record) == "succeeded"
        assert store.state("issue", "search-box") == "Ready"
        assert store.get_issue("search-box")["plan_id"] == record["plan_id"]
        assert not store.get_run(record["plan_id"])
    finally:
        store.close()


def test_gui_rejects_changed_draft_and_configuration_failures(gui_server, monkeypatch):
    monkeypatch.setattr(approval, "detect_isolation", lambda store: TIER_A)
    record = new_workspace(gui_server)
    root, phase, issue = write_draft(gui_server, record)
    store = Store(str(gui_server.home))
    monkeypatch.setattr(cli, "preflight_checks", lambda *args: {
        "head": "base", "results": [{"kind": "configuration", "command": "node --test", "output": "missing tool"}]})
    try:
        record["job"] = {"id": "test", "kind": "plan"}
        with pytest.raises(gui.runner.RunRefused, match="configuration"):
            gui_workflow.execute(store, record)
        current = store.get_plan(record["plan_id"])
        payload = {"workspace_id": record["workspace_id"], "version": 1,
                   "digest": current["digest"], "confirm": current["digest"][:12]}
        gui_server.identity_provider = lambda: ["owner"]
        assert action(gui_server, "/api/workflow/approve", payload)[0] == 403
        issue["acceptance_criteria"] = ["Changed after preflight"]
        (root / "issues.json").write_text(json.dumps({"issues": [issue]}))
        assert action(gui_server, "/api/workflow/approve", payload)[0] == 409
        assert store.get_approval(record["plan_id"], 1) is None
    finally:
        store.close()


def test_gui_investigator_questions_and_feedback_continue_noninteractively(gui_server, monkeypatch):
    monkeypatch.setattr(approval, "detect_isolation", lambda store: TIER_A)
    record = new_workspace(gui_server)
    captured = []
    monkeypatch.setattr(cli, "main", lambda args: captured.append(args) or 3)
    store = Store(str(gui_server.home))
    try:
        record["job"] = {"id": "answers", "kind": "investigate", "answers": {"q1": "Offline"}, "feedback": "Keep it local."}
        assert gui_workflow.execute(store, record) == "needs_answers"
        args = captured[0]
        assert "--non-interactive" in args and args[args.index("--feedback") + 1] == "Keep it local."
        assert json.loads(Path(args[args.index("--answers") + 1]).read_text()) == {"q1": "Offline"}
    finally:
        store.close()


def test_gui_archives_only_selected_done_issues_and_restores_without_deleting(gui_server, dashboard_env):
    env = dashboard_env
    env.store.cx.execute("UPDATE entities SET state='Done' WHERE machine='issue' AND id='i1'")
    env.store.put_issue(dict(env.store.get_issue("i1"), issue_id="i2"))
    assert action(gui_server, "/api/archive", {"issue_ids": ["i1", "i2"], "archived": True})[0] == 409
    assert env.store.get_doc("gui_archive", "i1") is None
    before = env.store.get_issue("i1")
    assert action(gui_server, "/api/archive", {"issue_ids": ["i1"], "archived": True})[0] == 200
    assert json.loads(request(gui_server, "GET", "/api/status")[2])["archived_issues"] == ["i1"]
    assert env.store.get_issue("i1") == before and env.state("i1") == "Done"
    assert request(gui_server, "GET", "/api/issue/i1")[0] == 200
    assert action(gui_server, "/api/archive", {"issue_ids": ["i1"], "archived": False})[0] == 200
    assert not json.loads(request(gui_server, "GET", "/api/status")[2])["archived_issues"]


@pytest.mark.parametrize("path,body", [
    ("/api/workflow/create", {"markdown": "Text"}),
    ("/api/workflow/investigate", {"workspace_id": "x"}),
    ("/api/workflow/approve", {"workspace_id": "x"}),
    ("/api/archive", {"issue_ids": ["i1"], "archived": True}),
    ("/api/isolation/verify", {}),
])
def test_gui_new_mutations_obey_read_only_and_csrf(gui_server, path, body):
    assert request(gui_server, "POST", path, body, {"Content-Type": "application/json"})[0] == 403
    gui_server.read_only = True
    assert action(gui_server, path, body)[0] == 403


def test_gui_daily_verification_can_start_in_tier_b_without_a_plan(gui_server, monkeypatch):
    monkeypatch.setattr(approval, "detect_isolation", lambda store: {"tier": "B", "reason": "expired"})
    calls = []

    class Process:
        pid = os.getpid()
        def poll(self):
            return None

    def launch(command, **kwargs):
        calls.append((command, kwargs))
        return Process()

    gui_server.launcher = launch
    assert action(gui_server, "/api/isolation/verify", {})[0] == 200
    command, options = calls[0]
    assert "--maintenance" in command and "--workspace" not in command
    assert "shell" not in options and options["stdin"] == gui.subprocess.DEVNULL
    assert action(gui_server, "/api/isolation/verify", {})[0] == 409
    record = json.loads(request(gui_server, "GET", "/api/status")[2])["isolation_verification"]
    assert record["job"]["state"] == "running"
    store = Store(str(gui_server.home))
    try:
        assert not store.list_plans()
        workspace = gui_workflow.create(store, {"name": "Text", "markdown": "Text", "requirements": [{"id": "R1", "title": "Text"}]})
    finally:
        store.close()
    monkeypatch.setattr(approval, "detect_isolation", lambda store: TIER_A)
    assert action(gui_server, "/api/workflow/investigate", {"workspace_id": workspace["workspace_id"]})[0] == 409


@pytest.mark.parametrize("ok", [True, False])
def test_gui_verification_job_uses_real_attestation_signing_and_reports_failures(gui_server, monkeypatch, ok):
    store = Store(str(gui_server.home))
    store.put_doc("gui_maintenance", "isolation", {"job": {"id": "test", "kind": "isolation", "state": "running"}})
    monkeypatch.setattr(isolation, "probe", lambda home: {
        "ok": ok, "reason": "test probe", "image_id": "test-image",
        "checks": {name: ok for name in isolation.REQUIRED_CHECKS}})
    monkeypatch.setattr(isolation, "image_id", lambda: "test-image")
    monkeypatch.setattr(sys, "argv", ["gui_workflow", "--home", str(gui_server.home), "--maintenance", "--job", "test"])
    try:
        assert approval.detect_isolation(store)["tier"] == "B"
        assert gui_workflow.main() == (0 if ok else 1)
        report = gui_workflow.maintenance_detail(store)
        assert report["job"]["state"] == ("succeeded" if ok else "failed")
        assert approval.detect_isolation(store)["tier"] == ("A" if ok else "B")
        if not ok:
            assert "verification failed" in report["job"]["error"]
            assert not (gui_server.home / "isolation.json").exists()
    finally:
        store.close()


def test_gui_workflow_continuation_keeps_revision_feedback(gui_server, monkeypatch):
    monkeypatch.setattr(approval, "detect_isolation", lambda store: TIER_A)
    record = new_workspace(gui_server)
    store = Store(str(gui_server.home))
    record["revision_feedback"] = "Keep the existing IDs."
    record["job"] = {"kind": "investigate", "id": "earlier", "state": "needs_answers"}
    store.put_doc("gui_workspace", record["workspace_id"], record)
    root, _, _ = write_draft(gui_server, record)
    (root / "investigation.json").write_text(json.dumps({"pending": [{"id": "q1", "question": "Which option?", "why": "Ambiguous"}]}))

    class Process:
        pid = os.getpid()
        def poll(self):
            return None

    gui_server.launcher = lambda *args, **kwargs: Process()
    try:
        assert action(gui_server, "/api/workflow/investigate", {"workspace_id": record["workspace_id"], "answers": {"q1": "Local"}})[0] == 200
        job = gui_workflow.workspace(store, record["workspace_id"])["job"]
        assert job["feedback"] == "Keep the existing IDs."
        assert job["answers"] == {"q1": "Local"}
    finally:
        store.close()


def test_gui_dead_job_is_reported_as_failed_and_launch_failure_can_retry(gui_server, monkeypatch):
    monkeypatch.setattr(approval, "detect_isolation", lambda store: TIER_A)
    record = new_workspace(gui_server)
    store = Store(str(gui_server.home))
    record["job"] = {"kind": "investigate", "id": "earlier", "state": "running", "pid": 987654321}
    store.put_doc("gui_workspace", record["workspace_id"], record)
    try:
        assert not gui_workflow.job_alive({"state": "running", "started_at": 1})
        assert gui_workflow.detail(store, record["workspace_id"])["job"]["state"] == "failed"
        def fail(*args, **kwargs):
            raise OSError("test launch failure")
        gui_server.launcher = fail
        assert action(gui_server, "/api/workflow/investigate", {"workspace_id": record["workspace_id"]})[0] == 503
        job = gui_workflow.workspace(store, record["workspace_id"])["job"]
        assert job["state"] == "failed" and "test launch failure" in job["error"]
        assert action(gui_server, "/api/workflow/investigate", {"workspace_id": record["workspace_id"]})[0] == 503
    finally:
        store.close()


@pytest.mark.parametrize("blocker", ["collision", "questions"])
def test_gui_approval_blocks_issue_id_collisions_and_pending_questions(gui_server, dashboard_env, monkeypatch, blocker):
    gui_server.identity_provider = lambda: ["owner"]
    record = new_workspace(gui_server)
    root, _, issue = write_draft(gui_server, record)
    if blocker == "collision":
        issue["issue_id"] = "i1"
        (root / "issues.json").write_text(json.dumps({"issues": [issue]}))
    monkeypatch.setattr(cli, "preflight_checks", lambda *args: {"head": "base", "results": []})
    store = Store(str(gui_server.home))
    try:
        record["job"] = {"kind": "plan"}
        assert gui_workflow.execute(store, record) == "succeeded"
        current = store.get_plan(record["plan_id"])
        if blocker == "questions":
            (root / "investigation.json").write_text(json.dumps({"pending": [{"id": "q1"}]}))
        code, _, body = action(gui_server, "/api/workflow/approve", {
            "workspace_id": record["workspace_id"], "version": 1,
            "digest": current["digest"], "confirm": current["digest"][:12]})
        assert code == 409
        assert ("another plan" if blocker == "collision" else "pending questions") in json.loads(body)["error"]
        assert store.get_approval(record["plan_id"], 1) is None
    finally:
        store.close()


def test_gui_actual_preparation_subprocess_persists_failure_without_tier_a(gui_server):
    record = new_workspace(gui_server)
    record["job"] = {"id": "subprocess", "kind": "plan", "state": "running"}
    store = Store(str(gui_server.home))
    try:
        gui_server.launch_preparation(store, record, record["workspace_id"])
        process = gui_server.preparations["subprocess"]
        assert process.wait(timeout=10) == 1
        detail = gui_workflow.detail(store, record["workspace_id"])
        assert detail["job"]["state"] == "failed"
        assert detail["job"]["pid"] == process.pid
        assert "Tier A isolation verification is required" in detail["output"]
        assert "Tier A isolation verification is required" in detail["job"]["error"]
        assert not store.list_plans()
    finally:
        store.close()

# -- the model picker panel ----------------------------------------------------------------------------

def wait_for(predicate, timeout=5.0):
    deadline = time.time() + timeout
    while time.time() < deadline:
        if predicate():
            return True
        time.sleep(0.01)
    return False


def models_state(server):
    return json.loads(request(server, "GET", "/api/models")[2])


def fake_probe(calls, checked_at=7.0):
    def probe(home, sources, repo_root, refresh=False):
        calls.append({"sources": list(sources), "repo_root": repo_root, "refresh": refresh})
        return {"sources": list(sources), "menu": {}, "candidates": ["claude-haiku-4.5"], "available": ["claude-haiku-4.5"],
                "reachable": True, "reason": "", "checked_at": checked_at}
    return probe


def test_the_models_panel_shows_the_menu_and_the_cached_probe(gui_server, tmp_path):
    (tmp_path / "home").mkdir(exist_ok=True)
    (tmp_path / "home" / "models.json").write_text(json.dumps(
        {"checked_at": 100, "candidates": ["claude-haiku-4.5"], "models": ["claude-haiku-4.5"]}))
    state = models_state(gui_server)
    assert state["sources"] == ["copilot", "deepseek", "local"]
    assert state["menu"]["low"][0] == "claude-haiku-4.5" and state["catalog"]["copilot"]["strong"]
    assert state["cache"]["available"] == ["claude-haiku-4.5"] and state["cache"]["checked_at"] == 100
    assert state["read_only"] is False and state["probing"] is False and state["probe"] is None
    assert state["min_interval_s"] == gui.MODEL_PROBE_MIN_INTERVAL_S


def test_the_dashboard_has_the_models_view(gui_server):
    code, _, body = request(gui_server, "GET", "/")
    assert code == 200 and 'data-view="models"' in body and 'id="view-models"' in body and 'id="probe-models"' in body


def test_the_gui_probes_the_chosen_sources_in_the_background(gui_server):
    calls = []
    gui_server.probe_runner = fake_probe(calls)
    code, _, body = action(gui_server, "/api/models/probe", {"sources": ["deepseek", "local"]})
    assert code == 200 and json.loads(body) == {"status": "probing", "sources": ["deepseek", "local"]}
    assert wait_for(lambda: models_state(gui_server)["probe"] is not None)
    state = models_state(gui_server)
    assert state["probing"] is False and state["probe"]["available"] == ["claude-haiku-4.5"]
    assert calls == [{"sources": ["deepseek", "local"], "repo_root": str(gui_server.repo_root), "refresh": True}]
    assert state["probe_after_s"] > 0  # the next probe waits for the interval


def test_a_failing_probe_is_reported_not_raised(gui_server):
    def failing(home, sources, repo_root, refresh=False):
        raise RuntimeError("docker is not available")
    gui_server.probe_runner = failing
    assert action(gui_server, "/api/models/probe", {})[0] == 200
    assert wait_for(lambda: models_state(gui_server)["probe_error"])
    state = models_state(gui_server)
    assert "docker is not available" in state["probe_error"] and state["probe"] is None and state["probing"] is False


def test_a_probe_is_rate_limited(gui_server):
    now = [1000.0]
    gui_server.clock = lambda: now[0]
    gui_server.probe_runner = fake_probe([])
    assert action(gui_server, "/api/models/probe", {"sources": ["copilot"]})[0] == 200
    assert wait_for(lambda: not models_state(gui_server)["probing"])
    now[0] += 5
    code, _, body = action(gui_server, "/api/models/probe", {"sources": ["copilot"]})
    assert code == 400 and "probe again in" in json.loads(body)["error"]
    now[0] += gui.MODEL_PROBE_MIN_INTERVAL_S
    assert action(gui_server, "/api/models/probe", {"sources": ["copilot"]})[0] == 200


def test_one_probe_at_a_time(gui_server):
    release = threading.Event()
    gui_server.probe_runner = lambda home, sources, repo_root, refresh=False: release.wait(5) or {"available": [], "reachable": True, "reason": "", "checked_at": 1.0}
    assert action(gui_server, "/api/models/probe", {"sources": ["copilot"]})[0] == 200
    code, _, body = action(gui_server, "/api/models/probe", {"sources": ["copilot"]})
    assert code == 400 and "already running" in json.loads(body)["error"]
    release.set()
    assert wait_for(lambda: not models_state(gui_server)["probing"])


@pytest.mark.parametrize("body, message", [
    ({"sources": []}, "at least one"),
    ({"sources": ["mainframe"]}, "unknown model source"),
    ({"sources": "copilot"}, "list of source names"),
])
def test_the_probe_rejects_bad_source_lists(gui_server, body, message):
    code, _, payload = action(gui_server, "/api/models/probe", body)
    assert code == 400 and message in json.loads(payload)["error"]


def test_a_read_only_dashboard_shows_the_menu_but_does_not_probe(tmp_path):
    server = gui.make_server(str(tmp_path / "home"), port=0, read_only=True)
    thread = threading.Thread(target=server.serve_forever, kwargs={"poll_interval": 0.01}, daemon=True)
    thread.start()
    try:
        state = models_state(server)
        assert state["read_only"] is True and state["menu"]["low"] and state["probing"] is False
        code, _, body = action(server, "/api/models/probe", {"sources": ["copilot"]})
        assert code == 403 and "read-only" in json.loads(body)["error"]
    finally:
        server.shutdown()
        thread.join(timeout=5)
        server.server_close()
