"""A merge to main skips its test suites only when the merged tree is proven to be the tree its pull request tested.

deploy.yml's `changes` job decides that in two steps: `proof` asks GitHub, and `diff` drops the suites when the proof
holds. A wrong "yes" here deploys untested code to production, so these tests run the two shell scripts exactly as the
workflow carries them, against a fake `gh` that answers from a fixture.
"""
import json
import os
import shutil
import stat
import subprocess
import sys
import textwrap
from pathlib import Path

import pytest

WORKFLOW = (Path(__file__).resolve().parents[3] / '.github' / 'workflows' / 'deploy.yml').read_text()
REPO = 'owner/repo'
MERGE, HEAD, OTHER_HEAD, BEFORE = 'm' * 40, 'h' * 40, 'o' * 40, 'b' * 40
TREE, OTHER_TREE = 't' * 40, 'u' * 40
SUITES = ('test', 'test-ffm', 'test-lhc')

if not shutil.which('jq') or not shutil.which('bash'):
    # The scripts need both, and every CI runner has them. Skipping there would hide the whole guard.
    assert not os.environ.get('CI'), 'jq and bash are required to test the deploy gate'
    pytestmark = pytest.mark.skip(reason='jq and bash are needed to run the workflow scripts')

FAKE_GH = '''#!%s
"""Stands in for `gh api <path> [--jq <expr>]`: answers from the fixture, fails for a path it does not know."""
import json, os, subprocess, sys
args = sys.argv[1:]
world = json.load(open(os.environ["FAKE_GH_WORLD"]))
if args[0] != "api" or args[1] not in world:
    sys.exit(1)
body = json.dumps(world[args[1]])
if "--jq" in args:
    sys.exit(subprocess.run(["jq", "-r", args[args.index("--jq") + 1]], input=body, text=True).returncode)
print(body)
''' % sys.executable


def _step(step_id, next_marker):
    block = WORKFLOW[WORKFLOW.index('      - id: %s\n' % step_id):]
    block = block[:block.index(next_marker)]
    return block, textwrap.dedent(block[block.index('        run: |\n') + len('        run: |\n'):])


def _run(script, world, tmp_path, **env):
    gh = tmp_path / 'bin' / 'gh'
    gh.parent.mkdir(exist_ok=True)
    gh.write_text(FAKE_GH)
    gh.chmod(gh.stat().st_mode | stat.S_IEXEC)
    (tmp_path / 'world.json').write_text(json.dumps(world))
    out = tmp_path / 'output'
    out.write_text('')
    result = subprocess.run(
        ['bash', '-c', script], capture_output=True, text=True,
        env={'PATH': '%s%s%s' % (gh.parent, os.pathsep, os.environ['PATH']), 'FAKE_GH_WORLD': str(tmp_path / 'world.json'),
             'GITHUB_OUTPUT': str(out), 'REPO': REPO, **env})
    assert result.returncode == 0, result.stderr
    return dict(line.split('=', 1) for line in out.read_text().splitlines())


def _check(conclusion='success', app='github-actions'):
    return {'check_runs': [{'conclusion': conclusion, 'app': {'slug': app}}]}


def _world(**changes):
    """A pull request merged as MERGE, whose head has the merged tree and three green test checks."""
    world = {
        'repos/%s/git/commits/%s' % (REPO, MERGE): {'tree': {'sha': TREE}},
        'repos/%s/git/commits/%s' % (REPO, HEAD): {'tree': {'sha': TREE}},
        'repos/%s/commits/%s/pulls' % (REPO, MERGE): [
            {'merged_at': '2026-11-19T10:00:00Z', 'merge_commit_sha': MERGE, 'head': {'sha': HEAD}}],
    }
    for name in SUITES:
        world[_checks_path(name)] = _check()
    world.update(changes)
    return {path: body for path, body in world.items() if body is not None}


def _checks_path(name, head=HEAD):
    return 'repos/%s/commits/%s/check-runs?check_name=%s&filter=latest&per_page=100' % (REPO, head, name)


def _tested(world, tmp_path):
    _, script = _step('proof', '      - id: diff\n')
    return _run(script, world, tmp_path, HEAD_SHA=MERGE)['tested']


def test_a_merge_whose_tree_passed_on_its_pull_request_is_proven(tmp_path):
    assert _tested(_world(), tmp_path) == 'true'


@pytest.mark.parametrize('why, changes', [
    ('the merged tree is not the tested tree',
     {'repos/%s/git/commits/%s' % (REPO, HEAD): {'tree': {'sha': OTHER_TREE}}}),
    ('a suite failed on the pull request', {_checks_path('test-ffm'): _check('failure')}),
    ('a suite was skipped on the pull request', {_checks_path('test'): _check('skipped')}),
    ('a suite was cancelled on the pull request', {_checks_path('test-lhc'): _check('cancelled')}),
    ('a re-run of a suite is still going', {_checks_path('test-ffm'): _check(None)}),
    ('a suite never reported', {_checks_path('test-lhc'): {'check_runs': []}}),
    ('one of two reported runs failed',
     {_checks_path('test'): {'check_runs': _check()['check_runs'] + _check('failure')['check_runs']}}),
    ('the green check was not posted by GitHub Actions', {_checks_path('test-ffm'): _check(app='someone-elses-app')}),
    ('the commit was pushed without a pull request', {'repos/%s/commits/%s/pulls' % (REPO, MERGE): []}),
    ('the pull request is still open',
     {'repos/%s/commits/%s/pulls' % (REPO, MERGE): [{'merged_at': None, 'merge_commit_sha': MERGE, 'head': {'sha': HEAD}}]}),
    ('the commit only appears in a pull request that merged as another commit',
     {'repos/%s/commits/%s/pulls' % (REPO, MERGE): [
         {'merged_at': '2026-11-19T10:00:00Z', 'merge_commit_sha': OTHER_HEAD, 'head': {'sha': HEAD}}]}),
    ('GitHub does not answer for the pull request', {'repos/%s/commits/%s/pulls' % (REPO, MERGE): None}),
    ('GitHub does not answer for the merged tree', {'repos/%s/git/commits/%s' % (REPO, MERGE): None}),
    ('GitHub does not answer for a check', {_checks_path('test'): None}),
])
def test_anything_short_of_proof_runs_the_suites(why, changes, tmp_path):
    assert _tested(_world(**changes), tmp_path) == 'false', why


def test_only_a_push_can_claim_the_proof():
    """On a pull request the step must not run at all: that run is the test the proof later relies on."""
    block, _ = _step('proof', '      - id: diff\n')
    assert "        if: github.event_name == 'push'\n" in block
    diff, _ = _step('diff', '\n  # The shared suites')
    assert '          TESTED: ${{ steps.proof.outputs.tested }}\n' in diff


def _gates(tmp_path, **env):
    _, script = _step('diff', '\n  # The shared suites')
    compare = {'files': [{'filename': 'sites/ffm/app/main.py'}, {'filename': 'sites/landhauscheck/app/main.py'},
                         {'filename': '.github/workflows/deploy.yml'}]}
    world = {'repos/%s/compare/%s...%s' % (REPO, BEFORE, MERGE): compare}
    return _run(script, world, tmp_path, PR='', BASE=BEFORE, HEAD_SHA=MERGE, **env)


def test_a_proven_tree_skips_every_suite_and_still_deploys(tmp_path):
    gates = _gates(tmp_path, TESTED='true')
    assert {name: gates[name] for name in ('ffm_tests', 'lhc_tests', 'site_tests', 'harness_tests', 'lesen_tests')} == {
        'ffm_tests': 'false', 'lhc_tests': 'false', 'site_tests': 'false', 'harness_tests': 'false', 'lesen_tests': 'false'}
    assert (gates['ffm'], gates['lhc']) == ('true', 'true'), 'a tested tree must still be deployed'
    assert (gates['site'], gates['lesen']) == ('false', 'false'), 'the proof must not deploy a site that did not change'


@pytest.mark.parametrize('tested', ['false', ''])
def test_an_unproven_tree_runs_every_suite_its_change_needs(tested, tmp_path):
    gates = _gates(tmp_path, TESTED=tested)
    # The workflow file changed too, which asks for every suite.
    assert {gates[name] for name in ('ffm_tests', 'lhc_tests', 'site_tests', 'harness_tests', 'lesen_tests')} == {'true'}
    assert (gates['ffm'], gates['lhc']) == ('true', 'true')


def test_the_parallel_flag_stays_in_the_workflow():
    """A plain `pytest sites/ffm/tests` must keep working without pytest-xdist: harness checks and developers run it."""
    assert 'pytest sites/ffm/tests/ -q --tb=short -n auto' in WORKFLOW
    root = Path(__file__).resolve().parents[3]
    for config in ('pytest.ini', 'sites/ffm/pytest.ini', 'pyproject.toml', 'setup.cfg', 'tox.ini'):
        path = root / config
        if path.exists():
            assert '-n ' not in path.read_text() and 'numprocesses' not in path.read_text(), config
