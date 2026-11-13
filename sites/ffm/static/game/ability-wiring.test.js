// Wiring tests for the ability runtime (cooldown-abilities.js) inside the game
// loop (main.js). main.js is a browser module, so the tests pin the loop guard
// and run the extracted run-lifecycle functions against the real pure model.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

import {
  applySpikeSlow,
  createAbilityRuntime,
  fiendSpeedMultiplier,
  restoreSpikeSlow,
  SPIKE_SLOW_CAPS,
  SPIKE_SLOW_DEFAULTS,
} from './cooldown-abilities.js';
import { BONUS_CAPS, applyBonus, bonusForLevel, createBonusRuntime } from './bonus-ladder.js';
import { createAbilityBar } from './ability-bar.js';
import { countDragonRemainingEncounters } from './encounter-flow.js';

const source = readFileSync(new URL('./main.js', import.meta.url), 'utf8');

function functionSource(name) {
  const match = source.match(new RegExp(`function ${name}\\([^)]*\\)[\\s\\S]*?\\n\\}`));
  assert.ok(match, `${name} must exist in main.js`);
  return match[0];
}

function finishStartContext({ checkAllDefeated } = {}) {
  const calls = {
    hudUpdates: 0,
    triggerWaveClear: 0,
    recordPracticeEncounterDefeated: 0,
    swordsShattered: 0,
    stormSounds: 0,
  };
  const context = {
    applySpikeSlow,
    restoreSpikeSlow,
    createAbilityRuntime,
    countDragonRemainingEncounters,
    SPIKE_SLOW_DEFAULTS,
    createBonusRuntime,
    applyBonus,
    bonusForLevel,
    BONUS_CAPS,
    setAnswerInputVisible() {},
    gameplayTimers: [],
    practiceRun: null,
    answerClock: { reset() {} },
    practiceBadgeRetryButton: null,
    createAttemptSummary() { return {}; },
    platform: { isApp: false },
    state: { score: 0 },
    diffSelect: { style: { display: 'flex' } },
    pauseOverlay: { style: {} },
    topBar: { style: {} },
    levelClearOverlay: { style: {} },
    gameOverOverlay: { style: {} },
    resetHealHold() {},
    updateHUDLogoutVisibility() {},
    hud: { update() { calls.hudUpdates += 1; } },
    audio: {
      startLevelBGM() {},
      playStormRemoval() { calls.stormSounds += 1; return true; },
    },
    flushDeferredMusicVolume() {},
    syncKeepAwake() {},
    animFrameId: 1,
    spawnQueue: [],
    requeuedFiends: [],
    fiends: [],
    activeFiend: null,
    pendingProblemActivation: null,
    inputDisabled: false,
    spawnTimer: 0,
    spawnInterval: 4,
    SPAWN_INTERVAL_SECONDS: 0.5,
    // Arena geometry the storm's feedback spreads its bursts across.
    FIEND_PORTAL_X: 720,
    HERO_X: 110,
    groundY: 300,
    encounterSwords: { shatter(count) { calls.swordsShattered += count; } },
    recordPracticeEncounterDefeated() { calls.recordPracticeEncounterDefeated += 1; },
    checkAllDefeated: checkAllDefeated ?? (() => false),
    triggerWaveClear() { calls.triggerWaveClear += 1; },
  };
  vm.createContext(context);
  vm.runInContext(
    [
      'let abilityRuntime = null;',
      'let levelBonusRuntime = null;',
      'let levelBonusCooldowns = null;',
      'let spikeSlowedFiends = new Set();',
      'let spikeSpawnSlowLeft = 0;',
      functionSource('bonusReadoutsForLevel'),
      functionSource('beginAbilityRun'),
      functionSource('activateAbility'),
      functionSource('finishStartLevel'),
      functionSource('remainingEnemyCount'),
      functionSource('removeActiveFiendForAbility'),
      functionSource('castWindAbility'),
      functionSource('castStormAbility'),
      functionSource('playStormRemovalFeedback'),
      functionSource('castEarthAbility'),
      functionSource('clearSpikeSlow'),
    ].join('\n'),
    context,
  );
  context.__calls = calls;
  return context;
}

const readRuntime = (context) => vm.runInContext('abilityRuntime', context);

function fiendStub(state = 'walk') {
  const fiend = { isDead: false, state, wasRequeued: false, problem: null };
  fiend.setState = (next) => { fiend.state = next; };
  return fiend;
}

function giveActiveFiend(context, fiend = fiendStub()) {
  context.activeFiend = fiend;
  context.fiends = [fiend];
  return fiend;
}

describe('ability runtime lifecycle', () => {
  it('creates the runtime when the first level of a run starts', () => {
    const context = finishStartContext();
    assert.equal(readRuntime(context), null);

    vm.runInContext('finishStartLevel(0, { level: 3, chapter: 1, waveSize: 3 });', context);

    const runtime = readRuntime(context);
    assert.ok(runtime, 'finishStartLevel must create a runtime when none exists');
    assert.equal(runtime.level, 3);
    assert.equal(runtime.isUnlocked('wind'), true);
    assert.equal(runtime.isUnlocked('storm'), false);
  });

  it('re-levels the existing runtime so cooldowns survive a level transition', () => {
    const context = finishStartContext();
    vm.runInContext('finishStartLevel(0, { level: 1, chapter: 1, waveSize: 3 });', context);
    giveActiveFiend(context);
    assert.equal(vm.runInContext("activateAbility('wind')", context), true);

    const first = readRuntime(context);
    first.tick(90, { encounterRunning: true });
    assert.equal(first.progress('wind'), 0.5);

    vm.runInContext('finishStartLevel(1, { level: 6, chapter: 1, waveSize: 3 });', context);

    const second = readRuntime(context);
    assert.equal(second, first, 'the same runtime must carry into the next level');
    assert.equal(second.level, 6);
    // Level 6 has earned a wind cooldown reduction, so the same 90 s left is a
    // larger share of the shorter cooldown — but no second is lost or granted.
    const reduced = second.cooldownSeconds('wind');
    assert.ok(reduced < 180, 'the earned reduction applies to the live runtime');
    assert.ok(Math.abs(second.progress('wind') - (1 - 90 / reduced)) < 1e-9,
      'exactly 90 s of the reduced cooldown remain');
    assert.equal(second.isUnlocked('storm'), true, 'unlocks refresh with the new level');
    assert.equal(vm.runInContext("activateAbility('wind')", context), false, 'a cooling ability is a no-op');
  });

  it('only activates a ready ability and starts its 180 s cooldown', () => {
    const context = finishStartContext();
    vm.runInContext('finishStartLevel(0, { level: 1, chapter: 1, waveSize: 3 });', context);

    giveActiveFiend(context);
    assert.equal(vm.runInContext("activateAbility('wind')", context), true);
    const runtime = readRuntime(context);
    assert.equal(runtime.progress('wind'), 0, 'activation restarts the full cooldown');
    assert.equal(vm.runInContext("activateAbility('wind')", context), false);
    assert.equal(vm.runInContext("activateAbility('storm')", context), false, 'locked abilities are a no-op');

    runtime.tick(180, { encounterRunning: true });
    assert.equal(runtime.progress('wind'), 1);
    giveActiveFiend(context);
    assert.equal(vm.runInContext("activateAbility('wind')", context), true);
  });

  it('ignores activations before any run has started', () => {
    const context = finishStartContext();
    assert.equal(vm.runInContext("activateAbility('wind')", context), false);
  });
});

// Independent replay of the bonus ladder, mirroring what main.js does at a
// level start: the earned totals plus the per-ability cooldown reductions.
function ladderFor(level) {
  let runtime = createBonusRuntime({ level });
  const cooldowns = { wind: 0, storm: 0, earth: 0 };
  let total = 0;
  for (let current = 2; current <= level; current += 1) {
    const bonus = bonusForLevel(current);
    if (!bonus) continue;
    runtime = applyBonus(runtime, bonus);
    if (bonus.type !== 'cooldown') continue;
    const room = Math.min(bonus.value, BONUS_CAPS.cooldownSeconds - total);
    if (room <= 0) continue;
    total += room;
    cooldowns[bonus.abilityId] += room;
  }
  return { runtime, cooldowns };
}

describe('earned bonuses', () => {
  it('a run started at level n carries every bonus earned up to that level', () => {
    const context = finishStartContext();
    const runtime = vm.runInContext('beginAbilityRun(60);', context);
    const expected = ladderFor(60);

    assert.equal(runtime.rank, expected.runtime.stormRank);
    assert.ok(runtime.rank > 0, 'the ladder earned storm ranks');
    assert.equal(runtime.stormRemovals(30), 1 + expected.runtime.stormRank,
      'the earned storm rank widens the removal slice');
    assert.equal(runtime.fiendSpeedMultiplier, fiendSpeedMultiplier(expected.runtime.slowBonuses),
      'the passive slow bonus slows every fiend');
    for (const id of ['wind', 'storm', 'earth']) {
      assert.equal(runtime.cooldownSeconds(id), Math.max(90, 180 - expected.cooldowns[id]),
        `${id} uses its reduced cooldown`);
    }

    assert.equal(runtime.activate('earth'), true);
    assert.equal(runtime.spikeState.targets, Math.min(
      SPIKE_SLOW_CAPS.targets,
      SPIKE_SLOW_DEFAULTS.targets + expected.runtime.spikeTargets,
    ), 'the earned spike targets were applied up to the documented cap');
  });

  it('applies the ladder at a mid-campaign start, not only at the caps', () => {
    const context = finishStartContext();
    const runtime = vm.runInContext('beginAbilityRun(30);', context);
    const expected = ladderFor(30);

    assert.equal(runtime.rank, expected.runtime.stormRank);
    assert.equal(runtime.fiendSpeedMultiplier, fiendSpeedMultiplier(expected.runtime.slowBonuses));
    assert.equal(runtime.cooldownSeconds('wind'), Math.max(90, 180 - expected.cooldowns.wind));
    assert.ok(runtime.cooldownSeconds('wind') < 180 || expected.cooldowns.wind === 0,
      'a wind cooldown bonus shortens its cooldown');
  });

  it('re-applies the next level earned bonus when the run enters it', () => {
    const context = finishStartContext();
    vm.runInContext('finishStartLevel(0, { level: 1, chapter: 1, waveSize: 3 });', context);
    assert.equal(readRuntime(context).rank, 0, 'level 1 has no bonuses');

    vm.runInContext('finishStartLevel(6, { level: 7, chapter: 1, waveSize: 3 });', context);
    const expected = ladderFor(7);
    const runtime = readRuntime(context);
    assert.ok(expected.runtime.stormRank > 0, 'level 7 grants a storm rank');
    assert.equal(runtime.rank, expected.runtime.stormRank, 'the level-7 rank reaches the live runtime');
    assert.equal(runtime.fiendSpeedMultiplier, fiendSpeedMultiplier(expected.runtime.slowBonuses));
    assert.equal(runtime.cooldownSeconds('wind'), Math.max(90, 180 - expected.cooldowns.wind));
  });

  it('pins the level count in the bonus runtime the bar reads', () => {
    const context = finishStartContext();
    vm.runInContext('finishStartLevel(0, { level: 7, chapter: 1, waveSize: 3 });', context);
    const bonusRuntime = vm.runInContext('levelBonusRuntime', context);
    const bonusCooldowns = vm.runInContext('levelBonusCooldowns', context);
    assert.equal(bonusRuntime.level, 7);
    assert.equal(bonusCooldowns.wind, ladderFor(7).cooldowns.wind);
  });
});

describe('game loop wiring', () => {
  it('ticks the runtime with the live-encounter guard', () => {
    const loop = functionSource('gameLoop');
    assert.match(
      loop,
      /abilityRuntime\?\.tick\(dt, \{ encounterRunning: gameRunning && !paused \}\);/,
      'the tick guard must be exactly gameRunning && !paused',
    );
    assert.ok(
      loop.indexOf('abilityRuntime?.tick') > loop.indexOf('advanceGameplayTimers(dt)'),
      'cooldowns tick after the gameplay timers advance',
    );
  });

  it('pushes 0-1 progress into the bar every frame', () => {
    const loop = functionSource('gameLoop');
    assert.match(
      loop,
      /abilityBar\.update\(\{\s*\n\s*level: state\.level,\s*\n\s*progress: abilityRuntime \? \(id\) => abilityRuntime\.progress\(id\) : 1,/,
      'the bar must receive the current level and a progress lookup',
    );
  });
});

describe('run starts', () => {
  it('begins a fresh run from level select, practice, resume and retry', () => {
    assert.ok(
      source.indexOf('beginAbilityRun(targetLevel)') > source.indexOf('const targetIndex = targetLevel - 1;'),
      'level-select campaign start resets the runtime',
    );
    assert.ok(
      source.indexOf('beginAbilityRun(targetLevel)') < source.indexOf('await startLevel(targetIndex, true)'),
      'level-select resets before the level starts',
    );

    const practice = functionSource('startPracticeSession');
    assert.match(practice, /beginAbilityRun\(sourceLevel\);/);
    assert.ok(
      practice.indexOf('beginAbilityRun(sourceLevel)') < practice.indexOf('await startLevel(sourceLevel - 1)'),
      'practice resets before the level starts',
    );

    const resume = functionSource('resumePendingLevel');
    assert.match(resume, /beginAbilityRun\(pending\.levelIndex \+ 1\);/);
    assert.ok(
      resume.indexOf('beginAbilityRun(pending.levelIndex + 1)') < resume.indexOf('startLevel(pending.levelIndex)'),
      'resume resets before the level starts',
    );

    const gameOver = functionSource('triggerGameOver');
    assert.match(gameOver, /beginAbilityRun\(currentLevelIndex \+ 1\);/);
    assert.ok(
      gameOver.indexOf('beginAbilityRun(currentLevelIndex + 1)') < gameOver.indexOf('startLevel(currentLevelIndex)'),
      'retry resets before the level starts',
    );
  });
});

describe('wind ability', () => {
  it('removes an active fiend with one defeat and no score/combo/timer credit', () => {
    const context = finishStartContext();
    vm.runInContext('finishStartLevel(0, { level: 1, chapter: 1, waveSize: 3 });', context);
    const fiend = giveActiveFiend(context);
    context.state.timerActive = true;
    context.state.timerRemaining = 7;
    context.state.timerMax = 10;
    context.state.hearts = 3;
    const scoreBefore = context.state.score;
    const comboBefore = context.state.combo;

    assert.equal(vm.runInContext("activateAbility('wind')", context), true);

    assert.equal(fiend.state, 'retreat', 'the active fiend retreats off the field');
    assert.equal(context.activeFiend, null, 'the active fiend is cleared');
    assert.equal(context.state.enemiesDefeated, 1, 'exactly one defeat is counted');
    assert.equal(context.state.score, scoreBefore, 'score is untouched');
    assert.equal(context.state.combo, comboBefore, 'combo is untouched');
    assert.equal(context.state.hearts, 3, 'hearts are untouched');
    assert.equal(context.state.timerRemaining, 7, 'no timing credit is awarded');
    assert.equal(context.state.timerMax, 10, 'the timer length is untouched');
    assert.equal(context.state.timerActive, false, 'the problem timer stops');
    assert.equal(context.inputDisabled, false, 'input is re-enabled for the next spawn');
    assert.equal(context.spawnTimer, context.spawnInterval, 'the next spawn is scheduled');
    assert.equal(context.__calls.recordPracticeEncounterDefeated, 1);
  });

  it('consumes no cooldown and returns false when there is no active fiend', () => {
    const context = finishStartContext();
    vm.runInContext('finishStartLevel(0, { level: 1, chapter: 1, waveSize: 3 });', context);
    assert.equal(context.activeFiend, null);

    assert.equal(vm.runInContext("activateAbility('wind')", context), false);
    assert.equal(readRuntime(context).progress('wind'), 1, 'the cooldown stays full');
    assert.equal(context.state.enemiesDefeated, 0);
    assert.equal(context.__calls.triggerWaveClear, 0);
  });

  it('refuses wind while input is disabled without consuming the cooldown', () => {
    const context = finishStartContext();
    vm.runInContext('finishStartLevel(0, { level: 1, chapter: 1, waveSize: 3 });', context);
    giveActiveFiend(context);
    context.inputDisabled = true;

    assert.equal(vm.runInContext("activateAbility('wind')", context), false);
    assert.equal(readRuntime(context).progress('wind'), 1, 'the cooldown stays full');
  });

  it('hands off to the wave-clear path when the last enemy is removed', () => {
    const context = finishStartContext({ checkAllDefeated: () => true });
    vm.runInContext('finishStartLevel(0, { level: 1, chapter: 1, waveSize: 1 });', context);
    giveActiveFiend(context);

    assert.equal(vm.runInContext("activateAbility('wind')", context), true);
    assert.equal(context.__calls.triggerWaveClear, 1, 'wind leads to the normal wave clear');
  });
});

describe('storm ability', () => {
  it('seeds the level enemy count from the wave so the row can shrink', () => {
    const context = finishStartContext();
    vm.runInContext('finishStartLevel(0, { level: 6, chapter: 1, waveSize: 30 });', context);
    assert.equal(context.state.levelEnemies, 30, 'the row starts with one sword per enemy');
    assert.equal(context.spawnQueue.length, 30, 'and the spawn list matches it');
  });

  it('feeds the encounter row from the level count instead of the fixed wave size', () => {
    assert.match(source, /total: state\.levelEnemies > 0/,
      'a storm removal must shrink the row, not fill its swords');
  });

  it('stormRemovals returns min(1 + rank, remaining - 1) for 0/1/2/30 enemies across ranks 0-5', () => {
    const byRemaining = [
      [0, 0, 0, 0, 0, 0], // 0 remaining
      [0, 0, 0, 0, 0, 0], // 1 remaining
      [1, 1, 1, 1, 1, 1], // 2 remaining
      [1, 2, 3, 4, 5, 6], // 30 remaining
    ];
    for (let rank = 0; rank <= 5; rank += 1) {
      const runtime = createAbilityRuntime({ level: 6, rank });
      for (const [remaining, expected] of [
        [0, byRemaining[0][rank]],
        [1, byRemaining[1][rank]],
        [2, byRemaining[2][rank]],
        [30, byRemaining[3][rank]],
      ]) {
        assert.equal(runtime.stormRemovals(remaining), expected,
          `rank ${rank}, remaining ${remaining}`);
      }
    }
  });

  it('drains spawnQueue first, then requeuedFiends, then the active fiend', () => {
    const context = finishStartContext();
    vm.runInContext('finishStartLevel(0, { level: 6, chapter: 1, waveSize: 30 });', context);
    vm.runInContext('beginAbilityRun(6, 5);', context);

    const active = fiendStub();
    const requeuedA = fiendStub('retreat');
    const requeuedB = fiendStub('retreat');
    context.spawnQueue = [6, 6];
    context.requeuedFiends = [requeuedA, requeuedB];
    // A requeued fiend waits in 'retreat' state, still in `fiends`, until it
    // walks back on -- exactly as handleWrongAnswer leaves it.
    context.fiends = [active, requeuedA, requeuedB];
    context.activeFiend = active;
    context.state.levelEnemies = 5;

    // remaining = 2 + 2 + 1 = 5; rank 5 -> min(6, 4) = 4: drain queue + requeue.
    const hudUpdatesBefore = context.__calls.hudUpdates;
    assert.equal(vm.runInContext("activateAbility('storm')", context), true);
    assert.deepEqual(context.spawnQueue, [], 'spawnQueue is drained first');
    assert.deepEqual(context.requeuedFiends, [], 'requeuedFiends are drained second');
    assert.equal(context.activeFiend, active, 'the active fiend survives with one left');
    assert.equal(active.state, 'walk', 'a surviving active fiend is untouched');
    assert.equal(context.state.enemiesDefeated, 0, 'removed enemies are not defeats');
    assert.equal(context.state.levelEnemies, 1, 'the four removals leave one enemy behind');
    assert.equal(context.__calls.swordsShattered, 4, 'their swords leave the row');
    assert.equal(context.__calls.stormSounds, 1, 'the chain plays one cue');
    assert.equal(context.__calls.hudUpdates, hudUpdatesBefore + 1,
      'the encounter readout refreshes once');
  });

  it('removes the active fiend last, after the queue and requeue run dry', () => {
    const context = finishStartContext();
    vm.runInContext('finishStartLevel(0, { level: 6, chapter: 1, waveSize: 30 });', context);
    vm.runInContext('beginAbilityRun(6, 5);', context);

    const active = fiendStub();
    const survivor = fiendStub();
    const requeued = fiendStub('retreat');
    context.spawnQueue = [6];
    context.requeuedFiends = [requeued];
    context.fiends = [active, survivor, requeued];
    context.activeFiend = active;
    context.state.levelEnemies = 4;

    // remaining = 1 + 1 + 2 = 4; rank 5 -> min(6, 3) = 3: queue + requeue + active.
    assert.equal(vm.runInContext("activateAbility('storm')", context), true);
    assert.deepEqual(context.spawnQueue, []);
    assert.deepEqual(context.requeuedFiends, []);
    assert.equal(context.activeFiend, null, 'the active fiend is removed last');
    assert.equal(active.state, 'retreat', 'the removed active fiend retreats');
    assert.equal(survivor.state, 'walk', 'the surviving fiend is untouched');
    assert.equal(context.state.enemiesDefeated, 0, 'removed enemies are not defeats');
    assert.equal(context.state.levelEnemies, 1, 'the three removals leave one enemy behind');
    assert.equal(context.__calls.swordsShattered, 3, 'their swords leave the row');
    assert.equal(context.__calls.triggerWaveClear, 0, 'a survivor is still on the field');
  });

  it('never removes the last enemy', () => {
    const context = finishStartContext();
    vm.runInContext('finishStartLevel(0, { level: 6, chapter: 1, waveSize: 30 });', context);
    vm.runInContext('beginAbilityRun(6, 5);', context);

    const lone = fiendStub();
    context.spawnQueue = [];
    context.requeuedFiends = [];
    context.fiends = [lone];
    context.activeFiend = lone;

    assert.equal(vm.runInContext("activateAbility('storm')", context), false);
    assert.equal(context.state.enemiesDefeated, 0);
    assert.equal(context.state.levelEnemies, 30, 'a refused storm leaves the level intact');
    assert.equal(context.__calls.swordsShattered, 0);
    assert.equal(context.activeFiend, lone, 'the lone fiend survives');
    assert.equal(readRuntime(context).progress('storm'), 1, 'a refused storm keeps its cooldown');
  });

  it('returns false without spending the cooldown when no enemy remains', () => {
    const context = finishStartContext();
    vm.runInContext('finishStartLevel(0, { level: 6, chapter: 1, waveSize: 30 });', context);
    vm.runInContext('beginAbilityRun(6, 5);', context);
    context.spawnQueue = [];
    context.requeuedFiends = [];
    context.fiends = [];
    context.activeFiend = null;

    assert.equal(vm.runInContext('remainingEnemyCount()', context), 0);
    assert.equal(vm.runInContext("activateAbility('storm')", context), false);
    assert.equal(readRuntime(context).progress('storm'), 1, 'the cooldown stays full');
    assert.equal(context.state.enemiesDefeated, 0);
    assert.equal(context.state.levelEnemies, 30, 'nothing was removed');
  });

  it('counts requeued fiends that are still retreating off the field', () => {
    const context = finishStartContext();
    vm.runInContext('finishStartLevel(0, { level: 6, chapter: 1, waveSize: 30 });', context);
    vm.runInContext('beginAbilityRun(6, 5);', context);

    const requeued = fiendStub('retreat');
    context.spawnQueue = [6];
    context.requeuedFiends = [requeued];
    context.fiends = [requeued];
    context.activeFiend = null;
    context.state.levelEnemies = 2;

    assert.equal(vm.runInContext('remainingEnemyCount()', context), 2,
      'a retreating requeued fiend is still a remaining enemy');

    // remaining = 2; rank 5 -> min(6, 1) = 1: the queue drains first.
    assert.equal(vm.runInContext("activateAbility('storm')", context), true);
    assert.deepEqual(context.spawnQueue, []);
    assert.deepEqual(context.requeuedFiends, [requeued], 'the requeued fiend survives with one left');
    assert.equal(context.state.enemiesDefeated, 0, 'removed enemies are not defeats');
    assert.equal(context.state.levelEnemies, 1, 'the removal leaves one enemy behind');
  });

  it('removes requeued fiends waiting in retreat state once the queue is empty', () => {
    const context = finishStartContext();
    vm.runInContext('finishStartLevel(0, { level: 6, chapter: 1, waveSize: 30 });', context);
    vm.runInContext('beginAbilityRun(6, 5);', context);

    const first = fiendStub('retreat');
    const second = fiendStub('retreat');
    context.spawnQueue = [];
    context.requeuedFiends = [first, second];
    context.fiends = [first, second];
    context.activeFiend = null;
    context.state.levelEnemies = 2;

    // remaining = 2; rank 5 -> min(6, 1) = 1: one requeued fiend is removed.
    assert.equal(vm.runInContext("activateAbility('storm')", context), true);
    assert.deepEqual(context.requeuedFiends, [second], 'the first requeued fiend is drained');
    assert.equal(context.state.enemiesDefeated, 0, 'removed enemies are not defeats');
    assert.equal(context.state.levelEnemies, 1, 'the removal leaves one enemy behind');
    assert.equal(context.__calls.triggerWaveClear, 0, 'one enemy always remains');
  });

  it('hands the wave-clear check off to triggerWaveClear when the queue empties', () => {
    const context = finishStartContext({ checkAllDefeated: () => true });
    vm.runInContext('finishStartLevel(0, { level: 6, chapter: 1, waveSize: 30 });', context);
    vm.runInContext('beginAbilityRun(6, 0);', context);

    context.spawnQueue = [6, 6];
    context.requeuedFiends = [];
    context.fiends = [];
    context.activeFiend = null;
    context.state.levelEnemies = 2;

    // remaining = 2; rank 0 -> min(1, 1) = 1: remove one queued enemy.
    assert.equal(vm.runInContext("activateAbility('storm')", context), true);
    assert.equal(context.state.enemiesDefeated, 0, 'removed enemies are not defeats');
    assert.equal(context.state.levelEnemies, 1, 'the removal leaves one enemy behind');
    assert.equal(context.__calls.triggerWaveClear, 1, 'checkAllDefeated() hands off to wave clear');
  });
});

describe('earth ability', () => {
  function spawnFiendStub(walkSpeed = 40) {
    const fiend = { walkSpeed, state: 'walk', spikeSlowed: false, problem: null };
    fiend.setState = (next) => { fiend.state = next; };
    fiend.on = () => {};
    return fiend;
  }

  it('activation starts the runtime spike and slows the active fiend once', () => {
    const context = finishStartContext();
    vm.runInContext('finishStartLevel(0, { level: 11, chapter: 1, waveSize: 3 });', context);
    const fiend = giveActiveFiend(context);
    fiend.walkSpeed = 100;
    context.state.enemiesDefeated = 2;
    context.state.score = 50;
    context.state.combo = 3;

    assert.equal(vm.runInContext("activateAbility('earth')", context), true);

    assert.deepEqual(readRuntime(context).spikeState, {
      active: true,
      remainingSeconds: 8,
      durationSeconds: 8,
      factor: 0.65,
      targets: 1,
    });
    assert.equal(fiend.walkSpeed, 65, 'the active fiend is slowed by 35 %');
    assert.equal(fiend.spikeBaseSpeed, 100, 'the base speed is stored');
    assert.equal(fiend.spikeSlowed, true);
    assert.equal(vm.runInContext('spikeSpawnSlowLeft', context), 1,
      'the active fiend does not spend a spawn slot');
    assert.equal(vm.runInContext('spikeSlowedFiends.size', context), 1);
    assert.equal(context.state.enemiesDefeated, 2, 'no enemy is removed');
    assert.equal(context.state.score, 50, 'score is untouched');
    assert.equal(context.state.combo, 3, 'combo is untouched');
  });

  it('repeated casts never compound the slow', () => {
    const context = finishStartContext();
    vm.runInContext('finishStartLevel(0, { level: 11, chapter: 1, waveSize: 3 });', context);
    const fiend = giveActiveFiend(context);
    fiend.walkSpeed = 100;

    assert.equal(vm.runInContext("activateAbility('earth')", context), true);
    const runtime = readRuntime(context);
    runtime.tick(180, { encounterRunning: true });
    assert.equal(vm.runInContext("activateAbility('earth')", context), true);

    assert.equal(fiend.walkSpeed, 65, 'still 0.65 of the original base');
    assert.equal(fiend.spikeBaseSpeed, 100);
    vm.runInContext('clearSpikeSlow();', context);
    assert.equal(fiend.walkSpeed, 100, 'one restore returns the original speed');
  });

  it('clears on level change, restoring every slowed fiend', () => {
    const context = finishStartContext();
    vm.runInContext('finishStartLevel(0, { level: 11, chapter: 1, waveSize: 3 });', context);
    const fiend = giveActiveFiend(context);
    fiend.walkSpeed = 100;
    assert.equal(vm.runInContext("activateAbility('earth')", context), true);

    vm.runInContext('finishStartLevel(1, { level: 12, chapter: 1, waveSize: 3 });', context);
    assert.equal(fiend.walkSpeed, 100);
    assert.equal(fiend.spikeSlowed, false);
    assert.equal(readRuntime(context).spikeState.active, false);
    assert.equal(vm.runInContext('spikeSpawnSlowLeft', context), 0);
  });

  it('clears on pause, restoring every slowed fiend', () => {
    const fiend = spawnFiendStub(100);
    applySpikeSlow(fiend, 0.65);
    const context = {
      applySpikeSlow,
      restoreSpikeSlow,
      abilityRuntime: createAbilityRuntime({ level: 11 }),
      spikeSlowedFiends: new Set([fiend]),
      spikeSpawnSlowLeft: 1,
      paused: false,
      gameRunning: true,
      pausedPartialId: null,
      createCompletionId: () => 'partial',
      closeAudioSettings() {},
      pauseActions: { style: {} },
      pauseQuitActions: { style: {} },
      pauseOverlay: { style: {} },
      input: { disable() {} },
      audio: { pauseBGM() {} },
      resetHealHold() {},
      syncKeepAwake() {},
    };
    vm.createContext(context);
    vm.runInContext(
      `${functionSource('pauseGame')}\n${functionSource('clearSpikeSlow')}`,
      context,
    );
    context.abilityRuntime.activate('earth');
    vm.runInContext('pauseGame();', context);

    assert.equal(context.paused, true);
    assert.equal(fiend.walkSpeed, 100);
    assert.equal(context.spikeSpawnSlowLeft, 0);
    assert.equal(context.spikeSlowedFiends.size, 0);
    assert.equal(context.abilityRuntime.spikeState.active, false);
  });

  it('slows only the runtime target count of subsequent spawns', () => {
    const context = {
      applySpikeSlow,
      spikeSpawnSlowLeft: 1,
      spikeSlowedFiends: new Set(),
      abilityRuntime: { spikeState: { active: true, factor: 0.65 } },
      state: { isShapesMode: false, timerMax: 10 },
      practiceRun: null,
      spawnQueue: [3, 3],
      requeuedFiends: [],
      fiends: [],
      CANVAS_W: 800,
      FIEND_PORTAL_X: 760,
      getFiendWalkSpeed: () => 40,
      createFiend: () => spawnFiendStub(),
      audio: { playFiendPortal: () => {} },
    };
    vm.createContext(context);
    vm.runInContext(functionSource('spawnNextFiend'), context);

    vm.runInContext('spawnNextFiend();', context);
    assert.equal(context.fiends[0].walkSpeed, 26, 'the next spawn is slowed');
    assert.equal(context.spikeSpawnSlowLeft, 0, 'one spawn slot is spent');
    assert.equal(context.spikeSlowedFiends.size, 1);

    context.fiends = [];
    vm.runInContext('spawnNextFiend();', context);
    assert.equal(context.fiends[0].walkSpeed, 40, 'the spawn after that is not slowed');
    assert.equal(context.spikeSpawnSlowLeft, 0);
  });

  it('opens a portal where the fiend appears', () => {
    const played = [];
    const cue = [];
    const context = {
      applySpikeSlow: () => false,
      spikeSpawnSlowLeft: 0, spikeSlowedFiends: new Set(),
      abilityRuntime: { spikeState: { active: false, factor: 0.65 } },
      state: { isShapesMode: false, timerMax: 10 },
      practiceRun: null,
      spawnQueue: [3],
      requeuedFiends: [],
      fiends: [],
      FIEND_PORTAL_X: 720,
      getFiendWalkSpeed: () => 40,
      createFiend: (level, x) => { const created = spawnFiendStub(); created.x = x; created.y = 360; return created; },
      ffmScreenFx: { play: (name, payload) => played.push([name, payload]) },
      globalThis: { ffmScreenFx: { play: (name, payload) => played.push([name, payload]) } },
      audio: { playFiendPortal: () => cue.push('portal') },
    };
    vm.createContext(context);
    vm.runInContext(functionSource('spawnNextFiend'), context);

    vm.runInContext('spawnNextFiend();', context);
    assert.equal(context.fiends[0].x, 720, 'the fiend materialises at the portal, not off-screen');
    assert.equal(played.length, 1, 'exactly one entrance effect plays');
    assert.equal(played[0][0], 'fiendPortal');
    assert.equal(cue.length, 1, 'the door is heard, not only seen');
    // Spread into a host object: the payload literal is created inside the vm realm,
    // so a cross-realm deepEqual would compare prototypes as well as values.
    assert.deepEqual({ ...played[0][1] }, { x: 720, y: context.fiends[0].y }, 'the effect is anchored to the fiend itself');
  });

  it('does not slow spawns once the spike is inactive', () => {
    const context = {
      applySpikeSlow,
      spikeSpawnSlowLeft: 1,
      spikeSlowedFiends: new Set(),
      abilityRuntime: { spikeState: { active: false, factor: 0.65 } },
      state: { isShapesMode: false, timerMax: 10 },
      practiceRun: null,
      spawnQueue: [3],
      requeuedFiends: [],
      fiends: [],
      CANVAS_W: 800,
      FIEND_PORTAL_X: 760,
      getFiendWalkSpeed: () => 40,
      createFiend: () => spawnFiendStub(),
      audio: { playFiendPortal: () => {} },
    };
    vm.createContext(context);
    vm.runInContext(functionSource('spawnNextFiend'), context);

    vm.runInContext('spawnNextFiend();', context);
    assert.equal(context.fiends[0].walkSpeed, 40);
    assert.equal(context.spikeSpawnSlowLeft, 1, 'an inactive spike spends nothing');
  });

  function requeueContext({ spikeActive }) {
    const fiend = spawnFiendStub(80);
    fiend.problem = {};
    fiend.spikeBaseSpeed = 80;
    fiend.spikeSlowed = true;
    const context = {
      applySpikeSlow,
      restoreSpikeSlow,
      pendingProblemActivation: { fiend, preserveTimer: true },
      lastCastAbility: null,
      abilityRuntime: { spikeState: { active: spikeActive, factor: 0.65 } },
      spikeSlowedFiends: new Set([fiend]),
      spikeSpawnSlowLeft: 1,
      practiceRun: null,
      getCurrentInputMode: () => 'multiple-choice',
      getFiendWalkSpeed: () => 50,
      getProblemTimerRemaining: (max) => max,
      state: { timerMax: 10, timerRemaining: 3, timerActive: false },
      activeFiend: null,
      answerClock: { reset() {} },
      input: { setMCOptions() {}, enable() {} },
    };
    vm.createContext(context);
    vm.runInContext(functionSource('activatePendingProblem'), context);
    return { context, fiend };
  }

  it('re-applies the slow to a requeued fiend from its fresh base speed', () => {
    const { context, fiend } = requeueContext({ spikeActive: true });
    context.activatePendingProblem();

    assert.equal(fiend.walkSpeed, 32.5, '0.65 of the fresh 50 px/s base, not of 52');
    assert.equal(fiend.spikeBaseSpeed, 50);
    assert.equal(fiend.spikeSlowed, true);
    assert.equal(context.spikeSlowedFiends.size, 1);
  });

  it('restores a requeued fiend when the spike is no longer active', () => {
    const { context, fiend } = requeueContext({ spikeActive: false });
    context.activatePendingProblem();

    assert.equal(fiend.walkSpeed, 50, 'the fresh base speed');
    assert.equal(fiend.spikeSlowed, false);
    assert.equal(context.spikeSlowedFiends.size, 0);
  });

  it('wires the slow into game over and the loop expiry guard', () => {
    assert.match(functionSource('triggerGameOver'), /clearSpikeSlow\(\);/);
    assert.match(
      functionSource('gameLoop'),
      /if \(abilityRuntime && !abilityRuntime\.spikeState\.active && spikeSlowedFiends\.size > 0\) \{\s*\n\s*clearSpikeSlow\(\);/,
    );
  });
});

describe('bar updates', () => {
  function trackingElement(tagName) {
    let text = '';
    let textWrites = 0;
    const element = {
      tagName: String(tagName).toUpperCase(),
      id: '',
      className: '',
      type: '',
      title: '',
      disabled: false,
      tabIndex: -1,
      dataset: {},
      children: [],
      parentNode: null,
      style: { setProperty() {} },
      appendChild(child) {
        child.parentNode = element;
        element.children.push(child);
        return child;
      },
      setAttribute() {},
      getAttribute() { return null; },
      removeAttribute() {},
      addEventListener() {},
      removeEventListener() {},
      remove() {},
    };
    Object.defineProperty(element, 'textContent', {
      get() { return text; },
      set(value) { text = String(value); textWrites += 1; },
      enumerable: true,
    });
    Object.defineProperty(element, 'textWrites', { get() { return textWrites; } });
    return element;
  }

  it('rewrites DOM text only when a value changes', () => {
    const chrome = trackingElement('section');
    chrome.id = 'gameplay-chrome';
    const doc = {
      getElementById: (id) => (id === 'gameplay-chrome' ? chrome : null),
      createElement: (tagName) => trackingElement(tagName),
    };
    const textWrites = (node) =>
      (node.textWrites ?? 0) + node.children.reduce((sum, child) => sum + textWrites(child), 0);

    const bar = createAbilityBar({ doc, translate: (key) => key });
    bar.update({ level: 11, progress: 1 });
    const before = textWrites(bar.element);

    bar.update({ level: 11, progress: 1 });
    bar.update({ level: 11, progress: 1 });
    assert.equal(textWrites(bar.element), before, 'unchanged progress must not touch DOM text');

    bar.update({ level: 11, progress: { wind: 0.5, storm: 1, earth: 1 } });
    assert.ok(textWrites(bar.element) > before, 'a cooling slot writes its remaining seconds');
  });
});
