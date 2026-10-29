"""Persisted dashboard planning workspaces and fixed, asynchronous preparation jobs."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import secrets
import time
import traceback
from pathlib import Path

from . import approval, cli, plans, runner
from .broker import assert_no_secrets
from .store import Store

KINDS = ("investigate", "plan", "import")
MAX_MARKDOWN = 1024 * 1024


def requirements_from_markdown(text: str) -> list[dict]:
    if not isinstance(text, str) or not text.strip():
        raise ValueError("Markdown must not be empty")
    if len(text.encode("utf-8")) > MAX_MARKDOWN:
        raise ValueError("Markdown is limited to 1 MiB")
    assert_no_secrets(text, "requirements")
    rows = plans.requirements_from_table(text, "requirements.md")
    if rows:
        return rows
    blocks, block = [], []
    fenced = False
    for line in text.splitlines():
        stripped = line.strip()
        if re.match(r"^(`{3,}|~{3,})", stripped):
            fenced = not fenced
        starts_item = not fenced and re.match(r"^(?:[-+*]|\d+[.)])\s+", stripped)
        heading = not fenced and re.match(r"^#{1,6}\s+", stripped)
        if not stripped or starts_item or heading:
            if block:
                blocks.append(" ".join(block))
                block = []
        if stripped and not heading:
            block.append(re.sub(r"^(?:[-+*]|\d+[.)])\s+(?:\[[ xX]\]\s*)?", "", stripped)
                         if starts_item else stripped)
    if block:
        blocks.append(" ".join(block))
    if not blocks:
        raise ValueError("Markdown contains no paragraphs or list items")
    return [{"id": "R%d" % (index + 1), "title": title, "source": "requirements.md"}
            for index, title in enumerate(blocks)]


def directory(store: Store, workspace_id: str) -> Path:
    if not isinstance(workspace_id, str) or not re.fullmatch(r"[a-f0-9]{16}", workspace_id):
        raise ValueError("invalid workspace ID")
    return Path(store.home) / "gui-workspaces" / workspace_id


def workspace(store: Store, workspace_id: str) -> dict:
    directory(store, workspace_id)
    record = store.get_doc("gui_workspace", workspace_id)
    if record is None:
        raise KeyError("workspace not found")
    return record


def job_alive(job: dict) -> bool:
    if job["state"] != "running":
        return False
    pid = job.get("pid")
    if pid is None:
        return time.time() - job.get("started_at", 0) <= 30
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


def visible_record(record: dict) -> dict:
    record = dict(record)
    if record["job"] and record["job"]["state"] == "running" and not job_alive(record["job"]):
        record["job"] = dict(record["job"], state="failed", error="preparation stopped without recording a result; retry after reading output")
    return record


def job_directory(store: Store, workspace_id: str = "") -> Path:
    return directory(store, workspace_id) if workspace_id else Path(store.home) / "gui-maintenance"


def job_output(store: Store, record: dict, workspace_id: str = "") -> str:
    if not record["job"]:
        return ""
    log = job_directory(store, workspace_id) / (record["job"]["id"] + ".log")
    if not log.is_file():
        return ""
    with log.open("rb") as source:
        source.seek(0, 2)
        source.seek(max(0, source.tell() - 32768))
        return source.read().decode("utf-8", errors="replace")


def maintenance_detail(store: Store) -> dict:
    record = visible_record(store.get_doc("gui_maintenance", "isolation") or {"job": None})
    return dict(record, output=job_output(store, record))


def execute_maintenance(store: Store) -> str:
    print("Verifying the Docker worker sandbox. This may take a few minutes.", flush=True)
    if cli.isolation_command("verify", store.home):
        raise runner.RunRefused("sandbox verification failed; see probe output and check Docker and the worker image")
    return "succeeded"


def create(store: Store, body: dict) -> dict:
    text = body.get("markdown")
    requirements_from_markdown(text)
    name = body.get("name", "requirements.md")
    if not isinstance(name, str) or not name.strip() or len(name) > 120:
        raise ValueError("a name of at most 120 characters is required")
    rows = body.get("requirements")
    if not isinstance(rows, list) or not rows or len(rows) > 200:
        raise ValueError("supply between 1 and 200 requirements")
    seen = set()
    normalized = []
    for row in rows:
        if not isinstance(row, dict):
            raise ValueError("each requirement needs an ID and text")
        rid, title = row.get("id"), row.get("title")
        if not isinstance(rid, str) or not re.fullmatch(r"[A-Za-z]*\d+(?:\.\d+)*", rid) or rid in seen:
            raise ValueError("requirement IDs must be unique, for example R1 or 1.1")
        if not isinstance(title, str) or not title.strip() or len(title) > 2000:
            raise ValueError("each requirement needs 1-2000 characters; split long paragraphs")
        seen.add(rid)
        normalized.append({"id": rid, "title": " ".join(title.split()), "source": "requirements.md"})
    assert_no_secrets(normalized, "requirements")
    workspace_id = secrets.token_hex(8)
    root = directory(store, workspace_id)
    root.mkdir(parents=True, mode=0o700)
    content = "# Requirements\n\n| ID | Requirement |\n| --- | --- |\n"
    content += "\n".join("| **%s** | **%s** |" % (r["id"], r["title"].replace("|", "&#124;"))
                         for r in normalized)
    content += "\n\n## Original Markdown (context only; the edited requirements table above is authoritative)\n\n"
    content += "\n".join("> " + line for line in text.splitlines()) + "\n"
    for filename, value in (("requirements.md", content + "\n"), ("source.md", text)):
        target = root / filename
        target.write_text(value, encoding="utf-8")
        target.chmod(0o600)
    record = {"workspace_id": workspace_id, "name": name, "plan_id": cli._slug(name) + "-" + workspace_id[:8],
              "requirements": normalized, "job": None}
    store.put_doc("gui_workspace", workspace_id, record)
    return record


def detail(store: Store, workspace_id: str) -> dict:
    record = visible_record(workspace(store, workspace_id))
    root = directory(store, workspace_id)
    out = root / "draft"
    record.update(report="", questions=[], draft=None, plan=None, preflight=None, output="")
    if (out / "investigation-report.md").is_file():
        record["report"] = (out / "investigation-report.md").read_text(encoding="utf-8")
    if (out / "investigation.json").is_file():
        record["questions"] = json.loads((out / "investigation.json").read_text(encoding="utf-8")).get("pending", [])
    if (out / "phases.json").is_file() and (out / "issues.json").is_file():
        record["draft"] = {"phases": json.loads((out / "phases.json").read_text(encoding="utf-8"))["phases"],
                           "issues": json.loads((out / "issues.json").read_text(encoding="utf-8"))["issues"]}
    stored = store.get_plan(record["plan_id"])
    if stored:
        record["plan"] = dict(stored, state=store.state("plan", approval.plan_entity(record["plan_id"], stored["plan"]["version"])))
        record["preflight"] = store.get_doc("check_preflight", approval.plan_entity(record["plan_id"], stored["plan"]["version"]))
    record["output"] = job_output(store, record, workspace_id)
    return record


def assert_review_current(store: Store, record: dict, current: dict) -> None:
    root = directory(store, record["workspace_id"]) / "draft"
    if (root / "investigation.json").is_file() and json.loads(
            (root / "investigation.json").read_text(encoding="utf-8")).get("pending"):
        raise runner.RunRefused("answer the investigator's pending questions first")
    if not (root / "phases.json").is_file() or not (root / "issues.json").is_file():
        raise runner.RunRefused("investigate and prepare the plan first")
    phases = json.loads((root / "phases.json").read_text(encoding="utf-8"))["phases"]
    issues = json.loads((root / "issues.json").read_text(encoding="utf-8"))["issues"]
    proof = store.get_doc("check_preflight", approval.plan_entity(record["plan_id"], current["plan"]["version"])) or {}
    if (phases != current["plan"]["phases"] or proof.get("digest") != current["digest"]
            or proof.get("issue_digest") != hashlib.sha256(plans.canonical(issues)).hexdigest()):
        raise runner.RunRefused("the draft changed; prepare and review the plan again")
    for issue in issues:
        existing = store.get_issue(issue["issue_id"])
        if existing and existing["plan_id"] != record["plan_id"]:
            raise runner.RunRefused("issue ID %s is already used by another plan; revise the draft with unique IDs before approval" % issue["issue_id"])


def execute(store: Store, record: dict) -> str:
    root = directory(store, record["workspace_id"])
    out = root / "draft"
    job = record["job"]
    kind = job["kind"]
    requirements = root / "requirements.md"
    if approval.detect_isolation(store)["tier"] != "A":
        raise runner.RunRefused("current Tier A isolation verification is required")
    if kind == "investigate":
        args = ["--home", store.home, "investigate", "--requirements", str(requirements), "--out", str(out), "--non-interactive"]
        if job.get("feedback"):
            args.extend(["--feedback", job["feedback"]])
        if job.get("answers"):
            answers = root / (job["id"] + "-answers.json")
            answers.write_text(json.dumps(job["answers"]), encoding="utf-8")
            answers.chmod(0o600)
            args.extend(["--answers", str(answers)])
        code = cli.main(args)
        if code == 3:
            return "needs_answers"
        if code:
            raise runner.RunRefused("investigation failed (exit %d); see output" % code)
    elif kind == "plan":
        result = cli.plan_command(store, str(requirements), str(out / "phases.json"), record["plan_id"])
        if result["state"] != "Proposed":
            raise runner.RunRefused("plan is not Proposed: %s" % result.get("problems", result["state"]))
        issues = json.loads((out / "issues.json").read_text(encoding="utf-8"))["issues"]
        proof = cli.preflight_plan(store, record["plan_id"], result["version"], str(Path.cwd()), issues)
        errors = [r for r in proof["results"] if r.get("kind") == "configuration"]
        if errors:
            raise runner.RunRefused("validation configuration errors: %s" % json.dumps(errors))
    elif kind == "import":
        version = job["version"]
        current = store.get_plan(record["plan_id"])
        if not current or current["plan"]["version"] != version or current["digest"] != job["digest"]:
            raise runner.RunRefused("the plan changed; review it again")
        approval.authorize_run(store, record["plan_id"], version)
        assert_review_current(store, record, current)
        code = cli.main(["--home", store.home, "import-issues", "--version", str(version),
                         record["plan_id"], str(out / "issues.json")])
        if code:
            raise runner.RunRefused("issue import failed (exit %d); see output" % code)
    else:
        raise ValueError("unknown preparation job")
    return "succeeded"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--home", required=True)
    target = parser.add_mutually_exclusive_group(required=True)
    target.add_argument("--workspace")
    target.add_argument("--maintenance", action="store_true")
    parser.add_argument("--job", required=True)
    args = parser.parse_args()
    store = Store(args.home)
    try:
        doc_kind, key = ("gui_maintenance", "isolation") if args.maintenance else ("gui_workspace", args.workspace)
        record = store.get_doc(doc_kind, key) if args.maintenance else workspace(store, args.workspace)
        if record is None:
            raise runner.RunRefused("preparation job not found")
        if not record["job"] or record["job"]["id"] != args.job or record["job"]["state"] != "running":
            raise runner.RunRefused("preparation job is no longer current")
        try:
            state = execute_maintenance(store) if args.maintenance else execute(store, record)
        except Exception as exc:
            traceback.print_exc()
            record["job"].update(state="failed", error=str(exc))
        else:
            record["job"].update(state=state)
        with store.tx():
            latest = store.get_doc(doc_kind, key)
            if latest["job"]["id"] == args.job:
                latest["job"].update(record["job"])
                store.put_doc(doc_kind, key, latest)
        return 1 if record["job"]["state"] == "failed" else 0
    finally:
        store.close()


if __name__ == "__main__":
    raise SystemExit(main())
