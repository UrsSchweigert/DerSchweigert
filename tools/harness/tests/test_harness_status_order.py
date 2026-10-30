"""The dashboard lists work top-down: plan order, then phase order, then issue id."""

from harness import status


def _report(queue, workers=(), blockers=()):
    return {
        "plans": [{"plan_id": "p", "version": 1}, {"plan_id": "p", "version": 2}],
        "phases": [{"plan_id": "p", "version": 2, "phase": "P1"}, {"plan_id": "p", "version": 2, "phase": "P2"},
                   {"plan_id": "p", "version": 1, "phase": "P1"}],
        "queue": list(queue), "issues": list(queue), "blockers": list(blockers), "workers": list(workers),
        "failures": [], "evidence": [],
    }


def _issue(issue_id, phase):
    return {"issue_id": issue_id, "plan_id": "p", "phase": phase}


def test_rows_follow_phase_order_instead_of_the_alphabet():
    report = _report([_issue("zz-early", "P1"), _issue("aa-late", "P2")])

    status._flow_order(report)

    assert [row["issue_id"] for row in report["queue"]] == ["zz-early", "aa-late"]
    assert [row["issue_id"] for row in report["issues"]] == ["zz-early", "aa-late"]


def test_workers_blockers_and_failures_follow_the_queue_order():
    report = _report([_issue("zz-early", "P1"), _issue("aa-late", "P2")],
                     workers=[{"issue": "aa-late", "attempt_id": "a#1"}, {"issue": "zz-early", "attempt_id": "z#1"}],
                     blockers=[{"issue_id": "aa-late"}, {"issue_id": "zz-early"}])

    status._flow_order(report)

    assert [row["issue"] for row in report["workers"]] == ["zz-early", "aa-late"]
    assert [row["issue_id"] for row in report["blockers"]] == ["zz-early", "aa-late"]


def test_the_order_is_stable_across_refreshes():
    rows = [_issue("b", "P2"), _issue("a", "P1"), _issue("c", "P1"), _issue("d", "P3")]
    first = _report(list(rows))

    status._flow_order(first)
    expected = [row["issue_id"] for row in first["queue"]]
    for shuffled in ([rows[3], rows[0], rows[2], rows[1]], list(reversed(rows))):
        report = _report(shuffled)
        status._flow_order(report)
        assert [row["issue_id"] for row in report["queue"]] == expected == ["a", "c", "b", "d"]


def test_rows_of_another_plan_keep_their_own_phase_order():
    report = _report([{"issue_id": "other", "plan_id": "q", "phase": "P1"}, _issue("mine", "P2")])

    status._flow_order(report)

    assert sorted(row["issue_id"] for row in report["queue"]) == ["mine", "other"]
