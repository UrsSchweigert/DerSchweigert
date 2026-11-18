// Tests for ./story-intro.js — when the campaign intro plays.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';

import vm from 'node:vm';

import {
  FINISH_SCENE, FINISH_SHOWN_KEY, FIRST_LEVEL, OPEN_SHOWN_KEY, SCENE_WAIT_MAX_MS, createStoryIntro,
} from './story-intro.js';
import { setLocale, t } from './i18n.js';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const main = readFileSync(new URL('./main.js', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
const storyIndex = JSON.parse(readFileSync(new URL('../story/scenes/index.json', import.meta.url), 'utf8'));

function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => { data.set(key, String(value)); },
  };
}

function recorder(result = 'ended') {
  const calls = [];
  const play = async (scene) => { calls.push(scene); return result; };
  return { calls, play };
}

test('the first open plays the intro once and marks the install', async () => {
  const storage = memoryStorage();
  const { calls, play } = recorder();
  const intro = createStoryIntro({ play, storage });

  assert.equal(intro.hasShownAtOpen(), false);
  assert.equal(await intro.playOnOpen(), 'ended');
  assert.deepEqual(calls, ['intro']);
  assert.equal(storage.data.get(OPEN_SHOWN_KEY), '1');
  assert.equal(intro.hasShownAtOpen(), true);
  assert.equal(intro.hasPlayedThisRun('intro'), true);
});

const ACT_OPENS = { 1: 'act-1', 11: 'act-2', 21: 'act-3', 31: 'act-4', 41: 'act-5', 51: 'act-6' };
const sceneForLevel = async level => ACT_OPENS[level] ?? null;

test('the first run does not stack act I on top of the prologue', async () => {
  const storage = memoryStorage();
  const { calls, play } = recorder();
  const intro = createStoryIntro({ play, storage, sceneForLevel });

  await intro.playOnOpen();
  assert.equal(await intro.playBeforeLevel(FIRST_LEVEL), null);
  assert.deepEqual(calls, ['intro']);
});

test('a later run opens act I at level 1', async () => {
  const storage = memoryStorage({ [OPEN_SHOWN_KEY]: '1' });
  const { calls, play } = recorder();
  const intro = createStoryIntro({ play, storage, sceneForLevel });

  assert.equal(await intro.playOnOpen(), null);
  assert.deepEqual(calls, []);
  assert.equal(await intro.playBeforeLevel(FIRST_LEVEL), 'ended');
  assert.deepEqual(calls, ['act-1']);
});

test('each act opening plays once per run, at its own first level', async () => {
  const storage = memoryStorage({ [OPEN_SHOWN_KEY]: '1' });
  const { calls, play } = recorder('skipped');
  const intro = createStoryIntro({ play, storage, sceneForLevel });

  assert.equal(await intro.playBeforeLevel(11), 'skipped');
  assert.equal(await intro.playBeforeLevel(11), null);
  assert.equal(await intro.playBeforeLevel('11'), null);
  assert.equal(await intro.playBeforeLevel(21), 'skipped');
  assert.deepEqual(calls, ['act-2', 'act-3']);
});

test('levels inside an act, and levels before or after one, play nothing', async () => {
  const storage = memoryStorage({ [OPEN_SHOWN_KEY]: '1' });
  const { calls, play } = recorder();
  const intro = createStoryIntro({ play, storage, sceneForLevel });

  for (const level of [0, 2, 3, 10, 12, 20, 60, null, undefined]) {
    assert.equal(await intro.playBeforeLevel(level), null);
  }
  assert.deepEqual(calls, []);
});

test('without a scene lookup the acts stay silent', async () => {
  const storage = memoryStorage({ [OPEN_SHOWN_KEY]: '1' });
  const { calls, play } = recorder();
  const intro = createStoryIntro({ play, storage });

  assert.equal(await intro.playBeforeLevel(1), null);
  assert.deepEqual(calls, []);
});

test('every diorama starts the title playlist before the scene begins', async () => {
  const storage = memoryStorage({ [OPEN_SHOWN_KEY]: '1' });
  const events = [];
  const intro = createStoryIntro({
    play: async (scene) => { events.push(`play:${scene}`); return 'ended'; },
    beforeScene: () => events.push('music'),
    storage,
    sceneForLevel,
  });

  await intro.playBeforeLevel(11);
  assert.deepEqual(events, ['music', 'play:act-2'], 'the menu playlist starts, then the act opens');

  // A repeated level inside the same act plays the scene once, so it does not
  // restart the music either.
  await intro.playBeforeLevel(11);
  assert.deepEqual(events, ['music', 'play:act-2']);
});

test('the prologue also gets the title music', async () => {
  const storage = memoryStorage();
  const events = [];
  const intro = createStoryIntro({
    play: async (scene) => { events.push(`play:${scene}`); return 'ended'; },
    beforeScene: () => events.push('music'),
    storage,
  });

  await intro.playOnOpen();
  assert.deepEqual(events, ['music', 'play:intro']);
});

test('failing to start the music never costs the player the scene', async t => {
  const storage = memoryStorage();
  const errors = t.mock.method(console, 'error', () => {});
  const { calls, play } = recorder();
  const intro = createStoryIntro({
    play,
    beforeScene: () => { throw new Error('no audio context'); },
    storage,
  });

  assert.equal(await intro.playOnOpen(), 'ended');
  assert.deepEqual(calls, ['intro']);
  assert.equal(errors.mock.callCount(), 1);
});

test('unavailable storage still shows the intro, once', async () => {
  const broken = {
    getItem() { throw new Error('blocked'); },
    setItem() { throw new Error('blocked'); },
  };
  const { calls, play } = recorder();
  const intro = createStoryIntro({ play, storage: broken });

  assert.equal(intro.hasShownAtOpen(), false);
  assert.equal(await intro.playOnOpen(), 'ended');
  assert.deepEqual(calls, ['intro']);
});

test('a missing scene never blocks the game', async t => {
  const storage = memoryStorage();
  const intro = createStoryIntro({
    play: async () => { throw new Error('HTTP 404'); },
    storage,
  });
  const errors = t.mock.method(console, 'error', () => {});

  assert.equal(await intro.playOnOpen(), null);
  assert.equal(storage.data.get(OPEN_SHOWN_KEY), '1');
  assert.equal(errors.mock.callCount(), 1);
});

test('a play() function is required', () => {
  assert.throws(() => createStoryIntro({}), /play\(\) function/);
});

test('the player can ask for the prologue again after it played at open', async () => {
  const storage = memoryStorage();
  const events = [];
  const intro = createStoryIntro({
    play: async (scene) => { events.push(`play:${scene}`); return 'skipped'; },
    beforeScene: () => events.push('music'),
    storage,
  });

  await intro.playOnOpen();
  assert.equal(await intro.replay(), 'skipped');
  assert.deepEqual(events, ['music', 'play:intro', 'music', 'play:intro'],
    'the replay runs the prologue again with the title playlist under it');
  assert.equal(storage.data.get(OPEN_SHOWN_KEY), '1', 'a replay never rewrites the install flag');
});

test('a second scene never stacks on the one already playing', async () => {
  const storage = memoryStorage();
  const calls = [];
  let release = null;
  const intro = createStoryIntro({
    play: (scene) => { calls.push(scene); return new Promise((resolve) => { release = resolve; }); },
    storage,
  });

  const opening = intro.playOnOpen();
  assert.equal(await intro.replay(), null, 'the running prologue is not duplicated');
  assert.deepEqual(calls, ['intro']);

  release('ended');
  assert.equal(await opening, 'ended');

  const second = intro.replay();
  release('skipped');
  assert.equal(await second, 'skipped');
  assert.deepEqual(calls, ['intro', 'intro'], 'once the screen is free, a replay is allowed');
});

test('a level start asked for while a scene is on screen waits for it', async () => {
  const storage = memoryStorage();
  const starts = [];
  let release = null;
  const intro = createStoryIntro({
    play: (scene) => { starts.push(scene); return new Promise((resolve) => { release = resolve; }); },
    storage,
    sceneForLevel,
  });

  // The prologue is loading/playing over the title screen, and the player taps
  // Play before it is finished. The level used to start underneath it, taking
  // over the menu music while the scene was still on screen.
  const opening = intro.playOnOpen();
  let settled = false;
  const levelStart = intro.playBeforeLevel(FIRST_LEVEL).then((scene) => { settled = true; return scene; });
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(settled, false, 'the level start must wait for the prologue');
  assert.deepEqual(starts, ['intro'], 'nothing may start underneath the prologue');

  release('ended');
  assert.equal(await opening, 'ended');
  assert.equal(await levelStart, null, 'the prologue covers act I, so no second scene');
  assert.deepEqual(starts, ['intro']);
});

test('the next act waits for the scene already on screen', async () => {
  const storage = memoryStorage({ [OPEN_SHOWN_KEY]: '1' });
  const starts = [];
  const releases = [];
  const intro = createStoryIntro({
    play: (scene) => { starts.push(scene); return new Promise((resolve) => { releases.push(resolve); }); },
    storage,
    sceneForLevel,
  });

  const firstAct = intro.playBeforeLevel(11);
  await new Promise((resolve) => setTimeout(resolve, 10));
  const secondAct = intro.playBeforeLevel(21);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(starts, ['act-2'], 'act III may not open over act II');

  releases[0]('ended');
  assert.equal(await firstAct, 'ended');
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(starts, ['act-2', 'act-3'], 'the queued act opens once the screen is free');
  releases[1]('skipped');
  assert.equal(await secondAct, 'skipped');
});

test('a manual replay still keeps the act I opening from stacking on it', async () => {
  const storage = memoryStorage({ [OPEN_SHOWN_KEY]: '1' });
  const { calls, play } = recorder();
  const intro = createStoryIntro({ play, storage, sceneForLevel });

  assert.equal(await intro.replay(), 'ended');
  assert.equal(await intro.playBeforeLevel(FIRST_LEVEL), null);
  assert.deepEqual(calls, ['intro']);
});

test('the title bar offers a circular dragon-arrow replay button left of Login', async () => {
  const bar = html.match(/<div id="top-bar">([\s\S]*?)<div id="cookie-banner"/)?.[1];
  assert.ok(bar, 'top bar markup missing');
  const replayAt = bar.indexOf('id="btn-replay-intro"');
  assert.ok(replayAt >= 0, 'replay button must sit in the title bar');
  assert.ok(replayAt < bar.indexOf('id="login-btn"'), 'the replay button leads the bar, left of Login');
  assert.match(bar, /<button type="button" id="btn-replay-intro" class="intro-replay-btn"[^>]*data-i18n-aria-label="splash\.replayIntro"/);
  assert.match(bar, /id="btn-replay-intro"[\s\S]{0,300}<img class="intro-replay-icon" src="game\/intro-replay\.webp"[^>]*alt=""/);
  assert.match(main, /document\.getElementById\('btn-replay-intro'\)\?\.addEventListener\('click', \(\) => \{\s*storyIntro\.replay\(\);/);
  const button = styles.match(/^#top-bar #btn-replay-intro \{([^}]*)\}/m)?.[1];
  assert.ok(button, '#top-bar #btn-replay-intro rule missing');
  assert.match(button, /width:\s*44px;/);
  assert.match(button, /height:\s*44px;/);
  assert.match(button, /border-radius:\s*50%;/);
  assert.match(styles, /^\.intro-replay-icon \{[^}]*width:\s*100%;[^}]*height:\s*100%;[^}]*object-fit:\s*contain;/m);
  const icon = await readFile(new URL('./intro-replay.webp', import.meta.url));
  assert.equal(icon.subarray(0, 4).toString('latin1'), 'RIFF', 'the replay icon must be a real WebP');
  assert.equal(icon.subarray(8, 12).toString('latin1'), 'WEBP');
  setLocale('en');
  assert.equal(t('splash.replayIntro'), 'Replay the intro');
  setLocale('de');
  assert.equal(t('splash.replayIntro'), 'Intro erneut ansehen');
  setLocale('en');
});

// --- The finish (outro) after Campaign I's last level ---

test('the finish plays the first time this install finishes the game, and only then', async () => {
  const storage = memoryStorage({ [OPEN_SHOWN_KEY]: '1' });
  const { calls, play } = recorder();
  const intro = createStoryIntro({ play, storage, sceneForLevel });

  assert.equal(intro.hasShownFinish(), false);
  assert.equal(await intro.playFinish(), 'ended');
  assert.deepEqual(calls, [FINISH_SCENE]);
  assert.equal(storage.data.get(FINISH_SHOWN_KEY), '1');
  assert.equal(await intro.playFinish(), null, 'a second finish of level 60 plays nothing');

  // Another session on the same install has seen it too.
  const later = createStoryIntro({ play, storage, sceneForLevel });
  assert.equal(await later.playFinish(), null);
  assert.deepEqual(calls, [FINISH_SCENE]);
});

test('the finish waits for a scene already on screen instead of stacking on it', async () => {
  const storage = memoryStorage();
  const starts = [];
  const releases = [];
  const intro = createStoryIntro({
    play: (scene) => { starts.push(scene); return new Promise((resolve) => { releases.push(resolve); }); },
    storage,
  });
  const prologue = intro.playOnOpen();
  const finish = intro.playFinish();
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(starts, ['intro']);
  releases[0]('skipped');
  await prologue;
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(starts, ['intro', FINISH_SCENE]);
  releases[1]('ended');
  assert.equal(await finish, 'ended');
});

test('a finish that never ends cannot hold back the victory screen', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const warn = t.mock.method(console, 'warn', () => {});
  const intro = createStoryIntro({ play: () => new Promise(() => {}), storage: memoryStorage() });
  const finish = intro.playFinish();
  await Promise.resolve();
  t.mock.timers.tick(SCENE_WAIT_MAX_MS);
  assert.equal(await finish, null);
  assert.equal(warn.mock.callCount(), 1);
});

test('a broken finish scene is logged and shown only once', async (t) => {
  const storage = memoryStorage();
  const errors = t.mock.method(console, 'error', () => {});
  const intro = createStoryIntro({ play: async () => { throw new Error('HTTP 404'); }, storage });
  assert.equal(await intro.playFinish(), null);
  assert.equal(storage.data.get(FINISH_SHOWN_KEY), '1');
  assert.equal(errors.mock.callCount(), 1);
});

test('the story index has a finish slot the controller plays', () => {
  const finish = storyIndex.scenes.filter((entry) => entry.slot?.type === 'finish');
  assert.deepEqual(finish.map((entry) => entry.id), [FINISH_SCENE]);
});

// "Finish game" on the level-clear card: the level-clear handler runs in a
// sandbox with the game's collaborators stubbed, like mobile-score-flow.test.js.
const clearSource = main.match(/function triggerLevelClear\(\) \{[\s\S]*?\n\}/)?.[0];

function levelClearContext({ level, campaign = 1, shapes = false, finish = async () => 'ended' }) {
  const element = () => ({ style: { setProperty() {} }, disabled: false, textContent: '' });
  const events = [];
  const context = {
    state: { level, score: 900, difficulty: 'easy', campaign, isShapesMode: shapes },
    setAnswerInputVisible() {},
    practiceRun: null,
    levelStartScore: 100, runProfileId: 'player-a',
    completedLevelSave: null, completionPending: false,
    attemptSummary: { snapshot: () => ({}) },
    renderAttemptAccomplishment() {},
    createCompletionId: () => 'completion-1',
    createLevelCompletion: () => async () => { if (!events.includes('saved')) events.push('saved'); return null; },
    campaign2Progress: () => ({ markCleared() {} }),
    TOTAL_LEVELS: 60, TOTAL_LEVELS_2: 40,
    platform: { isApp: true, isLoggedIn: false },
    t: (key) => key,
    levelClearOverlay: element(), levelClearTitle: element(), levelClearScore: element(),
    levelClearPreview: element(),
    topBar: element(), btnNextLevel: element(), btnReplayLevel: element(),
    btnSaveScoreReturnTitle: element(), diffSelect: element(),
    profileUI: null, audio: { stopBGM() {} },
    updateHUDLogoutVisibility() {},
    async refreshProfileAndLeaderboard() {},
    storyIntro: { async playFinish() { events.push('finish'); return finish(); } },
    triggerGameOver(won) { events.push(`gameOver:${won}`); },
    startLevel(index) { events.push(`start:${index}`); },
    console: { error() {} },
  };
  vm.createContext(context);
  vm.runInContext(clearSource, context);
  return { context, events };
}

test('Finish game on Campaign I level 60 saves, plays the finish, then the victory screen', async () => {
  assert.ok(clearSource, 'triggerLevelClear must exist');
  const { context, events } = levelClearContext({ level: 60 });
  await context.triggerLevelClear();
  assert.deepEqual(events, ['saved'], 'the level is saved before anything else');
  await context.btnNextLevel.onclick();
  assert.deepEqual(events, ['saved', 'finish', 'gameOver:true']);
});

test('the victory screen still follows when the finish fails', async () => {
  const { context, events } = levelClearContext({ level: 60, finish: async () => { throw new Error('boom'); } });
  await context.triggerLevelClear();
  await context.btnNextLevel.onclick();
  assert.deepEqual(events, ['saved', 'finish', 'gameOver:true']);
});

test('no finish for Campaign II, shapes mode, or any level before the last', async () => {
  const campaign2 = levelClearContext({ level: 40, campaign: 2 });
  await campaign2.context.triggerLevelClear();
  await campaign2.context.btnNextLevel.onclick();
  assert.deepEqual(campaign2.events, ['gameOver:true'], 'Campaign II ends without the story');

  const shapes = levelClearContext({ level: 60, shapes: true });
  await shapes.context.triggerLevelClear();
  await shapes.context.btnNextLevel.onclick();
  assert.ok(!shapes.events.includes('finish'));

  const earlier = levelClearContext({ level: 59 });
  await earlier.context.triggerLevelClear();
  await earlier.context.btnNextLevel.onclick();
  assert.deepEqual(earlier.events, ['saved', 'start:59']);
});
