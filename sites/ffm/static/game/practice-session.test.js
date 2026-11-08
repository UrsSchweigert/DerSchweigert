import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  collectTargetedProblems, createTargetedProblems, createPracticeSession,
  createEarnedRecovery, getPracticeEliteHp, getPracticeBadgeIds,
} from './practice-session.js';

test('targeted retains original distinct missed objects and caps at five', () => {
  const problems = Array.from({ length: 8 }, () => ({ text: '1+1' }));
  const failed = [problems[0], problems[0], ...problems];
  assert.deepEqual(collectTargetedProblems(failed), problems.slice(0, 5));
  assert.equal(createTargetedProblems(failed)[0], problems[0]);
  const session = createPracticeSession({ kind: 'targeted', problems: failed });
  assert.equal(session.snapshot().untimed, true);
  failed.length = 0;
  assert.equal(session.nextProblem(), problems[0]);
  session.recordAnswer(problems[0], false);
  assert.equal(session.nextProblem(), problems[1]);
  session.recordAnswer(problems[0], true);
  for (const problem of problems.slice(1, 5)) session.recordAnswer(problem, false, { timeout: true });
  assert.equal(session.isComplete(), true);
  assert.equal(session.snapshot().resolvedProblems, 5);
  assert.equal(session.snapshot().timeouts, 4);
  assert.equal(session.nextProblem(), null);
  assert.throws(() => createPracticeSession({ kind: 'targeted' }), { code: 'invalid_practice' });
  assert.throws(() => createPracticeSession({ kind: 'targeted', problems: [] }), { code: 'invalid_practice' });
  assert.equal(createPracticeSession({ kind: 'targeted', problems: [problems[0]] }).nextProblem(), problems[0]);
});

test('shapes resolves ten distinct wrong or timed out problems, not retry count', () => {
  const session = createPracticeSession({ kind: 'shapes' });
  const first = {};
  session.recordAnswer(first, false);
  session.recordAnswer(first, true);
  for (let i = 0; i < 8; i++) session.recordAnswer({}, false, { timeout: true });
  assert.equal(session.isComplete(), false);
  session.recordAnswer({}, false);
  assert.equal(session.isComplete(), true);
  assert.equal(session.snapshot().resolvedProblems, 10);
  assert.equal(session.snapshot().scored, false);
});

test('short, assisted, elite and recovery finish after ten encounters, not multi-HP answers', () => {
  for (const kind of ['short', 'assisted', 'elite', 'recovery']) {
    const session = createPracticeSession({ kind });
    for (let i = 0; i < 30; i++) session.recordAnswer({}, true);
    assert.equal(session.isComplete(), false);
    assert.equal(session.snapshot().targetEncounters, 10);
    assert.equal(session.snapshot().untimed, kind === 'assisted');
    for (let i = 0; i < 9; i++) session.recordEncounterDefeated();
    assert.equal(session.isComplete(), false);
    session.recordEncounterDefeated();
    session.recordEncounterDefeated();
    assert.equal(session.snapshot().encountersDefeated, 10);
    assert.equal(session.isComplete(), true);
  }
  assert.equal(getPracticeEliteHp(1), 3);
  assert.equal(getPracticeEliteHp(3), 3);
  assert.equal(getPracticeEliteHp(5), 5);
});

test('spells never resolve questions or grant correct/recovery credit', () => {
  const session = createPracticeSession({ kind: 'shapes' });
  for (let i = 0; i < 12; i++) session.recordAnswer({}, true, { spell: true });
  assert.equal(session.snapshot().resolvedProblems, 0);
  assert.equal(session.snapshot().correctAnswers, 0);
  const recovery = createEarnedRecovery();
  for (let i = 0; i < 12; i++) assert.equal(recovery.recordCorrect({}, {
    hearts: 1, maxHearts: 3, spell: true,
  }), false);
  assert.equal(recovery.snapshot().correctSinceHeal, 0);
});

test('recovery credits distinct corrected retries once and caps at two heals per attempt', () => {
  const recovery = createEarnedRecovery();
  const retry = {};
  const state = { hearts: 1, maxHearts: 3 };
  assert.equal(recovery.recordCorrect(retry, { ...state, timeout: true }), false);
  assert.equal(recovery.recordCorrect(retry, state), false);
  assert.equal(recovery.recordCorrect(retry, state), false);
  for (let i = 0; i < 3; i++) assert.equal(recovery.recordCorrect({}, state), false);
  assert.equal(recovery.recordCorrect({}, state), true);
  for (let i = 0; i < 4; i++) assert.equal(recovery.recordCorrect({}, state), false);
  assert.equal(recovery.recordCorrect({}, state), true);
  for (let i = 0; i < 10; i++) assert.equal(recovery.recordCorrect({}, state), false);
  assert.deepEqual(recovery.snapshot(), { correctSinceHeal: 0, heals: 2, maxHeals: 2 });
  assert.equal(createEarnedRecovery().snapshot().heals, 0);
});

test('full health resets recovery progress, never banks credit or permits a later replay', () => {
  const recovery = createEarnedRecovery();
  const hurt = { hearts: 2, maxHearts: 3 };
  for (let i = 0; i < 4; i++) recovery.recordCorrect({}, hurt);
  const atFull = {};
  assert.equal(recovery.recordCorrect(atFull, { hearts: 3, maxHearts: 3 }), false);
  assert.equal(recovery.snapshot().correctSinceHeal, 0);
  assert.equal(recovery.recordCorrect(atFull, hurt), false);
  for (let i = 0; i < 4; i++) assert.equal(recovery.recordCorrect({}, hurt), false);
  assert.equal(recovery.recordCorrect({}, hurt), true);
});

test('badge IDs describe practice completion, not score or mastery', () => {
  assert.deepEqual(getPracticeBadgeIds(['+', '-', '*', '/', '+'], 'short'), [
    'practice-addition', 'practice-subtraction', 'practice-multiplication', 'practice-division',
  ]);
  assert.deepEqual(getPracticeBadgeIds([], 'targeted'), ['practice-targeted']);
  assert.deepEqual(getPracticeBadgeIds([], 'shapes'), ['practice-shapes']);
});

test('invalid practice inputs reject before changing counters', () => {
  for (const kind of ['campaign', undefined]) assert.throws(() => createPracticeSession({ kind }));
  assert.throws(() => collectTargetedProblems([null]));
  assert.throws(() => getPracticeEliteHp(0));
  assert.throws(() => getPracticeBadgeIds(['mastery'], 'short'));
  const session = createPracticeSession({ kind: 'shapes' });
  for (const args of [[null, true], [{}, 1], [{}, true, { timeout: true }], [{}, true, { spell: 1 }]]) {
    assert.throws(() => session.recordAnswer(...args), { code: 'invalid_practice' });
  }
  assert.equal(session.snapshot().resolvedProblems, 0);
  const recovery = createEarnedRecovery();
  for (const state of [{ hearts: -1, maxHearts: 3 }, { hearts: 4, maxHearts: 3 },
    { hearts: 1.5, maxHearts: 3 }, { hearts: 1, maxHearts: 0 }]) {
    assert.throws(() => recovery.recordCorrect({}, state), { code: 'invalid_practice' });
  }
  assert.equal(recovery.snapshot().correctSinceHeal, 0);
});
