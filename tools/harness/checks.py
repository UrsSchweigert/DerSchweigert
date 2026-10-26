"""Required-check runner and the remote publisher. Dry-run publishing records intents and writes nothing."""
from __future__ import annotations

import shutil
import subprocess
from typing import Any, Dict, List, Optional

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


class SandboxChecker(Checker):
    """Exports the revision from the trusted clone and runs each command in the Tier A container."""

    def __init__(self, repo: Repo, token_file: str, timeout: int = 900):
        self.repo, self.token_file, self.timeout = repo, token_file, timeout

    def run(self, issue_id: str, head_rev: str, commands: List[str]) -> List[Dict[str, Any]]:
        work = isolation.new_workdir("checks-")
        try:
            self.repo.export(head_rev, work)
            results = []
            for cmd in commands:
                try:
                    proc = isolation.run_worker(work, ["sh", "-c", cmd], self.token_file, timeout=self.timeout)
                    result: Dict[str, Any] = {"command": cmd, "exit_code": proc.returncode}
                    if proc.returncode != 0:
                        result["output"] = output_tail((proc.stdout or "") + "\n" + (proc.stderr or ""))
                    results.append(result)
                except subprocess.TimeoutExpired:
                    results.append({"command": cmd, "exit_code": 124, "output": "the command timed out after %d seconds" % self.timeout})
            return results
        finally:
            shutil.rmtree(work, ignore_errors=True)


class Publisher:
    """Opens pull requests and merges them. A merge is bound to the head revision that the evidence covers."""

    simulated = False

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
