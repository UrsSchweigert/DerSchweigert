// frame-delta.test.js — the game loop must never hand a gameplay timer an
// interval it rejects. createAnswerClock().advance() throws on a non-finite or
// negative step, which used to abort the whole loop; the manual kick-off with
// performance.now() can produce exactly that against the next frame timestamp.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { frameDelta, MAX_FRAME_DELTA } from './frame-delta.js';
import { createAnswerClock } from './encounter-flow.js';

test('the first frame advances nothing', () => {
  assert.equal(frameDelta(1234.5, null), 0);
  assert.equal(frameDelta(1234.5, undefined), 0);
});

test('a normal frame advances by its own duration', () => {
  assert.equal(frameDelta(1016, 1000), 0.016);
  assert.ok(Math.abs(frameDelta(1033, 1000) - 0.033) < 1e-9);
});

test('a frame whose timestamp predates the manual kick-off advances nothing', () => {
  // gameLoop(performance.now()) records a time taken inside the current task,
  // which can be later than the moment the next animation frame started.
  assert.equal(frameDelta(5000.2, 5000.9), 0);
  assert.equal(frameDelta(5000, 5000), 0);
});

test('a stalled frame cannot advance more than the cap', () => {
  assert.equal(frameDelta(600000, 1000), MAX_FRAME_DELTA);
  assert.equal(MAX_FRAME_DELTA, 0.1);
});

test('non-finite times advance nothing', () => {
  assert.equal(frameDelta(Number.NaN, 1000), 0);
  assert.equal(frameDelta(1000, Number.NaN), 0);
  assert.equal(frameDelta(Number.POSITIVE_INFINITY, 1000), 0);
  assert.equal(frameDelta(undefined, 1000), 0);
});

test('every produced step is accepted by the answer clock', () => {
  const clock = createAnswerClock();
  const samples = [
    [1234.5, null], [5000.2, 5000.9], [1016, 1000], [600000, 1000],
    [Number.NaN, 1000], [1000, Number.NaN], [undefined, 1000],
  ];
  for (const [timestamp, previous] of samples) {
    const dt = frameDelta(timestamp, previous);
    assert.doesNotThrow(() => clock.advance(dt, true), `advance(${dt}) was rejected`);
  }
  assert.ok(clock.read() > 0);
});

test('the previous one-sided clamp is what aborted the loop', () => {
  // Regression: the loop used to compute Math.min((ts - lastTs) / 1000, 0.1),
  // which caps a long stall but lets a negative step through. One frame whose
  // timestamp preceded the manual kick-off then threw inside the loop and
  // stopped gameplay for the rest of the session.
  const previousTimestamp = 5000.9;
  const frameTimestamp = 5000.2;
  const clock = createAnswerClock();
  const oldStep = Math.min((frameTimestamp - previousTimestamp) / 1000, 0.1);
  assert.ok(oldStep < 0, 'the old expression produced a negative step');
  assert.throws(() => clock.advance(oldStep, true), /Invalid answer-clock interval/);
  assert.doesNotThrow(() => clock.advance(frameDelta(frameTimestamp, previousTimestamp), true));
});
