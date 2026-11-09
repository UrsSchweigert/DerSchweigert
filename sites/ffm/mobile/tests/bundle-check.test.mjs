import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { copyAssets, APP_OVERLAY } from '../scripts/copy-assets.mjs';
import { bundleCheck, DEFAULT_BUNDLE_DIR } from '../scripts/bundle-check.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const script = join(root, 'scripts', 'bundle-check.mjs');
const staticDir = join(root, '..', 'static');

async function withBundle(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'ffm-bundle-'));
  try {
    // Build the real app bundle, overlay included: bundle-check requires the
    // app-only overlay UI seam alongside the shared play modules.
    await copyAssets(undefined, dir, APP_OVERLAY);
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function runCheck(dir) {
  return spawnSync(process.execPath, [script, dir], { encoding: 'utf8' });
}

test('a fresh copy is a complete offline bundle', async () => {
  await withBundle(async (dir) => {
    assert.deepEqual(await bundleCheck(dir), []);
    const result = runCheck(dir);
    assert.equal(result.status, 0, result.stderr);
  });
});

test('www/game/level-data.js exposes all 60 level configs', async () => {
  await withBundle(async (dir) => {
    const file = join(dir, 'game', 'level-data.js');
    const module = await import(pathToFileURL(file).href);
    assert.equal(module.TOTAL_LEVELS, 60);
    assert.equal(module.LevelConfig.length, 60);
    module.LevelConfig.forEach((config, index) => {
      assert.equal(config.level, index + 1);
      assert.ok(Number.isFinite(config.baseline_score), `level ${config.level} needs a baseline`);
    });
    assert.equal(module.default.levels.length, 60);

    // The two free levels the app adapter serves must match the full config.
    const { LevelConfig: publicConfig } = await import('../../static/game/levels.js');
    publicConfig.forEach((config, index) => {
      const { baseline_score: _baseline, ...generated } = module.LevelConfig[index];
      assert.deepEqual(generated, config, `free level ${index + 1} must match the web config`);
    });
  });
});

test('the level config is generated into www/ only', async () => {
  await withBundle(async (dir) => {
    assert.ok((await stat(join(dir, 'game', 'level-data.js'))).isFile());
    await assert.rejects(
      stat(join(staticDir, 'game', 'level-data.js')),
      'the private curriculum must never be written into the web deploy',
    );
  });
});

test('the web-only visitor tracking script is not bundled', async () => {
  await withBundle(async (dir) => {
    const index = await readFile(join(dir, 'index.html'), 'utf8');
    assert.doesNotMatch(index, /\/api\/visit/);
    assert.match(index, /<script type="module" src="game\/main.js"><\/script>/);
    const source = await readFile(join(staticDir, 'index.html'), 'utf8');
    assert.match(source, /\/api\/visit/, 'the web page keeps its tracking script');
  });
});

test('the app shell ships no account, checkout or web-legal UI', async () => {
  await withBundle(async (dir) => {
    const index = await readFile(join(dir, 'index.html'), 'utf8');
    for (const id of ['login-btn', 'logout-btn', 'splash-login-btn', 'auth-modal', 'account-modal', 'auth-status-modal', 'checkout-modal', 'leaderboard-complete-profile']) {
      assert.ok(!index.includes(`id="${id}"`), `${id} must not be bundled`);
    }
    assert.doesNotMatch(index, /href="\/?(cancel|widerruf)\.html"/);
    assert.deepEqual(await bundleCheck(dir), []);

    // The website keeps the same markup; only the app copy strips it.
    const source = await readFile(join(staticDir, 'index.html'), 'utf8');
    for (const id of ['login-btn', 'splash-login-btn', 'auth-modal', 'account-modal', 'checkout-modal']) {
      assert.ok(source.includes(`id="${id}"`), `${id} must stay on the website`);
    }
    assert.match(source, /href="cancel\.html"/);
  });
});

test('account or checkout markup fails the bundle check', async () => {
  await withBundle(async (dir) => {
    const indexPath = join(dir, 'index.html');
    const index = await readFile(indexPath, 'utf8');
    await writeFile(indexPath, index.replace('</body>', '<div id="account-modal"></div>\n</body>'));
    const problems = await bundleCheck(dir);
    assert.ok(problems.some((problem) => problem.includes('forbidden app UI')), problems.join('\n'));

    const result = runCheck(dir);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /forbidden app UI/);
  });
});

test('a web-only cancellation link in the app shell fails the bundle check', async () => {
  await withBundle(async (dir) => {
    const indexPath = join(dir, 'index.html');
    const index = await readFile(indexPath, 'utf8');
    await writeFile(indexPath, index.replace('</body>', '<a href="cancel.html">Cancellation</a>\n</body>'));
    const problems = await bundleCheck(dir);
    assert.ok(problems.some((problem) => problem.includes('web-only legal link')), problems.join('\n'));
  });
});

test('a missing required file fails the bundle check', async () => {
  await withBundle(async (dir) => {
    await rm(join(dir, 'game', 'level-data.js'));
    const problems = await bundleCheck(dir);
    assert.ok(problems.some((problem) => problem.includes('game/level-data.js')), problems.join('\n'));

    const result = runCheck(dir);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /missing required file/);
  });
});

test('a missing core play module fails the bundle check', async () => {
  await withBundle(async (dir) => {
    await rm(join(dir, 'game', 'levels.js'));
    const problems = await bundleCheck(dir);
    assert.ok(problems.some((problem) => problem.includes('game/levels.js')), problems.join('\n'));
  });
});

test('the app-only overlay UI module and stylesheet are bundled', async () => {
  await withBundle(async (dir) => {
    for (const rel of ['game/mobile-ui.js', 'game/mobile-ui.css', 'game/timer-bar.js']) {
      assert.ok((await stat(join(dir, rel))).isFile(), `${rel} must be bundled`);
    }
    const source = await readFile(join(dir, 'game', 'mobile-ui.js'), 'utf8');
    assert.match(source, /export function mountMobileUi/);
    assert.doesNotMatch(source, /https?:\/\//, 'the overlay must stay offline');
    const timerBar = await readFile(join(dir, 'game', 'timer-bar.js'), 'utf8');
    assert.match(timerBar, /export function createTimerBar/);
    assert.match(timerBar, /export function timerBarRgb/);
    assert.doesNotMatch(timerBar, /https?:\/\//, 'the timer bar must stay offline');
    assert.deepEqual(await bundleCheck(dir), []);
  });
});

test('a missing overlay UI module fails the bundle check', async () => {
  await withBundle(async (dir) => {
    await rm(join(dir, 'game', 'mobile-ui.js'));
    const problems = await bundleCheck(dir);
    assert.ok(problems.some((problem) => problem.includes('game/mobile-ui.js')), problems.join('\n'));

    const result = runCheck(dir);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /missing required file: game\/mobile-ui\.js/);
  });
});

test('an FFM API call fails the bundle check', async () => {
  await withBundle(async (dir) => {
    const indexPath = join(dir, 'index.html');
    const index = await readFile(indexPath, 'utf8');
    await writeFile(
      indexPath,
      index.replace(
        '</body>',
        '  <script>fetch(\'/api/visit\', { method: \'POST\' });</script>\n</body>',
      ),
    );
    const problems = await bundleCheck(dir);
    assert.ok(problems.some((problem) => problem.includes("fetch('/api/")), problems.join('\n'));

    const result = runCheck(dir);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /FFM API call/);
  });
});

test('a remote first-party URL fails the bundle check', async () => {
  await withBundle(async (dir) => {
    const levels = join(dir, 'game', 'levels.js');
    await writeFile(levels, `${await readFile(levels, 'utf8')}\n// https://ffm.derschweigert.de/api\n`);
    const problems = await bundleCheck(dir);
    assert.ok(
      problems.some((problem) => problem.includes('https://ffm.derschweigert.de/api')),
      problems.join('\n'),
    );

    const result = runCheck(dir);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /remote first-party URL/);
  });
});

test('only approved navigational legal links are allowed', async () => {
  await withBundle(async (dir) => {
    const terms = join(dir, 'terms.html');
    const html = await readFile(terms, 'utf8');
    assert.match(html, /https:\/\/www\.derschweigert\.de\/nutzungsbedingungen/);
    assert.deepEqual(await bundleCheck(dir), []);

    await writeFile(
      terms,
      html.replace('</body>', '<a href="https://ffm.derschweigert.de/terms">Terms</a>\n</body>'),
    );
    const problems = await bundleCheck(dir);
    assert.ok(
      problems.some((problem) => problem.includes('https://ffm.derschweigert.de/terms')),
      problems.join('\n'),
    );
  });
});

test('bundle-check defaults to the copied www/ directory', async () => {
  assert.equal(DEFAULT_BUNDLE_DIR, join(root, 'www'));
});
