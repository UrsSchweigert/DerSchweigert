import threading

import pytest

from harness.store import ClaimConflict, StaleLease, Store


@pytest.fixture
def home(tmp_path):
    return str(tmp_path / "home")


def test_duplicate_claim_across_runners_rejected(home):
    a, b = Store(home), Store(home)
    lease = a.claim("i1", "runner-a", now=100)
    with pytest.raises(ClaimConflict):
        b.claim("i1", "runner-b", now=101)
    assert lease.epoch == 1 and lease.expires_at == 190


def test_concurrent_claims_have_one_winner(home):
    Store(home).close()
    wins, losses = [], []

    def worker(n):
        s = Store(home)
        try:
            wins.append(s.claim("race", "runner-%d" % n, now=10).epoch)
        except ClaimConflict:
            losses.append(n)
        finally:
            s.close()

    threads = [threading.Thread(target=worker, args=(n,)) for n in range(8)]
    [t.start() for t in threads]
    [t.join() for t in threads]
    assert len(wins) == 1 and len(losses) == 7


def test_expired_lease_is_fenced_and_epoch_advances(home):
    s = Store(home)
    old = s.claim("i1", "runner-a", now=0)
    s.start(old.attempt_id, old.epoch, now=1)
    new = Store(home).claim("i1", "runner-b", now=200)
    assert new.epoch == old.epoch + 1
    assert s.state("attempt", old.attempt_id) == "Fenced"
    with pytest.raises(StaleLease):
        s.validate_lease(old.attempt_id, old.epoch, now=201)
    with pytest.raises(StaleLease):
        s.finish(old.attempt_id, old.epoch, "Succeeded", now=201)
    s.validate_lease(new.attempt_id, new.epoch, now=201)


def test_stale_epoch_rejected_even_with_valid_attempt_id(home):
    s = Store(home)
    lease = s.claim("i1", "r", now=0)
    with pytest.raises(StaleLease):
        s.validate_lease(lease.attempt_id, lease.epoch + 1, now=1)


def test_heartbeat_renews_only_live_leases(home):
    s = Store(home)
    lease = s.claim("i1", "r", now=0, lease_seconds=90)
    assert s.heartbeat(lease.attempt_id, lease.epoch, now=60) == 150
    s.validate_lease(lease.attempt_id, lease.epoch, now=140)
    with pytest.raises(StaleLease):
        s.heartbeat(lease.attempt_id, lease.epoch, now=151)


def test_lease_lapses_without_heartbeat(home):
    s = Store(home)
    lease = s.claim("i1", "r", now=0)
    with pytest.raises(StaleLease):
        s.validate_lease(lease.attempt_id, lease.epoch, now=90)


def test_finish_releases_claim_and_blocks_further_writes(home):
    s = Store(home)
    lease = s.claim("i1", "r", now=0)
    s.start(lease.attempt_id, lease.epoch, now=1)
    s.finish(lease.attempt_id, lease.epoch, "Succeeded", now=2)
    assert s.state("attempt", lease.attempt_id) == "Succeeded"
    with pytest.raises(StaleLease):
        s.validate_lease(lease.attempt_id, lease.epoch, now=3)
    assert s.claim("i1", "r2", now=3).epoch == 2


def test_crash_recovery_fences_and_requeues(home):
    s = Store(home)
    for state in ("Refining", "Ready", "In Progress"):
        s.transition("issue", "i1", state, "coordinator")
    lease = s.claim("i1", "dead-runner", now=0)
    s.start(lease.attempt_id, lease.epoch, now=1)
    # The runner process dies here. A new process recovers from the store alone.
    fresh = Store(home)
    assert fresh.recover(now=500) == [lease.attempt_id]
    assert fresh.state("attempt", lease.attempt_id) == "Fenced"
    assert fresh.state("issue", "i1") == "Ready"
    assert fresh.active_claims() == []
    assert fresh.recover(now=501) == []
    assert fresh.claim("i1", "new-runner", now=502).epoch == 2


def test_recovery_leaves_live_claims_alone(home):
    s = Store(home)
    lease = s.claim("i1", "r", now=0)
    assert s.recover(now=10) == []
    s.validate_lease(lease.attempt_id, lease.epoch, now=10)


def test_claims_for_different_issues_are_independent(home):
    s = Store(home)
    assert s.claim("a", "r", now=0).epoch == 1
    assert s.claim("b", "r", now=0).epoch == 1


def test_illegal_attempt_transitions_rejected(home):
    s = Store(home)
    lease = s.claim("i1", "r", now=0)
    s.start(lease.attempt_id, lease.epoch, now=1)
    with pytest.raises(Exception):
        s.start(lease.attempt_id, lease.epoch, now=2)
