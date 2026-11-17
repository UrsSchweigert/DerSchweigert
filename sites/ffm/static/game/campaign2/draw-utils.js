// Shared helpers for the Campaign 2 question kinds.
import { frac } from './fractions.js';
import { val, mk, vEquals, valKey } from './exact.js';

export function shuffle(values, rng) {
  for (let i = values.length - 1; i > 0; i--) {
    const j = rng.nextInt(0, i);
    [values[i], values[j]] = [values[j], values[i]];
  }
  return values;
}

/** Run fn; null when the maths leaves the supported set (a bad candidate, not an error). */
export const safe = fn => { try { return fn(); } catch { return null; } };
export const pick = (rng, list) => list[rng.nextInt(0, list.length - 1)];
export const V = (n, d = 1) => val(n, d);

export const OPTION_COUNT = 4;

function neighbours(a, k) {
  if (a.r !== 1) return [mk(frac(a.q.n + k, a.q.d), a.r), mk(frac(a.q.n - k, a.q.d), a.r)];
  if (a.q.d === 1) return [val(a.q.n + k), val(a.q.n - k)];
  return [val(a.q.n + k, a.q.d), val(a.q.n, a.q.d + k), val(a.q.n - k, a.q.d)];
}

const plausible = v => Math.abs(v.q.n) <= 999999 && v.q.d <= 999 && v.r <= 999;

/**
 * Three wrong answers for `answer`: slip candidates first (numbers or exact values, null
 * ignored), then close neighbours. Every one has a different value from the answer and
 * from each other, so there is exactly one correct button.
 */
export function pickDistractors(answer, candidates, rng, count = OPTION_COUNT - 1) {
  const seen = new Set([valKey(answer)]);
  const out = [];
  const take = c => {
    const v = typeof c === 'number' ? safe(() => val(c)) : c;
    if (!v || !plausible(v) || seen.has(valKey(v))) return;
    seen.add(valKey(v));
    out.push(v);
  };
  shuffle(candidates.filter(c => c !== null && c !== undefined), rng).forEach(take);
  for (let k = 1; out.length < count && k < 40; k++) shuffle(neighbours(answer, k).filter(Boolean), rng).forEach(take);
  if (out.length < count) throw new Error(`Could not find ${count} distractors for ${valKey(answer)}`);
  return out.slice(0, count).map(valKey);
}

export { vEquals };
