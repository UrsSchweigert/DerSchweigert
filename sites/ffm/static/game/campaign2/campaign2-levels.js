// Arithmoslayer II (Campaign 2): 40 levels in eight five-level acts that reach from
// fractions to powers, roots and logarithms. This module holds the curriculum table and
// the question generator. Acts 1-2 (fractions) live here, acts 3-8 in kinds.js.
//
// Every answer is a canonical key (fractions.js: "7/12", "5") and every option is a key
// of a different value, so there is exactly one correct button. Distractors come from
// real slips (adding denominators, forgetting to flip, ...), not random numbers.
import { lcg } from '../levels.js';
import { add, sub, mul, div, frac, gcd, lcm, equals, compare, key } from './fractions.js';
import { LATE_KINDS } from './kinds.js';
import { parseVal } from './exact.js';
import { valueToken } from './expr.js';

export const TOTAL_LEVELS_2 = 40;
export const IMPLEMENTED_LEVELS_2 = 40;
export const OPTION_COUNT_2 = 4;
export const BOSS_ROUND_LEVELS_2 = Object.freeze([10, 20, 30, 40]);
export const BOSS_ROUND_HITS_2 = 3;
export const MISSING_OPERAND_BONUS_2 = 25;

export const ACTS = Object.freeze([
  { act: 1, from: 1, name: 'Fractions I', skill: 'fractions' },
  { act: 2, from: 6, name: 'Fractions II', skill: 'unlike' },
  { act: 3, from: 11, name: 'Powers', skill: 'powers' },
  { act: 4, from: 16, name: 'Roots', skill: 'roots' },
  { act: 5, from: 21, name: 'Exponent laws', skill: 'exponentLaws' },
  { act: 6, from: 26, name: 'Radicals', skill: 'radicals' },
  { act: 7, from: 31, name: 'Logarithms', skill: 'logarithms' },
  { act: 8, from: 36, name: 'Synthesis', skill: 'synthesis' },
]);

export function actForLevel(level) {
  assertLevel(level);
  return ACTS.filter(a => level >= a.from).pop();
}

// Question-kind mix per level (weights, not percentages). The act's first level leans
// on its new idea, the fifth level mixes the act (levels 5 and 10 are review/boss).
const MIX = {
  1: { equiv: 1 },
  2: { equiv: 5, simplify: 5 },
  3: { simplify: 4, addLike: 6 },
  4: { simplify: 2, addLike: 4, subLike: 4 },
  5: { equiv: 2, simplify: 3, addLike: 3, subLike: 3 },
  6: { addUnlike: 5, addLike: 2, subLike: 2, simplify: 1 },
  7: { addUnlike: 3, subUnlike: 4, addLike: 1.5, subLike: 1.5 },
  8: { mul: 5, addUnlike: 2, subUnlike: 2, simplify: 1 },
  9: { div: 5, mul: 2, addUnlike: 1.5, subUnlike: 1.5 },
  10: { addUnlike: 2, subUnlike: 2, mul: 3, div: 3 },
};

// Levels 11-40: the act's own kinds (weights), plus a review of the two acts before it.
const NEW_MIX = {
  11: { pwSq: 5, pwTwo: 4 }, 12: { pwCube: 4, pwTwo: 3, pwSq: 2 }, 13: { pwNeg: 4, pwSpecial: 3, pwCube: 2 },
  14: { pwExpr: 5, pwNeg: 2, pwSq: 1 }, 15: { pwSq: 1, pwCube: 1, pwTwo: 1, pwNeg: 1, pwSpecial: 1, pwExpr: 3 },
  16: { rtSq: 8, rtCube: 2 }, 17: { rtCube: 4, rtPyth: 3, rtSq: 2 }, 18: { rtCube: 4, rtPyth: 3, rtSq: 2 },
  19: { rtFrac: 5, rtSq: 2, rtCube: 2 }, 20: { combo: 4, rtFrac: 2, rtPyth: 2, rtCube: 1 },
  21: { lawMul: 4, lawDiv: 3, lawPow: 3 }, 22: { negExp: 6, lawMul: 1, lawDiv: 1 }, 23: { negExpFrac: 5, negExp: 2, lawPow: 2 },
  24: { fracExp: 7, negExp: 1 }, 25: { lawMul: 1.5, lawDiv: 1.5, lawPow: 1.5, negExp: 2, negExpFrac: 1, fracExp: 3, comboExp: 2 },
  26: { surdSimplify: 7, surdCoef: 3 }, 27: { surdSimplify: 5, surdCoef: 4 }, 28: { surdAdd: 6, surdSimplify: 2 },
  29: { surdMul: 4, rationalise: 4, surdAdd: 2 }, 30: { surdAdd: 3, surdMul: 3, rationalise: 3, comboExp: 2, surdSimplify: 1 },
  31: { logBasic: 8 }, 32: { logFrac: 5, logBasic: 3 }, 33: { logSum: 4, logDiff: 3, logBasic: 2 },
  34: { logProd: 3, logQuot: 3, logPow: 3 }, 35: { logSum: 2, logDiff: 2, logProd: 2, logQuot: 2, logPow: 2, logFrac: 1, comboLog: 2 },
  36: { synth: 4, surdAdd: 3, logBasic: 1 }, 37: { synth: 5, surdAdd: 3 }, 38: { synth3: 5, surdAdd: 3 },
  39: { synth3: 6, surdAdd: 3, synth: 1 }, 40: { synth3: 5, surdAdd: 3, synth: 2 },
};
const CORE = {
  1: ['simplify', 'addLike', 'subLike'], 2: ['addUnlike', 'subUnlike', 'mul', 'div'],
  3: ['pwSq', 'pwCube', 'pwTwo', 'pwNeg', 'pwExpr'], 4: ['rtSq', 'rtCube', 'rtPyth', 'rtFrac'],
  5: ['lawMul', 'lawDiv', 'lawPow', 'negExp', 'fracExp'], 6: ['surdSimplify', 'surdAdd', 'surdMul'],
  7: ['logBasic', 'logSum', 'logDiff', 'logProd'],
};
export const REVIEW_SHARE = 0.35;

/** Kind weights of a level: the act's own plus, from level 11, a 35% review of earlier acts. */
export function levelMix(level) {
  assertLevel(level);
  if (MIX[level]) return MIX[level];
  const fresh = NEW_MIX[level];
  const total = Object.values(fresh).reduce((a, b) => a + b, 0);
  const act = actForLevel(level).act;
  const review = [...new Set([act - 1, act - 2].filter(a => a >= 1).flatMap(a => CORE[a] ?? []))];
  const mix = {};
  for (const [k, w] of Object.entries(fresh)) mix[k] = (w / total) * (1 - REVIEW_SHARE);
  for (const k of review) mix[k] = (mix[k] ?? 0) + REVIEW_SHARE / review.length;
  return mix;
}
export const MIXED_NUMBERS_FROM_LEVEL = 7;
export const MISSING_OPERAND_FROM_LEVEL_2 = 5;

/** Share of questions hiding an operand: none before level 5, then 20% rising to 60% at 40. */
export function missingOperandShare2(level) {
  if (level < MISSING_OPERAND_FROM_LEVEL_2) return 0;
  return 0.2 + (0.4 * (level - MISSING_OPERAND_FROM_LEVEL_2)) / (TOTAL_LEVELS_2 - MISSING_OPERAND_FROM_LEVEL_2);
}

export const isBossRoundLevel2 = level => BOSS_ROUND_LEVELS_2.includes(level);

/** The three question types of a boss round, easiest first (the last fiend cycles through them). */
export function bossRoundKinds2(level) {
  if (!isBossRoundLevel2(level)) throw new RangeError(`Level ${level} has no boss round`);
  const newest = { 10: ['div'], 20: ['combo'], 30: ['surdAdd', 'rationalise', 'comboExp'], 40: ['synth3'] }[level];
  return [{ missing: false }, { kinds: newest, missing: false }, { missing: true }];
}

function assertLevel(level) {
  if (!Number.isInteger(level) || level < 1 || level > TOTAL_LEVELS_2) {
    throw new RangeError(`Level must be between 1 and ${TOTAL_LEVELS_2}`);
  }
}

export function levelKinds(level) {
  return Object.keys(levelMix(level));
}

function shuffle(values, rng) {
  for (let i = values.length - 1; i > 0; i--) {
    const j = rng.nextInt(0, i);
    [values[i], values[j]] = [values[j], values[i]];
  }
  return values;
}

const safe = fn => { try { return fn(); } catch { return null; } };

function pickKind(mix, kinds, rng) {
  const entries = Object.entries(mix).filter(([kind]) => !kinds || kinds.includes(kind));
  const pool = entries.length ? entries : Object.entries(mix);
  const total = pool.reduce((sum, [, w]) => sum + w, 0);
  let draw = (rng.nextInt(0, 9999) / 10000) * total;
  for (const [kind, w] of pool) { if ((draw -= w) < 0) return kind; }
  return pool[pool.length - 1][0];
}

const intTok = v => ({ t: 'int', v });
const fracTok = (n, d) => ({ t: 'frac', n, d });
const op = s => ({ t: 'op', s });
const EQ = op('=');
const SIGN = { add: '+', sub: '−', mul: '×', div: '÷' };

function valueTok(x) {
  return x.d === 1 ? intTok(x.n) : fracTok(x.n, x.d);
}

function properFrac(rng, dMin, dMax, reduced) {
  for (;;) {
    const d = rng.nextInt(dMin, dMax);
    const n = rng.nextInt(1, d - 1);
    if (!reduced || gcd(n, d) === 1) return { n, d };
  }
}

// --- distractors ---------------------------------------------------------------------

function pickFractionDistractors(answer, candidates, rng) {
  const seen = new Set([key(answer)]);
  const out = [];
  const take = c => {
    if (!c || c.n < 1 || c.d > 99 || c.n > 99 || seen.has(key(c))) return;
    seen.add(key(c));
    out.push(c);
  };
  shuffle(candidates.filter(Boolean), rng).forEach(take);
  for (let k = 1; out.length < OPTION_COUNT_2 - 1 && k < 12; k++) {
    for (const c of shuffle([safe(() => frac(answer.n + k, answer.d)), safe(() => frac(answer.n, answer.d + k)),
      safe(() => frac(answer.n - k, answer.d)), safe(() => frac(answer.d, answer.n))], rng)) take(c);
  }
  return out.slice(0, OPTION_COUNT_2 - 1).map(key);
}

function pickIntDistractors(answer, candidates, rng) {
  const seen = new Set([answer]);
  const out = [];
  const take = v => { if (Number.isInteger(v) && v >= 1 && !seen.has(v)) { seen.add(v); out.push(v); } };
  shuffle([...candidates], rng).forEach(take);
  for (let k = 1; out.length < OPTION_COUNT_2 - 1; k++) { take(answer + k); take(answer - k); }
  return out.slice(0, OPTION_COUNT_2 - 1).map(String);
}

// --- question kinds ------------------------------------------------------------------

function drawEquiv(level, rng) {
  const b = rng.nextInt(2, level <= 1 ? 4 : 6);
  const a = rng.nextInt(1, b - 1);
  const m = rng.nextInt(2, level <= 1 ? 3 : 5);
  const D = b * m;
  const answer = a * m;
  const distractors = pickIntDistractors(answer, [a + (D - b), a + m, D - b, answer - 1, answer + 1, a * (m + 1), b], rng);
  return {
    kind: 'equiv', tokens: [fracTok(a, b), EQ, { t: 'fracBlank', d: D }],
    answer: String(answer), distractors, hidden: null,
  };
}

function drawSimplify(level, rng) {
  for (;;) {
    const g = rng.nextInt(2, level <= 3 ? 4 : 6);
    const d = rng.nextInt(2, level <= 3 ? 5 : 8);
    const n = rng.nextInt(1, d - 1);
    if (gcd(n, d) !== 1) continue;
    const a = n * g, b = d * g;
    const answer = frac(a, b);
    const distractors = pickFractionDistractors(answer, [
      safe(() => frac(n, b)), safe(() => frac(a, d)), safe(() => frac(d, n)),
      safe(() => frac(a - g, b - g)), safe(() => frac(n + 1, d)), safe(() => frac(n, d + 1)),
    ], rng);
    return { kind: 'simplify', tokens: [fracTok(a, b), EQ, { t: 'blank' }], answer: key(answer), distractors, hidden: null };
  }
}

/** Two operands and the exact result for an arithmetic kind, plus how to show them. */
function drawArithmetic(kind, level, rng, reducedOperands) {
  let x, y, xTok, yTok;
  if (kind === 'addLike' || kind === 'subLike') {
    const d = rng.nextInt(3, level <= 4 ? 8 : 12);
    let n1, n2;
    do {
      n1 = rng.nextInt(1, d - 1); n2 = rng.nextInt(1, d - 1);
      if (kind === 'subLike' && n1 < n2) [n1, n2] = [n2, n1];
    } while ((kind === 'subLike' && n1 === n2) || (reducedOperands && (gcd(n1, d) !== 1 || gcd(n2, d) !== 1)));
    x = frac(n1, d); y = frac(n2, d);
    xTok = fracTok(n1, d); yTok = fracTok(n2, d);
  } else {
    const isUnlike = kind === 'addUnlike' || kind === 'subUnlike';
    const dMax = isUnlike ? 12 : level <= 8 ? 8 : 12;
    const lcmMax = level <= 6 ? 24 : 36;
    let p, q;
    do {
      p = properFrac(rng, 2, dMax, true); q = properFrac(rng, 2, dMax, true);
    } while (isUnlike && (p.d === q.d || lcm(p.d, q.d) > lcmMax));
    x = frac(p.n, p.d); y = frac(q.n, q.d);
    xTok = fracTok(p.n, p.d); yTok = fracTok(q.n, q.d);
    if (kind === 'subUnlike' && compare(x, y) < 0) { [x, y] = [y, x]; [xTok, yTok] = [yTok, xTok]; }
    if (kind === 'subUnlike' && equals(x, y)) return drawArithmetic(kind, level, rng, reducedOperands);
    if (level >= MIXED_NUMBERS_FROM_LEVEL && rng.nextInt(0, 99) < 30 && kind !== 'div') {
      const w = rng.nextInt(1, 3);
      xTok = { t: 'mixed', w, n: x.n, d: x.d };   // x is still the proper fraction here
      x = add(x, frac(w));
    }
  }
  const base = kind.replace(/Like|Unlike/, '');
  const r = { add, sub, mul, div }[base](x, y);
  return { kind, base, x, y, xTok, yTok, r };
}

function arithmeticDistractors(q, rng) {
  const { base, x, y, r } = q;
  const generic = [safe(() => frac(r.n + 1, r.d)), safe(() => frac(r.n, r.d + 1))];
  const lists = {
    add: [safe(() => frac(x.n + y.n, x.d + y.d)), safe(() => frac(x.n + y.n, x.d * y.d)),
      safe(() => mul(x, y)), safe(() => frac(x.n + y.n, Math.max(x.d, y.d)))],
    sub: [safe(() => frac(Math.abs(x.n - y.n), Math.abs(x.d - y.d))), safe(() => frac(Math.abs(x.n - y.n), x.d * y.d)),
      safe(() => add(x, y)), safe(() => frac(Math.abs(x.n - y.n), Math.max(x.d, y.d)))],
    mul: [safe(() => add(x, y)), safe(() => div(x, y)), safe(() => frac(x.n * y.n, x.d + y.d)), safe(() => frac(x.n * y.d, x.d * y.d + 1))],
    div: [safe(() => mul(x, y)), safe(() => div(y, x)), safe(() => frac(r.d, r.n)), safe(() => frac(x.n * y.d, x.d + y.n))],
  };
  return pickFractionDistractors(r, [...lists[base], ...generic], rng);
}

function hiddenDistractors(q, hiddenValue, otherValue, rng) {
  return pickFractionDistractors(hiddenValue, [
    q.r, otherValue, safe(() => add(q.r, otherValue)), safe(() => sub(q.r, otherValue)),
    safe(() => frac(hiddenValue.d, hiddenValue.n)),
    safe(() => frac(hiddenValue.n + 1, hiddenValue.d)), safe(() => frac(hiddenValue.n, hiddenValue.d + 1)),
  ].map(c => (c && c.n < 0 ? frac(-c.n, c.d) : c)), rng);
}

function drawArithmeticProblem(kind, level, rng, wantHidden) {
  const q = drawArithmetic(kind, level, rng, wantHidden);
  const rTok = valueTok(q.r);
  const sign = op(SIGN[q.base]);
  if (!wantHidden) {
    return {
      kind, tokens: [q.xTok, sign, q.yTok, EQ, { t: 'blank' }],
      answer: key(q.r), distractors: arithmeticDistractors(q, rng), hidden: null,
    };
  }
  // A mixed first operand is never the hidden one (its answer would not match its shape).
  const hidden = q.xTok.t === 'mixed' || rng.nextInt(0, 1) ? 'b' : 'a';
  const hiddenValue = hidden === 'a' ? q.x : q.y;
  const otherValue = hidden === 'a' ? q.y : q.x;
  const tokens = hidden === 'a'
    ? [{ t: 'blank' }, sign, q.yTok, EQ, rTok]
    : [q.xTok, sign, { t: 'blank' }, EQ, rTok];
  return { kind, tokens, answer: key(hiddenValue), distractors: hiddenDistractors(q, hiddenValue, otherValue, rng), hidden };
}

const EARLY_KINDS = {
  equiv: { draw: (level, rng) => drawEquiv(level, rng) },
  simplify: { draw: (level, rng) => drawSimplify(level, rng) },
  ...Object.fromEntries(['addLike', 'subLike', 'addUnlike', 'subUnlike', 'mul', 'div'].map(kind => [kind, {
    canHide: true, draw: (level, rng, hide) => drawArithmeticProblem(kind, level, rng, hide),
  }])),
};
export const KINDS = { ...EARLY_KINDS, ...LATE_KINDS };

/**
 * One Campaign 2 question. Same idea as generateProblem in levels.js, but the answer is a
 * canonical key string ("7/12", "-3", "6√2") and `options` are keys; render them with
 * math-render.js.
 *
 * @param {number} level - 1-based Campaign 2 level.
 * @param {number} seed
 * @param {{kinds?: string[], missing?: boolean}} [options] - force the question type
 *   (`kinds` restricts it, `missing: true` hides an operand, `missing: false` never does).
 */
export function generateProblem2(level, seed, options = {}) {
  assertLevel(level);
  const rng = lcg(seed);
  const mix = levelMix(level);
  const share = options.missing === true ? 1 : options.missing === false ? 0 : missingOperandShare2(level);
  const hidable = Object.fromEntries(Object.entries(mix).filter(([k]) => KINDS[k].canHide));
  const wantHidden = Object.keys(hidable).length > 0 && rng.nextInt(0, 99) < Math.round(share * 100);
  const kind = pickKind(wantHidden ? hidable : mix, options.kinds, rng);
  const body = KINDS[kind].draw(level, rng, wantHidden);
  const shuffled = shuffle([body.answer, ...body.distractors], rng);
  return { level, ...body, options: shuffled, bonus: body.hidden ? MISSING_OPERAND_BONUS_2 : 0 };
}

/** The question's tokens with the blank filled in with the answer, for the reveal after a miss. */
export function revealTokens2(problem) {
  const v = parseVal(problem.answer);
  const fill = tokens => tokens.map(t => {
    if (t.t === 'blank') return valueToken(v);
    if (t.t === 'fracBlank') return { t: 'frac', n: v.q.n, d: t.d };
    if (t.t === 'surdBlank') return { t: 'surd', q: v.q, r: t.r };
    const out = { ...t };
    for (const k of ['body', 'base', 'exp']) if (Array.isArray(t[k])) out[k] = fill(t[k]);
    return out;
  });
  return fill(problem.tokens);
}
