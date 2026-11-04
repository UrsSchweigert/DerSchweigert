import json
import os
import sqlite3

import pytest

from harness import approval, cli, machines, plans, schemas
from harness.store import Store

FIX = os.path.join(os.path.dirname(__file__), "..", "fixtures")
REQ = os.path.join(FIX, "requirements.md")
PHASES = os.path.join(FIX, "phases.json")
TIER_A = {"tier": "A", "reason": "test double: pretend isolation is verified"}


@pytest.fixture
def store(tmp_path):
    s = Store(str(tmp_path / "home"))
    yield s
    s.close()


def proposed(store, fixture=True):
    result = cli.plan_command(store, REQ, PHASES, plan_id="fx", fixture=fixture)
    assert result["state"] == "Proposed", result
    return result


def yes(plan, digest):
    return True


def test_requirements_are_extracted_by_id():
    ids = [r["id"] for r in plans.parse_requirements(REQ)]
    assert ids == ["F1.1", "F1.2", "F2.1"]


def test_real_requirements_parse_when_present():
    path = os.path.join(os.path.dirname(__file__), "..", "..", "..", "uploads", "20261026_improvements")
    if not os.path.exists(path):
        pytest.skip("requirements file not present")
    ids = [r["id"] for r in plans.parse_requirements(path)]
    assert ids[:4] == ["1.1", "1.2", "1.3", "1.4"] and "3.3" in ids and "2.2.3" in ids


def test_plan_without_phases_stays_draft(store):
    result = cli.plan_command(store, REQ, None, plan_id="nophases", fixture=True)
    assert result["state"] == "Draft" and result["problems"]
    assert store.state("plan", "nophases@v1") == "Draft"


def test_plan_dry_run_writes_nothing(store):
    result = cli.plan_command(store, REQ, PHASES, plan_id="fx", fixture=True, dry_run=True)
    assert result["state"] == "Proposed"
    assert store.list_plans() == []


def test_unapproved_execution_is_rejected(store):
    proposed(store)
    with pytest.raises(approval.AuthorizationError, match="no approval record"):
        approval.verify_approval(store, "fx", 1)
    with pytest.raises(approval.AuthorizationError):
        approval.authorize_run(store, "fx", 1, isolation_override=TIER_A)


def test_approve_then_run_check(store):
    proposed(store)
    record = approval.approve(store, "fx", None, "owner", yes)
    schemas.validate(record, schemas.APPROVAL_RECORD)
    assert store.state("plan", "fx@v1") == "Approved"
    assert approval.authorize_run(store, "fx", 1, isolation_override=TIER_A)["digest"] == record["digest"]


def test_cli_approval_gate_requires_preflight_bound_to_the_plan(store):
    proposed(store)
    with pytest.raises(approval.AuthorizationError, match="not been preflighted"):
        approval.approve(store, "fx", None, "owner", yes, require_preflight=True)
    stored = store.get_plan("fx")
    store.put_doc("check_preflight", "fx@v1", {"digest": stored["digest"], "head": "a" * 40, "results": []})
    record = approval.approve(store, "fx", None, "owner", yes, require_preflight=True)
    assert record["digest"] == stored["digest"]


def test_run_refused_in_tier_b(store):
    proposed(store)
    approval.approve(store, "fx", None, "owner", yes)
    with pytest.raises(approval.AuthorizationError, match="Tier B"):
        approval.authorize_run(store, "fx", 1)


def test_non_fixture_plan_cannot_be_approved_in_tier_b(store):
    proposed(store, fixture=False)
    with pytest.raises(approval.AuthorizationError, match="Tier B"):
        approval.approve(store, "fx", None, "owner", yes)


def test_declined_approval_changes_nothing(store):
    proposed(store)
    with pytest.raises(approval.AuthorizationError, match="declined"):
        approval.approve(store, "fx", None, "owner", lambda p, d: False)
    assert store.state("plan", "fx@v1") == "Proposed"
    assert store.get_approval("fx", 1) is None


def test_terminal_confirm_refuses_without_tty(store, monkeypatch):
    proposed(store)
    with pytest.raises(approval.AuthorizationError, match="declined"):
        approval.approve(store, "fx", None, "owner", cli.terminal_confirm)


def forge(store, **changes):
    record = store.get_approval("fx", 1)
    record.update(changes)
    store.cx.execute("UPDATE approvals SET record=? WHERE plan_id='fx'", (json.dumps(record),))


def test_forged_approval_rejected(store):
    proposed(store)
    store.put_approval({
        "plan_id": "fx", "version": 1, "digest": store.get_plan("fx")["digest"], "approver": "agent",
        "approved_at": "2026-10-26T00:00:00+00:00", "authorized_operations": ["pushes"], "signature": "0" * 64,
    })
    with pytest.raises(approval.AuthorizationError, match="signature"):
        approval.verify_approval(store, "fx", 1)


def test_tampered_approval_fields_rejected(store):
    proposed(store)
    approval.approve(store, "fx", None, "owner", yes)
    forge(store, authorized_operations=["eligible_merges", "pushes"])
    with pytest.raises(approval.AuthorizationError, match="signature"):
        approval.verify_approval(store, "fx", 1)


def test_changed_policy_digest_rejected(store):
    proposed(store)
    approval.approve(store, "fx", None, "owner", yes)
    stored = store.get_plan("fx")["plan"]
    stored["policy"]["merge_policy"] = "always-merge"
    store.cx.execute("UPDATE plans SET content=? WHERE plan_id='fx'", (json.dumps(stored),))
    with pytest.raises(approval.AuthorizationError, match="changed since approval"):
        approval.verify_approval(store, "fx", 1)


def test_changed_scope_supersedes_and_reports_delta(store):
    proposed(store)
    approval.approve(store, "fx", None, "owner", yes)
    with open(PHASES) as fh:
        data = json.load(fh)
    data["phases"][1]["path_allowlist"].append("tools/harness/")
    alt = os.path.join(os.path.dirname(store.home), "phases2.json")
    with open(alt, "w") as fh:
        json.dump(data, fh)
    result = cli.plan_command(store, REQ, alt, plan_id="fx", fixture=True)
    assert result["version"] == 2 and result["changed_phases"] == ["P2"]
    assert store.state("plan", "fx@v1") == "Superseded"
    assert store.state("plan", "fx@v2") == "Proposed"
    with pytest.raises(approval.AuthorizationError):
        approval.verify_approval(store, "fx", 2)


def test_unchanged_plan_creates_no_new_version(store):
    proposed(store)
    again = cli.plan_command(store, REQ, PHASES, plan_id="fx", fixture=True)
    assert again.get("unchanged") and again["version"] == 1


def test_policy_cannot_authorize_deployment(store):
    plan = plans.build_plan("p", 1, plans.parse_requirements(REQ), json.load(open(PHASES))["phases"], fixture=True)
    plan["policy"]["authorized_operations"].append("production_deploy")
    assert any("cannot grant" in p for p in plans.validate_plan(plan))


def test_plan_problems_detected():
    phases = json.load(open(PHASES))["phases"]
    phases[0]["dependencies"] = ["P2"]
    plan = plans.build_plan("p", 1, plans.parse_requirements(REQ), phases, fixture=True)
    assert "phase dependencies contain a cycle" in plans.validate_plan(plan)
    phases = json.load(open(PHASES))["phases"][:1]
    plan = plans.build_plan("p", 1, plans.parse_requirements(REQ), phases, fixture=True)
    assert "requirement F2.1 is not covered by any phase" in plans.validate_plan(plan)


def test_a_run_accumulates_on_its_own_protected_branch_by_default():
    phases = json.load(open(PHASES))["phases"]
    plan = plans.build_plan("2026103001bugfixes-md-d5ea72f7", 1, plans.parse_requirements(REQ), phases, fixture=True)

    assert plans.base_branch(plan) == "main"
    assert plans.run_branch(plan) == "harness/run/2026103001bugfixes-md-d5ea72f7"
    assert plans.validate_plan(plan) == []


def test_a_plan_can_work_directly_on_its_base_branch():
    phases = json.load(open(PHASES))["phases"]
    plan = plans.build_plan("p", 1, plans.parse_requirements(REQ), phases, fixture=True,
                            policy=dict(plans.DEFAULT_POLICY, run_branch="", base_branch="develop"))

    assert plans.run_branch(plan) == "" and plans.base_branch(plan) == "develop"
    assert plans.validate_plan(plan) == []


@pytest.mark.parametrize("branch", ["harness/run/../main", "harness run/x", "harness/run/x.lock", "/harness/run/x"])
def test_an_unsafe_run_branch_is_refused(branch):
    phases = json.load(open(PHASES))["phases"]
    plan = plans.build_plan("p", 1, plans.parse_requirements(REQ), phases, fixture=True,
                            policy=dict(plans.DEFAULT_POLICY, run_branch=branch))

    assert any("policy.run_branch" in p for p in plans.validate_plan(plan))


def test_the_run_branch_may_not_be_the_base_branch():
    phases = json.load(open(PHASES))["phases"]
    plan = plans.build_plan("p", 1, plans.parse_requirements(REQ), phases, fixture=True,
                            policy=dict(plans.DEFAULT_POLICY, base_branch="main", run_branch="main"))

    assert "policy.run_branch must differ from policy.base_branch" in plans.validate_plan(plan)


@pytest.mark.parametrize("machine,current,new", [
    ("plan", "Draft", "Approved"),
    ("plan", "Proposed", "Executing"),
    ("plan", "Completed", "Executing"),
    ("phase", "Planned", "Done"),
    ("issue", "Ready", "Done"),
    ("issue", "Done", "Ready"),
    ("human_task", "Submitted", "Resolved"),
    ("attempt", "Succeeded", "Running"),
])
def test_illegal_transitions_raise(machine, current, new):
    with pytest.raises(machines.IllegalTransition):
        machines.check_transition(machine, current, new)


def test_store_rejects_illegal_transition_and_keeps_state(store):
    store.transition("issue", "i1", "Refining", "coordinator")
    with pytest.raises(machines.IllegalTransition):
        store.transition("issue", "i1", "Done", "agent")
    assert store.state("issue", "i1") == "Refining"


def test_terminal_states_never_transition(store):
    store.transition("plan", "p@v1", "Cancelled", "owner")
    for new in machines.MACHINES["plan"]:
        with pytest.raises(machines.IllegalTransition):
            store.transition("plan", "p@v1", new, "owner")


def test_transitions_are_idempotent_and_journaled(store):
    assert store.transition("issue", "i2", "Refining", "c", {"why": "x"}, key="k1") is True
    assert store.transition("issue", "i2", "Refining", "c", {"why": "x"}, key="k1") is False
    rows = [r for r in store.journal(50) if r["entity"] == "i2"]
    assert [r["to_state"] for r in rows] == ["Inbox", "Refining"]
    assert json.loads(rows[-1]["evidence"]) == {"why": "x"}


def test_blocked_remembers_previous_state(store):
    for s in ("Refining", "Ready", "Blocked"):
        store.transition("issue", "i3", s, "c")
    assert store.previous_state("issue", "i3") == "Ready"


def test_schemas_reject_unknown_and_malformed():
    good = {"attempt_id": "a#1", "epoch": 1, "action": "comment", "target": "issue/1", "payload": {}}
    schemas.validate(good, schemas.ACTION_PROPOSAL)
    with pytest.raises(schemas.SchemaError):
        schemas.validate(dict(good, action="merge_everything"), schemas.ACTION_PROPOSAL)
    with pytest.raises(schemas.SchemaError):
        schemas.validate(dict(good, extra=1), schemas.ACTION_PROPOSAL)
    with pytest.raises(schemas.SchemaError):
        schemas.validate(dict(good, epoch=True), schemas.ACTION_PROPOSAL)
    result = {"attempt_id": "a#1", "epoch": 1, "outcome": "ok", "changed_files": [], "revision": "abc",
              "checks": [{"command": "pytest", "exit_code": 0}], "risks": [], "blockers": [], "next_action": "review"}
    schemas.validate(result, schemas.WORKER_RESULT)
    with pytest.raises(schemas.SchemaError):
        schemas.validate(dict(result, checks=[{"command": "pytest"}]), schemas.WORKER_RESULT)


def test_status_reports_without_mutation(store):
    proposed(store)
    approval.approve(store, "fx", None, "owner", yes)
    before = store.journal(100)
    report = cli.status_report(store.home)
    assert report["plans"][0]["approval"] == "valid" and report["run_permitted"] is False
    assert Store(store.home).journal(100) == before


def test_status_flags_invalid_approval(store):
    proposed(store)
    approval.approve(store, "fx", None, "owner", yes)
    forge(store, approver="mallory")
    assert cli.status_report(store.home)["plans"][0]["approval"].startswith("INVALID")


def test_status_without_store(tmp_path):
    assert cli.status_report(str(tmp_path / "none"))["note"] == "store not initialized"


def test_cli_dry_run_plan_and_status_json(tmp_path, capsys):
    home = str(tmp_path / "h")
    assert cli.main(["--home", home, "plan", "--requirements", REQ, "--phases", PHASES, "--fixture", "--dry-run"]) == 0
    assert json.loads(capsys.readouterr().out)["state"] == "Proposed"
    assert not os.path.exists(os.path.join(home, "harness.sqlite"))
    assert cli.main(["--home", home, "status", "--json"]) == 0
    assert json.loads(capsys.readouterr().out)["note"] == "store not initialized"


def test_cli_approve_refuses_without_terminal(tmp_path, capsys, monkeypatch):
    home = str(tmp_path / "h")
    def preflight_plan(store, plan_id, version, repo_root, issue_docs=None):
        stored = store.get_plan(plan_id, version)
        record = {"digest": stored["digest"], "head": "a" * 40, "results": []}
        store.put_doc("check_preflight", approval.plan_entity(plan_id, stored["plan"]["version"]), record)
        return record

    monkeypatch.setattr(cli, "preflight_plan", preflight_plan)
    cli.main(["--home", home, "plan", "--requirements", REQ, "--phases", PHASES, "--fixture", "--plan-id", "fx"])
    capsys.readouterr()
    assert cli.main(["--home", home, "approve", "fx"]) == 2
    assert Store(home).get_approval("fx", 1) is None


def test_split_pressure_limits_are_validated_in_the_policy():
    phases = json.load(open(PHASES))["phases"]
    problems = plans.validate_plan(plans.build_plan(
        "p", 1, plans.parse_requirements(REQ), phases, fixture=True,
        policy=dict(plans.DEFAULT_POLICY, split_pressure={"enabled": True, "max_file": 3})))
    assert any("unknown keys" in p and "max_file" in p for p in problems)

    problems = plans.validate_plan(plans.build_plan(
        "p", 1, plans.parse_requirements(REQ), phases, fixture=True,
        policy=dict(plans.DEFAULT_POLICY, split_pressure={"enabled": True, "max_files": -1})))
    assert any("whole number" in p for p in problems)


def test_plan_can_land_its_work_on_a_branch_other_than_main(store):
    result = cli.plan_command(store, REQ, PHASES, plan_id="fx", fixture=True,
                              base_branch="feat/mobile-scaffold")
    assert result["state"] == "Proposed", result
    plan = store.get_plan("fx")["plan"]
    assert plans.base_branch(plan) == "feat/mobile-scaffold"
    assert plans.run_branch(plan) != plans.base_branch(plan)


def test_base_branch_is_part_of_the_approval_digest(store):
    main = cli.plan_command(store, REQ, PHASES, plan_id="fx", fixture=True, dry_run=True)
    other = cli.plan_command(store, REQ, PHASES, plan_id="fx", fixture=True, dry_run=True,
                             base_branch="feat/mobile-scaffold")
    assert main["digest"] != other["digest"]


def test_a_base_branch_equal_to_the_run_branch_is_rejected(store):
    result = cli.plan_command(store, REQ, PHASES, plan_id="fx", fixture=True,
                              base_branch=plans.run_branch({"plan_id": "fx", "policy": plans.DEFAULT_POLICY}))
    assert result["state"] == "Draft"
    assert any("run_branch" in problem for problem in result["problems"])
