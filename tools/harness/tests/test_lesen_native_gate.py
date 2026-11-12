import os
import re
from pathlib import Path
import subprocess
import textwrap

import pytest


WORKFLOW = Path(__file__).resolve().parents[3] / ".github/workflows/buchstabenzeit-native.yml"


@pytest.mark.parametrize("android,ios,passed", [
    ("success", "success", True),
    ("success", "skipped", False),
    ("success", "failure", False),
    ("failure", "success", False),
    ("skipped", "success", False),
    ("", "success", False),
])
def test_native_ci_gate_fails_closed(android, ios, passed):
    gate = WORKFLOW.read_text().split("\n  lesen-native:\n", 1)[1]
    script = textwrap.dedent(gate.split("        run: |\n", 1)[1])
    result = subprocess.run(["bash", "-c", script], env=dict(
        os.environ, ANDROID=android, IOS=ios),
        capture_output=True, text=True)
    assert (result.returncode == 0) is passed


def test_native_ci_runs_after_a_merge_to_main_only():
    workflow = WORKFLOW.read_text()
    assert "\n  push:\n    branches: [main]\n" in workflow
    assert "\n  pull_request:" not in workflow
    assert "\npermissions:\n  contents: read\n" in workflow
    assert workflow.count("timeout-minutes: 30") == 2
    # Third-party action majors are deliberately not pinned here. A dependency bump arrives as its own reviewed pull
    # request, and a test that fails on every one of them teaches people to edit the pin without reading the diff.
    # What must hold is the shape of the gate: two checkouts, the Android SDK package the build needs, and no path
    # that lets the aggregate report success without the builds.
    assert len(re.findall(r"uses: actions/checkout@v\d+", workflow)) == 2
    assert "CODE_SIGNING_ALLOWED=NO" in workflow
    assert "needs: [android, ios]\n    if: always()" in workflow
    assert re.search(r"uses: android-actions/setup-android@v\d+\n\s+with:\n\s+packages: platform-tools", workflow)
