import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const styles = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
const markup = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

const rule = (selector) => {
  const start = styles.indexOf(`${selector} {`);
  assert.ok(start >= 0, `${selector} rule missing`);
  return styles.slice(start, styles.indexOf('}', start));
};

// A double tap on plain text zooms the mobile visual viewport out of the game's fixed layout, and that
// second tap is also part of the three taps on the title's level number that open the speedrun card (see
// speedrun-ui.js). The app copy of index.html/styles.css is byte-identical, so one rule covers both.
test('a double tap does not zoom the document', () => {
  const html = rule('html');
  assert.match(html, /touch-action: manipulation;/);
  // `manipulation` still allows panning and pinch zoom; `none` would take those away.
  assert.doesNotMatch(html, /touch-action: none/);
});

test('the viewport meta keeps scaling off for the browsers that honour it', () => {
  assert.match(markup, /<meta name="viewport" content="[^"]*user-scalable=no/);
});
