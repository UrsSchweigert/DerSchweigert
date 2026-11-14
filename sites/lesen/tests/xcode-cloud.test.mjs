import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const scriptUrl = new URL('../ios/App/ci_scripts/ci_post_clone.sh', import.meta.url);
const script = await readFile(scriptUrl, 'utf8');

async function fixture(t, { cloud = false, oldNode = false, brew = true, fail = '' } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'buchstabenzeit cloud-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const site = join(root, 'sites', 'lesen');
  const scripts = cloud
    ? join(root, 'isolated', 'ci_scripts')
    : join(site, 'ios', 'App', 'ci_scripts');
  const bin = join(root, 'bin');
  const prefix = join(root, 'node-prefix');
  const log = join(root, 'commands.log');
  for (const dir of [scripts, bin, join(prefix, 'bin'), join(site, 'node_modules', '.bin')]) {
    await mkdir(dir, { recursive: true });
  }
  const hook = join(scripts, 'ci_post_clone.sh');
  await writeFile(hook, script, { mode: 0o755 });
  await writeFile(log, '');
  const nodeMock = `#!/bin/sh
if [ "$1" = "-e" ]; then exit "\${MOCK_NODE_CHECK_EXIT:-0}"; fi
if [ "$0" = "$MOCK_NODE_PREFIX/bin/node" ]; then
  printf '%s\\n' "installed node $*" >> "$MOCK_LOG"
else
  printf '%s\\n' "node $*" >> "$MOCK_LOG"
fi
if [ "$1" = "scripts/verify-bundle.mjs" ] && [ "$MOCK_FAIL" = "verify" ]; then exit 19; fi
`;
  await writeFile(join(bin, 'node'), nodeMock, { mode: 0o755 });
  await writeFile(join(prefix, 'bin', 'node'), nodeMock, { mode: 0o755 });
  await writeFile(join(bin, 'npm'), `#!/bin/sh
[ "$PWD" = "$MOCK_SITE" ] || exit 23
printf '%s\\n' "npm $*" >> "$MOCK_LOG"
if [ "$*" = "$MOCK_FAIL" ]; then exit 19; fi
`, { mode: 0o755 });
  await writeFile(join(site, 'node_modules', '.bin', 'cap'), `#!/bin/sh
[ "$PWD" = "$MOCK_SITE" ] || exit 23
printf '%s\\n' "cap $*" >> "$MOCK_LOG"
if [ "$MOCK_FAIL" = "cap" ]; then exit 19; fi
`, { mode: 0o755 });
  if (brew) {
    await writeFile(join(bin, 'brew'), `#!/bin/sh
printf '%s\\n' "brew $*" >> "$MOCK_LOG"
if [ "$MOCK_FAIL" = "brew" ]; then exit 19; fi
if [ "$1" = "--prefix" ]; then printf '%s\\n' "$MOCK_NODE_PREFIX"; fi
`, { mode: 0o755 });
  }
  const result = spawnSync('/bin/bash', [hook], {
    cwd: tmpdir(),
    encoding: 'utf8',
    timeout: 10_000,
    env: {
      PATH: `${bin}:/usr/bin:/bin`,
      HOME: root,
      CI_PRIMARY_REPOSITORY_PATH: cloud ? root : '',
      MOCK_LOG: log,
      MOCK_SITE: site,
      MOCK_NODE_PREFIX: prefix,
      MOCK_NODE_CHECK_EXIT: oldNode ? '1' : '0',
      MOCK_FAIL: fail,
    },
  });
  assert.ifError(result.error);
  return {
    ...result,
    commands: (await readFile(log, 'utf8')).trim().split('\n').filter(Boolean),
  };
}

const preparation = [
  'node --version',
  'npm --version',
  'npm ci --no-audit --no-fund',
  'npm run copy-assets',
  'node scripts/verify-bundle.mjs',
  'cap sync ios',
  'npm test',
];

test('Xcode Cloud hook is executable and prepares the site from an unrelated working directory', async t => {
  assert.ok((await stat(scriptUrl)).mode & 0o111);
  const result = await fixture(t);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.commands, preparation);
});

test('Xcode Cloud installs supported Node.js through Homebrew when needed', async t => {
  const result = await fixture(t, { oldNode: true });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.commands, [
    'brew install node@22',
    'brew --prefix node@22',
    ...preparation.map(command => command.startsWith('node ') ? `installed ${command}` : command),
  ]);
});

test('Xcode Cloud uses its checkout path even when the script is isolated from source', async t => {
  const result = await fixture(t, { cloud: true });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.commands, preparation);
});

test('Xcode Cloud reports missing runtime tooling instead of continuing', async t => {
  const result = await fixture(t, { oldNode: true, brew: false });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /requires Node\.js 22\+/);
  assert.deepEqual(result.commands, []);
});

for (const [fail, lastCommand] of [
  ['ci --no-audit --no-fund', preparation[2]],
  ['run copy-assets', preparation[3]],
  ['verify', preparation[4]],
  ['cap', preparation[5]],
  ['test', preparation[6]],
]) {
  test(`Xcode Cloud stops and reports a failed ${lastCommand}`, async t => {
    const result = await fixture(t, { fail });
    assert.equal(result.status, 19);
    assert.match(result.stderr, /Buchstabenzeit preparation failed at line \d+ \(exit 19\)/);
    assert.deepEqual(result.commands, preparation.slice(0, preparation.indexOf(lastCommand) + 1));
  });
}

test('Xcode Cloud stops if the Node.js installation fails', async t => {
  const result = await fixture(t, { oldNode: true, fail: 'brew' });
  assert.equal(result.status, 19);
  assert.match(result.stderr, /Buchstabenzeit preparation failed/);
  assert.deepEqual(result.commands, ['brew install node@22']);
});

// App Store Connect refuses an upload whose MARKETING_VERSION still names a
// released version: the train is closed, so the refusal happens after the
// archive and every export have succeeded, where it costs a Cloud build and
// looks like an account problem. These checks run in `npm test`, which the
// Cloud post-clone hook runs before Xcode archives anything.
const pbxprojSetting = (project, key) => new Set(
  [...project.matchAll(new RegExp(`^\\s*${key} = ([^;]+);`, 'gm'))].map(match => match[1].trim()),
);

const versionTuple = (value) => {
  assert.match(value, /^\d+(\.\d+)*$/, `"${value}" must be a numeric version`);
  return value.split('.').map(Number);
};

const compareVersions = (left, right) => {
  const a = versionTuple(left);
  const b = versionTuple(right);
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) return Math.sign(difference);
  }
  return 0;
};

test('the marketing version is one value and newer than the released App Store version', async () => {
  const project = await readFile(new URL(
    '../ios/App/App.xcodeproj/project.pbxproj', import.meta.url,
  ), 'utf8');
  const versions = pbxprojSetting(project, 'MARKETING_VERSION');
  assert.equal(versions.size, 1,
    `Debug and Release must carry one MARKETING_VERSION, found ${[...versions].join(', ') || 'none'}`);
  const marketing = [...versions][0];

  const recorded = (await readFile(new URL('../ios/RELEASED_VERSION', import.meta.url), 'utf8'))
    .split('\n')
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#'));
  assert.equal(recorded.length, 1, 'ios/RELEASED_VERSION must hold exactly one version line');

  assert.equal(compareVersions(marketing, recorded[0]), 1,
    `MARKETING_VERSION ${marketing} is not newer than the released ${recorded[0]}: ` +
    'App Store Connect refuses uploads that still carry a released version. Bump ' +
    'MARKETING_VERSION (Debug and Release) in ios/App/App.xcodeproj/project.pbxproj ' +
    'after creating the next version in App Store Connect.');
});

test('the committed build number is one positive integer that a re-upload can raise', async () => {
  const project = await readFile(new URL(
    '../ios/App/App.xcodeproj/project.pbxproj', import.meta.url,
  ), 'utf8');
  const builds = pbxprojSetting(project, 'CURRENT_PROJECT_VERSION');
  assert.equal(builds.size, 1,
    `Debug and Release must carry one CURRENT_PROJECT_VERSION, found ${[...builds].join(', ') || 'none'}`);
  assert.match([...builds][0], /^[1-9]\d*$/,
    'CURRENT_PROJECT_VERSION must be a positive integer above the previously uploaded build');
});

test('the shared App scheme archives the real app target in Release', async () => {
  const scheme = await readFile(new URL(
    '../ios/App/App.xcodeproj/xcshareddata/xcschemes/App.xcscheme', import.meta.url,
  ), 'utf8');
  const project = await readFile(new URL(
    '../ios/App/App.xcodeproj/project.pbxproj', import.meta.url,
  ), 'utf8');
  const target = project.match(/(\w+) \/\* App \*\/ = \{\s*isa = PBXNativeTarget;/)?.[1];
  assert.ok(target, 'the App native target must exist');
  assert.match(scheme, /buildForArchiving="YES"/);
  assert.ok(scheme.includes(`BlueprintIdentifier="${target}"`));
  assert.match(scheme, /ReferencedContainer="container:App\.xcodeproj"/);
  assert.match(scheme, /<ArchiveAction buildConfiguration="Release"/);
});
