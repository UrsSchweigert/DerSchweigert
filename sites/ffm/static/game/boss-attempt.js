// boss-attempt.js — the phase machine for one Warden fight.
//
// Three things make a boss different from a wave: seals are broken in phases,
// the clock is a budget for the whole phase rather than a timer per problem,
// and a retry resumes at the phase start with full hearts. All of that lives
// here, on plain data, so the fight can be unit-tested and saved mid-way.
//
// Status flow:
//   active --last seal of phase--> phase-clear --advancePhase--> active (next)
//   active --hearts reach 0-----> defeated --retryPhase-------> active (same)
//   phase-clear --advancePhase on last phase------------------> won

import { evaluateStrike, hintFor } from './boss-rules.js';
import { DIFFICULTY_RULES, getBoss } from './boss-data.js';

export const CROWN_THRESHOLDS = Object.freeze({ three: 0.9, two: 0.75 });
export const CLOCK_SECOND_SCORE = 50;

export function createAttempt({ bossId, difficulty = 'medium', seed = 1, hearts }) {
  const boss = getBoss(bossId);
  const rules = DIFFICULTY_RULES[difficulty] ?? DIFFICULTY_RULES.medium;
  const maxHearts = hearts ?? boss.hearts;
  const attempt = {
    bossId,
    difficulty: DIFFICULTY_RULES[difficulty] ? difficulty : 'medium',
    seed,
    boss,
    phaseIndex: 0,
    phase: boss.phases[0],
    sealsThisPhase: 0,
    sealsBroken: 0,
    hearts: maxHearts,
    maxHearts,
    chain: 0,
    bestChain: 0,
    clockMax: 0,
    clockRemaining: 0,
    lockOrder: [],
    solved: 0,
    misses: 0,
    missesThisPhase: 0,
    timeouts: 0,
    totalClockLeft: 0,
    lastHint: null,
    status: 'active',
    rules,
  };
  beginPhase(attempt, 0);
  return attempt;
}

export function beginPhase(attempt, phaseIndex) {
  const phase = attempt.boss.phases[phaseIndex];
  if (!phase) throw new RangeError(`Boss "${attempt.bossId}" has no phase ${phaseIndex}`);
  attempt.phaseIndex = phaseIndex;
  attempt.phase = phase;
  attempt.sealsThisPhase = 0;
  attempt.lockOrder = [];
  attempt.missesThisPhase = 0;
  attempt.lastHint = null;
  // The mastery round is the one phase with no clock: it decides the crown, so
  // it must measure accuracy rather than speed.
  attempt.clockMax = phase.masteryRound ? 0 : attempt.rules.wardClock;
  attempt.clockRemaining = attempt.clockMax;
  attempt.status = 'active';
  return attempt;
}

/** The Ward Clock is a budget for the phase, not a timer per problem. */
export function tick(attempt, seconds) {
  if (attempt.status !== 'active' || attempt.clockMax === 0) return attempt;
  if (!Number.isFinite(seconds) || seconds < 0) throw new TypeError('Invalid clock interval');
  attempt.clockRemaining -= seconds;
  if (attempt.clockRemaining > 0) return attempt;

  attempt.timeouts += 1;
  attempt.chain = 0;
  attempt.lockOrder = [];
  attempt.clockRemaining = attempt.clockMax;
  loseHeart(attempt);
  return attempt;
}

function loseHeart(attempt) {
  attempt.hearts -= 1;
  attempt.chain = 0;
  if (attempt.hearts <= 0) {
    attempt.hearts = 0;
    attempt.status = 'defeated';
  }
}

function registerMiss(attempt) {
  attempt.misses += 1;
  attempt.missesThisPhase += 1;
  attempt.chain = 0;
  const every = attempt.rules.missHeartEvery;
  if (every > 0 && attempt.missesThisPhase % every === 0) loseHeart(attempt);
}

function breakSeal(attempt) {
  attempt.sealsThisPhase += 1;
  attempt.sealsBroken += 1;
  attempt.solved += 1;
  attempt.chain += 1;
  attempt.bestChain = Math.max(attempt.bestChain, attempt.chain);
  attempt.lockOrder = [];
  attempt.lastHint = null;
  if (attempt.clockMax > 0) {
    attempt.clockRemaining = Math.min(
      attempt.clockMax,
      attempt.clockRemaining + (attempt.phase.clockBonusPerSeal ?? 0),
    );
  }
  if (attempt.sealsThisPhase >= attempt.phase.seals) {
    attempt.status = 'phase-clear';
    attempt.totalClockLeft += Math.max(0, attempt.clockRemaining);
  }
  return attempt;
}

/** Record a direct or inverse answer, which has no strike sequence to evaluate. */
export function answerProblem(attempt, correct) {
  if (attempt.status !== 'active') throw new Error('The fight is not accepting answers');
  if (correct) return breakSeal(attempt);
  registerMiss(attempt);
  attempt.lastHint = { key: 'boss.hint.restate', ruleId: null };
  return attempt;
}

/**
 * Strike one orb of a sequence lock. A wrong strike costs a miss and clears the
 * sequence, but the lock itself stays open: the player always gets to finish it.
 */
export function strike(attempt, lock, orbIndex) {
  if (attempt.status !== 'active') throw new Error('The fight is not accepting strikes');
  if (attempt.phase.kind !== 'sequence') throw new Error('This phase does not use a lock');
  const result = evaluateStrike({
    ruleId: lock.ruleId,
    orbs: lock.orbs,
    params: lock.params,
    order: attempt.lockOrder,
    orbIndex,
  });
  if (!result.accepted) {
    attempt.lockOrder = [];
    registerMiss(attempt);
    attempt.lastHint = result.hint?.key === 'boss.hint.repeat'
      ? null
      : hintFor({
        ruleId: lock.ruleId,
        orbs: lock.orbs,
        params: lock.params,
        order: attempt.lockOrder,
        missed: attempt.missesThisPhase,
      });
    return { ...result, attempt };
  }

  attempt.lockOrder = result.order;
  attempt.lastHint = null;
  if (result.complete) breakSeal(attempt);
  return { ...result, attempt };
}

/** Leave a cleared phase for the next one, or win the fight. */
export function advancePhase(attempt) {
  if (attempt.status !== 'phase-clear') throw new Error('Only a cleared phase can advance');
  const next = attempt.phaseIndex + 1;
  if (next >= attempt.boss.phases.length) {
    attempt.status = 'won';
    return attempt;
  }
  return beginPhase(attempt, next);
}

/**
 * The checkpoint rule: a defeat resumes at the start of the phase that was
 * being fought, with full hearts. Solved seals and misses stay counted, so the
 * crown still reflects the whole fight rather than only the winning attempt.
 */
export function retryPhase(attempt) {
  attempt.hearts = attempt.maxHearts;
  return beginPhase(attempt, attempt.phaseIndex);
}

export function firstAttemptAccuracy(attempt) {
  const total = attempt.solved + attempt.misses;
  return total === 0 ? 1 : attempt.solved / total;
}

export function crownsFor(attempt) {
  if (attempt.status !== 'won') return 0;
  const accuracy = firstAttemptAccuracy(attempt);
  if (accuracy >= CROWN_THRESHOLDS.three) return 3;
  if (accuracy >= CROWN_THRESHOLDS.two) return 2;
  return 1;
}

export function scoreFor(attempt) {
  const base = attempt.solved * attempt.boss.perSealValue;
  const accuracyBonus = Math.max(0, Math.round(base * (firstAttemptAccuracy(attempt) - 0.5)));
  return base + accuracyBonus + attempt.totalClockLeft * CLOCK_SECOND_SCORE;
}

/** A save-safe snapshot: enough to resume at the current phase checkpoint. */
export function serializeAttempt(attempt) {
  return {
    bossId: attempt.bossId,
    difficulty: attempt.difficulty,
    seed: attempt.seed,
    phaseIndex: attempt.phaseIndex,
    hearts: attempt.maxHearts,
    maxHearts: attempt.maxHearts,
    sealsBroken: attempt.sealsBroken,
    solved: attempt.solved,
    misses: attempt.misses,
    timeouts: attempt.timeouts,
    bestChain: attempt.bestChain,
    totalClockLeft: attempt.totalClockLeft,
    status: attempt.status === 'won' ? 'won' : 'active',
  };
}

/** Resume from a snapshot at the phase checkpoint. */
export function resumeAttempt(snapshot) {
  const attempt = createAttempt({
    bossId: snapshot.bossId,
    difficulty: snapshot.difficulty,
    seed: snapshot.seed,
    hearts: snapshot.maxHearts,
  });
  attempt.phaseIndex = Math.min(snapshot.phaseIndex ?? 0, attempt.boss.phases.length - 1);
  attempt.sealsBroken = snapshot.sealsBroken ?? 0;
  attempt.solved = snapshot.solved ?? 0;
  attempt.misses = snapshot.misses ?? 0;
  attempt.timeouts = snapshot.timeouts ?? 0;
  attempt.bestChain = snapshot.bestChain ?? 0;
  attempt.totalClockLeft = snapshot.totalClockLeft ?? 0;
  beginPhase(attempt, attempt.phaseIndex);
  if (snapshot.status === 'won') attempt.status = 'won';
  return attempt;
}
