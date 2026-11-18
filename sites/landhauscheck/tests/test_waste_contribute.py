"""Tests for the /api/v1/waste/contribute endpoint.

The tests cover:
  - ICS validation helpers (pure-function unit tests, no HTTP)
  - Endpoint integration tests via FastAPI TestClient
  - 503 when GITHUB_TOKEN is absent (default CI environment)
  - 422 on missing lat/lng or invalid ICS content
  - 413 on oversized files
  - Update flow: pending_update status when existing paths are found
  - _list_matching_paths helper (mocked GitHub response)
  - _open_deletion_pr helper (mocked GitHub calls)

  - The pending-contribution cap (overall and per location) and its fail-closed path
  - The review script posting a COMMENT review and never merging

GitHub PR creation is not exercised in unit tests — that requires a live PAT
and would create real branches. It is covered by manual smoke testing.
"""

import io
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from app.api.routes.waste_contribute import (
    _count_future_events,
    _extract_cal_name,
    _inject_geo_headers,
    _list_matching_paths,
    _open_deletion_pr,
    _unfold,
    _validate_and_process,
)
from app.main import app

client = TestClient(app)

# ── Minimal valid ICS fixture ──────────────────────────────────────────────────

_MINIMAL_ICS = """\
BEGIN:VCALENDAR
VERSION:2.0
CALSCALE:GREGORIAN
X-WR-CALNAME:Test Calendar
BEGIN:VEVENT
DTSTART;VALUE=DATE:20991231
SUMMARY:Restmüll
END:VEVENT
END:VCALENDAR
"""

_PAST_ONLY_ICS = """\
BEGIN:VCALENDAR
VERSION:2.0
CALSCALE:GREGORIAN
BEGIN:VEVENT
DTSTART;VALUE=DATE:20000101
SUMMARY:Restmüll
END:VEVENT
END:VCALENDAR
"""

_NO_VEVENT_ICS = """\
BEGIN:VCALENDAR
VERSION:2.0
CALSCALE:GREGORIAN
END:VCALENDAR
"""


# ── Unit tests: pure helpers ───────────────────────────────────────────────────


def test_unfold_removes_crlf_continuations():
    folded = "SUMMARY:Long\r\n value\r\n continuation"
    assert _unfold(folded) == "SUMMARY:Longvaluecontinuation"


def test_extract_cal_name_reads_x_wr_calname():
    raw = "BEGIN:VCALENDAR\nX-WR-CALNAME:Abfuhrkalender 2026\nEND:VCALENDAR"
    assert _extract_cal_name(raw) == "Abfuhrkalender 2026"


def test_extract_cal_name_falls_back_to_default():
    raw = "BEGIN:VCALENDAR\nEND:VCALENDAR"
    assert _extract_cal_name(raw) == "UserContribution"


def test_count_future_events_counts_correctly():
    # One event in the future (year 2099 is always future)
    count = _count_future_events(_unfold(_MINIMAL_ICS))
    assert count == 1


def test_count_future_events_excludes_past():
    count = _count_future_events(_unfold(_PAST_ONLY_ICS))
    assert count == 0


def test_inject_geo_headers_adds_custom_props():
    processed = _inject_geo_headers(_MINIMAL_ICS, lat=47.1234, lng=11.5678, location_name="TestOrt")
    assert "X-WR-GEO-LAT:47.123400" in processed
    assert "X-WR-GEO-LNG:11.567800" in processed
    assert "X-WR-LOCATION-NAME:TestOrt" in processed


def test_inject_geo_headers_strips_existing_geo_props():
    with_geo = _MINIMAL_ICS + "X-WR-GEO-LAT:99.0\nX-WR-GEO-LNG:99.0\n"
    processed = _inject_geo_headers(with_geo, 47.0, 11.0, "Ort")
    assert processed.count("X-WR-GEO-LAT:") == 1
    assert "X-WR-GEO-LAT:47.000000" in processed


def test_validate_and_process_returns_tuple_for_valid_ics():
    processed, cal_name, fut = _validate_and_process(_MINIMAL_ICS, lat=47.0, lng=11.0)
    assert "BEGIN:VCALENDAR" in processed
    assert cal_name == "Test Calendar"
    assert fut >= 1


def test_validate_and_process_rejects_no_vcalendar():
    with pytest.raises(ValueError, match="BEGIN:VCALENDAR"):
        _validate_and_process("NOT AN ICS FILE", 47.0, 11.0)


def test_validate_and_process_rejects_no_vevent():
    with pytest.raises(ValueError, match="VEVENT"):
        _validate_and_process(_NO_VEVENT_ICS, 47.0, 11.0)


def test_validate_and_process_rejects_past_only():
    with pytest.raises(ValueError, match="No upcoming events"):
        _validate_and_process(_PAST_ONLY_ICS, 47.0, 11.0)


def test_validate_and_process_rejects_binary_content():
    with pytest.raises(ValueError, match="Binary content"):
        _validate_and_process("BEGIN:VCALENDAR\x00END:VCALENDAR", 47.0, 11.0)


# ── Integration tests: endpoint ────────────────────────────────────────────────


def test_contribute_missing_lat_returns_422():
    f = io.BytesIO(_MINIMAL_ICS.encode())
    r = client.post(
        "/api/v1/waste/contribute?lng=11.0",
        files={"file": ("test.ics", f, "text/calendar")},
    )
    assert r.status_code == 422


def test_contribute_missing_lng_returns_422():
    f = io.BytesIO(_MINIMAL_ICS.encode())
    r = client.post(
        "/api/v1/waste/contribute?lat=47.0",
        files={"file": ("test.ics", f, "text/calendar")},
    )
    assert r.status_code == 422


def test_contribute_no_github_token_returns_503():
    """Without GITHUB_TOKEN the endpoint must return 503 gracefully — not 500."""
    f = io.BytesIO(_MINIMAL_ICS.encode())
    r = client.post(
        "/api/v1/waste/contribute?lat=47.0&lng=11.0",
        files={"file": ("test.ics", f, "text/calendar")},
    )
    assert r.status_code == 503
    assert "not yet active" in r.json()["detail"].lower() or r.status_code == 503


def test_contribute_past_only_ics_returns_422():
    f = io.BytesIO(_PAST_ONLY_ICS.encode())
    r = client.post(
        "/api/v1/waste/contribute?lat=47.0&lng=11.0",
        files={"file": ("test.ics", f, "text/calendar")},
    )
    assert r.status_code == 422


def test_contribute_no_vevent_returns_422():
    f = io.BytesIO(_NO_VEVENT_ICS.encode())
    r = client.post(
        "/api/v1/waste/contribute?lat=47.0&lng=11.0",
        files={"file": ("test.ics", f, "text/calendar")},
    )
    assert r.status_code == 422


def test_contribute_oversized_file_returns_413():
    # Construct a payload that is 1 byte over the 1 MiB limit
    big_content = ("X" * 1_048_577).encode()
    f = io.BytesIO(big_content)
    r = client.post(
        "/api/v1/waste/contribute?lat=47.0&lng=11.0",
        files={"file": ("big.ics", f, "text/calendar")},
    )
    assert r.status_code == 413


def test_contribute_valid_ics_with_token_creates_pr():
    """With a mocked GitHub token, mocked _list_matching_paths and mocked _open_pr,
    expect 200 + pending_review (no existing paths → new contribution)."""
    def mock_get_settings():
        from app.core.config import Settings

        class FakeSettings(Settings):
            github_token: str = "ghp_fake_token_for_testing"
            github_repo: str = "owner/repo"

        return FakeSettings()

    with (
        patch("app.api.routes.waste_contribute.get_settings", mock_get_settings),
        patch("app.api.routes.waste_contribute._pending_contribution_branches", return_value=[]),
        patch("app.api.routes.waste_contribute._list_matching_paths", return_value=[]),
        patch(
            "app.api.routes.waste_contribute._open_pr",
            return_value="https://github.com/owner/repo/pull/99",
        ),
    ):
        f = io.BytesIO(_MINIMAL_ICS.encode())
        r = client.post(
            "/api/v1/waste/contribute?lat=47.8894&lng=11.4967",
            files={"file": ("calendar.ics", f, "text/calendar")},
        )

    assert r.status_code == 200
    data = r.json()
    assert data["status"] == "pending_review"
    assert "github.com" in data["pr_url"]
    assert data["events"] >= 1


def test_contribute_existing_file_returns_pending_update():
    """When _list_matching_paths finds an existing file, status should be pending_update."""
    def mock_get_settings():
        from app.core.config import Settings

        class FakeSettings(Settings):
            github_token: str = "ghp_fake_token_for_testing"
            github_repo: str = "owner/repo"

        return FakeSettings()

    existing = ["sites/landhauscheck/app/data/waste/2025_OldCal_47.8894_11.4967.ics"]

    with (
        patch("app.api.routes.waste_contribute.get_settings", mock_get_settings),
        patch("app.api.routes.waste_contribute._pending_contribution_branches", return_value=[]),
        patch("app.api.routes.waste_contribute._list_matching_paths", return_value=existing),
        patch(
            "app.api.routes.waste_contribute._open_pr",
            return_value="https://github.com/owner/repo/pull/100",
        ),
    ):
        f = io.BytesIO(_MINIMAL_ICS.encode())
        r = client.post(
            "/api/v1/waste/contribute?lat=47.8894&lng=11.4967",
            files={"file": ("calendar.ics", f, "text/calendar")},
        )

    assert r.status_code == 200
    data = r.json()
    assert data["status"] == "pending_update"
    assert "github.com" in data["pr_url"]


def test_list_matching_paths_returns_matching_files():
    """Strategy 1: filename-suffix match should return the file."""
    fake_items = [
        {"name": "2025_Test_47.1234_11.5678.ics",
         "path": "sites/landhauscheck/app/data/waste/2025_Test_47.1234_11.5678.ics"},
        {"name": "2025_Other_48.0000_12.0000.ics",
         "path": "sites/landhauscheck/app/data/waste/2025_Other_48.0000_12.0000.ics"},
    ]
    # Strategy 1 call returns the list; strategy 2 search returns no items.
    def fake_gh(method, path, token, body=None):
        if "/contents/" in path:
            return fake_items
        # code-search call — return empty results
        return {"items": []}

    with patch("app.api.routes.waste_contribute._gh", side_effect=fake_gh):
        result = _list_matching_paths("token", "owner/repo", lat=47.1234, lng=11.5678)
    assert result == ["sites/landhauscheck/app/data/waste/2025_Test_47.1234_11.5678.ics"]


def test_list_matching_paths_content_search_fallback():
    """Strategy 2: code-search fallback detects files without lat/lng in filename."""
    import base64 as _b64

    manual_path = "sites/landhauscheck/app/data/waste/ManualCalendar-2026.ics"
    ics_raw = (
        "BEGIN:VCALENDAR\nCALSCALE:GREGORIAN\n"
        "X-WR-GEO-LAT:47.1234\nX-WR-GEO-LNG:11.5678\nEND:VCALENDAR"
    )
    encoded = _b64.b64encode(ics_raw.encode()).decode()

    def fake_gh(method, path, token, body=None):
        if "/contents/sites/landhauscheck/app/data/waste" in path and "ManualCalendar" not in path:
            # Strategy 1: directory listing — no suffix match
            return [{"name": "ManualCalendar-2026.ics", "path": manual_path}]
        if "/search/code" in path:
            return {"items": [{"path": manual_path}]}
        if "/contents/" in path and "ManualCalendar" in path:
            # Strategy 2 file fetch
            return {"content": encoded}
        return {}

    with patch("app.api.routes.waste_contribute._gh", side_effect=fake_gh):
        result = _list_matching_paths("token", "owner/repo", lat=47.1234, lng=11.5678)
    assert manual_path in result


def test_list_matching_paths_returns_empty_on_api_error():
    """If both strategies fail, _list_matching_paths returns []."""
    with patch("app.api.routes.waste_contribute._gh", side_effect=RuntimeError("404")):
        result = _list_matching_paths("token", "owner/repo", lat=47.1234, lng=11.5678)
    assert result == []


def test_open_deletion_pr_skips_if_branch_exists():
    """_open_deletion_pr should return None without creating a PR if branch exists."""
    # _gh returns a value (branch found) on the first GET call → no PR created
    with patch("app.api.routes.waste_contribute._gh", return_value={"object": {"sha": "abc"}}):
        result = _open_deletion_pr(
            "token", "owner/repo",
            "sites/landhauscheck/app/data/waste/2025_Test_47.1234_11.5678.ics",
            47.1234, 11.5678,
        )
    assert result is None


def test_open_deletion_pr_creates_pr_if_branch_missing():
    """_open_deletion_pr should create a PR when the branch does not exist yet."""
    call_count = 0

    def fake_gh(method: str, path: str, token: str, body=None):
        nonlocal call_count
        call_count += 1
        if method == "GET" and "ref/heads/waste/expire" in path:
            raise RuntimeError("GitHub 404: branch not found")
        # All other calls succeed with minimal stubs
        return {
            "object": {"sha": "aaa"},
            "sha": "bbb",
            "tree": {"sha": "ccc"},
            "html_url": "https://github.com/owner/repo/pull/42",
        }

    with patch("app.api.routes.waste_contribute._gh", side_effect=fake_gh):
        result = _open_deletion_pr(
            "token", "owner/repo",
            "sites/landhauscheck/app/data/waste/2025_Test_47.1234_11.5678.ics",
            47.1234, 11.5678,
        )
    assert result == "https://github.com/owner/repo/pull/42"


# ── Pending-contribution cap ─────────────────────────────────────────────────


def _token_settings():
    from app.core.config import Settings

    class FakeSettings(Settings):
        github_token: str = "ghp_fake_token_for_testing"
        github_repo: str = "owner/repo"

    return FakeSettings()


def _post_contribution(pending=None, pending_error=None, open_pr=None):
    target = "app.api.routes.waste_contribute._pending_contribution_branches"
    pending_patch = (
        patch(target, side_effect=pending_error)
        if pending_error
        else patch(target, return_value=pending or [])
    )
    pr_url = "https://github.com/owner/repo/pull/1"
    open_pr_patch = patch(
        "app.api.routes.waste_contribute._open_pr",
        **({"side_effect": open_pr} if isinstance(open_pr, Exception)
           else {"return_value": pr_url}),
    )
    with (
        patch("app.api.routes.waste_contribute.get_settings", _token_settings),
        pending_patch,
        patch("app.api.routes.waste_contribute._list_matching_paths", return_value=[]),
        open_pr_patch as opened,
    ):
        r = client.post(
            "/api/v1/waste/contribute?lat=47.8894&lng=11.4967",
            files={"file": ("calendar.ics", io.BytesIO(_MINIMAL_ICS.encode()), "text/calendar")},
        )
    return r, opened


def test_contribute_refuses_when_too_many_are_pending():
    from app.api.routes.waste_contribute import _MAX_PENDING_CONTRIBUTIONS

    pending = [f"waste/contrib-1.{i:04d}_2.0000-{i}" for i in range(_MAX_PENDING_CONTRIBUTIONS)]
    r, opened = _post_contribution(pending=pending)
    assert r.status_code == 429
    opened.assert_not_called()


def test_contribute_refuses_a_second_pending_upload_for_the_same_location():
    r, opened = _post_contribution(pending=["waste/update-47.8894_11.4967-1700000000"])
    assert r.status_code == 409
    opened.assert_not_called()


def test_contribute_fails_closed_when_pending_prs_cannot_be_counted():
    r, opened = _post_contribution(pending_error=RuntimeError("GitHub 500: boom"))
    assert r.status_code == 503
    opened.assert_not_called()


def test_contribute_does_not_leak_github_error_text():
    r, _ = _post_contribution(open_pr=RuntimeError("GitHub 422: secret-ish detail"))
    assert r.status_code == 502
    assert "secret-ish" not in r.text
    assert "GitHub 422" not in r.text


def test_pending_contribution_branches_counts_only_contribution_prs():
    from app.api.routes.waste_contribute import _pending_contribution_branches

    pulls = [
        {"head": {"ref": "waste/contrib-47.8894_11.4967-1"}},
        {"head": {"ref": "waste/update-48.0000_11.0000-2"}},
        {"head": {"ref": "waste/expire-2025_Old"}},
        {"head": {"ref": "feat/something"}},
    ]
    with patch("app.api.routes.waste_contribute._gh", return_value=pulls):
        assert _pending_contribution_branches("t", "owner/repo") == [
            "waste/contrib-47.8894_11.4967-1",
            "waste/update-48.0000_11.0000-2",
        ]


def test_pending_contribution_branches_raises_on_unexpected_payload():
    from app.api.routes.waste_contribute import _pending_contribution_branches

    with patch("app.api.routes.waste_contribute._gh", return_value={"message": "Bad credentials"}):
        with pytest.raises(RuntimeError):
            _pending_contribution_branches("t", "owner/repo")


# ── Review script never merges ───────────────────────────────────────────────


def _load_review_script():
    import importlib.util
    from pathlib import Path

    path = Path(__file__).resolve().parents[1] / "scripts" / "review_waste_pr.py"
    spec = importlib.util.spec_from_file_location("review_waste_pr", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_review_passing_calendar_is_a_comment_not_an_approval():
    review = _load_review_script()
    body, event = review._build_review(
        [{"path": "x.ics", "issues": [], "normalizations": [], "future_events": 3}], [], []
    )
    assert event == "COMMENT"
    assert "merge by hand" in body


def test_review_script_never_calls_the_merge_api(monkeypatch, tmp_path):
    review = _load_review_script()
    calls = []

    def fake_gh(method, path, token, body=None):
        calls.append((method, path))
        return {}

    ics = tmp_path / "2026_Test_47.8894_11.4967.ics"
    geo = "CALSCALE:GREGORIAN\nX-WR-GEO-LAT:47.8894\nX-WR-GEO-LNG:11.4967\n"
    ics.write_text(_MINIMAL_ICS.replace("CALSCALE:GREGORIAN\n", geo))

    def fake_git(*args):
        if args[0] == "diff":
            return f"A\t{ics}"
        return ""

    monkeypatch.setattr(review, "_gh", fake_gh)
    monkeypatch.setattr(review, "_git", fake_git)
    monkeypatch.setattr(review, "_find_nearby_files", lambda *a, **k: [])
    env = {"GH_TOKEN": "t", "REPO": "owner/repo", "PR_NUMBER": "7", "HEAD_REF": "waste/contrib-x"}
    for key, value in env.items():
        monkeypatch.setenv(key, value)

    assert review.main() == 0
    assert ("POST", "/repos/owner/repo/pulls/7/reviews") in calls
    assert not any(path.endswith("/merge") or method == "DELETE" for method, path in calls)
