// screen-fx-effects.test.js — the Arithmo Slayer effect recipes stay safe,
// recognisable and intensity-aware. The fake document/canvas fixture mirrors
// the one in screen-fx.test.js so the recipes run headless in Node.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createScreenFx } from './screen-fx.js';
import { createEffectTable, EFFECT_NAMES, PALETTES } from './screen-fx-effects.js';

function recordingContext() {
  const ctx = {
    calls: [],
    imageSmoothingEnabled: true,
    filter: 'none',
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    fillStyle: '#000000',
    strokeStyle: '#000000',
    lineWidth: 1,
    lineCap: 'butt',
  };
  const methods = [
    'setTransform', 'clearRect', 'fillRect', 'strokeRect', 'drawImage',
    'beginPath', 'arc', 'ellipse', 'fill', 'stroke', 'moveTo', 'lineTo',
    'save', 'restore', 'translate', 'rotate', 'scale', 'closePath',
  ];
  for (const method of methods) {
    ctx[method] = function (...args) {
      this.calls.push({
        method,
        args,
        state: {
          globalAlpha: this.globalAlpha,
          globalCompositeOperation: this.globalCompositeOperation,
          fillStyle: this.fillStyle,
          strokeStyle: this.strokeStyle,
          lineWidth: this.lineWidth,
          lineCap: this.lineCap,
        },
      });
    };
  }
  ctx.createRadialGradient = () => ({ addColorStop() {} });
  ctx.createLinearGradient = () => ({ addColorStop() {} });
  return ctx;
}

function fakeCanvas() {
  const ctx = recordingContext();
  const attrs = {};
  return {
    id: '',
    width: 300,
    height: 150,
    style: {},
    parentNode: null,
    getContext(type) {
      return type === '2d' ? ctx : null;
    },
    setAttribute(name, value) {
      attrs[name] = String(value);
    },
    getAttribute(name) {
      return attrs[name];
    },
  };
}

function fixture() {
  const canvases = [];
  const host = {
    children: [],
    appendChild(el) {
      this.children.push(el);
      el.parentNode = this;
      return el;
    },
    removeChild(el) {
      const index = this.children.indexOf(el);
      if (index >= 0) this.children.splice(index, 1);
      el.parentNode = null;
      return el;
    },
  };
  const playfield = {
    left: 0,
    top: 0,
    width: 800,
    height: 450,
    getBoundingClientRect() {
      return { left: this.left, top: this.top, width: this.width, height: this.height };
    },
  };
  const doc = {
    body: host,
    documentElement: { clientWidth: 800, clientHeight: 450 },
    createElement(tag) {
      assert.equal(tag, 'canvas');
      const canvas = fakeCanvas();
      canvases.push(canvas);
      return canvas;
    },
    getElementById(id) {
      return id === 'playfield' ? playfield : null;
    },
  };
  return { doc, host, playfield, canvases };
}

function make(options = {}) {
  const env = fixture();
  const fx = createScreenFx({
    document: env.doc,
    effects: createEffectTable(),
    ...options,
  });
  return { ...env, fx };
}

function layerCtx(canvases) {
  return canvases[1].getContext('2d');
}

test('EFFECT_NAMES lists every recipe and createEffectTable maps each one to a function', () => {
  assert.equal(EFFECT_NAMES.length, 20);
  const table = createEffectTable();
  // The five granular pieces are extra entries: the game drives them per frame
  // and per hit, so the composite recipes are not the only usable names.
  const granular = ['fireTrail', 'fireImpact', 'boltTrail', 'boltImpact', 'spikeAura',
    'haloSparkle', 'hitPointBurst', 'spikeSparkle', 'stormRain', 'stormBolt', 'stormDim', 'lowHealthPulse'];
  assert.deepEqual(Object.keys(table).sort(), [...EFFECT_NAMES, ...granular].sort());
  for (const name of [...EFFECT_NAMES, ...granular]) {
    assert.equal(typeof table[name], 'function', `${name} is a function`);
  }
});

test('play recognises every effect in the table and rejects unknown names', () => {
  const { fx } = make();
  for (const name of EFFECT_NAMES) {
    assert.equal(fx.play(name, {}), true, `${name} plays`);
  }
  assert.equal(fx.play('not-a-real-effect', {}), false);
});

test('every effect is safe with an empty payload and yields at least one particle', () => {
  for (const name of EFFECT_NAMES) {
    const { fx } = make();
    assert.doesNotThrow(() => fx.play(name, {}), `${name} does not throw`);
    fx.step(1 / 60);
    assert.ok(fx.getParticleCount() >= 1, `${name} yields at least one particle`);
  }
});

test('the same effect yields strictly fewer particles at low intensity', () => {
  const low = make({ intensity: 0.2 });
  low.fx.play('correctAnswer', {});
  const high = make({ intensity: 1.3 });
  high.fx.play('correctAnswer', {});

  let lowTotal = low.fx.getParticleCount();
  let highTotal = high.fx.getParticleCount();
  for (let i = 0; i < 4; i++) {
    low.fx.step(1 / 60);
    high.fx.step(1 / 60);
    lowTotal += low.fx.getParticleCount();
    highTotal += high.fx.getParticleCount();
  }
  assert.ok(lowTotal < highTotal, `intensity 0.2 (${lowTotal}) spawns fewer than 1.3 (${highTotal})`);
});

test('reduced motion drops the wrongAnswer wash and shrinks its particle count', () => {
  const reduced = make({ reducedMotion: true });
  reduced.fx.play('wrongAnswer', {});
  const reducedCount = reduced.fx.getParticleCount();
  reduced.fx.step(1 / 60);
  reduced.fx.render();

  const normal = make();
  normal.fx.play('wrongAnswer', {});
  const normalCount = normal.fx.getParticleCount();
  normal.fx.step(1 / 60);
  normal.fx.render();

  // A wash fills the whole layer from (0,0) with a plain colour; the vignette
  // fills the same rect with a gradient object, and shards never start at (0,0).
  const washFills = (canvases) => layerCtx(canvases).calls.filter(
    (call) => call.method === 'fillRect'
      && call.args[0] === 0
      && call.args[1] === 0
      && typeof call.state.fillStyle === 'string'
  );
  assert.equal(washFills(reduced.canvases).length, 0, 'no full-viewport wash fill under reduced motion');
  assert.ok(washFills(normal.canvases).length > 0, 'the normal run draws the wash');
  assert.ok(reducedCount < normalCount, 'reduced motion spawns fewer particles');
});

test('fireball holds its explosion until the flight ends', () => {
  const { fx } = make();
  fx.play('fireball', {});
  for (let i = 0; i < 37; i++) fx.step(1 / 60); // 0.617s < 0.62s
  assert.equal(fx._particles.some((p) => p.type === 'flash' || p.type === 'ring'), false, 'no flash or ring during flight');
  const before = fx.getParticleCount();
  fx.step(1 / 60); // 0.633s — impact fires
  const after = fx.getParticleCount();
  assert.ok(after > before, 'particles spike once the flight ends');
  assert.equal(fx._particles.some((p) => p.type === 'ring'), true, 'the impact ring appears');
});

test('bonusFlow carries the light from the pill into the orb it strengthened', () => {
  const { fx } = make();
  const from = { x: 240, y: -30 };
  const to = { x: 560, y: 470 };
  assert.equal(fx.play('bonusFlow', { from, to, ability: 'storm' }), true);

  // The flight is the announcement; only its arrival may mark the orb.
  for (let i = 0; i < 40; i++) fx.step(1 / 60); // 0.667s < 0.75s
  assert.equal(fx._particles.some((p) => p.type === 'ring'), false,
    'no arrival ring while the motes are still travelling');
  const before = fx.getParticleCount();
  for (let i = 0; i < 10; i++) fx.step(1 / 60); // crosses 0.75s
  assert.ok(fx.getParticleCount() > before, 'the arrival burst lands after the flight');
  const ring = fx._particles.find((p) => p.type === 'ring');
  assert.ok(ring, 'the orb answers with a ring');
  assert.ok(Math.hypot(ring.x - to.x, ring.y - to.y) < 0.001,
    'the ring is drawn on the orb, not at the pill');
});

test('a scheduled fireball impact does not fire while paused and fires after resume', () => {
  const { fx } = make();
  fx.play('fireball', {});
  fx.pause();
  for (let i = 0; i < 60; i++) fx.step(1 / 60);
  assert.equal(fx._particles.some((p) => p.type === 'flash' || p.type === 'ring'), false, 'no impact while paused');
  fx.resume();
  for (let i = 0; i < 14; i++) fx.step(0.05); // 0.7s > 0.62s
  assert.equal(fx._particles.some((p) => p.type === 'flash' || p.type === 'ring'), true, 'impact fires after resume');
});

test('PALETTES exposes the named palettes including the sword blade ramp', () => {
  assert.deepEqual(Object.keys(PALETTES).sort(), [
    'blade', 'blue', 'earth', 'gold', 'green', 'ice', 'portal', 'portalCore', 'red', 'storm', 'violet', 'wind',
  ]);
  for (const palette of Object.values(PALETTES)) {
    assert.ok(Array.isArray(palette) && palette.length > 0);
  }
});

test('the granular impact effects are playable on their own', () => {
  const { fx } = make();
  assert.equal(fx.play('fireImpact', { x: 500, y: 270 }), true);
  const afterFire = fx.getParticleCount();
  assert.ok(afterFire > 0, 'fireImpact spawns a blast');

  fx.clear();
  assert.equal(fx.play('boltImpact', { x: 500, y: 270 }), true);
  assert.ok(fx.getParticleCount() > 0, 'boltImpact spawns a blast');
});

test('a composite fireball with impact:false leaves the blast to the caller', () => {
  const withImpact = make();
  withImpact.fx.play('fireball', { duration: 0.3 });
  for (let i = 0; i < 30; i++) withImpact.fx.step(1 / 60);
  const defaultPeak = withImpact.fx.getParticleCount();

  const trailOnly = make();
  trailOnly.fx.play('fireball', { duration: 0.3, impact: false });
  for (let i = 0; i < 30; i++) trailOnly.fx.step(1 / 60);
  const trailPeak = trailOnly.fx.getParticleCount();

  assert.ok(defaultPeak > trailPeak * 2, 'the default composite adds the explosion on top of the trail');
});

test('the strike and the fiend hit wear the blade ramp, not gold or green', () => {
  const { fx, canvases } = make();
  fx.play('heroStrike', { x: 400, y: 280 });
  fx.play('fiendHurt', { x: 500, y: 270 });
  fx.step(1 / 60);
  fx.render();
  const used = layerCtx(canvases).calls
    .flatMap((call) => [call.state.strokeStyle, call.state.fillStyle])
    .filter((value) => typeof value === 'string')
    .map((value) => value.toLowerCase());
  assert.ok(used.includes('#40a0f0'), 'the strike arc uses the blade blue');
  assert.ok(!used.includes('#ffe8a0'), 'no gold arc remains');
  assert.ok(!used.includes('#d8ffcf'), 'the fiend hit no longer rings green');
});

test('the heal column and the sword glint are playable', () => {
  const { fx } = make();
  assert.equal(fx.play('heal', { x: 120, y: 280 }), true);
  const afterHeal = fx.getParticleCount();
  assert.ok(afterHeal > 0, 'heal spawns its column and motes');

  fx.clear();
  assert.equal(fx.play('swordGain', { x: 400, y: 520 }), true);
  assert.ok(fx.getParticleCount() > 0, 'swordGain spawns a glint');
});

test('the heal column reaches from above the viewport down to the hero', () => {
  const { fx, canvases } = make();
  fx.play('heal', { x: 120, y: 280 });
  fx.step(0.01);
  fx.render();
  const rects = layerCtx(canvases).calls.filter((call) => call.method === 'fillRect');
  assert.ok(rects.length > 0, 'the beam is drawn');
  assert.ok(rects.some((call) => call.args[1] < 0), 'a beam starts above the playfield top');
});

test('the heal charge cue grows with progress', () => {
  const low = make();
  low.fx.play('healCharge', { x: 110, y: 280, progress: 0.1 });
  const lowCount = low.fx.getParticleCount();

  const high = make();
  high.fx.play('healCharge', { x: 110, y: 280, progress: 0.9 });
  const highCount = high.fx.getParticleCount();

  assert.ok(lowCount > 0, 'the cue spawns something as soon as the hold starts');
  assert.ok(highCount > lowCount, 'it grows as the hold approaches the threshold');
});

test('the three ability casts are playable, distinct and anchored in the playfield', () => {
  const shapes = {};
  for (const name of ['windCast', 'stormCast', 'spikeCast']) {
    const { fx } = make();
    assert.equal(fx.play(name, { x: 400, y: 280 }), true, `${name} plays`);
    assert.ok(fx.getParticleCount() > 0, `${name} spawns particles`);
    const types = [...new Set(fx._particles.map((p) => p.type))].sort();
    shapes[name] = types.join(',');
    assert.ok(
      fx._particles.every((p) => p.y >= 0 && p.y <= 450),
      `${name} stays inside the playfield`,
    );
  }
  assert.equal(new Set(Object.values(shapes)).size, 3, 'each cast has its own particle mix');
});

test('reduced motion suppresses the storm cast wash and shake', () => {
  const reduced = make({ reducedMotion: true });
  reduced.fx.play('stormCast', { x: 400, y: 280 });
  const reducedCount = reduced.fx.getParticleCount();
  reduced.fx.step(1 / 60);
  reduced.fx.render();

  const normal = make();
  normal.fx.play('stormCast', { x: 400, y: 280 });
  const normalCount = normal.fx.getParticleCount();
  normal.fx.step(1 / 60);
  normal.fx.render();

  const washFills = (canvases) => layerCtx(canvases).calls.filter(
    (call) => call.method === 'fillRect'
      && call.args[0] === 0
      && call.args[1] === 0
      && typeof call.state.fillStyle === 'string'
  );
  assert.equal(washFills(reduced.canvases).length, 0, 'no full-viewport wash fill under reduced motion');
  assert.ok(washFills(normal.canvases).length > 0, 'the normal run draws the wash');
  assert.equal(reduced.fx._shake, null, 'no shake under reduced motion');
  assert.ok(normal.fx._shake, 'the normal run shakes');
  assert.ok(reducedCount < normalCount, 'reduced motion spawns fewer particles');
});

test('the spike aura is a sparkle that sits on the ground and eases off', () => {
  const low = make();
  low.fx.play('spikeAura', { x: 400, y: 280, progress: 0.1 });
  const lowGlow = low.fx._particles.find((p) => p.type === 'glow');

  const high = make();
  high.fx.play('spikeAura', { x: 400, y: 280, progress: 0.9 });
  const highGlow = high.fx._particles.find((p) => p.type === 'glow');

  assert.ok(lowGlow && highGlow, 'every pulse leaves a glint');
  assert.ok(lowGlow.rx > highGlow.rx, 'the glint shrinks as the spike runs out');
  assert.ok(highGlow.y > 280, 'the sparkle sits at the ground under the target');
  assert.equal(low.fx._particles.filter((p) => p.type === 'ring').length, 0,
    'the aura is particles now, not a drawn ring');
  assert.ok(low.fx._particles.filter((p) => p.type === 'ember').length >= 2,
    'grains of light rise off the ground');
});

test('a hit-point bead is one sprite particle, and a spent one explodes', () => {
  // The bead itself is not a recipe any more: entities.js holds one `halo`
  // particle per answer still owed, so nothing is re-emitted (see
  // Fiend._syncHaloRings).
  const bead = make();
  const particle = bead.fx.halo(300, 200, '#8a62c8', 12, 1);
  assert.equal(particle.type, 'halo');
  assert.equal(bead.fx._particles.filter((p) => p.type === 'halo').length, 1,
    'one particle marks one hit point');
  assert.equal(bead.fx._particles.filter((p) => p.type === 'glow').length, 0,
    'and it costs no glow particle');

  const burst = make();
  burst.fx.play('hitPointBurst', { x: 300, y: 200, radius: 12 });
  assert.ok(burst.fx._particles.some((p) => p.type === 'ring'), 'the explosion throws a ring');
  assert.ok(burst.fx._particles.filter((p) => p.type === 'spark').length >= 3, 'and sparks');
  assert.ok(burst.fx._particles.some((p) => p.type === 'shard'), 'and shards');
});

test('the storm rains, dims the playfield and can land a bolt', () => {
  const rain = make();
  rain.fx.play('stormRain', {});
  assert.ok(rain.fx._particles.filter((p) => p.type === 'streak').length >= 10, 'rain falls');
  assert.equal(rain.fx._washes.length, 0, 'rain itself never touches the whole-screen dim');

  const dim = make();
  dim.fx.play('stormDim', {});
  assert.equal(dim.fx._washes.length, 1, 'the dim is a single wash, added once');
  assert.ok(dim.fx._washes[0].duration > 60, 'that outlives the level instead of expiring');

  const bolt = make({ reducedMotion: false });
  bolt.fx.play('stormBolt', { x: 400 });
  assert.ok(bolt.fx._particles.some((p) => p.type === 'beam'), 'the bolt is a beam');
  assert.ok(bolt.fx._shakes > 0 || bolt.fx.getShakeOffset(), 'and it shakes the screen');
});


test('the fiend portal anchors to the ground line it is given', () => {
  const { fx } = make();
  assert.equal(fx.play('fiendPortal', { x: 760, y: 360 }), true);
  const particles = fx._particles;
  assert.ok(particles.length >= 4, 'pool, mouth and ground oval are all spawned');
  // The pool must sit on the ground line, the mouth above it — otherwise the
  // light reads as a floating ball instead of a doorway standing on the floor.
  const pool = particles.find((p) => p.type === 'glow' && p.ry < p.rx);
  assert.ok(pool, 'a flat pool glow exists');
  assert.equal(pool.y, 360);
  const mouth = particles.find((p) => p.type === 'glow' && p.ry > p.rx);
  assert.ok(mouth, 'a tall mouth glow exists');
  assert.ok(mouth.y < 360, 'the mouth sits above the pool');
  assert.ok(particles.every((p) => Math.abs(p.x - 760) < 120), 'everything stays near the portal');
});

test('a spawn never moves the camera: the portal thumps on the ground instead', () => {
  const { fx } = make();
  fx.play('fiendPortal', { x: 760, y: 360 });
  // Run past the door's opening schedule (0.25 s), where the impact used to live,
  // while the ground rings it fires are still alive.
  for (let i = 0; i < 24; i += 1) fx.step(1 / 60);
  assert.deepEqual(fx.getShakeOffset(), { x: 0, y: 0 },
    'a spawn must not shake the playfield: the pixel art re-grids while it does');
  // The weight is carried by a ground shockwave on the portal's own line.
  const rings = fx._particles.filter((p) => p.type === 'ring' || p.type === 'oval');
  assert.ok(rings.some((r) => Math.abs(r.y - 360) < 2), 'a ring lies on the ground line');
});

test('the portal recipe itself never asks for a shake', async () => {
  const { createEffectTable } = await import('./screen-fx-effects.js');
  const calls = [];
  const scheduled = [];
  const api = new Proxy({}, {
    get: (_target, name) => (...args) => {
      calls.push(String(name));
      if (name === 'schedule') scheduled.push(args[1]);
      if (name === 'countScale') return 1;
      return undefined;
    },
  });
  createEffectTable().fiendPortal(api, { x: 760, y: 360 });
  // Run the deferred impact, which is where the shake used to hide.
  for (const run of scheduled) run();
  assert.ok(!calls.includes('shake'), 'no shake in the spawn recipe');
  assert.ok(calls.includes('flash') && calls.includes('oval'), 'the thump is flash and rings');
});

test('the fiend portal survives an empty payload and reduced motion', () => {
  for (const reducedMotion of [false, true]) {
    const { fx } = make({ reducedMotion });
    assert.doesNotThrow(() => fx.play('fiendPortal', {}));
    fx.step(1 / 60);
    assert.ok(fx.getParticleCount() >= 1);
    for (let i = 0; i < 120; i++) fx.step(1 / 60);
    assert.doesNotThrow(() => fx.step(1 / 60), 'emitters expire cleanly');
  }
});

test('lowHealthPulse rings all four edges with a capped, short-lived, red burst', () => {
  const particles = [];
  const api = {
    countScale: () => 1,
    ember: (x, y, vx, vy, color, life) => particles.push({ x, y, color, life }),
    shake: () => assert.fail('no shake'),
    addWash: () => assert.fail('no wash'),
    addVignette: () => assert.fail('no vignette'),
  };
  createEffectTable().lowHealthPulse(api);
  assert.ok(particles.length > 0 && particles.length <= 60);
  assert.ok(particles.some((p) => p.y === 0));
  assert.ok(particles.some((p) => p.y === 450));
  assert.ok(particles.some((p) => p.x === 0));
  assert.ok(particles.some((p) => p.x === 800));
  assert.ok(particles.every((p) => p.life <= 1.2 && PALETTES.red.includes(p.color)));
});
