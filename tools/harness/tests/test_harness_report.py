"""The status page: what it says, where it may be written, and that a publishing problem never reaches the run."""
import os

import pytest

from harness import report


def test_the_page_names_the_plan_its_phases_and_what_is_running(tmp_path):
    from harness_doubles import Env
    env = Env(tmp_path, issues=[("i1", "P1", ["F1.1"])])
    env.start()
    env.adapter.script("i1", "implementer", "busy")
    env.tick(1)
    text = report.page(env.store.home, "fx", now=env.clock())
    assert text.startswith("# fx")
    assert "| Plan | v1, **Executing**" in text
    assert "| P1 | Active |" in text
    assert "i1#1" in text and "implementer" in text  # the working-now table
    assert "never merged" in text


def test_the_page_reports_an_idle_run_without_inventing_workers(tmp_path):
    from harness_doubles import Env
    env = Env(tmp_path)
    env.start()
    report_mod_text = report.page(env.store.home, "fx", now=env.clock())
    assert "Nothing is running." in report_mod_text


def test_the_status_page_is_only_written_to_its_own_branch():
    assert report.status_branch("20261028-arithmoslayer-md") == "harness/status/20261028-arithmoslayer-md"
    assert report.status_branch("Plan/With Weird Chars!") == "harness/status/plan-with-weird-chars"
    for refused in ("main", "harness/run/x", "harness/p1-thing", "refs/heads/main", "harness/status/../main"):
        with pytest.raises(report.StatusRefused):
            report._checked_branch(refused)


def test_the_page_carries_no_home_directory_and_no_token():
    token = "ghp_" + "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8"
    text = report.redact("clone failed in %s/repo with %s" % (os.path.expanduser("~"), token))
    assert os.path.expanduser("~") not in text
    assert text.startswith("clone failed in ~/repo")
    assert token not in text and "<redacted>" in text


def test_an_unchanged_run_is_not_pushed_again(tmp_path):
    from harness_doubles import Env
    env = Env(tmp_path, issues=[("i1", "P1", ["F1.1"])])
    env.start()
    first = report.publish_once(env.store.home, "fx", None, None, now=env.clock())
    second = report.publish_once(env.store.home, "fx", None, None, now=env.clock() + 300)
    assert first["changed"] is True and first["pushed"] is False  # no repo: kept locally only
    assert second["changed"] is False
    assert os.path.exists(first["path"]) and first["path"].endswith("status-fx.md")


def test_a_publishing_problem_is_reported_and_never_raised(tmp_path, monkeypatch):
    from harness_doubles import Env
    env = Env(tmp_path)
    env.start()

    def boom(*_a, **_k):
        raise report.StatusRefused("push of harness/status/fx failed: no space left")

    monkeypatch.setattr(report, "publish", boom)
    result = report.publish_once(env.store.home, "fx", "owner/name", None, now=env.clock())
    assert result["error"].startswith("StatusRefused: push of harness/status/fx failed")
    assert result["pushed"] is False
    assert os.path.exists(result["path"])  # the local copy is still there


def test_watch_stops_after_one_pass_and_reports_the_result(tmp_path, capsys):
    from harness_doubles import Env
    env = Env(tmp_path)
    env.start()
    assert report.watch(env.store.home, "fx", None, None, 300, once=True) == 0
    assert "status:" in capsys.readouterr().out
