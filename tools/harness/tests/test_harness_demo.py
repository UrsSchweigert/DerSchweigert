"""Stage 5 demonstration: scheduling, escalation, status, and recovery in dry-run mode on the labeled test fixture.

Uses test doubles (FakeAdapter, FakeRepo, FakeChecker, RecordingNotifier) and the real dry-run publisher. Nothing can reach GitHub.
"""
from harness import humantasks, status
from harness.scheduler import Scheduler
from harness_doubles import Env, FakeAdapter, RecordingNotifier, TIER_A

H = 3600
MODELS = ["claude-haiku-4.5", "claude-sonnet-5", "claude-opus-5", "claude-opus-4.8"]


def test_dry_run_demonstration_of_scheduling_escalation_status_and_recovery(tmp_path):
    env = Env(tmp_path, issues=[("gated", "P1", ["F1.1"]), ("steady", "P1", ["F1.2"]), ("followup", "P2", ["F2.1"])],
              budgets={"run_wall_clock_s": 10**8, "worker_timeout_s": 10**7, "inactivity_timeout_s": 10**7})
    notes = RecordingNotifier()
    env.sched.notifier, env.sched.secondary_owner = notes, "backup-owner"
    env.checker.fail_commands = {"gated-check"}
    env.store.put_issue(dict(env.store.get_issue("gated"), validation_commands=["gated-check"]))
    env.adapter.script("steady", "implementer", "busy")
    env.start()

    # 1. Scheduling: one worker at a time (none are parallel-safe). The runner then dies while "steady" runs.
    env.run_until(lambda: env.state("gated") == "Blocked" and env.sched.active_attempts() == ["steady#1"], advance=10)
    live = status.build_report(env.store.home, env.clock())
    assert live["workers"][0]["issue"] == "steady" and live["runner"]["status"] == "alive"
    assert [b["issue_id"] for b in live["blockers"]] == ["gated"] and live["blockers"][0]["owned"]
    assert env.store.get_human_task("decision-gated-1")["state"] == "Requested"
    assert notes.subjects("decision-gated-1") == [("owner", "action needed")]

    # 2. Recovery: a new runner process takes over from stored state. The dead runner's lease is still live, so nothing doubles up.
    adapter2 = FakeAdapter(env.repo, env.clock)
    sched2 = Scheduler(env.store, "fx", 1, adapter2, env.repo, env.checker, env.publisher, clock=env.clock, isolation_override=TIER_A,
                       available_models=MODELS, runner_id="runner-2", notifier=notes, secondary_owner="backup-owner")
    env.sched, env.adapter = sched2, adapter2
    env.clock.advance(65)  # the dead runner's plan lock expires after two heartbeats
    sched2.start(env.clock())
    env.tick(5)
    assert not adapter2.started
    env.run_until(lambda: env.state("steady") == "Done", advance=30, limit=60)
    assert env.store.state("attempt", "steady#1") == "Fenced"
    stale = status.build_report(env.store.home, env.clock())
    assert stale["runner"]["runner_id"] == "runner-2" and stale["runner"]["status"] == "alive"

    # 3. Escalation: silence never resolves the task. It reminds the owner up to three times, then notifies the secondary owner.
    for hours in (26, 50, 74, 98, 300):
        env.clock.t = 1000.0 + hours * H
        env.sched.tick(env.clock())
    subjects = notes.subjects("decision-gated-1")
    assert [s for _, s in subjects if s.startswith("reminder")] == ["reminder 1", "reminder 2", "reminder 3"]
    assert subjects.count(("backup-owner", "escalated")) == 1
    assert env.state("gated") == "Blocked" and env.store.state("human_task", "decision-gated-1") == "Requested"
    escalated = status.build_report(env.store.home, env.clock())
    [task] = escalated["human_tasks"]
    assert task["reminders_sent"] == 3 and task["age_s"] > 72 * H and task["secondary_owner"] == "backup-owner"
    text = status.render(escalated)
    assert "human task decision-gated-1" in text and "blocked gated" in text and "usage: unavailable" in text

    # 4. The owner answers. The blocked issue resumes by itself and the plan finishes.
    env.checker.fail_commands = set()
    res = humantasks.respond(env.store, "decision-gated-1", responder_ids=["owner"], source="local", now=env.clock(),
                             answers={"option": "give guidance and retry", "guidance": "gated-check was misconfigured"})
    assert res["status"] == "resolved" and res["released"] == ["gated"]
    env.run_until(lambda: env.store.state("plan", "fx@v1") == "Completed", advance=30, limit=100)
    final = status.build_report(env.store.home, env.clock())
    assert {q["coverage"] for q in final["requirements"]} == {"verified"} and final["human_tasks"] == []

    # No remote writes of any kind happened.
    assert env.store.sync_ops() == [] and env.publisher.simulated
    assert {i["action"] for i in env.publisher.intents} == {"open_pr", "merge_pr"}
