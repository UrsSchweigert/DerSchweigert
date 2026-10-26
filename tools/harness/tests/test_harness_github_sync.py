import json
import os

import pytest

from harness import approval, cli, workrecord
from harness.github import RateLimited
from harness.store import Store
from harness_fakes import Crash, FakeGitHub

FIX = os.path.join(os.path.dirname(__file__), "..", "fixtures")
REQ = os.path.join(FIX, "requirements.md")
PHASES = os.path.join(FIX, "phases.json")
TIER_A = {"tier": "A", "reason": "test double: pretend isolation is verified"}
OWNER = ["UrsSchweigert"]


@pytest.fixture
def store(tmp_path):
    s = Store(str(tmp_path / "home"))
    cli.plan_command(s, REQ, PHASES, plan_id="fx", fixture=True)
    approval.approve(s, "fx", None, "owner", lambda p, d: True)
    yield s
    s.close()


def sync(client, store, dry_run=False, **kw):
    kw.setdefault("sleep", lambda s: None)
    return workrecord.sync_plan(client, store, "fx", None, OWNER, dry_run=dry_run, isolation=TIER_A, **kw)


def actions(report):
    return [(r.get("op"), r.get("action")) for r in report["results"] if "action" in r]


def test_first_sync_creates_the_work_record(store):
    gh = FakeGitHub()
    report = sync(gh, store)
    assert len(gh.issues) == 3 and len(gh.milestones) == 2
    assert not report["pending"]
    req = gh.issues[1]["body"]
    assert "F1.1" in req and "#2" in req and "#3" in req
    assert "Depends on**: #2" in gh.issues[3]["body"]
    assert gh.issues[2]["milestone"] == 1 and gh.issues[3]["milestone"] == 2


def test_sync_is_idempotent(store):
    gh = FakeGitHub()
    sync(gh, store)
    before = (gh.mutations, json.dumps(gh.issues, sort_keys=True))
    report = sync(gh, store)
    assert (gh.mutations, json.dumps(gh.issues, sort_keys=True)) == before
    assert all(a in ("noop",) for _, a in actions(report))


def test_dry_run_prints_writes_and_mutates_nothing(store):
    gh = FakeGitHub()
    report = sync(gh, store, dry_run=True)
    assert gh.mutations == 0 and gh.issues == {}
    assert [a for _, a in actions(report)].count("create") == 5  # 1 milestone x2 + 3 issues
    assert store.sync_ops() == []


def test_native_sub_issues_used_when_supported(store):
    gh = FakeGitHub(native_sub_issues=True)
    report = sync(gh, store)
    assert gh.sub_issues == [(1, 2), (1, 3)] and report["native_sub_issues"]


def test_explicit_links_reported_without_native_support(store):
    report = sync(FakeGitHub(), store)
    assert any("explicit links" in u for u in report["unavailable"])
    assert any("Project" in u for u in report["unavailable"])


def test_real_sync_refused_in_tier_b_and_when_unapproved(store, tmp_path):
    with pytest.raises(approval.AuthorizationError, match="Tier B"):
        workrecord.sync_plan(FakeGitHub(), store, "fx", None, OWNER, dry_run=False)
    other = Store(str(tmp_path / "other"))
    cli.plan_command(other, REQ, PHASES, plan_id="fx", fixture=True)
    with pytest.raises(approval.AuthorizationError, match="no approval record"):
        workrecord.sync_plan(FakeGitHub(), other, "fx", None, OWNER, dry_run=False, isolation=TIER_A)


def test_partial_write_is_recovered_without_duplicates(store):
    gh = FakeGitHub()
    gh.crash_after_create = 1
    with pytest.raises(Crash):
        sync(gh, store)
    assert [o["status"] for o in store.pending_sync()] == ["pending"]
    gh.crash_after_create = 0
    report = sync(gh, store)
    assert len(gh.issues) == 3
    assert not store.pending_sync() and not report["pending"]


def test_search_lag_does_not_duplicate_known_issues(store):
    gh = FakeGitHub()
    sync(gh, store)
    gh.search_blind = True
    sync(gh, store)
    assert len(gh.issues) == 3


def test_restart_reconciles_from_github_when_local_state_is_lost(store, tmp_path):
    gh = FakeGitHub()
    sync(gh, store)
    fresh = Store(str(tmp_path / "fresh"))
    cli.plan_command(fresh, REQ, PHASES, plan_id="fx", fixture=True)
    approval.approve(fresh, "fx", None, "owner", lambda p, d: True)
    report = sync(gh, fresh)
    assert len(gh.issues) == 3
    assert all(a == "noop" for _, a in actions(report))
    assert {o["remote_ref"] for o in fresh.sync_ops()} == {1, 2, 3}


def test_rate_limit_retries_honor_retry_after(store):
    gh = FakeGitHub()
    gh.rate_limits = [7, 0]
    slept = []
    sync(gh, store, sleep=slept.append)
    assert len(slept) == 2 and slept[0] >= 7
    assert len(gh.issues) == 3


def test_rate_limit_exhaustion_is_reported_as_pending(store):
    gh = FakeGitHub()
    gh.rate_limits = [0] * 50
    report = sync(gh, store)
    assert any("rate limited" in p for p in report["pending"])
    # A later run completes the work.
    gh.rate_limits = []
    assert not sync(gh, store)["pending"]
    assert len(gh.issues) == 3


def test_failed_write_stays_pending_in_status(store):
    gh = FakeGitHub()
    gh.crash_after_create = 1
    with pytest.raises(Crash):
        sync(gh, store)
    report = cli.status_report(store.home)
    assert report["pending_sync"] and report["pending_sync"][0]["status"] == "pending"


def test_changed_plan_updates_existing_issues_in_place(store, tmp_path):
    gh = FakeGitHub()
    sync(gh, store)
    data = json.load(open(PHASES))
    data["phases"][0]["outcomes"] = ["Changed outcome"]
    alt = str(tmp_path / "p2.json")
    json.dump(data, open(alt, "w"))
    cli.plan_command(store, REQ, alt, plan_id="fx", fixture=True)
    approval.approve(store, "fx", 2, "owner", lambda p, d: True)
    report = workrecord.sync_plan(gh, store, "fx", 2, OWNER, dry_run=False, isolation=TIER_A, sleep=lambda s: None)
    assert len(gh.issues) == 3
    assert "Changed outcome" in gh.issues[2]["body"]
    assert any(a == "update" for _, a in actions(report))
