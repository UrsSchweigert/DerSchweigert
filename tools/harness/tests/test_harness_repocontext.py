import copy
import json
import os

from harness import investigate, plans, repocontext
from harness_doubles import FakeRepo
from test_harness_investigate import FakeInvestigatorAdapter, good_draft, make, mutate, run, REQ

PROMPT = investigate.PROMPT


def key(repo=None, text=None, prompt=PROMPT):
    with open(REQ) as fh:
        body = fh.read()
    return repocontext.context_key(repo or FakeRepo(), body if text is None else text, prompt)


def test_the_key_changes_with_the_commit_requirements_and_prompt():
    repo = FakeRepo()
    base = key(repo)
    repo.advance_base(["src/a.js"])
    assert key(repo) != base
    with open(REQ) as fh:
        body = fh.read()
    assert key(FakeRepo(), text=body + "\nextra") != base
    assert key(FakeRepo(), prompt=PROMPT + "\nchanged") != base


def test_an_entry_round_trips_and_is_capped(tmp_path):
    entry = {"summary": "s" * (repocontext.MAX_SUMMARY + 500),
             "modules": [{"path": "p%d" % i, "role": "r"} for i in range(repocontext.MAX_MODULES + 10)],
             "commands": ["c"] * (repocontext.MAX_COMMANDS + 5),
             "caveats": ["x"] * (repocontext.MAX_CAVEATS + 5)}
    repocontext.save(str(tmp_path), key(), entry)
    loaded = repocontext.load(str(tmp_path), key())
    assert len(loaded["summary"]) == repocontext.MAX_SUMMARY
    assert len(loaded["modules"]) == repocontext.MAX_MODULES
    assert len(loaded["commands"]) == repocontext.MAX_COMMANDS
    assert len(loaded["caveats"]) == repocontext.MAX_CAVEATS


def test_a_stale_key_never_reuses_an_entry(tmp_path):
    repocontext.save(str(tmp_path), key(), {"summary": "old"})
    repo = FakeRepo()
    repo.advance_base(["src/a.js"])
    assert repocontext.load(str(tmp_path), key(repo)) is None


def test_a_corrupt_or_summaryless_entry_reads_as_absent(tmp_path):
    key_ = key()
    path = os.path.join(str(tmp_path), repocontext.CACHE_DIRNAME, repocontext.key_digest(key_) + ".json")
    os.makedirs(os.path.dirname(path))
    with open(path, "w") as fh:
        fh.write("{not json")
    assert repocontext.load(str(tmp_path), key_) is None
    assert repocontext.normalize_entry({"modules": [{"path": "a", "role": "b"}]}) is None


def test_the_file_index_is_empty_without_a_git_checkout():
    assert repocontext.file_index(FakeRepo()) == []


def test_a_reading_from_a_rejected_attempt_is_reused_by_the_next_one(tmp_path):
    first = mutate(lambda d: d.update(repo_context={"summary": "game code lives in sites/ffm", "modules": [{"path": "sites/ffm/", "role": "game"}]}))
    first["issues"][0]["code_anchors"] = ["tools/harness/forbidden.py"]
    adapter = FakeInvestigatorAdapter(first, good_draft())
    res = run(make(adapter, cache_home=str(tmp_path)), tmp_path / "plan")
    assert res["status"] == "ok"
    assert adapter.packets[0].get("repo_context") is None
    assert adapter.packets[1]["repo_context"]["summary"] == "game code lives in sites/ffm"
    assert repocontext.load(str(tmp_path), key()) is not None


def test_a_reused_reading_is_dropped_when_the_base_commit_moves(tmp_path):
    repocontext.save(str(tmp_path), key(), {"summary": "reading of base1"})
    repo = FakeRepo()
    repo.advance_base(["src/a.js"])
    adapter = FakeInvestigatorAdapter(good_draft())
    res = run(make(adapter, repo=repo, cache_home=str(tmp_path)), tmp_path / "plan")
    assert res["status"] == "ok"
    assert adapter.packets[0].get("repo_context") is None
