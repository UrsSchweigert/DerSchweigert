// Tests for ./story-intro.js — when the campaign intro plays.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { OPEN_SHOWN_KEY, createStoryIntro } from './story-intro.js';

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
  assert.equal(intro.hasPlayedThisRun(), true);
});

test('the first run does not repeat the intro when level 1 starts', async () => {
  const storage = memoryStorage();
  const { calls, play } = recorder();
  const intro = createStoryIntro({ play, storage });

  await intro.playOnOpen();
  assert.equal(await intro.playBeforeLevel(1), null);
  assert.deepEqual(calls, ['intro']);
});

test('a later run plays the intro before level 1', async () => {
  const storage = memoryStorage({ [OPEN_SHOWN_KEY]: '1' });
  const { calls, play } = recorder();
  const intro = createStoryIntro({ play, storage });

  assert.equal(await intro.playOnOpen(), null);
  assert.deepEqual(calls, []);
  assert.equal(await intro.playBeforeLevel(1), 'ended');
  assert.deepEqual(calls, ['intro']);
});

test('the intro plays at most once per run', async () => {
  const storage = memoryStorage({ [OPEN_SHOWN_KEY]: '1' });
  const { calls, play } = recorder('skipped');
  const intro = createStoryIntro({ play, storage });

  assert.equal(await intro.playBeforeLevel(1), 'skipped');
  assert.equal(await intro.playBeforeLevel(1), null);
  assert.equal(await intro.playBeforeLevel('1'), null);
  assert.deepEqual(calls, ['intro']);
});

test('only level 1 triggers the intro', async () => {
  const storage = memoryStorage({ [OPEN_SHOWN_KEY]: '1' });
  const { calls, play } = recorder();
  const intro = createStoryIntro({ play, storage });

  for (const level of [0, 2, 3, 60, null, undefined]) {
    assert.equal(await intro.playBeforeLevel(level), null);
  }
  assert.deepEqual(calls, []);
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
  assert.equal(await intro.playBeforeLevel(1), null);
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
