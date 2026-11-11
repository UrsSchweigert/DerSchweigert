import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createGameplayChrome } from './gameplay-chrome.js';

function fixture() {
  const elements = Object.fromEntries(['gameplay-chrome', 'active-question', 'accessible-hearts',
    'accessible-combo', 'accessible-score', 'accessible-timer', 'accessible-timer-progress',
    'accessible-combo-wrap', 'accessible-score-wrap', 'btn-pause-game', 'gameplay-feedback',
    'encounter-progress', 'combo-reward', 'heal-progress']
    .map(id => [id, { textContent: '', hidden: true, writes: 0 }]));
  const question = elements['active-question'];
  let content = '';
  Object.defineProperty(question, 'textContent', {
    get: () => content,
    set(value) { content = value; question.writes++; },
  });
  const chrome = createGameplayChrome({ doc: { getElementById: id => elements[id] } });
  return { chrome, elements };
}

test('active problem and readable numeric HUD update without per-frame question announcements', () => {
  const { chrome, elements } = fixture();
  chrome.setVisible(true);
  const state = { hearts: 7, maxHearts: 9, timerActive: true, timerRemaining: 9.9, timerMax: 15, combo: 4, score: 12345 };
  const problem = { question: '99999 + 99999 = ?' };
  chrome.update(state, problem);
  assert.equal(elements['active-question'].textContent, problem.question);
  assert.equal(elements['accessible-hearts'].textContent, '7/9');
  assert.equal(elements['accessible-timer'].textContent, '10s');
  assert.equal(elements['accessible-timer-progress'].value, 9.9 / 15);
  assert.equal(elements['accessible-score'].textContent, '12345');
  chrome.update({ ...state, timerRemaining: 9.8 }, problem);
  assert.equal(elements['active-question'].writes, 1);
  assert.equal(elements['accessible-timer'].textContent, '10s');
  assert.equal(elements['accessible-combo-wrap'].hidden, false);
});

test('pause, reveal, idle and hidden screens cannot retain an actionable stale question', () => {
  const { chrome, elements } = fixture();
  const state = { timerActive: true, timerRemaining: 5, timerMax: 5 };
  const problem = { question: '12 × 12 = ?' };
  for (const idle of [{ paused: true }, { reveal: true }, { timerActive: false }]) {
    chrome.update(state, problem);
    chrome.update({ ...state, ...idle }, problem);
    assert.equal(elements['active-question'].textContent, '');
    assert.equal(elements['accessible-timer-progress'].value, 0);
  }
  chrome.update(state, null);
  assert.equal(elements['active-question'].textContent, '');
  chrome.update(state, problem);
  chrome.setVisible(false);
  assert.equal(elements['active-question'].textContent, '');
  assert.equal(elements['gameplay-chrome'].hidden, true);
});

test('untimed practice keeps the active question visible without a countdown', () => {
  const { chrome, elements } = fixture();
  const state = { questionActive: true, timerActive: false, timerMax: 15, timerRemaining: 15 };
  const problem = { question: '3 + 4 = ?' };
  chrome.update(state, problem);
  assert.equal(elements['active-question'].textContent, problem.question);
  assert.equal(elements['accessible-timer'].textContent, '—');
  assert.equal(elements['accessible-timer-progress'].value, 0);
  chrome.update({ ...state, questionActive: false }, problem);
  assert.equal(elements['active-question'].textContent, '');
});

test('shapes prompt displays actual shapes, not an arithmetic answer or scored HUD', () => {
  const { chrome, elements } = fixture();
  chrome.update({ timerActive: true, isShapesMode: true }, { displayMode: 'shapes', shapeType: 'triangle', count: 5 });
  assert.equal(elements['active-question'].textContent, 'Count the shapes: ▲ ▲ ▲ ▲ ▲');
  assert.equal(elements['accessible-combo-wrap'].hidden, true);
  assert.equal(elements['accessible-score-wrap'].hidden, true);
});

test('one through ten shapes match the actual problem type and count', () => {
  const { chrome, elements } = fixture();
  for (const [type, symbol] of [['circle', '●'], ['triangle', '▲'], ['square', '■']]) {
    for (let count = 1; count <= 10; count++) {
      chrome.update({ timerActive: true }, { displayMode: 'shapes', shapeType: type, count });
      assert.equal(elements['active-question'].textContent, `Count the shapes: ${Array(count).fill(symbol).join(' ')}`);
    }
  }
});

test('an installed app-only shapes header owns the two-row shapes markup', () => {
  const { chrome, elements } = fixture();
  const calls = [];
  let cleared = 0;
  chrome.setShapesHeader({
    render(args) { calls.push(args); },
    clear() { cleared++; },
  });
  const problem = { displayMode: 'shapes', shapeType: 'circle', count: 7 };
  chrome.update({ timerActive: true }, problem);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].element, elements['active-question']);
  assert.equal(calls[0].problem, problem);
  assert.equal(calls[0].instruction, 'Count the shapes');
  assert.equal(elements['active-question'].textContent, '', 'the chrome leaves the markup to the widget');

  chrome.update({ timerActive: true, paused: true }, problem);
  assert.equal(cleared, 1, 'leaving shapes clears the two-row markup');
  assert.equal(elements['active-question'].textContent, '');

  chrome.update({ timerActive: true }, { question: '2 + 2 = ?' });
  assert.equal(elements['active-question'].textContent, '2 + 2 = ?');
  assert.equal(cleared, 2);

  chrome.setShapesHeader(null);
  chrome.update({ timerActive: true }, problem);
  assert.equal(elements['active-question'].textContent, 'Count the shapes: ● ● ● ● ● ● ●');
});

test('a failing shapes header falls back to the single-line prompt', () => {
  const { chrome, elements } = fixture();
  chrome.setShapesHeader({ render() { throw new Error('boom'); } });
  chrome.update({ timerActive: true }, { displayMode: 'shapes', shapeType: 'square', count: 3 });
  assert.equal(elements['active-question'].textContent, 'Count the shapes: ■ ■ ■');
});

test('reveal feedback and supplied progress never expose the queued question', () => {
  const { chrome, elements } = fixture();
  const state = { reveal: true, timerActive: true, progressLabel: 'Defeated 4 / 30',
    rewardLabel: 'Fireball chance in 2', healLabel: 'Healing 25%',
    feedback: { kind: 'incorrect', question: '2 + 3 = 5' } };
  chrome.update(state, { question: 'secret queued question' });
  assert.equal(elements['active-question'].textContent, '');
  assert.equal(elements['gameplay-feedback'].textContent, 'Incorrect: 2 + 3 = 5');
  assert.equal(elements['encounter-progress'].textContent, state.progressLabel);
  assert.equal(elements['combo-reward'].textContent, state.rewardLabel);
  assert.equal(elements['heal-progress'].textContent, state.healLabel);
  chrome.update({ ...state, feedback: { kind: 'timeout', question: 'Count: 10' } });
  assert.equal(elements['gameplay-feedback'].textContent, 'Time ran out: Count: 10');
  chrome.update({ ...state, paused: true });
  assert.equal(elements['gameplay-feedback'].textContent, '');
  chrome.update({ ...state, reveal: false });
  assert.equal(elements['gameplay-feedback'].textContent, '');
  chrome.setVisible(false);
  assert.equal(elements['gameplay-feedback'].textContent, '');
});

test('DOM chrome and identity markup have accessible semantics and no noisy timer live region', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  for (const id of ['btn-pause-game', 'playing-as', 'continue-level', 'progress-player-name',
    'pause-player-name', 'game-over-title', 'gameplay-chrome', 'active-question',
    'accessible-hearts', 'accessible-timer', 'accessible-combo', 'practice-panel', 'practice-kind',
    'practice-level-select', 'practice-badges', 'practice-status', 'btn-start-practice',
    'audio-settings', 'music-volume', 'music-volume-status', 'effects-volume', 'skill-intro',
    'skill-intro-title', 'skill-intro-body', 'skill-intro-example', 'btn-skill-intro-continue',
    'btn-skill-intro-skip']) assert.ok(html.includes(`id="${id}"`), id);
  assert.match(html, /id="active-question"[^>]*aria-live="polite"/);
  assert.match(html, /class="gameplay-readouts" aria-live="off"/);
  assert.match(html, /id="mc-buttons"[^>]*aria-labelledby="active-question"/);
  assert.match(html, /id="skill-intro"[^>]*role="dialog"[^>]*aria-modal="true"/);
  assert.match(html, /id="music-volume"[^>]*value="0\.35" disabled/);
  assert.doesNotMatch(html, /data-title-target="practice"/);
});

test('an installed shapes header reserves the two-row question height for the level', () => {
  const elements = { 'gameplay-chrome': { dataset: {}, hidden: true } };
  const chrome = createGameplayChrome({ doc: { getElementById: id => elements[id] } });
  chrome.setShapesHeader({ render() {}, clear() {} });
  chrome.update({ timerActive: true, isShapesMode: true }, null);
  assert.equal(elements['gameplay-chrome'].dataset.twoRowQuestion, 'true',
    'the question row keeps its two-row height between problems');
  chrome.update({ timerActive: true, isShapesMode: true, reveal: true }, null);
  assert.equal(elements['gameplay-chrome'].dataset.twoRowQuestion, 'true',
    'the reveal keeps the same height');
  chrome.update({ timerActive: true, isShapesMode: false }, { question: '2 + 2 = ?' });
  assert.equal(elements['gameplay-chrome'].dataset.twoRowQuestion, 'false');

  const web = { 'gameplay-chrome': { dataset: {} } };
  const webChrome = createGameplayChrome({ doc: { getElementById: id => web[id] } });
  webChrome.update({ timerActive: true, isShapesMode: true }, null);
  assert.equal(web['gameplay-chrome'].dataset.twoRowQuestion, 'false',
    'without the app-only two-row renderer there is nothing to reserve');
});

test('absent DOM remains a no-op', () => {
  const chrome = createGameplayChrome({ doc: null });
  assert.doesNotThrow(() => { chrome.update(); chrome.setVisible(true); });
});
