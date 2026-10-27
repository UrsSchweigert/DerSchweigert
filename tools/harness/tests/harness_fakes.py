"""TEST DOUBLE. An in-memory stand-in for GitHub used for fault injection. Not a real integration."""
from harness.github import Client, GitHubError, RateLimited
from harness.workrecord import render_block, sha


class Crash(Exception):
    """Simulated process death."""


class FakeGitHub(Client):
    def __init__(self, repo="owner/repo", native_sub_issues=False):
        self.repo = repo
        self.issues = {}
        self.milestones = {}
        self.comments = []
        self.sub_issues = []
        self.mutations = 0
        self.native = native_sub_issues
        self.rate_limits = []        # retry_after values to raise, one per call
        self.crash_after_create = 0  # raise Crash after storing the Nth new issue
        self.search_blind = False    # simulate search index lag
        self.prs = {}
        self.pr_sha = {}

    def _maybe_limit(self):
        if self.rate_limits:
            raise RateLimited("secondary rate limit", self.rate_limits.pop(0))

    def find_by_marker(self, stable_id):
        self._maybe_limit()
        if self.search_blind:
            return None
        for issue in self.issues.values():
            if ("id=%s " % stable_id) in issue["body"]:
                return dict(issue)
        return None

    def get_issue(self, number):
        self._maybe_limit()
        if number not in self.issues:
            raise GitHubError("issue %d not found" % number)
        return dict(self.issues[number])

    def create_issue(self, title, body, labels, milestone=None):
        self._maybe_limit()
        number = len(self.issues) + 1
        self.issues[number] = {"number": number, "title": title, "body": body, "author": "UrsSchweigert",
                               "editor": None, "milestone": milestone, "labels": labels}
        self.mutations += 1
        if self.crash_after_create and number == self.crash_after_create:
            raise Crash("died after the remote write")
        return dict(self.issues[number])

    def update_issue(self, number, body):
        self._maybe_limit()
        self.issues[number]["body"] = body
        self.mutations += 1

    def add_comment(self, number, body):
        self._maybe_limit()
        self.comments.append((number, body))
        self.mutations += 1

    def find_milestone(self, title):
        self._maybe_limit()
        return self.milestones.get(title)

    def create_milestone(self, title, description):
        self._maybe_limit()
        self.milestones[title] = len(self.milestones) + 1
        self.mutations += 1
        return self.milestones[title]

    def add_sub_issue(self, parent, child):
        self.sub_issues.append((parent, child))
        self.mutations += 1

    def find_pr(self, branch):
        self._maybe_limit()
        return next((n for n, p in self.prs.items() if p["head"] == branch and p["state"] == "open"), None)

    def create_pr(self, title, body, head, base):
        self._maybe_limit()
        number = 100 + len(self.prs)
        self.prs[number] = {"title": title, "head": head, "base": base, "state": "open", "sha": self.pr_sha.get(head, "")}
        self.mutations += 1
        return number

    def merge_pr(self, number, sha, method="squash"):
        self._maybe_limit()
        if self.prs[number]["sha"] and self.prs[number]["sha"] != sha:
            raise GitHubError("head branch was modified: merge refused")
        self.prs[number]["state"] = "merged"
        self.mutations += 1
        return True

    def capabilities(self):
        return {"repo": self.repo, "native_sub_issues": self.native, "projects": "unavailable: test double"}

    def merge_protection(self, base):
        return {"safe": True, "reason": "test double: strict required checks enforced for administrators"}

    # Test helpers that act as other GitHub users.
    def edit_as(self, number, user, new_body):
        self.issues[number]["body"] = new_body
        self.issues[number]["editor"] = user

    def forge_block(self, number, user, stable_id, content):
        self.edit_as(number, user, render_block(stable_id, content))
