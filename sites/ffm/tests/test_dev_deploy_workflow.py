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


def test_dev_workflow_only_starts_manually():
    on_block = DEV[DEV.index('\non:'):DEV.index('\npermissions:')]
    assert 'workflow_dispatch' in on_block
    for trigger in ('pull_request', 'push:', 'schedule'):
        assert trigger not in on_block, f'{trigger} would let untrusted code reach AWS credentials'


def test_dev_workflow_never_names_a_prod_resource():
    # Every AWS name the job builds must carry the ffm-dev prefix, and it must use its own state.
    code = _code(DEV)
    assert 'sites/ffm-dev' in code
    assert not re.search(r'ffm-site-|function-name ffm-api|BASE=https://ffm\.derschweigert\.de', code)
    assert 'FFM_' not in code, 'dev must not read the production billing variables'


def test_merging_the_dev_stack_does_not_deploy_any_site():
    # infra/terraform/sites/ffm-dev/* matches no site pattern, so without its own no-op case it
    # lands in the `infra/*` catch-all, which deploys every site, production included.
    dev_case = PROD.index('infra/terraform/sites/ffm-dev/*) ;;')
    catch_all = PROD.index('infra/*) ffm=true;')
    assert dev_case < catch_all
