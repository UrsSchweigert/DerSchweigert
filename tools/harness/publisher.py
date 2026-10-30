"""Real publisher: pushes harness branches, opens pull requests, and merges bound to the reviewed commit.

Credentials come from the broker token file and reach git and gh only through the child process environment.
"""
from __future__ import annotations

import os
import re
import shutil
import stat
import subprocess
import tempfile
from typing import Any, Dict, Optional

from .broker import BrokerRejected, check_branch_target
from .checks import Publisher
from .github import BaseChanged, Client, GitHubError, with_retries
from .repo import GitRepo

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


def merge_base_into(clone_path: str, remote: str, base: str, branch: str, base_sha: str, token_file: Optional[str]) -> Optional[str]:
    """Bring the base into a harness-owned branch with a real merge commit and push it.

    A run branch that falls behind the base cannot be promoted: GitHub cannot build a merge commit for the promotion pull
    request, so it reports no checks at all and the required checks never arrive. Merging here keeps the promotion
    mergeable and, when the base really collided with the run's work, names the paths instead of hiding them.
    Returns the merge commit, or None when the base was already contained.
    """
    tmp = tempfile.mkdtemp(prefix="harness-base-merge-")
    work = os.path.join(tmp, "work")
    ident = ["-c", "user.name=harness", "-c", "user.email=harness@localhost"]

    def git(*args: str) -> "subprocess.CompletedProcess":
        return subprocess.run(["git"] + ident + list(args), cwd=work, capture_output=True, text=True)

    try:
        cloned = subprocess.run(["git", "clone", "--quiet", "--no-checkout", clone_path, work], capture_output=True, text=True)
        if cloned.returncode != 0:
            raise GitHubError("could not read %s to merge %s into it: %s" % (branch, base, cloned.stderr.strip()[-200:]))
        checked = git("checkout", "--quiet", "--force", "-B", branch, "refs/remotes/origin/" + branch)
        if checked.returncode != 0:
            raise GitHubError("could not check out %s to merge %s into it: %s" % (branch, base, checked.stderr.strip()[-200:]))
        merged = git("merge", "--no-ff", "--no-edit", "-m", "Merge %s into %s before the run continues" % (base, branch), base_sha)
        if merged.returncode != 0:
            paths = git("diff", "--name-only", "--diff-filter=U").stdout.split()
            if not paths:
                raise GitHubError("could not merge %s into %s: %s" % (base, branch, merged.stderr.strip()[-200:]))
            raise GitHubError("%s and %s both changed %s; resolve them on %s or discard the run"
                              % (branch, base, ", ".join(sorted(paths)[:10]), branch))
        head = git("rev-parse", "HEAD").stdout.strip()
        pushed = git_with_token(["push", "--quiet", remote, "refs/heads/%s:refs/heads/%s" % (branch, branch)], work, token_file)
        if pushed.returncode != 0:
            raise GitHubError("could not push %s with %s merged in: %s" % (branch, base, pushed.stderr.strip()[-200:]))
        return head
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


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

    def refresh_base(self) -> None:
        proc = git_with_token(["fetch", "--quiet", "--no-tags", self.remote, "+refs/heads/%s:refs/heads/%s" % (self.base, self.base)],
                              self.clone_path, self.token_file)
        if proc.returncode != 0:
            raise GitHubError("could not refresh the base branch: %s" % proc.stderr.strip()[-200:])

    def sync_run_branch(self, base: str) -> Optional[str]:
        """Merge the current base into the run branch. The promotion must stay mergeable, because an unmergeable pull
        request produces no checks and can therefore never satisfy the required ones."""
        if not base or self.base == base:
            return None
        fetched = git_with_token(["fetch", "--quiet", "--no-tags", self.remote,
                                  "+refs/heads/%s:refs/heads/%s" % (base, base),
                                  "+refs/heads/%s:refs/heads/%s" % (self.base, self.base)], self.clone_path, self.token_file)
        if fetched.returncode != 0:
            raise GitHubError("could not refresh %s and %s: %s" % (base, self.base, fetched.stderr.strip()[-200:]))
        repo = GitRepo(self.clone_path, base)
        head = repo.base_head()
        if repo.is_ancestor(head, repo.branch_head(self.base)):
            return None
        return merge_base_into(self.clone_path, self.remote, base, self.base, head, self.token_file)

    def open_promotion(self, base: str, title: str, body: str) -> Optional[int]:
        """A pull request from the run branch into the base branch, so `main` only moves when the owner merges."""
        if not base or self.base == base:
            return None
        number = with_retries(lambda: self.client.find_pr(self.base), sleep=self.sleep)
        if number is None:
            number = with_retries(lambda: self.client.create_pr(title, body, self.base, base), sleep=self.sleep)
        return number

    def merge(self, issue: Dict[str, Any], pr: Any, head_rev: str) -> Dict[str, Any]:
        if not pr:
            raise BrokerRejected("no pull request to merge for %s" % issue["issue_id"])
        self.refresh_base()
        if not issue.get("base_rev"):
            raise BrokerRejected("no tested base revision for %s" % issue["issue_id"])
        if GitRepo(self.clone_path, self.base).base_head() != issue["base_rev"]:
            raise BaseChanged("base branch changed after validation; rebase and rerun checks")
        protection = with_retries(lambda: self.client.merge_protection(self.base), sleep=self.sleep)
        if not protection.get("safe"):
            raise BrokerRejected("branch protection is not verified: %s" % protection.get("reason", "unknown"))
        merged = with_retries(lambda: self.client.merge_pr(pr, head_rev), sleep=self.sleep)
        if merged:
            self.refresh_base()
        return {"merged": bool(merged), "mode": "strict-required-checks", "simulated": False}
