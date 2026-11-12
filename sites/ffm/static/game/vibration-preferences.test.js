// vibration-preferences.test.js — persisted haptics toggle with a safe default.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHaptics } from './haptics.js';
import {
  DEFAULT_VIBRATION_ENABLED,
  VIBRATION_PREFERENCES_KEY,
  applyVibrationPreferences,
  parseVibrationPreferences,
  readVibrationPreferences,
  writeVibrationPreferences,
} from './vibration-preferences.js';

function memoryStorage(seed) {
  const values = new Map(seed === undefined
    ? [] : [[VIBRATION_PREFERENCES_KEY, seed]]);
  return {
    values,
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
}

test('the storage key and default are stable', () => {
  assert.equal(VIBRATION_PREFERENCES_KEY, 'arithmo-haptics-preference-v1');
  assert.equal(DEFAULT_VIBRATION_ENABLED, true);
});

test('the default is enabled before anything is stored', () => {
  assert.deepEqual(readVibrationPreferences(memoryStorage()), { enabled: true });
  assert.deepEqual(readVibrationPreferences(undefined), { enabled: true });
  assert.deepEqual(readVibrationPreferences(null), { enabled: true });
});

test('the choice survives a write/read round trip', () => {
  const storage = memoryStorage();
  assert.equal(writeVibrationPreferences(storage, false), true);
  assert.deepEqual(JSON.parse(storage.getItem(VIBRATION_PREFERENCES_KEY)), { enabled: false });
  assert.deepEqual(readVibrationPreferences(storage), { enabled: false });

  assert.equal(writeVibrationPreferences(storage, true), true);
  assert.deepEqual(readVibrationPreferences(storage), { enabled: true });
});

test('corrupt values fall back to enabled', () => {
  for (const raw of ['{not json', 'null', '[]', '42', '"off"', '{}', '{"enabled":"yes"}']) {
    assert.equal(parseVibrationPreferences(raw), null, raw);
    assert.deepEqual(readVibrationPreferences(memoryStorage(raw)), { enabled: true }, raw);
  }
});

test('a storage that throws falls back instead of breaking the game', () => {
  const denied = {
    getItem() { throw new Error('denied'); },
    setItem() { throw new Error('denied'); },
  };
  assert.deepEqual(readVibrationPreferences(denied), { enabled: true });
  assert.equal(writeVibrationPreferences(denied, false), false);
});

test('applying a saved record changes the next event without a new module', () => {
  const calls = [];
  const haptics = createHaptics({ vibrate: pattern => calls.push(pattern) });
  assert.equal(applyVibrationPreferences(haptics, { enabled: false }), false);
  haptics.impact();
  assert.deepEqual(calls, []);

  assert.equal(applyVibrationPreferences(haptics, { enabled: true }), true);
  haptics.impact();
  assert.equal(calls.length, 1);

  assert.equal(applyVibrationPreferences(haptics, null), true, 'a missing record restores the default');
  haptics.impact();
  assert.equal(calls.length, 2);
});
