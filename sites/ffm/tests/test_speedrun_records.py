"""Central speedrun records: the finished-run report and its ranking.

The server cannot replay a run, so these tests pin the shape it insists on
(sixty distinct levels, plausible splits, a total that matches them) and the
way a run improves the player's records rather than replacing them wholesale.
"""
import pytest

# test_app sets the environment the app factory insists on; importing it first
# keeps this module runnable on its own.
from sites.ffm.tests.test_app import (  # noqa: F401 - fixtures
    aws_mock, app, client, register_and_login,
)


def full_run(level_ms=5000, total_offset=0):
    """A complete 60-level report: one split per level, all equal."""
    splits = [{"level": level, "ms": level_ms} for level in range(1, 61)]
    return {"total_ms": level_ms * 60 + total_offset, "splits": splits}


def test_a_finished_run_is_stored_and_returns_the_personal_best(client):
    auth = register_and_login(client, "runner", "runner@example.com", "password123")

    response = client.post('/api/speedrun/run', json=full_run(), headers=auth)
    assert response.status_code == 200
    body = response.get_json()
    assert body["saved"] is True
    assert body["central_best_ms"] == 300_000

    records = client.get('/api/speedrun/records', headers=auth).get_json()
    assert records["best_run"]["total_ms"] == 300_000
    assert len(records["levels"]) == 60
    assert records["levels"][0] == {
        "level": 1, "ms": 5000, "achieved_at": records["levels"][0]["achieved_at"],
    }


def test_a_slower_run_keeps_the_existing_best_but_improves_single_levels(client):
    auth = register_and_login(client, "runner", "runner@example.com", "password123")
    client.post('/api/speedrun/run', json=full_run(level_ms=4000), headers=auth)

    # Slower overall, but level 7 was faster this time.
    slower = full_run(level_ms=5000)
    slower["splits"][6] = {"level": 7, "ms": 900}
    slower["total_ms"] = 59 * 5000 + 900
    response = client.post('/api/speedrun/run', json=slower, headers=auth)
    assert response.status_code == 200
    assert response.get_json()["saved"] is False

    records = client.get('/api/speedrun/records', headers=auth).get_json()
    assert records["best_run"]["total_ms"] == 240_000, "the faster run stays the record"
    by_level = {entry["level"]: entry["ms"] for entry in records["levels"]}
    assert by_level[7] == 900, "a single fast level is kept"
    assert by_level[8] == 4000, "and the levels that were slower keep their best"


@pytest.mark.parametrize("mutate", [
    pytest.param(lambda run: run.pop("splits"), id="no-splits"),
    pytest.param(lambda run: run.update(splits=[]), id="too-few-splits"),
    pytest.param(lambda run: run["splits"].pop(), id="fifty-nine-splits"),
    pytest.param(lambda run: run["splits"].__setitem__(1, {"level": 1, "ms": 5000}), id="duplicate-level"),
    pytest.param(lambda run: run["splits"].__setitem__(0, {"level": 0, "ms": 5000}), id="level-zero"),
    pytest.param(lambda run: run["splits"].__setitem__(0, {"level": 1, "ms": 10}), id="impossibly-fast-level"),
    pytest.param(lambda run: run["splits"].__setitem__(0, {"level": 1, "ms": 10**9}), id="impossibly-slow-level"),
    pytest.param(lambda run: run["splits"].__setitem__(0, {"level": 1, "ms": "5000"}), id="string-time"),
    pytest.param(lambda run: run["splits"].__setitem__(0, {"level": True, "ms": 5000}), id="boolean-level"),
    pytest.param(lambda run: run.update(total_ms=10), id="total-shorter-than-splits"),
    pytest.param(lambda run: run.update(total_ms=300_000 + 5_000), id="total-longer-than-splits"),
    pytest.param(lambda run: run.update(total_ms="300000"), id="string-total"),
    pytest.param(lambda run: run.update(splits="all of them"), id="splits-not-a-list"),
])
def test_a_report_that_could_not_be_a_run_is_refused(client, mutate):
    auth = register_and_login(client, "runner", "runner@example.com", "password123")
    run = full_run()
    mutate(run)
    response = client.post('/api/speedrun/run', json=run, headers=auth)
    assert response.status_code == 400
    assert client.get('/api/speedrun/records', headers=auth).get_json()["best_run"] is None


def test_rounded_splits_may_miss_the_total_by_a_hair(client):
    """The client sums 60 rounded splits, so a few milliseconds of drift is
    normal; it must be recorded, not rejected."""
    auth = register_and_login(client, "runner", "runner@example.com", "password123")
    run = full_run()
    run["total_ms"] += 60
    assert client.post('/api/speedrun/run', json=run, headers=auth).status_code == 200


def test_speedrun_records_need_a_login(client):
    assert client.get('/api/speedrun/records').status_code == 401
    assert client.post('/api/speedrun/run', json=full_run()).status_code == 401


def test_the_overall_leaderboard_ranks_runs_and_levels(client):
    fast = register_and_login(client, "fast", "fast@example.com", "password123")
    slow = register_and_login(client, "slow", "slow@example.com", "password123")
    client.post('/api/speedrun/run', json=full_run(level_ms=6000), headers=slow)
    quick = full_run(level_ms=3000)
    quick["splits"][9] = {"level": 10, "ms": 800}
    quick["total_ms"] = 59 * 3000 + 800
    client.post('/api/speedrun/run', json=quick, headers=fast)

    board = client.get('/api/speedrun/leaderboard').get_json()
    assert [entry["rank"] for entry in board["entries"]] == [1, 2]
    assert [entry["username"] for entry in board["entries"]] == ["fast", "slow"]
    assert board["entries"][0]["total_ms"] == 177_800

    levels = {entry["level"]: entry for entry in board["levels"]}
    assert levels[10]["ms"] == 800
    assert levels[10]["username"] == "fast"
    assert levels[11]["username"] == "fast", "the faster run wins the tied levels"
    assert len(board["levels"]) == 60


def test_the_leaderboard_is_empty_before_anyone_finishes(client):
    board = client.get('/api/speedrun/leaderboard').get_json()
    assert board == {"entries": [], "levels": []}
