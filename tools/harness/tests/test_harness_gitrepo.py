"""Real git, no doubles: patch identity, rebase conflicts, branch inspection, and hook safety."""
import os
import shutil
import subprocess

import pytest

from harness.repo import GitRepo
from harness_doubles import Env

pytestmark = pytest.mark.skipif(shutil.which("git") is None, reason="git is required")

ENV = dict(os.environ, GIT_AUTHOR_NAME="t", GIT_AUTHOR_EMAIL="t@t", GIT_COMMITTER_NAME="t", GIT_COMMITTER_EMAIL="t@t",
           GIT_CONFIG_GLOBAL=os.devnull, GIT_CONFIG_NOSYSTEM="1")


def git(cwd, *args):
    return subprocess.run(["git"] + list(args), cwd=cwd, env=ENV, check=True, capture_output=True, text=True).stdout.strip()


def commit(cwd, name, text, msg):
    path = os.path.join(cwd, name)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as fh:
        fh.write(text)
    git(cwd, "add", "-A")
    git(cwd, "commit", "-q", "-m", msg)


@pytest.fixture
def world(tmp_path):
    trusted = str(tmp_path / "trusted")
    os.makedirs(trusted)
    git(trusted, "init", "-q", "-b", "main")
    commit(trusted, "src/a.py", "".join("line%d\n" % i for i in range(30)), "init")
    worker = str(tmp_path / "worker")
    git(str(tmp_path), "clone", "-q", trusted, worker)
    git(worker, "checkout", "-q", "-b", "harness/i1")
    return trusted, worker, GitRepo(trusted)


def test_fetch_and_inspect_worker_branch(world):
    trusted, worker, repo = world
    commit(worker, "src/new.py", "a\nb\nc\n", "work")
    head = repo.fetch_branch(worker, "harness/i1")
    assert head == git(worker, "rev-parse", "HEAD")
    assert repo.branch_changed_paths("harness/i1") == ["src/new.py"] and repo.numstat("harness/i1") == 3
    assert "src/new.py" in repo.diff_text("harness/i1")
    out = str(os.path.dirname(trusted) + "/export")
    os.makedirs(out)
    repo.export(head, out)
    assert os.path.exists(os.path.join(out, "src", "new.py")) and not os.path.exists(os.path.join(out, ".git"))


def test_patch_id_is_stable_across_a_clean_rebase(world):
    trusted, worker, repo = world
    commit(worker, "src/feature.py", "x\ny\n", "feature")
    repo.fetch_branch(worker, "harness/i1")
    before = repo.patch_id("harness/i1")
    old_head = repo.branch_head("harness/i1")
    commit(trusted, "docs/unrelated.md", "hello\n", "base moves")
    res = repo.rebase("harness/i1")
    assert not res.conflict and res.patch_id == before and res.head != old_head
    assert repo.branch_head("harness/i1") == res.head


def test_patch_id_changes_when_the_diff_changes(world):
    trusted, worker, repo = world
    commit(worker, "src/feature.py", "x\ny\n", "feature")
    repo.fetch_branch(worker, "harness/i1")
    before = repo.patch_id("harness/i1")
    commit(worker, "src/feature.py", "x\ny\nz\n", "more")
    repo.fetch_branch(worker, "harness/i1")
    assert repo.patch_id("harness/i1") != before


def test_rebase_conflict_is_detected_and_leaves_the_branch_untouched(world):
    trusted, worker, repo = world
    commit(worker, "src/a.py", "".join("worker%d\n" % i for i in range(30)), "worker edit")
    repo.fetch_branch(worker, "harness/i1")
    head = repo.branch_head("harness/i1")
    commit(trusted, "src/a.py", "".join("base%d\n" % i for i in range(30)), "base edit")
    res = repo.rebase("harness/i1")
    assert res.conflict and repo.branch_head("harness/i1") == head
    assert git(trusted, "worktree", "list").count("\n") == 0  # the throwaway worktree is gone


def test_changed_paths_between_base_revisions(world):
    trusted, worker, repo = world
    old = repo.base_head()
    commit(trusted, "api/schema.json", "{}\n", "contract")
    assert repo.changed_paths(old, repo.base_head()) == ["api/schema.json"]


def test_implementation_checks_run_on_the_actual_current_base(world, tmp_path):
    trusted, worker, repo = world
    env = Env(tmp_path / "scheduler", issues=[])
    env.sched.repo = repo
    env.add_issue("i1", "P1", ["F1.1", "F1.2"], base_rev=repo.base_head())
    env.adapter.source_path = lambda handle: worker if handle.req.role == "implementer" else None
    env.start()
    env.tick()
    commit(trusted, "src/parallel.py", "parallel = True\n", "parallel issue merged")
    commit(worker, "src/new.py", "implemented = True\n", "implementation")
    env.tick()
    checks = env.store.evidence("i1", "checks")[-1]
    assert checks["base_rev"] == repo.base_head()
    actual_base = git(trusted, "merge-base", checks["head_rev"], checks["base_rev"])
    assert actual_base == checks["base_rev"]


def test_hooks_in_the_trusted_clone_do_not_run(world, tmp_path):
    trusted, worker, repo = world
    marker = str(tmp_path / "hook-ran")
    hook = os.path.join(trusted, ".git", "hooks", "post-rewrite")
    with open(hook, "w") as fh:
        fh.write("#!/bin/sh\ntouch %s\n" % marker)
    os.chmod(hook, 0o755)
    commit(worker, "src/f.py", "1\n", "f")
    repo.fetch_branch(worker, "harness/i1")
    commit(trusted, "docs/x.md", "x\n", "move")
    assert not repo.rebase("harness/i1").conflict
    assert not os.path.exists(marker)
