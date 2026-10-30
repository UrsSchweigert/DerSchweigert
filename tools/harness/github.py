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
from urllib.parse import quote


class GitHubError(Exception):
    pass


class BaseChanged(GitHubError):
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

    def merge_protection(self, base: str) -> Dict[str, Any]:
        return {"safe": False, "reason": "the client cannot verify strict branch protection"}

    def pr_merged(self, number: int) -> bool:
        raise NotImplementedError

    def completion_evidence(self, number: int, required_checks: List[str]) -> Dict[str, Any]:
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
        result = self._json(["api", "-X", "PUT", "repos/%s/pulls/%d/merge" % (self.repo, number), "-f", "sha=" + sha,
                             "-f", "merge_method=" + method])
        return isinstance(result, dict) and result.get("merged") is True

    def pr_merged(self, number: int) -> bool:
        """Whether the owner merged the pull request. A read: the harness never merges into the base branch."""
        data = self._json(["api", "repos/%s/pulls/%d" % (self.repo, number)])
        return bool(isinstance(data, dict) and data.get("merged"))

    def completion_evidence(self, number: int, required_checks: List[str]) -> Dict[str, Any]:
        pr = self._json(["api", "repos/%s/pulls/%d" % (self.repo, number)])
        if not isinstance(pr, dict):
            raise GitHubError("pull request response is invalid")
        merge_sha = (pr.get("merge_commit_sha") or "").lower()
        head = pr.get("head") or {}
        base = pr.get("base") or {}
        if not merge_sha:
            raise GitHubError("pull request has no merge commit")
        runs = self._json(["api", "repos/%s/commits/%s/check-runs" % (self.repo, merge_sha), "-f", "per_page=100"])
        statuses = self._json(["api", "repos/%s/commits/%s/status" % (self.repo, merge_sha)])
        reviews = self._json(["api", "repos/%s/pulls/%d/reviews" % (self.repo, number), "-f", "per_page=100"])
        check_runs = (runs or {}).get("check_runs", [])
        status_contexts = (statuses or {}).get("statuses", [])
        conclusions: Dict[str, str] = {}
        for check in check_runs:
            if check.get("status") == "completed":
                conclusions[check.get("name", "")] = check.get("conclusion", "")
        for status in status_contexts:
            conclusions[status.get("context", "")] = status.get("state", "")
        missing = [name for name in required_checks if conclusions.get(name) not in ("success",)]
        if missing:
            raise GitHubError("required checks are missing or not successful on merge commit: %s" % ", ".join(missing))
        if not required_checks:
            raise GitHubError("effective branch rules do not provide required checks to verify")
        author = ((pr.get("user") or {}).get("login") or "").lower()
        latest_reviews: Dict[str, Dict[str, Any]] = {}
        for review in reviews or []:
            user = ((review.get("user") or {}).get("login") or "").lower()
            if user:
                latest_reviews[user] = review
        approvals = [{"login": user, "submitted_at": review.get("submitted_at"), "state": review.get("state")}
                     for user, review in latest_reviews.items() if user != author and review.get("state") == "APPROVED"]
        return {
            "number": pr["number"], "state": pr.get("state"), "merged": bool(pr.get("merged_at")),
            "merged_at": pr.get("merged_at"), "merge_commit_sha": merge_sha,
            "head_sha": ((head.get("sha") or "")).lower(), "head_ref": head.get("ref", ""),
            "head_repository": ((head.get("repo") or {}).get("full_name") or ""),
            "base_sha": ((base.get("sha") or "")).lower(), "base_ref": base.get("ref", ""),
            "author": author, "approvals": approvals,
            "checks": [{"name": name, "conclusion": conclusion} for name, conclusion in sorted(conclusions.items())],
            "required_checks": list(required_checks),
        }

    def merge_protection(self, base: str) -> Dict[str, Any]:
        blockers: List[str] = []
        try:
            rules = self._json(["api", "repos/%s/rules/branches/%s" % (self.repo, quote(base, safe=""))])
        except RateLimited:
            raise
        except GitHubError as exc:
            return {"safe": False, "reason": "cannot verify effective branch rules: %s" % str(exc)[:160],
                    "blocking_rules": ["effective branch rules unavailable"], "required_checks": []}
        if not isinstance(rules, list):
            return {"safe": False, "reason": "effective branch rules response is invalid",
                    "blocking_rules": ["invalid effective branch rules response"], "required_checks": []}
        try:
            protection = self._json(["api", "repos/%s/branches/%s/protection" % (self.repo, quote(base, safe=""))])
        except RateLimited:
            raise
        except GitHubError as exc:
            if "404" not in str(exc):
                return {"safe": False, "reason": "cannot verify classic branch protection: %s" % str(exc)[:160],
                        "blocking_rules": ["classic branch protection could not be read"], "required_checks": []}
            protection = None

        required_checks: List[str] = []
        has_strict_checks = False
        has_pull_request_rule = False
        for rule in rules:
            rule_type = rule.get("type")
            params = rule.get("parameters") or {}
            if rule_type == "required_status_checks":
                required_checks.extend(c.get("context", "") for c in (params.get("required_status_checks") or []) if c.get("context"))
                has_strict_checks = params.get("strict_required_status_checks_policy") is True
            elif rule_type == "pull_request":
                has_pull_request_rule = True
                approvals = int(params.get("required_approving_review_count", 0) or 0)
                if approvals:
                    blockers.append("ruleset requires %d approving review(s)" % approvals)

        if protection is not None and not isinstance(protection, dict):
            return {"safe": False, "reason": "classic branch protection response is invalid",
                    "blocking_rules": ["invalid classic branch protection response"], "required_checks": []}
        classic_checks = (protection or {}).get("required_status_checks") or {}
        if classic_checks:
            required_checks.extend(classic_checks.get("contexts") or [])
            required_checks.extend(c.get("context", "") for c in classic_checks.get("checks", []) if c.get("context"))
            has_strict_checks = has_strict_checks or classic_checks.get("strict") is True
        if protection:
            has_pull_request_rule = has_pull_request_rule or bool(protection.get("required_pull_request_reviews"))
            approvals = int((protection.get("required_pull_request_reviews") or {}).get("required_approving_review_count", 0) or 0)
            if approvals:
                blockers.append("classic branch protection requires %d approving review(s)" % approvals)
            if (protection.get("enforce_admins") or {}).get("enabled") is not True:
                blockers.append("classic branch protection is not enforced for administrators")
        required_checks = sorted(set(required_checks))
        if not required_checks:
            blockers.append("no required status checks are configured")
        if not has_strict_checks:
            blockers.append("required status checks do not require the branch to be up to date")
        if not has_pull_request_rule:
            blockers.append("pull requests are not required")
        return {"safe": not blockers, "reason": "; ".join(blockers) if blockers else "effective rules permit verified autonomous merges",
                "blocking_rules": blockers, "required_checks": required_checks}

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
