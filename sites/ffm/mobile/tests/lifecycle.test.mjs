// lifecycle.test.mjs — app lifecycle seam, driven by fake App/KeepAwake plugins.
//
// The module runs in the Capacitor webview where `globalThis.Capacitor.Plugins`
// carries the native bridges. These tests inject fakes instead: they prove the
// JS mapping (pause/resume, back, keep-awake) and never claim device behaviour
// such as the silent switch, audio interruptions or notch safe areas.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import {
  LAYOUT,
  LIFECYCLE_EVENTS,
  PENDING_MANUAL_GATES,
  createAppPlugin,
  createKeepAwakePlugin,
  createLifecycle,
} from '../game/lifecycle.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const staticDir = join(root, '..', 'static');

function fakeAppPlugin() {
  const listeners = new Map();
  const calls = { exitApp: 0 };
  return {
    listeners,
    calls,
    addListener(eventName, callback) {
      listeners.set(eventName, callback);
      return Promise.resolve({
        remove() {
          if (listeners.get(eventName) === callback) listeners.delete(eventName);
        },
      });
    },
    exitApp() {
      calls.exitApp++;
      return Promise.resolve();
    },
    emit(eventName, payload) {
      listeners.get(eventName)?.(payload);
    },
  };
}

function fakeKeepAwakePlugin() {
  const calls = { keepAwake: 0, allowSleep: 0 };
  return {
    calls,
    keepAwake() {
      calls.keepAwake++;
      return Promise.resolve();
    },
    allowSleep() {
      calls.allowSleep++;
      return Promise.resolve();
    },
  };
}

// Mirrors the main.js facade: pause()/resume() own the BGM, exactly like
// pauseGame()/resumeGame() call audio.pauseBGM()/resumeBGM().
function fakeGame() {
  const audio = { pauseBGM: 0, resumeBGM: 0 };
  const state = { running: false, paused: false, backs: 0, backConsumed: false };
  return {
    audio,
    state,
    start() {
      state.running = true;
      state.paused = false;
    },
    isPlaying: () => state.running && !state.paused,
    isPaused: () => state.paused,
    pause() {
      if (!state.running || state.paused) return;
      state.paused = true;
      audio.pauseBGM++;
    },
    resume() {
      if (!state.paused) return;
      state.paused = false;
      audio.resumeBGM++;
    },
    goBack() {
      state.backs++;
      return state.backConsumed;
    },
  };
}

async function setup() {
  const app = fakeAppPlugin();
  const keepAwake = fakeKeepAwakePlugin();
  const game = fakeGame();
  const lifecycle = createLifecycle({ app, keepAwake, game });
  await lifecycle.start();
  return { app, keepAwake, game, lifecycle };
}

test('plugin readers wrap the Capacitor bridges and tolerate their absence', async () => {
  assert.equal(createAppPlugin({}), null);
  assert.equal(createAppPlugin({ Capacitor: { Plugins: {} } }), null);
  assert.equal(createKeepAwakePlugin({}), null);

  const rawApp = fakeAppPlugin();
  const app = createAppPlugin({ Capacitor: { Plugins: { App: rawApp } } });
  const callback = () => {};
  const handle = await app.addListener('backButton', callback);
  assert.equal(rawApp.listeners.get('backButton'), callback);
  handle.remove();
  assert.equal(rawApp.listeners.size, 0);
  await app.exitApp();
  assert.equal(rawApp.calls.exitApp, 1);

  const rawKeepAwake = fakeKeepAwakePlugin();
  const keepAwake = createKeepAwakePlugin({ Capacitor: { Plugins: { KeepAwake: rawKeepAwake } } });
  await keepAwake.keepAwake();
  await keepAwake.allowSleep();
  assert.deepEqual(rawKeepAwake.calls, { keepAwake: 1, allowSleep: 1 });
});

test('going to the background pauses gameplay and BGM, returning resumes once', async () => {
  const { app, keepAwake, game, lifecycle } = await setup();
  game.start();
  lifecycle.setKeepAwake(true);
  assert.equal(keepAwake.calls.keepAwake, 1);

  app.emit('appStateChange', { isActive: false });
  assert.equal(game.state.paused, true);
  assert.equal(game.audio.pauseBGM, 1);
  assert.equal(keepAwake.calls.allowSleep, 1, 'background releases the keep-awake');

  app.emit('appStateChange', { isActive: true });
  assert.equal(game.state.paused, false);
  assert.equal(game.audio.resumeBGM, 1);
  assert.equal(keepAwake.calls.keepAwake, 2, 'foreground re-acquires the keep-awake');
});

test('a pause the player chose is never auto-resumed on foreground', async () => {
  const { app, game } = await setup();
  game.start();
  game.pause();
  assert.equal(game.audio.pauseBGM, 1);

  app.emit('appStateChange', { isActive: false });
  app.emit('appStateChange', { isActive: true });
  assert.equal(game.state.paused, true);
  assert.equal(game.audio.resumeBGM, 0);
});

test('a background event while not playing leaves the game alone', async () => {
  const { app, game } = await setup();
  app.emit('appStateChange', { isActive: false });
  app.emit('appStateChange', { isActive: true });
  assert.equal(game.state.paused, false);
  assert.equal(game.audio.pauseBGM, 0);
  assert.equal(game.audio.resumeBGM, 0);
});

test('Android Back pauses while playing, backs out while paused, exits otherwise', async () => {
  const { app, game } = await setup();

  app.emit('backButton');
  assert.equal(app.calls.exitApp, 1, 'back on the title screen exits the app');

  game.start();
  app.emit('backButton');
  assert.equal(game.state.paused, true);
  assert.equal(game.audio.pauseBGM, 1);
  assert.equal(app.calls.exitApp, 1, 'back while playing pauses instead of exiting');

  game.state.backConsumed = true;
  app.emit('backButton');
  assert.equal(game.state.backs, 2, 'the consumed back press reaches the game');
  assert.equal(app.calls.exitApp, 1, 'a consumed back press never exits');

  game.state.backConsumed = false;
  app.emit('backButton');
  assert.equal(app.calls.exitApp, 2, 'an unconsumed back press on a paused game exits');
});

test('keep-awake only reaches the plugin on a real state change', async () => {
  const { keepAwake, lifecycle } = await setup();
  lifecycle.setKeepAwake(false);
  assert.equal(keepAwake.calls.allowSleep, 0, 'already asleep stays asleep');

  lifecycle.setKeepAwake(true);
  lifecycle.setKeepAwake(true);
  assert.equal(keepAwake.calls.keepAwake, 1);

  lifecycle.setKeepAwake(false);
  lifecycle.setKeepAwake(false);
  assert.equal(keepAwake.calls.allowSleep, 1);
});

test('start is idempotent and stop removes both listeners', async () => {
  const { app, game, lifecycle } = await setup();
  await lifecycle.start();
  assert.deepEqual([...app.listeners.keys()].sort(), [...LIFECYCLE_EVENTS].sort());

  lifecycle.stop();
  assert.equal(app.listeners.size, 0);

  game.start();
  app.emit('appStateChange', { isActive: false });
  app.emit('backButton');
  assert.equal(game.state.paused, false, 'a stopped lifecycle no longer listens');
  assert.equal(app.calls.exitApp, 0);
});

test('a failed listener registration removes the listeners already added', async () => {
  const removed = [];
  const app = {
    addListener(eventName) {
      if (eventName === 'backButton') return Promise.reject(new Error('no back button'));
      return Promise.resolve({ remove() { removed.push(eventName); } });
    },
    exitApp() {},
  };
  const lifecycle = createLifecycle({ app, game: fakeGame() });
  await assert.rejects(lifecycle.start(), /no back button/);
  assert.deepEqual(removed, ['appStateChange']);
});

test('a missing keep-awake plugin still runs the lifecycle', async () => {
  const app = fakeAppPlugin();
  const game = fakeGame();
  const lifecycle = createLifecycle({ app, keepAwake: null, game });
  await lifecycle.start();
  game.start();
  lifecycle.setKeepAwake(true);
  app.emit('appStateChange', { isActive: false });
  assert.equal(game.state.paused, true);
  assert.equal(game.audio.pauseBGM, 1);
});

test('the layout contract matches the web build and needs no orientation lock', async () => {
  assert.equal(LAYOUT.orientation, 'any');
  assert.equal(LAYOUT.aspectRatio, '800 / 450');
  assert.match(LAYOUT.safeArea, /safe-area-inset/);
  assert.equal(LAYOUT.landscape, 'scene-left-answers-right');
  assert.equal(LAYOUT.portrait, 'scene-above-answers-below');
  assert.equal(LAYOUT.minimumTarget, 44);

  const index = await readFile(join(staticDir, 'index.html'), 'utf8');
  assert.match(index, /viewport-fit=cover/);

  const css = await readFile(join(staticDir, 'styles.css'), 'utf8');
  assert.match(css, /aspect-ratio:\s*800\s*\/\s*450/);
  for (const edge of ['top', 'right', 'bottom', 'left']) {
    assert.match(css, new RegExp(`env\\(safe-area-inset-${edge}\\)`), `styles.css pads ${edge}`);
  }

  const manifest = await readFile(join(root, 'android', 'app', 'src', 'main', 'AndroidManifest.xml'), 'utf8');
  assert.doesNotMatch(manifest, /android:screenOrientation/, 'Android must not lock the orientation');
  const plist = await readFile(join(root, 'ios', 'App', 'App', 'Info.plist'), 'utf8');
  for (const orientation of ['Portrait', 'LandscapeLeft', 'LandscapeRight']) {
    assert.ok(plist.includes(`UIInterfaceOrientation${orientation}`), `iOS allows ${orientation}`);
  }
});

test('device-only behaviour stays a pending manual gate', async () => {
  const ids = PENDING_MANUAL_GATES.map((gate) => gate.id);
  assert.deepEqual(ids, ['ios-silent-switch', 'audio-interruption', 'notched-safe-area']);
  for (const gate of PENDING_MANUAL_GATES) {
    assert.ok(gate.title.length > 0, `${gate.id} needs a title`);
    assert.ok(gate.detail.length > 0, `${gate.id} needs a detail`);
  }
  const readme = await readFile(join(root, 'README.md'), 'utf8');
  assert.match(readme, /PENDING_MANUAL_GATES/);
  for (const phrase of ['silent switch', 'audio interruptions', 'notched devices']) {
    assert.ok(readme.includes(phrase), `README documents ${phrase}`);
  }
});

test('main.js wires the lifecycle only in the app build', async () => {
  const source = await readFile(join(staticDir, 'game', 'main.js'), 'utf8');

  assert.match(source, /import\('\.\/lifecycle\.js'\)/);
  const appBlock = source.slice(source.indexOf('if (platform.isApp) {'));
  assert.ok(appBlock.includes("import('./lifecycle.js')"), 'the app branch loads lifecycle.js');
  assert.match(source, /isPlaying: \(\) => gameRunning && !paused/);
  assert.match(source, /isPaused: \(\) => paused/);
  assert.match(source, /pause: pauseGame/);
  assert.match(source, /resume: resumeGame/);
  assert.match(source, /goBack: handleAppBack/);
  assert.match(source, /appLifecycle\.start\(\)/);

  const pauseGame = source.match(/function pauseGame\(\)[\s\S]*?\n\}/)?.[0] ?? '';
  assert.match(pauseGame, /audio\.pauseBGM\(\)/);
  assert.match(pauseGame, /syncKeepAwake\(\)/);
  const resumeGame = source.match(/function resumeGame\(\)[\s\S]*?\n\}/)?.[0] ?? '';
  assert.match(resumeGame, /audio\.resumeBGM\(\)/);
  assert.match(resumeGame, /syncKeepAwake\(\)/);

  for (const fn of ['finishStartLevel', 'triggerWaveClear', 'triggerGameOver', 'clearPremiumSession', 'quitPausedGame', 'showHealTip']) {
    const body = source.match(new RegExp(`function ${fn}\\([\\s\\S]*?\\n\\}`))?.[0] ?? '';
    assert.ok(body.includes('syncKeepAwake()'), `${fn} syncs keep-awake`);
  }
});

test('the shared authorized startup activates keep-awake for finite and Endless Shapes', async () => {
  const source = await readFile(join(staticDir, 'game', 'main.js'), 'utf8');
  const finish = source.match(/function finishStartLevel\([\s\S]*?\n\}/)?.[0];
  assert.ok(finish);
  for (const endless of [false, true]) {
    const calls = [];
    const context = {
      practiceRun: { kind: 'shapes', endless }, state: { score: 0 },
      setAnswerInputVisible() {},
      gameplayTimers: [], answerClock: { reset() {} }, createAttemptSummary: () => ({}),
      resetHealHold() {}, practiceBadgeRetryButton: null,
      diffSelect: { style: {} }, pauseOverlay: { style: {} }, topBar: { style: {} },
      levelClearOverlay: { style: {} }, gameOverOverlay: { style: {} },
      updateHUDLogoutVisibility() {}, hud: { update() {} },
      audio: { startLevelBGM() {} }, animFrameId: 1,
      flushDeferredMusicVolume() {},
      syncKeepAwake: () => calls.push(context.gameRunning && !context.paused),
    };
    vm.createContext(context);
    vm.runInContext(finish, context);
    context.finishStartLevel(0, { level: 1, chapter: 1, waveSize: 30 });
    assert.equal(context.state.isShapesMode, true);
    assert.equal(context.spawnQueue.length, 0);
    assert.deepEqual(calls, [true]);
  }
});
