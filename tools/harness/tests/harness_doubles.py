"""TEST DOUBLES for fault injection. They are not real integrations: FakeAdapter stands in for the runtime,
FakeRepo for git, and FakeChecker for the sandboxed check runner."""
import itertools
import json
import os

from harness import approval, cli, humantasks, plans
from harness.adapter import Adapter, Poll
from harness.checks import Checker, DryRunPublisher
from harness.repo import RebaseResult, Repo
from harness.scheduler import Scheduler, new_issue
from harness.store import Store

FIX = os.path.join(os.path.dirname(__file__), "..", "fixtures")
REQ = os.path.join(FIX, "requirements.md")
TIER_A = {"tier": "A", "reason": "test double: pretend isolation is verified"}


class FakeRepo(Repo):
    def __init__(self):
        self.rev = 1
        self.history = {1: []}          # rev -> paths changed since the previous rev
        self.branches = {}              # name -> dict(head, paths, lines, patch)
        self.rebase_conflict = False
        self.rebase_new_patch = False
        self.rebased = []

    def base_head(self):
        return "base%d" % self.rev

    def advance_base(self, paths):
        self.rev += 1
        self.history[self.rev] = list(paths)

    def changed_paths(self, old, new):
        lo, hi = int(old[4:]), int(new[4:])
        return sorted({p for r in range(lo + 1, hi + 1) for p in self.history.get(r, [])})

    def set_branch(self, name, paths, lines=10, head=None, patch="patch-1", base=None, added=None, removed=None):
        self.branches[name] = {"head": head or "head-%s-%d" % (name, len(self.rebased) + self.rev), "paths": paths, "lines": lines,
                               "patch": patch, "base": base or self.base_head(),
                               "added": lines if added is None else added, "removed": 0 if removed is None else removed}

    def branch_head(self, branch):
        return self.branches[branch]["head"]

    def is_ancestor(self, ancestor, head):
        if ancestor == head:
            return True
        branch = next((record for record in self.branches.values() if record["head"] == head), None)
        return bool(branch and ancestor.startswith("base") and int(ancestor[4:]) <= int(branch["base"][4:]))

    def branch_changed_paths(self, branch):
        return list(self.branches[branch]["paths"])

    def numstat(self, branch):
        return self.branches[branch]["lines"]

    def numstat_diff(self, branch):
        record = self.branches[branch]
        return {"added": record.get("added", record["lines"]), "removed": record.get("removed", 0)}

    def patch_id(self, branch):
        return self.branches[branch]["patch"]

    def diff_text(self, branch, limit=60000):
        return "diff of " + branch

    def path_exists(self, path):
        return path.strip("/") in getattr(self, "existing", set())

    def pin_good(self, issue_id, head):
        self.pins = getattr(self, "pins", {})
        self.pins[issue_id] = head

    def pinned(self, issue_id):
        return getattr(self, "pins", {}).get(issue_id)

    def rebase(self, branch):
        self.rebased.append(branch)
        b = self.branches[branch]
        if self.rebase_conflict:
            return RebaseResult(True, b["head"], b["patch"])
        b["head"] += "+r"
        b["base"] = self.base_head()
        if self.rebase_new_patch:
            b["patch"] += "-changed"
        return RebaseResult(False, b["head"], b["patch"])


class FakeChecker(Checker):
    def __init__(self):
        self.calls = []
        self.commands_run = []
        self.fail_commands = set()
        self.fail_next = 0
        self.outputs = {}  # command -> output tail reported when it fails
        self.fail_calls = set()  # 1-based call numbers that fail, to fail only after a merge

    def run(self, issue_id, head_rev, commands):
        self.calls.append((issue_id, head_rev))
        self.commands_run.append(list(commands))
        failing = self.fail_next > 0 or any(c in self.fail_commands for c in commands) or len(self.calls) in self.fail_calls
        if self.fail_next > 0:
            self.fail_next -= 1
        return [dict({"command": c, "exit_code": 1 if failing else 0}, **({"output": self.outputs[c]} if failing and c in self.outputs else {})) for c in commands]


class FakeHandle:
    def __init__(self, req, started):
        self.req, self.started, self.cancelled = req, started, False
        self.tail = []


class FakeAdapter(Adapter):
    """Scripted per (issue, role). Each step: 'ok', 'error:<kind>', 'hang', 'busy', 'start_fails', or a dict override."""

    name = "test-double"

    def __init__(self, repo, clock):
        self.repo, self.clock = repo, clock
        self.scripts = {}
        self.started = []
        self.cancelled = []
        self.cleaned = []         # attempt ids whose working copy was released
        self.impl_paths = {}      # issue_id -> paths the implementer "changes"
        self.impl_lines = {}
        self.impl_added = {}       # issue_id -> lines added, when it differs from impl_lines
        self.impl_removed = {}     # issue_id -> lines removed
        self.verdicts = {}        # issue_id -> list of 'approve'/'changes_requested'
        self.decisions = {}       # issue_id -> delegator decisions, the last one repeats
        self.analyses = {}        # issue_id -> analyst analyses, the last one repeats
        self.overseer = None      # the overseer's answer, repeated until it is changed
        self.plans = {}           # issue_id -> extra refiner result fields (plan, plan_files, tier_fit, split_advice)
        self.size_usage = None    # what the adapter reports from prompt and file sizes
        self.runtime_lines = []   # usage lines the runtime printed
        self.agent_usage = None   # the estimate every worker reports about itself, malformed values included
        self.tail_lines = []      # what the worker "printed", for evidence tests

    def script(self, issue_id, role, *steps):
        self.scripts[(issue_id, role)] = list(steps)

    def probe(self, candidates=None):
        return {"available": True, "reason": "test double", "models": candidates}

    def start(self, req):
        queue = self.scripts.get((req.issue_id, req.role))
        step = queue.pop(0) if queue else "ok"
        if step == "start_fails":
            raise RuntimeError("runtime refused to start")
        self.started.append(req)
        h = FakeHandle(req, self.clock())
        h.tail = list(self.tail_lines)
        h.step = step
        h.base_rev = self.repo.base_head()
        return h

    def usage(self, h):
        out = {}
        if self.size_usage:
            out["size_estimate"] = dict(self.size_usage)
        if self.runtime_lines:
            out["runtime_lines"] = list(self.runtime_lines)
        return out

    def poll(self, h, now):
        req, step = h.req, h.step
        if step == "hang":
            return Poll("running", h.started, None, None)
        if step == "busy":
            return Poll("running", now, None, None)
        if step.startswith("error:"):
            return Poll("finished", now, None, {"kind": step.split(":", 1)[1]})
        if isinstance(step, str) and step == "bad_schema":
            return Poll("finished", now, {"attempt_id": req.attempt_id}, None)
        branch = req.branch
        if req.role == "implementer":
            self.repo.set_branch(branch, self.impl_paths.get(req.issue_id, ["src/%s.py" % req.issue_id]), self.impl_lines.get(req.issue_id, 10),
                                 base=h.base_rev, added=self.impl_added.get(req.issue_id), removed=self.impl_removed.get(req.issue_id))
        result = {"attempt_id": req.attempt_id, "epoch": req.epoch, "outcome": "done", "changed_files": [], "revision": "",
                  "checks": [], "risks": [], "blockers": [], "next_action": "review"}
        if req.role == "implementer":
            result["revision"] = self.repo.branch_head(branch)
            if step == "blocked":
                result.update(outcome="blocked", blockers=["The helper this task depends on does not exist anywhere in the repository."],
                              next_action="needs direction")
            elif step == "done_with_blockers":
                result["blockers"] = ["I could not make the second acceptance criterion work."]
            elif step == "unknown_outcome":
                result["outcome"] = "not_sure"
        elif req.role == "delegator":
            queue = self.decisions.get(req.issue_id) or [{"action": "retry", "diagnosis": "The task is feasible. Try a different approach."}]
            result["decision"] = dict(queue.pop(0) if len(queue) > 1 else queue[0])
        elif req.role == "analyst":
            queue = self.analyses.get(req.issue_id) or [{"root_cause": "The task spans two modules that cannot be changed together.", "recommendation": "needs_owner"}]
            result["analysis"] = dict(queue.pop(0) if len(queue) > 1 else queue[0])
        elif req.role == "overseer":
            result["overseer"] = dict(self.overseer or {"action": "escalate", "cause": "process",
                                                       "reason": "the test double has no overseer answer configured"})
        elif req.role == "reviewer":
            queue = self.verdicts.get(req.issue_id) or ["approve"]
            verdict = queue.pop(0) if len(queue) > 1 else queue[0]
            result.update(outcome=verdict, revision="someone-elses-head" if step == "wrong_revision" else self.repo.branch_head(branch),
                          risks=["finding"] if verdict != "approve" else [])
        elif req.role == "refiner":
            result["outcome"] = "needs_input" if step == "needs_input" else "not_sure" if step == "not_sure" else "ready"
            if step in ("needs_input", "not_sure"):
                result["blockers"] = ["The spec does not say whether the disclaimer repeats after a reload."]
            else:
                # A compliant worker under the current refinement contract declares the files its plan writes;
                # the default plan writes none. `plan_files: None` injects the non-compliant worker that omits it.
                result["plan_files"] = []
                result.update(dict(self.plans.get(req.issue_id) or {}))
                if result.get("plan_files", []) is None:
                    result.pop("plan_files")
        if self.agent_usage is not None:
            result["usage_estimate"] = self.agent_usage
        return Poll("finished", now, result, None)

    def cancel(self, h):
        h.cancelled = True
        self.cancelled.append(h.req.attempt_id)

    def cleanup(self, h):
        self.cleaned.append(h.req.attempt_id)


class Clock:
    def __init__(self, t=1000.0):
        self.t = t

    def __call__(self):
        return self.t

    def advance(self, s):
        self.t += s
        return self.t


class Env:
    """An approved plan, Tier A attestation override, and a scheduler wired to doubles."""

    def __init__(self, tmp_path, issues=None, allowlist=("src/",), merge_policy=None, available_models=("claude-haiku-4.5", "claude-sonnet-5", "claude-opus-5", "claude-opus-4.8"),
                 budgets=None, phases=None, authorized_operations=None, model_sources=None, policy_overrides=None):
        self.store = Store(str(tmp_path / "home"))
        phases = phases or [
            {"id": "P1", "outcomes": ["one"], "requirements": ["F1.1", "F1.2"], "path_allowlist": list(allowlist), "non_goals": ["x"],
             "dependencies": [], "exit_criteria": ["ok"], "validation": ["check-p1"]},
            {"id": "P2", "outcomes": ["two"], "requirements": ["F2.1"], "path_allowlist": list(allowlist), "non_goals": ["x"],
             "dependencies": ["P1"], "exit_criteria": ["ok"], "validation": ["check-p2"]},
        ]
        pf = tmp_path / "phases.json"
        pf.write_text(json.dumps({"phases": phases}))
        policy = json.loads(json.dumps(plans.DEFAULT_POLICY))
        if merge_policy:
            policy["merge_policy"] = merge_policy
        if authorized_operations is not None:
            policy["authorized_operations"] = list(authorized_operations)
        policy["budgets"].update(budgets or {})
        # New plans run with the overseer on (plans.DEFAULT_POLICY). These doubles are about the owner-facing paths
        # - what reaches a human task, what a repair budget does, what a block looks like - so they opt out unless a
        # test asks for the overseer explicitly.
        policy["overseer"] = {"enabled": False, "rounds_per_issue": 2}
        policy.update(policy_overrides or {})
        plan = plans.build_plan("fx", 1, plans.parse_requirements(REQ), phases, policy, fixture=True, model_sources=model_sources)
        assert not plans.validate_plan(plan)
        self.store.put_plan(plan, plans.plan_digest(plan))
        self.store.transition("plan", "fx@v1", "Proposed", "t")
        approval.approve(self.store, "fx", None, "owner", lambda p, d: True)
        self.clock = Clock()
        self.repo = FakeRepo()
        self.adapter = FakeAdapter(self.repo, self.clock)
        self.checker = FakeChecker()
        self.publisher = DryRunPublisher()
        self.rng_value = 0.0
        self.sched = Scheduler(self.store, "fx", 1, self.adapter, self.repo, self.checker, self.publisher, clock=self.clock,
                               rng=lambda: self.rng_value, isolation_override=TIER_A,
                               available_models=list(available_models) if available_models is not None else None)
        for spec in (issues if issues is not None else [("i1", "P1", ["F1.1", "F1.2"])]):
            self.add_issue(*spec)

    def add_issue(self, iid, phase, reqs, state="Ready", **fields):
        fields.setdefault("code_anchors", ["src/"])
        fields.setdefault("base_rev", self.repo.base_head())
        issue = new_issue(iid, "fx", phase, reqs, **fields)
        self.store.put_issue(issue)
        for s in ("Refining", "Ready", "In Progress", "In Review")[: ["Refining", "Ready", "In Progress", "In Review"].index(state) + 1]:
            self.store.transition("issue", iid, s, "setup")
        return issue

    def state(self, iid):
        return self.store.state("issue", iid)

    def tick(self, advance=10):
        self.clock.advance(advance)
        return self.sched.tick()

    def run_until(self, predicate, limit=60, advance=10):
        events = []
        for _ in range(limit):
            events += self.tick(advance)
            if predicate():
                return events
        raise AssertionError("condition not reached; events=%s states=%s" % (events[-6:], [(i["issue_id"], self.state(i["issue_id"])) for i in self.store.list_issues()]))

    def start(self):
        self.sched.start(self.clock())


class RecordingNotifier(humantasks.Notifier):
    """TEST DOUBLE: records notifications instead of delivering them."""

    def __init__(self):
        self.sent = []

    def send(self, recipient, subject, message, task):
        self.sent.append((recipient, subject, task["task_id"]))

    def subjects(self, task_id=None):
        return [(r, s) for r, s, t in self.sent if task_id in (None, t)]
