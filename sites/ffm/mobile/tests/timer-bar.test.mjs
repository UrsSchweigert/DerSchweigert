// timer-bar.test.mjs — the app-only header timer bar.
//
// timer-bar.js ships through the overlay as www/game/timer-bar.js and is
// imported by main.js only behind platform.isApp. These tests pin the
// continuous colour function, the untimed/paused states, the header DOM the
// widget adds, and the single per-frame timer-state publication.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  TIMER_GREEN_RGB,
  TIMER_PAUSED_CLASS,
  TIMER_RED_RGB,
  TIMER_STATE_ATTRIBUTE,
  TIMER_UNTIMED_CLASS,
  TIMER_YELLOW_RGB,
  createTimerBar,
  resolveTimerBar,
  timerBarColor,
  timerBarRgb,
} from '../game/timer-bar.js';
import { getProblemTimerRemaining, shouldPreserveTimerAfterHit } from '../../static/game/difficulty.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const staticDir = join(root, '..', 'static');

function hue([r, g, b]) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  if (delta === 0) return 0;
  let value;
  if (max === r) value = ((g - b) / delta) % 6;
  else if (max === g) value = (b - r) / delta + 2;
  else value = (r - g) / delta + 4;
  return (value * 60 + 360) % 360;
}

function makeElement(tagName) {
  const element = {
    tagName: tagName.toUpperCase(),
    className: '',
    style: {},
    children: [],
    attributes: {},
    classList: {
      toggle(name, force) {
        const classes = new Set(element.className.split(/\s+/).filter(Boolean));
        if (force) classes.add(name);
        else classes.delete(name);
        element.className = [...classes].join(' ');
      },
      contains(name) {
        return element.className.split(/\s+/).includes(name);
      },
    },
    setAttribute(name, value) {
      element.attributes[name] = String(value);
    },
    getAttribute(name) {
      return element.attributes[name] ?? null;
    },
    appendChild(child) {
      element.children.push(child);
      return child;
    },
  };
  return element;
}

function fakeDocument() {
  const container = makeElement('section');
  container.id = 'gameplay-chrome';
  return {
    container,
    doc: {
      getElementById: (id) => (id === 'gameplay-chrome' ? container : null),
      createElement: (tagName) => makeElement(tagName),
    },
  };
}

test('the colour endpoints and clamping are exact', () => {
  assert.deepEqual(timerBarRgb(1), [...TIMER_GREEN_RGB]);
  assert.deepEqual(timerBarRgb(0.5), [...TIMER_YELLOW_RGB]);
  assert.deepEqual(timerBarRgb(0), [...TIMER_RED_RGB]);
  assert.deepEqual(timerBarRgb(2), [...TIMER_GREEN_RGB], 'ratios above 1 clamp to green');
  assert.deepEqual(timerBarRgb(-1), [...TIMER_RED_RGB], 'negative ratios clamp to red');
  assert.deepEqual(timerBarRgb(Number.NaN), [...TIMER_RED_RGB], 'non-numbers fall back to empty');
  assert.equal(timerBarColor(0.5), 'rgb(232, 192, 64)');
});

test('colour is a continuous, monotonic hue function of the ratio', () => {
  const samples = 1000;
  let previous = hue(timerBarRgb(1));
  assert.equal(previous, 120, 'a full timer starts at green');

  for (let index = 1; index <= samples; index += 1) {
    const ratio = 1 - index / samples;
    const current = hue(timerBarRgb(ratio));
    assert.ok(current <= previous + 1.5,
      `hue must move monotonically from green to red at ratio ${ratio} (${previous} -> ${current})`);
    assert.ok(Math.abs(current - previous) <= 1.5,
      `adjacent samples must not jump (${previous} -> ${current} at ratio ${ratio})`);
    previous = current;
  }
  assert.equal(previous, 0, 'an empty timer ends at red');
});

test('untimed modes resolve to an explicit neutral state', () => {
  assert.deepEqual(resolveTimerBar({ remaining: 0, max: 0 }), { ratio: 1, untimed: true, paused: false });
  assert.deepEqual(resolveTimerBar({ remaining: 5, max: -1 }), { ratio: 1, untimed: true, paused: false });
  assert.deepEqual(resolveTimerBar({ remaining: 5, max: 10, untimed: true }),
    { ratio: 1, untimed: true, paused: false });
});

test('the bar tracks timerRemaining through pause, correction, retry and preserved timers', () => {
  // A running question at 60%.
  assert.deepEqual(resolveTimerBar({ remaining: 6, max: 10 }), { ratio: 0.6, untimed: false, paused: false });
  // Pausing freezes the remaining time, so the width and colour stay put.
  assert.deepEqual(resolveTimerBar({ remaining: 6, max: 10, paused: true }),
    { ratio: 0.6, untimed: false, paused: true });
  // A wrong answer corrects and retries the same problem from the full timer.
  assert.deepEqual(resolveTimerBar({ remaining: 10, max: 10 }), { ratio: 1, untimed: false, paused: false });
  // Retrying drains the bar again.
  assert.deepEqual(resolveTimerBar({ remaining: 2.5, max: 10 }), { ratio: 0.25, untimed: false, paused: false });
  // An elite hit that preserves the timer keeps the exact remaining ratio,
  // while a normal hit restarts the problem at the full timer.
  const preserved = getProblemTimerRemaining(10, 2.5, shouldPreserveTimerAfterHit({ isElite: true, hp: 2 }));
  assert.equal(preserved, 2.5);
  assert.deepEqual(resolveTimerBar({ remaining: preserved, max: 10 }),
    { ratio: 0.25, untimed: false, paused: false });
  const restarted = getProblemTimerRemaining(10, 2.5, shouldPreserveTimerAfterHit({ isElite: false, hp: 2 }));
  assert.equal(restarted, 10);
  assert.deepEqual(resolveTimerBar({ remaining: restarted, max: 10 }),
    { ratio: 1, untimed: false, paused: false });
});

test('the widget appends one decorative bar to the header and renders the ratio', () => {
  const { doc, container } = fakeDocument();
  const widget = createTimerBar({ doc });

  assert.equal(container.children.length, 1, 'one bar is appended to the header');
  const bar = container.children[0];
  assert.equal(bar, widget.element);
  assert.equal(bar.className, 'app-header-timer');
  assert.equal(bar.getAttribute('aria-hidden'), 'true', 'the visual bar is decorative');
  assert.equal(bar.children.length, 1);
  assert.equal(bar.children[0].className, 'app-header-timer-fill');

  widget.updateTimerState({ remaining: 6, max: 10 });
  assert.equal(bar.getAttribute(TIMER_STATE_ATTRIBUTE), 'running');
  assert.equal(widget.fill.style.width, '60.0%');
  assert.equal(widget.fill.style.backgroundColor, timerBarColor(0.6));
  assert.equal(bar.classList.contains(TIMER_UNTIMED_CLASS), false);
  assert.equal(bar.classList.contains(TIMER_PAUSED_CLASS), false);

  widget.updateTimerState({ remaining: 6, max: 10, paused: true });
  assert.equal(bar.getAttribute(TIMER_STATE_ATTRIBUTE), 'paused');
  assert.equal(bar.classList.contains(TIMER_PAUSED_CLASS), true);
  assert.equal(widget.fill.style.width, '60.0%', 'pausing does not move the bar');

  widget.updateTimerState({ remaining: 0, max: 0 });
  assert.equal(bar.getAttribute(TIMER_STATE_ATTRIBUTE), 'untimed');
  assert.equal(bar.classList.contains(TIMER_UNTIMED_CLASS), true);
  assert.equal(widget.fill.style.backgroundColor, 'rgb(111, 127, 159)',
    'untimed is a neutral state, not full green or empty red');
});

test('the widget is a no-op without a header container', () => {
  const widget = createTimerBar({ doc: { getElementById: () => null } });
  assert.equal(widget.element, null);
  assert.equal(widget.updateTimerState({ remaining: 1, max: 2 }), null);
});

test('main.js publishes the live timer state once per frame and only in the app', async () => {
  const source = await readFile(join(staticDir, 'game', 'main.js'), 'utf8');

  assert.equal((source.match(/\.updateTimerState\(/g) ?? []).length, 1,
    'the timer state is published exactly once per frame');
  const publish = source.slice(source.indexOf('mobileUi?.updateTimerState('));
  assert.match(publish, /remaining: state\.timerRemaining/);
  assert.match(publish, /max: state\.timerMax/);
  assert.match(publish, /untimed:/);
  assert.match(publish, /\bpaused,/);
  assert.match(source, /mobileUi\?\.registerWidget\('timer-bar', createTimerBar\(\{ doc: document \}\)\)/);

  // The web build keeps the canvas bar with its banded colours.
  assert.match(source, /state\.timerActive && !platform\.isApp/);
});

test('the visual bar stays decorative while the accessible timer keeps announcing', async () => {
  const html = await readFile(join(staticDir, 'index.html'), 'utf8');
  assert.match(html, /id="accessible-timer"/, 'the header keeps the announced timer text');
  assert.match(html, /<progress id="accessible-timer-progress"[^>]*aria-label="Time remaining"/,
    'the header keeps the announced timer progress bar');

  const { doc } = fakeDocument();
  const widget = createTimerBar({ doc });
  assert.equal(widget.element.getAttribute('aria-hidden'), 'true',
    'the visual fill must never duplicate the announced countdown');
});

test('the overlay stylesheet centres the header bar in its grid row', async () => {
  const css = await readFile(join(root, 'game', 'mobile-ui.css'), 'utf8');
  assert.match(css, /\.app-header-timer\s*\{[^}]*grid-column:\s*1 \/ -1/);
  assert.match(css, /\.app-header-timer\s*\{[^}]*align-self:\s*center/);
  assert.match(css, /\.app-header-timer--untimed \.app-header-timer-fill\s*\{/);
  assert.match(css, /\.app-header-timer--paused \.app-header-timer-fill\s*\{/);
  assert.doesNotMatch(css, /https?:\/\//, 'the overlay stylesheet must stay offline');
});

test('the header bar is the only visual countdown in the app', async () => {
  const css = await readFile(join(root, 'game', 'mobile-ui.css'), 'utf8');
  // The stripe runs in every orientation; portrait no longer drops it.
  assert.doesNotMatch(css, /\.app-header-timer \{[^}]*display: none/,
    'the header bar must not be dropped in any orientation');
  assert.doesNotMatch(css, /@media \(orientation: portrait\)[\s\S]{0,200}\.app-header-timer/,
    'portrait keeps the bar');
  // The browser's own <progress> stripe beside "Time 15s" is hidden visually
  // (kept in the accessibility tree) so only one bar is drawn.
  assert.match(css, /#accessible-timer-progress\s*\{[^}]*clip-path:\s*inset\(50%\)/,
    'the small progress stripe must be visually hidden');

  // The seconds stay in the shared header regardless of the bar.
  const html = await readFile(join(staticDir, 'index.html'), 'utf8');
  assert.match(html, /<span data-i18n="hud\.time">Time<\/span> <strong id="accessible-timer">/);
  assert.match(html, /<progress id="accessible-timer-progress"[^>]*aria-label="Time remaining"/,
    'the progress element stays for assistive tech');
  const chrome = await readFile(join(staticDir, 'game', 'gameplay-chrome.js'), 'utf8');
  assert.match(chrome, /text\('accessible-timer',[\s\S]{0,120}state\.timerRemaining/,
    'the header keeps printing the remaining seconds');
});
