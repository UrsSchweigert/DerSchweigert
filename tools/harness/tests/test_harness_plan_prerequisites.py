"""A plan that writes owner-merged files is held before an implementer is paid to carry it out.

The diff gate has always refused such a change, but only after the attempt was spent. These tests use the plans
three real refinements produced in the iOS/Android run: one that planned a dependency edit and two that named the
same protected file only to keep hands off it. Prose is never evidence here; only the refiner's file declaration is.
"""

from harness import broker, plans, scheduler
from harness_doubles import Env


LONG_BUDGETS = {"lease_s": 10**7, "run_wall_clock_s": 10**8, "worker_timeout_s": 10**7, "inactivity_timeout_s": 10**7}

# The plan claude-sonnet-5 actually returned for lesen-parent-report. Step 7 is the one that cost an attempt.
PARENT_REPORT_PLAN = [
    "static/platform.mjs: add a clock-injectable practice-time helper inside createWebProgress that reads/writes a new store key.",
    "static/platform.mjs: add createWebExport(win) that uses win.Capacitor.Plugins.Filesystem + Share when present.",
    "static/parent-report.mjs (new): export a pure buildReport(cards, practiceMs) and toCsv(report).",
    "static/index.html: add a 'Parent Report' button that passes the CSV text to window.__platform.export.save.",
    "sites/lesen/package.json: add @capacitor/filesystem and @capacitor/share dependencies at the same major version as the "
    "existing @capacitor/* entries (do not touch android/build.gradle, android/settings.gradle or android/app/AndroidManifest.xml; "
    "those are escalation-path files the owner must regenerate via `npm run sync`).",
    "sites/lesen/tests/parent-report.test.mjs (new): unit tests for buildReport/toCsv with a golden-fixture CSV.",
    "Run `node --test tests/*.test.mjs` from sites/lesen to confirm all existing and new tests pass.",
]

# Two real plans that mention the same protected files on purpose, to keep the implementer away from them.
OFFLINE_BUNDLE_STEP = ("Leave sites/lesen/capacitor.config.json unchanged (it already has no server.url) and do not edit "
                       "sites/lesen/package.json, which is owner-merged.")
CAPACITOR_UPGRADE_STEP = ("Run `git status --short` in the repo and confirm every changed tracked file is inside the task path "
                          "allowlist, reverting any package.json or package-lock.json dependency-pin churn introduced by npm or cap.")


def refining_env(tmp_path, working_directory=None, **issue_fields):
    """An issue whose base moved under it, so the refiner runs before any implementer is dispatched."""
    allowlist = ("src/", "sites/lesen/")
    phases = [{"id": "P1", "outcomes": ["one"], "requirements": ["F1.1", "F1.2"], "path_allowlist": list(allowlist), "non_goals": ["x"],
               "dependencies": [], "exit_criteria": ["ok"], "validation": ["check-p1"]},
              {"id": "P2", "outcomes": ["two"], "requirements": ["F2.1"], "path_allowlist": list(allowlist), "non_goals": ["x"],
               "dependencies": ["P1"], "exit_criteria": ["ok"], "validation": ["check-p2"]}]
    if working_directory:
        phases[0]["working_directory"] = working_directory
    env = Env(tmp_path, issues=[], allowlist=allowlist, budgets=dict(LONG_BUDGETS), phases=phases)
    env.add_issue("i1", "P1", ["F1.1"], code_anchors=["sites/lesen/static/parent-report.mjs"], **issue_fields)
    env.repo.existing = {"sites/lesen/static/parent-report.mjs"}
    env.repo.advance_base(["sites/lesen/static/parent-report.mjs"])
    return env


def run_refinement(env, plan=None, plan_files=None, **extra):
    fields = dict(extra)
    if plan is not None:
        fields["plan"] = plan
    if plan_files is not None:
        fields["plan_files"] = plan_files
    env.adapter.plans["i1"] = fields
    env.start()
    return env.run_until(lambda: env.state("i1") in ("Blocked", "In Progress"))


def roles(env):
    return [r.role for r in env.adapter.started]


# -- the regression: the plan that actually cost an attempt --------------------------------------------------------

def test_the_parent_report_plan_is_held_as_a_prerequisite_instead_of_dispatching_an_implementer(tmp_path):
    env = refining_env(tmp_path, working_directory="sites/lesen")
    events = run_refinement(env, plan=PARENT_REPORT_PLAN,
                            plan_files=["static/platform.mjs", "static/parent-report.mjs", "static/index.html",
                                        "tests/parent-report.test.mjs", "package.json"])
    assert env.state("i1") == "Blocked"
    assert roles(env) == ["refiner"]  # no implementer was ever paid for
    issue = env.store.get_issue("i1")
    assert issue["plan_prerequisites"] == ["package.json"]
    assert "owner-merged" in issue["blocked_reason"] and "package.json" in issue["blocked_reason"]
    assert "no implementer was started" in issue["blocked_reason"]
    assert issue["plan"][4].startswith("sites/lesen/package.json:")  # the plan is kept, so the owner reads what was asked for
    prerequisite = issue["last_failures"][-1]
    assert prerequisite["kind"] == "protected_prerequisite" and prerequisite["class"] == "human"
    assert any(e["event"] == "plan_prerequisite" and e["paths"] == ["package.json"] for e in events)


def test_holding_the_plan_spends_no_budget_and_keeps_the_refinement_a_success(tmp_path):
    env = refining_env(tmp_path, working_directory="sites/lesen")
    run_refinement(env, plan=PARENT_REPORT_PLAN, plan_files=["package.json"])
    issue = env.store.get_issue("i1")
    assert (issue["repair_failures"], issue["transient_failures"], issue["strong_attempts"]) == (0, 0, 0)
    assert env.store.get_attempt("i1#1")["outcome"] == "Succeeded"  # the refiner answered; it did not fail
    assert env.store.get_attempt("i1#1").get("failure_kind") is None


def test_the_owner_is_asked_once_with_the_file_that_needs_merging(tmp_path):
    from harness import humantasks
    env = refining_env(tmp_path, working_directory="sites/lesen")
    run_refinement(env, plan=PARENT_REPORT_PLAN, plan_files=["package.json"])
    [task] = env.store.human_tasks("i1")
    assert task["kind"] == "decision"
    assert "package.json" in humantasks.render_task(task)


def test_a_repository_relative_declaration_is_caught_the_same_way(tmp_path):
    env = refining_env(tmp_path, working_directory="sites/lesen")
    run_refinement(env, plan=PARENT_REPORT_PLAN, plan_files=["sites/lesen/package-lock.json"])
    assert env.state("i1") == "Blocked"
    assert env.store.get_issue("i1")["plan_prerequisites"] == ["sites/lesen/package-lock.json"]


# -- negative cases: a protected file named in prose is not a planned edit -----------------------------------------

def test_a_plan_that_says_not_to_edit_the_protected_file_still_runs(tmp_path):
    env = refining_env(tmp_path, working_directory="sites/lesen")
    run_refinement(env, plan=[OFFLINE_BUNDLE_STEP, "Create sites/lesen/scripts/verify-bundle.mjs with the bundle manifest."],
                   plan_files=["scripts/verify-bundle.mjs"])
    assert env.state("i1") == "In Progress" and "implementer" in roles(env)
    assert "plan_prerequisites" not in env.store.get_issue("i1")


def test_a_plan_that_reverts_churn_in_a_protected_file_still_runs(tmp_path):
    env = refining_env(tmp_path, working_directory="sites/lesen")
    run_refinement(env, plan=[CAPACITOR_UPGRADE_STEP, "Edit sites/lesen/static/parent-report.mjs to add the export."],
                   plan_files=["static/parent-report.mjs"])
    assert env.state("i1") == "In Progress" and "implementer" in roles(env)


# -- the contract: a refinement dispatched under it owes a declaration --------------------------------------------

def test_a_refinement_under_the_contract_cannot_implement_without_declaring_its_files(tmp_path):
    env = refining_env(tmp_path, working_directory="sites/lesen")
    env.adapter.plans["i1"] = {"plan": PARENT_REPORT_PLAN, "plan_files": None}  # a worker that ignores the contract
    env.start()
    env.run_until(lambda: env.store.get_attempt("i1#1").get("outcome") == "Failed")
    attempt = env.store.get_attempt("i1#1")
    assert attempt["result_contract"] == scheduler.REFINER_RESULT_CONTRACT  # recorded at dispatch, not taken from the result
    assert attempt["failure_kind"] == "schema_invalid"
    assert scheduler.REFINER_RESULT_CONTRACT in attempt["detail"] and "plan_files" in attempt["detail"]
    assert "implementer" not in roles(env)
    assert env.state("i1") != "In Progress"


def test_the_rejected_refinement_tells_the_next_attempt_what_was_missing(tmp_path):
    env = refining_env(tmp_path, working_directory="sites/lesen")
    env.adapter.plans["i1"] = {"plan": PARENT_REPORT_PLAN, "plan_files": None}
    env.start()
    env.run_until(lambda: len([r for r in env.adapter.started if r.role == "refiner"]) > 1)
    retry = [r for r in env.adapter.started if r.role == "refiner"][1]
    carried = retry.packet["untrusted_data"]  # the worker reads this, so the contract failure is actionable in-band
    assert "your_previous_answer_was_rejected" in carried and "plan_files" in carried
    assert scheduler.REFINER_RESULT_CONTRACT in carried


def test_an_explicit_empty_declaration_is_a_valid_read_only_plan(tmp_path):
    env = refining_env(tmp_path, working_directory="sites/lesen")
    run_refinement(env, plan=["Read sites/lesen/static/parent-report.mjs and confirm the export already exists."],
                   plan_files=[])
    assert env.state("i1") == "In Progress" and "implementer" in roles(env)
    assert env.store.get_attempt("i1#1")["outcome"] == "Succeeded"


def test_an_attempt_dispatched_before_the_contract_is_still_accepted(tmp_path):
    """History and workers in flight across the upgrade: no marker in the attempt record, so the old rules apply."""
    env = refining_env(tmp_path, working_directory="sites/lesen")
    env.adapter.script("i1", "refiner", "hang")
    env.adapter.plans["i1"] = {"plan": PARENT_REPORT_PLAN, "plan_files": None}
    env.start()
    env.run_until(lambda: any(r.role == "refiner" for r in env.adapter.started))
    meta = env.store.get_attempt("i1#1")
    meta.pop("result_contract")  # as an attempt recorded by the previous version of this scheduler
    env.store.put_attempt(meta)
    next(h["handle"] for h in env.sched.handles.values() if h["handle"].req.role == "refiner").step = "ok"
    env.run_until(lambda: env.state("i1") == "In Progress")
    assert env.store.get_attempt("i1#1")["outcome"] == "Succeeded" and "implementer" in roles(env)


# -- every declared path is inspected, and a bound is an error rather than a shortened list ------------------------

def test_a_protected_path_past_the_old_truncation_point_is_still_held(tmp_path):
    env = refining_env(tmp_path, working_directory="sites/lesen")
    declared = ["static/mod-%d.mjs" % n for n in range(51)] + ["package.json"] + ["tests/t-%d.test.mjs" % n for n in range(8)]
    assert declared.index("package.json") == 51  # past the 50 entries an earlier draft of this guard read
    run_refinement(env, plan=PARENT_REPORT_PLAN, plan_files=declared)
    assert env.state("i1") == "Blocked"
    assert env.store.get_issue("i1")["plan_prerequisites"] == ["package.json"]
    assert "implementer" not in roles(env)


def test_an_oversize_declaration_fails_closed_instead_of_being_shortened(tmp_path):
    env = refining_env(tmp_path, working_directory="sites/lesen")
    env.adapter.plans["i1"] = {"plan": PARENT_REPORT_PLAN,
                               "plan_files": ["static/mod-%d.mjs" % n for n in range(scheduler.MAX_PLAN_FILES + 1)]}
    env.start()
    env.run_until(lambda: env.store.get_attempt("i1#1").get("outcome") == "Failed")
    assert env.store.get_attempt("i1#1")["failure_kind"] == "schema_invalid"
    assert str(scheduler.MAX_PLAN_FILES) in env.store.get_attempt("i1#1")["detail"]
    assert "implementer" not in roles(env)


def test_an_empty_path_in_the_declaration_fails_closed(tmp_path):
    env = refining_env(tmp_path, working_directory="sites/lesen")
    env.adapter.plans["i1"] = {"plan": PARENT_REPORT_PLAN, "plan_files": ["static/parent-report.mjs", "   "]}
    env.start()
    env.run_until(lambda: env.store.get_attempt("i1#1").get("outcome") == "Failed")
    assert env.store.get_attempt("i1#1")["failure_kind"] == "schema_invalid"
    assert "implementer" not in roles(env)


def test_the_supported_recovery_clears_the_prerequisite_and_the_work_resumes(tmp_path):
    """`refine the scope` is the answer that re-plans around the owner-merged file; nothing stays stuck."""
    from harness import humantasks
    env = refining_env(tmp_path, working_directory="sites/lesen")
    run_refinement(env, plan=PARENT_REPORT_PLAN, plan_files=["package.json"])
    assert env.store.get_issue("i1")["plan_prerequisites"] == ["package.json"]
    [task] = [t for t in env.store.human_tasks("i1") if t["state"] in humantasks.OPEN_STATES]
    env.adapter.plans["i1"] = {"plan": ["Work around the manifest: the adapter reads the Capacitor bridge at runtime."],
                               "plan_files": ["static/parent-report.mjs"]}
    humantasks.respond(env.store, task["task_id"], responder_ids=["owner"], source="local", now=env.clock(),
                       answers={"option": "refine the scope"})
    env.run_until(lambda: env.state("i1") == "In Progress")
    issue = env.store.get_issue("i1")
    assert "plan_prerequisites" not in issue  # a fresh plan answers the previous one
    assert roles(env).count("refiner") == 2 and "implementer" in roles(env)


# -- the shared matcher ---------------------------------------------------------------------------------------------

def test_planned_escalation_uses_the_same_matcher_as_the_diff_gate(tmp_path):
    escalation = plans.DEFAULT_POLICY["escalation_paths"]
    declared = ["static/platform.mjs", "package.json", "tests/parent-report.test.mjs", "../etc/passwd", "", "libs/native.so"]
    assert broker.planned_escalation(declared, escalation, "sites/lesen") == ["libs/native.so", "package.json"]
    assert broker.planned_escalation(["static/platform.mjs"], escalation, "sites/lesen") == []
    # A path only protected once the working directory is applied is still caught.
    assert broker.planned_escalation(["android/app/build.gradle"], escalation, "sites/lesen") == ["android/app/build.gradle"]
    assert broker.planned_escalation([], escalation, "sites/lesen") == []
