// Tests for the shared portrait encounter sword row: the count it draws, the
// fill mirror and the storm's sword-removal feedback.

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_SWORDS,
  SWORD_CLASS,
  SWORD_FILLED_CLASS,
  SWORD_LOST_CLASS,
  createEncounterSwords,
  resolveSwords,
} from './encounter-swords.js';

const ORIGINAL_FX = globalThis.ffmScreenFx;

afterEach(() => {
  if (ORIGINAL_FX === undefined) delete globalThis.ffmScreenFx;
  else globalThis.ffmScreenFx = ORIGINAL_FX;
});

function fakeNode(rect) {
  const classes = new Set();
  const node = {
    id: '',
    className: '',
    hidden: false,
    children: [],
    parentNode: null,
    attributes: {},
    classList: {
      toggle(name, on) {
        if (on) classes.add(name);
        else classes.delete(name);
      },
      contains(name) {
        return classes.has(name);
      },
    },
    appendChild(child) {
      child.parentNode = node;
      node.children.push(child);
      return child;
    },
    insertBefore(child, reference) {
      child.parentNode = node;
      const index = node.children.indexOf(reference);
      if (index < 0) node.children.push(child);
      else node.children.splice(index, 0, child);
      return child;
    },
    setAttribute(name, value) {
      node.attributes[name] = String(value);
    },
    remove() {
      if (!node.parentNode) return;
      node.parentNode.children = node.parentNode.children.filter((child) => child !== node);
      node.parentNode = null;
    },
    getBoundingClientRect() {
      return rect ?? { left: 100, top: 500, width: 12, height: 20 };
    },
  };
  return node;
}

function fakeDocument({ rect } = {}) {
  const container = fakeNode(rect);
  container.id = 'input-zone';
  const anchor = fakeNode(rect);
  anchor.id = 'mc-buttons';
  const wrap = fakeNode(rect);
  wrap.id = 'game-wrap';
  const created = [];
  const doc = {
    getElementById(id) {
      if (id === 'input-zone') return container;
      if (id === 'mc-buttons') return anchor;
      if (id === 'game-wrap') return wrap;
      return null;
    },
    createElement() {
      const node = fakeNode(rect);
      created.push(node);
      return node;
    },
  };
  return { doc, container, anchor, wrap, created };
}

function recordFx() {
  const plays = [];
  globalThis.ffmScreenFx = {
    mapping: () => ({ scale: 1, offsetX: 0, offsetY: 0 }),
    play(name, payload) {
      plays.push({ name, payload });
      return true;
    },
  };
  return plays;
}

describe('resolveSwords', () => {
  it('draws one sword per enemy and fills the beaten ones', () => {
    assert.deepEqual(resolveSwords({ defeated: 2, total: 5 }), { swords: 5, filled: 2, lost: 0 });
    assert.deepEqual(resolveSwords({}), { swords: 0, filled: 0, lost: 0 });
  });

  it('keeps a slot for every enemy the level started with', () => {
    // A storm shrank the level from 6 to 4: the row still shows 6 slots, 2 empty.
    assert.deepEqual(resolveSwords({ defeated: 1, total: 4, slots: 6 }), {
      swords: 6,
      filled: 1,
      lost: 2,
    });
    // Slot counts are never below the live total, even if a caller passes both.
    assert.deepEqual(resolveSwords({ defeated: 0, total: 5, slots: 3 }), {
      swords: 5,
      filled: 0,
      lost: 0,
    });
  });

  it('never fills more swords than it draws and scales past MAX_SWORDS', () => {
    assert.deepEqual(resolveSwords({ defeated: 9, total: 3 }), { swords: 3, filled: 3, lost: 0 });
    assert.deepEqual(resolveSwords({ defeated: 0, total: MAX_SWORDS + 30 }), {
      swords: MAX_SWORDS,
      filled: 0,
      lost: 0,
    });
    // Scaled down, the emptied share stays in the row as empty slots.
    const scaled = resolveSwords({ defeated: 0, total: MAX_SWORDS + 30, slots: MAX_SWORDS * 2 });
    assert.equal(scaled.swords, MAX_SWORDS);
    assert.equal(scaled.filled, 0);
    assert.equal(scaled.lost, Math.round((MAX_SWORDS * 2 - (MAX_SWORDS + 30)) / 2));
  });
});

describe('sword row', () => {
  it('fills from the left as enemies are beaten', () => {
    const { doc, container } = fakeDocument();
    const plays = recordFx();
    const widget = createEncounterSwords({ doc });

    assert.equal(container.children.length, 1, 'the row mounts above the answers');
    widget.updateEncounterProgress({ defeated: 0, total: 4 });
    assert.equal(widget.swords.length, 4);
    assert.equal(widget.swords[0].className, SWORD_CLASS);
    assert.equal(widget.swords.some((sword) => sword.classList.contains(SWORD_FILLED_CLASS)), false);
    assert.equal(plays.length, 0, 'nothing glints before an enemy is beaten');

    widget.updateEncounterProgress({ defeated: 2, total: 4 });
    assert.deepEqual(
      widget.swords.map((sword) => sword.classList.contains(SWORD_FILLED_CLASS)),
      [true, true, false, false],
    );
    assert.equal(plays.filter((play) => play.name === 'swordGain').length, 1,
      'the sword that just filled glints');
  });

  it('empties the slots of the swords a storm takes, keeping the row in place', () => {
    const { doc } = fakeDocument();
    const plays = recordFx();
    const widget = createEncounterSwords({ doc });

    widget.updateEncounterProgress({ defeated: 1, total: 6, slots: 6 });
    const original = [...widget.swords];
    assert.equal(original.length, 6);

    widget.updateEncounterProgress({ defeated: 1, total: 4, slots: 6 });
    assert.equal(widget.swords.length, 6, 'the row keeps a slot for every enemy the level had');
    assert.deepEqual(widget.swords, original, 'the remaining swords keep their nodes and positions');
    assert.deepEqual(
      widget.swords.map((sword) => sword.classList.contains(SWORD_LOST_CLASS)),
      [false, false, false, false, true, true],
      'the two removed enemies leave empty slots on the right',
    );
    assert.deepEqual(
      widget.swords.map((sword) => sword.classList.contains(SWORD_FILLED_CLASS)),
      [true, false, false, false, false, false],
      'the beaten sword keeps its fill; removals come off the empty end',
    );
    assert.equal(plays.filter((play) => play.name === 'swordGain').length, 0,
      'a removal never glints like an earned sword');
  });

  it('keeps emptied slots empty when a later storm takes more swords', () => {
    const { doc } = fakeDocument();
    const widget = createEncounterSwords({ doc });
    widget.updateEncounterProgress({ defeated: 0, total: 6, slots: 6 });
    widget.updateEncounterProgress({ defeated: 0, total: 4, slots: 6 });

    widget.updateEncounterProgress({ defeated: 0, total: 2, slots: 6 });
    assert.deepEqual(
      widget.swords.map((sword) => sword.classList.contains(SWORD_LOST_CLASS)),
      [false, false, true, true, true, true],
    );
  });

  it('shatters the departing swords at their own positions', () => {
    const { doc } = fakeDocument();
    const plays = recordFx();
    const widget = createEncounterSwords({ doc });
    widget.updateEncounterProgress({ defeated: 0, total: 5 });

    assert.equal(widget.shatter(2), 2);
    const lost = plays.filter((play) => play.name === 'swordLost');
    assert.equal(lost.length, 2);
    // Row rects are 12x20 at (100,500); with a 1:1 mapping the effect lands in
    // the middle of the sword, the same conversion the glint uses.
    assert.deepEqual(lost[0].payload, { x: 106, y: 510 });
  });

  it('shatters only the swords that still stand after an earlier storm', () => {
    const { doc } = fakeDocument();
    const plays = recordFx();
    const widget = createEncounterSwords({ doc });
    widget.updateEncounterProgress({ defeated: 0, total: 6, slots: 6 });
    widget.updateEncounterProgress({ defeated: 0, total: 4, slots: 6 });
    // Two slots are already empty, so at most four swords can break this time.
    assert.equal(widget.shatter(9), 4);
    assert.equal(plays.filter((play) => play.name === 'swordLost').length, 4);
  });

  it('shatters no more swords than the row holds and stays silent when hidden', () => {
    const { doc } = fakeDocument();
    const plays = recordFx();
    const widget = createEncounterSwords({ doc });
    widget.updateEncounterProgress({ defeated: 0, total: 3 });

    assert.equal(widget.shatter(9), 3, 'the count is capped at the row length');
    assert.equal(widget.shatter(0), 0);
    assert.equal(plays.filter((play) => play.name === 'swordLost').length, 3);

    // Landscape keeps the row display:none, so every sword reports a 0x0 rect.
    const hidden = fakeDocument({ rect: { left: 0, top: 0, width: 0, height: 0 } });
    const silent = recordFx();
    const hiddenWidget = createEncounterSwords({ doc: hidden.doc });
    hiddenWidget.updateEncounterProgress({ defeated: 0, total: 3 });
    assert.equal(hiddenWidget.shatter(2), 2);
    assert.equal(silent.length, 0, 'a hidden row fires no effect');
  });

  it('mirrors the row in a landscape column that is a direct child of #game-wrap', () => {
    const { doc, wrap } = fakeDocument();
    const widget = createEncounterSwords({ doc });
    const column = widget.column;
    assert.equal(column.className, 'app-encounter-swords-column');
    assert.equal(column.attributes['aria-hidden'], 'true');
    assert.equal(column.parentNode, wrap);
    assert.equal(column.hidden, true);

    widget.updateEncounterProgress({ defeated: 2, total: 4, slots: 6 });
    assert.equal(column.hidden, false);
    assert.equal(widget.columnSwords.length, 6);
    const state = (list) => list.map((sword) => [
      sword.classList.contains(SWORD_FILLED_CLASS), sword.classList.contains(SWORD_LOST_CLASS)]);
    assert.deepEqual(state(widget.columnSwords), state(widget.swords));
    widget.updateEncounterProgress({ defeated: 3, total: 3, slots: 6 });
    assert.deepEqual(state(widget.columnSwords), state(widget.swords));
    widget.updateEncounterProgress({ defeated: 0, total: 0 });
    assert.equal(column.hidden, true);
    assert.equal(widget.columnSwords.length, 0);
  });

  it('plays effects at the laid-out container and destroys both', () => {
    const { doc, wrap } = fakeDocument();
    const plays = recordFx();
    const widget = createEncounterSwords({ doc });
    widget.updateEncounterProgress({ defeated: 0, total: 3 });
    // Landscape: the row reports 0x0, the column is laid out.
    const zero = { left: 0, top: 0, width: 0, height: 0 };
    widget.swords.forEach((sword) => { sword.getBoundingClientRect = () => zero; });
    widget.columnSwords.forEach((sword, i) => {
      sword.getBoundingClientRect = () => ({ left: 4, top: 10 * i, width: 12, height: 8 });
    });
    widget.updateEncounterProgress({ defeated: 1, total: 3 });
    assert.deepEqual(plays.at(-1), { name: 'swordGain', payload: { x: 10, y: 4 } });
    widget.shatter(1);
    assert.deepEqual(plays.at(-1), { name: 'swordLost', payload: { x: 10, y: 24 } });

    widget.destroy();
    assert.equal(wrap.children.length, 0);
    assert.equal(widget.column, null);
    assert.equal(widget.columnSwords.length, 0);
  });
});
