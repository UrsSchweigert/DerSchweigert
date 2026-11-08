import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('the shared App scheme uses the real target for run, profile and archive', async () => {
  const scheme = await read('ios/App/App.xcodeproj/xcshareddata/xcschemes/App.xcscheme');
  const project = await read('ios/App/App.xcodeproj/project.pbxproj');
  assert.equal((scheme.match(/BlueprintIdentifier="504EC3031FED79650016851F"/g) ?? []).length, 3);
  assert.match(project, /504EC3031FED79650016851F \/\* App \*\/ = \{\s*isa = PBXNativeTarget;/);
  assert.match(scheme, /<ArchiveAction buildConfiguration="Release"/);
  assert.match(scheme, /buildForArchiving="YES"/);
});

test('Xcode Cloud prepares the locked, verified offline app before package resolution', async () => {
  const relative = 'ios/App/ci_scripts/ci_post_clone.sh';
  const script = await read(relative);
  const file = new URL(`../${relative}`, import.meta.url);
  assert.ok((await stat(file)).mode & 0o111, 'Xcode Cloud hook must be executable');
  assert.equal(spawnSync('/bin/bash', ['-n', file.pathname]).status, 0);
  assert.match(script, /CI_PRIMARY_REPOSITORY_PATH\/sites\/ffm\/mobile/);
  assert.match(script, /cd "\$\(dirname "\$0"\)\/\.\.\/\.\.\/\.\."/);
  const commands = [
    'npm ci --no-audit --no-fund', 'npm run copy-assets',
    'node scripts/bundle-check.mjs', './node_modules/.bin/cap sync ios', 'npm test',
  ];
  let previous = -1;
  for (const command of commands) {
    const index = script.indexOf(command);
    assert.ok(index > previous, command);
    previous = index;
  }
  assert.match(script, /set -euo pipefail/);
  assert.match(script, /brew install node@22/);
  assert.doesNotMatch(script, /lesen|BZ_|--allowProvisioningUpdates/);
});

test('local Xcode builds and archives retain automatic Capacitor preparation', async () => {
  const project = await read('ios/App/App.xcodeproj/project.pbxproj');
  const target = project.slice(project.indexOf('/* Begin PBXNativeTarget section */'),
    project.indexOf('/* End PBXNativeTarget section */'));
  assert.ok(target.indexOf('Prepare Capacitor iOS assets') < target.indexOf('Resources'));
  assert.match(project, /tools\/ios\/prepare-capacitor\.sh/);
  assert.match(project, /scripts\/bundle-check\.mjs/);
  assert.match(project, /runOnlyForDeploymentPostprocessing = 0;/);
});

test('the Cloud hook executes in the app checkout and stops immediately on preparation failure', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ffm-cloud-hook-'));
  try {
    const app = join(directory, 'sites/ffm/mobile');
    const bin = join(directory, 'bin');
    await mkdir(join(app, 'node_modules/.bin'), { recursive: true });
    await mkdir(bin);
    const log = join(directory, 'commands.log');
    await writeFile(join(bin, 'node'), '#!/bin/bash\nprintf "node:%s:%s\\n" "$PWD" "$*" >> "$HOOK_LOG"\n', { mode: 0o755 });
    await writeFile(join(bin, 'npm'), '#!/bin/bash\nprintf "npm:%s:%s\\n" "$PWD" "$*" >> "$HOOK_LOG"\nif [[ "$*" == "run copy-assets" && "${HOOK_FAIL:-}" == "yes" ]]; then exit 7; fi\n', { mode: 0o755 });
    await writeFile(join(app, 'node_modules/.bin/cap'), '#!/bin/bash\nprintf "cap:%s:%s\\n" "$PWD" "$*" >> "$HOOK_LOG"\n', { mode: 0o755 });
    const hook = new URL('../ios/App/ci_scripts/ci_post_clone.sh', import.meta.url).pathname;
    const env = { ...process.env, CI_PRIMARY_REPOSITORY_PATH: directory,
      PATH: `${bin}:/usr/bin:/bin`, HOOK_LOG: log };
    const result = spawnSync('/bin/bash', [hook], { env, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    const commands = await readFile(log, 'utf8');
    assert.ok(commands.includes(`npm:${app}:ci --no-audit --no-fund`));
    assert.ok(commands.includes(`cap:${app}:sync ios`));
    assert.ok(commands.endsWith(`npm:${app}:test\n`));
    await writeFile(log, '');
    const failed = spawnSync('/bin/bash', [hook], { env: { ...env, HOOK_FAIL: 'yes' }, encoding: 'utf8' });
    assert.equal(failed.status, 7);
    assert.match(failed.stderr, /Arithmo Slayer preparation failed/);
    assert.doesNotMatch(await readFile(log, 'utf8'), /bundle-check|cap:|:test/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
