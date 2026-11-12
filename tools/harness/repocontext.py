"""Repository context cache for the investigator.

Every investigator attempt re-reads the repository from scratch: an attempt costs ten to fifteen minutes of shell
calls before it writes the first line of a plan. Most of that reading repeats between attempts and between re-runs
of the same requirements file, because the worker always clones the same base commit.

This module keeps that reading. A context entry is a compact, owner-reviewable summary of the repository at one
exact commit (layout, module roles, verified commands, traps), plus a tracked-file index. Trusted code decides
reuse: the entry is used only when the cache key matches the base commit, the requirements text and the prompt, so a
re-used context is never a stale one. The model supplies the summary; this module trims it to fixed caps so one
verbose answer cannot inflate every later packet.
"""
from __future__ import annotations

import hashlib
import json
import os
import subprocess
from typing import Any, Dict, List, Optional

CACHE_VERSION = 1
CACHE_DIRNAME = "repo-context"
MAX_SUMMARY = 4000
MAX_MODULES = 60
MAX_COMMANDS = 20
MAX_CAVEATS = 20
MAX_INDEX = 1500
MAX_FIELD = 300


def prompt_digest(prompt: str) -> str:
    return hashlib.sha256(("%d\n%s" % (CACHE_VERSION, prompt)).encode("utf-8")).hexdigest()[:16]


def _head(repo: Any) -> str:
    try:
        return str(repo.base_head() or "").strip()
    except Exception:  # noqa: BLE001 - a repo double without a head simply disables reuse
        return ""


def context_key(repo: Any, requirements_text: str, prompt: str) -> Dict[str, str]:
    """Identity of one repository reading. Nothing is reused unless every part matches."""
    return {
        "base": _head(repo),
        "requirements": hashlib.sha256(requirements_text.encode("utf-8")).hexdigest()[:16],
        "prompt": prompt_digest(prompt),
        "version": str(CACHE_VERSION),
    }


def key_digest(key: Dict[str, str]) -> str:
    material = "|".join("%s=%s" % (k, key[k]) for k in sorted(key))
    return hashlib.sha256(material.encode("utf-8")).hexdigest()[:24]


def _path(home: str, key: Dict[str, str]) -> str:
    return os.path.join(home, CACHE_DIRNAME, key_digest(key) + ".json")


def load(home: Optional[str], key: Dict[str, str]) -> Optional[Dict[str, Any]]:
    """Return the cached entry for this exact key, or None. A corrupt or mismatched file reads as absent."""
    if not home:
        return None
    try:
        with open(_path(home, key)) as fh:
            payload = json.load(fh)
    except (OSError, ValueError):
        return None
    if payload.get("key") != key:
        return None
    entry = normalize_entry(payload.get("context"))
    if entry is None:
        return None
    entry["base"] = key.get("base", "")
    return entry


def save(home: Optional[str], key: Dict[str, str], context: Any) -> Optional[Dict[str, Any]]:
    """Persist a validated entry. Returns the normalized entry, or None when there was nothing usable to keep."""
    entry = normalize_entry(context)
    if entry is None or not home:
        return entry
    target = _path(home, key)
    try:
        os.makedirs(os.path.dirname(target), exist_ok=True)
        tmp = target + ".tmp"
        with open(tmp, "w") as fh:
            json.dump({"key": key, "context": entry}, fh, indent=1, sort_keys=True)
        os.replace(tmp, target)
    except OSError:
        return entry
    return entry


def normalize_entry(raw: Any) -> Optional[Dict[str, Any]]:
    """Trim one model-written context to the documented shape. No summary means no entry."""
    if not isinstance(raw, dict):
        return None
    summary = raw.get("summary")
    if not isinstance(summary, str) or not summary.strip():
        return None
    entry: Dict[str, Any] = {"summary": summary.strip()[:MAX_SUMMARY]}
    modules = []
    for item in raw.get("modules") or []:
        if not isinstance(item, dict):
            continue
        path = item.get("path")
        if not isinstance(path, str) or not path.strip():
            continue
        role = item.get("role") if isinstance(item.get("role"), str) else ""
        modules.append({"path": path.strip()[:MAX_FIELD], "role": role.strip()[:MAX_FIELD]})
        if len(modules) >= MAX_MODULES:
            break
    if modules:
        entry["modules"] = modules
    for name, cap in (("commands", MAX_COMMANDS), ("caveats", MAX_CAVEATS)):
        values = [v.strip()[:MAX_FIELD] for v in (raw.get(name) or []) if isinstance(v, str) and v.strip()]
        if values:
            entry[name] = values[:cap]
    return entry


def file_index(repo: Any, rev: str = "", limit: int = MAX_INDEX) -> List[str]:
    """Tracked file paths at `rev`, or an empty list when the repository is not a git checkout (e.g. a test double)."""
    path = getattr(repo, "path", "")
    if not path or not os.path.isdir(path):
        return []
    try:
        result = subprocess.run(["git", "-C", path, "ls-tree", "-r", "--name-only", rev or "HEAD"],
                                capture_output=True, text=True,
                                env={"PATH": os.environ.get("PATH", ""), "GIT_CONFIG_GLOBAL": os.devnull})
    except OSError:
        return []
    if result.returncode != 0:
        return []
    return [line for line in result.stdout.splitlines() if line][:limit]


def packet_context(entry: Optional[Dict[str, Any]], index: Optional[List[str]] = None) -> Dict[str, Any]:
    """The part of the worker packet that carries the cache. Empty when there is nothing to reuse."""
    packet: Dict[str, Any] = {}
    if entry:
        packet["repo_context"] = {k: v for k, v in entry.items() if k != "base"}
        packet["repo_context_base"] = entry.get("base", "")
    if index:
        packet["repo_file_index"] = index
    return packet
