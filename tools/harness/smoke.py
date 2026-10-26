"""Trusted browser checks. Rules say which changed paths need which smoke command. Workers cannot edit this file or the scripts it names:
the file is under tools/harness (a protected path) and the scripts are baked into the sandbox image."""
from __future__ import annotations

import json
import os
from typing import Any, Dict, Iterable, List, Optional

DEFAULT_RULES = os.path.join(os.path.dirname(__file__), "smoke.json")


def load_rules(path: Optional[str] = None) -> List[Dict[str, Any]]:
    with open(path or DEFAULT_RULES, encoding="utf-8") as fh:
        rules = json.load(fh)["rules"]
    for r in rules:
        if not r.get("paths") or not isinstance(r.get("command"), str) or not r["command"].strip():
            raise ValueError("smoke rule %r needs paths and a command" % r.get("name"))
    return rules


def _norm(p: str) -> str:
    return os.path.normpath(p).replace(os.sep, "/")


def commands_for(paths: Iterable[str], rules: List[Dict[str, Any]]) -> List[str]:
    """Smoke commands for a set of changed files. A rule applies when any changed file is under one of its paths."""
    out: List[str] = []
    for rule in rules:
        prefixes = [_norm(p).rstrip("/") + "/" for p in rule["paths"]]
        if any(_norm(f) + "/" == pre or (_norm(f) + "/").startswith(pre) or _norm(f).startswith(pre) for f in paths for pre in prefixes):
            if rule["command"] not in out:
                out.append(rule["command"])
    return out


def commands_for_allowlist(allowlist: Iterable[str], rules: List[Dict[str, Any]]) -> List[str]:
    """Smoke commands for a phase: every rule whose paths overlap what the phase may change."""
    out: List[str] = []
    for rule in rules:
        prefixes = [_norm(p).rstrip("/") + "/" for p in rule["paths"]]
        for entry in allowlist:
            e = _norm(entry).rstrip("/") + "/"
            if any(e.startswith(pre) or pre.startswith(e) for pre in prefixes) and rule["command"] not in out:
                out.append(rule["command"])
    return out


def merge(commands: List[str], extra: List[str]) -> List[str]:
    return list(commands) + [c for c in extra if c not in commands]
