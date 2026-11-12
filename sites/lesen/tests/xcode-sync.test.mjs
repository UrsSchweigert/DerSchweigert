import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = new URL('../../../', import.meta.url);
const helper = fileURLToPath(new URL('tools/ios/prepare-capacitor.sh', root));
const projectPaths = [
  ['sites/lesen/ios/App/App.xcodeproj/project.pbxproj', 'scripts/verify-bundle.mjs'],
  ['sites/ffm/mobile/ios/App/App.xcodeproj/project.pbxproj', 'scripts/bundle-check.mjs'],
];

test('both iOS targets prepare assets before the Resources phase in every build', async () => {
  for (const [path, verifier] of projectPaths) {
    const project = await readFile(new URL(path, root), 'utf8');
    const target = project.split('/* Begin PBXNativeTarget section */')[1].split('/* End PBXNativeTarget section */')[0];
    assert.ok(target.indexOf('/* Prepare Capacitor iOS assets */') >= 0);
    assert.ok(target.indexOf('/* Prepare Capacitor iOS assets */') < target.indexOf('/* Resources */'));
    assert.match(project, /alwaysOutOfDate = 1;/);
    assert.match(project, /prepare-capacitor\.sh/);
    assert.ok(project.includes(verifier));
    assert.equal((project.match(/ENABLE_USER_SCRIPT_SANDBOXING = NO;/g) ?? []).length, 2);
  }
});

test('shared preparation changes run the affected tests; native builds run after a merge to main', async () => {
  const deploy = await readFile(new URL('.github/workflows/deploy.yml', root), 'utf8');
  assert.match(deploy, /tools\/ios\/\*\) ffm_tests=true; lesen_tests=true; harness_tests=true ;;/);
  for (const workflow of ['buchstabenzeit-native.yml', 'arithmoslayer-native.yml']) {
    const text = await readFile(new URL(`.github/workflows/${workflow}`, root), 'utf8');
    assert.match(text, /\n  push:\n    branches: \[main\]/);
    assert.doesNotMatch(text, /\n  pull_request:/);
    assert.match(text, /^\s+- 'tools\/ios\/\*\*'$/m);
    assert.match(text, /needs: \[android, ios\]\n    if: always\(\)/);
  }
});

test('shared preparation validates dependencies, verifies the bundle and syncs iOS; errors stop the build', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'xcode-capacitor-'));
  try {
    const bin = join(dir, 'bin');
    const app = join(dir, 'app');
    const log = join(dir, 'calls');
    await mkdir(bin, { recursive: true });
    await mkdir(join(app, 'node_modules/.bin'), { recursive: true });
    await writeFile(join(bin, 'node'), `#!/bin/bash
if [ "$1" = "-e" ]; then exit 0; fi
echo "verify $*" >> "$CALL_LOG"
[ "\${FAIL_STEP:-}" != verify ]
`, { mode: 0o755 });
    await writeFile(join(bin, 'npm'), `#!/bin/bash
echo "npm $*" >> "$CALL_LOG"
if [ "$1" = ls ]; then [ "\${FAIL_STEP:-}" != dependencies ]; else [ "\${FAIL_STEP:-}" != copy ]; fi
`, { mode: 0o755 });
    await writeFile(join(app, 'node_modules/.bin/cap'), `#!/bin/bash
echo "cap $*" >> "$CALL_LOG"
[ "\${FAIL_STEP:-}" != sync ]
`, { mode: 0o755 });
    const run = (failStep = '') => spawnSync('/bin/bash', [helper, app, 'scripts/check.mjs'], {
      encoding: 'utf8',
      env: { ...process.env, PATH: `${bin}:/usr/bin:/bin`, CALL_LOG: log, FAIL_STEP: failStep },
    });

    assert.equal(run().status, 0);
    assert.deepEqual((await readFile(log, 'utf8')).trim().split('\n'), [
      'npm ls --all --omit=optional --parseable',
      'npm run copy-assets',
      'verify scripts/check.mjs',
      'cap sync ios',
    ]);
    for (const step of ['dependencies', 'copy', 'verify', 'sync']) {
      await writeFile(log, '');
      const result = run(step);
      assert.notEqual(result.status, 0, `${step} failure must stop the build`);
      const calls = await readFile(log, 'utf8');
      if (step !== 'sync') assert.doesNotMatch(calls, /cap sync ios/);
    }
    await rm(join(app, 'node_modules/.bin/cap'));
    const missing = run();
    assert.notEqual(missing.status, 0);
    assert.match(missing.stderr, /run npm ci/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
