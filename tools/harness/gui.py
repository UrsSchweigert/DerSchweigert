"""Loopback-only harness dashboard. Run through `python -m harness gui`."""
from __future__ import annotations

import base64
import hmac
import json
import os
import secrets
import sqlite3
import subprocess
import sys
import tempfile
import threading
import time
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlsplit

from . import approval, assets, humantasks, runner, status
from .store import Store, default_home

MAX_BODY = 16 * 1024 * 1024


class GuiServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, home: str | None, host: str, port: int, refresh: int, read_only: bool):
        if host not in ("127.0.0.1", "localhost"):
            raise ValueError("the GUI must bind to a loopback interface")
        if not 0 <= port <= 65535:
            raise ValueError("the port must be between 0 and 65535")
        self.home = Path(home or default_home()).expanduser().resolve()
        self.refresh = max(3, min(60, refresh))
        self.read_only = read_only
        self.token = secrets.token_urlsafe(32)
        self.repo_root = Path(__file__).resolve().parents[2]
        self.clock = time.time
        self.actions = threading.Lock()
        self.identity_provider = None
        self._identities = None
        self.repo_slug = None
        self.launcher = subprocess.Popen
        self.processes: dict[str, dict] = {}
        super().__init__(("127.0.0.1", port), GuiHandler)
        self.allowed_hosts = {"127.0.0.1:%d" % self.server_port, "localhost:%d" % self.server_port}
        self.allowed_origins = {"http://" + host for host in self.allowed_hosts}

    @property
    def url(self) -> str:
        return "http://127.0.0.1:%d" % self.server_port

    def identities(self) -> list[str]:
        if self.identity_provider is not None:
            return self.identity_provider()
        if self._identities is None:
            from .cli import responder_ids
            self._identities = responder_ids()
        return self._identities

    def snapshot(self, selected: str = "") -> dict:
        report = status.build_report(str(self.home), self.clock())
        report["checks"] = []
        if (self.home / "harness.sqlite").is_file():
            store = Store(str(self.home), readonly=True)
            try:
                for plan_id in {plan["plan_id"] for plan in report["plans"]}:
                    for key, job in store.get_run(plan_id).get("checks", {}).items():
                        report["checks"].append({
                            "plan_id": plan_id, "stage": key.partition(":")[0], "issue_id": job["issue_id"],
                            "head_rev": job["head_rev"], "base_rev": job["base_rev"], "runner": job["runner"],
                            "lease_expires_in_s": job["lease_until"] - self.clock(),
                        })
            finally:
                store.close()
        if selected:
            report = status.filter_plan(report, selected)
            report["checks"] = [job for job in report["checks"] if job["plan_id"] == selected]
        report["read_only"] = self.read_only
        report["repository"] = self.repo_slug
        report["managed_runs"] = []
        for plan_id, job in tuple(self.processes.items()):
            if selected and plan_id != selected:
                continue
            exit_code = job["process"].poll()
            report["managed_runs"].append({"plan_id": plan_id, "pid": job["process"].pid, "started_at": job["started_at"],
                                           "running": exit_code is None, "exit_code": exit_code})
        return report

    def tasks(self, selected: str = "") -> list[dict]:
        if not (self.home / "harness.sqlite").is_file():
            return []
        store = Store(str(self.home), readonly=True)
        try:
            issue_ids = {issue["issue_id"] for issue in store.list_issues(selected)} if selected else None
            return [dict(task["payload"], task_id=task["task_id"], state=task["state"],
                         age_s=self.clock() - task["created_at"])
                    for task in store.human_tasks() if task["state"] in humantasks.OPEN_STATES
                    and (issue_ids is None or issue_ids.intersection(task["payload"]["issue_ids"]))]
        finally:
            store.close()

    @staticmethod
    def flag(body: dict, key: str) -> bool:
        value = body.get(key, False)
        if type(value) is not bool:
            raise ValueError("%s must be a boolean" % key)
        return value

    def action(self, path: str, body: dict) -> dict:
        if path not in ("/api/pause", "/api/cancel", "/api/respond", "/api/resume"):
            raise KeyError("unknown action")
        if not (self.home / "harness.sqlite").is_file():
            raise runner.RunRefused("the store is not initialized")
        with self.actions:
            store = Store(str(self.home))
            try:
                if path == "/api/respond":
                    return self.respond(store, body)
                plan_id = body.get("plan_id")
                if not isinstance(plan_id, str) or not plan_id:
                    raise ValueError("a plan_id is required")
                current = store.get_plan(plan_id)
                if current is None:
                    raise KeyError("plan not found")
                version = current["plan"]["version"]
                if type(body.get("version")) is not int or body["version"] != version:
                    raise runner.RunRefused("the plan version changed; refresh before retrying")
                if path == "/api/resume":
                    return self.start_run(store, current["plan"], body)
                if path == "/api/pause":
                    state = runner.request_pause(store, plan_id, version, self.flag(body, "now"))
                else:
                    if body.get("confirm") != plan_id:
                        raise ValueError("confirm the exact plan ID before cancelling")
                    state = runner.request_cancel(store, plan_id, version, self.flag(body, "drain"))
                return {"status": state, "plan_id": plan_id, "version": version}
            finally:
                store.close()

    def start_run(self, store: Store, plan: dict, body: dict) -> dict:
        plan_id, version = plan["plan_id"], plan["version"]
        if body.get("confirm") != plan_id:
            raise ValueError("confirm the exact plan ID before starting a live run")
        if body.get("dry_run"):
            raise ValueError("use the CLI for an isolated rehearsal")
        approval.authorize_run(store, plan_id, version, allow_paused=True)
        if not store.list_issues(plan_id):
            raise runner.RunRefused("there are no issues to schedule")
        if any(job["process"].poll() is None for job in self.processes.values()):
            raise runner.RunRefused("a GUI-managed runner is already running")
        heartbeat = plan["policy"]["budgets"]["heartbeat_s"]
        for record in store.docs("runner"):
            active = store.get_plan(record.get("plan", ""))
            if (active and store.state("plan", approval.plan_entity(active["plan"]["plan_id"], active["plan"]["version"])) == "Executing"
                    and self.clock() - record["last_tick"] <= heartbeat * status.HEARTBEAT_STALE_FACTOR):
                raise runner.RunRefused("a runner is already active; pause it before starting another")
        command = [sys.executable, "-m", "harness", "--home", str(self.home), "resume", "--version", str(version)]
        if self.repo_slug:
            command.extend(["--repo", self.repo_slug])
        command.extend(["--", plan_id])
        directory = self.home / "gui-runners"
        directory.mkdir(mode=0o700, exist_ok=True)
        log_path = directory / ("run-" + secrets.token_hex(8) + ".log")
        environment = dict(os.environ, PYTHONPATH=str(Path(__file__).resolve().parents[1]), PYTHONDONTWRITEBYTECODE="1", PYTHONUNBUFFERED="1")
        with log_path.open("x", encoding="utf-8") as output:
            log_path.chmod(0o600)
            process = self.launcher(command, cwd=self.repo_root, env=environment, stdin=subprocess.DEVNULL,
                                    stdout=output, stderr=subprocess.STDOUT, start_new_session=True)
        self.processes[plan_id] = {"process": process, "log": log_path, "started_at": self.clock()}
        return {"status": "starting", "plan_id": plan_id, "pid": process.pid}

    def log_tail(self, plan_id: str) -> dict:
        job = self.processes.get(plan_id)
        if job is None:
            return {"output": "", "running": False}
        with job["log"].open("rb") as source:
            source.seek(0, 2)
            source.seek(max(0, source.tell() - 32768))
            output = source.read().decode("utf-8", errors="replace")
        return {"output": output, "running": job["process"].poll() is None}

    def respond(self, store: Store, body: dict) -> dict:
        task_id = body.get("task_id")
        if not isinstance(task_id, str) or not task_id:
            raise ValueError("a task_id is required")
        identities = self.identities()
        if self.flag(body, "ack"):
            humantasks.acknowledge(store, task_id, identities, "local", self.clock())
            return {"status": "acknowledged"}
        answers = body.get("answers", {})
        if not isinstance(answers, dict):
            raise ValueError("answers must be an object")
        task = store.get_human_task(task_id)
        handler = None
        if task and task["kind"] == "asset":
            issue = store.get_issue(task["issue_id"])
            plan = store.get_plan(issue["plan_id"])["plan"]
            handler = assets.AssetService(store, issue["plan_id"], plan["policy"], str(self.repo_root)).accept_human_asset
        with tempfile.TemporaryDirectory(prefix="harness-gui-upload-") as temporary:
            artifacts = []
            upload = body.get("upload")
            if upload is not None:
                if not isinstance(upload, dict) or not isinstance(upload.get("name"), str) or not isinstance(upload.get("data"), str):
                    raise ValueError("an upload needs a name and base64 data")
                name = upload["name"]
                if not name or Path(name).name != name or "\\" in name or name in (".", ".."):
                    raise ValueError("invalid upload filename")
                artifact = Path(temporary) / name
                artifact.write_bytes(base64.b64decode(upload["data"], validate=True))
                artifacts.append(str(artifact))
            return humantasks.respond(store, task_id, responder_ids=identities, source="local", answers=answers,
                                      now=self.clock(), artifacts=artifacts, asset_handler=handler)


class GuiHandler(BaseHTTPRequestHandler):
    server: GuiServer
    protocol_version = "HTTP/1.1"

    def setup(self) -> None:
        super().setup()
        self.connection.settimeout(10)

    def log_message(self, format: str, *args) -> None:
        pass

    def _send(self, code: int, body, content_type: str = "application/json", nonce: str = "") -> None:
        payload = (json.dumps(body) if content_type == "application/json" else body).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", content_type + "; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Connection", "close")
        self.close_connection = True
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Content-Security-Policy", "default-src 'none'; script-src 'nonce-%s'; style-src 'nonce-%s'; "
                         "connect-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'; form-action 'self'" % (nonce, nonce))
        self.end_headers()
        self.wfile.write(payload)

    def _trusted_request(self) -> bool:
        origin = self.headers.get("Origin")
        if (self.headers.get("Host", "").lower() not in self.server.allowed_hosts
                or origin is not None and origin not in self.server.allowed_origins
                or self.headers.get("Sec-Fetch-Site") == "cross-site"):
            self._send(403, {"error": "only same-origin loopback requests are accepted"})
            return False
        return True

    def do_GET(self) -> None:
        if not self._trusted_request():
            return
        target = urlsplit(self.path)
        try:
            if target.path == "/":
                nonce = secrets.token_urlsafe(24)
                page = Path(__file__).with_name("gui_page.html").read_text(encoding="utf-8")
                page = page.replace("__CSRF__", self.server.token).replace("__REFRESH__", str(self.server.refresh)).replace("__NONCE__", nonce)
                self._send(200, page, "text/html", nonce)
            elif target.path in ("/app.js", "/icons.js"):
                filename = "gui_page.js" if target.path == "/app.js" else "gui_icons.js"
                self._send(200, Path(__file__).with_name(filename).read_text(encoding="utf-8"), "text/javascript")
            elif target.path == "/api/status":
                selected = parse_qs(target.query).get("plan", [""])[0]
                self._send(200, self.server.snapshot(selected))
            elif target.path == "/api/tasks":
                self._send(200, self.server.tasks(parse_qs(target.query).get("plan", [""])[0]))
            elif target.path == "/api/log":
                self._send(200, self.server.log_tail(parse_qs(target.query).get("plan", [""])[0]))
            elif target.path.startswith("/api/issue/"):
                self._send(200, status.issue_detail(str(self.server.home), unquote(target.path.removeprefix("/api/issue/"))))
            else:
                self._send(404, {"error": "not found"})
        except KeyError:
            self._send(404, {"error": "issue not found"})
        except (OSError, sqlite3.Error):
            self._send(503, {"error": "the harness store could not be read"})

    def do_POST(self) -> None:
        if not self._trusted_request():
            return
        token = self.headers.get("X-Harness-Token", "")
        if self.server.read_only or not hmac.compare_digest(token.encode(), self.server.token.encode()):
            self._send(403, {"error": "read-only mode or invalid session token"})
            return
        try:
            size = int(self.headers.get("Content-Length", "0"))
            if size < 1 or size > MAX_BODY:
                self._send(413, {"error": "request body is empty or too large"})
                return
            if self.headers.get_content_type() != "application/json" or self.headers.get("Transfer-Encoding"):
                self._send(415, {"error": "a JSON request with a content length is required"})
                return
            body = json.loads(self.rfile.read(size))
            if not isinstance(body, dict):
                raise ValueError("the request must be a JSON object")
            self._send(200, self.server.action(urlsplit(self.path).path, body))
        except (ValueError, UnicodeDecodeError) as exc:
            self._send(400, {"error": str(exc)})
        except approval.AuthorizationError as exc:
            self._send(403, {"error": str(exc)})
        except humantasks.TaskError as exc:
            self._send(403 if any(term in str(exc) for term in ("authorized", "owner", "worker", "bot")) else 409, {"error": str(exc)})
        except runner.RunRefused as exc:
            self._send(409, {"error": str(exc)})
        except KeyError:
            self._send(404, {"error": "plan, task, or action not found"})
        except (OSError, sqlite3.Error):
            self._send(503, {"error": "the harness store could not be updated"})


def make_server(home: str | None = None, *, host: str = "127.0.0.1", port: int = 8765, refresh: int = 5,
                read_only: bool = False) -> GuiServer:
    return GuiServer(home, host, port, refresh, read_only)


def serve(home: str | None = None, *, host: str = "127.0.0.1", port: int = 8765, refresh: int = 5,
          read_only: bool = False, open_browser: bool = True, repo: str | None = None) -> int:
    dashboard = make_server(home, host=host, port=port, refresh=refresh, read_only=read_only)
    dashboard.repo_slug = repo
    with dashboard:
        print("Harness GUI: " + dashboard.url, flush=True)
        if open_browser:
            webbrowser.open(dashboard.url)
        try:
            dashboard.serve_forever()
        except KeyboardInterrupt:
            return 130
    return 0