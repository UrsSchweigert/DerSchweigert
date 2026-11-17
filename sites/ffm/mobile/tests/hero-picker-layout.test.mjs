// hero-picker-layout.test.mjs — the hero picker dialog starts below the title bar.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// The numerals start at inset + 8px and are one title bar tall; the picker starts
// one 8px gap below that. Mirrors the rules in game/mobile-ui.css.
function titleBarHeight({ width, height }) {
  const shortLandscape = width > height && height <= 460;
  return width <= 600 || shortLandscape ? 44 : 84;
}
const numeralsBottom = (viewport, inset) => inset + 8 + titleBarHeight(viewport);
const pickerTop = (viewport, inset) => numeralsBottom(viewport, inset) + 8;

test('the picker top sits below the title bar with the safe-area and viewport offsets', async () => {
  const css = await readFile(join(root, 'game', 'mobile-ui.css'), 'utf8');
  const rule = css.match(/\.overlay\.hero-picker-overlay\s*\{[^}]*\}/)[0];

  assert.match(rule, /--hero-picker-shift:\s*calc\(var\(--safe-area-top,\s*env\(safe-area-inset-top,\s*0px\)\)\s*\+\s*8px\s*\+\s*var\(--hero-title-bar-height\)\s*\+\s*8px\)/);
  assert.match(rule, /--hero-picker-top:\s*calc\(var\(--viewport-top,\s*0px\)\s*\+\s*var\(--hero-picker-shift\)\)/);
  assert.match(rule, /top:\s*var\(--hero-picker-top\)/);
  assert.match(rule, /height:\s*calc\(var\(--overlay-height\)\s*-\s*var\(--hero-picker-shift\)\)/);
  assert.match(rule, /padding-top:\s*0/);
  assert.doesNotMatch(rule, /z-index/);
});

test('the title bar is 44px on narrow and short landscape screens and 84px otherwise', async () => {
  const css = await readFile(join(root, 'game', 'mobile-ui.css'), 'utf8');

  assert.match(css, /\.overlay\.hero-picker-overlay\s*\{[^}]*--hero-title-bar-height:\s*84px/);
  assert.match(css, /@media \(max-width: 600px\), \(orientation: landscape\) and \(max-height: 460px\)\s*\{\s*\.overlay\.hero-picker-overlay\s*\{\s*--hero-title-bar-height:\s*44px/);
});

test('the blurred backdrop starts at the picker edge and does not reach the title bar', async () => {
  const css = await readFile(join(root, 'game', 'mobile-ui.css'), 'utf8');
  const rule = css.match(/\.overlay:not\(\.splash-screen\)\.hero-picker-overlay::before\s*\{[^}]*\}/)[0];

  assert.match(rule, /top:\s*0\s*;/);
});

test('the dialog card stays inside the reduced box and scrolls, with 44px hero buttons', async () => {
  const css = await readFile(join(root, 'game', 'mobile-ui.css'), 'utf8');

  assert.match(css, /\.hero-picker-overlay \.hero-picker-card\s*\{\s*max-height:\s*100%;\s*overflow-y:\s*auto;\s*\}/);
  assert.match(css, /\.hero-picker-overlay \.hero-picker-item,\s*\.hero-picker-overlay \.hero-picker-close\s*\{\s*min-width:\s*44px;\s*min-height:\s*44px;\s*\}/);
});

test('the hero picker rules leave the top bar and the plain overlay alone', async () => {
  const css = await readFile(join(root, 'game', 'mobile-ui.css'), 'utf8');
  const pickerRules = css.slice(css.indexOf('/* The hero picker is a dialog below the title bar'),
    css.indexOf('.hero-picker-overlay .hero-picker-card'));

  assert.doesNotMatch(pickerRules, /#top-bar/);
  assert.doesNotMatch(css, /#top-bar\s*\{[^}]*z-index/);
  assert.doesNotMatch(css, /(^|\n)\.overlay\s*\{[^}]*(top|height):/);
});

test('the picker top is below the numerals bottom at the pinned viewports and insets', () => {
  for (const viewport of [
    { name: '390x844 portrait', width: 390, height: 844 },
    { name: '844x390 notched landscape', width: 844, height: 390 },
    { name: '1024x768 wide', width: 1024, height: 768 },
  ]) {
    for (const inset of [0, 59]) {
      const name = `${viewport.name}, inset ${inset}`;
      const bottom = numeralsBottom(viewport, inset);
      assert.ok(pickerTop(viewport, inset) > bottom, `${name}: picker top must be below the numerals`);
      assert.ok(pickerTop(viewport, inset) - bottom >= 8, `${name}: the gap is at least 8px`);
    }
  }
});
