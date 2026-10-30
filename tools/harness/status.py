"""Read-only status: business state and live execution state, with unavailable metrics labeled as such."""
from __future__ import annotations

import json
import os
import sqlite3
import time
from typing import Any, Dict, List, Optional

from . import approval, descope, plans, telemetry, usage
from .approval import AuthorizationError, plan_entity
from .store import Store, default_home

HEARTBEAT_STALE_FACTOR = 3


def _safe(fn, default):
    try:
        return fn()
    except sqlite3.OperationalError:
        return default


def build_report(home: Optional[str] = None, now: Optional[float] = None) -> Dict[str, Any]:
    home = home or default_home()
    now = time.time() if now is None else now
    report: Dict[str, Any] = {
        "store": home, "now": now, "isolation": {"tier": "B", "reason": "store not initialized"}, "run_permitted": False,
        "plans": [], "phases": [], "requirements": [], "queue": [], "blockers": [], "workers": [], "runner": {"status": "none"},
        "expired_leases": [], "claims": [], "pending_sync": [], "failures": [], "evidence": [], "human_tasks": [], "budgets": {},
        "metrics": telemetry.metrics_report(), "events": [], "journal": [], "entities": [], "issues": [],
        "usage": "unavailable: the runtime reports no per-attempt token or cost data to the harness",
        "limitations": ["branch protection: autonomous merge is blocked without verified strict required checks enforced for administrators"],
    }
    if not os.path.exists(os.path.join(home, "harness.sqlite")):
        report["note"] = "store not initialized"
        return report
    store = Store(home, readonly=True)
    try:
        iso = approval.detect_isolation(store)
        report["isolation"], report["run_permitted"] = iso, iso["tier"] == "A"
        _plans(store, report, now)
        _issues(store, report, now)
        _workers(store, report, now)
        _tasks(store, report, now)
        _usage(store, report)
        report["pending_sync"] = store.pending_sync()
        report["claims"] = store.active_claims()
        report["entities"] = store.entity_states()
        report["journal"] = store.journal(10)
        report["events"] = _safe(lambda: telemetry.recent(store, 15), [])
        report["event_count"] = _safe(lambda: telemetry.count(store), 0)
    finally:
        store.close()
    _flow_order(report)
    return report


def _flow_order(report: Dict[str, Any]) -> None:
    """Order per-issue rows the way the plan flows: plan, then phase, then issue id.

    A stable total order keeps rows from moving between refreshes, and phase order makes progress read top-down
    instead of following the alphabet of issue ids.
    """
    latest: Dict[str, int] = {}
    for plan in report["plans"]:
        if plan["version"] >= latest.get(plan["plan_id"], 0):
            latest[plan["plan_id"]] = plan["version"]
    phase_rank: Dict[tuple, Dict[str, int]] = {}
    for row in report["phases"]:
        ranks = phase_rank.setdefault((row["plan_id"], row["version"]), {})
        ranks[row["phase"]] = len(ranks)
    plan_rank = {plan_id: rank for rank, plan_id in enumerate(sorted(latest))}

    def position(plan_id: Optional[str], phase: Optional[str], issue_id: Optional[str]) -> tuple:
        ranks = phase_rank.get((plan_id, latest.get(plan_id)), {})
        return plan_rank.get(plan_id, len(plan_rank)), ranks.get(phase, len(ranks)), issue_id or ""

    report["queue"].sort(key=lambda row: position(row.get("plan_id"), row.get("phase"), row.get("issue_id")))
    report["issues"].sort(key=lambda row: position(row.get("plan_id"), row.get("phase"), row.get("issue_id")))
    order = {row["issue_id"]: rank for rank, row in enumerate(report["queue"])}
    for key in ("blockers", "workers", "failures", "evidence"):
        report[key].sort(key=lambda row: (order.get(row.get("issue_id") or row.get("issue"), len(order)),
                                          row.get("issue_id") or row.get("issue") or ""))


def filter_plan(report: Dict[str, Any], plan_id: str) -> Dict[str, Any]:
    """Only one plan's phases, requirements, issues, workers and budget. Runner, isolation and events stay: they are not per plan."""
    ids = {i["issue_id"] for i in report["issues"] if i.get("plan_id") == plan_id}
    out = dict(report)
    for key in ("plans", "phases", "requirements"):
        out[key] = [r for r in report[key] if r.get("plan_id") == plan_id]
    out["budgets"] = {k: v for k, v in report["budgets"].items() if k == plan_id}
    out["issues"] = [r for r in report["issues"] if r["issue_id"] in ids]
    for key in ("queue", "blockers", "failures", "evidence"):
        out[key] = [r for r in report[key] if r["issue_id"] in ids]
    out["workers"] = [r for r in report["workers"] if r["issue"] in ids]
    plan_usage = report.get("usage_detail", {}).get("plans", {}).get(plan_id)
    if plan_usage is not None:
        out["usage_detail"] = dict(report["usage_detail"], total=plan_usage, plans={plan_id: plan_usage})
        out["usage"] = usage.headline(plan_usage)
    out["human_tasks"] = [t for t in report["human_tasks"] if set(t.get("issue_ids") or [t.get("issue_id")]) & ids] if report["human_tasks"] and isinstance(report["human_tasks"][0], dict) else report["human_tasks"]
    return out


def _plans(store: Store, report: Dict[str, Any], now: float) -> None:
    for row in store.list_plans():
        pid, ver = row["plan_id"], row["version"]
        try:
            approval.verify_approval(store, pid, ver)
            appr = "valid"
        except AuthorizationError as exc:
            appr = "none" if "no approval record" in str(exc) else "INVALID: %s" % exc
        plan = store.get_plan(pid, ver)["plan"]
        run = _safe(lambda: store.get_run(pid), {})
        budgets = plan["policy"]["budgets"]
        ended = run.get("ended_at") or now  # a paused, cancelled or completed run stops charging wall clock
        elapsed = max(0.0, ended - run["started_at"]) if run.get("started_at") else None
        report["plans"].append({"plan_id": pid, "version": ver, "state": store.state("plan", plan_entity(pid, ver)), "digest": row["digest"][:12],
                                "approval": appr, "paused_reason": run.get("paused_reason", ""), "cancel_requested": bool(run.get("cancel_requested")),
                                "pause_requested": bool(run.get("pause_requested")),
                                "base_branch": plans.base_branch(plan), "run_branch": plans.run_branch(plan)})
        limit = budgets.get("pull_requests_per_run")  # None means unlimited
        report.setdefault("deferred", {})[pid] = _safe(lambda: descope.deferrals(store, pid, ver), [])
        report["budgets"][pid] = {
            "wall_clock_s": {"limit": budgets["run_wall_clock_s"], "used": elapsed,
                             "remaining": max(budgets["run_wall_clock_s"] - elapsed, 0) if elapsed is not None else None},
            "pull_requests": {"limit": limit, "used": run.get("prs", 0),
                              "remaining": None if limit is None else limit - run.get("prs", 0)},
            "tokens_and_cost": telemetry.UNAVAILABLE}
        issues = [i for i in _safe(lambda: store.list_issues(pid), [])]
        for ph in plan["phases"]:
            mine = [i for i in issues if i["phase_id"] == ph["id"]]
            counts: Dict[str, int] = {}
            for i in mine:
                st = store.state("issue", i["issue_id"]) or "Inbox"
                counts[st] = counts.get(st, 0) + 1
            report["phases"].append({"plan_id": pid, "version": ver, "phase": ph["id"], "state": store.state("phase", "%s/%s" % (plan_entity(pid, ver), ph["id"])) or "Planned",
                                     "depends_on": ph["dependencies"], "issues": counts, "requirements": ph["requirements"]})
        phase_state = {p["phase"]: p["state"] for p in report["phases"] if p["plan_id"] == pid}
        for req in plan["requirements"]:
            owners = [i for i in issues if req["id"] in i["requirement_ids"] and store.state("issue", i["issue_id"]) != "Cancelled"]
            states = [store.state("issue", i["issue_id"]) for i in owners]
            host = next((p["id"] for p in plan["phases"] if req["id"] in p["requirements"]), None)
            if host and phase_state.get(host) == "Done":
                cov = "verified"
            elif states and all(s == "Done" for s in states):
                cov = "implemented, phase not validated"
            elif states:
                cov = "in progress"
            else:
                cov = "no issue yet"
            report["requirements"].append({"plan_id": pid, "version": ver, "id": req["id"], "title": req["title"], "phase": host, "coverage": cov})


def _issues(store: Store, report: Dict[str, Any], now: float) -> None:
    tasks = _safe(store.human_tasks, [])
    for i in _safe(store.list_issues, []):
        iid = i["issue_id"]
        state = store.state("issue", iid)
        open_tasks = [t["task_id"] for t in tasks if iid in t["payload"].get("issue_ids", [t["issue_id"]]) and t["state"] in ("Requested", "Acknowledged", "Submitted", "Validated")]
        unmet = [d for d in i["deps"] if store.state("issue", d) != "Done"]
        report["issues"].append({"issue_id": iid, "plan_id": i.get("plan_id"), "phase": i["phase_id"], "state": state, "transient_failures": i["transient_failures"],
                                 "repair_failures": i["repair_failures"], "blocked_reason": i["blocked_reason"]})
        report["queue"].append({"issue_id": iid, "plan_id": i.get("plan_id"), "state": state, "phase": i["phase_id"], "depends_on": i["deps"], "unmet_dependencies": unmet,
                                "not_before": i["not_before"] or None, "branch": i["branch"], "head": i["head_rev"] or None, "pr": i["pr"]})
        if state == "Blocked":
            report["blockers"].append({"issue_id": iid, "reason": i["blocked_reason"], "unmet_dependencies": unmet, "human_tasks": open_tasks,
                                       "owned": bool(unmet or open_tasks or i.get("cancelled"))})
        if i["last_failures"]:
            report["failures"].append({"issue_id": iid, "recent": i["last_failures"][-3:]})
        ev = {k: [dict(verdict=e["verdict"], head=e["head_rev"][:12], base=e["base_rev"][:12]) for e in _safe(lambda k=k: store.evidence(iid, k), [])][-1:]
              for k in ("checks", "review", "manual", "merge", "integrated")}
        report["evidence"].append({"issue_id": iid, "checks": ev["checks"], "review": ev["review"], "manual": ev["manual"],
                                   "integration": {"merged": ev["merge"], "integrated_checks": ev["integrated"]}})


def _workers(store: Store, report: Dict[str, Any], now: float) -> None:
    heartbeat = 30
    plans = [store.get_plan(r["plan_id"], r["version"])["plan"] for r in store.list_plans()]
    if plans:
        heartbeat = plans[-1]["policy"]["budgets"]["heartbeat_s"]
    for c in store.active_claims():
        meta = _safe(lambda c=c: store.get_attempt(c["attempt_id"]), None) or {}
        issue = store.get_issue(c["issue_id"]) or {}
        row = {"attempt_id": c["attempt_id"], "run_id": c["attempt_id"], "role": meta.get("role"), "issue": c["issue_id"], "branch": issue.get("branch"),
               "revision": issue.get("head_rev") or None, "elapsed_s": now - meta["started_at"] if meta.get("started_at") else None,
               "retries": issue.get("transient_failures", 0) + issue.get("repair_failures", 0), "tier": meta.get("tier"), "model": meta.get("model"),
               "last_activity_age_s": now - meta["last_activity"] if meta.get("last_activity") else None,
               "lease_expires_in_s": c["expires_at"] - now, "runner": c["runner_id"],
               "latest_outcome": next((a.get("outcome") for a in reversed(store.list_attempts(c["issue_id"])) if a.get("outcome")), None)}
        report["workers"].append(row)
        if c["expires_at"] < now:
            report["expired_leases"].append({"attempt_id": c["attempt_id"], "expired_s_ago": now - c["expires_at"], "runner": c["runner_id"]})
    runners = _safe(lambda: store.docs("runner"), [])
    if runners:
        last = max(runners, key=lambda r: r["last_tick"])
        age = now - last["last_tick"]
        report["runner"] = {"status": "alive" if age <= heartbeat * HEARTBEAT_STALE_FACTOR else "stale: no scheduling pass recently",
                            "runner_id": last["_key"], "last_heartbeat_age_s": age, "heartbeat_interval_s": heartbeat, "active_attempts": last.get("active", [])}


def _usage(store: Store, report: Dict[str, Any]) -> None:
    """Token and cost estimates from the attempt records, by plan, model, and role. Every figure names its source."""
    prices = usage.load_prices(store.home)
    plan_of = {i["issue_id"]: i.get("plan_id") for i in _safe(store.list_issues, [])}
    attempts = _safe(store.list_attempts, [])
    by_plan: Dict[Any, List[Dict[str, Any]]] = {}
    for a in attempts:
        by_plan.setdefault(plan_of.get(a["issue_id"]), []).append(a)
    plans = {pid: usage.summarize(rows, prices) for pid, rows in by_plan.items() if pid}
    total = usage.summarize(attempts, prices)
    report["usage_detail"] = {"total": total, "plans": plans, "prices": {k: v for k, v in prices.items() if k != "models"} | {"models": sorted(prices["models"])}}
    report["usage"] = usage.headline(total)
    for pid, budget in report["budgets"].items():
        if pid in plans and usage.has_data(plans[pid]):
            budget["tokens_and_cost"] = usage.short(plans[pid])


def _tasks(store: Store, report: Dict[str, Any], now: float) -> None:
    notified = _safe(lambda: store.docs("notified"), [])
    for t in _safe(store.human_tasks, []):
        p = t["payload"]
        if t["state"] in ("Resolved", "Cancelled"):
            continue
        reminders = len([n for n in notified if n["_key"].startswith(t["task_id"] + ":") and ":reminder:" in n["_key"]])
        report["human_tasks"].append({"task_id": t["task_id"], "kind": p["kind"], "state": t["state"], "owner": p["owner"], "secondary_owner": p.get("secondary_owner"),
                                      "affected_issues": p["issue_ids"], "age_s": now - p.get("requested_at", t["created_at"]), "deadline": p.get("deadline"),
                                      "round": p.get("round", 1), "reminders_sent": reminders, "why": p["why"][:160]})


def render(report: Dict[str, Any]) -> str:
    out: List[str] = []
    w = out.append
    w("store: %s" % report["store"])
    w("isolation: Tier %s (%s). run %s" % (report["isolation"]["tier"], report["isolation"]["reason"], "permitted" if report["run_permitted"] else "refused"))
    r = report["runner"]
    w("runner: %s" % (r["status"] if r["status"] == "none" else "%s (%s, last heartbeat %.0fs ago)" % (r["status"], r["runner_id"], r["last_heartbeat_age_s"])))
    for p in report["plans"]:
        w("plan %s v%d  %s  digest %s  approval %s%s" % (p["plan_id"], p["version"], p["state"], p["digest"], p["approval"], "  PAUSED: " + p["paused_reason"] if p["paused_reason"] and p["state"] == "Paused" else ("  PAUSE REQUESTED, finishing active work" if p["pause_requested"] else "")))
        b = report["budgets"].get(p["plan_id"], {})
        if b:
            pr = b["pull_requests"]
            for rec in report.get("deferred", {}).get(p["plan_id"], []):
                w("  deferred: %s -> %s (%s)" % (rec["requirement_id"], rec["followup_issue"], rec["reason"][:70]))
            w("  budgets: wall-clock %s of %ss, pull requests %d of %s, tokens and cost %s" % (
                "%.0f" % b["wall_clock_s"]["used"] if b["wall_clock_s"]["used"] is not None else "not started", b["wall_clock_s"]["limit"],
                pr["used"], "unlimited" if pr["limit"] is None else pr["limit"], b["tokens_and_cost"]))
    for ph in report["phases"]:
        w("  phase %s %s  issues %s  deps %s" % (ph["phase"], ph["state"], ph["issues"] or "none", ",".join(ph["depends_on"]) or "-"))
    for rq in report["requirements"]:
        w("  requirement %s: %s (%s)" % (rq["id"], rq["coverage"], rq["phase"]))
    for q in report["queue"]:
        w("issue %s %s  phase %s%s" % (q["issue_id"], q["state"], q["phase"], "  waiting on " + ",".join(q["unmet_dependencies"]) if q["unmet_dependencies"] else ""))
    for b in report["blockers"]:
        w("blocked %s: %s  tasks %s  owned %s" % (b["issue_id"], b["reason"][:100], b["human_tasks"] or "-", b["owned"]))
    for k in report["workers"]:
        w("worker %s %s on %s branch %s elapsed %s retries %d tier %s model %s lease %.0fs" % (
            k["attempt_id"], k["role"], k["issue"], k["branch"], "%.0fs" % k["elapsed_s"] if k["elapsed_s"] is not None else "?", k["retries"], k["tier"], k["model"], k["lease_expires_in_s"]))
    for e in report["expired_leases"]:
        w("EXPIRED LEASE %s (%.0fs ago)" % (e["attempt_id"], e["expired_s_ago"]))
    for t in report["human_tasks"]:
        w("human task %s [%s] %s owner %s age %.0fh reminders %d issues %s" % (t["task_id"], t["kind"], t["state"], t["owner"], t["age_s"] / 3600, t["reminders_sent"], ",".join(t["affected_issues"])))
    for o in report["pending_sync"]:
        w("pending sync %s (%s) %s" % (o["op_key"], o["status"], o["last_error"] or ""))
    w("usage: " + report["usage"])
    detail = report.get("usage_detail")
    if detail and usage.has_data(detail["total"]):
        for row in detail["total"]["by_model"]:
            w("  %s: ~%s in / ~%s out over %d attempts" % (row["name"], usage.count(row["input_tokens"]), usage.count(row["output_tokens"]), row["attempts"]))
        w("  estimates come from the agents' own accounts or from prompt size, never from the runtime, and nothing enforces them")
    for text in report["limitations"]:
        w("limitation: " + text)
    if report.get("note"):
        w(report["note"])
    return "\n".join(out)


def issue_detail(home: Optional[str], issue_id: str) -> Dict[str, Any]:
    """Everything the store knows about one issue: scope, state, attempts, evidence, human tasks, and its journal. Read-only."""
    home = home or default_home()
    if not os.path.exists(os.path.join(home, "harness.sqlite")):
        raise KeyError("store not initialized")
    store = Store(home, readonly=True)
    try:
        issue = store.get_issue(issue_id)
        if issue is None:
            known = ", ".join(i["issue_id"] for i in store.list_issues()) or "none"
            raise KeyError("unknown issue %r (known: %s)" % (issue_id, known))
        attempts = store.list_attempts(issue_id)
        for a in attempts:
            a.pop("packet_digest", None)
        journal = [dict(r, evidence=r["evidence"]) for r in store.cx.execute(
            "SELECT ts, actor, from_state, to_state, evidence FROM journal WHERE machine='issue' AND entity=? ORDER BY seq", (issue_id,))]
        return {
            "issue": issue, "state": store.state("issue", issue_id), "previous_state": store.previous_state("issue", issue_id),
            "attempts": attempts, "claims": store.active_claims_for(issue_id),
            "evidence": [dict(e, detail=json.loads(e["detail"])) for e in store.evidence(issue_id, valid_only=False)],
            "human_tasks": [{"task_id": t["task_id"], "kind": t["kind"], "state": t["state"], "owner": t["owner"], "why": t["payload"]["why"]}
                            for t in store.human_tasks() if issue_id in t["payload"].get("issue_ids", [t["issue_id"]])],
            "journal": journal,
        }
    finally:
        store.close()


def render_issue(d: Dict[str, Any]) -> str:
    i = d["issue"]
    out: List[str] = []
    w = out.append
    w("issue %s  [%s]%s" % (i["issue_id"], d["state"], "  (was %s)" % d["previous_state"] if d["previous_state"] else ""))
    w("title: %s" % i["title"])
    w("phase %s, requirements %s, parallel-safe %s" % (i["phase_id"], ", ".join(i["requirement_ids"]), i["parallel_safe"]))
    for label, key in (("outcomes", "outcomes"), ("acceptance criteria", "acceptance_criteria"), ("non-goals", "non_goals"), ("code anchors", "code_anchors"),
                       ("contract paths", "contract_paths"), ("depends on", "deps"), ("validation commands", "validation_commands")):
        if i.get(key):
            w("%s:" % label)
            out.extend("  - " + str(v) for v in i[key])
    w("branch %s, base %s, head %s, pull request %s" % (i["branch"], i["base_rev"][:12] or "-", i["head_rev"][:12] or "-", i["pr"] or "-"))
    w("failures: transient %d, repair %d%s" % (i["transient_failures"], i["repair_failures"], "  BLOCKED: " + i["blocked_reason"] if i["blocked_reason"] else ""))
    for f in i["last_failures"]:
        w("  - %s (%s, %s): %s" % (f["kind"], f["class"], f["role"], f["detail"][:140]))
    if d["attempts"]:
        w("attempts:")
        out.extend("  %s %s tier %s model %s -> %s %s%s" % (a["attempt_id"], a["role"], a.get("tier"), a.get("model"), a.get("outcome") or "running",
                                                          ("(%s)" % a["failure_kind"]) if a.get("failure_kind") else "",
                                                          "  " + usage.attempt_label(a) if usage.attempt_label(a) else "") for a in d["attempts"])
        for a in d["attempts"]:
            if a.get("analysis"):
                analysis = a["analysis"]
                w("analysis %s recommends %s: %s" % (a["attempt_id"], analysis["recommendation"], analysis["root_cause"][:200]))
                out.extend("  - proposed issue %s: %s" % (p["issue_id"], p["title"]) for p in analysis.get("parts", []))
                if analysis.get("file"):
                    w("  proposed issues file: %s" % analysis["file"])
    if d["evidence"]:
        w("evidence:")
        out.extend("  %s %s head %s base %s%s" % (e["kind"], e["verdict"], e["head_rev"][:12], e["base_rev"][:12], "" if e["valid"] else "  (invalidated)") for e in d["evidence"])
    for t in d["human_tasks"]:
        w("human task %s [%s] %s owner %s: %s" % (t["task_id"], t["kind"], t["state"], t["owner"], t["why"][:120]))
    if d["journal"]:
        w("history:")
        out.extend("  %s  %s -> %s by %s" % (time.strftime("%H:%M:%S", time.localtime(j["ts"])), j["from_state"] or "(new)", j["to_state"], j["actor"]) for j in d["journal"])
    return "\n".join(out)
