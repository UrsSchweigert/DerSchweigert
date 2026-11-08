import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAttemptSummary } from './attempt-summary.js';

const empty = {
  firstAttemptCorrect: 0, firstAttemptTotal: 0, correctAnswers: 0,
  incorrectAnswers: 0, timeouts: 0, bestStreak: 0,
};

test('object identity counts first replies once; correct retries build a streak', () => {
  const attempt = createAttemptSummary();
  const retry = { text: '2 + 2' };
  assert.deepEqual(attempt.snapshot(), empty);
  attempt.recordAnswer(retry, false);
  attempt.recordAnswer(retry, true);
  attempt.recordAnswer({ text: '2 + 2' }, true);
  assert.deepEqual(attempt.snapshot(), {
    firstAttemptCorrect: 1, firstAttemptTotal: 2, correctAnswers: 2,
    incorrectAnswers: 1, timeouts: 0, bestStreak: 2,
  });
});

test('timeouts count separately, reset streak and do not recategorize a retry', () => {
  const attempt = createAttemptSummary();
  const timedOut = {};
  attempt.recordAnswer({}, true);
  attempt.recordAnswer({}, true);
  attempt.recordAnswer(timedOut, false, { timeout: true });
  attempt.recordAnswer(timedOut, false);
  attempt.recordAnswer(timedOut, true);
  attempt.recordAnswer({}, true);
  attempt.recordAnswer({}, true);
  assert.deepEqual(attempt.snapshot(), {
    firstAttemptCorrect: 4, firstAttemptTotal: 5, correctAnswers: 5,
    incorrectAnswers: 1, timeouts: 1, bestStreak: 3,
  });
});

test('snapshots are immutable, detached and attempts are independent', () => {
  const attempt = createAttemptSummary();
  const before = attempt.snapshot();
  const after = attempt.recordAnswer({}, true);
  assert.ok(Object.isFrozen(before));
  assert.ok(Object.isFrozen(after));
  assert.throws(() => { after.bestStreak = 50; }, TypeError);
  assert.deepEqual(before, empty);
  assert.deepEqual(createAttemptSummary().snapshot(), empty);
  assert.equal(attempt.snapshot().bestStreak, 1);
});

test('invalid replies throw explicitly before changing counters or marking a problem seen', () => {
  const attempt = createAttemptSummary();
  const problem = {};
  for (const args of [
    [null, true], [1, true], [[], true], [problem, 1], [problem, true, null],
    [problem, false, { timeout: 'yes' }], [problem, true, { timeout: true }],
    [problem, false, { unexpected: true }],
  ]) {
    assert.throws(() => attempt.recordAnswer(...args), { code: 'invalid_answer' });
    assert.deepEqual(attempt.snapshot(), empty);
  }
  assert.equal(attempt.recordAnswer(problem, true).firstAttemptCorrect, 1);
});
