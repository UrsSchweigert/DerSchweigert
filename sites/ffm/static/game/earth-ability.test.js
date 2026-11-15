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
import { createEffectTable } from './screen-fx-effects.js';
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
  // The halos are emitted through the screen-fx layer now, so a fake layer is
  // enough to see how many hit points are announced and what a hit spends.
  function layer() {
    const plays = [];
    return { plays, play(name, payload) { plays.push({ name, payload }); return true; } };
  }

  function withLayer(fiend, run) {
    const fx = layer();
    globalThis.ffmScreenFx = fx;
    try {
      run(fiend, fx);
    } finally {
      delete globalThis.ffmScreenFx;
    }
    return fx;
  }

  const palette = { body: '#000', dark: '#000', hi: '#000' };

  it('holds one ring per remaining hit point and bursts the one a hit destroys', () => {
    // Rings are persistent now: exactly one particle per answer still owed, so
    // the count on screen cannot drift from the count of questions left.
    const fiend = new Fiend(400, 380, { hp: 3, palette });
    const rings = [];
    const fx = {
      plays: [],
      ring() { const ring = { life: 1, maxLife: 1, x: 0, y: 0 }; rings.push(ring); return ring; },
      play(name, payload) { this.plays.push({ name, payload }); return true; },
    };
    globalThis.ffmScreenFx = fx;
    try {
      fiend.update(1 / 60);
      assert.equal(rings.length, 3, 'a three-hit fiend holds three rings');
      assert.ok(rings.every((ring) => ring.life === ring.maxLife), 'held at full alpha, so it does not blink');

      fiend.hit();
      assert.equal(fx.plays.filter((p) => p.name === 'hitPointBurst').length, 1,
        'exactly the ring the hit destroyed explodes');
      assert.equal(fiend.hp, 2);
      fiend.update(1 / 60);
      assert.equal(rings.filter((ring) => ring.life > 0).length, 2,
        'and only the answers still owed are shown');

      // The last answer still shows its bead: "1 left" is information.
      fiend.hit();
      fiend.update(1 / 60);
      assert.equal(rings.filter((ring) => ring.life > 0).length, 1,
        'the final answer keeps its bead');

      // A hit that finishes the fiend takes every ring with it.
      fiend.hit();
      fiend.update(1 / 60);
      assert.equal(rings.filter((ring) => ring.life > 0).length, 0);
    } finally {
      delete globalThis.ffmScreenFx;
    }
  });

  it('counts down one bead per hit, all the way to the last answer', () => {
    // 3 HP: 3 → 2 → 1 → gone. 2 HP: 2 → 1 → gone. The beads are the answers
    // still owed, so the last one must not vanish a hit early.
    for (const [hp, expected] of [[3, [3, 2, 1, 0]], [2, [2, 1, 0]]]) {
      const fiend = new Fiend(400, 380, { hp, palette });
      const beads = [];
      const fx = {
        halo(x, y, color, radius, life) {
          const bead = { type: 'halo', life, maxLife: life, x, y, radius, pulse: 1, spin: 0, color };
          beads.push(bead);
          return bead;
        },
        play() { return true; },
      };
      globalThis.ffmScreenFx = fx;
      try {
        fiend.update(1 / 60);
        const seen = [beads.filter((bead) => bead.life > 0).length];
        while (fiend.hp > 0) {
          fiend.hit();
          fiend.update(1 / 60);
          seen.push(beads.filter((bead) => bead.life > 0).length);
        }
        assert.deepEqual(seen, expected, `${hp} HP counts down one at a time`);
      } finally {
        delete globalThis.ffmScreenFx;
      }
    }
  });

  it('leaves a one-hit fiend halo-free, so halos themselves mean "more than one answer"', () => {
    const fiend = new Fiend(400, 380, { hp: 1, palette });
    const fx = withLayer(fiend, (target) => target.update(0.13));
    assert.equal(fx.plays.length, 0);
  });

  it('sparkles the feet of a slowed fiend only while it is slowed', () => {
    const fiend = new Fiend(400, 380, { hp: 2, palette });
    applySpikeSlow(fiend, 0.65);
    const slowed = withLayer(fiend, (target) => target.update(0.13));
    assert.equal(slowed.plays.filter((p) => p.name === 'spikeSparkle').length, 1);

    restoreSpikeSlow(fiend);
    const plain = withLayer(fiend, (target) => target.update(0.13));
    assert.equal(plain.plays.filter((p) => p.name === 'spikeSparkle').length, 0);
  });

  it('holds the bead as one halo particle per hit point, breathing and turning', () => {
    const fiend = new Fiend(400, 380, { hp: 3, palette });
    const beads = [];
    const fx = {
      plays: [],
      halo(x, y, color, radius, life) {
        const bead = {
          type: 'halo', life, maxLife: life, x, y, radius, pulse: 1, spin: 0, color,
        };
        beads.push(bead);
        return bead;
      },
      play(name, payload) { this.plays.push({ name, payload }); return true; },
    };
    globalThis.ffmScreenFx = fx;
    try {
      fiend.update(1 / 60);
      assert.equal(beads.length, 3, 'one glowing bead per answer still owed');
      assert.ok(beads.every((bead) => bead.life === bead.maxLife), 'held, so the count never blinks');
      const firstSpins = beads.map((bead) => bead.spin);
      const firstPulses = beads.map((bead) => bead.pulse);

      fiend.update(0.25);
      assert.equal(beads.length, 3, 'no re-emission: the beads are the same three particles');
      assert.ok(beads.some((bead, i) => bead.spin !== firstSpins[i]), 'they turn');
      assert.ok(beads.some((bead, i) => bead.pulse !== firstPulses[i]), 'and breathe');

      fiend.hit();
      fiend.update(1 / 60);
      assert.equal(beads.filter((bead) => bead.life > 0).length, 2,
        'a hit spends exactly one bead');
    } finally {
      delete globalThis.ffmScreenFx;
    }
  });

  it('sheds sparkles from every bead, at the bead, without a gradient', () => {
    const fiend = new Fiend(400, 380, { hp: 3, palette });
    const plays = [];
    const fx = {
      halo() { return { type: 'halo', life: 1, maxLife: 1 }; },
      play(name, payload) { plays.push({ name, payload }); return true; },
    };
    globalThis.ffmScreenFx = fx;
    try {
      for (let i = 0; i < 72; i++) fiend.update(1 / 60);
      const sparkles = plays.filter((p) => p.name === 'haloSparkle');
      // Three beads at one sparkle each ~160 ms over 1.2 s: a dozen at the very
      // least, so the light is visibly moving between frames.
      assert.ok(sparkles.length >= 12, `expected a steady sparkle, saw ${sparkles.length}`);
      assert.ok(sparkles.every((p) => Number.isFinite(p.payload.x) && p.payload.radius > 0),
        'every sparkle is placed on the bead it belongs to');

      fiend.hit();
      fiend.hit();
      assert.equal(plays.filter((p) => p.name === 'hitPointBurst').length, 2,
        'each spent point burst where it floated');

      // The last answer still has its bead, so its sparkle keeps going.
      const beforeLast = plays.filter((p) => p.name === 'haloSparkle').length;
      for (let i = 0; i < 30; i++) fiend.update(1 / 60);
      const withLast = plays.filter((p) => p.name === 'haloSparkle').length;
      assert.ok(withLast > beforeLast, 'the last bead still sparkles');

      // The hit that finishes the fiend takes the bead, and its sparkle, with it.
      fiend.hit();
      for (let i = 0; i < 30; i++) fiend.update(1 / 60);
      assert.equal(plays.filter((p) => p.name === 'haloSparkle').length, withLast,
        'a dead fiend has no bead left to sparkle');
    } finally {
      delete globalThis.ffmScreenFx;
    }
  });

  it('falls back to a plain ring when the layer has no halo sprite', () => {
    const fiend = new Fiend(400, 380, { hp: 2, palette });
    const rings = [];
    const fx = {
      ring(x, y, color, r0, r1, life) {
        const ring = { type: 'ring', x, y, r0, r1, life, maxLife: life };
        rings.push(ring);
        return ring;
      },
      play() { return true; },
    };
    globalThis.ffmScreenFx = fx;
    try {
      fiend.update(1 / 60);
      assert.equal(rings.length, 2);
      assert.ok(rings.every((ring) => ring.life === ring.maxLife));
    } finally {
      delete globalThis.ffmScreenFx;
    }
  });

  it('draws nothing on the canvas for hit points or the slow', () => {
    const fiend = new Fiend(400, 380, { hp: 3, palette });
    applySpikeSlow(fiend, 0.65);
    const rings = { fills: 0, ellipses: [] };
    const ctx = {
      save() {}, restore() {}, beginPath() {}, stroke() {},
      fill() { rings.fills += 1; },
      ellipse(...args) { rings.ellipses.push(args); },
      fillRect() {}, arc() {}, drawImage() {},
      set fillStyle(_v) {}, get fillStyle() { return null; },
      set strokeStyle(_v) {}, get strokeStyle() { return null; },
      set lineWidth(_v) {}, get lineWidth() { return 0; },
      set globalAlpha(_v) {}, get globalAlpha() { return 1; },
    };
    withLayer(fiend, (target) => target.draw(ctx));
    assert.equal(rings.fills, 0, 'no filled halo discs any more');
    assert.equal(rings.ellipses.length, 0, 'and no drawn rings either');
  });
});

describe('the multi-hit level storm', () => {
  function stormContext() {
    const plays = [];
    const timers = [];
    const fx = {
      play(name, payload) { plays.push({ name, payload }); return true; },
      schedule(seconds, fn) { timers.push({ seconds, fn }); return { at: seconds }; },
    };
    const ctx = { globalThis: { ffmStormFx: fx }, CANVAS_W: 800, Math };
    vm.createContext(ctx);
    vm.runInContext([
      'let stormToken = 0;',
      functionSource('stopStorm'),
      functionSource('startStorm'),
    ].join('\n'), ctx);
    return { ctx, plays, timers, fx };
  }

  function runTimers(timers, times = 1) {
    for (let i = 0; i < times; i++) {
      const due = timers.splice(0, timers.length);
      for (const timer of due) timer.fn();
    }
  }

  it('arms the storm only for a level whose fiends take more than one answer', () => {
    const single = stormContext();
    assert.equal(single.ctx.startStorm({ fiendHP: 1 }), false);
    assert.equal(single.timers.length, 0, 'a one-hit level stays in clear weather');

    const multi = stormContext();
    assert.equal(multi.ctx.startStorm({ fiendHP: 2 }), true);
    assert.equal(multi.timers.length, 1, 'the first tick is scheduled');
    runTimers(multi.timers, 3);
    assert.ok(multi.plays.some((p) => p.name === 'stormRain'), 'it rains');
    assert.equal(multi.timers.length, 1, 'and keeps rescheduling itself');
  });

  it('stops for good when the level ends, wherever the storm was', () => {
    const { ctx, plays, timers } = stormContext();
    ctx.startStorm({ fiendHP: 3 });
    runTimers(timers, 2);
    const before = plays.length;
    ctx.stopStorm();
    runTimers(timers, 3);
    assert.equal(plays.length, before, 'no tick survives the level ending');
  });

  it('never storms in practice, which passes no level config', () => {
    const { ctx, timers } = stormContext();
    assert.equal(ctx.startStorm(null), false);
    assert.equal(timers.length, 0);
  });
});

describe('the spike reaches every target it promises', () => {
  it('keeps a window per target instead of one shared countdown', () => {
    // The timeout used to outlive the spell: two answers at five seconds each
    // already ran past the eight-second spike, so the second fiend spawned into
    // clear weather although the orb read "x3".
    const runtime = createAbilityRuntime({ level: 20, spikeSlow: { targets: 3, durationSeconds: 8, factor: 0.65 } });
    runtime.activate('earth');
    runtime.tick(10, { encounterRunning: true });
    assert.equal(runtime.spikeState.active, false, 'the first window does run out');

    // A spawn that the budget holds refreshes the countdown for its own window.
    const second = createAbilityRuntime({ level: 20, spikeSlow: { targets: 3, durationSeconds: 8, factor: 0.65 } });
    second.activate('earth');
    second.tick(6, { encounterRunning: true });
    assert.equal(second.refreshSpike(), true);
    assert.equal(second.spikeState.remainingSeconds, 8, 'the next target starts its own eight seconds');
    second.tick(7, { encounterRunning: true });
    assert.equal(second.spikeState.active, true, 'so the second fiend is still held when it arrives');
  });

  it('refreshes only while a spike is running', () => {
    const runtime = createAbilityRuntime({ level: 20 });
    assert.equal(runtime.refreshSpike(), false);
  });
});

describe('the storm steps the particle layer at 30 Hz', () => {
  function stepOf(dt, storm, carry) {
    const ctx = { Number, Math };
    vm.createContext(ctx);
    vm.runInContext([
      'const FX_STORM_STEP_SECONDS = 1 / 30;',
      'const FX_MAX_STEP_SECONDS = 1 / 20;',
      functionSource('fxStepFor'),
    ].join('\n'), ctx);
    return ctx.fxStepFor(dt, storm, carry);
  }

  it('runs one particle step every other frame at 60 fps', () => {
    let carry = 0;
    let steps = 0;
    for (let i = 0; i < 60; i++) {
      const out = stepOf(1 / 60, true, carry);
      carry = out.carry;
      if (out.step > 0) steps += 1;
    }
    assert.equal(steps, 30, 'sixty rendered frames advance the layer thirty times');
  });

  it('keeps the full rate when no storm is running', () => {
    for (let i = 0; i < 60; i++) {
      const out = stepOf(1 / 60, false, 0);
      assert.equal(out.step, 1 / 60, 'every frame steps the layer');
      assert.equal(out.carry, 0);
    }
  });

  it('caps a long hitch so the storm cannot jump, and keeps the remainder', () => {
    const out = stepOf(0.25, true, 0);
    assert.equal(out.step, 1 / 20, 'a stalled frame advances at most 50 ms');
    assert.ok(out.carry > 0, 'and the rest is carried, not dropped');
  });
});
