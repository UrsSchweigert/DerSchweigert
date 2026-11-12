// boss-plan.js — what a Warden asks, seal by seal, decided up front.
//
// A plan is a deterministic list of encounter specs for one phase: which kind
// of problem, which operation or lock rule, and the seed each one draws from.
// Planning separately from playing means a fight can be replayed exactly, a bot
// can be handed the same questions, and the problem generators stay free of any
// notion of boss phases.

import { getBoss } from './boss-data.js';
import {
  generateInverseProblem,
  generateSequenceProblem,
} from './boss-problems.js';
import { generateProblem } from './levels.js';

function shuffleInto(stream, values) {
  const copy = [...values];
  for (let index = copy.length - 1; index > 0; index--) {
    const swap = stream.nextInt(0, index);
    [copy[index], copy[swap]] = [copy[swap], copy[index]];
  }
  return copy;
}

function bandOperations(band) {
  const operations = band?.operations;
  if (!Array.isArray(operations) || operations.length === 0) {
    throw new TypeError('A boss phase needs a band with at least one operation');
  }
  return operations;
}

/**
 * Plan one phase. Direct and inverse phases cycle through the band's
 * operations; sequence phases cycle through the rules the data names, so a
 * three-seal Warden shows every rule it owns once.
 *
 * @returns {{index: number, kind: 'direct'|'inverse'|'sequence', ruleId?: string,
 *            operation?: string, seed: number}[]}
 */
export function planPhase({ bossId, phaseIndex, band, seed }) {
  const boss = getBoss(bossId);
  const phase = boss.phases[phaseIndex];
  if (!phase) throw new RangeError(`Boss "${bossId}" has no phase ${phaseIndex}`);

  // A different stream per phase, so neighbouring phases never share a pattern.
  const stream = seedStream(seed, phaseIndex);

  if (phase.kind === 'sequence') {
    if (!Array.isArray(phase.rules) || phase.rules.length === 0) {
      throw new TypeError(`Phase "${phase.id}" declares no lock rules`);
    }
    const rules = shuffleInto(stream, phase.rules);
    return Array.from({ length: phase.seals }, (_, index) => ({
      index,
      kind: 'sequence',
      ruleId: rules[index % rules.length],
      seed: stream.next(),
    }));
  }

  const operations = shuffleInto(stream, bandOperations(band));
  const kind = phase.kind === 'inverse' ? 'inverse' : 'direct';
  return Array.from({ length: phase.seals }, (_, index) => ({
    index,
    kind,
    operation: operations[index % operations.length],
    seed: stream.next(),
  }));
}

function seedStream(seed, phaseIndex) {
  // A tiny splitmix-style step keeps each phase's seeds independent without
  // pulling the whole problem generator's RNG into the planner.
  let state = ((seed >>> 0) ^ Math.imul(phaseIndex + 1, 0x9e3779b1)) >>> 0;
  const next = () => {
    state = (state + 0x9e3779b1) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 16), 0x21f0aaad) >>> 0;
    value = Math.imul(value ^ (value >>> 15), 0x735a2d97) >>> 0;
    return (value ^ (value >>> 15)) >>> 0;
  };
  return {
    next,
    nextInt(min, max) {
      return min + Math.floor((next() / 4294967296) * (max - min + 1));
    },
  };
}

/** Plan every phase of a fight. */
export function planFight({ bossId, band, seed }) {
  const boss = getBoss(bossId);
  return boss.phases.map((phase, phaseIndex) => ({
    phase,
    phaseIndex,
    entries: planPhase({ bossId, phaseIndex, band, seed }),
  }));
}

/**
 * Turn one planned seal into a playable problem. Direct problems are the
 * campaign's own generator, so a boss never invents a question shape the act
 * has not already taught.
 */
export function problemFor({ band, plan }) {
  if (plan.kind === 'sequence') {
    return {
      kind: 'sequence',
      lock: generateSequenceProblem({ ruleId: plan.ruleId, band, seed: plan.seed }),
    };
  }
  if (plan.kind === 'inverse') {
    return { kind: 'inverse', problem: generateInverseProblem({ band, seed: plan.seed, operation: plan.operation }) };
  }
  if (plan.kind === 'direct') {
    if (!Number.isInteger(band?.level)) {
      throw new TypeError('A direct boss problem needs a level config with a level number');
    }
    // The campaign generator draws the operation from the band it is given, so
    // narrowing the band to the planned operation makes the plan binding rather
    // than advisory.
    const focused = { ...band, operations: [plan.operation] };
    return { kind: 'direct', problem: generateProblem(band.level - 1, plan.seed, focused) };
  }
  throw new TypeError(`Unknown plan kind "${plan.kind}"`);
}

/** How long the rule banner stays up before a hiding phase withholds it. */
export const HIDDEN_RULE_SECONDS = 4;
