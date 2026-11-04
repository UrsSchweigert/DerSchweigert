import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile, readFile, readdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  APP_OVERLAY,
  EXCLUDED,
  REQUIRED_FILES,
  copyAssets,
  isExcluded,
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

    const expected = (await listFiles(staticDir)).filter((rel) => !isExcluded(rel));
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

test('APP_OVERLAY points at the app-only game modules', () => {
  assert.equal(toPosix(APP_OVERLAY), toPosix(join(root, 'game')));
});
