import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const html = await readFile(new URL('../static/index.html', import.meta.url), 'utf8');

test('tablet sizing is gated by width and height so phone landscape stays compact', () => {
  const tablet = html.split('@media (min-width: 768px) and (min-height: 600px) {')[1]
    ?.split('@media (min-width: 1200px)')[0];
  assert.ok(tablet);
  assert.match(tablet, /\.letter\s*\{[^}]*min-height: 84px;[^}]*font-size: 38px;/);
  assert.match(tablet, /\.action\s*\{[^}]*min-height: 84px;/);
  assert.match(tablet, /\.reading-card\s*\{[^}]*height: clamp\(360px, 42vh, 620px\);/);
  assert.match(tablet, /\.setup-grid\s*\{[^}]*grid-template-columns: 1fr;/);
});

test('reading text fits the card using the responsive maximum, not the previous inline font', () => {
  const source = html.match(/function updateCardFontSize\(text, minimum = 0\) \{[\s\S]*?\n        \}/)?.[0];
  assert.ok(source);
  for (const [maximum, width, textWidth, expected] of [
    [100, 400, 200, 100],
    [180, 1000, 360, 180],
    [180, 400, 900, 70.4],
    [100, 400, 900, 39.111111111111114],
  ]) {
    const card = { style: {}, parentElement: { clientWidth: width } };
    const context = {
      byId: () => card,
      document: { createElement: () => ({ getContext: () => ({ measureText: () => ({ width: textWidth }) }) }) },
      window: { getComputedStyle: () => ({
        fontWeight: '700',
        fontFamily: 'Grundschrift',
        getPropertyValue: () => `${maximum}px`,
      }) },
    };
    runInNewContext(`${source}; updateCardFontSize('example');`, context);
    assert.ok(Math.abs(parseFloat(card.style.fontSize) - expected) < 0.001);
  }
});
