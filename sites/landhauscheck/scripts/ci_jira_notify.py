"""Report a CI job failure to Jira.

Creates a new Bug in project LHC (labelled 'ci-failure') or comments on an
existing open Bug with the same summary, so repeated failures don't spam the
board.

Usage (from a GitHub Actions step):
    python3 scripts/ci_jira_notify.py <job_name>

Environment variables read at runtime:
    JIRA_API_KEY    — Atlassian API token (from GitHub secret); script exits 0
                      if absent so the workflow step is non-blocking.
    GITHUB_SHA      — Commit SHA (set automatically by GitHub Actions)
    GITHUB_REPOSITORY — repo slug, e.g. "UrsSchweigert/BasicWebApp"
    GITHUB_RUN_ID   — Actions run ID used to build the run URL
"""

import base64
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request

HOST = "https://schweigert-dev.atlassian.net"
EMAIL = "urs.schweigert@outlook.com"
PROJECT = "LHC"


def _make_headers(api_key: str) -> dict[str, str]:
    auth = base64.b64encode(f"{EMAIL}:{api_key}".encode()).decode()
    return {
        "Authorization": f"Basic {auth}",
        "Content-Type": "application/json",
        "Accept": "application/json",
    }


def _call(
    method: str,
    path: str,
    hdrs: dict[str, str],
    body: object = None,
) -> dict | None:
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(
        f"{HOST}/rest/api/3{path}", data=data, headers=hdrs, method=method
    )
    try:
        with urllib.request.urlopen(req) as r:  # nosec B310 — URL is a hard-coded constant
            content = r.read()
            return json.loads(content) if content else {}
    except urllib.error.HTTPError as exc:
        print(f"Jira HTTP {exc.code}: {exc.read().decode()[:300]}", file=sys.stderr)
        return None


def main() -> None:
    if len(sys.argv) < 2:
        print("Usage: ci_jira_notify.py <job_name>", file=sys.stderr)
        sys.exit(1)

    job = sys.argv[1]
    api_key = os.environ.get("JIRA_API_KEY", "")
    if not api_key:
        print("JIRA_API_KEY not configured — skipping Jira notification")
        return

    sha = os.environ.get("GITHUB_SHA", "unknown")
    repo = os.environ.get("GITHUB_REPOSITORY", "")
    run_id = os.environ.get("GITHUB_RUN_ID", "")
    run_url = f"https://github.com/{repo}/actions/runs/{run_id}"
    hdrs = _make_headers(api_key)
    summary = f"CI: {job} job failed"

    jql = urllib.parse.quote(
        f'project={PROJECT} AND issuetype=Bug AND status NOT IN (Done,Closed)'
        f' AND labels="ci-failure" AND summary~"{summary}"'
    )
    issues = (_call("GET", f"/search?jql={jql}&maxResults=1", hdrs) or {}).get("issues", [])

    if issues:
        key = issues[0]["key"]
        comment = {
            "body": {
                "type": "doc",
                "version": 1,
                "content": [{"type": "paragraph", "content": [
                    {"type": "text", "text": f"Still failing on {sha[:7]}. Run: {run_url}"}
                ]}],
            }
        }
        _call("POST", f"/issue/{key}/comment", hdrs, comment)
        print(f"Commented on existing Jira bug {key}")
    else:
        desc = {
            "type": "doc",
            "version": 1,
            "content": [{"type": "paragraph", "content": [
                {"type": "text", "text": f'CI job "{job}" failed on {sha[:7]}. Run: {run_url}'}
            ]}],
        }
        result = _call("POST", "/issue", hdrs, {
            "fields": {
                "project": {"key": PROJECT},
                "issuetype": {"name": "Bug"},
                "summary": summary,
                "labels": ["ci-failure"],
                "description": desc,
            }
        }) or {}
        print(f"Created Jira bug {result.get('key', '?')} for {job} failure")


if __name__ == "__main__":
    main()
