import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  ABILITY_ROSTER,
  FIEND_SPEED_FLOOR,
  SPIKE_SLOW_CAPS,
  SPIKE_SLOW_DEFAULTS,
  applySpikeSlow,
  clampSpikeSlow,
  createAbilityRuntime,
  fiendSpeedMultiplier,
  restoreSpikeSlow,
} from './cooldown-abilities.js';

const INERT_SPIKE = {
  active: false,
  remainingSeconds: 0,
  durationSeconds: 0,
  factor: 1,
  targets: 0,
};

const closeTo = (actual, expected, message) =>
  assert.ok(Math.abs(actual - expected) < 1e-9, `${message}: ${actual} !== ${expected}`);

describe('ability roster', () => {
  it('lists wind, storm and earth with their unlock levels and base cooldown', () => {
    assert.deepEqual(ABILITY_ROSTER, [
      { id: 'wind', unlockLevel: 1, baseCooldownSeconds: 180 },
      { id: 'storm', unlockLevel: 6, baseCooldownSeconds: 180 },
      { id: 'earth', unlockLevel: 11, baseCooldownSeconds: 180 },
    ]);
  });

  it('unlocks abilities exactly at levels 1, 6 and 11', () => {
    for (const [level, unlocked] of [
      [1, ['wind']],
      [5, ['wind']],
      [6, ['wind', 'storm']],
      [10, ['wind', 'storm']],
      [11, ['wind', 'storm', 'earth']],
      [20, ['wind', 'storm', 'earth']],
    ]) {
      const runtime = createAbilityRuntime({ level });
      const ids = ABILITY_ROSTER.map((ability) => ability.id).filter((id) => runtime.isUnlocked(id));
      assert.deepEqual(ids, unlocked, `level ${level}`);
    }
  });

  it('rejects unknown ability ids', () => {
    const runtime = createAbilityRuntime({ level: 11 });
    assert.throws(() => runtime.isUnlocked('fire'), TypeError);
    assert.throws(() => runtime.activate('fire'), TypeError);
    assert.throws(() => runtime.progress('fire'), TypeError);
  });
});

describe('activation and cooldown progress', () => {
  it('activate puts an ability on its full cooldown and progress runs 0 -> 1', () => {
    const runtime = createAbilityRuntime({ level: 1 });
    assert.equal(runtime.activate('wind'), true);
    assert.equal(runtime.progress('wind'), 0);

    runtime.tick(90, { encounterRunning: true });
    closeTo(runtime.progress('wind'), 0.5, 'half way');

    runtime.tick(90, { encounterRunning: true });
    assert.equal(runtime.progress('wind'), 1);

    runtime.tick(60, { encounterRunning: true });
    assert.equal(runtime.progress('wind'), 1, 'progress stays clamped at 1');
  });

  it('locked abilities cannot be activated and never cool down', () => {
    const runtime = createAbilityRuntime({ level: 5 });
    assert.equal(runtime.activate('storm'), false);
    assert.equal(runtime.progress('storm'), 0);
    runtime.tick(500, { encounterRunning: true });
    assert.equal(runtime.progress('storm'), 0);
    assert.equal(runtime.activate('earth'), false);
    assert.equal(runtime.progress('earth'), 0);
  });

  it('tick only cools down while the encounter is running', () => {
    const runtime = createAbilityRuntime({ level: 6 });
    runtime.activate('wind');

    runtime.tick(30, { encounterRunning: false });
    runtime.tick(30);
    assert.equal(runtime.progress('wind'), 0);

    runtime.tick(90, { encounterRunning: true });
    closeTo(runtime.progress('wind'), 0.5, 'only running time counts');

    runtime.tick(90, { encounterRunning: true });
    assert.equal(runtime.progress('wind'), 1);
  });

  it('remaining never drops below zero and progress never leaves [0, 1]', () => {
    const runtime = createAbilityRuntime({ level: 1 });
    runtime.activate('wind');
    runtime.tick(10_000, { encounterRunning: true });
    assert.equal(runtime.progress('wind'), 1);
    runtime.tick(10_000, { encounterRunning: true });
    assert.equal(runtime.progress('wind'), 1);
  });

  it('rejects invalid tick steps and levels', () => {
    const runtime = createAbilityRuntime({ level: 1 });
    assert.throws(() => runtime.tick(-1, { encounterRunning: true }), TypeError);
    assert.throws(() => runtime.tick(NaN, { encounterRunning: true }), TypeError);
    assert.throws(() => createAbilityRuntime({ level: 0 }), TypeError);
    assert.throws(() => createAbilityRuntime({ level: NaN }), TypeError);
    assert.throws(() => createAbilityRuntime({ level: 1, rank: -1 }), TypeError);
  });
});

describe('storm removals', () => {
  it('removes min(1 + rank, max(0, remaining - 1)) enemies', () => {
    const rank0 = createAbilityRuntime({ level: 6 });
    for (const [remaining, removed] of [
      [10, 1], [3, 1], [2, 1], [1, 0], [0, 0], [-4, 0], [100, 1],
    ]) {
      assert.equal(rank0.stormRemovals(remaining), removed, `remaining ${remaining}`);
    }

    const rank2 = createAbilityRuntime({ level: 6, rank: 2 });
    assert.equal(rank2.stormRemovals(10), 3);
    assert.equal(rank2.stormRemovals(3), 2);
    assert.equal(rank2.stormRemovals(2), 1);
    assert.equal(rank2.stormRemovals(1), 0);
  });
});

describe('earth spike slow', () => {
  it('starts inert and uses the documented defaults on activation', () => {
    const runtime = createAbilityRuntime({ level: 11 });
    assert.deepEqual(runtime.spikeState, INERT_SPIKE);
    assert.deepEqual(SPIKE_SLOW_DEFAULTS, { durationSeconds: 8, factor: 0.65, targets: 1 });

    runtime.activate('earth');
    assert.deepEqual(runtime.spikeState, {
      active: true,
      remainingSeconds: 8,
      durationSeconds: 8,
      factor: 0.65,
      targets: 1,
    });
  });

  it('counts down with the encounter and expires to an inert state', () => {
    const runtime = createAbilityRuntime({ level: 11 });
    runtime.activate('earth');

    runtime.tick(3, { encounterRunning: false });
    assert.equal(runtime.spikeState.remainingSeconds, 8);

    runtime.tick(4, { encounterRunning: true });
    assert.equal(runtime.spikeState.remainingSeconds, 4);

    runtime.tick(4, { encounterRunning: true });
    assert.deepEqual(runtime.spikeState, INERT_SPIKE);
  });

  it('clamps configured parameters to the caps', () => {
    assert.deepEqual(SPIKE_SLOW_CAPS, { durationSeconds: 15, factorFloor: 0.4, targets: 5 });
    assert.deepEqual(clampSpikeSlow({ durationSeconds: 99, factor: 0.1, targets: 99 }), {
      durationSeconds: 15,
      factor: 0.4,
      targets: 5,
    });
    assert.deepEqual(clampSpikeSlow({ durationSeconds: -2, factor: 4, targets: 0 }), {
      durationSeconds: 0,
      factor: 1,
      targets: 1,
    });
    assert.deepEqual(clampSpikeSlow(), SPIKE_SLOW_DEFAULTS);

    const runtime = createAbilityRuntime({
      level: 11,
      spikeSlow: { durationSeconds: 99, factor: 0.1, targets: 99 },
    });
    runtime.activate('earth');
    assert.deepEqual(runtime.spikeState, {
      active: true,
      remainingSeconds: 15,
      durationSeconds: 15,
      factor: 0.4,
      targets: 5,
    });
    runtime.tick(15, { encounterRunning: true });
    assert.deepEqual(runtime.spikeState, INERT_SPIKE);
  });

  it('clearSpike restores no residual effect and is idempotent', () => {
    const runtime = createAbilityRuntime({ level: 11 });
    runtime.activate('earth');
    runtime.clearSpike();
    assert.deepEqual(runtime.spikeState, INERT_SPIKE);
    runtime.clearSpike();
    assert.deepEqual(runtime.spikeState, INERT_SPIKE);
    runtime.tick(10, { encounterRunning: true });
    assert.deepEqual(runtime.spikeState, INERT_SPIKE);
  });
});

describe('spike slow on a fiend', () => {
  it('stores the base speed once and restores it cleanly', () => {
    const fiend = { walkSpeed: 100 };
    assert.equal(applySpikeSlow(fiend, 0.65), true);
    closeTo(fiend.walkSpeed, 65, 'slowed speed');
    assert.equal(fiend.spikeBaseSpeed, 100);
    assert.equal(fiend.spikeSlowed, true);

    assert.equal(restoreSpikeSlow(fiend), true);
    assert.equal(fiend.walkSpeed, 100);
    assert.equal(fiend.spikeSlowed, false);
    assert.equal(fiend.spikeBaseSpeed, undefined);
    assert.equal(restoreSpikeSlow(fiend), false, 'a second restore is a no-op');
  });

  it('never compounds across repeated applications', () => {
    const fiend = { walkSpeed: 80 };
    applySpikeSlow(fiend, 0.65);
    applySpikeSlow(fiend, 0.65);
    applySpikeSlow(fiend, 0.5);
    closeTo(fiend.walkSpeed, 40, '0.5 of the original base, not of the slowed speed');
    assert.equal(fiend.spikeBaseSpeed, 80);
    restoreSpikeSlow(fiend);
    assert.equal(fiend.walkSpeed, 80);
  });

  it('clamps the factor to the documented floor and 1', () => {
    const slow = { walkSpeed: 100 };
    applySpikeSlow(slow, 0.01);
    closeTo(slow.walkSpeed, 40, 'floor of 0.4');

    const fast = { walkSpeed: 100 };
    applySpikeSlow(fast, 4);
    closeTo(fast.walkSpeed, 100, 'never faster than the base speed');
  });

  it('leaves fiends with invalid speeds and factors untouched', () => {
    for (const walkSpeed of [0, -10, NaN, Infinity, undefined, '50']) {
      const fiend = { walkSpeed };
      assert.equal(applySpikeSlow(fiend, 0.65), false, `walkSpeed ${String(walkSpeed)}`);
      assert.equal(fiend.spikeSlowed, undefined);
      assert.equal(fiend.walkSpeed, walkSpeed);
    }
    for (const factor of [NaN, Infinity, '0.5']) {
      const fiend = { walkSpeed: 100 };
      assert.equal(applySpikeSlow(fiend, factor), false, `factor ${String(factor)}`);
      assert.equal(fiend.walkSpeed, 100);
    }
    assert.equal(applySpikeSlow(null, 0.65), false);
    assert.equal(restoreSpikeSlow(null), false);
  });

  it('uses the default factor when none is given', () => {
    const fiend = { walkSpeed: 100 };
    assert.equal(applySpikeSlow(fiend), true);
    closeTo(fiend.walkSpeed, 65, 'SPIKE_SLOW_DEFAULTS.factor');
  });
});

describe('passive fiend-speed modifier', () => {
  it('starts at 1, drops 0.05 per slow bonus and floors at 0.7', () => {
    closeTo(fiendSpeedMultiplier(0), 1, 'no bonus');
    closeTo(fiendSpeedMultiplier(1), 0.95, 'one bonus');
    closeTo(fiendSpeedMultiplier(2), 0.9, 'two bonuses');
    closeTo(fiendSpeedMultiplier(6), FIEND_SPEED_FLOOR, 'floor');
    closeTo(fiendSpeedMultiplier(100), FIEND_SPEED_FLOOR, 'below floor');
    assert.throws(() => fiendSpeedMultiplier(-1), TypeError);
  });

  it('exposes the multiplier on the runtime', () => {
    closeTo(createAbilityRuntime({ level: 1 }).fiendSpeedMultiplier, 1, 'default');
    closeTo(
      createAbilityRuntime({ level: 1, slowBonuses: 3 }).fiendSpeedMultiplier,
      0.85,
      'three bonuses',
    );
    closeTo(
      createAbilityRuntime({ level: 1, slowBonuses: 50 }).fiendSpeedMultiplier,
      FIEND_SPEED_FLOOR,
      'floor',
    );
  });
});

describe('purity', () => {
  it('never reads a clock, rolls randomness or touches page globals', async () => {
    const source = await readFile(new URL('./cooldown-abilities.js', import.meta.url), 'utf8');
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
