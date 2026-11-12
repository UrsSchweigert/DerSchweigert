// boss-rules.js — pure logic for the Warden "Seal Sequence" locks.
//
// A lock shows a small set of numbered orbs and one rule. The player strikes
// orbs one at a time; a rule decides which strike order (or which subset)
// completes the lock. Nothing here renders, randomises or scores: the lock
// state is a plain list of struck orb indices, so the whole mechanic is
// testable without a DOM and replayable from an input recording.
//
// Rule family:
//   ascending / descending   strike all three orbs in value order
//   factorChain              strike three orbs so each is factor x the last
//   composeTarget            strike two parts, then the whole they make
//   pairSum                  strike the two orbs that add up to a target
//   oddOneOut                strike the one orb that is NOT a multiple
//   equalShare               strike the one orb that splits the pile evenly

const OPERATIONS = new Set(['+', '-', '*', '/']);

export const SEQUENCE_RULES = Object.freeze({
  ascending: Object.freeze({ orbCount: 3, take: 3, symmetricPrefix: 0, params: Object.freeze([]) }),
  descending: Object.freeze({ orbCount: 3, take: 3, symmetricPrefix: 0, params: Object.freeze([]) }),
  factorChain: Object.freeze({ orbCount: 3, take: 3, symmetricPrefix: 0, params: Object.freeze(['factor']) }),
  composeTarget: Object.freeze({ orbCount: 3, take: 3, symmetricPrefix: 2, params: Object.freeze(['operation']) }),
  pairSum: Object.freeze({ orbCount: 3, take: 2, symmetricPrefix: 2, params: Object.freeze(['target']) }),
  oddOneOut: Object.freeze({ orbCount: 4, take: 1, symmetricPrefix: 0, params: Object.freeze(['factor']) }),
  equalShare: Object.freeze({ orbCount: 3, take: 1, symmetricPrefix: 0, params: Object.freeze(['pile']) }),
});

export const RULE_IDS = Object.freeze(Object.keys(SEQUENCE_RULES));

function applyOperation(operation, a, b) {
  if (operation === '+') return a + b;
  if (operation === '-') return a - b;
  if (operation === '*') return a * b;
  if (operation === '/') return b !== 0 && a % b === 0 ? a / b : null;
  return null;
}

const RULE_TESTS = {
  ascending: values => values[0] < values[1] && values[1] < values[2],
  descending: values => values[0] > values[1] && values[1] > values[2],
  factorChain: (values, { factor }) => values[1] === values[0] * factor && values[2] === values[1] * factor,
  composeTarget: (values, { operation }) => applyOperation(operation, values[0], values[1]) === values[2],
  pairSum: (values, { target }) => values[0] + values[1] === target,
  oddOneOut: (values, { factor }) => values[0] % factor !== 0,
  // A share of one always divides evenly, so it never counts as the answer.
  equalShare: (values, { pile }) => values[0] > 1 && pile % values[0] === 0,
};

export function ruleInfo(ruleId) {
  const info = SEQUENCE_RULES[ruleId];
  if (!info) throw new TypeError(`Unknown seal rule "${ruleId}"`);
  return info;
}

function assertParams(ruleId, params) {
  const info = ruleInfo(ruleId);
  const given = params ?? {};
  for (const name of info.params) {
    const value = given[name];
    if (name === 'operation') {
      if (!OPERATIONS.has(value)) {
        throw new TypeError(`Seal rule "${ruleId}" needs an operation of + - * /, got ${value}`);
      }
    } else if (name === 'factor') {
      if (!Number.isSafeInteger(value) || value < 2) {
        throw new TypeError(`Seal rule "${ruleId}" needs a factor of 2 or more, got ${value}`);
      }
    } else if (!Number.isSafeInteger(value) || value < 0) {
      throw new TypeError(`Seal rule "${ruleId}" needs a non-negative integer ${name}, got ${value}`);
    }
  }
}

function assertOrbs(ruleId, orbs) {
  const { orbCount } = ruleInfo(ruleId);
  if (!Array.isArray(orbs) || orbs.length !== orbCount) {
    throw new TypeError(`Seal rule "${ruleId}" needs exactly ${orbCount} orbs`);
  }
  if (!orbs.every(value => Number.isSafeInteger(value) && value >= 0)) {
    throw new TypeError(`Seal rule "${ruleId}" orbs must be non-negative safe integers`);
  }
  if (new Set(orbs).size !== orbs.length) {
    // Duplicate values make a lock ambiguous (two orbs look equally right).
    throw new TypeError(`Seal rule "${ruleId}" orbs must be distinct values`);
  }
}

function* arrangements(indices, take, prefix = []) {
  if (prefix.length === take) {
    yield prefix;
    return;
  }
  for (const index of indices) {
    if (prefix.includes(index)) continue;
    yield* arrangements(indices, take, [...prefix, index]);
  }
}

/**
 * Every way of completing the lock, as ordered orb indices.
 *
 * The list is not deduplicated: for a rule whose first positions may be struck
 * in either order, both orders appear. Use countSolutions for the counts that
 * matter to generation.
 */
export function completions({ ruleId, orbs, params }) {
  const info = ruleInfo(ruleId);
  assertOrbs(ruleId, orbs);
  assertParams(ruleId, params);
  const test = RULE_TESTS[ruleId];
  const found = [];
  for (const order of arrangements(orbs.map((_, index) => index), info.take)) {
    if (test(order.map(index => orbs[index]), params ?? {})) found.push(order);
  }
  return found;
}

/** Indices inside the first `symmetricPrefix` positions are interchangeable. */
export function canonicalKey(order, symmetricPrefix = 0) {
  const head = Math.min(symmetricPrefix, order.length);
  const sorted = order.slice(0, head).sort((a, b) => a - b);
  return [...sorted, ...order.slice(head)].join(',');
}

/** How many distinct completions the lock has. A warden lock must be exactly 1. */
export function countSolutions({ ruleId, orbs, params }) {
  const { symmetricPrefix } = ruleInfo(ruleId);
  const keys = new Set(completions({ ruleId, orbs, params }).map(order => canonicalKey(order, symmetricPrefix)));
  return keys.size;
}

function compareIndexLists(a, b) {
  for (let index = 0; index < Math.min(a.length, b.length); index++) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return a.length - b.length;
}

/** The canonical completion, or null when the lock has none. */
export function solutionFor({ ruleId, orbs, params }) {
  const { symmetricPrefix } = ruleInfo(ruleId);
  const canonical = completions({ ruleId, orbs, params }).map(order => {
    const head = order.slice(0, Math.min(symmetricPrefix, order.length)).sort((a, b) => a - b);
    return [...head, ...order.slice(symmetricPrefix)];
  });
  return canonical.sort(compareIndexLists)[0] ?? null;
}

function matchesPrefix(prefix, completion, symmetricPrefix) {
  if (prefix.length > completion.length) return false;
  for (let position = 0; position < Math.min(prefix.length, symmetricPrefix); position++) {
    if (!completion.slice(0, symmetricPrefix).includes(prefix[position])) return false;
  }
  for (let position = symmetricPrefix; position < prefix.length; position++) {
    if (prefix[position] !== completion[position]) return false;
  }
  return true;
}

/**
 * Strike one orb.
 *
 * A strike is accepted only when it keeps the lock solvable: striking an orb
 * that cannot belong at this point of any completion resets the sequence, so a
 * wrong strike is corrected immediately rather than at the end.
 *
 * @returns {{accepted: boolean, complete: boolean, order: number[], hint: object|null}}
 */
export function evaluateStrike({ ruleId, orbs, params, order = [], orbIndex }) {
  const info = ruleInfo(ruleId);
  assertOrbs(ruleId, orbs);
  assertParams(ruleId, params);
  if (!Array.isArray(order) || !order.every(index => Number.isInteger(index) && index >= 0 && index < orbs.length)) {
    throw new TypeError('Seal lock order must list struck orb indices');
  }
  if (!Number.isInteger(orbIndex) || orbIndex < 0 || orbIndex >= orbs.length) {
    throw new TypeError('Struck orb index is outside the lock');
  }
  if (order.includes(orbIndex)) {
    return { accepted: false, complete: false, order, hint: { key: 'boss.hint.repeat' } };
  }
  if (order.length >= info.take) {
    throw new Error('Seal lock is already complete');
  }

  const candidate = [...order, orbIndex];
  const solvable = completions({ ruleId, orbs, params })
    .some(completion => matchesPrefix(candidate, completion, info.symmetricPrefix));
  if (!solvable) {
    return { accepted: false, complete: false, order: [], hint: { key: 'boss.hint.reset' } };
  }
  return {
    accepted: true,
    complete: candidate.length === info.take,
    order: candidate,
    hint: null,
  };
}

/**
 * The hint ladder from MA7: restate the rule after the first miss, then light
 * the next orb the lock still needs. Text lives in i18n; this returns keys.
 *
 * @returns {{key: string, ruleId?: string, orbIndex?: number}|null}
 */
export function hintFor({ ruleId, orbs, params, order = [], missed = 0 }) {
  if (missed <= 0) return null;
  if (missed === 1) return { key: 'boss.hint.restate', ruleId };
  const solution = solutionFor({ ruleId, orbs, params }) ?? [];
  const next = solution.find(index => !order.includes(index));
  return next === undefined
    ? { key: 'boss.hint.restate', ruleId }
    : { key: 'boss.hint.reveal', orbIndex: next };
}
