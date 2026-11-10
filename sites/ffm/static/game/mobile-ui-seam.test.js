// mobile-ui-seam.test.js — the web build must stay untouched by the app-only
// overlay UI seam.
//
// main.js loads ./mobile-ui.js only behind platform.isApp, exactly like
// ./legal.js and ./lifecycle.js. These tests prove the guard: with the web
// adapter the branch performs no import, touches no DOM and leaves the
// canvas/game state alone, and a failing overlay module cannot break startup.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('./main.js', import.meta.url), 'utf8');

function appBlock() {
  const start = source.indexOf('if (platform.isApp) {');
  assert.ok(start >= 0, 'main.js keeps the app-only branch');
  const end = source.indexOf('\n}\n', start);
  assert.ok(end > start, 'the app-only branch must close at column zero');
  return source.slice(start, end + 2);
}

// Replace the three guarded dynamic imports with stubs so the branch can run
// in a vm context. The source assertions below pin that the real imports are
// dynamic and app-only.
function probeSource() {
  return appBlock()
    .replace(/import\('\.\/legal\.js'\)/g, 'loadLegal()')
    .replace(/import\('\.\/lifecycle\.js'\)/g, 'loadLifecycle()')
    .replace(/import\('\.\/mobile-ui\.js'\)/g, 'loadMobileUi()');
}

function context({ isApp, calls, loadMobileUi }) {
  return vm.createContext({
    platform: {
      isApp,
      refreshEntitlement() {
        calls.push('entitlement');
        return Promise.resolve(false);
      },
    },
    document: {
      visibilityState: 'visible',
      addEventListener() {
        calls.push('listener');
      },
    },
    mobileUi: null,
    appLifecycle: null,
    gameRunning: false,
    paused: false,
    pauseGame() {},
    resumeGame() {},
    handleAppBack() {},
    syncKeepAwake() {},
    getLocale: () => 'en',
    onLocaleChange() {},
    loadLegal() {
      calls.push('legal');
      return Promise.resolve({ setupTitleLegalLinks() {} });
    },
    loadLifecycle() {
      calls.push('lifecycle');
      return Promise.resolve({ createAppPlugin: () => null });
    },
    loadMobileUi,
    calls,
  });
}

test('the web adapter performs no overlay import and touches no DOM', () => {
  const calls = [];
  const ctx = context({
    isApp: false,
    calls,
    loadMobileUi() {
      calls.push('mobile-ui');
      return Promise.resolve({ mountMobileUi: () => ({}) });
    },
  });
  vm.runInContext(`${probeSource()}\nwebAfterBlock = true;`, ctx);

  assert.deepEqual(ctx.calls, [], 'the web build must not run any app-only wiring');
  assert.equal(ctx.webAfterBlock, true);
  assert.equal(ctx.mobileUi, null, 'the web build keeps no overlay UI handle');
  assert.equal(ctx.appLifecycle, null);
});

test('a failing overlay module never breaks startup', async () => {
  const calls = [];
  const ctx = context({
    isApp: true,
    calls,
    loadMobileUi() {
      calls.push('mobile-ui');
      return Promise.reject(new Error('overlay module missing'));
    },
  });
  vm.runInContext(`${probeSource()}\nappAfterBlock = true;`, ctx);

  assert.equal(ctx.appAfterBlock, true, 'startup continues after the failed import');
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(ctx.mobileUi, null, 'a failed mount leaves the handle null');
  assert.ok(calls.includes('mobile-ui'));
});

test('the app branch imports the overlay module dynamically and tolerates failure', () => {
  const block = appBlock();
  const outside = source.replace(block, '');

  assert.doesNotMatch(outside, /import\('\.\/mobile-ui\.js'\)/,
    'only the app branch may import the overlay module');
  assert.equal((source.match(/import\('\.\/mobile-ui\.js'\)/g) ?? []).length, 1);
  assert.doesNotMatch(source, /from '\.\/mobile-ui\.js'/, 'the web build must not statically import it');
  assert.match(block, /import\('\.\/mobile-ui\.js'\)\s*\n\s*\.then\([\s\S]*?\)\s*\n\s*\.catch\(\(\) => \{\}\)/);
  assert.doesNotMatch(block, /\b(canvas|renderer|ctx|requestAnimationFrame)\b/,
    'the seam must not touch canvas or rendering state');
});

test('the web page keeps no app-only stylesheet link', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  assert.doesNotMatch(html, /mobile-ui/, 'the app-only stylesheet is injected at runtime');
});

test('the overlay module and stylesheet are absent from the web source tree', async () => {
  for (const rel of ['mobile-ui.js', 'mobile-ui.css']) {
    await assert.rejects(
      stat(new URL(`./${rel}`, import.meta.url)),
      { code: 'ENOENT' },
      `${rel} must ship only through the app overlay`,
    );
  }
});
