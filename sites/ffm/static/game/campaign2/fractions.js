// Exact rational arithmetic for Campaign 2 (Arithmoslayer II). A fraction is a plain
// { n, d } with d > 0 and gcd(n, d) = 1, so equal values are always equal objects and
// the answer key "n/d" (or "n" when d = 1) is canonical. Pure logic: no DOM, no imports.

export function gcd(a, b) {
  a = Math.abs(a); b = Math.abs(b);
  while (b) [a, b] = [b, a % b];
  return a;
}

export function lcm(a, b) {
  return (a / gcd(a, b)) * b;
}

/** Lowest terms with a positive denominator. */
export function frac(n, d = 1) {
  if (!Number.isInteger(n) || !Number.isInteger(d) || d === 0) {
    throw new RangeError(`Invalid fraction ${n}/${d}`);
  }
  const g = gcd(n, d) || 1;
  const sign = d < 0 ? -1 : 1;
  return { n: (sign * n) / g, d: (sign * d) / g };
}

export const add = (x, y) => frac(x.n * y.d + y.n * x.d, x.d * y.d);
export const sub = (x, y) => frac(x.n * y.d - y.n * x.d, x.d * y.d);
export const mul = (x, y) => frac(x.n * y.n, x.d * y.d);
export function div(x, y) {
  if (y.n === 0) throw new RangeError('Division by zero');
  return frac(x.n * y.d, x.d * y.n);
}
export const equals = (x, y) => x.n === y.n && x.d === y.d;
export const compare = (x, y) => x.n * y.d - y.n * x.d;

/** The answer key: "7/12", "-3/4" or "5". */
export const key = x => (x.d === 1 ? String(x.n) : `${x.n}/${x.d}`);

export function parseKey(text) {
  const m = /^(-?\d+)(?:\/(\d+))?$/.exec(String(text));
  if (!m) throw new RangeError(`Invalid answer key "${text}"`);
  return frac(Number(m[1]), m[2] === undefined ? 1 : Number(m[2]));
}
