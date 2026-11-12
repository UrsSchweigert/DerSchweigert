// Layout guard for the player-name form on short screens (a phone with the
// keyboard open): the name field keeps the full width and Save and Cancel share
// one row below it, so neither button is pushed underneath the top bar.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');

test('compact player-name form stacks the field with both actions on one row', () => {
  const form = css.match(/^:root\[data-viewport-compact="true"\] \.profile-form \{([^}]*)\}/m)?.[1];
  assert.ok(form, 'compact profile form rule missing');
  assert.match(form, /grid-template-columns:\s*minmax\(0, 1fr\);/);
  const actions = css.match(/^:root\[data-viewport-compact="true"\] \.profile-form \.profile-actions button \{([^}]*)\}/m)?.[1];
  assert.ok(actions, 'compact profile action button rule missing');
  assert.match(actions, /flex:\s*1;/);
  assert.match(actions, /min-width:\s*44px;/);
});

test('the keyboard stage hides the top bar that main.js shows inline', () => {
  // main.js sets style.display on #top-bar for menu and gameplay screens, so
  // only an !important rule stops the mute and language buttons from covering
  // the raised page while the keyboard is open.
  const bar = css.match(/^:root\[data-viewport-keyboard="true"\] #top-bar \{([^}]*)\}/m)?.[1];
  assert.ok(bar, 'keyboard-mode top bar rule missing');
  assert.match(bar, /display:\s*none !important;/);
});

test('no compact rule wraps Save and Cancel into a narrow action column', () => {
  // Beside the field the action column is too narrow for both buttons, so a
  // wrap put Save on its own row under the top bar.
  assert.doesNotMatch(css, /\[data-viewport-compact="true"\][^{]*\.profile-actions[^{]*\{[^}]*flex-wrap:\s*wrap/);
});
