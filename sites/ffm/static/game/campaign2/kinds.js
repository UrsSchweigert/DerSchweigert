// Question kinds for Campaign 2 acts 3-8: powers, roots, exponent laws, radicals,
// logarithms and the mixed "synthesis" expressions. Each draw(level, rng, hide) returns
// { kind, tokens, answer, distractors, hidden } where the answer is an exact value key and
// the distractors are the slips a student really makes. `hide` asks for the backwards form
// (an operand replaced by ?); only kinds with canHide honour it. Answers are computed with
// the exact evaluator, never by hand, so a kind cannot disagree with expr.js.
import { gcd } from './fractions.js';
import {
  val, surd, vAdd, vSub, vMul, vDiv, vPow, vSqrt, valKey, isRational, isZero,
} from './exact.js';
import {
  I, F, OP, EQ, BLANK, PAREN, ROOT, LOG, SURD, POW, valueToken, evalTokens,
} from './expr.js';
import { pick, safe, pickDistractors, V, shuffle } from './draw-utils.js';

const ADD = OP('+'), SUBT = OP('−'), TIMES = OP('×'), DIVIDE = OP('÷');
const ev = tokens => evalTokens(tokens);

function build(kind, tokens, answer, candidates, rng, hidden = null) {
  return { kind, tokens, answer: valKey(answer), distractors: pickDistractors(answer, candidates, rng), hidden };
}
/** "X = ?" for a plain expression. */
function ask(kind, expr, candidates, rng) {
  return build(kind, [...expr, EQ, BLANK], ev(expr), candidates, rng);
}
const sgn = v => (v < 0 ? -1 : 1);

// ---------------------------------------------------------------- Act 3: powers
function pwSq(level, rng) {
  const n = rng.nextInt(2, level <= 12 ? 9 : 15);
  return ask('pwSq', [POW(I(n), I(2))], [2 * n, n * (n - 1), (n + 1) ** 2, (n - 1) ** 2, n * n + n, n ** 3], rng);
}

function pwCube(level, rng, hide) {
  const n = rng.nextInt(2, level <= 12 ? 5 : 6);
  if (!hide) return ask('pwCube', [POW(I(n), I(3))], [3 * n, n * n, (n + 1) ** 3, (n - 1) ** 3, n ** 3 + n, n ** 3 - n], rng);
  return build('pwCube', [POW(BLANK, I(3)), EQ, I(n ** 3)], V(n), [n + 1, n - 1, 3 * n, n * n, -n], rng, 'a');
}

function pwTwo(level, rng, hide) {
  const [b, lo, hi] = pick(rng, [[2, 4, 10], [2, 4, 10], [3, 2, 5], [5, 2, 4], [10, 2, 4]]);
  const k = rng.nextInt(lo, hi);
  if (!hide) return ask('pwTwo', [POW(I(b), I(k))], [b * k, k ** b, b ** (k - 1), b ** (k + 1), b ** k - b, b ** k + b], rng);
  return build('pwTwo', [POW(I(b), BLANK), EQ, I(b ** k)], V(k), [k + 1, k - 1, b, 2 * k, b * k], rng, 'b');
}

function pwNeg(level, rng) {
  const a = rng.nextInt(2, 6), k = rng.nextInt(2, 4);
  const ans = (-a) ** k;
  return ask('pwNeg', [POW(I(-a), I(k))], [-ans, a * k, -a * k, ans + a, ans - a, sgn(ans) * a ** (k - 1)], rng);
}

function pwSpecial(level, rng) {
  const n = rng.nextInt(2, 12);
  const choice = pick(rng, [
    { expr: [POW(I(n), I(0))], cands: [0, n, -1, 10, n - 1] },
    { expr: [POW(I(n), I(1))], cands: [1, 0, n + 1, n * n, n - 1] },
    { expr: [POW(I(-n), I(0))], cands: [0, -1, -n, n, 2] },
    { expr: [POW(I(n), I(0)), ADD, POW(I(n), I(1))], cands: [n, 2, n + 2, 2 * n, n - 1] },
  ]);
  return ask('pwSpecial', choice.expr, choice.cands, rng);
}

/** A small power term with the value of its classic slip (n² read as 2n). */
function powTerm(rng, cubeOk) {
  const form = pick(rng, cubeOk ? ['sq', 'sq', 'cube', 'two'] : ['sq', 'sq', 'two']);
  if (form === 'sq') { const n = rng.nextInt(2, 9); return { tok: POW(I(n), I(2)), v: n * n, mis: 2 * n }; }
  if (form === 'cube') { const n = rng.nextInt(2, 4); return { tok: POW(I(n), I(3)), v: n ** 3, mis: 3 * n }; }
  const k = rng.nextInt(2, 6); return { tok: POW(I(2), I(k)), v: 2 ** k, mis: 2 * k };
}

function pwExpr(level, rng) {
  for (;;) {
    const A = powTerm(rng, true), B = powTerm(rng, level >= 15);
    const sign = pick(rng, ['+', '−', '×']);
    const f = { '+': (x, y) => x + y, '−': (x, y) => x - y, '×': (x, y) => x * y }[sign];
    const ans = f(A.v, B.v);
    if (ans <= 0 || ans > 300) continue;
    const other = { '+': (x, y) => x * y, '−': (x, y) => x + y, '×': (x, y) => x + y }[sign];
    return ask('pwExpr', [A.tok, OP(sign), B.tok],
      [ans + 1, ans - 1, f(A.mis, B.v), f(A.v, B.mis), other(A.v, B.v), Math.abs(A.v - B.v)], rng);
  }
}

// ---------------------------------------------------------------- Act 4: roots
function rtSq(level, rng, hide) {
  const n = rng.nextInt(2, level <= 16 ? 12 : 20);
  if (!hide) return ask('rtSq', [ROOT(2, I(n * n))], [n + 1, n - 1, 2 * n, n + 2, n - 2, val(n * n, 2)], rng);
  return build('rtSq', [ROOT(2, BLANK), EQ, I(n)], V(n * n), [2 * n, n * (n + 1), n * (n - 1), n * n + 1, n * n - 1], rng, 'a');
}

function rtCube(level, rng, hide) {
  const n = rng.nextInt(2, 10);
  const negative = !hide && level >= 18 && rng.nextInt(0, 3) === 0;
  const radicand = negative ? -(n ** 3) : n ** 3;
  if (!hide) {
    const ans = negative ? -n : n;
    return ask('rtCube', [ROOT(3, I(radicand))], [ans + 1, ans - 1, 3 * ans, -ans, n * n, val(n ** 3, 3)], rng);
  }
  return build('rtCube', [ROOT(3, BLANK), EQ, I(n)], V(n ** 3), [3 * n, n * n, n ** 3 + n, n ** 3 - n, 2 * n], rng, 'a');
}

const TRIPLES = [[3, 4, 5], [6, 8, 10], [5, 12, 13], [9, 12, 15], [8, 15, 17], [12, 16, 20], [7, 24, 25], [20, 21, 29]];
function rtPyth(level, rng) {
  const [a, b, c] = pick(rng, TRIPLES);
  const [x, y] = rng.nextInt(0, 1) ? [a, b] : [b, a];
  return ask('rtPyth', [ROOT(2, POW(I(x), I(2)), ADD, POW(I(y), I(2)))], [x + y, c + 1, c - 1, c * c, x * y, x + y - 1], rng);
}

function coprimePair(rng, lo, hi) {
  for (;;) {
    const p = rng.nextInt(lo, hi), q = rng.nextInt(lo, hi);
    if (p !== q && gcd(p, q) === 1) return [p, q];
  }
}
function rtFrac(level, rng) {
  if (rng.nextInt(0, 2) === 0) {
    const [p, q] = coprimePair(rng, 1, 5);
    return ask('rtFrac', [ROOT(3, F(p ** 3, q ** 3))], [safe(() => val(p ** 3, q)), safe(() => val(p, q ** 3)), safe(() => val(q, p)), safe(() => val(p ** 3, q ** 3)), safe(() => val(p + 1, q))], rng);
  }
  const [p, q] = coprimePair(rng, 2, 9);
  return ask('rtFrac', [ROOT(2, F(p * p, q * q))], [safe(() => val(p * p, q)), safe(() => val(p, q * q)), safe(() => val(q, p)), safe(() => val(p * p, q * q)), safe(() => val(p - 1, q)), safe(() => val(p, q + 1))], rng);
}

// ---------------------------------------------------------------- Act 5: exponent laws
const LAW_BASES = [2, 2, 3, 3, 5, 7, 10];
const fits = (a, e) => a ** e <= 1e9;   // the exact evaluator's limit
function lawMul(level, rng, hide) {
  let a, m, n;
  do { a = pick(rng, LAW_BASES); m = rng.nextInt(2, 6); n = rng.nextInt(2, 6); } while (!fits(a, m + n));
  if (!hide) return build('lawMul', [POW(I(a), I(m)), TIMES, POW(I(a), I(n)), EQ, POW(I(a), BLANK)], V(m + n), [m * n, m + n + 1, m + n - 1, Math.abs(m - n), 2 * (m + n)], rng);
  return build('lawMul', [POW(I(a), I(m)), TIMES, POW(I(a), BLANK), EQ, POW(I(a), I(m + n))], V(n), [m + n, m * n, n + 1, n - 1, m + n + m], rng, 'b');
}
function lawDiv(level, rng, hide) {
  let a, m, n;
  do { a = pick(rng, LAW_BASES); n = rng.nextInt(2, 6); m = rng.nextInt(2, 8); } while (!fits(a, m));
  if (!hide) return build('lawDiv', [POW(I(a), I(m)), DIVIDE, POW(I(a), I(n)), EQ, POW(I(a), BLANK)], V(m - n), [m + n, m * n, Math.abs(m - n) + 1, n - m, Math.floor(m / n)], rng);
  return build('lawDiv', [POW(I(a), I(m)), DIVIDE, POW(I(a), BLANK), EQ, POW(I(a), I(m - n))], V(n), [m + (m - n), m - n, m * (m - n), n + 1, n - 1], rng, 'b');
}
function lawPow(level, rng, hide) {
  let a, m, n;
  do { a = pick(rng, [2, 3, 5, 10]); m = rng.nextInt(2, 4); n = rng.nextInt(2, 4); } while (!fits(a, m * n));
  if (!hide) return build('lawPow', [POW(POW(I(a), I(m)), I(n)), EQ, POW(I(a), BLANK)], V(m * n), [m + n, m ** n, n ** m, m * n + 1, m * n - 1], rng);
  return build('lawPow', [POW(POW(I(a), BLANK), I(n)), EQ, POW(I(a), I(m * n))], V(m), [m * n, m + n, m + 1, m - 1, n], rng, 'a');
}

function negExp(level, rng) {
  const a = rng.nextInt(2, 6), n = a <= 3 ? rng.nextInt(1, 4) : rng.nextInt(1, 3);
  return ask('negExp', [POW(I(a), I(-n))], [-(a ** n), -a * n, a ** n, safe(() => val(1, a * n)), safe(() => val(-1, a ** n)), safe(() => val(1, a ** (n + 1)))], rng);
}
function negExpFrac(level, rng) {
  const [p, q] = coprimePair(rng, 2, 5);
  const n = rng.nextInt(1, 3);
  return ask('negExpFrac', [POW(F(p, q), I(-n))], [
    safe(() => val(p ** n, q ** n)), safe(() => val(-(p ** n), q ** n)), safe(() => val(q * n, p)),
    safe(() => val(q ** n, p * n)), safe(() => val(-(q ** n), p ** n)),
  ], rng);
}

function fracExp(level, rng) {
  const form = pick(rng, ['half', 'half', 'third', 'threeHalves', 'twoThirds', 'negHalf']);
  let base, exp, root;
  if (form === 'half') { root = pick(rng, [2, 3, 4, 5, 6, 7, 8, 9, 10]); base = root * root; exp = F(1, 2); }
  else if (form === 'third') { root = pick(rng, [2, 3, 4, 5]); base = root ** 3; exp = F(1, 3); }
  else if (form === 'threeHalves') { root = pick(rng, [2, 3, 4, 5]); base = root * root; exp = F(3, 2); }
  else if (form === 'twoThirds') { root = pick(rng, [2, 3, 4]); base = root ** 3; exp = F(2, 3); }
  else { root = pick(rng, [2, 3, 4, 5, 6]); base = root * root; exp = F(-1, 2); }
  const tokens = [POW(I(base), exp)];
  const ans = ev(tokens);
  const e = exp.n / exp.d;
  return ask('fracExp', tokens, [safe(() => val(base * exp.n, exp.d)), safe(() => val(base, exp.d)), safe(() => val(root * exp.d, exp.n || 1)),
    safe(() => vMul(ans, val(2))), safe(() => vDiv(val(1), ans)), safe(() => val(Math.round(base ** Math.abs(e)))), safe(() => vAdd(ans, val(1)))], rng);
}

// ---------------------------------------------------------------- Act 6: radicals
const SQFREE = [2, 3, 5, 6, 7, 10];
function surdParts(rng, maxRadicand = 200) {
  for (;;) {
    const s = rng.nextInt(2, 7), t = pick(rng, SQFREE);
    if (s * s * t <= maxRadicand) return { s, t, n: s * s * t };
  }
}
function surdSimplify(level, rng) {
  const { s, t, n } = surdParts(rng);
  return ask('surdSimplify', [ROOT(2, I(n))], [val(s * t), surd(s + 1, 1, t), surd(s, 1, t + 1), surd(s * s, 1, t), surd(s - 1, 1, t), safe(() => surd(t, 1, s))], rng);
}
function surdCoef(level, rng) {
  const { s, t, n } = surdParts(rng);
  return build('surdCoef', [ROOT(2, I(n)), EQ, { t: 'surdBlank', r: t }], V(s), [s * s, s * t, s + 1, s - 1, t, Math.round(n / 2)], rng);
}
function surdAdd(level, rng, hide) {
  for (;;) {
    const t = pick(rng, [2, 3, 5]);
    const count = level >= 36 ? 3 : 2;
    const coefs = Array.from({ length: count }, () => rng.nextInt(1, level >= 36 ? 6 : 5));
    const signs = coefs.map((_, i) => (i === 0 ? 1 : pick(rng, [1, 1, -1])));
    const total = coefs.reduce((sum, c, i) => sum + signs[i] * c, 0);
    if (total <= 0 || coefs.some((c, i) => i > 0 && signs[i] < 0 && c >= coefs[0] + 4)) continue;
    const terms = coefs.map(c => (c === 1 || rng.nextInt(0, 2) ? ROOT(2, I(c * c * t)) : SURD(c, 1, t)));
    const expr = terms.flatMap((term, i) => (i === 0 ? [term] : [OP(signs[i] > 0 ? '+' : '−'), term]));
    const answer = surd(total, 1, t);
    if (!hide) {
      const radicands = coefs.reduce((sum, c, i) => sum + signs[i] * c * c * t, 0);
      return build('surdAdd', [...expr, EQ, BLANK], answer, [
        safe(() => vSqrt(val(radicands))), surd(total + 1, 1, t), surd(total - 1, 1, t), val(total * t),
        safe(() => surd(coefs.reduce((x, c, i) => x + signs[i] * c * c, 0), 1, t)), safe(() => surd(total, 1, t + 1)),
      ], rng);
    }
    const hiddenAt = rng.nextInt(0, count - 1);
    if (hiddenAt === 0) continue;                         // keep the leading sign positive
    const hiddenValue = surd(signs[hiddenAt] * coefs[hiddenAt], 1, t);
    const tokens = expr.map((term, i) => (i === hiddenAt * 2 ? BLANK : term));
    if (signs[hiddenAt] < 0) continue;
    return build('surdAdd', [...tokens, EQ, valueToken(answer)], hiddenValue, [
      surd(total, 1, t), surd(coefs[hiddenAt] + 1, 1, t), surd(coefs[hiddenAt] - 1, 1, t), val(coefs[hiddenAt] * t), surd(coefs[hiddenAt] * coefs[hiddenAt], 1, t),
    ], rng, 'x');
  }
}
function surdMul(level, rng, hide) {
  for (;;) {
    const p = rng.nextInt(2, 20), q = rng.nextInt(2, 20);
    if (p === q) continue;
    const tokens = [ROOT(2, I(p)), TIMES, ROOT(2, I(q))];
    const ans = ev(tokens);
    if (!hide) {
      return build('surdMul', [...tokens, EQ, BLANK], ans, [safe(() => vSqrt(val(p + q))), val(p * q), safe(() => vMul(ans, val(2))), safe(() => vDiv(ans, val(2))), safe(() => surd(p, 1, q)), safe(() => vAdd(ans, val(1)))], rng);
    }
    return build('surdMul', [ROOT(2, I(p)), TIMES, BLANK, EQ, valueToken(ans)], ev([ROOT(2, I(q))]), [
      safe(() => vSqrt(val(q + 1))), safe(() => vSqrt(val(p * q))), val(q), safe(() => vSqrt(val(Math.abs(p * q - p)))), safe(() => surd(q, 1, p)),
    ], rng, 'b');
  }
}
function rationalise(level, rng) {
  const t = pick(rng, [2, 3, 5, 6, 7]), k = rng.nextInt(1, 12);
  const tokens = [I(k), DIVIDE, ROOT(2, I(t))];
  const ans = ev(tokens);
  return build('rationalise', [...tokens, EQ, BLANK], ans, [surd(k, 1, t), safe(() => val(k, t)), safe(() => vSqrt(val(k, t))), safe(() => surd(k, t * t, t)), safe(() => surd(k * t, 1, t))], rng);
}

// ---------------------------------------------------------------- Act 7: logarithms
const LOG_BASES = [[2, 10], [3, 5], [5, 4], [10, 6]];
function logParts(rng) {
  const [b, kMax] = pick(rng, LOG_BASES);
  return { b, k: rng.nextInt(1, kMax) };
}
function logBasic(level, rng, hide) {
  const { b, k } = logParts(rng);
  if (!hide) return ask('logBasic', [LOG(b, I(b ** k))], [b * k, b ** k, k + 1, k - 1, b + k, -k], rng);
  if (rng.nextInt(0, 1)) return build('logBasic', [LOG(b, BLANK), EQ, I(k)], V(b ** k), [b * k, b ** (k + 1), b ** (k - 1) || 1, k * k, b + k], rng, 'a');
  const kk = Math.max(2, k);
  return build('logBasic', [{ t: 'log', base: [BLANK], body: [I(b ** kk)] }, EQ, I(kk)], V(b), [kk, b ** kk / b === b ? b + 1 : b + 1, b - 1, kk + 1, b * kk].filter(c => c !== b), rng, 'b');
}
function logFrac(level, rng) {
  const [b, kMax] = pick(rng, [[2, 6], [3, 4], [5, 3], [10, 4]]);
  const k = rng.nextInt(1, kMax);
  return ask('logFrac', [LOG(b, F(1, b ** k))], [k, safe(() => val(1, k)), -(b ** k), -(k + 1), -(k - 1) || 1, -b * k], rng);
}
function twoPowers(rng, b, kMax) {
  const i = rng.nextInt(1, kMax - 1), j = rng.nextInt(1, kMax - 1);
  return { i, j };
}
function logSum(level, rng) {
  const [b, kMax] = pick(rng, [[2, 7], [3, 4], [5, 3], [10, 4]]);
  const { i, j } = twoPowers(rng, b, kMax);
  return ask('logSum', [LOG(b, I(b ** i)), ADD, LOG(b, I(b ** j))], [i * j, i + j + 1, i + j - 1, b ** i + b ** j, (i + j) * b, Math.abs(i - j)], rng);
}
function logDiff(level, rng) {
  const [b, kMax] = pick(rng, [[2, 7], [3, 4], [5, 3], [10, 4]]);
  let i, j;
  do ({ i, j } = twoPowers(rng, b, kMax)); while (i <= j);
  return ask('logDiff', [LOG(b, I(b ** i)), SUBT, LOG(b, I(b ** j))], [i + j, i * j, i - j + 1, i - j - 1, b ** i - b ** j, j - i], rng);
}
function logProd(level, rng) {
  const [b, kMax] = pick(rng, [[2, 7], [3, 4], [5, 3], [10, 4]]);
  const { i, j } = twoPowers(rng, b, kMax);
  return ask('logProd', [LOG(b, I(b ** i), TIMES, I(b ** j))], [i * j, i + j + 1, i + j - 1, b ** i * b ** j, b ** i + b ** j, (i + j) * b].filter(c => c < 9999), rng);
}
function logQuot(level, rng) {
  const [b, kMax] = pick(rng, [[2, 7], [3, 4], [5, 3], [10, 4]]);
  let i, j;
  do ({ i, j } = twoPowers(rng, b, kMax)); while (i <= j);
  return ask('logQuot', [LOG(b, I(b ** i), DIVIDE, I(b ** j))], [i * j, i + j, i - j + 1, i - j - 1, b ** i - b ** j, Math.floor(i / j) || 3], rng);
}
function logPow(level, rng) {
  const [b, kMax] = pick(rng, [[2, 3], [3, 2], [5, 2], [10, 2]]);
  const base = b ** rng.nextInt(1, kMax), e = rng.nextInt(2, 4);
  const k = Math.round(Math.log(base) / Math.log(b));
  return ask('logPow', [LOG(b, POW(I(base), I(e)))], [k + e, k * e + 1, k * e - 1, e * base, k ** e, k * e * b].filter(c => c !== k * e), rng);
}

// ---------------------------------------------------------------- Compose: atoms, combos, synthesis
// An atom is one node with an exact value and `mis`, the value a typical slip gives.
const ATOMS = {
  pow(rng) {
    const form = pick(rng, ['sq', 'cube', 'two', 'frac']);
    if (form === 'frac') { const [p, q] = coprimePair(rng, 2, 5); return { tok: POW(F(p, q), I(2)), mis: val(2 * p, q) }; }
    if (form === 'cube') { const n = rng.nextInt(2, 4); return { tok: POW(I(n), I(3)), mis: val(3 * n) }; }
    if (form === 'two') { const k = rng.nextInt(2, 6); return { tok: POW(I(2), I(k)), mis: val(2 * k) }; }
    const n = rng.nextInt(2, 9); return { tok: POW(I(n), I(2)), mis: val(2 * n) };
  },
  root(rng) {
    const form = pick(rng, ['sq', 'sq', 'cube', 'frac']);
    if (form === 'cube') { const n = rng.nextInt(2, 5); return { tok: ROOT(3, I(n ** 3)), mis: val(n ** 3, 3) }; }
    if (form === 'frac') { const [p, q] = coprimePair(rng, 2, 7); return { tok: ROOT(2, F(p * p, q * q)), mis: val(p * p, q) }; }
    const n = rng.nextInt(2, 12); return { tok: ROOT(2, I(n * n)), mis: val(n * n, 2) };
  },
  frac(rng) {
    const [p, q] = coprimePair(rng, 1, 9);
    return p < q ? { tok: F(p, q), mis: val(q, p) } : { tok: F(q, p), mis: val(p, q) };
  },
  negPow(rng) {
    if (rng.nextInt(0, 1)) { const [p, q] = coprimePair(rng, 2, 4); return { tok: POW(F(p, q), I(-2)), mis: val(p * p, q * q) }; }
    const a = rng.nextInt(2, 5), n = rng.nextInt(1, 3); return { tok: POW(I(a), I(-n)), mis: val(-(a ** n)) };
  },
  fracExp(rng) {
    const root = rng.nextInt(2, 5);
    return rng.nextInt(0, 1)
      ? { tok: POW(I(root ** 3), F(1, 3)), mis: val(root ** 3, 3) }
      : { tok: POW(I(root * root), F(3, 2)), mis: val(root * root * 3, 2) };
  },
  log(rng) {
    const [b, kMax] = pick(rng, [[2, 6], [3, 4], [5, 3], [10, 3]]);
    const k = rng.nextInt(1, kMax);
    return rng.nextInt(0, 3) === 0 ? { tok: LOG(b, F(1, b ** k)), mis: val(k) } : { tok: LOG(b, I(b ** k)), mis: val(b * k) };
  },
};
for (const name of Object.keys(ATOMS)) {
  const make = ATOMS[name];
  ATOMS[name] = rng => { const a = make(rng); return { ...a, v: ev([a.tok]) }; };
}

const SET_COMBO = ['pow', 'root', 'frac'];
const SET_EXP = ['pow', 'root', 'negPow', 'fracExp', 'frac'];
const SET_LOG = ['log', 'pow', 'root', 'negPow', 'frac'];
const SET_ALL = ['pow', 'root', 'negPow', 'fracExp', 'log', 'frac'];
const OPS = { '+': vAdd, '−': vSub, '×': vMul, '÷': vDiv };

function niceResult(v) {
  return isRational(v) && v.q.d <= 36 && Math.abs(v.q.n) <= 150 && !isZero(v);
}

function compose(kind, atomSet, three, level, rng, hide) {
  for (let attempt = 0; attempt < 400; attempt++) {
    const A = ATOMS[pick(rng, atomSet)](rng), B = ATOMS[pick(rng, atomSet)](rng);
    const op1 = pick(rng, ['+', '−', '×', '÷']);
    const inner = safe(() => OPS[op1](A.v, B.v));
    if (!inner || !isRational(inner) || !niceResult(inner)) continue;
    let tokens, result, parts;
    if (!three) {
      tokens = [A.tok, OP(op1), B.tok]; result = inner; parts = [A, B];
    } else {
      const C = ATOMS[pick(rng, atomSet)](rng);
      const op2 = pick(rng, ['+', '−', '×']);
      result = safe(() => OPS[op2](inner, C.v));
      if (!result || !niceResult(result)) continue;
      tokens = [PAREN(A.tok, OP(op1), B.tok), OP(op2), C.tok]; parts = [A, B, C];
    }
    if (!hide) {
      const slips = [
        ...Object.entries(OPS).filter(([s]) => s !== op1).map(([, f]) => (three ? null : safe(() => f(A.v, B.v)))),
        three ? null : safe(() => OPS[op1](A.mis, B.v)), three ? null : safe(() => OPS[op1](A.v, B.mis)),
        three ? safe(() => OPS[tokens[1].s](inner, parts[2].mis)) : null,
        three ? safe(() => OPS[tokens[1].s](safe(() => OPS[op1](A.mis, B.v)) ?? inner, parts[2].v)) : null,
        safe(() => vAdd(result, val(1))), safe(() => vDiv(val(1), result)),
      ];
      return build(kind, [...tokens, EQ, BLANK], result, slips, rng);
    }
    const hideIndex = three ? 2 : rng.nextInt(0, 1);
    const target = parts[hideIndex];
    if (isZero(target.v)) continue;
    const shown = three ? [tokens[0], tokens[1], BLANK] : hideIndex === 0 ? [BLANK, tokens[1], tokens[2]] : [tokens[0], tokens[1], BLANK];
    const other = three ? inner : parts[1 - hideIndex].v;
    return build(kind, [...shown, EQ, valueToken(result)], target.v, [
      target.mis, other, result, safe(() => vDiv(val(1), target.v)), safe(() => vAdd(target.v, val(1))), safe(() => vSub(target.v, val(1))),
      safe(() => vAdd(result, other)), safe(() => vSub(result, other)),
    ].filter(c => c && !isZero(c)), rng, 'x');
  }
  throw new Error(`No ${kind} question found at level ${level}`);
}

export const LATE_KINDS = {
  pwSq: { draw: pwSq }, pwCube: { draw: pwCube, canHide: true }, pwTwo: { draw: pwTwo, canHide: true },
  pwNeg: { draw: pwNeg }, pwSpecial: { draw: pwSpecial }, pwExpr: { draw: pwExpr },
  rtSq: { draw: rtSq, canHide: true }, rtCube: { draw: rtCube, canHide: true }, rtPyth: { draw: rtPyth }, rtFrac: { draw: rtFrac },
  lawMul: { draw: lawMul, canHide: true }, lawDiv: { draw: lawDiv, canHide: true }, lawPow: { draw: lawPow, canHide: true },
  negExp: { draw: negExp }, negExpFrac: { draw: negExpFrac }, fracExp: { draw: fracExp },
  surdSimplify: { draw: surdSimplify }, surdCoef: { draw: surdCoef }, surdAdd: { draw: surdAdd, canHide: true },
  surdMul: { draw: surdMul, canHide: true }, rationalise: { draw: rationalise },
  logBasic: { draw: logBasic, canHide: true }, logFrac: { draw: logFrac }, logSum: { draw: logSum }, logDiff: { draw: logDiff },
  logProd: { draw: logProd }, logQuot: { draw: logQuot }, logPow: { draw: logPow },
  combo: { draw: (l, r, h) => compose('combo', SET_COMBO, false, l, r, h), canHide: true },
  comboExp: { draw: (l, r, h) => compose('comboExp', SET_EXP, false, l, r, h), canHide: true },
  comboLog: { draw: (l, r, h) => compose('comboLog', SET_LOG, false, l, r, h), canHide: true },
  synth: { draw: (l, r, h) => compose('synth', SET_ALL, false, l, r, h), canHide: true },
  synth3: { draw: (l, r, h) => compose('synth3', SET_ALL, true, l, r, h), canHide: true },
};
export { shuffle };
