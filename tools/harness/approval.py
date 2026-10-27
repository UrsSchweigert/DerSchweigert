"""Approval records bound to a scope-and-policy digest, signed with a key held in the private store.

Limit: in Tier B the key file is readable by the operator's OS user, so signing detects tampering and
forgery by workers only if they cannot read the store. Tier A must place the store out of worker reach.
"""
from __future__ import annotations

import datetime
import hashlib
import hmac
import os
import time
from typing import Any, Callable, Dict, Optional, Sequence

from . import isolation, plans, schemas
from .store import StaleLease, Store


class AuthorizationError(Exception):
    pass


def detect_isolation(store: Optional[Store] = None) -> Dict[str, str]:
    """Tier A only with a valid, fresh, signed attestation from `harness isolation verify`. Anything else is Tier B."""
    if store is None:
        return {"tier": "B", "reason": "no store to read an isolation attestation from"}
    return isolation.current_tier(store.home, _load_key(store, False))


def _key_path(store: Store) -> str:
    return os.path.join(store.home, "approval.key")


def _load_key(store: Store, create: bool) -> Optional[bytes]:
    path = _key_path(store)
    if not os.path.exists(path):
        if not create:
            return None
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "wb") as fh:
            fh.write(os.urandom(32))
    with open(path, "rb") as fh:
        return fh.read()


def _sign(key: bytes, record: Dict[str, Any]) -> str:
    body = {k: v for k, v in record.items() if k != "signature"}
    return hmac.new(key, plans.canonical(body), hashlib.sha256).hexdigest()


def plan_entity(plan_id: str, version: int) -> str:
    return "%s@v%d" % (plan_id, version)


def approve(store: Store, plan_id: str, version: Optional[int], approver: str,
            confirm: Callable[[Dict[str, Any], str], bool], *, require_preflight: bool = False) -> Dict[str, Any]:
    """Record human approval. `confirm` is the trusted human interaction and receives the plan and digest."""
    stored = store.get_plan(plan_id, version)
    if stored is None:
        raise AuthorizationError("unknown plan %s" % plan_id)
    plan, digest = stored["plan"], stored["digest"]
    entity = plan_entity(plan_id, plan["version"])
    if plans.plan_digest(plan) != digest:
        raise AuthorizationError("stored plan content does not match its digest")
    if store.state("plan", entity) != "Proposed":
        raise AuthorizationError("plan %s is %s, not Proposed" % (entity, store.state("plan", entity)))
    if plans.validate_plan(plan):
        raise AuthorizationError("plan is not valid")
    iso = detect_isolation(store)
    if not plan.get("fixture") and iso["tier"] != "A":
        raise AuthorizationError("Tier B permits approval of fixture plans only: %s" % iso["reason"])
    if require_preflight or not plan.get("fixture"):
        preflight = store.get_doc("check_preflight", plan_entity(plan_id, plan["version"]))
        if not preflight or preflight.get("digest") != digest or not preflight.get("head"):
            raise AuthorizationError("validation checks have not been preflighted for this exact plan version")
        config_errors = [r for r in preflight.get("results", []) if r.get("kind") == "configuration"]
        if config_errors:
            raise AuthorizationError("validation configuration errors must be fixed before approval: %s" %
                                     "; ".join("%s: %s" % (r["command"], r.get("output", "")) for r in config_errors[:3]))
    if not confirm(plan, digest):
        raise AuthorizationError("approval declined")
    record = {
        "plan_id": plan_id,
        "version": plan["version"],
        "digest": digest,
        "approver": approver,
        "approved_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "authorized_operations": sorted(plan["policy"]["authorized_operations"]),
        "signature": "",
    }
    record["signature"] = _sign(_load_key(store, True), record)
    schemas.validate(record, schemas.APPROVAL_RECORD, "approval")
    with store.tx():
        store.put_approval(record)
        store._transition(store.cx, "plan", entity, "Approved", approver, {"digest": digest}, None, None)
    return record


def verify_approval(store: Store, plan_id: str, version: int) -> Dict[str, Any]:
    """Reject unapproved, forged, and changed-digest plans. Run at every scheduling pass."""
    stored = store.get_plan(plan_id, version)
    if stored is None:
        raise AuthorizationError("unknown plan %s v%s" % (plan_id, version))
    record = store.get_approval(plan_id, version)
    if record is None:
        raise AuthorizationError("plan %s v%s has no approval record" % (plan_id, version))
    try:
        schemas.validate(record, schemas.APPROVAL_RECORD, "approval")
    except schemas.SchemaError as exc:
        raise AuthorizationError("malformed approval record: %s" % exc)
    key = _load_key(store, False)
    if key is None or not hmac.compare_digest(record["signature"], _sign(key, record)):
        raise AuthorizationError("approval signature is invalid")
    if record["plan_id"] != plan_id or record["version"] != version:
        raise AuthorizationError("approval is bound to a different plan version")
    if plans.plan_digest(stored["plan"]) != record["digest"] or stored["digest"] != record["digest"]:
        raise AuthorizationError("plan scope or policy changed since approval")
    return record


def authorize_run(store: Store, plan_id: str, version: int, isolation_override: Optional[Dict[str, str]] = None,
                  allow_paused: bool = False) -> Dict[str, Any]:
    """The check `run` must pass: approved plan, verified digest, and an isolation tier that permits execution."""
    iso = isolation_override or detect_isolation(store)
    if iso["tier"] != "A":
        raise AuthorizationError("run refused, Tier B: %s" % iso["reason"])
    record = verify_approval(store, plan_id, version)
    state = store.state("plan", plan_entity(plan_id, version))
    if state not in ("Approved", "Executing") + (("Paused",) if allow_paused else ()):
        raise AuthorizationError("plan is %s, not Approved or Executing" % state)
    return record


def authorize_operations(store: Store, plan_id: str, version: int, operations: Sequence[str],
                         isolation_override: Optional[Dict[str, str]] = None, *, attempt_id: Optional[str] = None,
                         epoch: Optional[int] = None, now: Optional[float] = None, dry_run: bool = False) -> Dict[str, Any]:
    """Authorize a mutation against the signed policy and, for worker actions, its current lease."""
    if attempt_id is not None:
        try:
            store.validate_lease(attempt_id, epoch, time.time() if now is None else now)
        except StaleLease as exc:
            raise AuthorizationError("stale lease: %s" % exc) from exc
    if dry_run:
        record = verify_approval(store, plan_id, version)
        state = store.state("plan", plan_entity(plan_id, version))
        if state not in ("Approved", "Executing"):
            raise AuthorizationError("plan is %s, not Approved or Executing" % state)
    else:
        record = authorize_run(store, plan_id, version, isolation_override)
    for operation in operations:
        if operation not in record["authorized_operations"]:
            raise AuthorizationError("%s is not authorized by the approval" % operation)
    return record
