"""`harness start`: one guided path from a requirements file to a running plan.

It runs the same commands the CLI offers one by one, asks before each irreversible step, and skips everything the store
already shows as done, so rerunning it resumes an interrupted attempt. It never approves on the owner's behalf: the
approval step still asks for the digest prefix in a real terminal.
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
from typing import Callable, Dict, List, Optional

from . import approval, isolation, models, plans, runner
from .store import Store, default_home

DEFAULT_SOURCES = ["copilot"]
RUNNABLE_STATES = ("Approved", "Executing", "Paused")


class Stop(Exception):
    """The wizard stops. The message already says what to do next."""

    def __init__(self, message: str, code: int = 2):
        super().__init__(message)
        self.code = code


def parse_sources(text: str, fallback: List[str]) -> List[str]:
    """Read a source list from one line: `deepseek, local`, `deepseek local`, or `deepseek+local`."""
    chosen = [part.strip().lower() for part in text.replace("+", ",").replace(" ", ",").split(",") if part.strip()]
    chosen = list(dict.fromkeys(chosen or fallback))
    unknown = [source for source in chosen if source not in models.SOURCES]
    if unknown:
        raise Stop("unknown model source(s) %s; choose from %s" % (", ".join(unknown), ", ".join(models.SOURCES)))
    return chosen


def _yes(ask: Callable[[str], str], question: str, default: bool = True) -> bool:
    answer = ask("%s [%s]: " % (question, "Y/n" if default else "y/N")).strip().lower()
    return default if not answer else answer in ("y", "yes")


def _source_line(catalog: Dict[str, Dict[str, List[str]]], source: str, accepted: Optional[set]) -> str:
    ids = [model for tier in models.TIERS for model in catalog[source][tier]]
    if accepted is None:
        return "%-8s %d candidate(s), not probed yet" % (source, len(ids))
    return "%-8s %d of %d accepted" % (source, len([model for model in ids if model in accepted]), len(ids))


def _accepted_models(store: Store) -> Optional[set]:
    cache = runner.cached_probe(store.home)
    return set(cache["available"]) if cache else None


def _environment(store: Store, home: str, args, execute, ask) -> None:
    print("1/6  Environment", flush=True)
    if not isolation.docker_available():
        raise Stop("Docker is not available; start it (for Colima run `colima start`), then rerun `harness start`")
    print("  docker: available", flush=True)
    if isolation.image_id() is None:
        if not _yes(ask, "  the worker image %s is missing. Build it now (a few minutes)?" % isolation.IMAGE):
            raise Stop("the worker image is required; run `harness isolation build`")
        if execute(["isolation", "build"]) != 0:
            raise Stop("the worker image could not be built")
    print("  worker image: %s" % isolation.IMAGE, flush=True)
    present = [name for name in ("claude.token", "copilot.token") if os.path.exists(os.path.join(home, name))]
    if not present:
        raise Stop("claude.token (or copilot.token) is missing from %s; see the one-time setup in tools/harness/README.md" % home)
    print("  %s: present" % ", ".join(present), flush=True)
    iso = approval.detect_isolation(store)
    if iso["tier"] != "A":
        print("  sandbox: %s" % iso["reason"], flush=True)
        if not _yes(ask, "  verify the sandbox now (about a minute)?"):
            raise Stop("a verified sandbox is required; run `harness isolation verify`")
        if execute(["isolation", "verify"]) != 0:
            raise Stop("the sandbox verification failed; rerun `harness isolation verify` to see which check failed")
        iso = approval.detect_isolation(store)
        if iso["tier"] != "A":
            raise Stop("the sandbox is still not verified: %s" % iso["reason"])
    print("  sandbox: Tier A", flush=True)
    if subprocess.run(["gh", "auth", "status"], capture_output=True).returncode != 0:
        print("  warning: `gh auth status` failed. Investigation and planning work, but a run needs a signed-in gh.",
              flush=True)


def _requirements(args, ask) -> str:
    print("\n2/6  Requirements", flush=True)
    path = args.requirements
    if not path:
        guess = "requirements.md" if os.path.exists("requirements.md") else ""
        path = ask("  requirements file%s: " % (" [%s]" % guess if guess else "")).strip() or guess
    if not path:
        raise Stop("a requirements file is required; rerun with `harness start --requirements FILE`")
    if not os.path.isfile(path):
        raise Stop("%s does not exist" % path)
    try:
        count = len(plans.parse_requirements(path))
    except OSError as exc:
        raise Stop("could not read %s: %s" % (path, exc))
    if not count:
        raise Stop("%s has no requirement rows like `| **1.1** | title | ... |`" % path)
    print("  %s: %d requirement(s)" % (path, count), flush=True)
    return path


def _sources(store: Store, args, execute, ask) -> List[str]:
    print("\n3/6  Model sources", flush=True)
    if args.model_source:
        return list(dict.fromkeys(args.model_source))
    standing = models.operator_sources()
    if standing:
        print("  using the operator default %s (set HARNESS_MODEL_SOURCES to change it)" % ",".join(standing), flush=True)
        return standing
    catalog = models.load_catalog(store.home)
    default = ["claude"] if os.path.exists(os.path.join(store.home, "claude.token")) else DEFAULT_SOURCES
    for attempt in range(3):
        accepted = _accepted_models(store)
        for source in models.SOURCES:
            print("  " + _source_line(catalog, source, accepted), flush=True)
        chosen = parse_sources(ask("  sources to allow [%s]: " % ",".join(default)), default)
        if accepted is None:
            if _yes(ask, "  probe them now to see what this runtime accepts (10-60 s)?"):
                execute(["models"] + sum([["--source", source] for source in chosen], []))
                accepted = _accepted_models(store)
        empty = []
        if accepted is not None:
            empty = [source for source in chosen
                     if not any(model in accepted for tier in models.TIERS for model in catalog[source][tier])]
        if not empty:
            return chosen
        print("  none of the %s ids are accepted here; run `harness models --source %s` to see them"
              % (", ".join(empty), " --source ".join(empty)), flush=True)
    raise Stop("no chosen source has a model this runtime accepts")


def _investigate(requirements: str, out_dir: str, sources: List[str], args, execute, ask) -> None:
    print("\n4/6  Investigation", flush=True)
    phases = os.path.join(out_dir, "phases.json")
    force = bool(args.redraft)
    if os.path.exists(phases) and not force:
        if not _yes(ask, "  a draft exists in %s. Investigate again?" % out_dir, default=False):
            print("  keeping the existing draft", flush=True)
            return
        force = True
    command = ["investigate", "--requirements", requirements, "--out", out_dir, "--tier", args.tier]
    for source in sources:
        command += ["--model-source", source]
    if force:
        command.append("--force")
    print("  investigating; this reads the repository and can take several minutes", flush=True)
    code = execute(command)
    if code == 3:
        raise Stop("the investigator needs answers; open %s, then rerun `harness start`" % out_dir)
    if code != 0:
        raise Stop("the investigator stopped (exit %d); see its messages above" % code)


def _plan(store: Store, requirements: str, out_dir: str, sources: List[str], args, execute) -> str:
    print("\n5/6  Plan", flush=True)
    phases = os.path.join(out_dir, "phases.json")
    if not os.path.exists(phases):
        raise Stop("no draft at %s; run `harness investigate --requirements %s`" % (phases, requirements))
    plan_id = args.plan_id or _slug(requirements)
    command = ["plan", "--requirements", requirements, "--phases", phases, "--plan-id", plan_id]
    for source in sources:
        command += ["--model-source", source]
    code = execute(command)
    stored = store.get_plan(plan_id)
    if stored is None:
        raise Stop("the plan was not written; see the plan output above")
    version = stored["plan"]["version"]
    state = store.state("plan", approval.plan_entity(plan_id, version))
    if state == "Draft":
        problems = plans.validate_plan(stored["plan"])
        raise Stop("the draft does not validate:\n  - %s\nRevise it (`harness investigate --feedback ...`) and rerun"
                   % "\n  - ".join(problems[:6]))
    if code != 0:
        raise Stop("the plan preflight failed (exit %d); fix the reported checks and rerun" % code)
    print("  plan %s v%d: %s" % (plan_id, version, state), flush=True)
    return plan_id


def _approve(store: Store, plan_id: str, execute, ask) -> None:
    stored = store.get_plan(plan_id)
    version = stored["plan"]["version"]
    state = store.state("plan", approval.plan_entity(plan_id, version))
    if state == "Approved":
        print("  plan is already approved", flush=True)
        return
    if state in ("Executing", "Paused", "Completed"):
        return
    if state != "Proposed":
        raise Stop("plan %s is %s, not Proposed" % (plan_id, state))
    if not _yes(ask, "  approve plan %s v%d? You still type the digest prefix next" % (plan_id, version)):
        raise Stop("approval declined; the plan stays Proposed (approve later with `harness approve %s`)" % plan_id)
    if execute(["approve", plan_id, "--version", str(version)]) != 0:
        raise Stop("approval did not complete; the plan stays Proposed")


def _import(store: Store, plan_id: str, out_dir: str, execute, ask) -> None:
    print("\n6/6  Issues", flush=True)
    existing = store.list_issues(plan_id)
    if existing:
        print("  %d issue(s) already imported" % len(existing), flush=True)
        return
    path = os.path.join(out_dir, "issues.json")
    if not os.path.exists(path):
        raise Stop("no issues.json in %s; import issues with `harness import-issues %s FILE`" % (out_dir, plan_id))
    try:
        with open(path, encoding="utf-8") as fh:
            docs = json.load(fh)
    except (OSError, ValueError) as exc:
        raise Stop("could not read %s: %s" % (path, exc))
    docs = docs["issues"] if isinstance(docs, dict) else docs
    if not docs:
        raise Stop("%s has no issues" % path)
    if not _yes(ask, "  import %d issue(s) from %s?" % (len(docs), path)):
        raise Stop("no issues imported; import them later with `harness import-issues %s %s`" % (plan_id, path))
    version = store.get_plan(plan_id)["plan"]["version"]
    if execute(["import-issues", plan_id, path, "--version", str(version)]) != 0:
        raise Stop("issue import failed; see the messages above")


def _run(store: Store, plan_id: str, args, execute, ask) -> int:
    stored = store.get_plan(plan_id)
    version = stored["plan"]["version"]
    state = store.state("plan", approval.plan_entity(plan_id, version))
    if state == "Completed":
        print("\nPlan %s already completed." % plan_id, flush=True)
        return 0
    command = ["resume" if state in ("Executing", "Paused") else "run", plan_id, "--version", str(version)]
    if args.repo:
        command += ["--repo", args.repo]
    print("\nRun %s (%s)" % (plan_id, state), flush=True)
    print("  1  run here, in this terminal (Ctrl+C stops safely and `harness resume %s` continues)" % plan_id, flush=True)
    print("  2  open the dashboard and start it there", flush=True)
    print("  3  stop here", flush=True)
    choice = (ask("  choice [1]: ").strip() or "1")[:1]
    if choice == "1":
        print("  every merge to main deploys to production; the gates and budgets from the plan still apply", flush=True)
        return execute(command)
    if choice == "2":
        return execute(["gui"] + (["--repo", args.repo] if args.repo else []))
    print("  start it later with: harness %s" % " ".join(command), flush=True)
    return 0


def _slug(path: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", os.path.basename(path).lower()).strip("-") or "plan"


def run_start(args, *, ask: Callable[[str], str] = input, execute: Optional[Callable[[List[str]], int]] = None) -> int:
    """Walk the owner through the steps, skipping the ones the store already shows as done."""
    home = args.home or default_home()
    if execute is None:
        from . import cli
        execute = lambda argv: cli.main((["--home", args.home] if args.home else []) + list(argv))
    store = Store(home)
    try:
        print("Harness start. Store: %s" % home, flush=True)
        if args.plan_id:
            stored = store.get_plan(args.plan_id)
            if stored:
                version = stored["plan"]["version"]
                state = store.state("plan", approval.plan_entity(args.plan_id, version))
                if state == "Completed":
                    print("Plan %s v%d is already completed." % (args.plan_id, version), flush=True)
                    return 0
                if state in RUNNABLE_STATES:
                    print("Plan %s v%d is %s; continuing from there." % (args.plan_id, version, state), flush=True)
                    return _run(store, args.plan_id, args, execute, ask)
        _environment(store, home, args, execute, ask)
        requirements = _requirements(args, ask)
        out_dir = args.out or os.path.join(os.path.dirname(os.path.abspath(requirements)),
                                          os.path.basename(requirements) + "_plan")
        sources = _sources(store, args, execute, ask)
        _investigate(requirements, out_dir, sources, args, execute, ask)
        plan_id = _plan(store, requirements, out_dir, sources, args, execute)
        _approve(store, plan_id, execute, ask)
        _import(store, plan_id, out_dir, execute, ask)
        return _run(store, plan_id, args, execute, ask)
    except Stop as stop:
        print("\nStopped: %s" % stop, file=sys.stderr, flush=True)
        return stop.code
    except EOFError:
        print("\nStopped: this walkthrough needs answers; run `harness start` in a terminal", file=sys.stderr, flush=True)
        return 2
    except KeyboardInterrupt:
        print("\nStopped. Nothing was left half-done; rerun `harness start` to continue.", file=sys.stderr, flush=True)
        return 130
    finally:
        store.close()
