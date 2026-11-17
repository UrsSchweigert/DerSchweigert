"""A second round of review findings goes to the overseer before a third repair is paid for."""
import json

from harness_doubles import Env

OVERSEER_ON = {"overseer": {"enabled": True, "rounds_per_issue": 2}}


def packet_data(request):
    return json.loads(request.packet["untrusted_data"].split("\n", 1)[1].rsplit("\n", 1)[0])


def roles(env):
    return [r.role for r in env.adapter.started]


def loop_events(env):
    rows = env.store.cx.execute("SELECT data FROM events WHERE type='review_loop' ORDER BY ts").fetchall()
    return [json.loads(r["data"]) for r in rows]


def loop_env(tmp_path, verdicts, overseer=None, enabled=True, **kw):
    env = Env(tmp_path, budgets={"repair_attempts": 4}, policy_overrides=OVERSEER_ON if enabled else {}, **kw)
    env.adapter.verdicts["i1"] = list(verdicts)
    env.adapter.overseer = overseer
    issue = env.store.get_issue("i1")
    issue["acceptance_criteria"] = ["No hair part thinner than twice a radius remains.", "It never opens a hole inside the figure."]
    env.store.put_issue(issue)
    return env


def test_the_second_round_of_findings_is_reported_to_the_overseer_before_another_repair(tmp_path):
    env = loop_env(tmp_path, ["changes_requested", "changes_requested", "approve"],
                   overseer={"action": "retry", "cause": "process", "reason": "Each round fixed what the last one found.",
                             "guidance": "Only the profile shape is left: read the hero from user.hero."})
    env.start()
    env.run_until(lambda: env.state("i1") == "Done")
    order = roles(env)
    assert order.count("overseer") == 1 and order.count("implementer") == 3
    first_overseer = order.index("overseer")
    assert order[:first_overseer].count("reviewer") == 2 and order[first_overseer + 1] == "implementer", \
        "the overseer sits between the second review and the third repair: %s" % order
    assert [e["rounds"] for e in loop_events(env)] == [2]
    assert env.store.get_issue("i1")["overseer_rounds"] == 1


def test_the_overseer_gets_the_rounds_and_the_criteria_to_compare_and_its_hint_reaches_the_repair(tmp_path):
    env = loop_env(tmp_path, ["changes_requested", "changes_requested", "approve"],
                   overseer={"action": "retry", "cause": "process", "reason": "converging", "guidance": "Use user.hero."})
    env.start()
    env.run_until(lambda: env.state("i1") == "Done")
    overseer = next(r for r in env.adapter.started if r.role == "overseer")
    data = packet_data(overseer)
    assert [r["round"] for r in data["review_rounds"]] == [1, 2] and all(r["findings"] for r in data["review_rounds"])
    assert data["acceptance_criteria"], "the overseer reads the findings next to the criteria they are about"
    repair = [r for r in env.adapter.started if r.role == "implementer"][-1]
    assert "Use user.hero." in json.dumps(packet_data(repair))


def test_a_loop_the_overseer_calls_a_conflict_goes_to_the_owner_with_its_diagnosis(tmp_path):
    env = loop_env(tmp_path, ["changes_requested", "changes_requested", "approve"],
                   overseer={"action": "escalate", "cause": "content",
                             "reason": "AC 'no hair part thinner than 2r remains' conflicts with 'never opens a hole': the mask includes the face."})
    env.start()
    env.run_until(lambda: env.state("i1") == "Blocked")
    issue = env.store.get_issue("i1")
    assert roles(env).count("implementer") == 2, "no third repair was paid for"
    assert issue["overseer_finding"]["cause"] == "content" and "conflicts" in issue["overseer_finding"]["reason"]
    task = next(t for t in env.store.human_tasks("i1") if t["payload"]["kind"] == "decision")
    assert "overseer: escalate" in task["payload"]["why"] or "content" in task["payload"]["why"]


def test_one_round_of_findings_does_not_consult_the_overseer(tmp_path):
    env = loop_env(tmp_path, ["changes_requested", "approve"])
    env.start()
    env.run_until(lambda: env.state("i1") == "Done")
    assert "overseer" not in roles(env) and not loop_events(env)


def test_with_the_overseer_off_the_repairs_go_on_as_before(tmp_path):
    env = loop_env(tmp_path, ["changes_requested", "changes_requested", "approve"], enabled=False)
    env.start()
    env.run_until(lambda: env.state("i1") == "Done")
    assert "overseer" not in roles(env) and roles(env).count("implementer") == 3
    assert [e["rounds"] for e in loop_events(env)] == [2], "the loop is still noticed and reported"


def test_the_overseer_is_asked_once_per_issue_not_after_every_later_round(tmp_path):
    env = loop_env(tmp_path, ["changes_requested", "changes_requested", "changes_requested", "approve"],
                   overseer={"action": "retry", "cause": "process", "reason": "converging", "guidance": "keep going"})
    env.start()
    env.run_until(lambda: env.state("i1") == "Done")
    assert roles(env).count("overseer") == 1 and [e["rounds"] for e in loop_events(env)] == [2]


def test_the_findings_the_overseer_reads_keep_their_numbers(tmp_path):
    env = loop_env(tmp_path, ["changes_requested", "changes_requested", "approve"],
                   overseer={"action": "retry", "cause": "process", "reason": "r", "guidance": "g"})
    env.adapter.risks = ["BLOCKING: clears 677 of the 1220 golden-mask pixels. " + "x" * 700 + " END-OF-FINDING"]
    env.start()
    env.run_until(lambda: env.state("i1") == "Done")
    findings = packet_data(next(r for r in env.adapter.started if r.role == "overseer"))["review_rounds"][0]["findings"]
    assert "677 of the 1220" in findings and findings.endswith("END-OF-FINDING"), "findings were cut at 400 characters before"
