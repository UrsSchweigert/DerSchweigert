import test from 'node:test';
import assert from 'node:assert/strict';
import { createHeartbeat, HEARTBEAT_PERIOD, isLowHealth } from './low-health.js';

test('the low-health rule table', () => {
  const low = (max) => [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].filter((h) => h <= max && isLowHealth(h, max));
  assert.deepEqual(low(9), [1, 2]);
  assert.deepEqual(low(7), [1, 2]);
  assert.deepEqual(low(5), [1]);
  assert.deepEqual(low(3), [1]);
  assert.equal(isLowHealth(0, 5), false);
  assert.equal(isLowHealth(1, 1), true);
});

test('the period sits between 0.8s and 1.2s', () => {
  assert.ok(HEARTBEAT_PERIOD >= 0.8 && HEARTBEAT_PERIOD <= 1.2);
});

test('the first beat is immediate and later beats follow the period', () => {
  const beat = createHeartbeat();
  assert.equal(beat.tick(0.016, true), true);
  let beats = 0;
  for (let i = 0; i < 180; i++) if (beat.tick(1 / 60, true)) beats++;
  assert.equal(beats, 3);
});

test('no beat while inactive, and re-entering beats at once', () => {
  const beat = createHeartbeat();
  assert.equal(beat.tick(5, false), false);
  assert.equal(beat.tick(0.016, true), true);
  assert.equal(beat.tick(0.016, false), false);
  assert.equal(beat.tick(0.016, true), true);
  beat.reset();
  assert.equal(beat.tick(0.016, true), true);
});

test('a long frame yields one beat only', () => {
  const beat = createHeartbeat();
  beat.tick(0.016, true);
  assert.equal(beat.tick(30, true), true);
  assert.equal(beat.tick(0.016, true), false);
});
