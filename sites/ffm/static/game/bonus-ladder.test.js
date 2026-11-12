import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  ABILITY_ROSTER,
  FIEND_SPEED_FLOOR,
  fiendSpeedMultiplier,
} from './cooldown-abilities.js';
import {
  BONUS_CAPS,
  BONUS_TYPES,
  BONUS_TYPE_OWNERS,
  BONUS_VALUES,
  MAX_BONUS_LEVEL,
  MAX_SLOW_BONUSES,
  applyBonus,
  bonusForLevel,
  createBonusRuntime,
} from './bonus-ladder.js';

const unlockedAt = (id, level) => {
  const ability = ABILITY_ROSTER.find((entry) => entry.id === id);
  return Boolean(ability) && level >= ability.unlockLevel;
};

describe('bonus ladder shape', () => {
  it('documents the four types, values and caps', () => {
    assert.deepEqual(BONUS_TYPES, ['cooldown', 'storm', 'slowSpeed', 'slowTargets']);
    assert.deepEqual(BONUS_VALUES, {
      cooldownSeconds: 6,
      stormRank: 1,
      speedStep: 0.05,
      spikeTargets: 1,
    });
    assert.deepEqual(BONUS_CAPS, { cooldownSeconds: 90, stormRank: 5, spikeTargets: 5 });
    assert.deepEqual(BONUS_TYPE_OWNERS, {
      cooldown: null,
      storm: 'storm',
      slowSpeed: 'earth',
      slowTargets: 'earth',
    });
    assert.equal(MAX_BONUS_LEVEL, 60);
    assert.equal(MAX_SLOW_BONUSES, 6);
    assert.equal(fiendSpeedMultiplier(MAX_SLOW_BONUSES), FIEND_SPEED_FLOOR);
  });

  it('returns null outside levels 2-60 and rejects non-integer levels', () => {
    assert.equal(bonusForLevel(1), null);
    assert.equal(bonusForLevel(0), null);
    assert.equal(bonusForLevel(-3), null);
    assert.equal(bonusForLevel(61), null);
    assert.equal(bonusForLevel(1000), null);

    for (const level of [2.5, '2', NaN, Infinity, null, undefined]) {
      assert.throws(() => bonusForLevel(level), TypeError, `level ${String(level)}`);
    }
  });
});

describe('pinned bonus levels', () => {
  it('pins levels 1, 2, 3, 6, 7, 8, 11, 12, 13 and 60', () => {
    const expected = new Map([
      [1, null],
      [2, { level: 2, type: 'cooldown', abilityId: 'wind', value: 6 }],
      [3, { level: 3, type: 'cooldown', abilityId: 'wind', value: 6 }],
      [6, { level: 6, type: 'cooldown', abilityId: 'wind', value: 6 }],
      [7, { level: 7, type: 'storm', abilityId: 'storm', value: 1 }],
      [8, { level: 8, type: 'cooldown', abilityId: 'storm', value: 6 }],
      [11, { level: 11, type: 'storm', abilityId: 'storm', value: 1 }],
      [12, { level: 12, type: 'slowSpeed', abilityId: 'earth', value: 0.05 }],
      [13, { level: 13, type: 'slowTargets', abilityId: 'earth', value: 1 }],
      [60, { level: 60, type: 'slowSpeed', abilityId: 'earth', value: 0.05 }],
    ]);

    for (const [level, bonus] of expected) {
      assert.deepEqual(bonusForLevel(level), bonus, `level ${level}`);
    }
  });

  it('is deterministic and returns frozen bonuses', () => {
    const first = bonusForLevel(27);
    const second = bonusForLevel(27);
    assert.deepEqual(first, second);
    assert.ok(Object.isFrozen(first));
  });
});

describe('ladder rules across levels 2-60', () => {
  it('grants exactly one bonus per level with the documented value', () => {
    for (let level = 2; level <= MAX_BONUS_LEVEL; level += 1) {
      const bonus = bonusForLevel(level);
      assert.equal(bonus.level, level, `level ${level}`);
      assert.ok(BONUS_TYPES.includes(bonus.type), `level ${level} type`);
      assert.equal(bonus.value, BONUS_VALUES[
        { cooldown: 'cooldownSeconds', storm: 'stormRank', slowSpeed: 'speedStep', slowTargets: 'spikeTargets' }[bonus.type]
      ], `level ${level} value`);
    }
  });

  it('never targets a locked ability', () => {
    for (let level = 2; level <= MAX_BONUS_LEVEL; level += 1) {
      const bonus = bonusForLevel(level);
      assert.ok(
        unlockedAt(bonus.abilityId, level),
        `level ${level} targets locked ${bonus.abilityId}`,
      );
    }
  });

  it('follows the fixed type cycle once every owner is unlocked', () => {
    for (let level = 11; level <= MAX_BONUS_LEVEL; level += 1) {
      assert.equal(
        bonusForLevel(level).type,
        BONUS_TYPES[(level - 2) % BONUS_TYPES.length],
        `level ${level}`,
      );
    }
  });

  it('advances past locked owners below level 11', () => {
    // storm unlocks at 6 and earth at 11, so early storm/earth slots fall back
    // to cooldown (wind) and never to a locked ability.
    for (const level of [2, 3, 4, 5]) {
      assert.deepEqual(bonusForLevel(level), {
        level,
        type: 'cooldown',
        abilityId: 'wind',
        value: 6,
      });
    }
    for (const level of [8, 9, 10]) {
      assert.equal(bonusForLevel(level).type, 'cooldown', `level ${level}`);
    }
  });

  it('spreads cooldown bonuses round-robin over the unlocked abilities', () => {
    const seen = [];
    for (let level = 2; level <= MAX_BONUS_LEVEL; level += 1) {
      const bonus = bonusForLevel(level);
      if (bonus.type !== 'cooldown') continue;
      const unlocked = ABILITY_ROSTER.filter((ability) => level >= ability.unlockLevel);
      assert.equal(
        bonus.abilityId,
        unlocked[seen.length % unlocked.length].id,
        `level ${level}`,
      );
      seen.push([level, bonus.abilityId]);
    }

    assert.deepEqual(seen.slice(0, 4), [[2, 'wind'], [3, 'wind'], [4, 'wind'], [5, 'wind']]);
    assert.deepEqual(seen.slice(4, 8), [[6, 'wind'], [8, 'storm'], [9, 'wind'], [10, 'storm']]);
    assert.deepEqual(seen.slice(8, 12), [
      [14, 'earth'], [18, 'wind'], [22, 'storm'], [26, 'earth'],
    ]);
  });
});

describe('bonus runtime', () => {
  it('starts empty and frozen at the requested level', () => {
    const runtime = createBonusRuntime({ level: 12 });
    assert.deepEqual(runtime, {
      level: 12,
      cooldownReductionSeconds: 0,
      stormRank: 0,
      slowBonuses: 0,
      spikeTargets: 0,
      appliedLevels: [],
    });
    assert.ok(Object.isFrozen(runtime));
    assert.ok(Object.isFrozen(runtime.appliedLevels));

    assert.throws(() => createBonusRuntime({ level: 0 }), TypeError);
    assert.throws(() => createBonusRuntime({ level: 1.5 }), TypeError);
    assert.throws(() => createBonusRuntime(), TypeError);
  });

  it('applies each bonus to its own counter and records the level', () => {
    const runtime = createBonusRuntime({ level: 12 });

    const storm = applyBonus(runtime, bonusForLevel(7));
    assert.deepEqual(storm, {
      level: 12,
      cooldownReductionSeconds: 0,
      stormRank: 1,
      slowBonuses: 0,
      spikeTargets: 0,
      appliedLevels: [7],
    });

    const slow = applyBonus(storm, bonusForLevel(12));
    assert.equal(slow.slowBonuses, 1);
    assert.equal(fiendSpeedMultiplier(slow.slowBonuses), 0.95);

    const targets = applyBonus(slow, bonusForLevel(13));
    assert.equal(targets.spikeTargets, 1);

    const cooldown = applyBonus(targets, bonusForLevel(14));
    assert.equal(cooldown.cooldownReductionSeconds, 6);
    assert.deepEqual(cooldown.appliedLevels, [7, 12, 13, 14]);
  });

  it('reapplying the same level is a no-op', () => {
    const runtime = applyBonus(createBonusRuntime({ level: 20 }), bonusForLevel(12));
    const again = applyBonus(runtime, bonusForLevel(12));
    assert.equal(again, runtime, 'returns the same runtime');
    assert.equal(again.slowBonuses, 1);
    assert.deepEqual(again.appliedLevels, [12]);
  });

  it('reaches the documented caps after replaying every level', () => {
    let runtime = createBonusRuntime({ level: 60 });
    for (let level = 2; level <= MAX_BONUS_LEVEL; level += 1) {
      runtime = applyBonus(runtime, bonusForLevel(level));
    }

    assert.equal(runtime.cooldownReductionSeconds, BONUS_CAPS.cooldownSeconds);
    assert.equal(runtime.stormRank, BONUS_CAPS.stormRank);
    assert.equal(runtime.spikeTargets, BONUS_CAPS.spikeTargets);
    assert.equal(runtime.slowBonuses, MAX_SLOW_BONUSES);
    assert.equal(runtime.appliedLevels.length, MAX_BONUS_LEVEL - 1);

    const multiplier = fiendSpeedMultiplier(runtime.slowBonuses);
    assert.equal(multiplier, FIEND_SPEED_FLOOR);
    assert.ok(multiplier >= FIEND_SPEED_FLOOR);
  });

  it('never exceeds a cap, even with repeated identical bonuses', () => {
    let runtime = createBonusRuntime({ level: 60 });
    for (let index = 0; index < 40; index += 1) {
      runtime = applyBonus(runtime, { ...bonusForLevel(12), level: 11 + index });
    }
    assert.equal(runtime.slowBonuses, MAX_SLOW_BONUSES);

    let stormy = createBonusRuntime({ level: 60 });
    for (let index = 0; index < 20; index += 1) {
      stormy = applyBonus(stormy, { ...bonusForLevel(7), level: 7 + index });
    }
    assert.equal(stormy.stormRank, BONUS_CAPS.stormRank);

    let spikey = createBonusRuntime({ level: 60 });
    for (let index = 0; index < 20; index += 1) {
      spikey = applyBonus(spikey, { ...bonusForLevel(13), level: 11 + index });
    }
    assert.equal(spikey.spikeTargets, BONUS_CAPS.spikeTargets);

    let cooling = createBonusRuntime({ level: 60 });
    for (let index = 0; index < 40; index += 1) {
      cooling = applyBonus(cooling, { ...bonusForLevel(2), level: 2 + index });
    }
    assert.equal(cooling.cooldownReductionSeconds, BONUS_CAPS.cooldownSeconds);
  });

  it('is order-independent for the counters', () => {
    const ascending = [7, 8, 12, 13].reduce(
      (runtime, level) => applyBonus(runtime, bonusForLevel(level)),
      createBonusRuntime({ level: 13 }),
    );
    const descending = [13, 12, 8, 7].reduce(
      (runtime, level) => applyBonus(runtime, bonusForLevel(level)),
      createBonusRuntime({ level: 13 }),
    );

    const counters = ({ level: _level, appliedLevels: _applied, ...rest }) => rest;
    assert.deepEqual(counters(ascending), counters(descending));
  });

  it('rejects malformed bonuses and runtimes', () => {
    const runtime = createBonusRuntime({ level: 12 });
    assert.throws(() => applyBonus(null, bonusForLevel(2)), TypeError);
    assert.throws(() => applyBonus({}, bonusForLevel(2)), TypeError);
    assert.throws(() => applyBonus(runtime, null), TypeError);
    assert.throws(() => applyBonus(runtime, { ...bonusForLevel(2), type: 'fire' }), TypeError);
    assert.throws(() => applyBonus(runtime, { ...bonusForLevel(2), abilityId: 'fire' }), TypeError);
    assert.throws(() => applyBonus(runtime, { ...bonusForLevel(2), value: 99 }), TypeError);
    assert.throws(() => applyBonus(runtime, { ...bonusForLevel(2), level: 1 }), TypeError);
    assert.throws(() => applyBonus(runtime, { ...bonusForLevel(2), level: 2.5 }), TypeError);

    // earth is locked at level 7, so a slow bonus cannot apply there.
    assert.throws(
      () => applyBonus(runtime, { level: 7, type: 'slowSpeed', abilityId: 'earth', value: 0.05 }),
      TypeError,
    );
  });
});

describe('purity', () => {
  it('never reads a clock, rolls randomness or touches page globals', async () => {
    const source = await readFile(new URL('./bonus-ladder.js', import.meta.url), 'utf8');
    for (const forbidden of [
      /\bDate\.now\b/,
      /\bperformance\.now\b/,
      /\bMath\.random\b/,
      /\bwindow\b/,
      /\bdocument\b/,
    ]) {
      assert.doesNotMatch(source, forbidden);
    }
  });
});
