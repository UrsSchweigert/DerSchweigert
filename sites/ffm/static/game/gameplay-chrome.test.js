import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createGameplayChrome } from './gameplay-chrome.js';

function fixture({ onScoreGain } = {}) {
  const elements = Object.fromEntries(['gameplay-chrome', 'active-question', 'accessible-hearts',
    'accessible-combo', 'accessible-score', 'accessible-timer', 'accessible-timer-progress',
    'accessible-combo-wrap', 'accessible-score-wrap', 'btn-pause-game',
    'encounter-progress', 'combo-reward', 'heal-progress', 'bonus-notice']
    .map(id => [id, {
      textContent: '', hidden: true, writes: 0, style: {}, dataset: {},
      setAttribute(name, value) { this.attrs = { ...(this.attrs || {}), [name]: String(value) }; },
      removeAttribute(name) { if (this.attrs) delete this.attrs[name]; },
      getAttribute(name) { return this.attrs ? this.attrs[name] ?? null : null; },
    }]));
  const question = elements['active-question'];
  let content = '';
  question.children = [];
  // A parent's textContent is the concatenation of its children in the DOM, so
  // the two-line Shapes question reads the same here as it does in the page.
  Object.defineProperty(question, 'textContent', {
    get: () => content,
    set(value) { content = value; question.children.length = 0; question.writes++; },
  });
  question.appendChild = (child) => { question.children.push(child); content += child.textContent; };
  const doc = {
    getElementById: id => elements[id],
    createElement: () => ({
      className: '', textContent: '', children: [], attrs: {},
      setAttribute(name, value) { this.attrs[name] = String(value); },
      appendChild(child) { this.children.push(child); },
    }),
  };
  const chrome = createGameplayChrome({ doc, onScoreGain });
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

test('a score increase sparkles the score readout, a decrease or Shapes mode does not', () => {
  const gains = [];
  const { chrome, elements } = fixture({ onScoreGain: (info) => gains.push(info) });
  const readout = elements['accessible-score'];

  // The markup ships a 0, so the first real change is the first receipt.
  elements['accessible-score'].textContent = '0';
  chrome.update({ score: 120 });
  assert.equal(gains.length, 1);
  assert.equal(gains[0].gained, 120);
  assert.equal(gains[0].score, 120);
  assert.equal(gains[0].element, elements['accessible-score-wrap'], 'the burst host is the readout');

  // Re-rendering the same score every frame must not sparkle every frame.
  chrome.update({ score: 120 });
  chrome.update({ score: 120, combo: 3 });
  assert.equal(gains.length, 1, 'an unchanged score is silent');

  chrome.update({ score: 360 });
  assert.equal(gains.length, 2);
  assert.equal(gains.at(-1).gained, 240);

  // A reset (retry, new level) must never read as a gain.
  chrome.update({ score: 0 });
  assert.equal(gains.length, 2, 'a decrease is not a gain');
  chrome.update({ score: 80 });
  assert.equal(gains.at(-1).gained, 80);

  chrome.update({ score: 500, isShapesMode: true });
  assert.equal(gains.length, 3, 'Shapes mode is unscored');
  assert.equal(readout.textContent, '500', 'the readout still tracks the state');
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

const stonesOf = (row) => row.children.filter((child) => child.className === 'runestone');

test('shapes prompt shows the instruction and the runestones on two rows', () => {
  const { chrome, elements } = fixture();
  chrome.update({ timerActive: true, isShapesMode: true }, { displayMode: 'shapes', shapeType: 'runestone', count: 5 });
  const question = elements['active-question'];
  assert.equal(question.dataset.shapesHeader, 'two-rows');
  assert.deepEqual(question.children.map((row) => row.className), ['shapes-instruction', 'shapes-row']);
  assert.equal(question.children[0].textContent, 'Count the shapes');
  assert.equal(stonesOf(question.children[1]).length, 5, 'five runestone images on the second row');
  assert.equal(question.children[1].textContent, '', 'no glyphs, only images');
  assert.equal(question.children[1].attrs['aria-label'], '5');
  assert.equal(question.children[1].attrs.role, 'img');
  assert.match(stonesOf(question.children[1])[0].src, /^data:image\/png;base64,/);
  assert.equal(elements['accessible-combo-wrap'].hidden, true);
  assert.equal(elements['accessible-score-wrap'].hidden, true);
});

test('one through six runestones match the actual problem count, whatever the old shape type', () => {
  const { chrome, elements } = fixture();
  const question = elements['active-question'];
  for (const type of ['runestone', 'circle', 'triangle', 'square']) {
    for (let count = 1; count <= 6; count++) {
      chrome.update({ timerActive: true }, { displayMode: 'shapes', shapeType: type, count });
      assert.equal(question.children[0].textContent, 'Count the shapes');
      assert.equal(stonesOf(question.children[1]).length, count, `${type} ${count}`);
    }
  }
  // the two-row markup must not survive into a campaign question
  chrome.update({ timerActive: true }, { question: '2 + 2 = ?' });
  assert.equal(question.textContent, '2 + 2 = ?');
  assert.equal(question.dataset.shapesHeader, undefined);
  assert.equal(question.children.length, 0);
});

test('a counted addition keeps full size at the six-stone maximum and still shrinks if ever given more', () => {
  const { chrome, elements } = fixture();
  const question = elements['active-question'];
  chrome.update({ timerActive: true }, { question: '1 + 1 = ?', visual: { a: 1, b: 1 } });
  assert.equal(question.style.fontSize, '22px', 'small sums keep the full size');
  chrome.update({ timerActive: true }, { question: '3 + 3 = ?', visual: { a: 3, b: 3 } });
  assert.equal(question.style.fontSize, '22px', 'six stones in total (the most levels 1-2 produce) need no shrinking');
  chrome.update({ timerActive: true }, { question: '6 + 6 = ?', visual: { a: 6, b: 6 } });
  const size = Number.parseInt(question.style.fontSize, 10);
  const widthEm = 12 * 0.9 + 7 * 0.6;
  assert.ok(size < 22 && size * widthEm <= 304, `${size}px keeps 12 stones inside 304px (safeguard only)`);
  chrome.update({ timerActive: true }, { question: '4 + 4 = ?' });
  assert.equal(question.style.fontSize, '', 'plain text goes back to the stylesheet size');
});

test('a counted addition draws runestones around the signs once per problem and then reverts to text', () => {
  const { chrome, elements } = fixture();
  const question = elements['active-question'];
  const problem = { question: '3 + 2 = ?', visual: { a: 3, b: 2 } };
  chrome.update({ timerActive: true }, problem);
  assert.equal(question.dataset.stoneSum, '3+2');
  assert.deepEqual(question.children.map((part) => part.className),
    ['stone-sum-stones', 'stone-sum-sign', 'stone-sum-stones', 'stone-sum-sign']);
  assert.deepEqual(question.children.map((part) => stonesOf(part).length), [3, 0, 2, 0]);
  assert.equal(question.children[1].textContent, ' + ');
  assert.equal(question.children[3].textContent, ' = ?');
  const first = question.children[0];
  chrome.update({ timerActive: true }, problem);
  assert.equal(question.children[0], first, 'the same problem is not rebuilt every frame');
  chrome.update({ timerActive: true }, { question: '4 + 4 = ?' });
  assert.equal(question.textContent, '4 + 4 = ?');
  assert.equal(question.dataset.stoneSum, undefined);
  chrome.update({ timerActive: true }, problem);
  chrome.update({ reveal: true, timerActive: true, feedback: { question: '3 + 2 = 5' } }, problem);
  assert.equal(question.textContent, '3 + 2 = 5', 'the correction is plain digits');
});

test('an installed app-only shapes header owns the two-row shapes markup', () => {
  const { chrome, elements } = fixture();
  const calls = [];
  let cleared = 0;
  chrome.setShapesHeader({
    render(args) { calls.push(args); },
    clear() { cleared++; },
  });
  const problem = { displayMode: 'shapes', shapeType: 'circle', count: 6 };
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
  assert.equal(elements['active-question'].children.length, 2,
    'without the widget the chrome writes the same two rows itself');
  assert.equal(stonesOf(elements['active-question'].children[1]).length, 6);
});

test('a failing shapes header falls back to the two rows the chrome writes itself', () => {
  const { chrome, elements } = fixture();
  chrome.setShapesHeader({ render() { throw new Error('boom'); } });
  chrome.update({ timerActive: true }, { displayMode: 'shapes', shapeType: 'square', count: 3 });
  const question = elements['active-question'];
  assert.equal(question.children[0].textContent, 'Count the shapes');
  assert.equal(stonesOf(question.children[1]).length, 3);
});

test('the correction takes the question row and never exposes the queued question', () => {
  const { chrome, elements } = fixture();
  const question = elements['active-question'];
  const state = { reveal: true, timerActive: true, progressLabel: 'Defeated 4 / 30',
    rewardLabel: 'Fireball chance in 2', healLabel: 'Healing 25%',
    feedback: { kind: 'incorrect', question: '2 + 3 = 5' } };
  chrome.update(state, { question: 'secret queued question' });
  assert.equal(question.textContent, '2 + 3 = 5',
    'the answer alone replaces the question - no leading sentence');
  assert.equal(elements['encounter-progress'].textContent, state.progressLabel);
  assert.equal(elements['combo-reward'].textContent, state.rewardLabel);
  assert.equal(elements['heal-progress'].textContent, state.healLabel);
  chrome.update({ ...state, feedback: { kind: 'timeout', question: '3 shapes' } });
  assert.equal(question.textContent, '3 shapes');
  chrome.update({ ...state, paused: true });
  assert.equal(question.textContent, '');
  chrome.update({ ...state, reveal: false });
  assert.equal(question.textContent, '');
  chrome.setVisible(false);
  assert.equal(question.textContent, '');
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

test('the question rows are reserved per mode, on every build', () => {
  const elements = { 'gameplay-chrome': { dataset: {}, hidden: true } };
  const chrome = createGameplayChrome({ doc: { getElementById: id => elements[id] } });
  chrome.setShapesHeader({ render() {}, clear() {} });
  chrome.update({ timerActive: true, isShapesMode: true }, null);
  assert.equal(elements['gameplay-chrome'].dataset.questionRows, '2',
    'shapes keeps two question rows between problems');
  chrome.update({ timerActive: true, isShapesMode: true, reveal: true }, null);
  assert.equal(elements['gameplay-chrome'].dataset.questionRows, '2',
    'the reveal keeps the same height');
  chrome.update({ timerActive: true, isShapesMode: false }, { question: '2 + 2 = ?' });
  assert.equal(elements['gameplay-chrome'].dataset.questionRows, '1',
    'easy/medium/hard ask one line and reserve one line');

  // The web build renders the shapes question itself (single line of symbols),
  // and must reserve the same two rows so the header never changes size.
  const web = { 'gameplay-chrome': { dataset: {} } };
  const webChrome = createGameplayChrome({ doc: { getElementById: id => web[id] } });
  webChrome.update({ timerActive: true, isShapesMode: true }, null);
  assert.equal(web['gameplay-chrome'].dataset.questionRows, '2',
    'the web build reserves the shapes rows too');
  webChrome.update({ timerActive: true, isShapesMode: false }, { question: '2 + 2 = ?' });
  assert.equal(web['gameplay-chrome'].dataset.questionRows, '1');
});

test('absent DOM remains a no-op', () => {
  const chrome = createGameplayChrome({ doc: null });
  assert.doesNotThrow(() => { chrome.update(); chrome.setVisible(true); });
});

test('hiding the HUD after it was shown keeps its row so the playfield cannot jump', () => {
  const { chrome, elements } = fixture();
  const panel = elements['gameplay-chrome'];

  chrome.setVisible(true);
  assert.equal(panel.hidden, false);

  chrome.setVisible(false);
  assert.equal(panel.hidden, false, 'the element stays in normal flow');
  assert.equal(panel.style.visibility, 'hidden');
  assert.equal(panel.style.pointerEvents, 'none');
  assert.equal(panel.getAttribute('aria-hidden'), 'true');

  chrome.setVisible(true);
  assert.equal(panel.style.visibility, '');
  assert.equal(panel.style.pointerEvents, '');
  assert.equal(panel.getAttribute('aria-hidden'), null);
});

test('the HUD stays display-none before it is ever shown', () => {
  const { chrome, elements } = fixture();
  chrome.setVisible(false);
  assert.equal(elements['gameplay-chrome'].hidden, true);
  assert.equal(elements['gameplay-chrome'].style.visibility, undefined);
});

test('setVisible touches the chrome once per change, not once per frame', () => {
  // The frame loop calls this on every frame; three DOM writes each time were
  // costing a style recalculation per frame for the whole header.
  const { chrome, elements } = fixture();
  const panel = elements['gameplay-chrome'];
  let styleWrites = 0;
  let ariaWrites = 0;
  for (const property of ['visibility', 'pointerEvents']) {
    let value = '';
    Object.defineProperty(panel.style, property, {
      configurable: true,
      get: () => value,
      set: (next) => { styleWrites++; value = next; },
    });
  }
  panel.setAttribute = (name, next) => {
    ariaWrites++;
    panel.attrs = { ...(panel.attrs || {}), [name]: String(next) };
  };
  panel.removeAttribute = (name) => {
    ariaWrites++;
    if (panel.attrs) delete panel.attrs[name];
  };

  chrome.setVisible(true);
  assert.equal(styleWrites, 2, 'the first call applies both style properties');
  assert.equal(panel.hidden, false);

  const settled = styleWrites;
  const settledAria = ariaWrites;
  for (let frame = 0; frame < 60; frame++) chrome.setVisible(true);
  assert.equal(styleWrites, settled, 'sixty repeat frames must not touch style');
  assert.equal(ariaWrites, settledAria, 'and must not toggle aria-hidden');

  chrome.setVisible(false);
  assert.equal(styleWrites, settled + 2, 'a real change still applies');
  assert.equal(panel.style.visibility, 'hidden');
  assert.equal(panel.getAttribute('aria-hidden'), 'true');
});
