// Exact values for Campaign 2: a rational times the square root of a squarefree integer,
// { q: {n, d}, r }  (r = 1 for plain rationals). That is closed under everything the
// campaign asks: fractions, integer / fractional / negative powers, roots, logarithms with
// exact results, and radicals (6√2, √2/2). Anything that would leave the set throws, so a
// generator can simply try and retry. Pure logic.
import { frac, mul as fmul, div as fdiv, add as fadd, equals as feq } from './fractions.js';

const LIMIT = 1e9;
const check = q => {
  if (Math.abs(q.n) > LIMIT || q.d > LIMIT) throw new RangeError('Value too large');
  return q;
};

/** Normalised value: squares pulled out of the radicand, zero has r = 1. */
export function mk(q, r = 1) {
  if (q.n === 0) return { q, r: 1 };
  let s = 1, t = r;
  for (let p = 2; p * p <= t; p++) while (t % (p * p) === 0) { t /= p * p; s *= p; }
  return { q: check(fmul(q, frac(s))), r: t };
}
export const val = (n, d = 1) => mk(frac(n, d));
export const surd = (n, d, r) => mk(frac(n, d), r);
export const isRational = v => v.r === 1;
export const isZero = v => v.q.n === 0;
export const vEquals = (a, b) => a.r === b.r && feq(a.q, b.q);

export function vAdd(a, b) {
  if (isZero(a)) return b;
  if (isZero(b)) return a;
  if (a.r !== b.r) throw new RangeError('Unlike radicals');
  return mk(fadd(a.q, b.q), a.r);
}
export const vNeg = a => ({ q: frac(-a.q.n, a.q.d), r: a.r });
export const vSub = (a, b) => vAdd(a, vNeg(b));
export const vMul = (a, b) => mk(fmul(a.q, b.q), a.r * b.r);
export function vDiv(a, b) {
  if (isZero(b)) throw new RangeError('Division by zero');
  // a / (q√r) = a · √r / (q·r)
  return vMul(a, mk(frac(b.q.d, b.q.n * b.r), b.r));
}

function intRoot(n, k) {
  const r = Math.round(n ** (1 / k));
  for (const c of [r - 1, r, r + 1]) if (c >= 0 && c ** k === n) return c;
  return null;
}

function ratRoot(q, k) {
  if (q.n < 0 && k % 2 === 0) throw new RangeError('Even root of a negative');
  const n = intRoot(Math.abs(q.n), k);
  const d = intRoot(q.d, k);
  if (n === null || d === null) throw new RangeError('Not an exact root');
  return frac(q.n < 0 ? -n : n, d);
}

export function vSqrt(a) {
  if (a.r !== 1 || a.q.n < 0) throw new RangeError('Cannot take this square root');
  return mk(frac(1, a.q.d), a.q.n * a.q.d);   // √(n/d) = √(n·d) / d
}

export function vRoot(a, k) {
  if (k === 2) return vSqrt(a);
  if (a.r !== 1) throw new RangeError('Cannot take this root');
  return mk(ratRoot(a.q, k));
}

/** a to the power e, where e is a rational value (integer or p/q); must come out exact. */
export function vPow(a, e) {
  if (e.r !== 1) throw new RangeError('Irrational exponent');
  const { n: p, d: q } = e.q;
  if (Math.abs(p) > 64) throw new RangeError('Exponent too large');
  if (isZero(a) && p <= 0) throw new RangeError('Undefined power of zero');
  let base;
  if (a.r !== 1) {
    if (q !== 1) throw new RangeError('Fractional power of a radical');
    base = a;
  } else {
    base = mk(q === 1 ? a.q : ratRoot(a.q, q));
  }
  let out = val(1);
  for (let i = 0; i < Math.abs(p); i++) out = vMul(out, base);
  return p < 0 ? vDiv(val(1), out) : out;
}

/** log base b (integer >= 2) of x (positive rational), if the result is a small exact fraction. */
export function vLog(b, x) {
  if (!isRational(b) || b.q.d !== 1 || b.q.n < 2) throw new RangeError('Invalid logarithm base');
  if (!isRational(x) || x.q.n <= 0) throw new RangeError('Invalid logarithm argument');
  if (x.q.n === 1 && x.q.d === 1) return val(0);
  for (let q = 1; q <= 3; q++) {
    for (let p = -12; p <= 12; p++) {
      if (p === 0) continue;
      try {
        const left = vPow(b, val(p));
        const right = vPow(x, val(q));
        if (vEquals(left, right)) return val(p, q);
      } catch { /* out of range for this p: keep searching */ }
    }
  }
  throw new RangeError('Not an exact logarithm');
}

/** Answer key: "7/12", "-3", "6√2", "√2/2", "-3√5/2". Equal values always give equal keys. */
export function valKey(v) {
  const { n, d } = v.q;
  if (v.r === 1) return d === 1 ? String(n) : `${n}/${d}`;
  const an = Math.abs(n);
  return `${n < 0 ? '-' : ''}${an === 1 ? '' : an}√${v.r}${d === 1 ? '' : `/${d}`}`;
}

export function parseVal(text) {
  const s = String(text);
  let m = /^(-?\d+)(?:\/(\d+))?$/.exec(s);
  if (m) return val(Number(m[1]), m[2] === undefined ? 1 : Number(m[2]));
  m = /^(-?)(\d*)√(\d+)(?:\/(\d+))?$/.exec(s);
  if (m) return surd((m[1] ? -1 : 1) * (m[2] === '' ? 1 : Number(m[2])), m[4] === undefined ? 1 : Number(m[4]), Number(m[3]));
  throw new RangeError(`Invalid answer key "${text}"`);
}
