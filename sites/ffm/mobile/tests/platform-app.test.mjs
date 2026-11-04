// The app bundle ships no api.js or access-flow.js (see EXCLUDED in
// scripts/copy-assets.mjs), so the game must reach the platform only through
// platform.js. These tests prove that seam works in the app build: main.js
// imports the seam instead of the web modules, and resolving the app adapter
// yields a complete, network-free platform.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const gameDir = join(root, '..', 'static', 'game');
const read = (rel) => readFile(join(gameDir, rel), 'utf8');

const {
  PLATFORM_METHODS,
  PLATFORM_PROPERTIES,
  PLATFORM_CAPABILITIES,
  assertPlatformAdapter,
  resolvePlatform,
} = await import('../../static/game/platform.js');
const { EXCLUDED } = await import('../scripts/copy-assets.mjs');
const appModule = await import('../game/platform-adapter.js');

test('main.js reaches the platform only through the seam', async () => {
  const source = await read('main.js');
  const imports = source.match(/^import\s[^\n]*$/gm) || [];
  assert.ok(imports.length > 0, 'main.js must have imports');
  assert.ok(
    imports.some((line) => /from '\.\/platform\.js'/.test(line)),
    'main.js imports platform.js',
  );
  for (const line of imports) {
    assert.doesNotMatch(line, /from '\.\/api\.js'/, 'main.js must not import api.js');
    assert.doesNotMatch(line, /from '\.\/access-flow\.js'/, 'main.js must not import access-flow.js');
  }
  assert.match(source, /const platform = await resolvePlatform\(\);/);
  // Every module the game calls on the platform is part of the interface.
  for (const [, name] of source.matchAll(/\bplatform\.([A-Za-z_]\w*)/g)) {
    if (name === 'js') continue;
    assert.ok(
      PLATFORM_METHODS.includes(name)
        || PLATFORM_PROPERTIES.includes(name)
        || PLATFORM_CAPABILITIES.includes(name),
      `${name} is not part of the platform interface`,
    );
  }
});

test('the bundle never ships the web-only API modules', () => {
  const matches = (rel) => EXCLUDED.some((pattern) => pattern.test(rel));
  assert.ok(matches('game/api.js'), 'game/api.js must stay out of www/');
  assert.ok(matches('game/access-flow.js'), 'game/access-flow.js must stay out of www/');
  assert.ok(!matches('game/platform.js'), 'game/platform.js must be bundled');
  assert.ok(!matches('game/platform-adapter.js'), 'game/platform-adapter.js must be bundled');
  assert.ok(!matches('game/main.js'), 'game/main.js must be bundled');
});

test('resolvePlatform returns the complete app adapter', async () => {
  const platform = await resolvePlatform(async () => appModule);
  assert.equal(assertPlatformAdapter(platform), platform);
  assert.equal(platform.isApp, true);
  assert.equal(platform.hasAccount, false);
  assert.equal(platform.hasLeaderboard, false);
  for (const name of PLATFORM_METHODS) {
    assert.equal(typeof platform[name], 'function', name);
  }
  assert.equal(typeof platform.isLoggedIn, 'boolean');
  assert.ok('username' in platform);
});

test('the app adapter needs no api.js and never touches the network', async () => {
  const source = await readFile(join(root, 'game', 'platform-adapter.js'), 'utf8');
  assert.doesNotMatch(source, /^\s*import\s/m);
  assert.doesNotMatch(source, /\bfetch\s*\(/);
  assert.doesNotMatch(source, /\bXMLHttpRequest\b/);

  const platform = await resolvePlatform(async () => appModule);
  const realFetch = globalThis.fetch;
  let networkCalls = 0;
  globalThis.fetch = async () => {
    networkCalls++;
    throw new Error('the app platform must not use the network');
  };
  try {
    await platform.getAuthorizedLevelConfig(0);
    await platform.getBillingStatus();
    await platform.getScoreHistory();
    await platform.getLeaderboard();
    await platform.postHighScore(10, 1);
    await platform.postLevelScore(1, 10, 'easy');
    for (const name of PLATFORM_METHODS) {
      await Promise.resolve(platform[name]()).catch(() => {});
    }
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.equal(networkCalls, 0);
});
