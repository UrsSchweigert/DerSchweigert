// projectile-collision.test.js — the app build resolves hero spell hits from
// the projectile's own swept collision against the fiend's visible sprite
// bounds, instead of a delayed damage timer. The web build keeps its timers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

globalThis.Image = class FakeImage {
  constructor() {
    this.src = '';
    this.complete = true;
    this.naturalWidth = 100;
    this.naturalHeight = 100;
  }
};

const { Fiend, Slimeling, Fireball, LightningBolt } = await import('./entities.js');
const { GROUND_Y } = await import('./renderer.js');

const source = fs.readFileSync(new URL('./main.js', import.meta.url), 'utf8');
const PALETTE = { body: '#f07030', dark: '#a04010', hi: '#ffb060' };

function createFiend({ x = 500, hp = 2, state = 'idle' } = {}) {
  const fiend = new Fiend(x, GROUND_Y, { hp, palette: PALETTE, fiendClassId: 3 });
  fiend.setState(state);
  return fiend;
}

function captureContext() {
  const drawn = [];
  const ctx = {
    fillStyle: '',
    globalAlpha: 1,
    save() {}, restore() {}, translate() {}, scale() {},
    beginPath() {}, ellipse() {}, fill() {}, moveTo() {}, lineTo() {}, closePath() {}, arc() {},
    fillRect() {},
    // the class-sprite path draws the shared soft ground shadow (drawSoftShadow)
    createRadialGradient() { return { addColorStop() {} }; },
    drawImage(img, ...args) { drawn.push(args); },
  };
  return { ctx, drawn };
}

test('hit bounds are exactly the box the class sprite is drawn into', () => {
  const fiend = new Slimeling(500, GROUND_Y);
  fiend.fiendClassId = 3;
  const { ctx, drawn } = captureContext();
  fiend.draw(ctx);

  assert.equal(drawn.length, 1, 'the class sprite is drawn once');
  const [bx, by, drawW, drawH] = drawn[0];
  const bounds = fiend.getHitBounds();
  assert.deepEqual(bounds, {
    left: bx,
    right: bx + drawW,
    top: by,
    bottom: by + drawH,
  });
  assert.ok(bounds.right - bounds.left > 0);
  assert.ok(bounds.bottom - bounds.top > 0);
});

test('a single huge dt step past a fast fiend lands exactly one hit', () => {
  const fiend = createFiend({ x: 500 });
  let hits = 0;
  // Start left of the fiend and end far right of it in one step: without a
  // swept test the endpoint check would miss the bounds entirely.
  const fireball = new Fireball(0, 250, 1000, 250, {
    target: fiend,
    onHit: () => { hits++; },
  });

  fireball.update(10);

  assert.equal(hits, 1, 'the swept segment crosses the fiend exactly once');
  assert.ok(fireball.isDone, 'the projectile ends on impact');
  fireball.update(10);
  assert.equal(hits, 1, 'an already-resolved projectile never hits again');
});

test('a fast fiend crossing the projectile in one step still registers one hit', () => {
  const fiend = createFiend({ x: 500 });
  let hits = 0;
  // A nearly stationary projectile: it does not sweep across the fiend itself,
  // so only the fiend's own motion can bring it into contact.
  const fireball = new Fireball(400, 250, 401, 250, {
    target: fiend,
    onHit: () => { hits++; },
  });

  fireball.update(0.01);
  assert.equal(hits, 0, 'no contact while the fiend is still to the right');

  fiend.x = 200; // the fiend dashes past the projectile between frames
  fireball.update(0.01);
  assert.equal(hits, 1, 'the fiend cannot tunnel through the projectile');
  fireball.update(0.01);
  assert.equal(hits, 1, 'still exactly one hit');
});

test('a nonlethal hit applies damage, reaction and sound once and keeps the fiend alive', () => {
  const fiend = createFiend({ hp: 2 });
  let hits = 0;
  let sounds = 0;
  const fireball = new Fireball(0, 250, 1000, 250, {
    target: fiend,
    onHit: () => { hits++; sounds++; fiend.hit(); },
  });

  fireball.update(10);

  assert.equal(hits, 1);
  assert.equal(sounds, 1);
  assert.equal(fiend.hp, 1, 'exactly one damage point');
  assert.equal(fiend.isDead, false);
  assert.equal(fiend.state, 'hit', 'the fiend shows its hit reaction');

  fireball.update(10);
  assert.equal(hits, 1, 'no second damage, sound or reaction');
  assert.equal(fiend.hp, 1);
});

test('dead and stale targets end the projectile without damage or sound', () => {
  for (const state of ['idle', 'death', 'retreat']) {
    const fiend = createFiend({ hp: state === 'idle' ? 0 : 2, state });
    let hits = 0;
    const bolt = new LightningBolt(0, 250, 1000, 250, {
      target: fiend,
      onHit: () => { hits++; fiend.hit(); },
    });

    bolt.update(10);

    assert.equal(hits, 0, `${state} target never resolves a hit`);
    assert.ok(bolt.isDone, `${state} target ends the projectile`);
    assert.equal(fiend.hp, state === 'idle' ? 0 : 2, 'no damage applied');
  }
});

test('a target-less projectile keeps its timer-driven life (web path)', () => {
  const fireball = new Fireball(0, 250, 1000, 250);
  fireball.update(0.5);
  assert.equal(fireball.isDone, false);
  fireball.update(1);
  assert.ok(fireball.isDone, 'the caller timer still owns the web hit');
});

test('the web build keeps its arrival timers behind the app collision gate', () => {
  assert.match(source, /const collides = platform\.isApp;/);
  assert.match(source, /if \(!collides\) scheduleGameplayTimeout\(\(\) => resolveLightningHit\(fiend\), 600\);/);
  assert.match(source, /if \(!collides\) scheduleGameplayTimeout\(\(\) => resolveFireballHit\(fiend\), FIREBALL_FLIGHT_MS\);/);
  assert.match(source, /\{ target: fiend, onHit: \(\) => resolveLightningHit\(fiend\) \}/);
  assert.match(source, /\{ target: fiend, onHit: \(\) => resolveFireballHit\(fiend\) \}/);
});

test('pause freezes in-flight projectiles and game over drops them', () => {
  assert.match(source, /if \(gameRunning && !paused\) \{[\s\S]*?activeLightningBolts = activeLightningBolts\.filter/);
  assert.match(source, /if \(gameRunning && !paused\) \{[\s\S]*?activeFireballs = activeFireballs\.filter/);
  assert.match(source, /function triggerGameOver[\s\S]*?activeLightningBolts = \[\];/);
});

test('quitting clears in-flight projectiles so no collision callback survives', () => {
  const context = {
    state: { timerActive: true, isShapesMode: false },
    activeLightningBolts: [{ update() { context.hit = true; } }],
    activeFireballs: [{ update() { context.hit = true; } }],
    activeDragons: [{}],
    gameplayTimers: [{ callback() { context.hit = true; }, remaining: 0.1 }],
    levelRequestGeneration: 0,
    platform: { incrementRequestGeneration() {}, setCurrentLevelConfig() {} },
    input: { disable() {} },
    practiceRun: null,
    checkoutModal: null,
    diffSelect: { style: {} },
    topBar: { style: {} },
    audio: { stopBGM() {} },
    setAnswerInputVisible() {}, setAccountModalVisible() {}, hideLoadingOverlay() {},
    syncKeepAwake() {}, updateHUDLogoutVisibility() {},
  };
  vm.createContext(context);
  const body = source.match(/function clearPremiumSession\(\)[\s\S]*?\n\}/)[0];
  vm.runInContext(body, context);
  vm.runInContext('clearPremiumSession();', context);

  assert.equal(context.activeLightningBolts.length, 0);
  assert.equal(context.activeFireballs.length, 0);
  assert.equal(context.activeDragons.length, 0);
  assert.equal(context.gameplayTimers.length, 0);
  assert.equal(context.hit, undefined);
});
