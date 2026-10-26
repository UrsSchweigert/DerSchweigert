"""The five state machines from docs/harness/state-machines.md. Illegal transitions raise."""
from __future__ import annotations


class IllegalTransition(Exception):
    pass


MACHINES = {
    "plan": {
        "Draft": {"Proposed", "Cancelled"},
        "Proposed": {"Draft", "Approved", "Cancelled"},
        "Approved": {"Executing", "Superseded", "Cancelled"},
        "Executing": {"Paused", "Completed", "Superseded", "Cancelled"},
        "Paused": {"Executing", "Superseded", "Cancelled"},
        "Completed": set(),
        "Superseded": set(),
        "Cancelled": set(),
    },
    "phase": {
        "Planned": {"Eligible", "Cancelled"},
        "Eligible": {"Active", "Cancelled"},
        "Active": {"Validating", "Blocked", "Cancelled"},
        "Validating": {"Active", "Done"},
        "Blocked": {"Active", "Cancelled"},
        "Done": set(),
        "Cancelled": set(),
    },
    "issue": {
        "Inbox": {"Refining"},
        "Refining": {"Ready", "Blocked"},
        "Ready": {"In Progress", "Refining", "Blocked"},
        "In Progress": {"In Review", "Ready", "Blocked"},
        "In Review": {"In Progress", "Done", "Blocked"},
        "Blocked": {"Refining", "Ready"},
        "Done": set(),
    },
    "human_task": {
        "Requested": {"Acknowledged", "Submitted", "Cancelled"},
        "Acknowledged": {"Submitted", "Cancelled"},
        "Submitted": {"Validated", "Acknowledged", "Requested", "Cancelled"},
        "Validated": {"Resolved"},
        "Resolved": set(),
        "Cancelled": set(),
    },
    "attempt": {
        "Claimed": {"Running", "Fenced", "Cancelled"},
        "Running": {"Succeeded", "Failed", "TimedOut", "Cancelled", "Fenced"},
        "Succeeded": set(),
        "Failed": set(),
        "TimedOut": set(),
        "Cancelled": set(),
        "Fenced": set(),
    },
}

INITIAL = {"plan": "Draft", "phase": "Planned", "issue": "Inbox", "human_task": "Requested", "attempt": "Claimed"}

# Entering these states records the previous state so recovery can return to it.
REMEMBER_PREVIOUS = {"Blocked", "Paused"}


def check_transition(machine: str, current: str, new: str) -> None:
    table = MACHINES.get(machine)
    if table is None:
        raise IllegalTransition("unknown machine %r" % machine)
    if current not in table:
        raise IllegalTransition("%s: unknown state %r" % (machine, current))
    if new not in table[current]:
        raise IllegalTransition("%s: %s -> %s is not allowed" % (machine, current, new))


def is_terminal(machine: str, state: str) -> bool:
    return not MACHINES[machine][state]
