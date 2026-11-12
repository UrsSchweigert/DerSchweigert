// haptics.test.js — one short pattern per gameplay event, none when suppressed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HAPTIC_PATTERNS, createHaptics } from './haptics.js';

function recorder() {
  const calls = [];
  const vibrate = pattern => {
    calls.push(pattern);
    return true;
  };
  return { calls, vibrate };
}

test('the patterns are frozen and cover impact, heal and level clear', () => {
  assert.deepEqual(Object.keys(HAPTIC_PATTERNS).sort(), ['heal', 'impact', 'levelClear']);
  assert.ok(Object.isFrozen(HAPTIC_PATTERNS));
  for (const pattern of Object.values(HAPTIC_PATTERNS)) {
    assert.ok(Array.isArray(pattern), 'each pattern is a navigator.vibrate array');
    assert.ok(pattern.every(ms => Number.isInteger(ms) && ms > 0));
  }
});

test('each event vibrates exactly once with its documented pattern', () => {
  const { calls, vibrate } = recorder();
  const haptics = createHaptics({ vibrate });

  assert.equal(haptics.impact(), true);
  assert.equal(haptics.heal(), true);
  assert.equal(haptics.levelClear(), true);

  assert.deepEqual(calls, [HAPTIC_PATTERNS.impact, HAPTIC_PATTERNS.heal, HAPTIC_PATTERNS.levelClear]);
  assert.equal(calls.length, 3, 'one call per event, never more');
});

test('a missing vibrate function is a silent no-op', () => {
  for (const vibrate of [undefined, null, 'nope']) {
    const haptics = createHaptics({ vibrate });
    assert.equal(haptics.impact(), false);
    assert.equal(haptics.heal(), false);
    assert.equal(haptics.levelClear(), false);
  }
  const bare = createHaptics();
  assert.equal(bare.impact(), false);
});

test('a disabled preference suppresses every event', () => {
  const { calls, vibrate } = recorder();
  const haptics = createHaptics({ vibrate, enabled: false });
  assert.equal(haptics.enabled, false);
  haptics.impact();
  haptics.heal();
  haptics.levelClear();
  assert.deepEqual(calls, []);
});

test('reduced motion suppresses every event', () => {
  const { calls, vibrate } = recorder();
  const haptics = createHaptics({ vibrate, reducedMotion: true });
  assert.equal(haptics.reducedMotion, true);
  haptics.impact();
  haptics.heal();
  haptics.levelClear();
  assert.deepEqual(calls, []);
});

test('setEnabled and setReducedMotion take effect on the next event', () => {
  const { calls, vibrate } = recorder();
  const haptics = createHaptics({ vibrate });

  haptics.setEnabled(false);
  haptics.impact();
  assert.deepEqual(calls, []);

  haptics.setEnabled(true);
  haptics.heal();
  assert.deepEqual(calls, [HAPTIC_PATTERNS.heal]);

  haptics.setReducedMotion(true);
  haptics.impact();
  assert.deepEqual(calls, [HAPTIC_PATTERNS.heal]);

  haptics.setReducedMotion(false);
  haptics.levelClear();
  assert.deepEqual(calls, [HAPTIC_PATTERNS.heal, HAPTIC_PATTERNS.levelClear]);
});

test('a throwing or rejecting driver never breaks the caller', async () => {
  const throwing = createHaptics({
    vibrate() {
      throw new Error('device refused');
    },
  });
  assert.equal(throwing.impact(), false);

  const rejecting = createHaptics({
    vibrate: () => Promise.reject(new Error('async refused')),
  });
  assert.equal(rejecting.heal(), true);
  await Promise.resolve();
  await Promise.resolve();
});
