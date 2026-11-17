import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('./main.js', import.meta.url), 'utf8');

test('the hero themes are open to every player: no feature toggle gates them', () => {
  assert.ok(!/feature-flags|featureOn|heroPackOn/.test(source));
  assert.ok(!/TEST UNLOCK/.test(source), 'the local-testing unlock must not ship');
});

test('the hero themes unlock with the regular full unlock, in the app and on the web', () => {
  assert.match(source, /isLocked: entry => !entry\.free && !heroUnlocked,/);
  assert.match(source, /isLocked: \(entry\) => !entry\.free && !premium,/);
  assert.match(source, /if \(!platform\.isLoggedIn\) \{\s*accountHeroPicker\.hidden = true;/);
});

test('the title screen shows the player badge and a tap opens Players', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /<button type="button" id="title-player-badge"[^>]*hidden>/);
  assert.match(source, /titlePlayerBadge\?\.addEventListener\('click', \(\) => document\.getElementById\('title-family-btn'\)\?\.click\(\)\)/);
});
