import os

import pytest

from harness import approval, broker, cli, workrecord
from harness.broker import Broker, BrokerRejected
from harness.store import Store
from harness_fakes import FakeGitHub

FIX = os.path.join(os.path.dirname(__file__), "..", "fixtures")
REQ = os.path.join(FIX, "requirements.md")
PHASES = os.path.join(FIX, "phases.json")
TIER_A = {"tier": "A", "reason": "test double: pretend isolation is verified"}
OWNER = ["UrsSchweigert"]


@pytest.fixture
def env(tmp_path):
    store = Store(str(tmp_path / "home"))
    cli.plan_command(store, REQ, PHASES, plan_id="fx", fixture=True)
    approval.approve(store, "fx", None, "owner", lambda p, d: True)
    gh = FakeGitHub()
    workrecord.sync_plan(gh, store, "fx", None, OWNER, dry_run=False, isolation=TIER_A, sleep=lambda s: None)
    lease = store.claim("impl-1", "runner", now=0)
    store.start(lease.attempt_id, lease.epoch, now=1)
    b = Broker(store, gh, "fx", 1, OWNER, isolation=TIER_A, sleep=lambda s: None)
    yield store, gh, b, lease
    store.close()


def proposal(lease, action, payload, epoch=None):
    return {"attempt_id": lease.attempt_id, "epoch": lease.epoch if epoch is None else epoch, "action": action, "target": "x", "payload": payload}


CREATE = {"key": "k1", "title": "Do F1.1", "content": "work", "phase_id": "P1", "requirement_ids": ["F1.1"]}


# -- Broker isolation ---------------------------------------------------------

def test_scrub_env_removes_credentials():
    env = {"PATH": "/bin", "GH_TOKEN": "x", "GITHUB_TOKEN": "x", "AWS_SECRET_ACCESS_KEY": "x", "MY_API_KEY": "x",
           "HARNESS_HOME": "/s", "SSH_AUTH_SOCK": "/a", "HOME": "/h", "BLENDERMCP_KEY": "x"}
    assert broker.scrub_env(env) == {"PATH": "/bin", "HOME": "/h"}


def test_broker_exposes_no_client_to_callers(env):
    _, _, b, _ = env
    assert not any(hasattr(b, n) for n in ("client", "token", "gh", "credentials"))


def test_task_packet_must_not_carry_secrets_or_store_paths(tmp_path):
    packet = {"issue_id": "i", "phase_id": "P1", "requirement_ids": ["F1.1"], "role": "implementer", "tier": "standard",
              "outcomes": ["o"], "acceptance_criteria": ["a"], "non_goals": [], "code_anchors": ["a.py"], "dependencies": [],
              "validation_commands": ["pytest"], "path_allowlist": ["src/"], "untrusted_data": "text"}
    home, wt = str(tmp_path / "home"), str(tmp_path / "wt")
    os.makedirs(home), os.makedirs(wt)
    out = broker.prepare_task_packet(packet, home, wt)
    assert out["untrusted_data"].startswith("```untrusted-worker-output")
    with pytest.raises(BrokerRejected, match="credential"):
        broker.prepare_task_packet(dict(packet, untrusted_data="token ghp_" + "a" * 30), home, wt)
    with pytest.raises(BrokerRejected, match="store location"):
        broker.prepare_task_packet(dict(packet, code_anchors=[os.path.realpath(home)]), home, wt)
    with pytest.raises(BrokerRejected, match="overlap"):
        broker.prepare_task_packet(packet, home, home)
    with pytest.raises(BrokerRejected, match="overlap"):
        broker.assert_store_unreachable(str(tmp_path), home)


def test_worker_diff_cannot_touch_protected_paths():
    res = broker.check_changed_paths(
        ["tools/harness/store.py", "docs/harness/spec.md", ".github/workflows/x.yml", "../etc/passwd", "src/a.py", "other/b.py", "src/package.json"],
        allowlist=["src/", "tools/harness/", ".github/"], escalation=["src/package.json"])
    assert set(res["rejected"]) == {"tools/harness/store.py", "docs/harness/spec.md", ".github/workflows/x.yml", "../etc/passwd"}
    assert res["out_of_scope"] == ["other/b.py"] and res["escalate"] == ["src/package.json"]


def test_stale_lease_is_rejected(env):
    store, _, b, lease = env
    store.claim("impl-1", "other", now=500)
    with pytest.raises(BrokerRejected, match="stale lease"):
        b.execute(proposal(lease, "create_issue", CREATE), now=501)


def test_wrong_epoch_is_rejected(env):
    _, _, b, lease = env
    with pytest.raises(BrokerRejected, match="stale lease"):
        b.execute(proposal(lease, "create_issue", CREATE, epoch=99), now=2)


def test_tier_b_refuses_writes_but_allows_dry_run(env):
    store, gh, _, lease = env
    b = Broker(store, gh, "fx", 1, OWNER, sleep=lambda s: None)
    before = gh.mutations
    with pytest.raises(BrokerRejected, match="Tier B"):
        b.execute(proposal(lease, "create_issue", CREATE), now=2)
    assert b.execute(proposal(lease, "create_issue", CREATE), now=2, dry_run=True)["action"] == "create"
    assert gh.mutations == before


def test_tampered_policy_blocks_every_write(env):
    store, gh, b, lease = env
    import json
    plan = store.get_plan("fx")["plan"]
    plan["policy"]["merge_policy"] = "anything"
    store.cx.execute("UPDATE plans SET content=?", (json.dumps(plan),))
    with pytest.raises(BrokerRejected, match="approval check failed"):
        b.execute(proposal(lease, "create_issue", CREATE), now=2)


def test_unimplemented_actions_fail_closed(env):
    _, _, b, lease = env
    for action in ("push_branch", "open_pr", "merge_pr"):
        with pytest.raises(BrokerRejected, match="failing closed"):
            b.execute(proposal(lease, action, {}), now=2)


def test_unauthorized_operation_is_rejected(env, tmp_path):
    store, gh, _, _ = env
    import json
    from harness import plans
    s2 = Store(str(tmp_path / "h2"))
    data = json.load(open(PHASES))["phases"]
    pol = json.loads(json.dumps(plans.DEFAULT_POLICY))
    pol["authorized_operations"] = ["issue_project_updates"]
    plan = plans.build_plan("fx", 1, plans.parse_requirements(REQ), data, pol, fixture=True)
    s2.put_plan(plan, plans.plan_digest(plan))
    s2.transition("plan", "fx@v1", "Proposed", "t")
    approval.approve(s2, "fx", None, "owner", lambda p, d: True)
    lease = s2.claim("i", "r", now=0)
    b = Broker(s2, gh, "fx", 1, OWNER, isolation=TIER_A)
    with pytest.raises(BrokerRejected, match="not authorized"):
        b.execute(proposal(lease, "merge_pr", {}), now=1)


def test_create_issue_is_scoped_to_the_approved_plan(env):
    _, gh, b, lease = env
    res = b.execute(proposal(lease, "create_issue", CREATE), now=2)
    assert res["action"] == "create" and gh.issues[res["number"]]["title"] == "Do F1.1"
    again = b.execute(proposal(lease, "create_issue", CREATE), now=3)
    assert again["number"] == res["number"] and again["action"] == "noop"
    with pytest.raises(BrokerRejected, match="requirement IDs"):
        b.execute(proposal(lease, "create_issue", dict(CREATE, key="k2", requirement_ids=["F2.1"])), now=2)
    with pytest.raises(BrokerRejected, match="unknown phase"):
        b.execute(proposal(lease, "create_issue", dict(CREATE, key="k3", phase_id="P9")), now=2)
    with pytest.raises(BrokerRejected, match="invalid payload"):
        b.execute(proposal(lease, "create_issue", {"title": "x"}), now=2)


def test_update_and_comment_only_touch_managed_issues(env):
    _, gh, b, lease = env
    n = b.execute(proposal(lease, "create_issue", CREATE), now=2)["number"]
    upd = dict(key="k1", number=n, content="more", phase_id="P1", requirement_ids=["F1.1"])
    assert b.execute(proposal(lease, "update_issue", upd), now=3)["action"] == "update"
    assert "more" in gh.issues[n]["body"]
    with pytest.raises(BrokerRejected, match="not a harness implementation issue"):
        b.execute(proposal(lease, "update_issue", dict(upd, number=1)), now=3)
    with pytest.raises(BrokerRejected, match="not a harness-managed"):
        b.execute(proposal(lease, "comment", {"key": "c", "number": 999, "body": "hi"}), now=3)
    assert b.execute(proposal(lease, "comment", {"key": "c", "number": n, "body": "hi"}), now=3)["action"] == "comment"
    assert b.execute(proposal(lease, "comment", {"key": "c", "number": n, "body": "hi"}), now=3)["action"] == "noop"
    assert len(gh.comments) == 1


def test_human_task_blocks_a_managed_issue(env):
    _, gh, b, lease = env
    res = b.execute(proposal(lease, "request_human_task", {"key": "h", "title": "Decide", "content": "q", "blocks": 2}), now=2)
    assert "Blocks #2" in gh.issues[res["number"]]["body"] and "human-task" in gh.issues[res["number"]]["labels"]
    with pytest.raises(BrokerRejected, match="harness-managed"):
        b.execute(proposal(lease, "request_human_task", {"key": "h2", "title": "x", "content": "q", "blocks": 500}), now=2)


def test_credential_like_payload_is_rejected(env):
    _, _, b, lease = env
    with pytest.raises(BrokerRejected, match="credential"):
        b.execute(proposal(lease, "comment", {"key": "c", "number": 2, "body": "ghp_" + "b" * 30}), now=2)


def test_branch_protection_by_convention():
    assert broker.check_branch_target("harness/12-flop-mode") == "harness/12-flop-mode"
    assert broker.check_branch_target("refs/heads/harness/12/x") == "harness/12/x"
    for bad in ("main", "master", "refs/heads/main", "feature/x", "harness/", "harness/../main", "harness/a.lock", "harness"):
        with pytest.raises(BrokerRejected, match="limited to harness"):
            broker.check_branch_target(bad)
    with pytest.raises(BrokerRejected, match="force"):
        broker.check_branch_target("harness/12-x", force=True)


def test_status_reports_branch_protection_limitation(tmp_path):
    report = cli.status_report(str(tmp_path / "none"))
    assert any("branch protection" in t for t in report["limitations"])
