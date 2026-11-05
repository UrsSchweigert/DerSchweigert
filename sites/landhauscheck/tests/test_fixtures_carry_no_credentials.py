"""Recorded fixtures are committed, so they must never carry a live credential.

The dev cache records the request URL it saw, and third-party APIs take their key in the query string. Redacting the
key by hand is not enough: the next `DEV_CACHE_MODE=record` run would put it back, and the repository is meant to
become public. `dev_cache` redacts the key when it writes the envelope and hashes the clean URL, so a redacted
fixture stays a valid cache entry; this test keeps a fixture that slipped through from being committed again.
"""

import json
import re
from pathlib import Path

import pytest

FIXTURES = Path(__file__).resolve().parents[1] / "app" / "data" / "fixtures"
CREDENTIAL = re.compile(r"[?&](?:key|apikey|api_key|apiKey|token|access_token)=([^&\"'\s]+)", re.IGNORECASE)
REDACTED = {"REDACTED", "redacted", ""}


def fixture_files() -> list[Path]:
    return sorted(FIXTURES.glob("*.json"))


def test_there_are_fixtures_to_check() -> None:
    assert fixture_files(), f"no fixtures found in {FIXTURES}"


@pytest.mark.parametrize("path", fixture_files(), ids=lambda p: p.name)
def test_a_recorded_url_carries_no_credential(path: Path) -> None:
    envelope = json.loads(path.read_text())
    url = (envelope.get("meta") or {}).get("url") or ""
    for value in CREDENTIAL.findall(url):
        assert value in REDACTED, (
            f"{path.name} records a credential in meta.url; run it through dev_cache's redaction and re-record "
            f"rather than committing the live value"
        )
