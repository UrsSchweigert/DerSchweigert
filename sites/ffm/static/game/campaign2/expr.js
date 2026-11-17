// Token builders and an exact evaluator for Campaign 2 expressions. A question is a flat
// token list with at most one '='; nodes may nest (powers, roots, logs, parentheses).
// The evaluator is the single source of truth: generators compute answers with it and the
// tests substitute every option into the blank to prove exactly one of them holds.
import { frac } from './fractions.js';
import {
  val, mk, vAdd, vSub, vMul, vDiv, vPow, vRoot, vLog, vEquals, parseVal,
} from './exact.js';

export const I = v => ({ t: 'int', v });
export const F = (n, d) => ({ t: 'frac', n, d });
export const OP = s => ({ t: 'op', s });
export const EQ = OP('=');
export const BLANK = { t: 'blank' };
export const PAREN = (...body) => ({ t: 'paren', body });
export const ROOT = (index, ...body) => ({ t: 'root', index, body });
export const LOG = (base, ...body) => ({ t: 'log', base: [I(base)], body });
export const SURD = (n, d, r) => ({ t: 'surd', q: { n, d }, r });
/** A power node. A negative or fractional base gets parentheses, so (−3)² never reads −3². */
export function POW(base, exp) {
  const b = Array.isArray(base) ? base : [base];
  const needsParen = b.length === 1 && ((b[0].t === 'int' && b[0].v < 0) || b[0].t === 'frac' || b[0].t === 'mixed');
  return { t: 'pow', base: needsParen || b.length > 1 ? [PAREN(...b)] : b, exp: Array.isArray(exp) ? exp : [exp] };
}
/** A value as a token: integer, fraction or radical. */
export function valueToken(v) {
  if (v.r === 1) return v.q.d === 1 ? I(v.q.n) : F(v.q.n, v.q.d);
  return SURD(v.q.n, v.q.d, v.r);
}

function nodeValue(t, blank) {
  switch (t.t) {
    case 'int': return val(t.v);
    case 'frac': return val(t.n, t.d);
    case 'mixed': return vAdd(val(t.w), val(t.n, t.d));
    case 'blank': if (!blank) throw new RangeError('No answer given'); return blank;
    case 'fracBlank': return vDiv(blank, val(t.d));
    case 'surdBlank': return vMul(blank, mk(frac(1), t.r));
    case 'surd': return mk(frac(t.q.n, t.q.d), t.r);
    case 'paren': return evalTokens(t.body, blank);
    case 'pow': return vPow(evalTokens(t.base, blank), evalTokens(t.exp, blank));
    case 'root': return vRoot(evalTokens(t.body, blank), t.index);
    case 'log': return vLog(evalTokens(t.base, blank), evalTokens(t.body, blank));
    default: throw new RangeError(`Cannot evaluate ${t.t}`);
  }
}

/** Value of a token list without '=': + − × ÷ with the usual precedence. */
export function evalTokens(tokens, blank = null) {
  let i = 0;
  const opAt = () => (tokens[i]?.t === 'op' ? tokens[i].s : null);
  const atom = () => {
    const t = tokens[i++];
    if (!t || t.t === 'op') throw new RangeError('Malformed expression');
    return nodeValue(t, blank);
  };
  const term = () => {
    let v = atom();
    for (let s = opAt(); s === '×' || s === '÷'; s = opAt()) { i++; const w = atom(); v = s === '×' ? vMul(v, w) : vDiv(v, w); }
    return v;
  };
  let v = term();
  for (let s = opAt(); s === '+' || s === '−'; s = opAt()) { i++; const w = term(); v = s === '+' ? vAdd(v, w) : vSub(v, w); }
  if (i !== tokens.length) throw new RangeError('Malformed expression');
  return v;
}

/** True when putting the answer key into the blank makes the equation exactly true. */
export function equationHolds(tokens, answerKey) {
  try {
    const answer = parseVal(answerKey);
    const eq = tokens.findIndex(t => t.t === 'op' && t.s === '=');
    if (eq < 0) throw new RangeError('No equation');
    return vEquals(evalTokens(tokens.slice(0, eq), answer), evalTokens(tokens.slice(eq + 1), answer));
  } catch {
    return false;
  }
}

export { vSub };
