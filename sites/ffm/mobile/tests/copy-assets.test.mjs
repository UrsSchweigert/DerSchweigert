import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile, readFile, readdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  APP_OVERLAY,
  EXCLUDED,
  GENERATED_FILES,
  LEGAL_DIR,
  REQUIRED_FILES,
  copyAssets,
  isExcluded,
  stripAppOnlyDom,
} from '../scripts/copy-assets.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const staticDir = join(root, '..', 'static');
const toPosix = (rel) => rel.split('\\').join('/');

async function tempDir(prefix) {
  return mkdtemp(join(tmpdir(), prefix));
}

// Every file in a tree, as posix paths relative to the tree root.
async function listFiles(dir) {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => toPosix(join(entry.parentPath ?? entry.path, entry.name).slice(dir.length + 1)))
    .sort();
}

async function fixture(files) {
  const dir = await tempDir('ffm-fixture-');
  for (const [rel, content] of Object.entries(files)) {
    const target = join(dir, rel);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content);
  }
  return dir;
}

async function withDirs(fn) {
  const dirs = [];
  const make = async (prefix) => {
    const dir = await tempDir(prefix);
    dirs.push(dir);
    return dir;
  };
  try {
    return await fn(make);
  } finally {
    await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
  }
}

test('www/ holds the entry points and every kept game asset', async () => {
  await withDirs(async (make) => {
    const out = await make('ffm-www-');
    await copyAssets(undefined, out, join(root, 'missing-overlay'));

    for (const rel of REQUIRED_FILES) {
      assert.ok((await stat(join(out, rel))).isFile(), `${rel} must be bundled`);
    }
    for (const rel of ['game/background.png', 'game/levels.js', 'game/renderer.js', 'game/fiend-sprites']) {
      const info = await stat(join(out, rel)).catch(() => null);
      assert.ok(info, `${rel} must be bundled`);
    }
    assert.equal(
      await readFile(join(out, 'game/main.js'), 'utf8'),
      await readFile(join(staticDir, 'game/main.js'), 'utf8'),
    );

    const legal = (await listFiles(LEGAL_DIR)).map((rel) => `legal/${rel}`);
    const expected = [
      ...(await listFiles(staticDir)).filter((rel) => !isExcluded(rel)),
      ...legal,
      ...GENERATED_FILES,
    ].sort();
    const copied = await listFiles(out);
    assert.deepEqual(copied, expected, 'www/ must contain exactly the non-excluded static files');
  });
});

test('web-only and development-only files never reach www/', async () => {
  await withDirs(async (make) => {
    const out = await make('ffm-www-');
    await copyAssets(undefined, out, join(root, 'missing-overlay'));
    const copied = await listFiles(out);

    for (const rel of [
      'game/api.js',
      'game/access-flow.js',
      'game/calibrate.html',
      'game/calibrate.js',
      'game/_dragon_test.html',
      'export-sprites.html',
      'demo.html',
      'cancel.html',
      'widerruf.html',
    ]) {
      assert.ok(!copied.includes(rel), `${rel} must not be bundled`);
      assert.ok(EXCLUDED.some((pattern) => pattern.test(rel)), `${rel} needs an exclusion`);
    }
    assert.ok(!copied.some((rel) => rel.startsWith('game/source-assets/')), 'source-assets must not be bundled');
    assert.ok(!copied.some((rel) => /(^|\/)tests?(\/|$)/.test(rel)), 'tests must not be bundled');
    assert.ok(!copied.some((rel) => rel.endsWith('.test.js')), 'test files must not be bundled');
  });
});

test('the app overlay replaces web modules and adds app-only ones', async () => {
  await withDirs(async (make) => {
    const web = await fixture({
      'index.html': '<html>web</html>',
      'styles.css': 'body{}',
      'game/main.js': 'web main',
      'game/platform-adapter.js': 'web adapter',
      'game/levels.js': 'shared levels',
    });
    const app = await fixture({
      'main.js': 'app main',
      'platform-adapter.js': 'app adapter',
      'app-only.js': 'app only',
    });
    const out = await make('ffm-www-');
    await copyAssets(web, out, app);

    assert.equal(await readFile(join(out, 'game/main.js'), 'utf8'), 'app main');
    assert.equal(await readFile(join(out, 'game/platform-adapter.js'), 'utf8'), 'app adapter');
    assert.equal(await readFile(join(out, 'game/app-only.js'), 'utf8'), 'app only');
    assert.equal(await readFile(join(out, 'game/levels.js'), 'utf8'), 'shared levels');
    assert.equal(await readFile(join(out, 'index.html'), 'utf8'), '<html>web</html>');
  });
});

test('the app overlay cannot smuggle excluded files into www/', async () => {
  await withDirs(async (make) => {
    const web = await fixture({
      'index.html': '<html></html>',
      'styles.css': '',
      'game/main.js': '',
    });
    const app = await fixture({
      'api.js': 'import "https://example.com"',
      'access-flow.js': '',
      'platform.test.js': '',
      'calibrate.html': '',
    });
    const out = await make('ffm-www-');
    await copyAssets(web, out, app);

    for (const rel of ['game/api.js', 'game/access-flow.js', 'game/platform.test.js', 'game/calibrate.html']) {
      await assert.rejects(stat(join(out, rel)), `${rel} must not be bundled`);
    }
  });
});

test('the overlay directory is optional', async () => {
  await withDirs(async (make) => {
    const web = await fixture({
      'index.html': '<html></html>',
      'styles.css': '',
      'game/main.js': '',
    });
    const out = await make('ffm-www-');
    await copyAssets(web, out, join(web, 'does-not-exist'));
    assert.ok((await stat(join(out, 'game/main.js'))).isFile());
  });
});

test('copying is deterministic and re-runnable', async () => {
  await withDirs(async (make) => {
    const first = await make('ffm-www-a-');
    const second = await make('ffm-www-b-');
    await copyAssets(undefined, first, join(root, 'missing-overlay'));
    await copyAssets(undefined, second, join(root, 'missing-overlay'));

    const snapshot = async (dir) => {
      const files = await listFiles(dir);
      const sizes = {};
      for (const rel of files) sizes[rel] = (await stat(join(dir, rel))).size;
      return { files, sizes };
    };
    assert.deepEqual(await snapshot(first), await snapshot(second));

    // A stale file from an earlier build must not survive the next copy.
    await writeFile(join(first, 'stale.html'), 'old');
    await copyAssets(undefined, first, join(root, 'missing-overlay'));
    assert.deepEqual(await snapshot(first), await snapshot(second));
  });
});

test('the copy fails when a required file is missing', async () => {
  await withDirs(async (make) => {
    const web = await fixture({ 'index.html': '<html></html>', 'game/main.js': '' });
    const out = await make('ffm-www-');
    await assert.rejects(copyAssets(web, out, join(web, 'missing')), /styles\.css/);
  });
});

// The app has no accounts, checkout or web legal pages, so the copied
// index.html must not carry their markup (see app-omit markers in
// static/index.html and FORBIDDEN_UI_IDS in bundle-check.mjs).
const WEB_ONLY_UI = [
  'login-btn',
  'logout-btn',
  'username-display',
  'splash-login-btn',
  'splash-user-greeting',
  'auth-modal',
  'account-modal',
  'auth-status-modal',
  'checkout-modal',
  'billing-status-display',
];

test('the copied index.html drops the web-only account and checkout markup', async () => {
  await withDirs(async (make) => {
    const out = await make('ffm-www-');
    await copyAssets(undefined, out, join(root, 'missing-overlay'));
    const index = await readFile(join(out, 'index.html'), 'utf8');

    for (const id of WEB_ONLY_UI) {
      assert.ok(!index.includes(`id="${id}"`), `${id} must not be bundled`);
    }
    assert.ok(!/href="\/?(cancel|widerruf)\.html"/.test(index), 'web-only legal links must not be bundled');

    // Gameplay and the language/mute controls stay untouched.
    for (const id of ['game', 'difficulty-select', 'pause-overlay', 'game-over', 'level-clear', 'mute-btn', 'lang-toggle-btn']) {
      assert.ok(index.includes(`id="${id}"`), `${id} must stay in the bundle`);
    }
    assert.ok(index.includes('href="impressum.html"'), 'the bundled imprint page stays linked');
    assert.ok(index.includes('href="terms.html"'), 'the bundled terms page stays linked');
  });
});

test('stripAppOnlyDom removes marked regions and rejects an unclosed marker', () => {
  const html = [
    '<div id="keep-before"></div>',
    '<!-- app-omit:start -->',
    '<div id="web-only"></div>',
    '<!-- app-omit:end -->',
    '<div id="keep-after"></div>',
  ].join('\n');
  const stripped = stripAppOnlyDom(html);
  assert.equal(stripped, '<div id="keep-before"></div>\n<div id="keep-after"></div>');
  assert.equal(stripAppOnlyDom('<p>plain</p>'), '<p>plain</p>');
  assert.throws(
    () => stripAppOnlyDom('<!-- app-omit:start -->\n<p>never closed</p>'),
    /Unclosed app-omit:start/,
  );
});

test('APP_OVERLAY points at the app-only game modules', () => {
  assert.equal(toPosix(APP_OVERLAY), toPosix(join(root, 'game')));
});
