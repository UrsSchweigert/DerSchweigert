"""A validation command must be able to fail; a trailing `|| true` makes the check meaningless."""

import pytest

from harness import plans


@pytest.mark.parametrize("command", [
    'cd sites/lesen && node --test tests/*.test.mjs || true',
    'node --test tests/a.test.mjs || :',
    'node --test tests/a.test.mjs; true',
    'node --test tests/a.test.mjs || exit 0',
    'node --test tests/a.test.mjs ||   true   ',
])
def test_a_check_that_swallows_failure_is_refused(command):
    problem = plans.command_problem(command)

    assert problem and "can never report a failure" in problem


@pytest.mark.parametrize("command", [
    'node --test tests/a.test.mjs',
    'node --test tests/a.test.mjs && node tools/build.mjs --check',
    'node --test tests/a.test.mjs || echo "checks failed"',
])
def test_a_check_that_can_fail_is_accepted(command):
    assert plans.command_problem(command) is None
