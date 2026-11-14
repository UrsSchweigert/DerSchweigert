import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { DRAGON_FRAMES, DRAGON_ROWS, DRAGON_TIMING, buildWardenRows, dragonFramePosition, initWardenMode, ruleText, wardensEnabled } from './boss-run.js';
import { generateSequenceProblem } from './boss-problems.js';

const BAND = { level: 10, operations: ['+', '-'], operandRange: { a: [2, 12], b: [1, 7] }, maxResult: 19 };

describe('buildWardenRows', () => {
  it('lists every Warden, locked until its act is cleared', () => {
    const rows = buildWardenRows({ clearedLevels: [], results: {} });
    assert.equal(rows.length, 7, 'six Wardens plus the Hollow King');
    assert.deepEqual(rows.map(row => row.unlocked), [false, false, false, false, false, false, false]);
    assert.deepEqual(rows.map(row => row.act), [1, 2, 3, 4, 5, 6, 6]);
  });

  it('opens act I once its ten levels are cleared, and later acts after their gatekeeper', () => {
    const quarter = buildWardenRows({
      clearedLevels: Array.from({ length: 10 }, (_, index) => index + 1),
      results: {},
    });
    assert.equal(quarter[0].unlocked, true);
    assert.equal(quarter[1].unlocked, false, 'act II still waits for the dawn Warden');

    const afterDawn = buildWardenRows({
      clearedLevels: Array.from({ length: 20 }, (_, index) => index + 1),
      results: { 'warden-dawn': { cleared: true, crowns: 3 } },
    });
    assert.equal(afterDawn[1].unlocked, true);
    assert.equal(afterDawn[0].cleared, true);
    assert.equal(afterDawn[0].crowns, 3);
    assert.equal(afterDawn[2].unlocked, false);
  });

  it('keeps a defeated Warden playable and the Hollow King last', () => {
    const allWardens = ['warden-dawn', 'warden-harvest', 'warden-memory', 'warden-keep', 'warden-market', 'warden-throne'];
    const results = Object.fromEntries(allWardens.map(id => [id, { cleared: true, crowns: 2 }]));
    const rows = buildWardenRows({
      clearedLevels: Array.from({ length: 60 }, (_, index) => index + 1),
      results,
    });
    assert.deepEqual(rows.map(row => row.unlocked), [true, true, true, true, true, true, true]);
    assert.equal(rows.at(-1).bossId, 'hollow-king');
    assert.equal(rows.filter(row => row.cleared).length, 6, 'the Hollow King is not won yet');
  });
});

describe('ruleText', () => {
  it('names every rule in words, with its own numbers', () => {
    for (const ruleId of ['ascending', 'descending', 'pairSum', 'factorChain', 'oddOneOut', 'equalShare', 'composeTarget']) {
      const lock = generateSequenceProblem({
        ruleId,
        band: ruleId === 'factorChain' ? { ...BAND, operandRange: { a: [1, 12], b: [1, 7] } } : BAND,
        seed: 3,
      });
      const text = ruleText(lock);
      assert.ok(text.length > 10, `${ruleId} has no rule text`);
      assert.ok(!text.includes('boss.rule.'), `${ruleId} is missing its translation`);
    }
  });

  it('fills the target, factor and pile into the sentence', () => {
    const pair = generateSequenceProblem({ ruleId: 'pairSum', band: BAND, seed: 1 });
    assert.ok(ruleText(pair).includes(String(pair.params.target)));
    const chain = generateSequenceProblem({ ruleId: 'factorChain', band: BAND, seed: 1 });
    assert.ok(ruleText(chain).includes(String(chain.params.factor)));
    const share = generateSequenceProblem({ ruleId: 'equalShare', band: BAND, seed: 1 });
    assert.ok(ruleText(share).includes(String(share.params.pile)));
  });
});

describe('dragon animation', () => {
  it('maps each state to its sheet row and each frame to a third of the cell', () => {
    assert.deepEqual(DRAGON_ROWS, { idle: 0, hit: 1, breath: 2 });
    assert.equal(DRAGON_FRAMES, 3);
    assert.equal(dragonFramePosition('idle', 0), '0% 0%');
    assert.equal(dragonFramePosition('idle', 1), '50% 0%');
    assert.equal(dragonFramePosition('idle', 2), '100% 0%');
    assert.equal(dragonFramePosition('hit', 0), '0% 50%');
    assert.equal(dragonFramePosition('breath', 2), '100% 100%');
  });

  it('rejects an unknown state or a frame outside the sheet', () => {
    assert.throws(() => dragonFramePosition('roar', 0), TypeError);
    assert.throws(() => dragonFramePosition('idle', 3), RangeError);
    assert.throws(() => dragonFramePosition('idle', -1), RangeError);
    assert.throws(() => dragonFramePosition('idle', 1.5), RangeError);
  });

  it('gives hit and breath their own timing, faster than the idle loop', () => {
    assert.ok(DRAGON_TIMING.idle > DRAGON_TIMING.hit);
    assert.ok(DRAGON_TIMING.idle > DRAGON_TIMING.breath);
    assert.ok(DRAGON_TIMING.hit > 60 && DRAGON_TIMING.breath > 60, 'slow enough to read');
  });
});

describe('release switch', () => {
  it('keeps Warden fights shut for players', () => {
    assert.equal(wardensEnabled(), false);
    assert.equal(wardensEnabled({ search: '' }), false);
    assert.equal(wardensEnabled({ search: '?level=3' }), false);
    assert.equal(wardensEnabled({ search: '?wardens=0' }), false);
  });

  it('opens them for a reviewer or the dev harness', () => {
    assert.equal(wardensEnabled({ search: '?wardens=1' }), true);
    assert.equal(wardensEnabled({ search: '?a=1&wardens=1' }), true);
    assert.equal(wardensEnabled({ force: true }), true);
  });

  it('mounts nothing at all while the switch is off', () => {
    const doc = {
      querySelector: () => null,
      body: { appendChild: () => assert.fail('must not mount an overlay') },
      getElementById: () => null,
      createElement: () => assert.fail('must not build the overlay'),
      addEventListener: () => {},
    };
    assert.equal(initWardenMode({ platform: {}, doc, search: '' }), null);
  });
});

// --- fight clock ownership -------------------------------------------------
//
// The Warden clock is a 1 Hz interval owned by the fight that is on screen.
// "Fight again" re-enters openFight() while the finished fight's interval is
// still running, so the old clock has to be released before the new one starts:
// an orphaned interval can never be cleared again and keeps ticking the new
// attempt, draining the clock once per abandoned fight.

function stubElement(id = '') {
  const listeners = new Map();
  const element = {
    id,
    type: '',
    className: '',
    hidden: false,
    disabled: false,
    textContent: '',
    innerHTML: '',
    dataset: {},
    children: [],
    style: { setProperty() {}, removeProperty() {} },
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    append(...nodes) { element.children.push(...nodes); },
    appendChild(node) { element.children.push(node); return node; },
    insertBefore(node) { element.children.unshift(node); return node; },
    setAttribute() {},
    getAttribute: () => null,
    removeAttribute() {},
    addEventListener(type, fn) { listeners.set(type, fn); },
    removeEventListener() {},
    querySelector: () => stubElement(),
    querySelectorAll: () => [],
    focus() {},
  };
  return element;
}

// Records every interval the fight starts, without scheduling anything.
function patchIntervals() {
  const realSetInterval = globalThis.setInterval;
  const realClearInterval = globalThis.clearInterval;
  const live = new Map();
  let created = 0;
  globalThis.setInterval = (fn) => {
    created += 1;
    live.set(created, fn);
    return created;
  };
  globalThis.clearInterval = (id) => { live.delete(id); };
  return {
    get created() { return created; },
    get live() { return live.size; },
    restore() {
      globalThis.setInterval = realSetInterval;
      globalThis.clearInterval = realClearInterval;
    },
  };
}

function fightHarness({ band = BAND, pending = null } = {}) {
  const byId = new Map();
  const doc = {
    body: stubElement('body'),
    querySelector: () => null,
    createElement: () => stubElement(),
    getElementById: (id) => {
      if (!byId.has(id)) byId.set(id, stubElement(id));
      return byId.get(id);
    },
    addEventListener() {},
    removeEventListener() {},
  };
  const platform = {
    getAuthorizedLevelConfig: () => (pending ?? Promise.resolve(band)),
  };
  const mode = initWardenMode({
    platform,
    getClearedLevels: () => [],
    getDifficulty: () => 'medium',
    storage: null,
    force: true,
    doc,
  });
  return { mode, doc };
}

describe('Warden fight clock', () => {
  it('releases the previous clock when a fight is opened again from its result screen', async () => {
    const timers = patchIntervals();
    const realMatchMedia = globalThis.matchMedia;
    // Reduced motion keeps the dragon on setTimeout instead of an interval, so
    // every interval counted here is a Warden clock.
    globalThis.matchMedia = () => ({ matches: true });
    try {
      const { mode } = fightHarness();
      await mode.open('warden-dawn');
      assert.equal(timers.live, 1, 'one clock per fight');
      await mode.open('warden-dawn');
      assert.equal(timers.created, 2);
      assert.equal(timers.live, 1, 'the retry replaced the clock instead of orphaning it');
      mode.close();
      assert.equal(timers.live, 0, 'closing the overlay stops the clock');
    } finally {
      timers.restore();
      if (realMatchMedia === undefined) delete globalThis.matchMedia;
      else globalThis.matchMedia = realMatchMedia;
    }
  });

  it('lets only the newest open win when two fights are started at once', async () => {
    const timers = patchIntervals();
    const realMatchMedia = globalThis.matchMedia;
    globalThis.matchMedia = () => ({ matches: true });
    let release = () => {};
    const gate = new Promise((resolve) => { release = resolve; });
    try {
      const band = Promise.resolve(BAND).then(() => gate).then(() => BAND);
      const { mode } = fightHarness({ pending: band });
      const first = mode.open('warden-dawn');
      const second = mode.open('warden-dawn');
      release();
      await Promise.all([first, second]);
      assert.equal(timers.live, 1, 'the slower open must not install a second clock');
    } finally {
      timers.restore();
      if (realMatchMedia === undefined) delete globalThis.matchMedia;
      else globalThis.matchMedia = realMatchMedia;
    }
  });
});
