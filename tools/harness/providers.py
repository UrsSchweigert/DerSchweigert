"""Bring-your-own-key model providers (BYOK), stored beside the other harness secrets.

The worker runtime is the GitHub Copilot CLI. Its own routing only serves Copilot models, but it
supports a custom OpenAI-compatible endpoint through `COPILOT_PROVIDER_*` environment variables
(see `copilot help providers`). A provider profile records the endpoint and the key for one model
source, so `deepseek` and similar sources become usable without changing the runtime.

The key lives only in `<store>/providers.json` (mode 0600) and is forwarded to the worker by
environment-variable name, exactly like `copilot.token`.
"""
from __future__ import annotations

import json
import os
import tempfile
from typing import Any, Dict, Mapping, Optional

FILE = "providers.json"

# Environment names the Copilot CLI understands. Values are set per worker, never in the repo.
ENV_BASE_URL = "COPILOT_PROVIDER_BASE_URL"
ENV_TYPE = "COPILOT_PROVIDER_TYPE"
ENV_API_KEY = "COPILOT_PROVIDER_API_KEY"
ENV_WIRE_MODEL = "COPILOT_PROVIDER_WIRE_MODEL"
ENV_MODEL = "COPILOT_MODEL"
ENV_NAMES = (ENV_BASE_URL, ENV_TYPE, ENV_API_KEY, ENV_WIRE_MODEL, ENV_MODEL)

# Defaults for sources whose endpoint is well known. Override with `harness providers set --base-url`.
DEFAULT_BASE_URLS = {"deepseek": "https://api.deepseek.com"}
DEFAULT_TYPE = "openai"


def path(home: str) -> str:
    return os.path.join(home, FILE)


def load(home: Optional[str]) -> Dict[str, Dict[str, str]]:
    """Every configured profile. A missing, unreadable, or malformed file yields no profiles."""
    if not home:
        return {}
    try:
        with open(path(home), encoding="utf-8") as fh:
            doc = json.load(fh)
    except (OSError, ValueError):
        return {}
    if not isinstance(doc, dict):
        return {}
    profiles: Dict[str, Dict[str, str]] = {}
    for source, cfg in doc.items():
        if not isinstance(source, str) or not isinstance(cfg, dict):
            continue
        key = cfg.get("apiKey")
        if not isinstance(key, str) or not key.strip():
            continue
        base = cfg.get("baseUrl") or DEFAULT_BASE_URLS.get(source)
        if not isinstance(base, str) or not base.strip():
            continue
        kind = cfg.get("type") or DEFAULT_TYPE
        profiles[source] = {"baseUrl": base.strip(), "type": str(kind), "apiKey": key.strip()}
    return profiles


def save(home: str, source: str, *, api_key: str, base_url: Optional[str] = None, kind: Optional[str] = None) -> Dict[str, str]:
    """Write one profile, preserving the others. Atomic and 0600, like the token files."""
    api_key = (api_key or "").strip()
    if not api_key:
        raise ValueError("an API key is required")
    base = (base_url or DEFAULT_BASE_URLS.get(source, "")).strip()
    if not base:
        raise ValueError("a base URL is required for %r; pass --base-url" % source)
    if not base.startswith(("https://", "http://")):
        raise ValueError("base URL must be an http(s) URL")
    current = load(home)
    current[source] = {"baseUrl": base, "type": (kind or DEFAULT_TYPE).strip(), "apiKey": api_key}
    os.makedirs(home, mode=0o700, exist_ok=True)
    handle, tmp = tempfile.mkstemp(dir=home, prefix="providers-", suffix=".json")
    try:
        with os.fdopen(handle, "w", encoding="utf-8") as fh:
            json.dump(current, fh, indent=2, sort_keys=True)
            fh.write("\n")
        os.chmod(tmp, 0o600)
        os.replace(tmp, path(home))
    except BaseException:
        if os.path.exists(tmp):
            os.remove(tmp)
        raise
    return current[source]


def remove(home: str, source: str) -> bool:
    current = load(home)
    if source not in current:
        return False
    current.pop(source)
    with open(path(home), "w", encoding="utf-8") as fh:
        json.dump(current, fh, indent=2, sort_keys=True)
        fh.write("\n")
    os.chmod(path(home), 0o600)
    return True


def wire_model(model_id: str) -> str:
    """The name sent to the provider. Catalog ids may carry a `source/` prefix that is not part of it."""
    return model_id.split("/", 1)[1] if "/" in model_id else model_id


def env_for(home: Optional[str], source: Optional[str], model_id: str) -> Optional[Dict[str, str]]:
    """The BYOK environment for one model id, or None when the source has no profile."""
    if not source:
        return None
    profile = load(home).get(source)
    if not profile:
        return None
    wire = wire_model(model_id)
    return {ENV_BASE_URL: profile["baseUrl"], ENV_TYPE: profile["type"], ENV_API_KEY: profile["apiKey"],
            ENV_WIRE_MODEL: wire, ENV_MODEL: wire}


def names(provider: Optional[Mapping[str, str]]) -> list[str]:
    """The environment names to forward into the worker for one provider (values travel by name only)."""
    return list(provider) if provider else []


def redacted(home: Optional[str]) -> Dict[str, Dict[str, Any]]:
    """Profiles safe to print: the key is replaced by its length and last four characters."""
    out: Dict[str, Dict[str, Any]] = {}
    for source, cfg in load(home).items():
        key = cfg["apiKey"]
        out[source] = {"baseUrl": cfg["baseUrl"], "type": cfg["type"],
                       "apiKey": ("*" * max(0, len(key) - 4)) + key[-4:] if len(key) > 4 else "*" * len(key)}
    return out
