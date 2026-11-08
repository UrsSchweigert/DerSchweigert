import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCompletionId, createLevelCompletion } from './level-completion.js';

test('captures the completed level, score and family player; concurrent saves submit once', async () => {
  const calls = [];
  const record = { level: 1, score: 400, difficulty: 'easy', profileId: 'child-a', completionId: 'clear-1' };
  const save = createLevelCompletion({
    async postLevelScore(...args) { calls.push(args); return { saved: true }; },
  }, record);
  record.level = 2;
  record.score = 0;
  record.profileId = 'child-b';
  await Promise.all([save(), save(), save()]);
  assert.deepEqual(calls, [[1, 400, 'easy', { profileId: 'child-a', completionId: 'clear-1' }]]);
});

test('failed storage can be retried without changing the completion identity', async () => {
  let writes = 0;
  const save = createLevelCompletion({
    async postLevelScore() {
      if (++writes === 1) throw new Error('quota exceeded');
      return { saved: false, persisted: true };
    },
  }, { level: 60, score: 40, difficulty: 'hard', completionId: 'final-clear' });
  await assert.rejects(save(), /quota/);
  assert.deepEqual(await save(), { saved: false, persisted: true });
  await save();
  assert.equal(writes, 2);
});

test('each replay gets a distinct completion identity', () => {
  assert.notEqual(createCompletionId(), createCompletionId());
});

test('attempt accomplishments are captured before asynchronous submission and survive retries', async () => {
  const attemptSummary = { firstAttemptCorrect: 4, firstAttemptTotal: 5, correctAnswers: 5,
    incorrectAnswers: 1, timeouts: 0, bestStreak: 4 };
  const expected = { ...attemptSummary };
  let captured;
  let failures = 1;
  const save = createLevelCompletion({
    async postLevelScore(_level, _score, _difficulty, options) {
      captured = options.attemptSummary;
      if (failures-- > 0) throw new Error('disk full');
      return { saved: false, previousAttemptSummary: expected };
    },
  }, { level: 1, score: 80, difficulty: 'easy', completionId: 'stats-clear', attemptSummary });
  attemptSummary.bestStreak = 99;
  await assert.rejects(save(), /disk full/);
  assert.deepEqual(captured, expected);
  assert.ok(Object.isFrozen(captured));
  assert.deepEqual(await save(), { saved: false, previousAttemptSummary: expected });
});
