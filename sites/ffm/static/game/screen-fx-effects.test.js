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
  assert.equal(EFFECT_NAMES.length, 12);
  const table = createEffectTable();
  // The four granular pieces are extra entries: the game drives them per frame
  // and per hit, so the composite recipes are not the only usable names.
  const granular = ['fireTrail', 'fireImpact', 'boltTrail', 'boltImpact'];
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
  assert.deepEqual(Object.keys(PALETTES).sort(), ['blade', 'blue', 'gold', 'green', 'ice', 'red', 'violet']);
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
