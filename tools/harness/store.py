"""Private runtime store: journal, entity states, plans, approvals, claims, and fenced leases.

SQLite with immediate transactions so several runner processes cannot double-claim.
"""
from __future__ import annotations

import contextlib
import json
import os
import sqlite3
import time
from collections import namedtuple
from typing import Any, Dict, Iterator, List, Optional

from . import machines

DEFAULT_LEASE_SECONDS = 90

Lease = namedtuple("Lease", "attempt_id issue_id epoch expires_at")


class ClaimConflict(Exception):
    pass


class StaleLease(Exception):
    pass


def default_home() -> str:
    return os.environ.get("HARNESS_HOME") or os.path.join(os.path.expanduser("~"), ".local", "state", "derschweigert-harness")


SCHEMA = """
CREATE TABLE IF NOT EXISTS entities(machine TEXT, id TEXT, state TEXT, prev_state TEXT, PRIMARY KEY(machine, id));
CREATE TABLE IF NOT EXISTS journal(
  seq INTEGER PRIMARY KEY AUTOINCREMENT, ts REAL, actor TEXT, machine TEXT, entity TEXT,
  from_state TEXT, to_state TEXT, evidence TEXT, idem_key TEXT UNIQUE);
CREATE TABLE IF NOT EXISTS plans(plan_id TEXT, version INTEGER, content TEXT, digest TEXT, PRIMARY KEY(plan_id, version));
CREATE TABLE IF NOT EXISTS approvals(plan_id TEXT, version INTEGER, record TEXT, PRIMARY KEY(plan_id, version));
CREATE TABLE IF NOT EXISTS epochs(issue_id TEXT PRIMARY KEY, epoch INTEGER);
CREATE TABLE IF NOT EXISTS sync_ops(
  op_key TEXT PRIMARY KEY, kind TEXT, stable_id TEXT, status TEXT, remote_ref INTEGER, content_sha TEXT,
  attempts INTEGER DEFAULT 0, last_error TEXT);
CREATE TABLE IF NOT EXISTS issue_meta(issue_id TEXT PRIMARY KEY, data TEXT);
CREATE TABLE IF NOT EXISTS attempt_meta(attempt_id TEXT PRIMARY KEY, issue_id TEXT, data TEXT);
CREATE TABLE IF NOT EXISTS evidence(
  id INTEGER PRIMARY KEY AUTOINCREMENT, issue_id TEXT, kind TEXT, head_rev TEXT, base_rev TEXT, verdict TEXT,
  detail TEXT, valid INTEGER DEFAULT 1, created_at REAL);
CREATE TABLE IF NOT EXISTS human_tasks(task_id TEXT PRIMARY KEY, issue_id TEXT, kind TEXT, owner TEXT, payload TEXT, created_at REAL);
CREATE TABLE IF NOT EXISTS run_state(plan_id TEXT PRIMARY KEY, data TEXT);
CREATE TABLE IF NOT EXISTS docs(kind TEXT, key TEXT, data TEXT, PRIMARY KEY(kind, key));
CREATE TABLE IF NOT EXISTS events(
  id INTEGER PRIMARY KEY AUTOINCREMENT, ts REAL, type TEXT, plan_id TEXT, phase_id TEXT, issue_id TEXT, attempt_id TEXT, run_id TEXT, data TEXT);
CREATE TABLE IF NOT EXISTS claims(issue_id TEXT PRIMARY KEY, attempt_id TEXT, runner_id TEXT, epoch INTEGER, expires_at REAL);
"""


class Store:
    def __init__(self, home: Optional[str] = None, readonly: bool = False):
        self.home = home or default_home()
        self.path = os.path.join(self.home, "harness.sqlite")
        if readonly:
            self.cx = sqlite3.connect("file:%s?mode=ro" % self.path, uri=True, isolation_level=None, timeout=10)
        else:
            os.makedirs(self.home, mode=0o700, exist_ok=True)
            self.cx = sqlite3.connect(self.path, isolation_level=None, timeout=10)
            self.cx.execute("PRAGMA journal_mode=WAL")
            self.cx.executescript(SCHEMA)
            os.chmod(self.path, 0o600)
        self.cx.row_factory = sqlite3.Row

    def close(self) -> None:
        self.cx.close()

    @contextlib.contextmanager
    def tx(self) -> Iterator[sqlite3.Connection]:
        self.cx.execute("BEGIN IMMEDIATE")
        try:
            yield self.cx
        except BaseException:
            self.cx.execute("ROLLBACK")
            raise
        else:
            self.cx.execute("COMMIT")

    # -- entities and journal -------------------------------------------------

    def state(self, machine: str, entity: str) -> Optional[str]:
        row = self.cx.execute("SELECT state FROM entities WHERE machine=? AND id=?", (machine, entity)).fetchone()
        return row["state"] if row else None

    def previous_state(self, machine: str, entity: str) -> Optional[str]:
        row = self.cx.execute("SELECT prev_state FROM entities WHERE machine=? AND id=?", (machine, entity)).fetchone()
        return row["prev_state"] if row else None

    def _journal(self, cx, actor, machine, entity, old, new, evidence, key, now) -> None:
        cx.execute(
            "INSERT INTO journal(ts, actor, machine, entity, from_state, to_state, evidence, idem_key) VALUES(?,?,?,?,?,?,?,?)",
            (now if now is not None else time.time(), actor, machine, entity, old, new, json.dumps(evidence, sort_keys=True), key),
        )

    def _transition(self, cx, machine, entity, new, actor, evidence, key, now) -> bool:
        if key and cx.execute("SELECT 1 FROM journal WHERE idem_key=?", (key,)).fetchone():
            return False
        row = cx.execute("SELECT state FROM entities WHERE machine=? AND id=?", (machine, entity)).fetchone()
        if row is None:
            old = machines.INITIAL[machine]
            cx.execute("INSERT INTO entities(machine, id, state) VALUES(?,?,?)", (machine, entity, old))
            self._journal(cx, actor, machine, entity, "", old, {"created": True}, None, now)
        else:
            old = row["state"]
        machines.check_transition(machine, old, new)
        prev = old if new in machines.REMEMBER_PREVIOUS else None
        cx.execute("UPDATE entities SET state=?, prev_state=? WHERE machine=? AND id=?", (new, prev, machine, entity))
        self._journal(cx, actor, machine, entity, old, new, evidence, key, now)
        return True

    def transition(self, machine: str, entity: str, new: str, actor: str, evidence: Optional[Dict[str, Any]] = None,
                   key: Optional[str] = None, now: Optional[float] = None) -> bool:
        """Apply a legal transition and journal it. A repeated idempotency key is a no-op."""
        with self.tx() as cx:
            return self._transition(cx, machine, entity, new, actor, evidence or {}, key, now)

    def journal(self, limit: int = 20) -> List[Dict[str, Any]]:
        rows = self.cx.execute("SELECT * FROM journal ORDER BY seq DESC LIMIT ?", (limit,)).fetchall()
        return [dict(r) for r in reversed(rows)]

    def claim_plan(self, plan_id: str, runner_id: str, now: float, ttl: float, pid: Optional[int] = None) -> Optional[str]:
        """Take ownership of a plan for this runner. Returns None on success, else the runner that holds it.

        Two runners on one plan fight over the same claims, retry budgets and human tasks; the lock makes that
        impossible instead of merely unlikely. A holder whose process is gone, or whose heartbeat is older than the
        time to live, is replaced.
        """
        owner = self.get_doc("plan_owner", plan_id) or {}
        held_by = owner.get("runner_id")
        if held_by and held_by != runner_id:
            alive = True
            holder_pid = owner.get("pid")
            if holder_pid:
                try:
                    os.kill(int(holder_pid), 0)
                except ProcessLookupError:
                    alive = False
                except (PermissionError, ValueError, OverflowError):
                    pass
            if alive and now - float(owner.get("heartbeat_at") or 0) <= ttl:
                return str(held_by)
        self.put_doc("plan_owner", plan_id, {"runner_id": runner_id, "heartbeat_at": now, "ttl_s": ttl, "pid": pid})
        return None

    def refresh_plan_claim(self, plan_id: str, runner_id: str, now: float) -> None:
        owner = self.get_doc("plan_owner", plan_id)
        if owner and owner.get("runner_id") == runner_id:
            self.put_doc("plan_owner", plan_id, dict(owner, heartbeat_at=now))

    def release_plan(self, plan_id: str, runner_id: str) -> None:
        owner = self.get_doc("plan_owner", plan_id)
        if owner and owner.get("runner_id") == runner_id:
            self.cx.execute("DELETE FROM docs WHERE kind=? AND key=?", ("plan_owner", plan_id))

    def last_transition_at(self, entity: str) -> Optional[float]:
        """When this entity last changed state, for records written before an end stamp existed."""
        row = self.cx.execute("SELECT ts FROM journal WHERE entity=? ORDER BY seq DESC LIMIT 1", (entity,)).fetchone()
        return (row["ts"] if row else None) or None

    # -- plans and approvals --------------------------------------------------

    def put_plan(self, plan: Dict[str, Any], digest: str) -> None:
        self.cx.execute("INSERT INTO plans VALUES(?,?,?,?)", (plan["plan_id"], plan["version"], json.dumps(plan, sort_keys=True), digest))

    def get_plan(self, plan_id: str, version: Optional[int] = None) -> Optional[Dict[str, Any]]:
        if version is None:
            row = self.cx.execute("SELECT * FROM plans WHERE plan_id=? ORDER BY version DESC LIMIT 1", (plan_id,)).fetchone()
        else:
            row = self.cx.execute("SELECT * FROM plans WHERE plan_id=? AND version=?", (plan_id, version)).fetchone()
        if row is None:
            return None
        return {"plan": json.loads(row["content"]), "digest": row["digest"]}

    def list_plans(self) -> List[Dict[str, Any]]:
        return [dict(r) for r in self.cx.execute("SELECT plan_id, version, digest FROM plans ORDER BY plan_id, version")]

    def put_approval(self, record: Dict[str, Any]) -> None:
        self.cx.execute("INSERT INTO approvals VALUES(?,?,?)", (record["plan_id"], record["version"], json.dumps(record, sort_keys=True)))

    def get_approval(self, plan_id: str, version: int) -> Optional[Dict[str, Any]]:
        row = self.cx.execute("SELECT record FROM approvals WHERE plan_id=? AND version=?", (plan_id, version)).fetchone()
        return json.loads(row["record"]) if row else None

    # -- GitHub synchronization records --------------------------------------

    def sync_get(self, op_key: str) -> Optional[Dict[str, Any]]:
        row = self.cx.execute("SELECT * FROM sync_ops WHERE op_key=?", (op_key,)).fetchone()
        return dict(row) if row else None

    def sync_put(self, op_key: str, kind: str, stable_id: str, status: str, remote_ref: Optional[int] = None,
                 content_sha: Optional[str] = None, error: Optional[str] = None) -> None:
        """Upsert a sync record. Keeps the last known remote reference and content hash when not supplied."""
        old = self.sync_get(op_key) or {}
        self.cx.execute(
            "INSERT OR REPLACE INTO sync_ops(op_key, kind, stable_id, status, remote_ref, content_sha, attempts, last_error) VALUES(?,?,?,?,?,?,?,?)",
            (op_key, kind, stable_id, status, remote_ref if remote_ref is not None else old.get("remote_ref"),
             content_sha if content_sha is not None else old.get("content_sha"),
             (old.get("attempts") or 0) + (1 if status != "done" else 0), error))

    def sync_ops(self, kind: Optional[str] = None) -> List[Dict[str, Any]]:
        q, args = "SELECT * FROM sync_ops", ()
        if kind:
            q, args = q + " WHERE kind=?", (kind,)
        return [dict(r) for r in self.cx.execute(q + " ORDER BY op_key", args)]

    def pending_sync(self) -> List[Dict[str, Any]]:
        try:
            return [dict(r) for r in self.cx.execute("SELECT * FROM sync_ops WHERE status!='done' ORDER BY op_key")]
        except sqlite3.OperationalError:
            return []

    # -- scheduler records (JSON documents keyed by id) ---------------------

    def _get_doc(self, table: str, key_col: str, key: str) -> Optional[Dict[str, Any]]:
        row = self.cx.execute("SELECT data FROM %s WHERE %s=?" % (table, key_col), (key,)).fetchone()
        return json.loads(row["data"]) if row else None

    def get_issue(self, issue_id: str) -> Optional[Dict[str, Any]]:
        return self._get_doc("issue_meta", "issue_id", issue_id)

    def put_issue(self, issue: Dict[str, Any]) -> None:
        self.cx.execute("INSERT OR REPLACE INTO issue_meta VALUES(?,?)", (issue["issue_id"], json.dumps(issue, sort_keys=True)))

    def list_issues(self, plan_id: Optional[str] = None) -> List[Dict[str, Any]]:
        docs = [json.loads(r["data"]) for r in self.cx.execute("SELECT data FROM issue_meta ORDER BY issue_id")]
        return [d for d in docs if plan_id is None or d.get("plan_id") == plan_id]

    def get_attempt(self, attempt_id: str) -> Optional[Dict[str, Any]]:
        return self._get_doc("attempt_meta", "attempt_id", attempt_id)

    def put_attempt(self, attempt: Dict[str, Any]) -> None:
        self.cx.execute("INSERT OR REPLACE INTO attempt_meta VALUES(?,?,?)",
                        (attempt["attempt_id"], attempt["issue_id"], json.dumps(attempt, sort_keys=True)))

    def list_attempts(self, issue_id: Optional[str] = None) -> List[Dict[str, Any]]:
        q, args = "SELECT data FROM attempt_meta", ()
        if issue_id:
            q, args = q + " WHERE issue_id=?", (issue_id,)
        return [json.loads(r["data"]) for r in self.cx.execute(q + " ORDER BY rowid", args)]

    def add_evidence(self, issue_id: str, kind: str, head_rev: str, base_rev: str, verdict: str,
                     detail: Optional[Dict[str, Any]] = None, now: Optional[float] = None) -> int:
        cur = self.cx.execute("INSERT INTO evidence(issue_id, kind, head_rev, base_rev, verdict, detail, created_at) VALUES(?,?,?,?,?,?,?)",
                              (issue_id, kind, head_rev, base_rev, verdict, json.dumps(detail or {}, sort_keys=True), now or time.time()))
        return cur.lastrowid

    def evidence(self, issue_id: str, kind: Optional[str] = None, valid_only: bool = True) -> List[Dict[str, Any]]:
        q, args = "SELECT * FROM evidence WHERE issue_id=?", [issue_id]
        if kind:
            q, args = q + " AND kind=?", args + [kind]
        if valid_only:
            q += " AND valid=1"
        return [dict(r) for r in self.cx.execute(q + " ORDER BY id", args)]

    def invalidate_evidence(self, issue_id: str, reason: str) -> int:
        cur = self.cx.execute("UPDATE evidence SET valid=0 WHERE issue_id=? AND valid=1", (issue_id,))
        return cur.rowcount

    def add_human_task(self, task_id: str, issue_id: str, kind: str, owner: str, payload: Dict[str, Any], now: float) -> bool:
        if self.cx.execute("SELECT 1 FROM human_tasks WHERE task_id=?", (task_id,)).fetchone():
            return False
        self.cx.execute("INSERT INTO human_tasks VALUES(?,?,?,?,?,?)", (task_id, issue_id, kind, owner, json.dumps(payload, sort_keys=True), now))
        return True

    def human_tasks(self, issue_id: Optional[str] = None) -> List[Dict[str, Any]]:
        q, args = "SELECT * FROM human_tasks", ()
        if issue_id:
            q, args = q + " WHERE issue_id=?", (issue_id,)
        out = []
        for r in self.cx.execute(q + " ORDER BY created_at, task_id", args):
            d = dict(r)
            d["payload"] = json.loads(d["payload"])
            d["state"] = self.state("human_task", d["task_id"])
            out.append(d)
        return out

    def get_doc(self, kind: str, key: str) -> Optional[Dict[str, Any]]:
        row = self.cx.execute("SELECT data FROM docs WHERE kind=? AND key=?", (kind, key)).fetchone()
        return json.loads(row["data"]) if row else None

    def put_doc(self, kind: str, key: str, data: Dict[str, Any]) -> None:
        self.cx.execute("INSERT OR REPLACE INTO docs VALUES(?,?,?)", (kind, key, json.dumps(data, sort_keys=True)))

    def docs(self, kind: str) -> List[Dict[str, Any]]:
        return [dict(json.loads(r["data"]), _key=r["key"]) for r in self.cx.execute("SELECT key, data FROM docs WHERE kind=? ORDER BY key", (kind,))]

    def get_human_task(self, task_id: str) -> Optional[Dict[str, Any]]:
        return next((t for t in self.human_tasks() if t["task_id"] == task_id), None)

    def update_human_task(self, task_id: str, payload: Dict[str, Any]) -> None:
        self.cx.execute("UPDATE human_tasks SET payload=? WHERE task_id=?", (json.dumps(payload, sort_keys=True), task_id))

    def get_run(self, plan_id: str) -> Dict[str, Any]:
        return self._get_doc("run_state", "plan_id", plan_id) or {}

    def put_run(self, plan_id: str, data: Dict[str, Any]) -> None:
        self.cx.execute("INSERT OR REPLACE INTO run_state VALUES(?,?)", (plan_id, json.dumps(data, sort_keys=True)))

    # -- claims, leases, fencing ---------------------------------------------

    def _fence_attempt(self, cx, attempt_id: str, actor: str, now: float) -> None:
        state = cx.execute("SELECT state FROM entities WHERE machine='attempt' AND id=?", (attempt_id,)).fetchone()
        if state and state["state"] in ("Claimed", "Running"):
            self._transition(cx, "attempt", attempt_id, "Fenced", actor, {"reason": "lease expired"}, None, now)

    def claim(self, issue_id: str, runner_id: str, now: float, lease_seconds: int = DEFAULT_LEASE_SECONDS) -> Lease:
        """Grant a lease with a fresh epoch. Rejects a duplicate claim from any runner while a lease is live."""
        with self.tx() as cx:
            row = cx.execute("SELECT * FROM claims WHERE issue_id=?", (issue_id,)).fetchone()
            if row is not None:
                if row["expires_at"] > now:
                    raise ClaimConflict("%s is claimed by %s (epoch %d)" % (issue_id, row["runner_id"], row["epoch"]))
                self._fence_attempt(cx, row["attempt_id"], runner_id, now)
                cx.execute("DELETE FROM claims WHERE issue_id=?", (issue_id,))
            prev = cx.execute("SELECT epoch FROM epochs WHERE issue_id=?", (issue_id,)).fetchone()
            epoch = (prev["epoch"] if prev else 0) + 1
            cx.execute("INSERT OR REPLACE INTO epochs VALUES(?,?)", (issue_id, epoch))
            attempt_id = "%s#%d" % (issue_id, epoch)
            expires = now + lease_seconds
            cx.execute("INSERT INTO claims VALUES(?,?,?,?,?)", (issue_id, attempt_id, runner_id, epoch, expires))
            cx.execute("INSERT INTO entities(machine, id, state) VALUES('attempt', ?, 'Claimed')", (attempt_id,))
            self._journal(cx, runner_id, "attempt", attempt_id, "", "Claimed", {"epoch": epoch, "issue": issue_id}, None, now)
            return Lease(attempt_id, issue_id, epoch, expires)

    def _live_claim(self, cx, attempt_id: str, epoch: int, now: float):
        row = cx.execute("SELECT * FROM claims WHERE attempt_id=?", (attempt_id,)).fetchone()
        if row is None or row["epoch"] != epoch:
            raise StaleLease("%s epoch %s has no live claim" % (attempt_id, epoch))
        if row["expires_at"] <= now:
            raise StaleLease("%s lease expired" % attempt_id)
        state = cx.execute("SELECT state FROM entities WHERE machine='attempt' AND id=?", (attempt_id,)).fetchone()
        if state is None or state["state"] not in ("Claimed", "Running"):
            raise StaleLease("%s is not claimed or running" % attempt_id)
        return row

    def validate_lease(self, attempt_id: str, epoch: int, now: float) -> None:
        """Broker-side check applied to every privileged write."""
        self._live_claim(self.cx, attempt_id, epoch, now)

    def heartbeat(self, attempt_id: str, epoch: int, now: float, lease_seconds: int = DEFAULT_LEASE_SECONDS) -> float:
        with self.tx() as cx:
            self._live_claim(cx, attempt_id, epoch, now)
            expires = now + lease_seconds
            cx.execute("UPDATE claims SET expires_at=? WHERE attempt_id=?", (expires, attempt_id))
            return expires

    def start(self, attempt_id: str, epoch: int, now: float) -> None:
        with self.tx() as cx:
            row = self._live_claim(cx, attempt_id, epoch, now)
            self._transition(cx, "attempt", attempt_id, "Running", row["runner_id"], {}, None, now)

    def finish(self, attempt_id: str, epoch: int, outcome: str, now: float, evidence: Optional[Dict[str, Any]] = None) -> None:
        if outcome not in ("Succeeded", "Failed", "TimedOut", "Cancelled"):
            raise ValueError("invalid outcome %r" % outcome)
        with self.tx() as cx:
            row = self._live_claim(cx, attempt_id, epoch, now)
            self._transition(cx, "attempt", attempt_id, outcome, row["runner_id"], evidence or {}, None, now)
            cx.execute("DELETE FROM claims WHERE attempt_id=?", (attempt_id,))

    def recover(self, now: float, actor: str = "recovery") -> List[str]:
        """After a crash: fence expired attempts, release their claims, and requeue In Progress issues."""
        fenced = []
        with self.tx() as cx:
            for row in cx.execute("SELECT * FROM claims WHERE expires_at<=?", (now,)).fetchall():
                self._fence_attempt(cx, row["attempt_id"], actor, now)
                cx.execute("DELETE FROM claims WHERE issue_id=?", (row["issue_id"],))
                issue = cx.execute("SELECT state FROM entities WHERE machine='issue' AND id=?", (row["issue_id"],)).fetchone()
                if issue and issue["state"] == "In Progress":
                    self._transition(cx, "issue", row["issue_id"], "Ready", actor, {"reason": "lease expired, worker fenced"}, None, now)
                fenced.append(row["attempt_id"])
        return fenced

    def active_claims_for(self, issue_id: str) -> List[Dict[str, Any]]:
        return [dict(r) for r in self.cx.execute("SELECT * FROM claims WHERE issue_id=?", (issue_id,))]

    def ensure_entity(self, machine: str, entity: str, actor: str, evidence: Optional[Dict[str, Any]] = None, now: Optional[float] = None) -> None:
        """Create an entity in its initial state and journal the creation. No-op when it exists."""
        with self.tx() as cx:
            if cx.execute("SELECT 1 FROM entities WHERE machine=? AND id=?", (machine, entity)).fetchone() is None:
                initial = machines.INITIAL[machine]
                cx.execute("INSERT INTO entities(machine, id, state) VALUES(?,?,?)", (machine, entity, initial))
                self._journal(cx, actor, machine, entity, "", initial, evidence or {}, None, now)

    def active_claims(self) -> List[Dict[str, Any]]:
        return [dict(r) for r in self.cx.execute("SELECT * FROM claims ORDER BY issue_id")]

    def entity_states(self) -> List[Dict[str, Any]]:
        return [dict(r) for r in self.cx.execute("SELECT machine, id, state, prev_state FROM entities ORDER BY machine, id")]
