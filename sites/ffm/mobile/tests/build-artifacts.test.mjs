import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmod, cp, mkdir, mkdtemp, readFile, readlink, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { IOS_PROJECT_INPUTS, relocateSwiftPackages, stageIosProject } from '../scripts/stage-ios-project.mjs';

const mobile = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repository = resolve(mobile, '../../..');
const workflow = (name) => readFile(join(repository, '.github/workflows', name), 'utf8');
const lockPath = 'sites/ffm/mobile/ios/App/App.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/Package.resolved';

async function withFixture(run) {
  // Docker's macOS bind mount can retain phantom symlinks during cleanup.
  const scratch = await mkdtemp(join(tmpdir(), 'ffm-artifact-test-'));
  try {
    return await run(scratch);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

async function write(root, path, text = '') {
  await mkdir(dirname(join(root, path)), { recursive: true });
  await writeFile(join(root, path), text);
}

function execute(command, args, cwd, env = {}) {
  const result = spawnSync(command, args, {
    cwd, encoding: 'utf8', env: { ...process.env, ...env },
  });
  assert.equal(result.status, 0, `${command}: ${result.stderr || result.stdout || result.error}`);
  return result.stdout;
}

async function fixture(scratch) {
  const root = join(scratch, 'checkout');
  const cache = join(scratch, 'SourcePackages');
  for (const input of IOS_PROJECT_INPUTS) {
    if (input.endsWith('.json') || input.endsWith('.sh')) await write(root, input, '{}');
    else await mkdir(join(root, input), { recursive: true });
  }
  const packageDir = 'sites/ffm/mobile';
  await write(root, `${packageDir}/package.json`, JSON.stringify({
    name: 'artifact-fixture', version: '1.0.0', type: 'module',
    scripts: { 'copy-assets': 'node scripts/copy-assets.mjs' },
    dependencies: { plugin: '1.0.0' },
    devDependencies: { '@capacitor/cli': '1.0.0' },
  }));
  await write(root, `${packageDir}/node_modules/plugin/package.json`, JSON.stringify({
    name: 'plugin', version: '1.0.0', dependencies: { transitive: '1.0.0' },
  }));
  await write(root, `${packageDir}/node_modules/plugin/node_modules/transitive/package.json`,
    '{"name":"transitive","version":"1.0.0"}');
  await write(root, `${packageDir}/node_modules/@capacitor/cli/package.json`,
    '{"name":"@capacitor/cli","version":"1.0.0","bin":{"cap":"bin/capacitor"}}');
  await write(root, `${packageDir}/node_modules/@capacitor/cli/bin/capacitor`, '#!/bin/sh\nexit 0\n');
  await chmod(join(root, packageDir, 'node_modules/@capacitor/cli/bin/capacitor'), 0o755);
  await mkdir(join(root, packageDir, 'node_modules/.bin'));
  await symlink('../@capacitor/cli/bin/capacitor', join(root, packageDir, 'node_modules/.bin/cap'));
  await write(root, `${packageDir}/ios/App/CapApp-SPM/Package.swift`, 'resolved Swift manifest');
  await write(root, lockPath, '{"pins":[{"identity":"capacitor-swift-pm"}]}');
  await write(root, `${packageDir}/ios/App/App/config 2.xml`, 'untracked duplicate');
  await write(root, `${packageDir}/ios/App/App/config.xml`, 'authoritative');
  await write(root, `${packageDir}/ios/App/App.xcodeproj/project.pbxproj`, 'native shell');
  await write(root, `${packageDir}/ios/App/App.xcodeproj/xcshareddata/xcschemes/App.xcscheme`, 'shared scheme');
  await write(root, `${packageDir}/ios/App/ci_scripts/ci_post_clone.sh`, 'cloud preparation hook');
  await chmod(join(root, packageDir, 'ios/App/ci_scripts/ci_post_clone.sh'), 0o755);
  await write(root, 'sites/ffm/static/index.html', '<html><!-- app --></html>');
  await write(root, 'sites/ffm/static/styles.css', 'body {}');
  await write(root, 'sites/ffm/static/game/main.js', 'web module');
  await write(root, `${packageDir}/game/main.js`, 'app overlay');
  await write(root, `${packageDir}/legal/privacy.html`, 'offline privacy');
  await write(root, `${packageDir}/assets/icon.png`, 'app icon source');
  await write(root, 'sites/ffm/app/level_data.json', JSON.stringify({
    totalLevels: 60, levels: Array.from({ length: 60 }, (_, index) => ({ level: index + 1 })),
  }));
  for (const script of ['copy-assets.mjs', 'level-data.mjs', 'bundle-check.mjs']) {
    await cp(join(mobile, 'scripts', script), join(root, packageDir, 'scripts', script));
  }
  await cp(join(repository, 'tools/ios/prepare-capacitor.sh'), join(root, 'tools/ios/prepare-capacitor.sh'));
  await write(cache, 'checkouts/capacitor-swift-pm/Package.swift', 'Swift sources');
  await write(cache, 'repositories/capacitor/HEAD', 'repository metadata');
  await write(cache, 'repositories/capacitor/objects/pack/fixture', 'Git objects');
  await write(cache, 'checkouts/capacitor-swift-pm/.git/objects/info/alternates',
    `${join(cache, 'repositories/capacitor/objects')}\n`);
  await chmod(join(cache, 'checkouts/capacitor-swift-pm/.git/objects/info/alternates'), 0o444);
  await write(cache, 'artifacts/fixture/data', 'binary artifact');
  await write(cache, 'workspace-state.json', JSON.stringify({
    object: {
      artifacts: [{ path: join(cache, 'artifacts/fixture/data') }],
      dependencies: [{
        packageRef: { kind: 'fileSystem', location: join(root, packageDir, 'ios/App/CapApp-SPM') },
        state: { path: join(root, packageDir, 'ios/App/CapApp-SPM') },
      }],
    },
  }));
  return { root, cache };
}

test('staging and tar extraction retain the complete relocatable preparation graph', async () => {
  await withFixture(async (scratch) => {
    const { root, cache } = await fixture(scratch);
    const stage = await stageIosProject({
      repositoryRoot: root, stagingParent: scratch, swiftPackagesDirectory: cache,
    });
    const archive = join(scratch, 'ios.tar.gz');
    execute('tar', ['-czf', archive, '-C', stage, 'sites', 'tools', 'swift-packages'], scratch);
    const extracted = join(scratch, 'extracted');
    await mkdir(extracted);
    execute('tar', ['-xzf', archive, '-C', extracted], scratch);
    // Delete the fixture checkout and staging tree to expose absolute symlinks
    // or a dependency on the original repository.
    await rm(root, { recursive: true });
    await rm(stage, { recursive: true });
    const app = join(extracted, 'sites/ffm/mobile');
    await relocateSwiftPackages(extracted);
    const cacheState = JSON.parse(await readFile(join(extracted, 'swift-packages/workspace-state.json'), 'utf8'));
    assert.equal(cacheState.object.artifacts[0].path, join(extracted, 'swift-packages/artifacts/fixture/data'));
    assert.equal(cacheState.object.dependencies[0].state.path, join(app, 'ios/App/CapApp-SPM'));
    assert.equal(await readFile(join(extracted,
      'swift-packages/checkouts/capacitor-swift-pm/.git/objects/info/alternates'), 'utf8'),
    '../../../../repositories/capacitor/objects\n');
    assert.equal(await readlink(join(app, 'node_modules/.bin/cap')), '../@capacitor/cli/bin/capacitor');
    execute(join(app, 'node_modules/.bin/cap'), [], app);
    const graph = execute('npm', ['ls', '--all', '--omit=optional', '--parseable'], app);
    assert.ok(graph.includes('/node_modules/plugin/node_modules/transitive'));
    assert.ok(graph.includes('/node_modules/@capacitor/cli'));
    execute('npm', ['run', 'copy-assets'], app);
    assert.equal(await readFile(join(app, 'www/game/main.js'), 'utf8'), 'app overlay');
    assert.match(await readFile(join(app, 'www/game/level-data.js'), 'utf8'), /"totalLevels": 60/);
    for (const input of IOS_PROJECT_INPUTS) await stat(join(extracted, input));
    for (const path of ['checkouts/capacitor-swift-pm/Package.swift', 'repositories/capacitor/HEAD',
      'artifacts/fixture/data', 'workspace-state.json']) {
      await stat(join(extracted, 'swift-packages', path));
    }
    assert.equal(await readFile(join(app, 'ios/App/App/config.xml'), 'utf8'), 'authoritative');
    await assert.rejects(stat(join(app, 'ios/App/App/config 2.xml')), { code: 'ENOENT' });
    assert.equal(await readFile(join(extracted, 'tools/ios/prepare-capacitor.sh'), 'utf8'),
      await readFile(join(repository, 'tools/ios/prepare-capacitor.sh'), 'utf8'));
    await stat(join(extracted, lockPath));
    await stat(join(app, 'assets/icon.png'));
    await stat(join(app, 'ios/App/App.xcodeproj/xcshareddata/xcschemes/App.xcscheme'));
    assert.ok((await stat(join(app, 'ios/App/ci_scripts/ci_post_clone.sh'))).mode & 0o111);
  });
});

test('staging refuses missing source, CLI, Swift cache or unsafe destinations', async () => {
  await withFixture(async (scratch) => {
    const { root, cache } = await fixture(scratch);
    const options = { repositoryRoot: root, stagingParent: scratch, swiftPackagesDirectory: cache };
    await assert.rejects(stageIosProject({ ...options, swiftPackagesDirectory: undefined }), /cache is required/);
    await assert.rejects(stageIosProject({
      ...options, stagingParent: join(root, 'sites/ffm/mobile/scripts'),
    }), /outside build inputs/);
    await assert.rejects(stageIosProject({ ...options, stagingParent: cache }), /outside build inputs/);
    await assert.rejects(stageIosProject({
      ...options, stagingParent: join(root, 'sites/ffm/mobile/assets'),
    }), /outside build inputs/);
    await rm(join(cache, 'workspace-state.json'));
    await assert.rejects(stageIosProject(options), { code: 'ENOENT' });
    await write(cache, 'workspace-state.json', '{}');
    await rm(join(root, 'sites/ffm/mobile/node_modules/.bin/cap'));
    await assert.rejects(stageIosProject(options), { code: 'ENOENT' });
  });
});

test('artifact workflow is manual/tag-only, unsigned and verifies the extracted offline archive', async () => {
  const yaml = await workflow('arithmoslayer-build-artifacts.yml');
  const triggers = yaml.slice(yaml.indexOf('\non:'), yaml.indexOf('\nconcurrency:'));
  assert.match(triggers, /workflow_dispatch:/);
  assert.match(triggers, /tags: \['arithmoslayer-v\*'\]/);
  assert.doesNotMatch(triggers, /pull_request:|branches:|schedule:/);
  assert.match(yaml, /permissions:\n  contents: read/);
  assert.doesNotMatch(yaml, /secrets\.|DEVELOPMENT_TEAM|upload-to|build:release|exportArchive/);
  assert.match(yaml, /npm run build:debug/);
  assert.match(yaml, /name: ffm-debug-apk/);
  assert.match(yaml, /name: ffm-ios-xcode-project/);
  assert.match(yaml, /stage-ios-project\.mjs/);
  assert.match(yaml, /tar -czf .* sites tools swift-packages/);
  assert.match(yaml, /tar -xzf/);
  assert.match(yaml, /npm ls --all --omit=optional/);
  assert.match(yaml, /-clonedSourcePackagesDirPath "\$extracted\/swift-packages"/);
  assert.match(yaml, /-disableAutomaticPackageResolution -onlyUsePackageVersionsFromResolvedFile -skipPackageUpdates/);
  assert.match(yaml, /CODE_SIGNING_ALLOWED=NO archive/);
  assert.ok(yaml.indexOf('CODE_SIGNING_ALLOWED=NO archive') < yaml.lastIndexOf('actions/upload-artifact'));
});

test('native builds run only after a merge to main and require both platforms', async () => {
  const yaml = await workflow('arithmoslayer-native.yml');
  assert.match(yaml, /\n  push:\n    branches: \[main\]/);
  assert.doesNotMatch(yaml, /\n  pull_request:/);
  for (const path of ['sites/ffm/**', 'tools/ios/**', '.github/workflows/arithmoslayer-build-artifacts.yml']) {
    assert.ok(yaml.includes(`      - '${path}'`), `the push filter must cover ${path}`);
  }
  const gate = yaml.slice(yaml.lastIndexOf('          set -euo pipefail'))
    .split('\n').map((line) => line.replace(/^          /, '')).join('\n');
  for (const [android, ios, expected] of [['success', 'success', 0], ['success', 'skipped', 1],
    ['failure', 'success', 1], ['skipped', 'success', 1]]) {
    const result = spawnSync('bash', ['-c', gate], { encoding: 'utf8', env: { ...process.env, ANDROID: android, IOS: ios } });
    assert.equal(result.status, expected, `${android}/${ios}: ${result.stdout}`);
  }
});
