import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// renderer.js touches Image only inside the Renderer constructor, so importing
// it for the font table is safe in Node.
const { PIXEL_FONT } = await import('./renderer.js');
const { t, setLocale, _resetForTests } = await import('./i18n.js');

// The HUD label, the shapes reveal bubble and the question bubble all render
// through Renderer#_text, which silently falls back to a blank glyph for any
// character missing from PIXEL_FONT. A missing letter therefore reads as a
// missing letter on screen ("Formen" was drawn as " ormen" because 'F' had no
// glyph), so the whole printable alphabet has to be there.
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const DIGITS = '0123456789';
const OPERATORS = '+-×÷?=.';

const glyphFor = (char) => PIXEL_FONT[char.toUpperCase()] ?? PIXEL_FONT[char];

describe('the canvas pixel font', () => {
  it('covers the whole alphabet, the digits and the operators the game draws', () => {
    const missing = [...ALPHABET, ...DIGITS, ...OPERATORS].filter((char) => !glyphFor(char));
    assert.deepEqual(missing, [], `no glyph for: ${missing.join(' ')}`);
  });

  it('keeps every glyph a 7x5 bitmap of 0/1 rows', () => {
    for (const [char, glyph] of Object.entries(PIXEL_FONT)) {
      assert.equal(glyph.length, 7, `${char} must have 7 rows`);
      for (const row of glyph) {
        assert.match(row, /^[01]{5}$/, `${char} has a malformed row: ${row}`);
      }
    }
  });

  it('draws every HUD label and shapes reveal sentence in both locales', () => {
    for (const locale of ['en', 'de']) {
      setLocale(locale, { persist: false });
      const canvasStrings = [
        t('hud.shapes'),
        t('hud.level', { level: 60 }),
        t('feedback.shapesAnswer', { count: 10 }),
      ];
      for (const text of canvasStrings) {
        const missing = [...text].filter((char) => !glyphFor(char));
        assert.deepEqual(missing, [], `${locale}: "${text}" has no glyph for ${missing.join(' ')}`);
      }
      assert.equal(t('hud.shapes'), locale === 'de' ? 'Formen' : 'Shapes');
    }
    _resetForTests();
  });
});
