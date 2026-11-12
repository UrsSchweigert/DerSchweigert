// boss-problems.js — deterministic problem generation for Warden locks.
//
// Every generator is seeded and side-effect free: the same seed always yields
// the same lock, so a boss fight is reproducible from an input recording.
// A generated lock is rejected unless it has exactly one completion, which is
// what stops a Warden from ever posing a puzzle with two right answers.
// Each generator constructs a legal lock rather than rejecting draws, so a band
// that can support a rule always produces one on the first try.

import { countSolutions, solutionFor } from './boss-rules.js';

const MAX_SAFE_ANSWER = Number.MAX_SAFE_INTEGER;

// The compose rule needs a relation that points one way. Subtraction and
// division do not: with `a - b = r`, `a - r = b` also holds, and with
// `a ÷ d = q`, `a ÷ q = d` does. Either one would give a single set of three
// orbs two valid answers, which a lock must never have. Both directions are
// covered by the inverse and equalShare problems instead.
export const COMPOSE_OPERATIONS = Object.freeze(['+', '*']);

/**
 * A small seeded generator.
 *
 * This is mulberry32 rather than the campaign's plain LCG on purpose: an LCG's
 * low bits are strongly correlated, so `state % span` for a two-value span
 * alternates predictably and can repeat the same draw on every attempt. That
 * turned lock building into an infinite retry. mulberry32 mixes the state
 * before use, so every draw from a small range stays independent.
 */
export function createRng(seed) {
  let state = seed >>> 0;
  const uint32 = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  };
  return {
    next: uint32,
    nextInt(min, max) {
      if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max) || max < min) {
        throw new RangeError(`Cannot draw an integer from ${min} to ${max}`);
      }
      return min + Math.floor((uint32() / 4294967296) * (max - min + 1));
    },
    pick(values) {
      if (!Array.isArray(values) || values.length === 0) {
        throw new RangeError('Cannot pick from an empty list');
      }
      return values[this.nextInt(0, values.length - 1)];
    },
    shuffle(values) {
      const copy = [...values];
      for (let i = copy.length - 1; i > 0; i--) {
        const j = this.nextInt(0, i);
        [copy[i], copy[j]] = [copy[j], copy[i]];
      }
      return copy;
    },
  };
}

/**
 * The numbers a lock may show for a level band: the band's own operands and
 * the answers it allows, never wider than maxResult.
 */
export function orbRangeForBand(band) {
  const rangeA = band?.operandRange?.a;
  if (!Array.isArray(rangeA) || rangeA.length !== 2 || !rangeA.every(Number.isSafeInteger)) {
    throw new TypeError('A level band needs operandRange.a as [min, max] safe integers');
  }
  const rangeB = Array.isArray(band?.operandRange?.b) ? band.operandRange.b : rangeA;
  const low = Math.max(0, Math.min(rangeA[0], rangeB[0] ?? rangeA[0]));
  const ceiling = Number.isSafeInteger(band?.maxResult) ? band.maxResult : MAX_SAFE_ANSWER;
  const high = Math.min(Math.max(rangeA[1], rangeB[1] ?? rangeA[1]), ceiling);
  return [low, high];
}

function distinctValues(rng, count, low, high) {
  if (high - low + 1 < count) {
    throw new RangeError(`Range ${low}..${high} cannot hold ${count} distinct orbs`);
  }
  const values = [];
  while (values.length < count) {
    const value = rng.nextInt(low, high);
    if (!values.includes(value)) values.push(value);
  }
  return values;
}

function makeLock(ruleId, params, orbs) {
  return { ruleId, params, orbs, answer: solutionFor({ ruleId, orbs, params }) };
}

/**
 * Verify the single-answer guarantee before shipping a lock. Generators are
 * built to satisfy it by construction; this stays as the backstop that turns a
 * modelling mistake into a loud failure instead of an unfair puzzle.
 */
function sealLock({ ruleId, params, build, attempts = 200 }) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    const candidate = build();
    if (!candidate) continue;
    const resolved = candidate.params ?? params;
    if (countSolutions({ ruleId, orbs: candidate.orbs, params: resolved }) === 1) {
      return makeLock(ruleId, resolved, candidate.orbs);
    }
  }
  throw new Error(`Could not build a single-answer "${ruleId}" lock for ${JSON.stringify(params)}`);
}

export function generateOrderingProblem({ band, seed, descending = false }) {
  const rng = createRng(seed);
  const [low, high] = orbRangeForBand(band);
  const orbs = rng.shuffle(distinctValues(rng, 3, low, high));
  return makeLock(descending ? 'descending' : 'ascending', {}, orbs);
}

/** A round target a child can aim at, such as 10, 20, 50 or 100. */
function pickTarget(rng, low, high) {
  const round = [10, 20, 50, 100, 200, 500, 1000].filter(value => value >= low + 2 && value <= high);
  return round.length > 0 ? rng.pick(round) : high;
}

export function generatePairSumProblem({ band, seed, target }) {
  const rng = createRng(seed);
  const [low, high] = orbRangeForBand(band);
  const sum = Number.isSafeInteger(target) ? target : pickTarget(rng, low, high);
  const floor = Math.max(low, 1);
  if (sum > high || sum < 2 * floor) {
    throw new RangeError(`A pair-sum target of ${sum} does not fit the band ${low}..${high}`);
  }
  return sealLock({
    ruleId: 'pairSum',
    params: { target: sum },
    build: () => {
      const a = rng.nextInt(floor, sum - floor);
      const b = sum - a;
      if (b === a) return null;
      // Any third value other than a and b leaves exactly one matching pair.
      const spares = [];
      for (let value = low; value <= high; value++) {
        if (value !== a && value !== b) spares.push(value);
      }
      if (spares.length === 0) return null;
      return { orbs: rng.shuffle([a, b, rng.pick(spares)]) };
    },
  });
}

export function generateFactorChainProblem({ band, seed, factor = 2 }) {
  const rng = createRng(seed);
  const [low, high] = orbRangeForBand(band);
  const base = Math.max(low, 1);
  const maxBase = Math.floor(high / (factor * factor));
  if (maxBase < base) {
    throw new RangeError(`Factor ${factor} does not fit a chain inside ${low}..${high}`);
  }
  const first = rng.nextInt(base, maxBase);
  return makeLock('factorChain', { factor }, rng.shuffle([first, first * factor, first * factor * factor]));
}

export function generateOddOneOutProblem({ band, seed, factor }) {
  const rng = createRng(seed);
  const [low, high] = orbRangeForBand(band);
  const usable = [2, 3, 5, 10].filter(candidate =>
    Math.floor(high / candidate) - Math.max(1, Math.ceil(low / candidate)) + 1 >= 3);
  if (usable.length === 0) {
    throw new RangeError(`No factor has three multiples inside ${low}..${high}`);
  }
  const chosen = Number.isSafeInteger(factor) ? factor : rng.pick(usable);
  if (!usable.includes(chosen)) {
    throw new RangeError(`Factor ${chosen} does not offer three multiples inside ${low}..${high}`);
  }
  const firstMultiple = Math.max(1, Math.ceil(low / chosen));
  const lastMultiple = Math.floor(high / chosen);
  const start = rng.nextInt(firstMultiple, lastMultiple - 2);
  const multiples = [start, start + 1, start + 2].map(step => step * chosen);
  const oddCandidates = [];
  for (let value = low; value <= high; value++) {
    if (value % chosen !== 0) oddCandidates.push(value);
  }
  // Three multiples plus one non-multiple can only ever have one answer.
  return makeLock('oddOneOut', { factor: chosen }, rng.shuffle([...multiples, rng.pick(oddCandidates)]));
}

export function generateEqualShareProblem({ band, seed }) {
  const rng = createRng(seed);
  const [low, high] = orbRangeForBand(band);
  const pileFloor = Math.max(low, 4);
  if (high < pileFloor) {
    throw new RangeError(`Range ${low}..${high} is too small for an equal-share pile`);
  }
  const build = () => {
    const share = rng.nextInt(2, Math.min(high, 12));
    const maxQuotient = Math.floor(high / share);
    if (maxQuotient < 2) return null;
    const quotient = rng.nextInt(2, maxQuotient);
    const pile = share * quotient;
    if (pile < pileFloor) return null;
    const others = [];
    for (let value = 2; value <= Math.min(high, pile); value++) {
      if (value !== share && pile % value !== 0) others.push(value);
    }
    if (others.length < 2) return null;
    const first = rng.pick(others);
    const second = rng.pick(others.filter(value => value !== first));
    if (second === undefined) return null;
    return { orbs: rng.shuffle([share, first, second]), params: { pile } };
  };
  // The pile is per-lock, so it travels with the orbs it was built for.
  return sealLock({ ruleId: 'equalShare', params: { pile: 0 }, build });
}

export function generateComposeProblem({ band, seed, operation }) {
  const rng = createRng(seed);
  const [low, high] = orbRangeForBand(band);
  const chosen = COMPOSE_OPERATIONS.includes(operation) ? operation : rng.pick(COMPOSE_OPERATIONS);
  const build = () => {
    const a = rng.nextInt(Math.max(low, 2), high);
    const maxB = chosen === '+' ? high - a : Math.floor(high / a);
    const floorB = Math.max(low, 2);
    if (maxB < floorB) return null;
    const b = rng.nextInt(floorB, maxB);
    if (b === a) return null;
    const result = chosen === '+' ? a + b : a * b;
    if (result < low || result > high) return null;
    return { orbs: rng.shuffle([a, b, result]) };
  };
  return sealLock({ ruleId: 'composeTarget', params: { operation: chosen }, build });
}

/** Dispatch by rule id, for a phase plan that names rules in data. */
export function generateSequenceProblem({ ruleId, params = {}, band, seed }) {
  const options = { band, seed, ...params };
  switch (ruleId) {
    case 'ascending': return generateOrderingProblem(options);
    case 'descending': return generateOrderingProblem({ ...options, descending: true });
    case 'pairSum': return generatePairSumProblem(options);
    case 'factorChain': return generateFactorChainProblem(options);
    case 'oddOneOut': return generateOddOneOutProblem(options);
    case 'equalShare': return generateEqualShareProblem(options);
    case 'composeTarget': return generateComposeProblem(options);
    default: throw new TypeError(`Unknown seal rule "${ruleId}"`);
  }
}

function fillOptions(rng, answer, preferred, ceiling) {
  const options = [answer];
  const add = value => {
    if (options.length >= 4) return;
    if (!Number.isSafeInteger(value) || value < 0 || value > ceiling) return;
    if (!options.includes(value)) options.push(value);
  };
  for (const value of preferred) add(value);
  for (let offset = 1; options.length < 4 && offset <= 100; offset++) {
    add(answer + offset);
    add(answer - offset);
  }
  if (options.length !== 4) {
    throw new RangeError(`Could not build four choices for answer ${answer}`);
  }
  return rng.shuffle(options);
}

/**
 * Build one fact directly: every branch draws inside the range that makes the
 * fact legal, so a legal band always succeeds without rejection sampling.
 */
function buildInverseFact(rng, operation, floor, high, ceiling) {
  if (operation === '+') {
    const a = rng.nextInt(floor, high);
    const maxB = Math.min(high, ceiling - a);
    if (maxB < floor) return null;
    const b = rng.nextInt(floor, maxB);
    return { a, b, result: a + b, answer: b, question: `${a} + ? = ${a + b}` };
  }
  if (operation === '-') {
    const a = rng.nextInt(floor, high);
    const maxB = Math.min(high, a);
    if (maxB < floor) return null;
    const b = rng.nextInt(floor, maxB);
    return { a, b, result: a - b, answer: b, question: `${a} − ? = ${a - b}` };
  }
  if (operation === '*') {
    const a = rng.nextInt(Math.max(floor, 2), high);
    const maxB = Math.min(high, Math.floor(ceiling / a));
    if (maxB < 2) return null;
    const b = rng.nextInt(2, maxB);
    return { a, b, result: a * b, answer: a, question: `? × ${b} = ${a * b}` };
  }
  const divisor = rng.nextInt(2, Math.max(2, Math.min(high, 12)));
  const quotient = rng.nextInt(2, Math.max(2, Math.min(high, 12)));
  const dividend = divisor * quotient;
  if (dividend > ceiling || dividend < floor) return null;
  return { a: dividend, b: divisor, result: quotient, answer: divisor, question: `${dividend} ÷ ? = ${quotient}` };
}

/**
 * A Warden asking backwards: the equation shows the result and hides a part,
 * so the player has to produce the number instead of reading it off.
 *
 * @returns {{question: string, values: object, answer: number, options: number[],
 *            operation: string, hidden: 'a'|'b', sign: string}}
 */
export function generateInverseProblem({ band, seed, operation }) {
  const rng = createRng(seed);
  const [low, high] = orbRangeForBand(band);
  const operations = Array.isArray(band?.operations) && band.operations.length > 0
    ? band.operations
    : COMPOSE_OPERATIONS;
  const chosen = operations.includes(operation) ? operation : rng.pick(operations);
  const ceiling = Math.max(Number.isSafeInteger(band?.maxResult) ? band.maxResult : 0, high, 20);
  const floor = Math.max(low, 1);

  for (let attempt = 0; attempt < 200; attempt++) {
    const fact = buildInverseFact(rng, chosen, floor, high, ceiling);
    if (!fact) continue;
    const { a, b, result, answer, question } = fact;
    const preferred = {
      // Off-by-one and off-by-ten slips, then the wrong-operation answers.
      '+': [answer + 1, answer - 1, answer + 10, a, result, Math.abs(a - b)],
      '-': [answer + 1, answer - 1, a + b, result, a],
      '*': [answer + 1, answer - 1, a + b, result, a * 2],
      '/': [answer + 1, answer - 1, a + b, a - b, a],
    }[chosen];
    return {
      question,
      values: { a, b, result },
      answer,
      options: fillOptions(rng, answer, preferred, ceiling),
      operation: chosen,
      hidden: chosen === '*' ? 'a' : 'b',
      sign: { '+': '+', '-': '−', '*': '×', '/': '÷' }[chosen],
    };
  }
  throw new Error(`Could not build a safe inverse ${chosen} problem for the band`);
}
