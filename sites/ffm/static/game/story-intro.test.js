// Tests for ./story-intro.js — when the campaign intro plays.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';

import { FIRST_LEVEL, OPEN_SHOWN_KEY, createStoryIntro } from './story-intro.js';
import { setLocale, t } from './i18n.js';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const main = readFileSync(new URL('./main.js', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');

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
