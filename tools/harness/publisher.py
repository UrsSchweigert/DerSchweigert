"""Real publisher: pushes harness branches, opens pull requests, and merges bound to the reviewed commit.

Credentials come from the broker token file and reach git and gh only through the child process environment.
"""
from __future__ import annotations

import os
import re
import stat
import subprocess
import tempfile
from typing import Any, Dict, Optional

from .broker import BrokerRejected, check_branch_target
from .checks import Publisher
from .github import Client, GitHubError, with_retries

ASKPASS = "#!/bin/sh\ncase \"$1\" in Username*) echo x-access-token ;; *) echo \"$HARNESS_GIT_TOKEN\" ;; esac\n"


def git_with_token(args: list, cwd: str, token_file: Optional[str]) -> subprocess.CompletedProcess:
    """Run git with the broker token supplied through GIT_ASKPASS. The token is never in argv or output."""
    env = {"PATH": os.environ.get("PATH", "/usr/bin:/bin"), "HOME": tempfile.gettempdir(), "GIT_TERMINAL_PROMPT": "0",
           "GIT_CONFIG_NOSYSTEM": "1", "GIT_CONFIG_GLOBAL": os.devnull}
    tmp = tempfile.mkdtemp(prefix="harness-askpass-")
    token = ""
    try:
        if token_file:
            script = os.path.join(tmp, "askpass.sh")
            fd = os.open(script, os.O_WRONLY | os.O_CREAT | os.O_EXCL, stat.S_IRWXU)
            with os.fdopen(fd, "w") as fh:
                fh.write(ASKPASS)
            with open(token_file) as fh:
                token = fh.read().strip()
            env.update(GIT_ASKPASS=script, HARNESS_GIT_TOKEN=token)
        proc = subprocess.run(["git", "-c", "core.hooksPath=" + os.devnull] + args, cwd=cwd, env=env, capture_output=True, text=True)
        if token:
            proc.stderr = proc.stderr.replace(token, "***")
        return proc
    finally:
        for f in os.listdir(tmp):
            os.remove(os.path.join(tmp, f))
        os.rmdir(tmp)


def push_branch(clone_path: str, remote: str, branch: str, token_file: Optional[str]) -> None:
    """Push one harness/* branch without force. Anything else is refused by the branch convention."""
    name = check_branch_target(branch)
    proc = git_with_token(["push", remote, "refs/heads/%s:refs/heads/%s" % (name, name)], clone_path, token_file)
    if proc.returncode != 0:
        raise GitHubError("push of %s failed: %s" % (name, proc.stderr.strip()[-200:]))


def push_rebased(clone_path: str, remote: str, branch: str, expected_old: str, token_file: Optional[str]) -> None:
    """Replace a harness branch the harness itself rebased. The push succeeds only if the remote still has exactly the commit that
    was reviewed (force-with-lease), so nothing a person or another process pushed can be overwritten."""
    name = check_branch_target(branch)
    if not re.fullmatch(r"[0-9a-f]{40}", expected_old or ""):
        raise BrokerRejected("expected remote head must be a full commit id")
    proc = git_with_token(["push", "--force-with-lease=refs/heads/%s:%s" % (name, expected_old), remote, "refs/heads/%s:refs/heads/%s" % (name, name)],
                          clone_path, token_file)
    if proc.returncode != 0:
        raise GitHubError("publishing the rebased %s failed: %s" % (name, proc.stderr.strip()[-200:]))


class GitHubPublisher(Publisher):
    """Not exercised against live GitHub during setup. Tier B forbids remote writes, so it is covered with a local remote and a test double."""

    def __init__(self, client: Client, clone_path: str, remote: str, base: str = "main", token_file: Optional[str] = None, sleep=None):
        self.client, self.clone_path, self.remote, self.base, self.token_file, self.sleep = client, clone_path, remote, base, token_file, sleep

    def open_pr(self, issue: Dict[str, Any], branch: str, head_rev: str) -> Dict[str, Any]:
        push_branch(self.clone_path, self.remote, branch, self.token_file)
        number = with_retries(lambda: self.client.find_pr(branch), sleep=self.sleep)
        if number is None:
            title = "%s [%s]" % (issue.get("title", issue["issue_id"]), ", ".join(issue["requirement_ids"]))
            body = "Harness-managed pull request for issue `%s`. Requirements: %s. Head `%s`." % (issue["issue_id"], ", ".join(issue["requirement_ids"]), head_rev)
            number = with_retries(lambda: self.client.create_pr(title, body, branch, self.base), sleep=self.sleep)
        return {"number": number, "simulated": False}

    def update_branch(self, issue: Dict[str, Any], branch: str, old_head: str, new_head: str) -> None:
        push_rebased(self.clone_path, self.remote, branch, old_head, self.token_file)

    def merge(self, issue: Dict[str, Any], pr: Any, head_rev: str) -> Dict[str, Any]:
        if not pr:
            raise BrokerRejected("no pull request to merge for %s" % issue["issue_id"])
        merged = with_retries(lambda: self.client.merge_pr(pr, head_rev), sleep=self.sleep)
        if merged:
            # Pull the merge into the harness's clone, so later issues and the post-merge checks see it.
            proc = git_with_token(["fetch", "--quiet", "--no-tags", self.remote, "+refs/heads/%s:refs/heads/%s" % (self.base, self.base)],
                                  self.clone_path, self.token_file)
            if proc.returncode != 0:
                raise GitHubError("merged, but could not refresh the base branch: %s" % proc.stderr.strip()[-200:])
        return {"merged": bool(merged), "mode": "checks-on-current-base", "simulated": False}
