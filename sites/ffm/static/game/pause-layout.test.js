// Layout guards for the pause overlay: its buttons and the audio disclosure
// must share one width and one height on every screen, so hiding the save
// button (guests, practice, shapes) never leaves a hole in the row.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');

test('pause actions wrap into equal, full rows instead of a fixed column grid', () => {
  const rows = css.match(/^#pause-actions, #pause-quit-actions \{([^}]*)\}/m)?.[1];
  assert.ok(rows, 'pause action row rule missing');
  assert.match(rows, /display:\s*flex;/);
  assert.match(rows, /flex-wrap:\s*wrap;/);
  assert.match(css, /#pause-actions > button, #pause-quit-actions > button \{ flex: 1 1 220px; \}/);
  assert.match(css, /#pause-quit-actions > p \{ flex: 1 1 100%; \}/);
});

test('no rule pins the quit actions back to a three-column grid', () => {
  assert.doesNotMatch(css, /#pause-quit-actions \{[^}]*grid-template-columns/);
});

test('the pause dialog and its disclosure share the 560px control column', () => {
  const card = css.match(/^#pause-overlay \.overlay-card \{([^}]*)\}/m)?.[1];
  assert.ok(card, 'pause overlay-card rule missing');
  assert.match(card, /max-width:\s*560px;/);
  assert.match(card, /margin-inline:\s*auto;/);
  assert.match(css, /#audio-settings \{ width: 100%; align-self: center; \}/);
});

test('the audio summary inherits the pause buttons’ size and weight', () => {
  const summary = css.match(/^#pause-overlay \.compact-disclosure > summary \{([^}]*)\}/m)?.[1];
  assert.ok(summary, 'pause disclosure summary rule missing');
  assert.match(summary, /min-height:\s*44px;/);
  assert.match(summary, /padding:\s*6px;/);
  assert.match(summary, /font-size:\s*14px;/);
  assert.match(summary, /font-weight:\s*400;/);
  // The same metrics the overlay buttons get from `.overlay-card .diff-btn`.
  assert.match(css, /\.overlay-card \.diff-btn \{ margin: 0; padding: 6px; font-size: 14px; \}/);
});
