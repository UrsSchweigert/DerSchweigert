"""The split-pressure rule is arithmetic, not an opinion: facts in, reasons out."""

from harness import sizing


def issue(**fields):
    base = {"issue_id": "i1", "requirement_ids": ["R1"], "code_anchors": ["a.js"], "acceptance_criteria": ["a"]}
    base.update(fields)
    return base


def sizes(mapping):
    return lambda path: mapping.get(path, 0)


def test_a_small_single_purpose_task_carries_no_pressure():
    report = sizing.split_pressure(issue(), sizes({"a.js": 2000}))

    assert report["split_recommended"] is False and report["reasons"] == []
    assert report["facts"] == {"files": 1, "bytes": 2000, "areas": ["a.js"], "requirements": 1, "acceptance_criteria": 1}


def test_a_large_file_carries_pressure():
    report = sizing.split_pressure(issue(), sizes({"a.js": 200000}))

    assert report["split_recommended"] and "200000 bytes" in report["reasons"][0]


def test_many_files_and_areas_carry_pressure():
    anchors = ["sites/lesen/static/a.js", "sites/lesen/tests/c.mjs", "tools/x.js", "infra/y.yml"]
    report = sizing.split_pressure(issue(code_anchors=anchors), sizes({path: 100 for path in anchors}))

    assert report["split_recommended"]
    assert any("4 files" in reason for reason in report["reasons"])
    assert any("3 separate areas: infra, sites/lesen, tools" in reason for reason in report["reasons"])


def test_several_requirements_or_criteria_carry_pressure():
    report = sizing.split_pressure(issue(requirement_ids=["R1", "R2"], acceptance_criteria=["a"] * 8), sizes({}))

    assert any("2 requirements" in reason for reason in report["reasons"])
    assert any("8 acceptance criteria" in reason for reason in report["reasons"])


def test_the_rule_is_off_unless_the_policy_enables_it_and_limits_are_configurable():
    big = issue(code_anchors=["src/a.js", "src/b.js", "src/c.js", "src/d.js"], requirement_ids=["R1", "R2"])

    assert sizing.enabled(None) is False and sizing.enabled({}) is False
    assert sizing.enabled({"split_pressure": {"enabled": True}}) is True
    loose = {"split_pressure": {"enabled": True, "max_files": 10, "max_requirements": 5}}
    assert sizing.split_pressure(big, sizes({}), loose)["split_recommended"] is False
