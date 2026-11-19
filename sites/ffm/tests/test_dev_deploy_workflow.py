"""The dev deploy must serve what prod would, and must never be able to touch prod.

The dev workflow copies deploy-ffm's `aws s3 sync` exclude list (a shared script would mean
changing the production deploy job). If the copies drift, dev starts serving test pages and
story sources that prod does not, which defeats the point of trying a change there first.
"""
import re
from pathlib import Path

WORKFLOWS = Path(__file__).resolve().parents[3] / '.github' / 'workflows'
DEV = (WORKFLOWS / 'deploy-ffm-dev.yml').read_text()
PROD = (WORKFLOWS / 'deploy.yml').read_text()


def _prod_ffm_job():
    start = PROD.index('  deploy-ffm:\n')
    # Up to the next top-level job, whatever it is called, so reordering jobs cannot break this.
    nxt = re.search(r'^  [a-z][\w-]*:\n', PROD[start + 1:], re.MULTILINE)
    return PROD[start:start + 1 + nxt.start()] if nxt else PROD[start:]


def _sync_excludes(text):
    # The sync command is one shell line continued with backslashes; stop at its last line so a
    # following `aws s3 rm ... --exclude "*"` is not mistaken for part of it.
    lines = text[text.index('aws s3 sync sites/ffm/static/'):].splitlines()
    command = []
    for line in lines:
        command.append(line)
        if not line.rstrip().endswith('\\'):
            break
    return set(re.findall(r'--exclude "([^"]+)"', '\n'.join(command)))


def _code(text):
    return '\n'.join(line for line in text.splitlines() if not line.lstrip().startswith('#'))


def test_dev_sync_excludes_match_prod_apart_from_robots_txt():
    assert _sync_excludes(DEV) - {'robots.txt'} == _sync_excludes(_prod_ffm_job())


def _job(name):
    start = PROD.index('  %s:\n' % name)
    nxt = re.search(r'^  [a-z][\w-]*:\n', PROD[start + 1:], re.MULTILINE)
    return _code(PROD[start:start + 1 + nxt.start()] if nxt else PROD[start:])


def test_dev_workflow_starts_by_hand_or_when_called_and_never_by_itself():
    on_block = DEV[DEV.index('\non:'):DEV.index('\npermissions:')]
    assert 'workflow_dispatch' in on_block and 'workflow_call' in on_block
    for trigger in ('pull_request', 'push:', 'schedule'):
        assert trigger not in on_block, f'{trigger} would let untrusted code reach AWS credentials'


def test_only_a_push_to_main_calls_the_dev_deploy():
    # The called workflow inherits the AWS credentials, so the caller is the only thing between them and a pull request.
    job = _job('deploy-ffm-dev')
    assert 'uses: ./.github/workflows/deploy-ffm-dev.yml' in job
    assert "github.event_name == 'push' &&" in job and "github.ref == 'refs/heads/main' &&" in job
    assert 'needs: [test-ffm, check-secrets, changes]' in job, 'dev must not get a merge whose ffm tests failed'
    callers = [path.name for path in WORKFLOWS.glob('*.yml') if 'deploy-ffm-dev.yml' in _code(path.read_text())
               and path.name != 'deploy-ffm-dev.yml']
    assert callers == ['deploy.yml'], callers


def test_a_merge_never_deploys_ffm_to_production():
    job = _job('deploy-ffm')
    condition = job[job.index('    if: |'):job.index('    env:')]
    assert "github.event_name == 'workflow_dispatch' &&" in condition, 'production ffm is released by hand only'
    assert "github.ref == 'refs/heads/main' &&" in condition, 'a release must come from main, never from a branch'
    assert 'needs: [test-ffm, check-secrets, changes]' in job


def test_dev_workflow_never_names_a_prod_resource():
    # Every AWS name the job builds must carry the ffm-dev prefix, and it must use its own state.
    code = _code(DEV)
    assert 'sites/ffm-dev' in code
    assert not re.search(r'ffm-site-|function-name ffm-api|BASE=https://ffm\.derschweigert\.de', code)
    assert 'FFM_' not in code, 'dev must not read the production billing variables'


def test_merging_the_dev_stack_does_not_deploy_any_site():
    # infra/terraform/sites/ffm-dev/* matches no site pattern, so without its own no-op case it
    # lands in the `infra/*` catch-all, which deploys every site, production included.
    dev_case = PROD.index('infra/terraform/sites/ffm-dev/*) ffm_dev=true ;;')
    catch_all = PROD.index('infra/*) ffm=true;')
    assert dev_case < catch_all
