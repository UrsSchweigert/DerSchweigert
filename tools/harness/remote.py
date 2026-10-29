"""PIN-locked loopback relay that proxies the local harness dashboard for a tunnel.

The harness GUI itself must stay loopback-only (see docs/harness/security-model.md).
This module is an explicit operator override: it runs on loopback too, and a tunnel
daemon (for example `cloudflared tunnel --url http://127.0.0.1:8443`) is the only
thing that should ever point at it. It adds the one thing the dashboard deliberately
does not have - a PIN gate - and forwards a fixed allowlist of dashboard routes to the
real GUI, rewriting the loopback Host/Origin metadata the GUI requires.

Run through `python -m harness remote`. The PIN is read from ``HARNESS_GUI_PIN``.
"""
from __future__ import annotations

import hashlib
import hmac
import html
import http.client
import json
import os
import secrets
import subprocess
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

MAX_BODY = 16 * 1024 * 1024
MAX_PIN_BODY = 4 * 1024
SESSION_COOKIE = "harness_remote"
MAX_PIN_ATTEMPTS = 5
PIN_LOCKOUT_SECONDS = 15 * 60

GET_UPSTREAM = {"/", "/app.js", "/icons.js", "/api/status", "/api/tasks", "/api/log", "/api/models", "/api/workflow"}
POST_UPSTREAM = {
    "/api/archive",
    "/api/isolation/verify",
    "/api/models/probe",
    "/api/pause",
    "/api/cancel",
    "/api/respond",
    "/api/resume",
}

LOGIN_PAGE = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Harness remote</title>
<style>
  :root { color-scheme: light dark; }
  body { font: 15px/1.5 system-ui, sans-serif; margin: 0; display: grid; min-height: 100vh; place-items: center; background: #111318; color: #e6e8ee; }
  main { width: min(22rem, calc(100vw - 2rem)); padding: 2rem; border: 1px solid #2a2e3a; border-radius: 12px; background: #171a22; }
  h1 { font-size: 1.1rem; margin: 0 0 .4rem; }
  p { color: #9aa1b5; margin: 0 0 1.2rem; }
  input { width: 100%; box-sizing: border-box; padding: .65rem .8rem; border: 1px solid #2a2e3a; border-radius: 8px; background: #0e1015; color: inherit; font: inherit; }
  button { width: 100%; margin-top: .8rem; padding: .65rem; border: 0; border-radius: 8px; background: #3b82f6; color: white; font: inherit; font-weight: 600; cursor: pointer; }
  .error { color: #f87171; margin-top: 1rem; }
</style>
</head>
<body>
<main>
  <h1>Harness remote</h1>
  <p>Enter the PIN to open the dashboard.</p>
  <form method="post" action="/login">
    <input type="password" name="pin" autocomplete="current-password" autofocus required placeholder="PIN" aria-label="PIN">
    <button type="submit">Unlock</button>
  </form>
  __ERROR__
</main>
</body>
</html>"""

LOGIN_CSP = "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"


class RemoteRelay(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, upstream: str, host: str, port: int, pin: str, session_hours: float):
        if host not in ("127.0.0.1", "localhost"):
            raise ValueError("the relay must bind to a loopback interface")
        if not 0 <= port <= 65535:
            raise ValueError("the port must be between 0 and 65535")
        parsed = urlsplit(upstream)
        if parsed.scheme != "http" or not parsed.hostname:
            raise ValueError("upstream must be an http:// URL, e.g. http://127.0.0.1:8765")
        if not pin or not isinstance(pin, str):
            raise ValueError("a PIN is required (set HARNESS_GUI_PIN or pass --pin)")
        self.upstream = parsed
        self.upstream_netloc = parsed.netloc
        self.upstream_origin = "%s://%s" % (parsed.scheme, parsed.netloc)
        self.pin = pin
        self.session_hours = max(0.05, min(24 * 7, session_hours))
        self.secret = secrets.token_bytes(32)
        self.clock = time.time
        self.failures: dict[str, dict] = {}
        self.failures_lock = threading.Lock()
        super().__init__((host, port), RelayHandler)

    @property
    def url(self) -> str:
        return "http://127.0.0.1:%d" % self.server_port

    def make_cookie(self, secure: bool) -> str:
        token = secrets.token_urlsafe(32)
        expiry = int(self.clock() + self.session_hours * 3600)
        payload = "%s.%d" % (token, expiry)
        signature = hmac.new(self.secret, payload.encode("ascii"), hashlib.sha256).hexdigest()
        value = "%s.%s" % (payload, signature)
        attributes = ["%s=%s" % (SESSION_COOKIE, value), "Path=/", "HttpOnly", "SameSite=Strict",
                      "Max-Age=%d" % int(self.session_hours * 3600)]
        if secure:
            attributes.append("Secure")
        return "; ".join(attributes)

    def clear_cookie(self) -> str:
        return "%s=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0" % SESSION_COOKIE

    def verify_cookie(self, value: str) -> bool:
        parts = value.split(".")
        if len(parts) != 3:
            return False
        payload = "%s.%s" % (parts[0], parts[1])
        expected = hmac.new(self.secret, payload.encode("ascii"), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(expected, parts[2]):
            return False
        try:
            return int(parts[1]) > self.clock()
        except ValueError:
            return False

    def client_ip(self, headers) -> str:
        forwarded = headers.get("Cf-Connecting-IP", "")
        return forwarded.strip() or "local"

    def login_allowed(self, ip: str) -> bool:
        with self.failures_lock:
            record = self.failures.get(ip)
            if record is None:
                return True
            if self.clock() - record["first"] >= PIN_LOCKOUT_SECONDS:
                self.failures.pop(ip, None)
                return True
            return record["count"] < MAX_PIN_ATTEMPTS

    def record_failure(self, ip: str) -> None:
        with self.failures_lock:
            record = self.failures.setdefault(ip, {"count": 0, "first": self.clock()})
            record["count"] += 1

    def clear_failures(self, ip: str) -> None:
        with self.failures_lock:
            self.failures.pop(ip, None)


class RelayHandler(BaseHTTPRequestHandler):
    server: RemoteRelay
    protocol_version = "HTTP/1.1"

    def setup(self) -> None:
        super().setup()
        self.connection.settimeout(30)

    def log_message(self, format: str, *args) -> None:
        pass

    # -- responses ---------------------------------------------------------

    def _send(self, code: int, body, content_type: str = "application/json", extra_headers: dict | None = None) -> None:
        if isinstance(body, (dict, list)):
            payload = json.dumps(body).encode("utf-8")
            content_type = "application/json; charset=utf-8"
        elif isinstance(body, str):
            payload = body.encode("utf-8")
            if "charset=" not in content_type:
                content_type += "; charset=utf-8"
        else:
            payload = body
        self.send_response(code)
        self.send_header("Content-Type", content_type + ("; charset=utf-8" if content_type.startswith("text/") else ""))
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Referrer-Policy", "no-referrer")
        for name, value in (extra_headers or {}).items():
            self.send_header(name, value)
        self.send_header("Connection", "close")
        self.end_headers()
        self.wfile.write(payload)
        self.close_connection = True

    def _redirect(self, location: str) -> None:
        self.send_response(303)
        self.send_header("Location", location)
        self.send_header("Content-Length", "0")
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Connection", "close")
        self.end_headers()
        self.close_connection = True

    # -- helpers -----------------------------------------------------------

    def session_cookie(self) -> str | None:
        cookies = self.headers.get("Cookie", "")
        for part in cookies.split(";"):
            name, _, value = part.strip().partition("=")
            if name == SESSION_COOKIE and self.server.verify_cookie(value):
                return value
        return None

    def secure_cookie(self) -> bool:
        return "https" in [item.strip().lower() for item in self.headers.get("X-Forwarded-Proto", "http").split(",")]

    def public_origin(self) -> str:
        scheme = "https" if self.secure_cookie() else "http"
        host = self.headers.get("Host", "")
        if scheme == "https" and host.endswith(":443"):
            host = host[:-4]
        elif scheme == "http" and host.endswith(":80"):
            host = host[:-3]
        return "%s://%s" % (scheme, host)

    def login_page(self, error: str = "") -> str:
        return LOGIN_PAGE.replace("__ERROR__", error)

    def same_origin(self) -> bool:
        origin = self.headers.get("Origin")
        if self.headers.get("Sec-Fetch-Site") == "cross-site":
            return False
        return origin is None or origin == self.public_origin()

    def authed(self, path: str) -> bool:
        """Gate every proxied route. Browsers get the login page; API calls get 401."""
        if self.session_cookie() is not None:
            return True
        if path.startswith("/api/") or "application/json" in self.headers.get("Accept", ""):
            self._send(401, {"error": "a valid PIN session is required"})
        else:
            self._redirect("/login")
        return False

    # -- upstream proxy ----------------------------------------------------

    def _upstream_allowed(self, method: str, path: str) -> bool:
        if method == "GET":
            return path in GET_UPSTREAM or path.startswith("/api/issue/")
        if method == "POST":
            return path in POST_UPSTREAM or path.startswith("/api/workflow/")
        return False

    def proxy(self, method: str) -> None:
        target = urlsplit(self.path)
        if not self._upstream_allowed(method, target.path):
            self._send(404, {"error": "not found"})
            return
        upstream_path = target.path + (("?" + target.query) if target.query else "")
        body = b""
        if method == "POST":
            size = int(self.headers.get("Content-Length", "0"))
            if size < 1 or size > MAX_BODY:
                self._send(413, {"error": "request body is empty or too large"})
                return
            if self.headers.get_content_type() != "application/json" or self.headers.get("Transfer-Encoding"):
                self._send(415, {"error": "a JSON request with a content length is required"})
                return
            body = self.rfile.read(size)
        try:
            connection = http.client.HTTPConnection(self.server.upstream.hostname, self.server.upstream.port or 80, timeout=30)
            try:
                headers = {"Host": self.server.upstream_netloc, "Connection": "close"}
                if method == "POST":
                    headers["Origin"] = self.server.upstream_origin
                    headers["Content-Type"] = self.headers.get("Content-Type", "application/json")
                    headers["Content-Length"] = str(len(body))
                    if self.headers.get("X-Harness-Token"):
                        headers["X-Harness-Token"] = self.headers["X-Harness-Token"]
                connection.request(method, upstream_path, body=body if method == "POST" else None, headers=headers)
                response = connection.getresponse()
                status = response.status
                content_type = response.getheader("Content-Type", "application/json")
                payload = response.read()
                extra = {}
                if response.getheader("Content-Security-Policy"):
                    extra["Content-Security-Policy"] = response.getheader("Content-Security-Policy")
                self._send(status, payload, content_type, extra)
            finally:
                connection.close()
        except (OSError, http.client.HTTPException) as exc:
            self._send(502, {"error": "the harness dashboard is not reachable"})

    # -- handlers ----------------------------------------------------------

    def do_GET(self) -> None:
        target = urlsplit(self.path)
        if target.path == "/login":
            self._send(200, self.login_page(), "text/html", {"Content-Security-Policy": LOGIN_CSP})
            return
        if target.path == "/logout":
            self.send_response(303)
            self.send_header("Location", "/login")
            self.send_header("Set-Cookie", self.server.clear_cookie())
            self.send_header("Content-Length", "0")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Connection", "close")
            self.end_headers()
            self.close_connection = True
            return
        if not self.authed(target.path):
            return
        self.proxy("GET")

    def do_POST(self) -> None:
        target = urlsplit(self.path)
        if target.path == "/login":
            if not self.same_origin():
                self._send(403, {"error": "only same-origin requests are accepted"})
                return
            ip = self.server.client_ip(self.headers)
            if not self.server.login_allowed(ip):
                self._send(429, self.login_page('<p class="error">Too many attempts. Try again later.</p>'),
                           "text/html", {"Content-Security-Policy": LOGIN_CSP})
                return
            size = int(self.headers.get("Content-Length", "0"))
            if size < 1 or size > MAX_PIN_BODY:
                self.server.record_failure(ip)
                self._send(413, self.login_page('<p class="error">Invalid request.</p>'),
                           "text/html", {"Content-Security-Policy": LOGIN_CSP})
                return
            if self.headers.get_content_type() != "application/x-www-form-urlencoded":
                self.server.record_failure(ip)
                self._send(415, self.login_page('<p class="error">Invalid request.</p>'),
                           "text/html", {"Content-Security-Policy": LOGIN_CSP})
                return
            form = parse_qs(self.rfile.read(size).decode("utf-8", errors="replace"))
            submitted = form.get("pin", [""])[0]
            if hmac.compare_digest(submitted.encode("utf-8"), self.server.pin.encode("utf-8")):
                self.server.clear_failures(ip)
                self.send_response(303)
                self.send_header("Location", "/")
                self.send_header("Set-Cookie", self.server.make_cookie(self.secure_cookie()))
                self.send_header("Content-Length", "0")
                self.send_header("Cache-Control", "no-store")
                self.send_header("Connection", "close")
                self.end_headers()
                self.close_connection = True
                return
            self.server.record_failure(ip)
            self._send(401, self.login_page('<p class="error">Wrong PIN.</p>'),
                       "text/html", {"Content-Security-Policy": LOGIN_CSP})
            return
        if target.path == "/logout":
            self.send_response(303)
            self.send_header("Location", "/login")
            self.send_header("Set-Cookie", self.server.clear_cookie())
            self.send_header("Content-Length", "0")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Connection", "close")
            self.end_headers()
            self.close_connection = True
            return
        if not self.same_origin():
            self._send(403, {"error": "only same-origin requests are accepted"})
            return
        if not self.authed(target.path):
            return
        if not self.headers.get("Content-Length"):
            self._send(411, {"error": "a content length is required"})
            return
        self.proxy("POST")


def make_server(upstream: str = "http://127.0.0.1:8765", *, host: str = "127.0.0.1", port: int = 8443,
                pin: str | None = None, session_hours: float = 12.0) -> RemoteRelay:
    return RemoteRelay(upstream, host, port, pin or os.environ.get("HARNESS_GUI_PIN", ""), session_hours)


def serve(upstream: str = "http://127.0.0.1:8765", *, host: str = "127.0.0.1", port: int = 8443,
          pin: str | None = None, session_hours: float = 12.0) -> int:
    relay = make_server(upstream, host=host, port=port, pin=pin, session_hours=session_hours)
    with relay:
        print("Harness relay: " + relay.url + " -> " + upstream, flush=True)
        print("Expose it with: cloudflared tunnel --url " + relay.url, flush=True)
        try:
            relay.serve_forever()
        except KeyboardInterrupt:
            return 130


def load_harness_env(repo_root: Path) -> None:
    """Load ``HARNESS_*`` values from the app env file without overriding the real environment.

    The harness shares ``sites/derschweigert/.env`` (git-ignored), but only keys in
    the ``HARNESS_`` namespace are read, so the app's unrelated secrets are never
    imported into the harness process. The real environment always wins.
    """
    env_file = Path(repo_root) / "sites" / "derschweigert" / ".env"
    if not env_file.is_file():
        return
    for line in env_file.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key.startswith("HARNESS_") and value and key not in os.environ:
            os.environ[key] = value


def tunnel_settings(repo_root: Path) -> dict:
    """The remote-dashboard configuration after reading ``sites/derschweigert/.env``."""
    load_harness_env(repo_root)
    return {
        "pin": os.environ.get("HARNESS_GUI_PIN", "").strip(),
        "name": os.environ.get("HARNESS_TUNNEL_NAME", "").strip(),
        "host": os.environ.get("HARNESS_TUNNEL_HOST", "").strip(),
        "disabled": os.environ.get("HARNESS_NO_TUNNEL", "").strip() == "1",
    }


def tunnel_command(relay_url: str, name: str) -> list[str]:
    """The cloudflared command that points a named (or quick) tunnel at the relay."""
    if name:
        return ["cloudflared", "tunnel", "--no-autoupdate", "run", "--url", relay_url, name]
    return ["cloudflared", "tunnel", "--no-autoupdate", "--url", relay_url]


class RemoteDashboard:
    """Owns a GUI (when started from ``run``), the PIN-locked relay, and the cloudflared tunnel.

    ``gui_server`` is an already-created ``gui.GuiServer`` when the ``gui`` command is the
    owner; pass ``None`` to start a fresh GUI in a daemon thread for ``run``/``resume``.
    """

    def __init__(self, repo_root, home, repo_slug=None, gui_server=None):
        settings = tunnel_settings(Path(repo_root))
        self.pin = settings["pin"]
        self.name = settings["name"]
        self.host = settings["host"]
        self.home = home
        self.repo_slug = repo_slug
        self.gui_server = gui_server
        self.owns_gui = gui_server is None
        self.relay = None
        self.relay_thread = None
        self.process = None
        self.public_url = None

    def start(self) -> str | None:
        if not self.pin:
            raise ValueError("HARNESS_GUI_PIN is not set; cannot start the remote dashboard")
        if self.gui_server is None:
            from . import gui
            self.gui_server = gui.make_server(self.home, port=0)
            self.gui_server.repo_slug = self.repo_slug
        self.relay = make_server(self.gui_server.url, port=0, pin=self.pin)
        self.relay_thread = threading.Thread(target=self.relay.serve_forever,
                                             kwargs={"poll_interval": 0.1}, daemon=True)
        self.relay_thread.start()
        self.process = subprocess.Popen(tunnel_command(self.relay.url, self.name))
        if self.host and self.name:
            self.public_url = "https://" + self.host
            print("Remote dashboard: %s" % self.public_url, flush=True)
        else:
            print("Remote dashboard starting via quick tunnel; watch cloudflared output for the URL.", flush=True)
        return self.public_url

    def stop(self) -> None:
        if self.process is not None and self.process.poll() is None:
            self.process.terminate()
            try:
                self.process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.process.kill()
        if self.relay is not None:
            self.relay.shutdown()
            self.relay.server_close()
        if self.owns_gui and self.gui_server is not None:
            self.gui_server.shutdown()
            self.gui_server.server_close()

