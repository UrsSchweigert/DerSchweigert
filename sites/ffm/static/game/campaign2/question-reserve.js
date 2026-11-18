// The height the HUD's question row reserves for a whole Campaign II level.
//
// A Campaign II question is stacked maths (math-render.js): a fraction, a power with a
// fractional exponent or a root over a fraction stands taller than the row's one 28px text
// line. The row used to take each question's own height, so the header grew on a fraction and
// shrank back on "2^6 = ?" or on the plain-text correction, and viewport-layout.js re-laid
// the scene out every time. Instead the row is given the height of the tallest question the
// level can ask, once, when the level starts.
//
// The generator is random (seeded with Date.now()), so "the level's questions" is not a list.
// What decides a question's height is the shape of its top-level tokens, not its digits: the
// row lays the tokens out side by side and centres them (styles.css), so the row is as tall
// as its tallest token, and every digit is the same height in the monospace header font.
// levelQuestionForms() therefore draws the level from a fixed set of seeds (every boss-round
// variant too) and keeps one representative per token shape. A level has 2-32 shapes; the
// test in question-reserve.test.js checks that tens of thousands of other seeds (the range
// Date.now() actually produces) bring no shape the sample missed. The browser then measures
// the representatives with the real header font (measureQuestionForms) and the row reserves
// the tallest. If a question ever were taller anyway, gameplay-chrome.js raises the reserve
// to it and keeps it there for the rest of the level: the row may grow once, never shrink.
import { generateGameProblem2 } from './problem.js';
import { bossRoundKinds2, isBossRoundLevel2, TOTAL_LEVELS_2 } from './campaign2-levels.js';
import { tokenHtml, expressionHtml } from './math-render.js';

/** The row's one text line (styles.css #active-question: 22px/28px). */
export const COMPACT_ROW_PX = 28;
/** Seeds drawn per question variant: 3000 cover every shape in about 20-60ms per level. */
export const RESERVE_SAMPLES = 3000;

// Spread the seeds over the 32-bit range lcg() reads (levels.js), not 1, 2, 3...
const sampleSeed = i => Math.imul(i + 1, 2654435761) >>> 0;

/** A token's height class: its markup without the text, digits and plain inline pieces. */
export function tokenShape(token) {
  return tokenHtml(token)
    .replace(/(^|>)[^<]*/g, '$1')
    .replace(/<span class="m2-(?:op|int|paren|blank)"><\/span>/g, '');
}

/** The question variants a level can ask: the ordinary draw and, on a boss level, each boss step. */
function variants(level) {
  return isBossRoundLevel2(level) ? [{}, ...bossRoundKinds2(level)] : [{}];
}

const formsCache = new Map();

/**
 * One representative per height class of a level: `math` is header markup (one token per
 * entry, wrapped like a question), `text` the plain one-line corrections the row shows after
 * a miss (revealText), one per distinct set of characters.
 *
 * @param {number} level - Campaign II level, 1..40.
 * @param {{samples?: number}} [options]
 * @returns {{level: number, math: string[], text: string[], shapes: string[]}}
 */
export function levelQuestionForms(level, { samples = RESERVE_SAMPLES } = {}) {
  if (!Number.isInteger(level) || level < 1 || level > TOTAL_LEVELS_2) {
    throw new RangeError(`Level must be between 1 and ${TOTAL_LEVELS_2}`);
  }
  const cacheKey = `${level}:${samples}`;
  if (formsCache.has(cacheKey)) return formsCache.get(cacheKey);
  const math = new Map();
  const text = new Map();
  for (const options of variants(level)) {
    for (let i = 0; i < samples; i++) {
      const problem = generateGameProblem2(level, sampleSeed(i), options);
      for (const token of problem.math) {
        const shape = tokenShape(token);
        if (!math.has(shape)) math.set(shape, expressionHtml([token]));
      }
      const chars = [...new Set(problem.revealText.replace(/\d/g, ''))].sort().join('');
      if (!text.has(chars)) text.set(chars, problem.revealText);
    }
  }
  const forms = Object.freeze({
    level, math: [...math.values()], text: [...text.values()], shapes: [...math.keys()],
  });
  formsCache.set(cacheKey, forms);
  return forms;
}

/**
 * The row height a level reserves: the tallest of its measured forms, never below the
 * compact line. `measure(form)` returns a form's height in CSS pixels.
 *
 * @param {{math: string[], text: string[]}} forms
 * @param {(form: {html?: string, text?: string}) => number} measure
 */
export function reservedRowHeight(forms, measure) {
  let tallest = COMPACT_ROW_PX;
  for (const html of forms.math) tallest = Math.max(tallest, Number(measure({ html })) || 0);
  for (const text of forms.text) tallest = Math.max(tallest, Number(measure({ text })) || 0);
  return Math.ceil(tallest);
}

/**
 * Measure forms in the document with the row's real font and width: an invisible copy of
 * the row, laid out like a reserved math row (flex, centred, one line) but free to take its
 * content's height. Returns the measure() function and a cleanup.
 *
 * @param {Document} doc
 * @param {HTMLElement} row - #active-question.
 */
export function createRowProbe(doc, row) {
  const win = doc?.defaultView;
  if (!doc?.body || !row || !win?.getComputedStyle) return null;
  const css = win.getComputedStyle(row);
  const probe = doc.createElement('div');
  probe.setAttribute('aria-hidden', 'true');
  const width = row.clientWidth;
  Object.assign(probe.style, {
    position: 'absolute', left: '-10000px', top: '0', visibility: 'hidden', pointerEvents: 'none',
    display: 'flex', alignItems: 'center', whiteSpace: 'nowrap', overflow: 'visible',
    fontFamily: css.fontFamily, fontSize: css.fontSize, fontWeight: css.fontWeight,
    fontStyle: css.fontStyle, lineHeight: css.lineHeight, letterSpacing: css.letterSpacing,
    width: width > 0 ? `${width}px` : 'auto', minHeight: '0', height: 'auto', padding: '0', border: '0',
  });
  doc.body.appendChild(probe);
  return {
    measure({ html, text }) {
      if (html !== undefined) probe.innerHTML = html;
      else probe.textContent = text ?? '';
      return probe.getBoundingClientRect().height;
    },
    remove() { probe.remove(); },
  };
}

/**
 * The reserved height of a level in this document, or COMPACT_ROW_PX where nothing can be
 * measured (no layout, as in the node tests of gameplay-chrome.js).
 */
export function measureLevelReserve(doc, row, level) {
  const probe = createRowProbe(doc, row);
  if (!probe) return COMPACT_ROW_PX;
  try {
    return reservedRowHeight(levelQuestionForms(level), probe.measure);
  } finally {
    probe.remove();
  }
}
