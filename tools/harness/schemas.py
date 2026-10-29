"""Minimal strict schema validation for harness documents. Unknown keys are rejected."""
from __future__ import annotations

from typing import Any, Dict


class SchemaError(ValueError):
    pass


def _check(value: Any, spec: Any, path: str) -> None:
    if isinstance(spec, dict):
        if not isinstance(value, dict):
            raise SchemaError("%s: expected object" % path)
        for key, sub in spec.items():
            optional = key.endswith("?")
            name = key[:-1] if optional else key
            if name not in value:
                if optional:
                    continue
                raise SchemaError("%s.%s: missing" % (path, name))
            _check(value[name], sub, "%s.%s" % (path, name))
        allowed = {k.rstrip("?") for k in spec}
        extra = set(value) - allowed
        if extra:
            raise SchemaError("%s: unknown keys %s" % (path, sorted(extra)))
    elif isinstance(spec, list):
        if not isinstance(value, list):
            raise SchemaError("%s: expected list" % path)
        for i, item in enumerate(value):
            _check(item, spec[0], "%s[%d]" % (path, i))
    elif isinstance(spec, tuple):
        if value not in spec:
            raise SchemaError("%s: %r not in %s" % (path, value, list(spec)))
    else:
        if isinstance(value, bool) and spec is not bool:
            raise SchemaError("%s: expected %s" % (path, spec.__name__))
        if spec is float and isinstance(value, int):
            return
        if not isinstance(value, spec):
            raise SchemaError("%s: expected %s" % (path, spec.__name__))


def validate(doc: Any, schema: Dict[str, Any], name: str = "document") -> Any:
    _check(doc, schema, name)
    return doc


REQUIREMENT = {"id": str, "title": str, "source": str}

MODEL_CHOICE = {"model": str, "reason": str}
MODEL_CHOICES = {"implementer?": MODEL_CHOICE, "reviewer?": MODEL_CHOICE, "refiner?": MODEL_CHOICE}
DELEGATOR_DECISION = {"action": ("retry", "ask_owner"), "diagnosis": str, "guidance?": str, "model_choice?": MODEL_CHOICE}
SPLIT_ISSUE = {
    "issue_id": str, "requirement_ids": [str], "title": str, "outcomes": [str], "acceptance_criteria": [str], "non_goals": [str],
    "code_anchors": [str], "contract_paths?": [str], "deps?": [str], "validation_commands?": [str], "working_directory?": str,
    "parallel_safe?": bool, "model_choices?": MODEL_CHOICES,
}
ANALYSIS = {"root_cause": str, "recommendation": ("split", "retry", "needs_owner"), "split?": [SPLIT_ISSUE], "guidance?": str, "questions?": [str]}

PHASE = {
    "id": str,
    "outcomes": [str],
    "requirements": [str],
    "path_allowlist": [str],
    "non_goals": [str],
    "dependencies": [str],
    "exit_criteria": [str],
    "validation": [str],
    "working_directory?": str,
}

POLICY = {
    "authorized_operations": [str],
    "escalation_paths": [str],
    "merge_policy": str,
    "budgets": dict,
    "model_sources?": [str],
    "model_tiers": dict,
    "diff_size_cap": int,
    "assets?": dict,
    "manual_testing?": dict,
    "descope?": dict,
    "auto_answer?": dict,
}

PLAN = {
    "plan_id": str,
    "version": int,
    "requirements": [REQUIREMENT],
    "phases": [PHASE],
    "policy": POLICY,
    "fixture?": bool,
    "intent?": str,
}

TASK_PACKET = {
    "intent?": str,
    "requirement_context?": [{"id": str, "title": str}],
    "phase_context?": {"id": str, "outcomes": [str], "non_goals": [str], "exit_criteria": [str], "dependencies": [str]},
    "issue_id": str,
    "phase_id": str,
    "requirement_ids": [str],
    "role": ("investigator", "refiner", "implementer", "reviewer", "integrator", "delegator", "analyst"),
    "tier": ("low", "standard", "strong"),
    "outcomes": [str],
    "acceptance_criteria": [str],
    "non_goals": [str],
    "code_anchors": [str],
    "dependencies": [str],
    "validation_commands": [str],
    "working_directory?": str,
    "path_allowlist": [str],
    "untrusted_data": str,
}

ACTION_PROPOSAL = {
    "attempt_id": str,
    "epoch": int,
    "action": (
        "create_issue", "update_issue", "comment", "push_branch", "open_pr",
        "merge_pr", "request_human_task", "asset_request",
    ),
    "target": str,
    "payload": dict,
}

WORKER_RESULT = {
    "attempt_id": str,
    "epoch": int,
    "outcome": str,
    "changed_files": [str],
    "revision": str,
    "checks": [{"command": str, "exit_code": int}],
    "risks": [str],
    "blockers": [str],
    "next_action": str,
    "decision?": DELEGATOR_DECISION,
    "analysis?": ANALYSIS,
    "usage_estimate?": dict,
}

APPROVAL_RECORD = {
    "plan_id": str,
    "version": int,
    "digest": str,
    "approver": str,
    "approved_at": str,
    "authorized_operations": [str],
    "signature": str,
}

JOURNAL_EVENT = {
    "ts": float,
    "actor": str,
    "machine": str,
    "entity": str,
    "from_state": str,
    "to_state": str,
    "evidence": dict,
}
