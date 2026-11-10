// dragon-finish.test.js — in the campaign (web and app) a successful dragon
// breath resolves every remaining encounter once, pays a deterministic
// proportional bonus, and hands off to the existing single level-clear path.
// Practice and Shapes keep today's present-fiends-only breath.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

import { countDragonRemainingEncounters } from './encounter-flow.js';
import { calculateLevelBaselineScore, dragonFinishPerFiendValue } from './level-baseline-score.js';

const source = fs.readFileSync(new URL('./main.js', import.meta.url), 'utf8');
const FINISH_DRAGON_LEVEL = source.match(/function finishDragonLevel\(\)[\s\S]*?\n\}/)[0];
const CONFIG = { level: 1, waveSize: 30, fiendHP: 1 };

function createContext({
  isApp = true,
  practiceRun = null,
  isShapesMode = false,
  config = CONFIG,
  fiends = [],
  spawnQueue = [],
  requeuedFiends = [],
} = {}) {
  const calls = { waves: 0, inputDisabled: 0, hudUpdates: 0 };
  const context = {
    platform: { isApp, getCurrentLevelConfig: () => config },
    practiceRun,
    state: { score: 0, enemiesDefeated: 0, isShapesMode, timerActive: true },
    spawnQueue,
    requeuedFiends,
    fiends,
    activeFiend: { id: 'active' },
    pendingProblemActivation: { id: 'pending' },
    heroLunge: { phase: 'out' },
    activeLightningBolts: [{}],
    activeFireballs: [{}],
    inputDisabled: false,
    dragonFinishResolved: false,
    countDragonRemainingEncounters,
    dragonFinishPerFiendValue,
    input: { disable() { calls.inputDisabled += 1; } },
    hud: { update() { calls.hudUpdates += 1; } },
    triggerWaveClear() { calls.waves += 1; },
  };
  vm.createContext(context);
  vm.runInContext(FINISH_DRAGON_LEVEL, context);
  return { context, calls };
}

test('remaining encounters count every queued spawn and live fiend exactly once', () => {
  const live = { isDead: false, state: 'idle' };
  const dead = { isDead: true, state: 'death' };
  const dying = { isDead: false, state: 'death' };
  const retreating = { isDead: false, state: 'retreat' };

  assert.equal(countDragonRemainingEncounters({
    spawnQueue: [1, 1, 1],
    requeuedFiends: [live, retreating],
    fiends: [live, dead, dying],
  }), 4, '3 queued plus the one live fiend, counted once despite appearing twice');

  assert.equal(countDragonRemainingEncounters({
    spawnQueue: [],
    requeuedFiends: [dead, retreating],
    fiends: [dying],
  }), 0, 'dead and retreating fiends are already resolved');
  assert.equal(countDragonRemainingEncounters(), 0);
});

test('the per-fiend dragon bonus is the level baseline divided by the wave, deterministically', () => {
  const baseline = calculateLevelBaselineScore(CONFIG);
  assert.ok(baseline > 0);
  assert.equal(dragonFinishPerFiendValue(CONFIG), Math.round(baseline / CONFIG.waveSize));
  assert.equal(dragonFinishPerFiendValue(CONFIG), dragonFinishPerFiendValue(CONFIG));
  assert.equal(dragonFinishPerFiendValue(null), 0);
  assert.equal(dragonFinishPerFiendValue({ level: 1, fiendHP: 1 }), 0);
  assert.equal(dragonFinishPerFiendValue({ level: 1, waveSize: 0, fiendHP: 1 }), 0);
});

test('a campaign dragon breath awards the proportional bonus once and clears the level once', () => {
  for (const isApp of [true, false]) {
    const live = { isDead: false, state: 'idle' };
    const dead = { isDead: true, state: 'death' };
    const requeued = { isDead: false, state: 'walk' };
    const { context, calls } = createContext({
      isApp,
      spawnQueue: [0, 0, 0],
      requeuedFiends: [requeued],
      fiends: [live, dead, requeued],
    });
    const remaining = 3 + 2; // 3 queued, plus the live and requeued fiends (dead excluded, requeued deduped)
    const expectedBonus = remaining * dragonFinishPerFiendValue(CONFIG);
    const platformLabel = isApp ? 'app' : 'web';

    assert.equal(vm.runInContext('finishDragonLevel()', context), true, `${platformLabel} campaign finishes`);
    assert.equal(context.state.score, expectedBonus);
    assert.equal(context.state.enemiesDefeated, remaining);
    assert.equal(context.spawnQueue.length, 0, 'no queued spawn survives');
    assert.equal(context.requeuedFiends.length, 0, 'no requeued fiend survives');
    assert.equal(context.fiends.length, 0, 'no enemy survives');
    assert.equal(context.activeFiend, null);
    assert.equal(context.pendingProblemActivation, null);
    assert.equal(context.heroLunge, null);
    assert.equal(context.activeLightningBolts.length, 0);
    assert.equal(context.activeFireballs.length, 0);
    assert.equal(context.state.timerActive, false, 'the question timer stops');
    assert.equal(context.inputDisabled, true);
    assert.equal(calls.inputDisabled, 1);
    assert.equal(calls.waves, 1, 'the single level-clear path runs once');

    assert.equal(vm.runInContext('finishDragonLevel()', context), true);
    assert.equal(context.state.score, expectedBonus, 'a second breath adds no score');
    assert.equal(context.state.enemiesDefeated, remaining);
    assert.equal(calls.waves, 1, 'the completion write is not repeated');
  }
});

test('practice and Shapes never finish the campaign from a dragon breath', () => {
  for (const options of [
    { practiceRun: { kind: 'targeted' } },
    { isShapesMode: true },
    { isApp: false, practiceRun: { kind: 'targeted' } },
  ]) {
    const { context, calls } = createContext({
      ...options,
      spawnQueue: [0, 0],
      fiends: [{ isDead: false, state: 'idle' }],
    });

    assert.equal(vm.runInContext('finishDragonLevel()', context), false);
    assert.equal(context.state.score, 0);
    assert.equal(context.state.enemiesDefeated, 0);
    assert.equal(context.spawnQueue.length, 2, 'the queues stay live');
    assert.equal(context.fiends.length, 1);
    assert.equal(context.state.timerActive, true);
    assert.equal(calls.waves, 0);
    assert.equal(calls.inputDisabled, 0);
  }
});

test('the breath handler keeps the present-fiends-only resolveDragonBreath path behind the campaign gate', () => {
  assert.match(
    source,
    /if \(d\.breathJustCompleted\) \{\s*audio\.playDragonBreath\(\);\s*if \(!finishDragonLevel\(\)\) \{\s*state\.enemiesDefeated \+= resolveDragonBreath\(fiends\);/,
  );
  assert.match(source, /function finishDragonLevel\(\) \{\s*if \(dragonFinishResolved\) return true;\s*if \(practiceRun \|\| state\.isShapesMode\) return false;/);
  assert.match(source, /waveClearing = false;\s*dragonFinishResolved = false;/);
});
