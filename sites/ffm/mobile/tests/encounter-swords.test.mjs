// encounter-swords.test.mjs — the app-only portrait encounter sword row.
//
// encounter-swords.js ships through the overlay as www/game/encounter-swords.js
// and is imported by main.js only behind platform.isApp. These tests pin the
// sword count (one per enemy, bounded), the left-to-right green fill, the row
// placement directly above the answer buttons, teardown, the wiring through
// the shared mobile-ui hook, the portrait-only CSS, and the 320px portrait
// touch-target budget.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MAX_SWORDS,
  SWORD_CLASS,
  SWORD_FILLED_CLASS,
  SWORDS_CLASS,
  createEncounterSwords,
  resolveSwords,
} from '../game/encounter-swords.js';
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

const filledIndexes = (widget) => widget.swords
  .map((sword, index) => (sword.classList.contains(SWORD_FILLED_CLASS) ? index : -1))
  .filter((index) => index >= 0);

test('one sword per enemy, filled by the defeated count', () => {
  assert.equal(MAX_SWORDS, 30, 'a campaign level has 30 enemies');
  assert.deepEqual(resolveSwords({ defeated: 0, total: 30 }), { swords: 30, filled: 0 });
  assert.deepEqual(resolveSwords({ defeated: 7, total: 30 }), { swords: 30, filled: 7 });
  assert.deepEqual(resolveSwords({ defeated: 30, total: 30 }), { swords: 30, filled: 30 });
  assert.deepEqual(resolveSwords({ defeated: 3, total: 5 }), { swords: 5, filled: 3 }, 'targeted practice');
  assert.deepEqual(resolveSwords({ defeated: 40, total: 10 }), { swords: 10, filled: 10 }, 'never overfills');
  assert.deepEqual(resolveSwords({ defeated: -2, total: 10 }), { swords: 10, filled: 0 });
  assert.deepEqual(resolveSwords({ defeated: 1, total: 0 }), { swords: 0, filled: 0 }, 'no total, no row');
  assert.deepEqual(resolveSwords({ defeated: 'x', total: Number.NaN }), { swords: 0, filled: 0 });
  assert.deepEqual(resolveSwords(), { swords: 0, filled: 0 });
  assert.deepEqual(resolveSwords({ defeated: 30, total: 60 }), { swords: MAX_SWORDS, filled: 15 },
    'larger totals scale onto the bounded sword budget');
  assert.deepEqual(resolveSwords({ defeated: 60, total: 60 }), { swords: MAX_SWORDS, filled: MAX_SWORDS });
});

test('the row sits above the answer buttons and fills left to right', () => {
  const { container, anchor, doc } = fakeDocument();
  const widget = createEncounterSwords({ doc });

  assert.equal(container.children.length, 2, 'one row is added beside the answer buttons');
  assert.equal(container.children[1], anchor, 'the answer buttons keep their place');
  const element = container.children[0];
  assert.equal(element, widget.element);
  assert.equal(element.className, SWORDS_CLASS);
  assert.equal(element.getAttribute('aria-hidden'), 'true', 'the header readout stays the accessible count');
  assert.equal(element.hidden, true, 'nothing is drawn before a count arrives');
  assert.equal(element.children.length, 0);

  widget.updateEncounterProgress({ defeated: 0, total: 30 });
  assert.equal(element.hidden, false);
  assert.equal(element.children.length, 30, 'one sword per enemy in the level');
  assert.ok(element.children.every((sword) => sword.className.split(' ')[0] === SWORD_CLASS));
  assert.deepEqual(filledIndexes(widget), []);

  widget.updateEncounterProgress({ defeated: 3, total: 30 });
  assert.deepEqual(filledIndexes(widget), [0, 1, 2], 'beaten enemies fill from the left');
  widget.updateEncounterProgress({ defeated: 30, total: 30 });
  assert.equal(filledIndexes(widget).length, 30, 'the dragon finish fills every sword');

  widget.updateEncounterProgress({ defeated: 1, total: 5 });
  assert.equal(element.children.length, 5, 'a shorter run resizes the row');
  assert.deepEqual(filledIndexes(widget), [0]);

  widget.updateEncounterProgress({ defeated: 0, total: 0 });
  assert.equal(element.hidden, true, 'endless modes hide the row');
  assert.equal(element.children.length, 0);
});

test('the widget tears down on quit and is a no-op without its anchor', () => {
  const { container, doc } = fakeDocument();
  const widget = createEncounterSwords({ doc });
  const element = widget.element;
  widget.updateEncounterProgress({ defeated: 2, total: 10 });
  widget.destroy();
  assert.equal(element.removed, true, 'the row leaves the document');
  assert.equal(widget.element, null);
  assert.equal(widget.updateEncounterProgress({ defeated: 3, total: 10 }), null, 'later updates are no-ops');
  assert.equal(container.children.length, 1, 'only the answer buttons remain');

  const orphan = createEncounterSwords({
    doc: { getElementById: (id) => (id === 'input-zone' ? makeElement('div') : null), createElement: makeElement },
  });
  assert.equal(orphan.element, null);
  assert.equal(orphan.updateEncounterProgress({ defeated: 1, total: 2 }), null);
  orphan.destroy();
});

test('main.js feeds the swords the same count as the Defeated readout', async () => {
  const source = await readFile(join(staticDir, 'game', 'main.js'), 'utf8');

  assert.match(source, /mobileUi\?\.registerWidget\('encounter-swords', createEncounterSwords\(\{ doc: document \}\)\)/);
  assert.equal((source.match(/import\('\.\/encounter-swords\.js'\)/g) ?? []).length, 1);
  const appStart = source.indexOf('if (platform.isApp) {');
  const appEnd = source.indexOf('\n}\n', appStart);
  assert.ok(source.slice(appStart, appEnd).includes("import('./encounter-swords.js')"),
    'the app branch imports the swords dynamically');
  assert.ok(!source.slice(0, appStart).includes('encounter-swords'),
    'no module code references the swords before the app guard');
  assert.equal((source.match(/mobileUi\?\.updateEncounterProgress\(/g) ?? []).length, 1,
    'the count is published once per frame');
  assert.match(source, /t\('gameplay\.encounters', encounterProgress\)/,
    'the readout and the swords share one encounterProgress value');
  assert.doesNotMatch(source, /bubble-timer|createBubbleTimer/);

  const module = await readFile(join(root, 'game', 'encounter-swords.js'), 'utf8');
  for (const forbidden of ['setInterval', 'setTimeout', 'requestAnimationFrame', 'Date.now', 'performance.now']) {
    assert.ok(!module.includes(forbidden), `the widget must not own a clock (${forbidden})`);
  }
});

test('the module ships only through the app overlay, never the web build', async () => {
  await assert.rejects(
    stat(join(staticDir, 'game', 'encounter-swords.js')),
    { code: 'ENOENT' },
    'the module must not exist in the web deploy',
  );
  await assert.rejects(stat(join(root, 'game', 'bubble-timer.js')), { code: 'ENOENT' },
    'the old bubble timer is gone');
  const index = await readFile(join(staticDir, 'index.html'), 'utf8');
  const webCss = await readFile(join(staticDir, 'styles.css'), 'utf8');
  assert.doesNotMatch(index, /encounter-swords|app-encounter-sword/, 'the web page carries no sword markup');
  assert.doesNotMatch(webCss, /app-encounter-sword/, 'the web stylesheet carries no sword rules');
});

test('the overlay stylesheet draws portrait-only green swords', async () => {
  const css = await readFile(join(root, 'game', 'mobile-ui.css'), 'utf8');

  assert.match(css, /\.app-encounter-swords\s*\{[^}]*display:\s*none/,
    'the row is hidden by default, so landscape and the web build never show it');
  assert.match(css, /#game-wrap\[data-layout="portrait"\]\s*\.app-encounter-swords\s*\{[^}]*display:\s*flex/,
    'only the portrait layout shows the row');
  assert.match(css, /#game-wrap\[data-layout="portrait"\]\s*\.app-encounter-swords\[hidden\]\s*\{[^}]*display:\s*none/,
    'a hidden row stays hidden in portrait');
  assert.match(css, /\.app-encounter-swords\s*\{[^}]*flex:\s*0 0 100%/);
  assert.match(css, /\.app-encounter-swords\s*\{[^}]*height:\s*22px/);
  assert.match(css, /\.app-encounter-swords\s*\{[^}]*pointer-events:\s*none/);
  assert.match(css, /\.app-encounter-sword::before\s*\{[^}]*clip-path:\s*polygon\(/, 'each sword is a silhouette');
  assert.match(css, /\.app-encounter-sword--filled::before\s*\{[^}]*#5fd068/, 'beaten enemies fill green');
  assert.doesNotMatch(css, /app-answer-bubble-timer|ffm-bubble-pulse/, 'no bubble rules remain');

  const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)', css.indexOf('.app-encounter-swords')));
  assert.match(reduced, /\.app-encounter-sword--filled\s*\{[^}]*animation:\s*none/);
  assert.doesNotMatch(css, /https?:\/\//, 'the overlay stylesheet must stay offline');
});

test('the app header gives the question its own unbroken first line', async () => {
  const css = await readFile(join(root, 'game', 'mobile-ui.css'), 'utf8');
  assert.match(css, /#gameplay-chrome #active-question \{ grid-column: 1 \/ -1; grid-row: 1; white-space: nowrap; \}/);
  assert.match(css, /#gameplay-chrome \.gameplay-readouts \{ grid-column: 1; grid-row: 3; \}/,
    'the readouts can no longer auto-place into an auto-width column beside the question');
  assert.match(css, /#gameplay-chrome #btn-pause-game \{ grid-column: 3; grid-row: 3; \}/);
});

// --- 320px portrait touch-target budget --------------------------------
// Mirrors the vertical stacking in static/styles.css: #input-zone is the
// answer grid row, its padding and flex gap are fixed, and #mc-buttons is
// capped at rows*70-6. The sword row adds 22px plus the 6px flex gap. With
// four answer buttons both locales use the same geometry, so the budget only
// depends on the viewport.
const INPUT_PADDING = 16;
const FLEX_GAP = 6;
const SWORD_ROW = 22;

function answerButtonHeight({ width, height }) {
  const layout = calculateSceneLayout(width, height, 4, false);
  const inputZone = height - layout.sceneHeight - FLEX_GAP;
  const available = inputZone - INPUT_PADDING - FLEX_GAP - SWORD_ROW;
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
      `${viewport.width}x${viewport.height}: buttons must stay >=44px with the sword row (${buttonHeight}px)`);
  }
});
