import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  advancePhase,
  answerProblem,
  createAttempt,
  crownsFor,
  firstAttemptAccuracy,
  resumeAttempt,
  retryPhase,
  scoreFor,
  serializeAttempt,
  strike,
  tick,
} from './boss-attempt.js';
import { DIFFICULTY_RULES, getBoss } from './boss-data.js';
import { generateSequenceProblem } from './boss-problems.js';

const BAND = { level: 10, operations: ['+', '-'], operandRange: { a: [2, 12], b: [1, 7] }, maxResult: 19 };
const LOCK = generateSequenceProblem({ ruleId: 'ascending', band: BAND, seed: 4 });

function clearPhase(attempt) {
  while (attempt.status === 'active') {
    answerProblem(attempt, true);
  }
  return attempt;
}

function winFight(attempt) {
  while (attempt.status !== 'won') {
    if (attempt.status === 'phase-clear') advancePhase(attempt);
    else if (attempt.status === 'defeated') retryPhase(attempt);
    else answerProblem(attempt, true);
  }
  return attempt;
}

describe('createAttempt', () => {
  it('starts on the first phase with the phase clock from the difficulty', () => {
    const attempt = createAttempt({ bossId: 'warden-dawn', difficulty: 'medium' });
    assert.equal(attempt.status, 'active');
    assert.equal(attempt.phaseIndex, 0);
    assert.equal(attempt.sealsThisPhase, 0);
    assert.equal(attempt.hearts, getBoss('warden-dawn').hearts);
    assert.equal(attempt.clockMax, DIFFICULTY_RULES.medium.wardClock);
    assert.equal(attempt.clockRemaining, attempt.clockMax);
    assert.deepEqual(attempt.lockOrder, []);
  });

  it('falls back to medium for an unknown difficulty', () => {
    assert.equal(createAttempt({ bossId: 'warden-dawn', difficulty: 'impossible' }).difficulty, 'medium');
    assert.throws(() => createAttempt({ bossId: 'nobody' }), TypeError);
  });

  it('gives the mastery round no clock at all', () => {
    const attempt = createAttempt({ bossId: 'hollow-king' });
    const phases = getBoss('hollow-king').phases;
    while (attempt.phaseIndex < phases.length - 1) {
      assert.ok(attempt.clockMax > 0, `${attempt.phase.id} fights against a clock`);
      clearPhase(attempt);
      advancePhase(attempt);
    }
    assert.equal(attempt.phase.masteryRound, true);
    assert.equal(attempt.clockMax, 0);
    tick(attempt, 10_000);
    assert.equal(attempt.hearts, attempt.maxHearts, 'the mastery round never costs a heart to the clock');
  });
});

describe('answering', () => {
  it('breaks a seal per correct answer and clears the phase on the last', () => {
    const attempt = createAttempt({ bossId: 'warden-dawn' });
    const seals = attempt.phase.seals;
    for (let index = 0; index < seals - 1; index++) {
      answerProblem(attempt, true);
      assert.equal(attempt.status, 'active');
      assert.equal(attempt.sealsThisPhase, index + 1);
    }
    answerProblem(attempt, true);
    assert.equal(attempt.status, 'phase-clear');
    assert.equal(attempt.sealsBroken, seals);
    assert.equal(attempt.chain, seals);
  });

  it('counts a miss without ever closing the fight', () => {
    const attempt = createAttempt({ bossId: 'warden-dawn' });
    answerProblem(attempt, true);
    answerProblem(attempt, false);
    assert.equal(attempt.status, 'active');
    assert.equal(attempt.misses, 1);
    assert.equal(attempt.chain, 0);
    assert.equal(attempt.sealsBroken, 1, 'the broken seal stays broken');
    assert.deepEqual(attempt.lastHint, { key: 'boss.hint.restate', ruleId: null });
  });

  it('takes a heart only as often as the difficulty says', () => {
    const easy = createAttempt({ bossId: 'warden-dawn', difficulty: 'easy' });
    for (let index = 0; index < 9; index++) answerProblem(easy, false);
    assert.equal(easy.hearts, easy.maxHearts, 'easy never charges a heart for a miss');

    const medium = createAttempt({ bossId: 'warden-dawn', difficulty: 'medium' });
    for (let index = 0; index < 2; index++) answerProblem(medium, false);
    assert.equal(medium.hearts, medium.maxHearts);
    answerProblem(medium, false);
    assert.equal(medium.hearts, medium.maxHearts - 1, 'medium charges on the third miss of a phase');

    const hard = createAttempt({ bossId: 'warden-dawn', difficulty: 'hard' });
    answerProblem(hard, false);
    assert.equal(hard.hearts, hard.maxHearts - 1);
  });

  it('defeats at zero hearts and resumes the same phase with full hearts', () => {
    const attempt = createAttempt({ bossId: 'warden-dawn', difficulty: 'hard' });
    answerProblem(attempt, true);
    const misses = attempt.maxHearts;
    for (let index = 0; index < misses; index++) answerProblem(attempt, false);
    assert.equal(attempt.status, 'defeated');
    assert.equal(attempt.hearts, 0);

    retryPhase(attempt);
    assert.equal(attempt.status, 'active');
    assert.equal(attempt.phaseIndex, 0);
    assert.equal(attempt.hearts, attempt.maxHearts);
    assert.equal(attempt.sealsThisPhase, 0);
    assert.equal(attempt.sealsBroken, 1, 'progress inside the phase restarts, broken seals of other phases do not');
    assert.equal(attempt.solved, 1, 'the crown still counts what was already earned');
    assert.equal(attempt.misses, misses);
  });

  it('refuses answers outside an active phase', () => {
    const attempt = createAttempt({ bossId: 'warden-dawn' });
    clearPhase(attempt);
    assert.throws(() => answerProblem(attempt, true), Error);
  });
});

describe('the Ward Clock', () => {
  it('is a phase budget that refills at a cost of one heart', () => {
    const attempt = createAttempt({ bossId: 'warden-dawn', difficulty: 'medium' });
    tick(attempt, attempt.clockMax - 1);
    assert.equal(attempt.hearts, attempt.maxHearts);
    assert.ok(attempt.clockRemaining === 1);
    tick(attempt, 2);
    assert.equal(attempt.hearts, attempt.maxHearts - 1);
    assert.equal(attempt.clockRemaining, attempt.clockMax, 'the clock restarts, the fight goes on');
    assert.equal(attempt.timeouts, 1);
  });

  it('gains time per broken seal', () => {
    const attempt = createAttempt({ bossId: 'warden-dawn', difficulty: 'hard' });
    tick(attempt, 20);
    const before = attempt.clockRemaining;
    answerProblem(attempt, true);
    assert.equal(attempt.clockRemaining, before + attempt.phase.clockBonusPerSeal);
    assert.ok(attempt.clockRemaining <= attempt.clockMax, 'a perfect phase never banks past its budget');
  });

  it('ignores ticks once the phase is over', () => {
    const attempt = createAttempt({ bossId: 'warden-dawn' });
    clearPhase(attempt);
    const remaining = attempt.clockRemaining;
    tick(attempt, 999);
    assert.equal(attempt.clockRemaining, remaining);
  });

  it('rejects a negative interval', () => {
    assert.throws(() => tick(createAttempt({ bossId: 'warden-dawn' }), -1), TypeError);
  });
});

describe('strikes', () => {
  it('clears the sequence on a wrong strike and keeps the lock open', () => {
    const attempt = createAttempt({ bossId: 'warden-dawn' });
    advancePhaseToSequence(attempt);
    const wrong = LOCK.orbs.findIndex((_, index) => index !== LOCK.answer[0]);
    const result = strike(attempt, LOCK, wrong);
    assert.equal(result.accepted, false);
    assert.deepEqual(attempt.lockOrder, []);
    assert.equal(attempt.misses, 1);
    assert.equal(attempt.status, 'active');
    assert.ok(attempt.lastHint, 'a wrong strike always leaves a hint');
  });

  it('records each accepted orb and breaks the seal on the last', () => {
    const attempt = createAttempt({ bossId: 'warden-dawn' });
    advancePhaseToSequence(attempt);
    LOCK.answer.forEach((orbIndex, step) => {
      const result = strike(attempt, LOCK, orbIndex);
      assert.equal(result.accepted, true);
      assert.equal(result.complete, step === LOCK.answer.length - 1);
    });
    assert.equal(attempt.sealsThisPhase, 1);
    assert.deepEqual(attempt.lockOrder, []);
  });

  it('refuses strikes in a phase that has no lock', () => {
    const attempt = createAttempt({ bossId: 'warden-dawn' });
    assert.throws(() => strike(attempt, LOCK, 0), Error);
  });
});

function advancePhaseToSequence(attempt) {
  clearPhase(attempt);
  advancePhase(attempt);
  assert.equal(attempt.phase.kind, 'sequence');
  return attempt;
}

describe('crowns and score', () => {
  it('awards three crowns for a clean fight', () => {
    const attempt = winFight(createAttempt({ bossId: 'warden-dawn' }));
    assert.equal(firstAttemptAccuracy(attempt), 1);
    assert.equal(crownsFor(attempt), 3);
    assert.ok(scoreFor(attempt) > 0);
  });

  it('drops a crown per accuracy band, never to zero for a win', () => {
    const attempt = createAttempt({ bossId: 'warden-dawn' });
    winFight(attempt);
    // Nine right, two wrong is 0.82: still two crowns.
    attempt.solved = 9;
    attempt.misses = 2;
    assert.equal(crownsFor(attempt), 2);
    attempt.solved = 5;
    attempt.misses = 6;
    assert.equal(crownsFor(attempt), 1);
    attempt.solved = 1;
    attempt.misses = 40;
    assert.equal(crownsFor(attempt), 1, 'finishing is always worth a crown');
  });

  it('never awards a crown for a fight that is not won', () => {
    const attempt = createAttempt({ bossId: 'warden-dawn' });
    assert.equal(crownsFor(attempt), 0);
    attempt.status = 'defeated';
    assert.equal(crownsFor(attempt), 0);
  });

  it('pays for seals, accuracy and the time still on the clock', () => {
    const perfect = scoreFor(winFight(createAttempt({ bossId: 'warden-dawn' })));
    const sloppyAttempt = createAttempt({ bossId: 'warden-dawn' });
    answerProblem(sloppyAttempt, false);
    answerProblem(sloppyAttempt, false);
    const sloppy = scoreFor(winFight(sloppyAttempt));
    assert.ok(sloppy < perfect, 'a miss must cost score without erasing the reward');
    assert.ok(sloppy > 0);
  });
});

describe('saving', () => {
  it('round-trips a fight at its phase checkpoint', () => {
    const attempt = createAttempt({ bossId: 'warden-harvest', difficulty: 'hard', seed: 77 });
    clearPhase(attempt);
    advancePhase(attempt);
    answerProblem(attempt, true);
    answerProblem(attempt, false);

    const snapshot = serializeAttempt(attempt);
    const resumed = resumeAttempt(snapshot);
    assert.equal(resumed.bossId, attempt.bossId);
    assert.equal(resumed.phaseIndex, attempt.phaseIndex);
    assert.equal(resumed.hearts, resumed.maxHearts, 'a resume is a checkpoint, so hearts come back');
    assert.equal(resumed.sealsBroken, attempt.sealsBroken);
    assert.equal(resumed.solved, attempt.solved);
    assert.equal(resumed.misses, attempt.misses);
    assert.equal(resumed.status, 'active');
    assert.deepEqual(resumed.lockOrder, []);
  });

  it('remembers a finished fight as won', () => {
    const attempt = winFight(createAttempt({ bossId: 'warden-dawn' }));
    const resumed = resumeAttempt(serializeAttempt(attempt));
    assert.equal(resumed.status, 'won');
    assert.equal(crownsFor(resumed), 3);
  });

  it('clamps a phase index beyond the data', () => {
    const resumed = resumeAttempt({ bossId: 'warden-dawn', phaseIndex: 99, maxHearts: 5 });
    assert.equal(resumed.phaseIndex, getBoss('warden-dawn').phases.length - 1);
  });
});
