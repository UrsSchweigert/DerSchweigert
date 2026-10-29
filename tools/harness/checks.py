"""Required-check runner and the remote publisher. Dry-run publishing records intents and writes nothing."""
from __future__ import annotations

import os
import re
import shlex
import shutil
import subprocess
import threading
import time
import uuid
from typing import Any, Callable, Dict, List, Optional

from . import isolation
from .repo import Repo


OUTPUT_TAIL = 1200


def output_tail(text: str) -> str:
    """The end of a command's output, where the reason for a failure usually is."""
    text = (text or "").strip()
    return text[-OUTPUT_TAIL:]


class Checker:
    """Runs the validation commands from the approved plan against a revision. Returns [{command, exit_code}], plus an `output`
    tail for a command that failed, so the worker can be told why."""

    def run(self, issue_id: str, head_rev: str, commands: List[str]) -> List[Dict[str, Any]]:
        raise NotImplementedError

    def start(self, issue_id: str, head_rev: str, commands: List[str]) -> Any:
        return self.run(issue_id, head_rev, commands)

    def poll(self, handle: Any) -> Optional[List[Dict[str, Any]]]:
        return handle

    def cancel(self, handle: Any) -> None:
        pass

    def recovery_data(self, handle: Any) -> Dict[str, Any]:
        return {}

    def recover(self, data: Dict[str, Any]) -> None:
        pass


class _CheckHandle:
    def __init__(self, workdir: str, commands: List[str]):
        self.workdir, self.commands = workdir, list(commands)
        self.name = "harness-check-" + uuid.uuid4().hex
        self.proc: Optional[subprocess.Popen] = None
        self.reader: Optional[threading.Thread] = None
        self.tail = ""
        self.started_at = 0.0
        self.timed_out = False
        self.cancelled = False
        self.results: List[Dict[str, Any]] = []


class SandboxChecker(Checker):
    """Exports a trusted revision and polls bounded, cancellable Tier A commands."""

    def __init__(self, repo: Repo, token_file: str, timeout: int = 900, *, clock: Callable[[], float] = time.monotonic):
        self.repo, self.token_file, self.timeout = repo, token_file, timeout
        self.clock = clock

    def start(self, issue_id: str, head_rev: str, commands: List[str]) -> _CheckHandle:
        work = isolation.new_workdir("checks-")
        try:
            self.repo.export(head_rev, work)
        except Exception:
            shutil.rmtree(work, ignore_errors=True)
            raise
        return _CheckHandle(work, commands)

    def preflight(self, head_rev: str, checks: List[Dict[str, str]]) -> List[Dict[str, Any]]:
        """Check commands in the same image, mount, and /work-rooted container used for execution."""
        work = isolation.new_workdir("preflight-")
        results: List[Dict[str, Any]] = []
        try:
            self.repo.export(head_rev, work)
            for check in checks:
                directory = check.get("working_directory", ".")
                if (not directory or os.path.isabs(directory) or "\\" in directory
                        or ".." in directory.split("/")):
                    results.append({"command": check["command"], "working_directory": directory,
                                    "kind": "configuration", "exit_code": 2,
                                    "output": "working directory must be repository-relative"})
                    continue
                target = os.path.realpath(os.path.join(work, directory))
                if os.path.commonpath([os.path.realpath(work), target]) != os.path.realpath(work) or not os.path.isdir(target):
                    results.append({"command": check["command"], "working_directory": directory,
                                    "kind": "configuration", "exit_code": 2,
                                    "output": "working directory does not exist inside the repository"})
                    continue
                absolute_paths = sorted(set(re.findall(r"(?<![A-Za-z0-9._-])(/[^ \t\r\n;&|<>\"']+)", check["command"])))
                path_check = ("for p in %s; do test -e \"$p\" || { echo \"HARNESS_CONFIG_ERROR: missing absolute path $p\"; exit 126; }; done; " %
                              " ".join(shlex.quote(path) for path in absolute_paths)) if absolute_paths else ""
                command = "cd %s || { echo 'HARNESS_CONFIG_ERROR: invalid working directory'; exit 126; }; %s%s" % (
                    shlex.quote("/work/" + directory if directory != "." else "/work"), path_check, check["command"])
                args = isolation.docker_args(work, ["timeout", "--kill-after=5", str(self.timeout), "sh", "-c", command])
                try:
                    out = isolation._docker(args, timeout=self.timeout + 15)
                    code = out.returncode
                    text = (out.stdout + out.stderr)[-OUTPUT_TAIL:]
                except (OSError, subprocess.TimeoutExpired) as exc:
                    code, text = 124, str(exc)
                config_error = ("HARNESS_CONFIG_ERROR:" in text or code == 127
                                or "command not found" in text.lower() or "not found" in text.lower()
                                or "no such file or directory" in text.lower()
                                or "could not find" in text.lower() or "cannot find module" in text.lower())
                results.append({"command": check["command"], "working_directory": directory, "exit_code": code,
                                "kind": "configuration" if config_error else ("pass" if code == 0 else "check"),
                                "output": output_tail(text)})
        finally:
            shutil.rmtree(work, ignore_errors=True)
        return results

    def poll(self, handle: _CheckHandle) -> Optional[List[Dict[str, Any]]]:
        if handle.cancelled:
            raise RuntimeError("check job was cancelled")
        if len(handle.results) == len(handle.commands):
            shutil.rmtree(handle.workdir, ignore_errors=True)
            return handle.results
        command = handle.commands[len(handle.results)]
        if handle.proc is None:
            handle.tail, handle.timed_out = "", False
            wrapped = ["timeout", "--kill-after=5", str(self.timeout), "sh", "-c", command]
            handle.proc = isolation.start_worker(handle.workdir, wrapped, self.token_file, name=handle.name)
            handle.started_at = self.clock()
            proc = handle.proc

            def pump():
                for chunk in iter(lambda: proc.stdout.read(4096), ""):
                    handle.tail = (handle.tail + chunk)[-OUTPUT_TAIL:]

            handle.reader = threading.Thread(target=pump, daemon=True)
            handle.reader.start()
            return None
        code = handle.proc.poll()
        if code is None and self.clock() - handle.started_at >= self.timeout:
            isolation.cancel_worker(handle.name, handle.proc)
            handle.timed_out = True
            code = handle.proc.returncode
        if code is None or handle.reader.is_alive():
            return None
        result: Dict[str, Any] = {"command": command, "exit_code": 124 if handle.timed_out else code}
        if handle.timed_out or code in (124, 137):
            result.update(exit_code=124, output="the command timed out after %d seconds" % self.timeout)
        elif code != 0:
            result["output"] = output_tail(handle.tail)
            if code == 127 or re.search(r"command not found|not found|no such file or directory|not a directory|could not find|cannot find module", handle.tail, re.I):
                result["kind"] = "configuration"
        handle.proc.stdout.close()
        handle.proc = None
        handle.results.append(result)
        if len(handle.results) == len(handle.commands):
            shutil.rmtree(handle.workdir, ignore_errors=True)
            return handle.results
        return None

    def cancel(self, handle: _CheckHandle) -> None:
        if handle.cancelled:
            return
        handle.cancelled = True
        if handle.proc is not None:
            isolation.cancel_worker(handle.name, handle.proc)
            handle.reader.join(timeout=1)
            handle.proc.stdout.close()
        shutil.rmtree(handle.workdir, ignore_errors=True)

    def recovery_data(self, handle: _CheckHandle) -> Dict[str, Any]:
        return {"container": handle.name, "workdir": handle.workdir}

    def recover(self, data: Dict[str, Any]) -> None:
        name, work = data.get("container", ""), data.get("workdir", "")
        root = os.path.realpath(isolation.work_root())
        if (not re.fullmatch(r"harness-check-[0-9a-f]{32}", name) or not work
                or not os.path.basename(work).startswith("checks-")
                or os.path.commonpath([root, os.path.realpath(work)]) != root):
            raise RuntimeError("invalid abandoned check metadata")
        isolation.cancel_worker(name)
        shutil.rmtree(work, ignore_errors=True)

    def run(self, issue_id: str, head_rev: str, commands: List[str]) -> List[Dict[str, Any]]:
        handle = self.start(issue_id, head_rev, commands)
        try:
            while True:
                results = self.poll(handle)
                if results is not None:
                    return results
                time.sleep(0.05)
        finally:
            self.cancel(handle)


class Publisher:
    """Opens pull requests and merges them. A merge is bound to the head revision that the evidence covers."""

    simulated = False

    def refresh_base(self) -> None:
        """Refresh the trusted base before validation or integration. Rehearsals have no remote to refresh."""

    def open_pr(self, issue: Dict[str, Any], branch: str, head_rev: str) -> Dict[str, Any]:
        raise NotImplementedError

    def merge(self, issue: Dict[str, Any], pr: Any, head_rev: str) -> Dict[str, Any]:
        raise NotImplementedError

    def update_branch(self, issue: Dict[str, Any], branch: str, old_head: str, new_head: str) -> None:
        """Publish a branch the harness itself rebased, so the pull request head equals the commit the evidence is bound to."""


class DryRunPublisher(Publisher):
    """Reads nothing and writes nothing. Records what a real run would do so the flow can be exercised."""

    simulated = True

    def __init__(self, repo: Optional[Repo] = None) -> None:
        """With a repo, a rehearsal merge advances that harness-owned clone so later work builds on earlier work. Nothing remote is touched."""
        self.intents: List[Dict[str, Any]] = []
        self.repo = repo

    def open_pr(self, issue, branch, head_rev):
        self.intents.append({"action": "open_pr", "issue": issue["issue_id"], "branch": branch, "head": head_rev})
        return {"number": None, "simulated": True}

    def update_branch(self, issue, branch, old_head, new_head):
        self.intents.append({"action": "update_branch", "issue": issue["issue_id"], "old": old_head, "new": new_head})

    def merge(self, issue, pr, head_rev):
        self.intents.append({"action": "merge_pr", "issue": issue["issue_id"], "head": head_rev})
        if self.repo is not None:
            self.repo.fast_forward_base(head_rev)
        return {"merged": True, "mode": "checks-on-current-base", "simulated": True}
