import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const main = readFileSync(new URL('./main.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const overlay = html.slice(html.indexOf('<div id="difficulty-select"'), html.indexOf('<div id="auth-modal"'));

test('the difficulty click wiring only matches the buttons that start a level', () => {
  // The splash overlay also holds the Practice submenu's Back button and the
  // history page's "Back to practice", and both share the diff-btn class. Wiring
  // the whole class started a level from them as well: they carry no
  // data-hearts, so parseInt(undefined) left the run with NaN hearts while the
  // Back button appeared to do nothing but load an exercise.
  assert.doesNotMatch(main, /#difficulty-select \.diff-btn/, 'the class alone also matches the Back buttons');
  assert.match(main, /querySelectorAll\('#difficulty-select \[data-difficulty\]'\)\.forEach\(btn => \{/);
  assert.equal((main.match(/querySelectorAll\('#difficulty-select \[data-difficulty\]'\)/g) || []).length, 3,
    'the click wiring, the busy sweep and the Genius relabel share one set of buttons');
});

test('the overlay keeps its navigation buttons out of the difficulty contract', () => {
  const difficulties = [...overlay.matchAll(/<button[^>]*\bdata-difficulty="[^"]+"[^>]*>/g)].map(match => match[0]);
  assert.equal(difficulties.length, 4, 'the four difficulties stay the only level-start buttons');
  for (const button of difficulties) {
    assert.match(button, /\bdata-timer="\d+"/);
    assert.match(button, /\bdata-hearts="\d+"/);
  }
  const back = [...overlay.matchAll(/<button[^>]*\bclass="diff-btn practice-back"[^>]*>/g)].map(match => match[0]);
  assert.equal(back.length, 2, 'the practice submenu and the history page each have a Back button');
  for (const button of back) {
    assert.doesNotMatch(button, /\bdata-(difficulty|timer|hearts)=/,
      'a Back button must not look like a level-start button');
  }
});
