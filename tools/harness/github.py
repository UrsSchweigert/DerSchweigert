"""GitHub client interface and the `gh`-backed implementation. Only the broker may hold an instance.

Credentials stay inside the `gh` process. Nothing here reads, prints, or logs a token.
"""
from __future__ import annotations

import json
import os
import random
import re
import subprocess
import time
from typing import Any, Callable, Dict, List, Optional


class GitHubError(Exception):
    pass


class RateLimited(GitHubError):
    def __init__(self, message: str = "rate limited", retry_after: Optional[float] = None):
        super().__init__(message)
        self.retry_after = retry_after


def with_retries(fn: Callable[[], Any], retries: int = 5, sleep: Optional[Callable[[float], None]] = None,
                 rng: Callable[[], float] = random.random, base: float = 1.0) -> Any:
    """Exponential backoff with jitter, honoring Retry-After. Only rate limits are retried."""
    sleep = sleep or time.sleep
    for attempt in range(retries + 1):
        try:
            return fn()
        except RateLimited as exc:
            if attempt == retries:
                raise
            backoff = base * (2 ** attempt) * (0.5 + rng() / 2)
            sleep(max(exc.retry_after or 0, backoff))


class Client:
    """Operations the work record needs. Issues are dicts: number, title, body, author, editor, milestone."""

    repo = ""

    def find_by_marker(self, stable_id: str) -> Optional[Dict[str, Any]]:
        raise NotImplementedError

    def get_issue(self, number: int) -> Dict[str, Any]:
        raise NotImplementedError

    def create_issue(self, title: str, body: str, labels: List[str], milestone: Optional[int] = None) -> Dict[str, Any]:
        raise NotImplementedError

    def update_issue(self, number: int, body: str) -> None:
        raise NotImplementedError

    def add_comment(self, number: int, body: str) -> None:
        raise NotImplementedError

    def find_milestone(self, title: str) -> Optional[int]:
        raise NotImplementedError

    def create_milestone(self, title: str, description: str) -> int:
        raise NotImplementedError

    def add_sub_issue(self, parent: int, child: int) -> None:
        raise NotImplementedError

    def find_pr(self, branch: str) -> Optional[int]:
        raise NotImplementedError

    def create_pr(self, title: str, body: str, head: str, base: str) -> int:
        raise NotImplementedError

    def merge_pr(self, number: int, sha: str, method: str = "squash") -> bool:
        raise NotImplementedError

    def capabilities(self) -> Dict[str, Any]:
        raise NotImplementedError


class GhCli(Client):
    def __init__(self, repo: str, runner: Optional[Callable[[List[str]], str]] = None, token_file: Optional[str] = None):
        """`token_file` holds the broker token. It reaches only the gh subprocess environment, never argv or output."""
        self.repo = repo
        self.owner, self.name = repo.split("/", 1)
        self._token_file = token_file
        self._run = runner or self._gh

    def _gh(self, args: List[str]) -> str:
        env = None
        if self._token_file:
            with open(self._token_file) as fh:
                env = dict(os.environ, GH_TOKEN=fh.read().strip())
        proc = subprocess.run(["gh"] + args, capture_output=True, text=True, env=env)
        if proc.returncode != 0:
            err = proc.stderr.strip()
            if re.search(r"rate limit|HTTP 429|abuse", err, re.I):
                m = re.search(r"retry[- ]after[:= ]+(\d+)", err, re.I)
                raise RateLimited(err[:200], float(m.group(1)) if m else None)
            raise GitHubError(err[:300])
        return proc.stdout

    def _json(self, args: List[str]) -> Any:
        out = self._run(args)
        return json.loads(out) if out.strip() else None

    def _graphql(self, query: str, **variables: Any) -> Dict[str, Any]:
        args = ["api", "graphql", "-f", "query=" + query]
        for k, v in variables.items():
            args += ["-F" if isinstance(v, int) else "-f", "%s=%s" % (k, v)]
        data = self._json(args)
        if data.get("errors"):
            raise GitHubError(str(data["errors"])[:300])
        return data["data"]

    @staticmethod
    def _issue(node: Dict[str, Any]) -> Dict[str, Any]:
        return {
            "number": node["number"], "title": node.get("title", ""), "body": node.get("body") or "",
            "author": (node.get("author") or {}).get("login"), "editor": (node.get("editor") or {}).get("login"),
            "milestone": (node.get("milestone") or {}).get("number"),
        }

    def get_issue(self, number: int) -> Dict[str, Any]:
        q = ("query($o:String!,$n:String!,$num:Int!){repository(owner:$o,name:$n){issue(number:$num)"
             "{number title body author{login} editor{login} milestone{number}}}}")
        node = self._graphql(q, o=self.owner, n=self.name, num=number)["repository"]["issue"]
        if node is None:
            raise GitHubError("issue %d not found" % number)
        return self._issue(node)

    def find_by_marker(self, stable_id: str) -> Optional[Dict[str, Any]]:
        q = 'repo:%s is:issue "%s" in:body' % (self.repo, stable_id)
        data = self._json(["api", "-X", "GET", "search/issues", "-f", "q=" + q, "-f", "per_page=20"])
        for item in data.get("items", []):
            if ("id=%s " % stable_id) in (item.get("body") or ""):
                return self.get_issue(item["number"])
        return None

    def create_issue(self, title: str, body: str, labels: List[str], milestone: Optional[int] = None) -> Dict[str, Any]:
        args = ["api", "-X", "POST", "repos/%s/issues" % self.repo, "-f", "title=" + title, "-f", "body=" + body]
        for label in labels:
            args += ["-f", "labels[]=" + label]
        if milestone:
            args += ["-F", "milestone=%d" % milestone]
        data = self._json(args)
        return {"number": data["number"], "title": title, "body": body, "author": None, "editor": None, "milestone": milestone}

    def update_issue(self, number: int, body: str) -> None:
        self._run(["api", "-X", "PATCH", "repos/%s/issues/%d" % (self.repo, number), "-f", "body=" + body])

    def add_comment(self, number: int, body: str) -> None:
        self._run(["api", "-X", "POST", "repos/%s/issues/%d/comments" % (self.repo, number), "-f", "body=" + body])

    def find_milestone(self, title: str) -> Optional[int]:
        for m in self._json(["api", "-X", "GET", "repos/%s/milestones" % self.repo, "-f", "state=all", "-f", "per_page=100"]) or []:
            if m["title"] == title:
                return m["number"]
        return None

    def create_milestone(self, title: str, description: str) -> int:
        data = self._json(["api", "-X", "POST", "repos/%s/milestones" % self.repo, "-f", "title=" + title, "-f", "description=" + description])
        return data["number"]

    def add_sub_issue(self, parent: int, child: int) -> None:
        child_id = self._json(["api", "repos/%s/issues/%d" % (self.repo, child)])["id"]
        self._run(["api", "-X", "POST", "repos/%s/issues/%d/sub_issues" % (self.repo, parent), "-F", "sub_issue_id=%d" % child_id])

    def find_pr(self, branch: str) -> Optional[int]:
        data = self._json(["api", "-X", "GET", "repos/%s/pulls" % self.repo, "-f", "head=%s:%s" % (self.owner, branch), "-f", "state=open"]) or []
        return data[0]["number"] if data else None

    def create_pr(self, title: str, body: str, head: str, base: str) -> int:
        data = self._json(["api", "-X", "POST", "repos/%s/pulls" % self.repo, "-f", "title=" + title, "-f", "body=" + body,
                           "-f", "head=" + head, "-f", "base=" + base])
        return data["number"]

    def merge_pr(self, number: int, sha: str, method: str = "squash") -> bool:
        """The merge is bound to `sha`: GitHub refuses it if the head moved after the evidence was collected."""
        self._run(["api", "-X", "PUT", "repos/%s/pulls/%d/merge" % (self.repo, number), "-f", "sha=" + sha, "-f", "merge_method=" + method])
        return True

    def capabilities(self) -> Dict[str, Any]:
        """Read-only probe. Mutations are never called, so sub-issue support is inferred from the GraphQL schema."""
        caps: Dict[str, Any] = {"repo": self.repo}
        try:
            repo = self._json(["api", "repos/%s" % self.repo])
            caps.update(private=repo["private"], has_issues=repo["has_issues"], permissions=repo.get("permissions", {}))
            head = self._run(["api", "-i", "user"]).split("\r\n\r\n", 1)[0]
            m = re.search(r"^x-oauth-scopes:\s*(.*)$", head, re.I | re.M)
            scopes = [s.strip() for s in m.group(1).split(",")] if m else []
            caps["token_scopes"] = scopes
            caps["projects"] = "available" if ("project" in scopes or "read:project" in scopes) else "unavailable: token lacks the project scope"
        except GitHubError as exc:
            caps["error"] = str(exc)
        try:
            fields = self._graphql("{__type(name:\"Mutation\"){fields{name}}}")["__type"]["fields"]
            caps["native_sub_issues"] = any(f["name"] == "addSubIssue" for f in fields)
        except GitHubError:
            caps["native_sub_issues"] = False
        for name, path in (("branch_protection", "repos/%s/branches/main/protection"), ("rulesets", "repos/%s/rulesets")):
            try:
                self._run(["api", path % self.repo])
                caps[name] = "available"
            except GitHubError as exc:
                caps[name] = "unavailable: " + str(exc)[:80]
        return caps
