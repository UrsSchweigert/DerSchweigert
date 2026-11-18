// The Campaign II question row reserves one height per level (question-reserve.js), so the HUD
// header keeps its height from the first question to the last. Every level's questions are
// generated here, like bubble-glyphs.test.js does for the speech bubble.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  COMPACT_ROW_PX, levelQuestionForms, reservedRowHeight, tokenShape,
} from './question-reserve.js';
import { generateGameProblem2 } from './problem.js';
import { bossRoundKinds2, isBossRoundLevel2, TOTAL_LEVELS_2 } from './campaign2-levels.js';
import { expressionHtml } from './math-render.js';
import { F, I, POW, OP, EQ, BLANK, ROOT } from './expr.js';

const LEVELS = Array.from({ length: TOTAL_LEVELS_2 }, (_, i) => i + 1);
const variants = level => (isBossRoundLevel2(level) ? [{}, ...bossRoundKinds2(level)] : [{}]);
// The game seeds every question with Date.now(): sample that range, not the reserve's seeds.
const PLAY_SEEDS = Array.from({ length: 2000 }, (_, i) => 1_763_000_000_000 + i * 104_729);

// A stand-in for the browser's layout (node has none): the height a token tree takes in the
// 22px/28px header, from the same rules styles.css gives the .m2-* classes. Stacked
// fractions add their two lines at 0.8em, a superscript raises a 0.62em line above its base,
// a subscript drops one below, a radical adds its bar. It only has to grow with the
// structure the way the real layout does; the real heights are measured in the browser.
function parse(html) {
  const root = { cls: 'root', children: [] };
  const stack = [root];
  for (const [, close, cls, text] of html.matchAll(/<(\/)?(?:span|sup|sub)(?: class="([^"]*)")?>|([^<]+)/g)) {
    if (text !== undefined) stack.at(-1).children.push({ cls: 'text', children: [] });
    else if (close) stack.pop();
    else {
      const node = { cls, children: [] };
      stack.at(-1).children.push(node);
      stack.push(node);
    }
  }
  return root;
}
function modelHeight(node, font = 22) {
  const line = font * (28 / 22);
  const kids = node.children;
  const tallest = f => Math.max(line, ...kids.map(k => modelHeight(k, f)));
  switch (node.cls) {
    case 'text': return line;
    case 'm2-frac': {
      const f = font * 0.8;
      return kids.reduce((sum, k) => sum + Math.max(f * 1.05, modelHeight(k, f)), 0) + f * 0.25;
    }
    case 'm2-sup': return modelHeight({ cls: 'root', children: kids }, font * 0.62) + font * 0.15;
    case 'm2-sub': return modelHeight({ cls: 'root', children: kids }, font * 0.62) + font * 0.35;
    case 'm2-pow': {
      const [base, sup] = kids;
      return Math.max(modelHeight(base, font), line * 0.5 + modelHeight(sup, font) * 0.8);
    }
    case 'm2-rad': return tallest(font) + font * 0.13;
    default: return tallest(font);
  }
}
const measure = ({ html, text }) => (html === undefined ? (text ? COMPACT_ROW_PX : 0) : modelHeight(parse(html)));

test('the reserve sample holds every token shape the game can draw in each level', () => {
  for (const level of LEVELS) {
    const shapes = new Set(levelQuestionForms(level).shapes);
    for (const options of variants(level)) {
      for (const seed of PLAY_SEEDS) {
        for (const token of generateGameProblem2(level, seed, options).math) {
          const shape = tokenShape(token);
          assert.ok(shapes.has(shape), `level ${level}: ${shape} is missing from the sample`);
        }
      }
    }
  }
});

test('each level reserves at least the height of every question and correction it asks', () => {
  for (const level of LEVELS) {
    const reserve = reservedRowHeight(levelQuestionForms(level), measure);
    for (const options of variants(level)) {
      for (const seed of PLAY_SEEDS.slice(0, 500)) {
        const p = generateGameProblem2(level, seed, options);
        const tall = measure({ html: expressionHtml(p.math) });
        assert.ok(reserve >= tall, `level ${level}: "${p.question}" is ${tall}px, the row ${reserve}px`);
        assert.ok(reserve >= measure({ text: p.revealText }), `level ${level}: reveal "${p.revealText}"`);
      }
    }
  }
});

test('a level reserves one height, whatever order its questions come in', () => {
  for (const level of [1, 14, 24, 38, 40]) {
    const forms = levelQuestionForms(level);
    const reserve = reservedRowHeight(forms, measure);
    const reversed = { math: [...forms.math].reverse(), text: [...forms.text].reverse() };
    assert.equal(reservedRowHeight(reversed, measure), reserve);
    assert.equal(levelQuestionForms(level), forms, 'the forms are generated once per level');
    assert.ok(Number.isInteger(reserve));
  }
});

test('stacked maths reserves more than the line, flat maths keeps the compact 28px', () => {
  const flat = { math: [expressionHtml([I(3), OP('+'), I(4), EQ, BLANK])], text: ['3 + 4 = 7'] };
  assert.equal(reservedRowHeight(flat, measure), COMPACT_ROW_PX);
  assert.equal(reservedRowHeight({ math: [], text: [] }, measure), COMPACT_ROW_PX);
  const fraction = { math: [expressionHtml([F(1, 3), OP('+'), F(1, 4), EQ, BLANK])], text: [] };
  assert.ok(reservedRowHeight(fraction, measure) > COMPACT_ROW_PX);
  // A measured height is rounded up, so the content always fits the row it is given.
  assert.equal(reservedRowHeight({ math: ['x'], text: [] }, () => 40.2), 41);
});

test('a token shape ignores digits and signs but not structure', () => {
  assert.equal(tokenShape(F(1, 3)), tokenShape(F(-12, 37)));
  assert.equal(tokenShape(I(5)), tokenShape(I(-120)));
  assert.notEqual(tokenShape(F(1, 3)), tokenShape(I(5)));
  assert.notEqual(tokenShape(POW(I(2), I(3))), tokenShape(POW(I(8), F(2, 3))));
  assert.notEqual(tokenShape(POW(I(2), I(3))), tokenShape(POW(F(2, 3), I(-2))));
  assert.notEqual(tokenShape(ROOT(2, I(9))), tokenShape(ROOT(2, F(4, 9))));
});

test('every level has a sample to measure, and nothing outside 1..40', () => {
  for (const level of LEVELS) {
    const forms = levelQuestionForms(level);
    assert.ok(forms.math.length > 0 && forms.text.length > 0, `level ${level}`);
  }
  assert.throws(() => levelQuestionForms(0), RangeError);
  assert.throws(() => levelQuestionForms(41), RangeError);
});
