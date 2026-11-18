// bubble-glyphs.test.js — every character of every question the fiend's speech bubble can
// show has a glyph in the canvas pixel font. A missing glyph is drawn as a space, which
// turned the Campaign II question "1/4 = ?/8" into "1 4 = ? 8" (and dropped the maths minus,
// roots, exponents and log bases).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PIXEL_FONT, pixelGlyphs, measurePixelText, LOGICAL_PX } from './renderer.js';
import { generateGameProblem2 } from './campaign2/problem.js';
import { TOTAL_LEVELS_2 } from './campaign2/campaign2-levels.js';
import { generateProblem, revealQuestion, TOTAL_LEVELS } from './levels.js';

const fullLevels = JSON.parse(readFileSync(new URL('../../app/level_data.json', import.meta.url))).levels;
const SEEDS = Array.from({ length: 40 }, (_, i) => i * 7919 + 13);

function missingGlyphs(text) {
  return pixelGlyphs(text).filter((g) => !g.known && g.ch !== ' ').map((g) => g.ch);
}

test('every Campaign II question and answer reveal is drawable', () => {
  const missing = new Map();
  for (let level = 1; level <= TOTAL_LEVELS_2; level++) {
    for (const seed of SEEDS) {
      const p = generateGameProblem2(level, seed);
      for (const text of [p.question, p.revealText]) {
        for (const ch of missingGlyphs(text)) missing.set(ch, text);
      }
    }
  }
  assert.deepEqual([...missing.entries()], [], 'characters the bubble would draw as blanks');
});

test('every Campaign I question and answer reveal is drawable, unchanged by the new glyphs', () => {
  for (let i = 0; i < TOTAL_LEVELS; i++) {
    for (const seed of SEEDS.slice(0, 10)) {
      const problem = generateProblem(i, seed, fullLevels[i]);
      for (const text of [problem.question, revealQuestion(problem)].filter((t) => typeof t === 'string')) {
        assert.deepEqual(missingGlyphs(text), [], `level ${i + 1}: "${text}"`);
        // Campaign I uses only full-size glyphs, so its bubbles keep their old width.
        assert.ok(pixelGlyphs(text).every((g) => g.mode === 'normal'), text);
        assert.equal(measurePixelText(text), text.length * 6 * LOGICAL_PX, text);
      }
    }
  }
});

test('fractions keep their bar, and powers, roots and log bases their marks', () => {
  const drawn = (text) => pixelGlyphs(text).map((g) => (g.mode === 'normal' ? g.ch : `${g.mode}:${g.ch}`)).join('|');
  assert.equal(drawn('1/4 = ?/8'), '1|/|4| |=| |?|/|8');
  assert.equal(drawn('12 − 5'), '1|2| |-| |5', 'the maths minus is the hyphen glyph');
  assert.equal(drawn('8²'), '8|sup:2');
  assert.equal(drawn('∛8'), 'sup:3|√|8');
  assert.equal(drawn('log₂ 32'), 'l|o|g|sub:2| |3|2');
  assert.equal(drawn('(2/3)⁻²'), '(|2|/|3|)|sup:-|sup:2');
  for (const ch of ['/', '(', ')', '√', '^']) {
    assert.ok(PIXEL_FONT[ch], `${ch} has a glyph`);
    assert.ok(PIXEL_FONT[ch].some((row) => row.includes('1')), `${ch} is not blank`);
  }
  // A raised exponent is narrower than a full digit, so the bubble is sized to what is drawn.
  assert.ok(measurePixelText('8²') < measurePixelText('82'));
});

test('the speech bubble is as wide as the text it draws', () => {
  const source = readFileSync(new URL('./renderer.js', import.meta.url), 'utf8');
  const bubble = source.slice(source.indexOf('drawSpeechBubble(x, y, text'), source.indexOf('this._drawBubbleChrome', source.indexOf('drawSpeechBubble(x, y, text')));
  assert.match(bubble, /measurePixelText\(text\)/);
  assert.doesNotMatch(bubble, /text\.length\s*\*/, 'counting characters undercounts nothing now, but would misfit raised digits');
});
