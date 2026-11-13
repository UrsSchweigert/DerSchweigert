// Tests for the shared portrait encounter sword row: the count it draws, the
// fill mirror and the storm's sword-removal feedback.

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_SWORDS,
  SWORD_CLASS,
  SWORD_FILLED_CLASS,
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
  const created = [];
  const doc = {
    getElementById(id) {
      if (id === 'input-zone') return container;
      if (id === 'mc-buttons') return anchor;
      return null;
    },
    createElement() {
      const node = fakeNode(rect);
      created.push(node);
      return node;
    },
  };
  return { doc, container, anchor, created };
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
    assert.deepEqual(resolveSwords({ defeated: 2, total: 5 }), { swords: 5, filled: 2 });
    assert.deepEqual(resolveSwords({}), { swords: 0, filled: 0 });
  });

  it('never fills more swords than it draws and scales past MAX_SWORDS', () => {
    assert.deepEqual(resolveSwords({ defeated: 9, total: 3 }), { swords: 3, filled: 3 });
    assert.deepEqual(resolveSwords({ defeated: 0, total: MAX_SWORDS + 30 }), {
      swords: MAX_SWORDS,
      filled: 0,
    });
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

  it('takes swords off the row when a storm shrinks the level', () => {
    const { doc } = fakeDocument();
    const plays = recordFx();
    const widget = createEncounterSwords({ doc });

    widget.updateEncounterProgress({ defeated: 1, total: 6 });
    const original = [...widget.swords];
    assert.equal(original.length, 6);

    widget.updateEncounterProgress({ defeated: 1, total: 4 });
    assert.equal(widget.swords.length, 4, 'the two removed enemies lost their swords');
    assert.equal(original[4].parentNode, null, 'the fifth sword left the DOM');
    assert.equal(original[5].parentNode, null, 'the sixth sword left the DOM');
    assert.equal(
      widget.swords.map((sword) => sword.classList.contains(SWORD_FILLED_CLASS)).filter(Boolean).length,
      1,
      'the beaten sword keeps its fill; removals come off the empty end',
    );
    assert.equal(plays.filter((play) => play.name === 'swordGain').length, 0,
      'a removal never glints like an earned sword');
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
});
