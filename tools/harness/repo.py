"""Git operations on a trusted local clone. Workers never run in this clone.

Worker branches are fetched into the trusted clone and inspected there. Hooks, system and global config,
and fsmonitor are disabled, so a hostile repository cannot execute code on the host through these commands.
"""
from __future__ import annotations

import os
import shutil
import subprocess
import tempfile
from collections import namedtuple
from typing import List, Optional

RebaseResult = namedtuple("RebaseResult", "conflict head patch_id")


class GitError(Exception):
    pass


class Repo:
    """Interface the scheduler depends on."""

    def base_head(self) -> str:
        raise NotImplementedError

    def branch_head(self, branch: str) -> str:
        raise NotImplementedError

    def changed_paths(self, old: str, new: str) -> List[str]:
        raise NotImplementedError

    def branch_changed_paths(self, branch: str) -> List[str]:
        raise NotImplementedError

    def numstat(self, branch: str) -> int:
        raise NotImplementedError

    def patch_id(self, branch: str) -> str:
        raise NotImplementedError

    def rebase(self, branch: str) -> RebaseResult:
        raise NotImplementedError

    def diff_text(self, branch: str, limit: int = 60000) -> str:
        raise NotImplementedError

    def export(self, rev: str, dest: str) -> None:
        raise NotImplementedError


class GitRepo(Repo):
    def __init__(self, path: str, base: str = "main"):
        self.path, self.base = path, base

    @staticmethod
    def _env() -> dict:
        return {"PATH": os.environ.get("PATH", "/usr/bin:/bin"), "HOME": tempfile.gettempdir(), "GIT_CONFIG_NOSYSTEM": "1",
               "GIT_CONFIG_GLOBAL": os.devnull, "GIT_TERMINAL_PROMPT": "0", "GIT_AUTHOR_NAME": "harness", "GIT_AUTHOR_EMAIL": "harness@localhost",
               "GIT_COMMITTER_NAME": "harness", "GIT_COMMITTER_EMAIL": "harness@localhost"}

    @staticmethod
    def _base_cmd(args) -> list:
        return ["git", "-c", "core.hooksPath=" + os.devnull, "-c", "core.fsmonitor=false", "-c", "protocol.ext.allow=never"] + list(args)

    def _exec(self, *args: str, cwd: Optional[str] = None, input_text: Optional[str] = None) -> "subprocess.CompletedProcess":
        return subprocess.run(self._base_cmd(args), cwd=cwd or self.path, env=self._env(), capture_output=True, text=True, input=input_text)

    def _git(self, *args: str, cwd: Optional[str] = None, input_text: Optional[str] = None, check: bool = True) -> str:
        proc = self._exec(*args, cwd=cwd, input_text=input_text)
        if check and proc.returncode != 0:
            raise GitError("git %s failed: %s" % (args[0], proc.stderr.strip()[:300]))
        return proc.stdout if proc.returncode == 0 else ""

    def fetch_branch(self, source: str, branch: str) -> str:
        """Bring a worker's branch into the trusted clone as refs/heads/<branch>."""
        self._git("fetch", "--no-tags", "--force", source, "+refs/heads/%s:refs/heads/%s" % (branch, branch))
        return self.branch_head(branch)

    def base_head(self) -> str:
        return self._git("rev-parse", self.base).strip()

    def branch_head(self, branch: str) -> str:
        return self._git("rev-parse", "refs/heads/" + branch).strip()

    def merge_base(self, branch: str) -> str:
        return self._git("merge-base", self.base, "refs/heads/" + branch).strip()

    def changed_paths(self, old: str, new: str) -> List[str]:
        return [p for p in self._git("diff", "--name-only", "--no-renames", old, new).splitlines() if p]

    def branch_changed_paths(self, branch: str) -> List[str]:
        return self.changed_paths(self.merge_base(branch), "refs/heads/" + branch)

    def numstat(self, branch: str) -> int:
        total = 0
        for line in self._git("diff", "--numstat", self.merge_base(branch), "refs/heads/" + branch).splitlines():
            add, dele = line.split("\t")[:2]
            total += (int(add) if add.isdigit() else 0) + (int(dele) if dele.isdigit() else 0)
        return total

    def diff_text(self, branch: str, limit: int = 60000) -> str:
        return self._git("diff", self.merge_base(branch), "refs/heads/" + branch)[:limit]

    def export(self, rev: str, dest: str) -> None:
        """Write the tree at `rev` into `dest` without .git, for running checks."""
        archive = subprocess.run(self._base_cmd(["archive", rev]), cwd=self.path, env=self._env(), capture_output=True, check=True)
        subprocess.run(["tar", "-x", "-C", dest], input=archive.stdout, check=True, capture_output=True)

    def patch_id(self, branch: str) -> str:
        diff = self._git("diff", self.merge_base(branch), "refs/heads/" + branch)
        out = self._git("patch-id", "--stable", input_text=diff)
        return out.split()[0] if out.strip() else ""

    def rebase(self, branch: str) -> RebaseResult:
        """Rebase the branch onto the current base in a throwaway worktree. A conflict leaves the branch untouched."""
        tmp = tempfile.mkdtemp(prefix="harness-rebase-")
        try:
            self._git("worktree", "add", "--detach", tmp, "refs/heads/" + branch)
            if self._exec("rebase", self.base, cwd=tmp).returncode != 0:
                self._exec("rebase", "--abort", cwd=tmp)
                return RebaseResult(True, self.branch_head(branch), self.patch_id(branch))
            head = self._git("rev-parse", "HEAD", cwd=tmp).strip()
            self._git("update-ref", "refs/heads/" + branch, head)
            return RebaseResult(False, head, self.patch_id(branch))
        finally:
            self._exec("worktree", "remove", "--force", tmp)
            shutil.rmtree(tmp, ignore_errors=True)
