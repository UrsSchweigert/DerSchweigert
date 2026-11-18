// wave-clear.test.js — a level must conclude whenever no encounter is left,
// including when the last one was blown off the field by wind or storm.
//
// Bug report: level 18 with every sword filled, no fiend spawning again and the
// level never ending. Wind and storm remove the active fiend with
// `blowTowardViewer()`, which leaves it alive in state 'idle' while the sprite
// flies to the camera. `checkAllDefeated()` therefore said "not yet" at cast
// time, the flight ended in `onFiendRetreated()` — and that removal, the last
// thing that happened in the level, ran no completion check at all. The level
// sat there with an empty queue and no way to conclude.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { isResolvedFiend } from './encounter-flow.js';

const source = readFileSync(new URL('./main.js', import.meta.url), 'utf8');

function functionSource(name) {
  const match = source.match(new RegExp(`function ${name}\\([^)]*\\)[\\s\\S]*?\\n\\}`));
  assert.ok(match, `${name} must exist in main.js`);
  return match[0];
}

// Mirrors the real Fiend: alive and state 'idle' for the whole flight, with the
// same `isLeaving` getter that entities.js exposes for `_blowAway`.
function fiend() {
  const stub = {
    hp: 1,
    state: 'walk',
    problem: { answer: 1 },
    wasRequeued: false,
    spikeSlowed: false,
    blownAway: false,
    isDead: false,
    get isLeaving() { return stub.blownAway; },
    setState(next) { stub.state = next; },
    blowTowardViewer() { stub.blownAway = true; stub.state = 'idle'; },
  };
  return stub;
}

function context() {
  const calls = { waveClear: 0, hud: 0, encounters: 0 };
  const ctx = {
    isResolvedFiend,
    state: { isShapesMode: false, enemiesDefeated: 0, levelEnemies: 0, timerActive: true },
    practiceRun: null,
    spawnQueue: [],
    requeuedFiends: [],
    fiends: [],
    activeFiend: null,
    pendingProblemActivation: null,
    inputDisabled: true,
    spawnTimer: 1,
    spawnInterval: 4,
    spikeSlowedFiends: new Set(),
    hud: { update() { calls.hud += 1; } },
    input: { disable() {}, enable() {} },
    recordPracticeEncounterDefeated() { calls.encounters += 1; },
    triggerWaveClear() { calls.waveClear += 1; },
    console: { warn() {} },
  };
  vm.createContext(ctx);
  vm.runInContext([
    functionSource('checkAllDefeated'),
    functionSource('removeActiveFiendForAbility'),
    functionSource('castWindAbility'),
    functionSource('onFiendRetreated'),
  ].join('\n'), ctx);
  ctx.__calls = calls;
  return ctx;
}

test('wind on the last encounter of a level concludes it once the fiend has left', () => {
  const ctx = context();
  const last = fiend();
  ctx.fiends = [last];
  ctx.activeFiend = last;

  assert.equal(ctx.castWindAbility(), true);
  assert.equal(last.blownAway, true, 'the sprite flies at the camera');
  assert.equal(last.state, 'idle', 'and is neither dead nor retreating while it does');
  assert.equal(ctx.checkAllDefeated(), false,
    'the field is not clear yet, so the sprite is not frozen mid-flight');
  assert.equal(ctx.__calls.waveClear, 0);

  // The flight ends and the fiend reports 'retreated'.
  ctx.onFiendRetreated(last);
  assert.equal(ctx.fiends.length, 0);
  assert.equal(ctx.__calls.waveClear, 1, 'the removal of the last encounter concludes the level');
});

test('storm that blows the last encounter away concludes the level the same way', () => {
  const ctx = context();
  const last = fiend();
  ctx.fiends = [last];
  ctx.activeFiend = last;
  ctx.state.levelEnemies = 1;

  ctx.removeActiveFiendForAbility('blow');
  ctx.state.levelEnemies -= 1;
  assert.equal(ctx.checkAllDefeated(), false, 'still flying out');
  ctx.onFiendRetreated(last);
  assert.equal(ctx.__calls.waveClear, 1);
});

test('a requeued fiend that retreats keeps the level open for its next round', () => {
  const ctx = context();
  const pending = fiend();
  ctx.fiends = [pending];
  ctx.requeuedFiends = [pending];
  ctx.activeFiend = pending;
  assert.equal(ctx.checkAllDefeated(), false, 'the wave continues with the requeued encounter');

  ctx.onFiendRetreated(pending);
  assert.equal(ctx.__calls.waveClear, 0, 'a requeue is not a level clear');
  assert.equal(ctx.requeuedFiends.length, 1, 'and it is still waiting to walk back on');
});

test('a level whose field clears with an empty queue always clears the wave', () => {
  const ctx = context();
  const leaving = fiend();
  ctx.fiends = [leaving];
  ctx.activeFiend = leaving;

  // The fixture the old code produced: the fiend is removed with nothing queued
  // and no other handler left to run a completion check.
  ctx.onFiendRetreated(leaving);
  assert.equal(ctx.__calls.waveClear, 1, 'the last removal concludes the level');
});

test('the encounter accounting and the projectile guard agree that a flying fiend is gone', () => {
  const flying = fiend();
  flying.blowTowardViewer();
  assert.equal(isResolvedFiend(flying), true);
  const entities = readFileSync(new URL('./entities.js', import.meta.url), 'utf8');
  assert.match(entities, /target\.isLeaving === true/,
    'a bolt in flight must not hit a fiend that wind or storm already defeated');
});
