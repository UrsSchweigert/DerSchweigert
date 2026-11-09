// bubble-timer.test.mjs — the app-only portrait answer bubble timer.
//
// bubble-timer.js ships through the overlay as www/game/bubble-timer.js and is
// imported by main.js only behind platform.isApp. These tests pin the shared
// timer-state resolution (the widget owns no clock), the constant bubble
// budget, the row placement immediately above the answer buttons, the untimed
// and paused states, teardown, the portrait-only and reduced-motion CSS, and
// the 320px portrait touch-target budget.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BUBBLE_CLASS,
  BUBBLE_COUNT,
  BUBBLE_FILLED_CLASS,
  BUBBLE_TIMER_BACKGROUNDED_ATTRIBUTE,
  BUBBLE_TIMER_CLASS,
  BUBBLE_TIMER_STATE_ATTRIBUTE,
  createBubbleTimer,
  filledBubbleCount,
} from '../game/bubble-timer.js';
import { resolveTimerBar, timerBarColor } from '../game/timer-bar.js';
import { calculateSceneLayout } from '../../static/game/viewport-layout.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const staticDir = join(root, '..', 'static');

function makeElement(tagName) {
  const element = {
    tagName: tagName.toUpperCase(),
    className: '',
    hidden: false,
    children: [],
    attributes: {},
    properties: {},
    style: {
      setProperty(name, value) {
        element.properties[name] = String(value);
      },
    },
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
    removeAttribute(name) {
      delete element.attributes[name];
    },
    appendChild(child) {
      child.parent = element;
      element.children.push(child);
      return child;
    },
    insertBefore(child, anchor) {
      child.parent = element;
      const index = element.children.indexOf(anchor);
      if (index < 0) element.children.push(child);
      else element.children.splice(index, 0, child);
      return child;
    },
    remove() {
      element.removed = true;
      const parent = element.parent;
      if (parent) {
        const index = parent.children.indexOf(element);
        if (index >= 0) parent.children.splice(index, 1);
      }
    },
  };
  return element;
}

function fakeDocument({ visibility = 'visible' } = {}) {
  const container = makeElement('div');
  container.id = 'input-zone';
  const anchor = makeElement('div');
  anchor.id = 'mc-buttons';
  container.children.push(anchor);
  const listeners = new Map();
  const doc = {
    visibilityState: visibility,
    hidden: visibility === 'hidden',
    getElementById: (id) => (id === 'input-zone' ? container : id === 'mc-buttons' ? anchor : null),
    createElement: (tagName) => makeElement(tagName),
    addEventListener: (type, handler) => listeners.set(type, handler),
    removeEventListener: (type) => listeners.delete(type),
    dispatch(type) {
      listeners.get(type)?.();
    },
    listenerCount: () => listeners.size,
  };
  return { container, anchor, doc };
}

test('the bubble budget is a fixed constant', () => {
  assert.equal(BUBBLE_COUNT, 10);
  assert.equal(filledBubbleCount(0), 0);
  assert.equal(filledBubbleCount(0.04), 0, 'below half a bubble stays empty');
  assert.equal(filledBubbleCount(0.06), 1);
  assert.equal(filledBubbleCount(0.55), 6, 'rounding is deterministic');
  assert.equal(filledBubbleCount(1), BUBBLE_COUNT);
  assert.equal(filledBubbleCount(2), BUBBLE_COUNT, 'above full clamps');
  assert.equal(filledBubbleCount(-1), 0, 'negative clamps');
  assert.equal(filledBubbleCount(Number.NaN), 0, 'non-numbers are empty');
  assert.equal(filledBubbleCount('0.5'), 5, 'numeric strings resolve');
});

test('the widget renders the shared timer state and nothing of its own', () => {
  const { container, anchor, doc } = fakeDocument();
  const widget = createBubbleTimer({ doc });

  assert.equal(container.children.length, 2, 'one row is added beside the answer buttons');
  assert.equal(container.children[1], anchor, 'the answer buttons keep their place');
  const element = container.children[0];
  assert.equal(element, widget.element);
  assert.equal(element.className, BUBBLE_TIMER_CLASS);
  assert.equal(element.getAttribute('aria-hidden'), 'true', 'the row is decorative');
  assert.equal(element.hidden, true, 'nothing is drawn before a timer state arrives');
  assert.equal(element.children.length, BUBBLE_COUNT, 'the node count is bounded');
  assert.deepEqual(
    element.children.map((child) => child.className),
    Array.from({ length: BUBBLE_COUNT }, () => BUBBLE_CLASS),
  );

  // Same resolver and colour function as the header bar: one source of truth.
  const state = { remaining: 6, max: 10 };
  const resolved = widget.updateTimerState(state);
  assert.deepEqual(resolved, resolveTimerBar(state));
  assert.equal(element.hidden, false);
  assert.equal(element.getAttribute(BUBBLE_TIMER_STATE_ATTRIBUTE), 'running');
  assert.equal(element.properties['--bubble-color'], timerBarColor(0.6));
  assert.equal(widget.bubbles.filter((bubble) => bubble.classList.contains(BUBBLE_FILLED_CLASS)).length, 6);

  widget.updateTimerState({ remaining: 2.5, max: 10, paused: true });
  assert.equal(element.getAttribute(BUBBLE_TIMER_STATE_ATTRIBUTE), 'paused');
  assert.equal(element.properties['--bubble-color'], timerBarColor(0.25));
  assert.equal(widget.bubbles.filter((bubble) => bubble.classList.contains(BUBBLE_FILLED_CLASS)).length, 3);

  widget.updateTimerState({ remaining: 0, max: 0 });
  assert.equal(element.getAttribute(BUBBLE_TIMER_STATE_ATTRIBUTE), 'untimed');
  assert.equal(element.hidden, true, 'untimed modes hide the row explicitly');
});

test('the widget stops animation while backgrounded and tears down on quit', () => {
  const { container, doc } = fakeDocument();
  const widget = createBubbleTimer({ doc });
  const element = widget.element;

  assert.equal(element.getAttribute(BUBBLE_TIMER_BACKGROUNDED_ATTRIBUTE), 'false');
  doc.visibilityState = 'hidden';
  doc.hidden = true;
  doc.dispatch('visibilitychange');
  assert.equal(element.getAttribute(BUBBLE_TIMER_BACKGROUNDED_ATTRIBUTE), 'true');
  assert.equal(widget.backgrounded, true);
  doc.visibilityState = 'visible';
  doc.hidden = false;
  doc.dispatch('visibilitychange');
  assert.equal(element.getAttribute(BUBBLE_TIMER_BACKGROUNDED_ATTRIBUTE), 'false');

  widget.destroy();
  assert.equal(element.removed, true, 'the row leaves the document');
  assert.equal(widget.element, null);
  assert.equal(doc.listenerCount(), 0, 'the visibility listener is removed');
  assert.equal(widget.updateTimerState({ remaining: 1, max: 2 }), null, 'later updates are no-ops');
  assert.equal(container.children.length, 1, 'only the answer buttons remain');
});

test('the widget is a no-op without the answer-button anchor', () => {
  const widget = createBubbleTimer({
    doc: { getElementById: (id) => (id === 'input-zone' ? makeElement('div') : null), createElement: makeElement },
  });
  assert.equal(widget.element, null);
  assert.equal(widget.updateTimerState({ remaining: 1, max: 2 }), null);
  widget.destroy();
});

test('main.js registers the widget and publishes only through the shared hook', async () => {
  const source = await readFile(join(staticDir, 'game', 'main.js'), 'utf8');

  assert.equal((source.match(/\.updateTimerState\(/g) ?? []).length, 1,
    'the timer state is published exactly once per frame');
  assert.match(source, /mobileUi\?\.registerWidget\('bubble-timer', createBubbleTimer\(\{ doc: document \}\)\)/);
  assert.equal((source.match(/import\('\.\/bubble-timer\.js'\)/g) ?? []).length, 1);
  const appStart = source.indexOf('if (platform.isApp) {');
  const appEnd = source.indexOf('\n}\n', appStart);
  assert.ok(source.slice(appStart, appEnd).includes("import('./bubble-timer.js')"),
    'the app branch imports the bubble timer dynamically');
  assert.ok(!source.slice(0, appStart).includes('bubble-timer'),
    'no module code references the bubble timer before the app guard');

  const module = await readFile(join(root, 'game', 'bubble-timer.js'), 'utf8');
  for (const forbidden of ['setInterval', 'setTimeout', 'requestAnimationFrame', 'Date.now', 'performance.now']) {
    assert.ok(!module.includes(forbidden), `the widget must not own a clock (${forbidden})`);
  }
});

test('the module ships only through the app overlay, never the web build', async () => {
  await assert.rejects(
    stat(join(staticDir, 'game', 'bubble-timer.js')),
    { code: 'ENOENT' },
    'the module must not exist in the web deploy',
  );
  const index = await readFile(join(staticDir, 'index.html'), 'utf8');
  const webCss = await readFile(join(staticDir, 'styles.css'), 'utf8');
  assert.doesNotMatch(index, /bubble-timer|app-answer-bubble-timer/, 'the web page carries no bubble markup');
  assert.doesNotMatch(webCss, /app-answer-bubble-timer/, 'the web stylesheet carries no bubble rules');
});

test('the overlay stylesheet is portrait-only and reduced-motion safe', async () => {
  const css = await readFile(join(root, 'game', 'mobile-ui.css'), 'utf8');

  assert.match(css, /\.app-answer-bubble-timer\s*\{[^}]*display:\s*none/,
    'the row is hidden by default, so landscape and the web build never show it');
  assert.match(css, /#game-wrap\[data-layout="portrait"\]\s*\.app-answer-bubble-timer\s*\{[^}]*display:\s*flex/,
    'only the portrait layout shows the row');
  assert.match(css, /\.app-answer-bubble-timer\s*\{[^}]*flex:\s*0 0 100%/,
    'the row owns a full-width line above the answer buttons');
  assert.match(css, /\.app-answer-bubble-timer\s*\{[^}]*height:\s*22px/);
  assert.match(css, /\.app-answer-bubble-timer\s*\{[^}]*--safe-area-left/);
  assert.match(css, /\.app-answer-bubble-timer\s*\{[^}]*--safe-area-right/);
  assert.match(css, /\.app-answer-bubble-timer\s*\{[^}]*pointer-events:\s*none/);

  assert.match(css, /\.app-answer-bubble-timer-bubble--filled\s*\{[^}]*background:\s*var\(--bubble-color/);
  assert.match(css, /\.app-answer-bubble-timer-bubble--filled\s*\{[^}]*animation:\s*ffm-bubble-pulse/);
  assert.match(css, /@keyframes ffm-bubble-pulse/);

  assert.match(css, /\[data-timer-state="paused"\]\s*\.app-answer-bubble-timer-bubble/);
  assert.match(css, /\[data-backgrounded="true"\]\s*\.app-answer-bubble-timer-bubble/);
  assert.match(css, /animation-play-state:\s*paused/);

  const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
  assert.match(reduced, /\.app-answer-bubble-timer-bubble--filled\s*\{[^}]*animation:\s*none/,
    'reduced motion leaves a static fill');
  assert.match(reduced, /\.app-answer-bubble-timer-bubble--filled\s*\{[^}]*transform:\s*none/,
    'reduced motion removes the bubble motion');

  assert.doesNotMatch(css, /https?:\/\//, 'the overlay stylesheet must stay offline');
});

// --- 320px portrait touch-target budget --------------------------------
// Mirrors the vertical stacking in static/styles.css: #input-zone is the
// answer grid row, its padding and flex gap are fixed, and #mc-buttons is
// capped at rows*70-6. The bubble row adds 22px plus the 6px flex gap. With
// four answer buttons both locales use the same geometry, so the budget only
// depends on the viewport.
const INPUT_PADDING = 16;
const FLEX_GAP = 6;
const BUBBLE_ROW = 22;

function answerButtonHeight({ width, height }) {
  const layout = calculateSceneLayout(width, height, 4, false);
  const inputZone = height - layout.sceneHeight - FLEX_GAP;
  const available = inputZone - INPUT_PADDING - FLEX_GAP - BUBBLE_ROW;
  const grid = Math.min(available, layout.rows * 70 - 6);
  return (grid - (layout.rows - 1) * FLEX_GAP) / layout.rows;
}

test('all four answer buttons keep 44px touch targets at 320px portrait', () => {
  for (const viewport of [
    { width: 320, height: 568 },
    { width: 320, height: 480 },
  ]) {
    const layout = calculateSceneLayout(viewport.width, viewport.height, 4, false);
    assert.equal(layout.columns * layout.rows, 4, `${viewport.width}x${viewport.height}: four buttons stay in one visible grid`);
    const buttonHeight = answerButtonHeight(viewport);
    assert.ok(buttonHeight >= 44,
      `${viewport.width}x${viewport.height}: buttons must stay >=44px with the bubble row (${buttonHeight}px)`);
  }
});
