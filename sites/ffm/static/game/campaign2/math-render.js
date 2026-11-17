// Turns Campaign 2 expression tokens and answer keys into HTML for the question line and
// the answer buttons: stacked fractions, mixed numbers, powers, roots, logarithms and
// radicals. Pure string building; every value is coerced to a number or comes from a fixed
// symbol set, so nothing here can inject markup. CSS: the .m2-* classes in styles.css.
//
// Tokens (see expr.js): int, frac, mixed, blank, fracBlank {d}, surdBlank {r}, surd {q, r},
// op {s}, paren {body}, pow {base, exp}, root {index, body}, log {base, body}.
import { parseVal } from './exact.js';

const SYMBOLS = new Set(['+', '−', '×', '÷', '=']);
const num = v => {
  const n = Number(v);
  if (!Number.isFinite(n)) throw new RangeError('Not a number');
  return n;
};
const signed = n => (n < 0 ? '−' : '');

function fracHtml(n, d) {
  return `<span class="m2-frac"><span class="m2-num">${num(n)}</span><span class="m2-den">${num(d)}</span></span>`;
}

const inner = tokens => tokens.map(tokenHtml).join('');

function surdHtml(q, r) {
  const coef = q.d === 1 ? (Math.abs(q.n) === 1 ? '' : `<span class="m2-int">${Math.abs(num(q.n))}</span>`)
    : fracHtml(Math.abs(num(q.n)), q.d);
  const radical = `<span class="m2-root"><span class="m2-radical">√</span><span class="m2-rad">${num(r)}</span></span>`;
  return `<span class="m2-surd">${signed(q.n)}${coef}${radical}</span>`;
}

export function tokenHtml(token) {
  switch (token.t) {
    case 'int': return `<span class="m2-int">${signed(num(token.v))}${Math.abs(num(token.v))}</span>`;
    case 'frac': return `${signed(num(token.n))}${fracHtml(Math.abs(num(token.n)), token.d)}`;
    case 'mixed': return `<span class="m2-mixed"><span class="m2-int">${num(token.w)}</span>${fracHtml(token.n, token.d)}</span>`;
    case 'fracBlank': return `<span class="m2-frac"><span class="m2-num m2-blank">?</span><span class="m2-den">${num(token.d)}</span></span>`;
    case 'surdBlank': return `<span class="m2-surd"><span class="m2-blank">?</span><span class="m2-root"><span class="m2-radical">√</span><span class="m2-rad">${num(token.r)}</span></span></span>`;
    case 'surd': return surdHtml(token.q, token.r);
    case 'blank': return '<span class="m2-blank">?</span>';
    case 'paren': return `<span class="m2-paren">(</span>${inner(token.body)}<span class="m2-paren">)</span>`;
    case 'pow': return `<span class="m2-pow"><span class="m2-base">${inner(token.base)}</span><sup class="m2-sup">${inner(token.exp)}</sup></span>`;
    case 'root': return `<span class="m2-root">${token.index === 3 ? '<sup class="m2-idx">3</sup>' : ''}<span class="m2-radical">√</span><span class="m2-rad">${inner(token.body)}</span></span>`;
    case 'log': return `<span class="m2-log">log<sub class="m2-sub">${inner(token.base)}</sub></span>${inner(token.body)}`;
    case 'op':
      if (!SYMBOLS.has(token.s)) throw new RangeError(`Unknown symbol ${token.s}`);
      return `<span class="m2-op">${token.s}</span>`;
    default: throw new RangeError(`Unknown token ${token.t}`);
  }
}

export const expressionHtml = tokens => `<span class="m2-expr">${inner(tokens)}</span>`;

/** Plain text of the tokens, for aria-labels and the reveal line ("1/3 + 1/4 = ?"). */
export function expressionText(tokens) {
  return tokens.map(tokenText).join(' ').replace(/ ?\^ ?/g, '^').replace(/\( /g, '(').replace(/ \)/g, ')');
}

function tokenText(t) {
  switch (t.t) {
    case 'int': return String(t.v);
    case 'frac': return `${t.n}/${t.d}`;
    case 'mixed': return `${t.w} ${t.n}/${t.d}`;
    case 'blank': return '?';
    case 'fracBlank': return `?/${t.d}`;
    case 'surdBlank': return `?√${t.r}`;
    case 'surd': return `${t.q.n === 1 ? '' : t.q.n}√${t.r}${t.q.d === 1 ? '' : `/${t.q.d}`}`;
    case 'paren': return `(${expressionText(t.body)})`;
    case 'pow': {
      const e = expressionText(t.exp);
      return `${expressionText(t.base)}^${/^-?\d+$/.test(e) ? e : `(${e})`}`;
    }
    case 'root': return `${t.index === 3 ? '∛' : '√'}(${expressionText(t.body)})`;
    case 'log': return `log_${expressionText(t.base)}(${expressionText(t.body)})`;
    default: return t.s;
  }
}

/** An answer key ("7/12", "-3", "6√2", "√2/2") as HTML. */
export function answerHtml(answerKey) {
  const v = parseVal(answerKey);
  if (v.r !== 1) return `<span class="m2-expr">${surdHtml(v.q, v.r)}</span>`;
  return `<span class="m2-expr">${tokenHtml(v.q.d === 1 ? { t: 'int', v: v.q.n } : { t: 'frac', n: v.q.n, d: v.q.d })}</span>`;
}

const SUP = { 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹', '-': '⁻' };
const SUB = { 0: '₀', 1: '₁', 2: '₂', 3: '₃', 4: '₄', 5: '₅', 6: '₆', 7: '₇', 8: '₈', 9: '₉' };
const mapDigits = (text, table) => [...String(text)].map(c => table[c] ?? c).join('');

/**
 * One-line text for places that cannot lay out stacked maths (the canvas speech bubble, the
 * answer reveal): exponents as superscripts, log bases as subscripts, "3/4" for fractions.
 */
export function expressionUnicode(tokens) {
  return tokens.map(unicodeToken).join(' ').replace(/\( /g, '(').replace(/ \)/g, ')').replace(/ ⁻?[⁰¹²³⁴⁵⁶⁷⁸⁹]+/g, m => m.trimStart());
}

function unicodeToken(t) {
  switch (t.t) {
    case 'pow': {
      const e = expressionText(t.exp);
      return `${expressionUnicode(t.base)}${/^-?\d+$/.test(e) ? mapDigits(e, SUP) : `^(${e})`}`;
    }
    case 'root': return `${t.index === 3 ? '∛' : '√'}${t.body.length === 1 && t.body[0].t === 'int' ? expressionUnicode(t.body) : `(${expressionUnicode(t.body)})`}`;
    case 'log': return `log${mapDigits(expressionText(t.base), SUB)} ${t.body.length === 1 ? expressionUnicode(t.body) : `(${expressionUnicode(t.body)})`}`;
    case 'paren': return `(${expressionUnicode(t.body)})`;
    default: return tokenText(t);
  }
}
