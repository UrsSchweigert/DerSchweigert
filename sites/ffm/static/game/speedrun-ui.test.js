import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { createSpeedrunRecords } from './speedrun.js';
import { createSpeedrunUi } from './speedrun-ui.js';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');

function fakeElement(tagName) {
  const listeners = new Map();
  const node = {
    tagName: String(tagName).toUpperCase(),
    id: '', className: '', textContent: '', title: '', hidden: false, checked: false,
    style: {},
    children: [],
    append(...items) { node.children.push(...items); },
    addEventListener(type, callback) {
      listeners.set(type, [...(listeners.get(type) ?? []), callback]);
    },
    removeEventListener(type, callback) {
      listeners.set(type, (listeners.get(type) ?? []).filter(entry => entry !== callback));
    },
    dispatch(type, event = {}) {
      for (const callback of listeners.get(type) ?? []) callback({ type, target: node, ...event });
    },
    listenerCount(type) { return (listeners.get(type) ?? []).length; },
    focus() { node.focused = true; },
    // Any element that is not a tap target answers "no match".
    closest() { return null; },
  };
  return node;
}

function fakeDocument(ids) {
  const byId = new Map();
  for (const id of ids) {
    const element = fakeElement('div');
    element.id = id;
    byId.set(id, element);
  }
  // The three title-screen displays the tap detector accepts. Each answers
  // `closest()` for exactly its own selector, the way the real element would.
  const tapTarget = (tagName, className, selector) => {
    const element = fakeElement(tagName);
    element.className = className;
    element.closest = candidate => (String(candidate).split(',').map(part => part.trim()).includes(selector)
      ? element
      : null);
    return element;
  };
  const levelNumber = tapTarget('p', 'splash-subtitle', '#continue-level');
  levelNumber.id = 'continue-level';
  const numeral = tapTarget('div', 'title-level-numerals', '.title-level-numerals');
  const intro = tapTarget('p', 'splash-intro', '.splash-intro');
  // `hidden` starts unset for the elements that are only hidden by the API, to
  // prove the controller sets it rather than relying on the markup.
  // These two are toggled by the controller alone, so they start hidden only
  // because a fresh element is not hidden: the controller has to hide them.
  for (const id of ['speedrun-readout-wrap', 'speedrun-empty']) {
    if (byId.has(id)) byId.get(id).hidden = false;
  }
  if (byId.has('speedrun-overlay')) byId.get('speedrun-overlay').hidden = true;
  const listeners = new Map();
  const doc = {
    getElementById: id => byId.get(id) ?? null,
    createElement: tagName => fakeElement(tagName),
    addEventListener(type, callback) {
      listeners.set(type, [...(listeners.get(type) ?? []), callback]);
    },
    removeEventListener(type, callback) {
      listeners.set(type, (listeners.get(type) ?? []).filter(entry => entry !== callback));
    },
    dispatch(type, event = {}) {
      for (const callback of listeners.get(type) ?? []) callback({ type, ...event });
    },
    listenerCount(type) { return (listeners.get(type) ?? []).length; },
  };
  return { byId, doc, intro, levelNumber, numeral };
}

function storage() {
  const map = new Map();
  return {
    getItem: key => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, String(value)); },
  };
}

const UI_IDS = [
  'speedrun-overlay', 'speedrun-toggle', 'speedrun-best-run', 'speedrun-levels',
  'speedrun-empty', 'speedrun-close', 'speedrun-readout-wrap', 'speedrun-readout',
];

function setup({ translate = key => key, now } = {}) {
  const { byId, doc, intro, levelNumber, numeral } = fakeDocument(UI_IDS);
  const records = createSpeedrunRecords({ storage: storage() });
  const ui = createSpeedrunUi({ doc, translate, records, now });
  return { byId, doc, intro, levelNumber, numeral, records, ui };
}

describe('the hidden speedrun card', () => {
  it('opens after three taps, and not before', () => {
    let clock = 0;
    const { ui, byId } = setup({ now: () => clock });

    ui.registerTap();
    clock += 100;
    ui.registerTap();
    assert.equal(byId.get('speedrun-overlay').hidden, true, 'two taps change nothing');

    ui.registerTap();
    assert.equal(ui.isOpen(), true);

    ui.close();
    assert.equal(byId.get('speedrun-overlay').hidden, true);
    assert.equal(byId.get('speedrun-overlay').style.display, 'none');
  });

  // The level number is the display every phone shows; the intro sentence is
  // hidden on short and compact screens, which made the card unreachable.
  for (const [name, pick] of [
    ['the level line', harness => harness.levelNumber],
    ['the illuminated numeral', harness => harness.numeral],
    ['the intro line', harness => harness.intro],
  ]) {
    it(`opens after three taps on ${name}`, () => {
      const harness = setup();
      const element = pick(harness);
      assert.ok(element, name);
      for (let tap = 0; tap < 3; tap++) harness.doc.dispatch('click', { target: element });
      assert.equal(harness.ui.isOpen(), true);
    });
  }

  it('ignores three taps on anything else, such as a difficulty button', () => {
    const { doc, ui } = setup();
    const button = fakeElement('button');
    button.className = 'diff-btn';
    for (let tap = 0; tap < 3; tap++) doc.dispatch('click', { target: button });
    assert.equal(ui.isOpen(), false);
  });

  it('ignores taps that are spread out, so an idle page cannot open it', () => {
    let clock = 0;
    const { ui } = setup({ now: () => clock });
    for (let tap = 0; tap < 6; tap++) {
      ui.registerTap();
      clock += 800;
    }
    assert.equal(ui.isOpen(), false);
  });

  it('lists the best time per level and the best run', () => {
    const { ui, records, byId } = setup();
    records.recordLevel(1, 61_000);
    records.recordLevel(4, 5_005);
    records.recordRun(1_234_567);

    ui.open();

    assert.equal(byId.get('speedrun-best-run').textContent, 'Best run: 20:34.567');
    const rows = byId.get('speedrun-levels').children;
    assert.equal(rows.length, 2);
    assert.equal(rows[0].children[0].textContent, 'Level 1');
    assert.equal(rows[0].children[1].textContent, '1:01.000');
    assert.equal(rows[1].children[1].textContent, '0:05.005');
    assert.equal(byId.get('speedrun-empty').hidden, true);
  });

  it('says so when there is nothing to show yet', () => {
    const { ui, byId } = setup();
    ui.open();
    assert.equal(byId.get('speedrun-levels').children.length, 0);
    assert.equal(byId.get('speedrun-empty').hidden, false);
  });
});

describe('the opt-in run clock', () => {
  it('stays out of the HUD until the timer is switched on', () => {
    const { ui, byId } = setup();
    ui.updateClock({ active: true, level: 3, runMs: 45_600, levelMs: 1200 });
    assert.equal(byId.get('speedrun-readout-wrap').hidden, true, 'off by default');

    byId.get('speedrun-toggle').checked = true;
    byId.get('speedrun-toggle').dispatch('change');
    ui.updateClock({ active: true, level: 3, runMs: 45_600, levelMs: 1200 });
    assert.equal(byId.get('speedrun-readout-wrap').hidden, false);
    assert.equal(byId.get('speedrun-readout').textContent, '0:45.6');
    assert.equal(byId.get('speedrun-readout-wrap').title, 'Level 3: 0:01.2');
  });

  it('hides again when the run ends or the timer is switched off', () => {
    const { ui, byId, records } = setup();
    records.setEnabled(true);
    ui.updateClock({ active: true, level: 1, runMs: 1000, levelMs: 1000 });
    assert.equal(byId.get('speedrun-readout-wrap').hidden, false);

    ui.updateClock(null);
    assert.equal(byId.get('speedrun-readout-wrap').hidden, true);

    ui.updateClock({ active: true, level: 1, runMs: 2000, levelMs: 2000 });
    byId.get('speedrun-toggle').checked = false;
    byId.get('speedrun-toggle').dispatch('change');
    assert.equal(records.enabled, false);
    ui.updateClock({ active: true, level: 1, runMs: 3000, levelMs: 3000 });
    assert.equal(byId.get('speedrun-readout-wrap').hidden, true);
  });

  it('tells the game when the setting changed', () => {
    const { byId, doc } = fakeDocument(UI_IDS);
    const calls = [];
    const records = createSpeedrunRecords({ storage: storage() });
    createSpeedrunUi({ doc, records, onEnabledChange: enabled => calls.push(enabled) });
    const toggle = byId.get('speedrun-toggle');
    toggle.checked = true;
    toggle.dispatch('change');
    toggle.checked = false;
    toggle.dispatch('change');
    assert.deepEqual(calls, [true, false]);
  });
});

describe('the speedrun markup and styles ship together', () => {
  it('declares the readout in the HUD, hidden, and the card outside the game wrap', () => {
    assert.match(html, /<span id="speedrun-readout-wrap" hidden>/);
    const card = html.match(/<div id="speedrun-overlay"[\s\S]*?<\/div>\s*<\/div>/)?.[0];
    assert.ok(card, 'the records card exists');
    for (const id of ['speedrun-toggle', 'speedrun-best-run', 'speedrun-levels', 'speedrun-close']) {
      assert.match(card, new RegExp(`id="${id}"`), `${id} lives in the card`);
    }
    assert.equal((html.match(/id="speedrun-overlay"/g) ?? []).length, 1);
    const wrapEnd = html.indexOf('</div><!-- #game-wrap -->');
    assert.ok(wrapEnd < html.indexOf('id="speedrun-overlay"'), 'the card can cover the title screen');
  });

  it('keeps the clock width steady while it ticks', () => {
    assert.match(styles, /#speedrun-readout \{[^}]*font-variant-numeric: tabular-nums;/);
    assert.match(styles, /\.speedrun-levels li \{[^}]*justify-content: space-between;/);
    assert.match(styles, /\.speedrun-card \{[^}]*max-height:[^}]*overflow-y: auto;/);
  });
});
