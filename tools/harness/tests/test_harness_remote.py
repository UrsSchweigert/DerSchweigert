import http.client
import json
import os
import threading
from urllib.parse import urlencode

import pytest

from harness import gui, remote


@pytest.fixture
def upstream_gui(tmp_path):
    server = gui.make_server(str(tmp_path / "home"), port=0)
    thread = threading.Thread(target=server.serve_forever, kwargs={"poll_interval": 0.01}, daemon=True)
    thread.start()
    try:
        yield server
    finally:
        server.shutdown()
        thread.join(timeout=5)
        server.server_close()


@pytest.fixture
def relay(upstream_gui):
    server = remote.make_server("http://127.0.0.1:%d" % upstream_gui.server_port, port=0, pin="secret-pin")
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
        connection.request(method, path, body=body, headers=headers or {})
        response = connection.getresponse()
        return response.status, dict(response.getheaders()), response.read().decode()
    finally:
        connection.close()


def cookie_from(headers):
    value = headers.get("Set-Cookie", "")
    return value.split(";", 1)[0].strip()


def login(relay_server, pin="secret-pin"):
    body = urlencode({"pin": pin})
    return request(relay_server, "POST", "/login", body,
                   {"Content-Type": "application/x-www-form-urlencoded", "Origin": relay_server.url})


def test_remote_serves_login_page_without_a_session(relay):
    code, headers, body = request(relay, "GET", "/login")
    assert code == 200 and "Unlock" in body
    assert "frame-ancestors 'none'" in headers["Content-Security-Policy"]


def test_remote_redirects_browser_and_401s_api_without_a_session(relay):
    code, headers, body = request(relay, "GET", "/")
    assert code == 303 and headers["Location"] == "/login"
    code, headers, body = request(relay, "GET", "/api/status")
    assert code == 401 and json.loads(body)["error"]


def test_remote_login_then_proxies_the_dashboard(relay, upstream_gui):
    code, headers, body = login(relay)
    assert code == 303 and cookie_from(headers).startswith("harness_remote=")
    assert "HttpOnly" in headers["Set-Cookie"] and "SameSite=Strict" in headers["Set-Cookie"]
    cookie = {"Cookie": cookie_from(headers)}
    code, headers, body = request(relay, "GET", "/", headers=cookie)
    assert code == 200 and "Harness" in body and upstream_gui.token in body
    code, headers, body = request(relay, "GET", "/api/status", headers=cookie)
    assert code == 200 and json.loads(body)["plans"] == []


def test_remote_rejects_wrong_pin_without_a_cookie(relay):
    code, headers, body = login(relay, "wrong")
    assert code == 401 and "Wrong PIN" in body
    assert "Set-Cookie" not in headers


def test_remote_locks_out_after_repeated_failures(relay):
    for _ in range(remote.MAX_PIN_ATTEMPTS):
        assert login(relay, "wrong")[0] == 401
    code, headers, body = login(relay, "wrong")
    assert code == 429 and "Too many attempts" in body


def test_remote_forwards_mutations_with_rewritten_loopback_headers(relay, upstream_gui):
    code, headers, body = login(relay)
    cookie = {"Cookie": cookie_from(headers), "X-Harness-Token": upstream_gui.token,
              "Content-Type": "application/json", "Origin": relay.url}
    code, headers, body = request(relay, "POST", "/api/pause", json.dumps({"plan_id": "fx"}),
                                  cookie)
    # The upstream accepted the loopback rewrite and answered from its own logic
    # (no store yet), rather than rejecting the request as cross-site or tokenless.
    assert code == 409
    assert "store is not initialized" in json.loads(body)["error"]


def test_remote_does_not_proxy_unlisted_paths(relay):
    code, headers, body = login(relay)
    cookie = {"Cookie": cookie_from(headers)}
    for path in ("/gui.py", "/../approval.key", "/api/unknown"):
        assert request(relay, "GET", path, headers=cookie)[0] == 404


def test_remote_requires_a_pin_and_loopback_binding(tmp_path):
    with pytest.raises(ValueError, match="PIN"):
        remote.make_server("http://127.0.0.1:8765", port=0, pin="")
    with pytest.raises(ValueError, match="loopback"):
        remote.make_server("http://127.0.0.1:8765", host="0.0.0.0", port=0, pin="secret")


def test_remote_loads_harness_keys_from_app_env_file(tmp_path, monkeypatch):
    monkeypatch.delenv("HARNESS_TEST_KEY", raising=False)
    monkeypatch.delenv("APP_SECRET_KEY", raising=False)
    env_file = tmp_path / "sites" / "derschweigert" / ".env"
    env_file.parent.mkdir(parents=True)
    env_file.write_text("APP_SECRET_KEY=do-not-import\nHARNESS_TEST_KEY=loaded\n")
    remote.load_harness_env(tmp_path)
    assert os.environ["HARNESS_TEST_KEY"] == "loaded"
    assert "APP_SECRET_KEY" not in os.environ


def test_remote_env_file_never_overrides_the_real_environment(tmp_path, monkeypatch):
    monkeypatch.setenv("HARNESS_GUI_PIN", "real-pin")
    env_file = tmp_path / "sites" / "derschweigert" / ".env"
    env_file.parent.mkdir(parents=True)
    env_file.write_text("HARNESS_GUI_PIN=3009\n")
    remote.load_harness_env(tmp_path)
    assert os.environ["HARNESS_GUI_PIN"] == "real-pin"


def test_tunnel_command_named_and_quick():
    relay_url = "http://127.0.0.1:8443"
    assert remote.tunnel_command(relay_url, "harness") == [
        "cloudflared", "tunnel", "--no-autoupdate", "run", "--url", relay_url, "harness"]
    assert remote.tunnel_command(relay_url, "") == [
        "cloudflared", "tunnel", "--no-autoupdate", "--url", relay_url]


def test_tunnel_command_localhostrun_and_ngrok():
    relay_url = "http://127.0.0.1:8443"
    assert remote.tunnel_command(relay_url, "", "localhostrun") == [
        "ssh", "-o", "StrictHostKeyChecking=accept-new", "-o", "ExitOnForwardFailure=yes",
        "-R", "80:127.0.0.1:8443", "nokey@localhost.run"]
    assert remote.tunnel_command(relay_url, "", "ngrok") == ["ngrok", "http", relay_url]


def test_public_url_is_extracted_from_tunnel_output():
    assert remote._public_url_in("Connect to https://abc123.lhr.life or https://abc123.lhr.life") == "https://abc123.lhr.life"
    assert remote._public_url_in("https://random-words.trycloudflare.com") == "https://random-words.trycloudflare.com"
    assert remote._public_url_in("no url here") is None


def test_remote_dashboard_requires_a_pin(tmp_path, monkeypatch):
    monkeypatch.delenv("HARNESS_GUI_PIN", raising=False)
    dashboard = remote.RemoteDashboard(tmp_path, str(tmp_path / "home"))
    with pytest.raises(ValueError, match="PIN"):
        dashboard.start()
