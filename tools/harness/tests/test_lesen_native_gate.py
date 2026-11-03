import os
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
        os.environ, CHANGES=changes, NEEDED=needed, ANDROID=android, IOS=ios),
        capture_output=True, text=True)
    assert (result.returncode == 0) is passed


def test_native_ci_is_unsigned_revision_bound_and_has_a_bounded_build_budget():
    workflow = WORKFLOW.read_text()
    assert "pull_request:\n    branches: ['harness/run/**']" in workflow
    assert "permissions:\n  contents: read\n  pull-requests: read" in workflow
    assert workflow.count("timeout-minutes: 30") == 2
    assert workflow.count("uses: actions/checkout@v4") == 2
    assert "CODE_SIGNING_ALLOWED=NO" in workflow
    assert "needs: [changes, android, ios]\n    if: always()" in workflow
    assert "uses: android-actions/setup-android@v3\n        with:\n          packages: platform-tools" in workflow
