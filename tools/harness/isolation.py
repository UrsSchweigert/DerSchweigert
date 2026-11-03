"""Tier A worker isolation: a locked-down Docker container, a verification probe, and a signed attestation.

Tier A is reported only when a fresh, signed attestation exists and the image it covers is unchanged.
Known limit: container egress is not restricted, so a worker can reach the network. The only credential
a worker holds is the Copilot-only token, which has no repository access.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import os
import re
import shutil
import subprocess
import tempfile
import time
from typing import Any, Dict, Iterable, List, Mapping, Optional

from . import plans

IMAGE = "harness-worker:1"
ATTESTATION_TTL_S = 24 * 3600
WORKER_UID = 10001
COPILOT_TOKEN_ENV = "COPILOT_GITHUB_TOKEN"

_CREDENTIAL_NAME = re.compile(r"(TOKEN|SECRET|PASSWORD|PASSWD|API_?KEY|CREDENTIAL|PRIVATE_KEY|^GH_|^GITHUB_|^SSH_AUTH_SOCK$|^AWS_|^BLENDERMCP_|^HARNESS_)", re.I)


def scrub_env(env: Mapping[str, str]) -> Dict[str, str]:
    """Environment handed to a worker process. Credential-like and harness variables are removed."""
    return {k: v for k, v in env.items() if not _CREDENTIAL_NAME.search(k)}


def _docker(args: List[str], timeout: int = 120, env: Optional[Dict[str, str]] = None, input_text: Optional[str] = None):
    return subprocess.run(["docker"] + args, capture_output=True, text=True, timeout=timeout, env=env, input=input_text)


def docker_available() -> bool:
    if not shutil.which("docker"):
        return False
    try:
        return _docker(["info", "--format", "{{.ServerVersion}}"], timeout=15).returncode == 0
    except (subprocess.TimeoutExpired, OSError):
        return False


def image_id(image: str = IMAGE) -> Optional[str]:
    try:
        out = _docker(["image", "inspect", "--format", "{{.Id}}", image], timeout=15)
    except (subprocess.TimeoutExpired, OSError):
        return None
    return out.stdout.strip() if out.returncode == 0 and out.stdout.strip() else None


def build_image(context: Optional[str] = None) -> str:
    context = context or os.path.join(os.path.dirname(__file__), "worker")
    out = _docker(["build", "-q", "-t", IMAGE, context], timeout=900)
    if out.returncode != 0:
        raise RuntimeError("image build failed: " + out.stderr.strip()[-300:])
    return out.stdout.strip()


def docker_args(workdir: str, command: List[str], pass_env: Optional[List[str]] = None, memory: str = "2g", cpus: str = "2",
                pids: int = 512, image: str = IMAGE, name: Optional[str] = None) -> List[str]:
    """Arguments for `docker run`. Only `workdir` is mounted. Env vars listed in `pass_env` are forwarded by name, never by value."""
    args = [
        "run", "--rm", "--init",
        "--user", "%d:%d" % (WORKER_UID, WORKER_UID),
        "--read-only",
        "--cap-drop", "ALL",
        "--security-opt", "no-new-privileges",
        "--memory", memory, "--cpus", cpus, "--pids-limit", str(pids),
        "--tmpfs", "/tmp:rw,exec,size=256m",
        "--tmpfs", "/home/worker:rw,exec,uid=%d,gid=%d,size=512m" % (WORKER_UID, WORKER_UID),
        "-v", "%s:/work:rw" % os.path.realpath(workdir),
        "-w", "/work",
    ]
    if name:
        args += ["--name", name]
    for name in pass_env or []:
        args += ["-e", name]
    return args + [image] + command


def pass_env_names(copilot_token_file: Optional[str], provider: Optional[Mapping[str, str]] = None) -> List[str]:
    """Names forwarded into the worker for one attempt: the Copilot token and/or a BYOK provider profile."""
    names = [COPILOT_TOKEN_ENV] if copilot_token_file else []
    return names + list(provider or {})


def _worker_env(copilot_token_file: Optional[str], provider: Optional[Mapping[str, str]] = None) -> Dict[str, str]:
    env = scrub_env(os.environ)
    if copilot_token_file:
        with open(copilot_token_file) as fh:
            env[COPILOT_TOKEN_ENV] = fh.read().strip()
    for name, value in (provider or {}).items():
        env[name] = value
    return env


def worker_env_for_attempt(copilot_token_file: Optional[str], provider: Optional[Mapping[str, str]] = None) -> Dict[str, str]:
    """The environment for one worker process: scrubbed host env plus the credential the attempt needs."""
    return _worker_env(copilot_token_file, provider)


def start_worker(workdir: str, command: List[str], copilot_token_file: Optional[str], *, name: str,
                 provider: Optional[Mapping[str, str]] = None) -> subprocess.Popen:
    args = docker_args(workdir, command, pass_env_names(copilot_token_file, provider), name=name)
    return subprocess.Popen(["docker"] + args, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
                            env=_worker_env(copilot_token_file, provider))


def cancel_worker(name: str, proc: Optional[subprocess.Popen] = None) -> None:
    try:
        _docker(["rm", "-f", name], timeout=15)
    except (OSError, subprocess.TimeoutExpired):
        pass
    finally:
        if proc is not None:
            if proc.poll() is None:
                proc.kill()
            proc.wait(timeout=5)


def run_worker(workdir: str, command: List[str], copilot_token_file: Optional[str] = None, timeout: int = 1800,
               provider: Optional[Mapping[str, str]] = None) -> subprocess.CompletedProcess:
    """Run a command in the sandbox. Credentials travel in the docker client's environment, not its arguments."""
    return _docker(docker_args(workdir, command, pass_env_names(copilot_token_file, provider)), timeout=timeout,
                   env=_worker_env(copilot_token_file, provider))


# -- verification -------------------------------------------------------------

PROBE_SCRIPT = r"""
chk() { if eval "$2"; then echo "$1=pass"; else echo "$1=fail"; fi; }
chk non_root '[ "$(id -u)" != 0 ]'
chk no_host_credentials_in_env '[ -z "${GH_TOKEN:-}${GITHUB_TOKEN:-}${GH_NEW_TOKEN:-}${AWS_SECRET_ACCESS_KEY:-}" ]'
chk no_copilot_token_unless_passed '[ -z "${COPILOT_GITHUB_TOKEN:-}" ]'
chk store_path_absent '[ ! -e "$STORE_PATH" ]'
chk host_home_absent '[ ! -e /Users ] && [ ! -e /host_mnt ] && [ ! -e /home/worker/.config/gh ]'
chk no_ssh_agent '[ -z "${SSH_AUTH_SOCK:-}" ]'
chk no_docker_socket '[ ! -e /var/run/docker.sock ]'
chk rootfs_read_only '! touch /usr/probe 2>/dev/null && ! touch /etc/probe 2>/dev/null'
chk workdir_writable 'touch /work/probe_ok'
chk no_capabilities 'grep -q "^CapEff:[[:space:]]*0000000000000000" /proc/self/status'
chk no_new_privileges 'grep -q "^NoNewPrivs:[[:space:]]*1" /proc/self/status'
chk copilot_installed 'command -v copilot >/dev/null'
chk smoke_tool '[ -f /opt/harness/smoke/lesen.mjs ] && ls -d /opt/pw-browsers/chromium* >/dev/null 2>&1 && node -e "require(\"playwright\")" >/dev/null 2>&1'
chk godot_pinned 'godot --headless --version 2>/dev/null | grep -qx "4.7.2.stable.official.ed1daf0bf"'
chk gdtoolkit_pinned 'python3 -c "import importlib.metadata as m, sys; sys.exit(0 if m.version(\"gdtoolkit\") == \"4.5.0\" else 1)"'
chk godot_headless_import 'T=$(mktemp -d) && printf "config_version=5\n[application]\nconfig/name=\"probe\"\n" > "$T/project.godot" && godot --headless --path "$T" --import >/dev/null 2>&1 && [ -d "$T/.godot" ] && rm -rf "$T"'
chk godot_test_tool 'command -v godot-test >/dev/null && [ -f /opt/harness/godot/addons/gut/gut_cmdln.gd ] && [ -f /opt/harness/smoke/godot_project.sh ] && [ -f /opt/harness/smoke/godot_verify.gd ]'
"""

REQUIRED_CHECKS = [
    "non_root", "no_host_credentials_in_env", "no_copilot_token_unless_passed", "store_path_absent", "host_home_absent",
    "no_ssh_agent", "no_docker_socket", "rootfs_read_only", "workdir_writable", "no_capabilities", "no_new_privileges",
    "copilot_installed", "smoke_tool", "godot_pinned", "gdtoolkit_pinned", "godot_headless_import", "godot_test_tool",
]


def work_root() -> str:
    """Parent for worker directories. Docker Desktop shares /Users but not every temp location, and the store must stay out of it."""
    root = os.environ.get("HARNESS_WORK_ROOT") or os.path.join(os.path.expanduser("~"), ".local", "share", "derschweigert-harness-work")
    os.makedirs(root, mode=0o700, exist_ok=True)
    return root


def new_workdir(prefix: str = "work-") -> str:
    """A fresh directory a worker may write to. Mode 0777 because the container user is not the host user."""
    path = tempfile.mkdtemp(prefix=prefix, dir=work_root())
    os.chmod(path, 0o777)
    return path


def prune_workdirs(max_age_s: float, keep: Iterable[str] = (), now: Optional[float] = None) -> Dict[str, int]:
    """Remove worker directories nothing can be using any more. Each one holds a copy of the repository, so a run that
    crashes without releasing them eventually fills the disk and no worker can start."""
    now = time.time() if now is None else now
    keep_paths = {os.path.realpath(p) for p in keep if p}
    removed, kept = 0, 0
    try:
        entries = [os.path.join(work_root(), n) for n in os.listdir(work_root())]
    except OSError:
        return {"removed": 0, "kept": 0}
    for path in entries:
        if not os.path.isdir(path) or os.path.islink(path) or os.path.realpath(path) in keep_paths:
            kept += 1
            continue
        try:
            age = now - os.path.getmtime(path)
        except OSError:
            continue
        if age <= max_age_s:
            kept += 1
            continue
        shutil.rmtree(path, ignore_errors=True)
        removed += 1 if not os.path.exists(path) else 0
    return {"removed": removed, "kept": kept}


def probe(store_home: str, image: str = IMAGE) -> Dict[str, Any]:
    """Launch the real sandbox with hostile host canaries and report which guarantees hold."""
    if not docker_available():
        return {"ok": False, "reason": "docker is not available", "checks": {}}
    iid = image_id(image)
    if iid is None:
        return {"ok": False, "reason": "worker image %s is not built" % image, "checks": {}}
    work = new_workdir("probe-")
    try:
        host_env = scrub_env(os.environ)
        # Canaries: credential-looking host variables that the launcher must not forward.
        host_env.update({"GH_TOKEN": "canary", "GITHUB_TOKEN": "canary", "GH_NEW_TOKEN": "canary", "SSH_AUTH_SOCK": "/tmp/canary.sock"})
        args = docker_args(work, ["sh", "-c", PROBE_SCRIPT], pass_env=None, image=image)
        args[args.index(image):args.index(image)] = ["-e", "STORE_PATH=" + os.path.realpath(store_home)]
        out = _docker(args, timeout=120, env=host_env)
        checks = {m.group(1): m.group(2) == "pass" for m in re.finditer(r"^(\w+)=(pass|fail)$", out.stdout, re.M)}
        missing = [c for c in REQUIRED_CHECKS if c not in checks]
        failed = sorted(c for c, ok in checks.items() if not ok) + ["missing:" + c for c in missing]
        host_file = os.path.exists(os.path.join(work, "probe_ok"))
        if not host_file:
            failed.append("worker_writes_not_visible_on_host")
        return {"ok": not failed and out.returncode == 0, "image_id": iid, "checks": checks, "failed": failed,
                "reason": "all checks passed" if not failed and out.returncode == 0 else "failed: %s %s" % (failed, out.stderr.strip()[-200:])}
    finally:
        shutil.rmtree(work, ignore_errors=True)


def attestation_path(store_home: str) -> str:
    return os.path.join(store_home, "isolation.json")


def _sign(key: bytes, doc: Dict[str, Any]) -> str:
    body = {k: v for k, v in doc.items() if k != "signature"}
    return hmac.new(key, plans.canonical(body), hashlib.sha256).hexdigest()


def write_attestation(store_home: str, key: bytes, result: Dict[str, Any], now: Optional[float] = None) -> Dict[str, Any]:
    if not result.get("ok"):
        raise RuntimeError("refusing to attest a failed probe: %s" % result.get("reason"))
    doc = {"tier": "A", "checked_at": now if now is not None else time.time(), "image_id": result["image_id"],
           "checks": result["checks"], "signature": ""}
    doc["signature"] = _sign(key, doc)
    path = attestation_path(store_home)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as fh:
        json.dump(doc, fh, sort_keys=True)
    return doc


def current_tier(store_home: str, key: Optional[bytes], now: Optional[float] = None,
                 image_lookup=None) -> Dict[str, str]:
    """Tier A only with a valid signed attestation that is fresh and still matches the built image. Otherwise Tier B."""
    path = attestation_path(store_home)
    if key is None or not os.path.exists(path):
        return {"tier": "B", "reason": "no isolation attestation: run `harness isolation verify`"}
    try:
        with open(path) as fh:
            doc = json.load(fh)
        if not hmac.compare_digest(str(doc.get("signature", "")), _sign(key, doc)):
            return {"tier": "B", "reason": "isolation attestation signature is invalid"}
        if doc.get("tier") != "A" or not all(doc.get("checks", {}).get(c) for c in REQUIRED_CHECKS):
            return {"tier": "B", "reason": "isolation attestation does not cover every required check"}
        if (now if now is not None else time.time()) - float(doc["checked_at"]) > ATTESTATION_TTL_S:
            return {"tier": "B", "reason": "isolation attestation expired: rerun `harness isolation verify`"}
        if (image_lookup or image_id)() != doc.get("image_id"):
            return {"tier": "B", "reason": "worker image changed or missing since verification"}
    except (OSError, ValueError, TypeError):
        return {"tier": "B", "reason": "isolation attestation is unreadable"}
    return {"tier": "A", "reason": "verified Docker worker sandbox (egress not restricted)"}
