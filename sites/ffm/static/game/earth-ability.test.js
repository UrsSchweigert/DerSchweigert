// earth-ability.test.js — what the earth spike and the hit-point halos do on
// screen, and what they must not do.
//
// Three findings drove these tests:
//   * the slow only scaled the walk-in, never the problem clock, so a slowed
//     fiend fell behind its own timer and the spell bought no answering time;
//   * the dust aura was anchored to whatever fiend was active (or to the hero),
//     so it never said which fiends the spike actually held;
//   * the slow was dropped before a wrong-answer requeue, so a slowed fiend
//     came back at full speed although the code claimed to re-apply it.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

import { createAbilityRuntime, applySpikeSlow, restoreSpikeSlow } from './cooldown-abilities.js';
import { countDragonRemainingEncounters } from './encounter-flow.js';

globalThis.Image ??= class {
  constructor() { this.complete = true; this.naturalWidth = 64; this.naturalHeight = 64; }
};
const { Fiend } = await import('./entities.js');

const source = readFileSync(new URL('./main.js', import.meta.url), 'utf8');

function functionSource(name) {
  const match = source.match(new RegExp(`function ${name}\\([^)]*\\)[\\s\\S]*?\\n\\}`));
  assert.ok(match, `${name} must exist in main.js`);
  return match[0];
}

const EXTRACTED = [
  'remainingEnemyCount',
  'abilityCastOrigin',
  'playAbilityCastFeedback',
  'startSpikeAura',
  'stopSpikeAura',
  'castEarthAbility',
  'clearSpikeSlow',
  'activateAbility',
  'onFiendRetreated',
  'activatePendingProblem',
  'updateTimer',
  'checkAllDefeated',
];

function setup(runtimeOptions = { level: 20 }) {
  const calls = { effects: [], casts: 0, waveClear: 0, wrongAnswers: 0 };
  const emitters = [];
  const state = {
    isShapesMode: false, enemiesDefeated: 0, levelEnemies: 1, timerActive: true,
    timerMax: 10, timerRemaining: 10,
  };
  const context = {
    HERO_X: 110,
    GROUND_Y: 380,
    HERO_CENTRE_ABOVE_GROUND: 78,
    LOGICAL_PX: 4,
    createAbilityRuntime,
    applySpikeSlow,
    restoreSpikeSlow,
    countDragonRemainingEncounters,
    answerClock: { reset() {} },
    hero: { y: 380 },
    activeLightningBolts: [],
    activeFireballs: [],
    activeDragons: [],
    heroLunge: null,
    dragonFinishResolved: false,
    spikeSlowedFiends: new Set(),
    ffmScreenFx: {
      play(name, payload) { calls.effects.push({ name, payload }); },
      emitter(duration, rate, fn) {
        const emitter = { duration, rate, fn };
        emitters.push(emitter);
        return emitter;
      },
    },
    ffmFx: {
      fiendCentre(fiend) { return fiend ? { x: fiend.x, y: fiend.y - 60 } : null; },
    },
    // Only the functions these seams touch; anything else throws by design.
    audio: { playAbilityCast() { calls.casts += 1; } },
    hud: { update() {} },
    input: { disable() {}, enable() {}, setMCOptions() {} },
    platform: { getCurrentLevelConfig: () => ({ fiendHP: 1 }) },
    console: { warn() {} },
    t: (key) => key,
    getCurrentInputMode: () => 'multiple-choice',
    generateProblem: () => ({ answer: 1 }),
    state,
    practiceRun: null,
    spawnQueue: [],
    requeuedFiends: [],
    fiends: [],
    activeFiend: null,
    pendingProblemActivation: null,
    inputDisabled: false,
    spawnTimer: 1,
    spawnInterval: 4,
    getProblemTimerRemaining: (max) => max,
    getFiendWalkSpeed: (timerMax, _x, scale = 1) => 50 * scale,
    triggerWaveClear() { calls.waveClear += 1; },
    handleWrongAnswer() { calls.wrongAnswers += 1; },
  };
  vm.createContext(context);
  vm.runInContext([
    'let abilityRuntime = null;',
    'let spikeAuraToken = 0;',
    'let spikeSlowedFiends = new Set();',
    'let spikeSpawnSlowLeft = 0;',
    'let lastCastAbility = null;',
    ...EXTRACTED.map(functionSource),
  ].join('\n'), context);

  const run = (code) => vm.runInContext(code, context);
  run(`abilityRuntime = createAbilityRuntime(${JSON.stringify(runtimeOptions)});`);
  return { context, calls, emitters, state, run };
}

function slowedFiend(x = 520, walkSpeed = 50) {
  const fiend = {
    x, y: 380, walkSpeed, isDead: false, state: 'walk', hp: 2, problem: { answer: 1 },
  };
  fiend.setState = (next) => { fiend.state = next; };
  applySpikeSlow(fiend, 0.65);
  return fiend;
}

describe('earth spike', () => {
  it('refuses a cast with nothing left to slow instead of spending the cooldown', () => {
    const { context, run } = setup();
    context.remainingEnemyCount = () => 0;
    assert.equal(run("activateAbility('earth')"), false);
    assert.equal(run("abilityRuntime.progress('earth')"), 1, 'a refused cast leaves the orb ready');
  });

  it('casts when only the spawn budget can be held', () => {
    const { context, run } = setup();
    context.remainingEnemyCount = () => 3;
    context.activeFiend = null;
    assert.equal(run("activateAbility('earth')"), true);
    assert.equal(run('abilityRuntime.spikeState.active'), true);
  });

  it('pulses the aura at every slowed fiend instead of at the active one', () => {
    const { context, calls, emitters, run } = setup();
    const first = slowedFiend(520);
    const second = slowedFiend(610);
    context.activeFiend = first;
    context.fiends = [first, second];
    context.__others = [second];

    assert.equal(run("activateAbility('earth')"), true);
    assert.equal(run('spikeSlowedFiends.size'), 1, 'the cast takes the active fiend');
    run('spikeSlowedFiends.add(__others[0]);');

    emitters[0].fn(0.25);
    const pulses = calls.effects.filter((effect) => effect.name === 'spikeAura');
    assert.equal(pulses.length, 2, 'one pulse per slowed fiend');
    assert.deepEqual(pulses.map((p) => p.payload.x).sort((a, b) => a - b), [520, 610]);
    assert.equal(pulses[0].payload.progress, 0.25, 'the emitter clock still sizes the pulse');
    assert.ok(pulses.every((p) => p.payload.x !== context.HERO_X),
      'the aura never falls back to the hero, where nothing is slowed');

    context.activeFiend = null;
    calls.effects.length = 0;
    emitters[0].fn(0.4);
    assert.equal(calls.effects.length, 2, 'it keeps pulsing on the slowed fiends while none is active');
  });

  it('scales the problem clock of a slowed fiend only', () => {
    const { context, state, run } = setup({ level: 20, spikeSlow: { durationSeconds: 8, factor: 0.5 } });
    run('abilityRuntime.activate("earth");');
    context.activeFiend = slowedFiend();
    run('updateTimer(1);');
    assert.equal(state.timerRemaining, 9.5, 'the spike halves the clock it was cast against');

    context.activeFiend = { x: 520, y: 380, walkSpeed: 50, isDead: false, state: 'walk', hp: 1 };
    state.timerRemaining = 10;
    run('updateTimer(1);');
    assert.equal(state.timerRemaining, 9, 'an unslowed fiend keeps the full-speed clock');
  });

  it('stops scaling the clock as soon as the spike ends', () => {
    const { context, state, run } = setup({ level: 20, spikeSlow: { durationSeconds: 1, factor: 0.5 } });
    run('abilityRuntime.activate("earth");');
    context.activeFiend = slowedFiend();
    run('abilityRuntime.tick(1, { encounterRunning: true });');
    assert.equal(run('abilityRuntime.spikeState.active'), false);
    state.timerRemaining = 10;
    run('updateTimer(1);');
    assert.equal(state.timerRemaining, 9, 'the clock is back to normal time');
  });

  it('keeps its hold on a fiend that a wrong answer sends back', () => {
    const { context, run } = setup();
    run('abilityRuntime.activate("earth");');
    const fiend = slowedFiend();
    context.fiends = [fiend];
    context.activeFiend = fiend;
    run('spikeSlowedFiends.add(activeFiend);');
    context.requeuedFiends = [fiend];

    context.onFiendRetreated(fiend);
    assert.equal(fiend.spikeSlowOnReturn, true, 'the requeue remembers the slow');
    assert.equal(fiend.walkSpeed, 50, 'the walk-off is not crawling');
    assert.equal(fiend.spikeSlowed, false);
  });

  it('re-applies the remembered slow when the fiend walks back on', () => {
    const { context, run } = setup();
    run('abilityRuntime.activate("earth");');
    const fiend = slowedFiend();
    fiend.spikeSlowed = false;
    delete fiend.spikeBaseSpeed;
    fiend.spikeSlowOnReturn = true;
    context.pendingProblemActivation = { fiend, preserveTimer: false };

    run('activatePendingProblem();');
    assert.equal(fiend.spikeSlowed, true, 'the spike takes hold again');
    assert.ok(fiend.walkSpeed < 50, 'the approach is slow again');
    assert.equal(fiend.spikeSlowOnReturn, undefined, 'the marker is consumed');
    assert.equal(context.activeFiend, fiend);
  });

  it('lets the slow go when the spike has ended while the fiend was away', () => {
    const { context, run } = setup();
    run('abilityRuntime.activate("earth");');
    run('abilityRuntime.tick(180, { encounterRunning: true });');
    const fiend = slowedFiend();
    fiend.spikeSlowed = false;
    delete fiend.spikeBaseSpeed;
    fiend.spikeSlowOnReturn = true;
    context.pendingProblemActivation = { fiend, preserveTimer: false };
    run('activatePendingProblem();');
    assert.equal(fiend.spikeSlowed, false, 'a dead spike holds nothing');
    assert.equal(fiend.walkSpeed, 50, 'and the fiend walks at its own pace');
  });
});

describe('hit-point halos', () => {
  // A halo is one *filled* ring (plus a stroked brass rim), while the burst
  // ring and the slow marker are stroked only; counting fills therefore counts
  // halos, and the ellipse total counts everything drawn.
  function recordingCtx(rings) {
    const ctx = {
      rings,
      save() {}, restore() {}, beginPath() {}, stroke() {},
      fill() { rings.fills += 1; },
      ellipse(...args) { rings.ellipses.push(args); },
      fillRect() {}, arc() {}, drawImage() {},
      set fillStyle(_v) {}, get fillStyle() { return null; },
      set strokeStyle(_v) {}, get strokeStyle() { return null; },
      set lineWidth(_v) {}, get lineWidth() { return 0; },
      set globalAlpha(_v) {}, get globalAlpha() { return 1; },
    };
    return ctx;
  }

  function draw(fiend) {
    const rings = { fills: 0, ellipses: [] };
    fiend.draw(recordingCtx(rings));
    return rings;
  }

  const palette = { body: '#000', dark: '#000', hi: '#000' };

  it('draws one halo per remaining hit point and bursts the one a hit destroys', () => {
    const fiend = new Fiend(400, 380, { hp: 3, palette });
    assert.equal(draw(fiend).fills, 3, 'a three-hit fiend shows three halos');

    fiend.hit();
    assert.equal(fiend.hp, 2);
    assert.equal(fiend._haloBursts.length, 1, 'the destroyed halo bursts');
    const afterHit = draw(fiend);
    assert.equal(afterHit.fills, 2, 'two halos are left to count');
    assert.equal(afterHit.ellipses.length, 2 * 2 + 1, 'and the burst ring is drawn as well');

    fiend.hit();
    assert.equal(fiend._haloBursts.length, 2);
    fiend.hit();
    assert.equal(fiend.hp, 0);
    assert.equal(fiend.state, 'death');
  });

  it('leaves a one-hit fiend halo-free, so halos themselves mean "more than one answer"', () => {
    const fiend = new Fiend(400, 380, { hp: 1, palette });
    assert.equal(draw(fiend).fills, 0);
  });

  it('marks a slowed fiend at its feet only while it is slowed', () => {
    const fiend = new Fiend(400, 380, { hp: 2, palette });
    const plain = draw(fiend).ellipses.length;
    applySpikeSlow(fiend, 0.65);
    assert.equal(draw(fiend).ellipses.length, plain + 1, 'the spike ring is the extra ellipse');
    restoreSpikeSlow(fiend);
    assert.equal(draw(fiend).ellipses.length, plain, 'and it disappears with the slow');
  });

  it('lets the burst expire instead of accumulating rings', () => {
    const fiend = new Fiend(400, 380, { hp: 2, palette });
    fiend.hit();
    assert.equal(fiend._haloBursts.length, 1);
    fiend.update(1);
    assert.equal(fiend._haloBursts.length, 0, 'the shards fade within a second');
  });
});
