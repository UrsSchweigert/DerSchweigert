import os
import re
from pathlib import Path
import subprocess
import textwrap

import pytest


WORKFLOW = Path(__file__).resolve().parents[3] / ".github/workflows/lesen-native.yml"


@pytest.mark.parametrize("changes,needed,android,ios,passed", [
    ("success", "false", "skipped", "skipped", True),
    ("success", "true", "success", "success", True),
    ("success", "true", "", "success", False),
    ("success", "true", "pending", "success", False),
    ("success", "true", "success", "failure", False),
    ("success", "true", "success", "cancelled", False),
    ("success", "true", "success", "skipped", False),
    ("failure", "", "skipped", "skipped", False),
    ("success", "", "success", "success", False),
])
def test_native_ci_gate_fails_closed(changes, needed, android, ios, passed):
    gate = WORKFLOW.read_text().split("\n  lesen-native:\n", 1)[1]
    script = textwrap.dedent(gate.split("        run: |\n", 1)[1])
    result = subprocess.run(["bash", "-c", script], env=dict(
        os.environ, CHANGES=changes, NEEDED=needed, ANDROID=android, IOS=ios, NATIVE="true"),
        capture_output=True, text=True)
    assert (result.returncode == 0) is passed


@pytest.mark.parametrize("android,ios,passed", [
    ("success", "success", True),
    ("success", "skipped", True),  # no native input changed, so the macOS job is not owed
    ("success", "failure", True),  # a macOS job that should not have run cannot fail the gate
    ("failure", "skipped", False),
    ("skipped", "success", False),
])
def test_the_gate_only_owes_the_ios_build_when_native_inputs_changed(android, ios, passed):
    gate = WORKFLOW.read_text().split("\n  lesen-native:\n", 1)[1]
    script = textwrap.dedent(gate.split("        run: |\n", 1)[1])
    result = subprocess.run(["bash", "-c", script], env=dict(
        os.environ, CHANGES="success", NEEDED="true", ANDROID=android, IOS=ios, NATIVE="false"),
        capture_output=True, text=True)
    assert (result.returncode == 0) is passed


def test_native_ci_is_unsigned_revision_bound_and_has_a_bounded_build_budget():
    workflow = WORKFLOW.read_text()
    assert "pull_request:\n    branches: ['harness/run/**']" in workflow
    assert "permissions:\n  contents: read\n  pull-requests: read" in workflow
    assert workflow.count("timeout-minutes: 30") == 2
    # Third-party action majors are deliberately not pinned here. A dependency bump arrives as its own reviewed pull
    # request, and a test that fails on every one of them teaches people to edit the pin without reading the diff.
    # What must hold is the shape of the gate: two checkouts, the Android SDK package the build needs, and no path
    # that lets the aggregate report success without the builds.
    assert len(re.findall(r"uses: actions/checkout@v\d+", workflow)) == 2
    assert "CODE_SIGNING_ALLOWED=NO" in workflow
    assert "needs: [changes, android, ios]\n    if: always()" in workflow
    assert re.search(r"uses: android-actions/setup-android@v\d+\n\s+with:\n\s+packages: platform-tools", workflow)
