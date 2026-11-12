// Bonus-aware ability-bar readouts (requirement 2.3).
//
// The second line of each slot spells out what the level's earned bonus
// changed: the remaining cooldown in whole seconds (or "Ready"), the storm's
// removal count and the earth slow strength with its remaining targets. The
// expectations below are pinned at level 1, a mid-chapter level (7), the level
// that unlocks earth (12) and level 60, where every documented cap is reached.

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  ABILITY_READOUT_CLASS,
  createAbilityBar,
  deriveAbilityReadouts,
} from './ability-bar.js';
import { BONUS_CAPS, applyBonus, bonusForLevel, createBonusRuntime } from './bonus-ladder.js';
import { SPIKE_SLOW_DEFAULTS, createAbilityRuntime } from './cooldown-abilities.js';
import { _resetForTests, setLocale, t } from './i18n.js';

afterEach(() => {
  _resetForTests();
});

// Minimal stand-in for the DOM surface the bar touches; the same shape the
// ability-bar suite uses.
function fakeElement(tagName) {
  const attributes = {};
  const styleValues = new Map();
  const node = {
    tagName: String(tagName).toUpperCase(),
    id: '',
    className: '',
    type: '',
    title: '',
    textContent: '',
    disabled: false,
    tabIndex: -1,
    dataset: {},
    children: [],
    parentNode: null,
    style: {
      setProperty(name, value) { styleValues.set(name, String(value)); },
      getPropertyValue(name) { return styleValues.get(name) ?? ''; },
    },
    appendChild(child) {
      child.parentNode = node;
      node.children.push(child);
      return child;
    },
    setAttribute(name, value) { attributes[name] = String(value); },
    getAttribute(name) { return Object.hasOwn(attributes, name) ? attributes[name] : null; },
    removeAttribute(name) { delete attributes[name]; },
    addEventListener() {},
    removeEventListener() {},
    remove() {},
  };
  return node;
}

function mount({ translate } = {}) {
  const chrome = fakeElement('section');
  chrome.id = 'gameplay-chrome';
  const doc = {
    getElementById(id) { return id === 'gameplay-chrome' ? chrome : null; },
    createElement(tagName) { return fakeElement(tagName); },
  };
  return createAbilityBar({ doc, translate });
}

const slotOf = (bar, id) => bar.element.children.find((slot) => slot.dataset.ability === id);
const childByClass = (slot, className) => slot.children.find((child) => child.className === className);
const cooldownOf = (bar, id) => childByClass(slotOf(bar, id), 'ability-slot-cooldown').textContent;
const readoutOf = (bar, id) => childByClass(slotOf(bar, id), ABILITY_READOUT_CLASS).textContent;

// The replay main.js runs at every level start: the earned bonus totals plus
// the per-ability cooldown reduction each cooldown bonus named.
function ladderForLevel(level) {
  let bonus = createBonusRuntime({ level });
  const cooldowns = { wind: 0, storm: 0, earth: 0 };
  let total = 0;
  for (let current = 2; current <= level; current += 1) {
    const entry = bonusForLevel(current);
    if (!entry) continue;
    bonus = applyBonus(bonus, entry);
    if (entry.type !== 'cooldown') continue;
    const room = Math.min(entry.value, BONUS_CAPS.cooldownSeconds - total);
    if (room <= 0) continue;
    total += room;
    cooldowns[entry.abilityId] += room;
  }
  return { bonus, cooldowns };
}

// Ability runtime carrying the same bonuses, so the storm rank and the spike
// parameters come from the model rather than from the test.
function abilityRuntimeFor(level) {
  const { bonus } = ladderForLevel(level);
  return createAbilityRuntime({
    level,
    rank: bonus.stormRank,
    slowBonuses: bonus.slowBonuses,
    spikeSlow: { targets: SPIKE_SLOW_DEFAULTS.targets + bonus.spikeTargets },
  });
}

function render(bar, level, progress = 1, extra = {}) {
  const { bonus, cooldowns } = ladderForLevel(level);
  bar.update({ level, progress, runtime: abilityRuntimeFor(level), bonus, cooldowns, ...extra });
  return { bonus, cooldowns };
}

describe('bonus readouts per level', () => {
  it('level 1 has no bonus: wind reads Ready and the locked slots stay blank', () => {
    const bar = mount({ translate: t });
    setLocale('en');
    render(bar, 1);

    assert.equal(cooldownOf(bar, 'wind'), 'Ready');
    assert.equal(readoutOf(bar, 'wind'), '');
    assert.equal(slotOf(bar, 'storm').dataset.state, 'locked');
    assert.equal(readoutOf(bar, 'storm'), '');
    assert.equal(slotOf(bar, 'earth').dataset.state, 'locked');
    assert.equal(readoutOf(bar, 'earth'), '');
  });

  it('level 7 spells out the storm rank earned at level 7', () => {
    const bar = mount({ translate: t });
    setLocale('en');
    const { bonus } = render(bar, 7);

    assert.equal(bonus.stormRank, 1);
    assert.equal(slotOf(bar, 'storm').dataset.state, 'ready');
    assert.equal(readoutOf(bar, 'storm'), 'Removes 2');
    assert.equal(readoutOf(bar, 'earth'), '');
  });

  it('level 12 shows the storm rank and the first earth slow bonus', () => {
    const bar = mount({ translate: t });
    setLocale('en');
    const { bonus } = render(bar, 12);

    assert.equal(bonus.stormRank, 2);
    assert.equal(bonus.slowBonuses, 1);
    assert.equal(readoutOf(bar, 'storm'), 'Removes 3');
    // 8 s slow at factor 0.65 is a 35 % slow; one 0.05 speed bonus adds 5 %.
    assert.equal(readoutOf(bar, 'earth'), 'Slow 40% · ×1');
  });

  it('level 60 shows every capped bonus', () => {
    const bar = mount({ translate: t });
    setLocale('en');
    const { bonus } = render(bar, 60);

    assert.deepEqual(
      {
        stormRank: bonus.stormRank,
        slowBonuses: bonus.slowBonuses,
        spikeTargets: bonus.spikeTargets,
      },
      { stormRank: 5, slowBonuses: 6, spikeTargets: 5 },
    );
    assert.equal(readoutOf(bar, 'storm'), 'Removes 6');
    // 35 % spike slow plus the 30 % passive floor (FIEND_SPEED_FLOOR).
    assert.equal(readoutOf(bar, 'earth'), 'Slow 65% · ×5');
  });
});

describe('cooldown readout', () => {
  it('counts down against the base cooldown when no bonus was earned', () => {
    const bar = mount({ translate: t });
    setLocale('en');
    render(bar, 1, 0.5);

    assert.equal(cooldownOf(bar, 'wind'), '90');
  });

  it('shortens each slot by the cooldown bonus that named it', () => {
    const bar = mount({ translate: t });
    setLocale('en');
    const { cooldowns } = render(bar, 60, 0.5);

    assert.deepEqual(cooldowns, { wind: 48, storm: 24, earth: 18 });
    // 180 s base minus the ability's own reduction, halved by progress 0.5.
    assert.equal(cooldownOf(bar, 'wind'), '66');
    assert.equal(cooldownOf(bar, 'storm'), '78');
    assert.equal(cooldownOf(bar, 'earth'), '81');

    render(bar, 60, 1);
    assert.equal(cooldownOf(bar, 'wind'), 'Ready');
    assert.equal(cooldownOf(bar, 'storm'), 'Ready');
    assert.equal(cooldownOf(bar, 'earth'), 'Ready');
  });

  it('never shortens a cooldown below the documented cap', () => {
    const bar = mount({ translate: t });
    setLocale('en');
    bar.update({ level: 60, progress: 0.5, cooldowns: { wind: 500, storm: -20, earth: 90 } });

    // 180 s - 90 s = 90 s is the floor; a negative reduction changes nothing.
    assert.equal(cooldownOf(bar, 'wind'), '45');
    assert.equal(cooldownOf(bar, 'storm'), '90');
    assert.equal(cooldownOf(bar, 'earth'), '45');
  });
});

describe('earth target readout', () => {
  it('follows the active spike and stays inside the cap', () => {
    const bar = mount({ translate: t });
    setLocale('en');
    const { bonus, cooldowns } = ladderForLevel(60);
    const runtime = abilityRuntimeFor(60);
    assert.equal(runtime.activate('earth'), true);
    assert.equal(runtime.spikeState.active, true);
    assert.equal(runtime.spikeState.targets, 5);

    const update = (spikeTargetsLeft) => bar.update({
      level: 60, progress: 1, runtime, bonus, cooldowns, spikeTargetsLeft,
    });

    update(2);
    assert.equal(readoutOf(bar, 'earth'), 'Slow 65% · ×2');
    update(99);
    assert.equal(readoutOf(bar, 'earth'), 'Slow 65% · ×5');
    update(-3);
    assert.equal(readoutOf(bar, 'earth'), 'Slow 65% · ×0');
  });

  it('keeps the earned targets when the spike is not running', () => {
    const bar = mount({ translate: t });
    setLocale('en');
    const runtime = abilityRuntimeFor(60);
    assert.equal(runtime.spikeState.active, false);
    render(bar, 60, 1, { spikeTargetsLeft: 0 });

    assert.equal(readoutOf(bar, 'earth'), 'Slow 65% · ×5');
  });
});

describe('readout robustness', () => {
  it('never renders NaN, Infinity or a negative number', () => {
    const bar = mount({ translate: t });
    setLocale('en');
    bar.update({
      level: 12,
      progress: Number.NaN,
      runtime: {
        rank: Number.NaN,
        fiendSpeedMultiplier: Number.NaN,
        spikeState: { active: true, factor: Number.NaN, targets: Number.NaN },
      },
      bonus: {
        stormRank: -4,
        slowBonuses: Number.NaN,
        spikeTargets: -2,
        cooldownReductionSeconds: Number.NaN,
      },
      cooldowns: { wind: Number.NaN, storm: Number.POSITIVE_INFINITY, earth: -5 },
      spikeTargetsLeft: Number.NaN,
    });

    for (const id of ['wind', 'storm', 'earth']) {
      for (const text of [cooldownOf(bar, id), readoutOf(bar, id)]) {
        assert.doesNotMatch(text, /NaN|Infinity|undefined|-/, `${id}: ${text}`);
      }
    }
    assert.equal(cooldownOf(bar, 'wind'), 'Ready');
    assert.equal(readoutOf(bar, 'storm'), 'Removes 1');
    assert.equal(readoutOf(bar, 'earth'), 'Slow 35% · ×1');
  });

  it('clamps synthetic bonuses that exceed every cap', () => {
    const bar = mount({ translate: t });
    setLocale('en');
    bar.update({
      level: 60,
      progress: 1,
      bonus: { stormRank: 99, slowBonuses: 99, spikeTargets: 99 },
    });

    assert.equal(readoutOf(bar, 'storm'), 'Removes 6');
    assert.equal(readoutOf(bar, 'earth'), 'Slow 65% · ×5');
  });

  it('falls back to the level-1 defaults without any model input', () => {
    const readouts = deriveAbilityReadouts();

    assert.deepEqual({ ...readouts }, {
      stormCount: 1,
      stormRank: 0,
      slowPercent: 35,
      targets: 1,
      totalTargets: 1,
    });
    assert.equal(Object.isFrozen(readouts), true);
  });
});

describe('localization', () => {
  it('renders the readouts in German', () => {
    setLocale('de');
    const bar = mount({ translate: t });
    render(bar, 60, 0.5);

    assert.equal(cooldownOf(bar, 'wind'), '66');
    assert.equal(readoutOf(bar, 'storm'), 'Entfernt 6');
    assert.equal(readoutOf(bar, 'earth'), 'Langsam 65% · ×5');

    render(bar, 60, 1);
    assert.equal(cooldownOf(bar, 'wind'), 'Bereit');
  });
});

describe('layout and purity', () => {
  it('gives every slot exactly one hidden readout line below the cooldown', () => {
    const bar = mount({ translate: t });
    setLocale('en');
    render(bar, 60);

    for (const slot of bar.element.children) {
      const readouts = slot.children.filter((child) => child.className === ABILITY_READOUT_CLASS);
      assert.equal(readouts.length, 1, `${slot.dataset.ability} has one readout`);
      assert.equal(readouts[0].getAttribute('aria-hidden'), 'true');
      assert.equal(
        slot.children.indexOf(readouts[0]),
        slot.children.findIndex((child) => child.className === 'ability-slot-cooldown') + 1,
      );
    }

    // The hidden line still reaches assistive tech through the slot's name,
    // which only changes at a level start.
    assert.equal(slotOf(bar, 'storm').getAttribute('aria-label'), 'Storm, Removes 6');
    assert.equal(slotOf(bar, 'earth').getAttribute('aria-label'), 'Earth, Slow 65% · ×5');
    assert.equal(slotOf(bar, 'wind').getAttribute('aria-label'), 'Wind');
  });

  it('derives the readouts without a clock, a timer or a random source', async () => {
    const source = await readFile(new URL('./ability-bar.js', import.meta.url), 'utf8');
    assert.doesNotMatch(source, /\bDate\b|performance\.|setInterval|setTimeout|requestAnimationFrame|Math\.random/);
  });

  it('reserves fixed-height, tabular readout lines and equal slot widths', async () => {
    const css = await readFile(new URL('../styles.css', import.meta.url), 'utf8');

    const shared = /^\.ability-slot-cooldown,\n\.ability-slot-readout \{([^}]*)\}/m.exec(css);
    assert.ok(shared, 'the cooldown and readout lines share one fixed-height rule');
    assert.match(shared[1], /overflow: hidden/);
    assert.match(shared[1], /tabular-nums/);
    assert.match(shared[1], /text-overflow: ellipsis/);

    const cooldown = /^\.ability-slot-cooldown \{([^}]*)\}/m.exec(css);
    assert.ok(cooldown);
    assert.match(cooldown[1], /height: 13px/);

    const afterShared = css.slice(css.indexOf(shared[0]) + shared[0].length);
    const readout = /^\.ability-slot-readout \{([^}]*)\}/m.exec(afterShared);
    assert.ok(readout);
    assert.match(readout[1], /height: 12px/);

    const slot = /^\.ability-slot \{([^}]*)\}/m.exec(css);
    assert.ok(slot);
    assert.match(slot[1], /flex: 1 1 0/);
    assert.match(slot[1], /min-width: 44px/);
  });
});
