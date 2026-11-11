// screen-fx.test.js — the screen-space particle/bloom layer stays web-identical.
//
// The module must import cleanly in Node (no top-level DOM), so every test
// drives it through a recording fake document/canvas that mirrors the real
// browser surface used by createScreenFx.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  createScreenFx,
  FX_Z_INDEX,
  MIN_INTENSITY,
  MAX_INTENSITY,
  DEFAULT_INTENSITY,
  WORLD_WIDTH,
  WORLD_HEIGHT,
  DPR_TIERS,
  PARTICLE_SIZE_SCALE,
} from './screen-fx.js';

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
  const fx = createScreenFx({ document: env.doc, ...options });
  return { ...env, fx };
}

// The layer canvas is the second canvas created (after the visible one).
function layerCtx(canvases) {
  return canvases[1].getContext('2d');
}

test('creates exactly one mounted screen-fx canvas with the required attributes', () => {
  const { fx, host, canvases } = make();
  const visible = canvases.filter((canvas) => canvas.id === 'screen-fx');
  assert.equal(visible.length, 1, 'exactly one canvas carries the screen-fx id');
  const canvas = visible[0];
  assert.equal(fx.canvas, canvas);
  assert.equal(canvas.getAttribute('aria-hidden'), 'true');
  assert.equal(canvas.style.position, 'fixed');
  assert.equal(canvas.style.pointerEvents, 'none');
  assert.equal(canvas.style.zIndex, String(FX_Z_INDEX));
  assert.equal(host.children.length, 1);
  assert.equal(host.children[0], canvas);
});

test('worldToScreen maps the identity rect and a letterboxed rect', () => {
  const identity = make();
  assert.deepEqual(identity.fx.worldToScreen(400, 225), { x: 400, y: 225 });
  assert.deepEqual(identity.fx.worldToScreen(WORLD_WIDTH, WORLD_HEIGHT), { x: 800, y: 450 });

  const letterboxed = make();
  letterboxed.playfield.left = 100;
  letterboxed.playfield.top = 50;
  letterboxed.playfield.width = 400;
  letterboxed.playfield.height = 225;
  letterboxed.fx.resize();
  assert.equal(letterboxed.fx.mapping().scale, 0.5);
  assert.deepEqual(letterboxed.fx.worldToScreen(WORLD_WIDTH, WORLD_HEIGHT), { x: 500, y: 275 });
  assert.deepEqual(letterboxed.fx.worldToScreen(0, 0), { x: 100, y: 50 });
});

test('mapping reflects the playfield rect after resize', () => {
  const { fx, playfield } = make();
  playfield.left = 20;
  playfield.top = 30;
  playfield.width = 640;
  playfield.height = 360;
  fx.resize();
  assert.deepEqual(fx.mapping(), {
    scale: 0.8,
    offsetX: 20,
    offsetY: 30,
    width: 640,
    height: 360,
  });
});

test('intensity clamps at both ends and returns the clamped value', () => {
  const { fx } = make();
  assert.equal(fx.getIntensity(), DEFAULT_INTENSITY);
  fx.setIntensity(99);
  assert.equal(fx.getIntensity(), MAX_INTENSITY);
  fx.setIntensity(-3);
  assert.equal(fx.getIntensity(), MIN_INTENSITY);
  fx.setIntensity(0.7);
  assert.equal(fx.getIntensity(), 0.7);

  const clamped = make({ intensity: MAX_INTENSITY + 5 });
  assert.equal(clamped.fx.getIntensity(), MAX_INTENSITY);
});

test('play of an unknown effect returns false and spawns nothing', () => {
  const { fx } = make();
  assert.equal(fx.play('does-not-exist', {}), false);
  assert.equal(fx.getParticleCount(), 0);
});

test('a registered effect receives the api and payload and play returns true', () => {
  let received = null;
  const { fx } = make({
    effects: {
      boom(api, payload) {
        received = { api, payload };
        api.spark(0, 0, 0, 50, '#ffffff', 0.5);
      },
    },
  });
  const payload = { strength: 2 };
  assert.equal(fx.play('boom', payload), true);
  assert.equal(received.api, fx);
  assert.equal(received.payload, payload);
  assert.ok(fx.getParticleCount() > 0);
});

test('isActive reports particles, pending timers and clear', () => {
  const { fx } = make();
  assert.equal(fx.isActive(), false, 'idle instance is inactive');
  fx.spark(0, 0, 0, 60, '#ffffff', 1);
  assert.equal(fx.isActive(), true, 'a spark makes it active');
  fx.clear();
  assert.equal(fx.isActive(), false, 'clear returns it to inactive');
  fx.schedule(0.5, () => {});
  assert.equal(fx.isActive(), true, 'a pending schedule alone makes it active');
});

test('a particle is removed once stepped past its lifetime', () => {
  const { fx } = make();
  fx.ember(0, 0, 0, 0, '#ffffff', 0.03);
  assert.equal(fx.getParticleCount(), 1);
  fx.step(0.05);
  assert.equal(fx.getParticleCount(), 0);
});

test('an idle render performs no fill or stroke calls', () => {
  const { fx, canvases } = make();
  fx.render();
  for (const canvas of canvases) {
    const drawing = canvas.getContext('2d').calls.filter((call) =>
      call.method === 'fill' || call.method === 'stroke' || call.method === 'fillRect' || call.method === 'strokeRect'
    );
    assert.equal(drawing.length, 0, 'idle render must not fill or stroke');
  }
});

test('reduced motion silences shake and wash and shrinks spawned counts', () => {
  const { fx, canvases } = make({ reducedMotion: true });
  fx.shake(50, 1);
  fx.addWash('#ff0000', 0.9, 0.5);
  fx.spark(0, 0, 0, 50, '#ffffff', 0.5);
  const reducedCount = fx.getParticleCount();
  fx.step(0.01);
  fx.render();

  assert.equal(layerCtx(canvases).calls.filter((call) => call.method === 'fillRect').length, 0, 'wash is suppressed');
  const translate = layerCtx(canvases).calls.find((call) => call.method === 'translate');
  assert.deepEqual(translate.args, [0, 0], 'no shake offset is applied');

  const normal = make({ reducedMotion: false });
  normal.fx.spark(0, 0, 0, 50, '#ffffff', 0.5);
  assert.ok(reducedCount < normal.fx.getParticleCount(), 'reduced motion spawns fewer particles');
});

test('the fourth wash within one second is attenuated', () => {
  const { fx, canvases } = make();
  fx.addWash('#ff0000', 0.5, 0.5);
  fx.addWash('#ff0000', 0.5, 0.5);
  fx.addWash('#ff0000', 0.5, 0.5);
  fx.addWash('#ff0000', 0.5, 0.5);
  fx.render();
  const fills = layerCtx(canvases).calls.filter((call) => call.method === 'fillRect');
  assert.equal(fills.length, 4);
  assert.ok(Math.abs(fills[3].state.globalAlpha - 0.5 * 0.22) < 1e-9, 'fourth wash alpha is attenuated');
});

test('pause freezes particle lifetimes', () => {
  const { fx } = make();
  const particle = fx.ember(0, 0, 0, 0, '#ffffff', 0.04);
  fx.pause();
  fx.step(0.05);
  assert.equal(fx.getParticleCount(), 1);
  assert.equal(particle.life, 0.04);
  fx.resume();
  fx.step(0.05);
  assert.equal(fx.getParticleCount(), 0);
});

test('destroy removes the canvas and leaves the instance inert', () => {
  const { fx, host, canvases } = make();
  assert.equal(host.children.length, 1);
  fx.destroy();
  assert.equal(host.children.length, 0);
  assert.doesNotThrow(() => fx.destroy());
  fx.spark(0, 0, 0, 50, '#ffffff', 0.5);
  fx.step(0.1);
  fx.render();
  assert.equal(fx.getParticleCount(), 0);
  assert.equal(canvases.length, 5, 'destroy never creates new canvases');
});

test('the DPR ladder drops a tier after sustained slow frames and never rises', () => {
  const { fx } = make({ dpr: 2 });
  assert.equal(fx.getDprTier(), DPR_TIERS[0]);
  for (let i = 0; i < 95; i++) fx.step(0.04);
  const dropped = fx.getDprTier();
  assert.ok(dropped < DPR_TIERS[0], 'a slow sustained average drops a tier');
  for (let i = 0; i < 200; i++) fx.step(0.04);
  assert.ok(fx.getDprTier() <= dropped, 'the tier never rises again');
});

test('bloom composites the blurred layers back with a lighter blend', () => {
  const { fx } = make({ bloom: true });
  fx.flash(0, 0, '#ffffff', 20, 0.5, 0.8);
  fx.step(0.01);
  fx.render();
  const ctx = fx.canvas.getContext('2d');
  const composites = ctx.calls.map((call) => call.state.globalCompositeOperation);
  assert.ok(composites.includes('lighter'), 'visible canvas uses the lighter composite for bloom');

  const noBloom = make({ bloom: false });
  noBloom.fx.flash(0, 0, '#ffffff', 20, 0.5, 0.8);
  noBloom.fx.step(0.01);
  noBloom.fx.render();
  const noBloomComposites = noBloom.fx.canvas.getContext('2d').calls.map((call) => call.state.globalCompositeOperation);
  assert.ok(!noBloomComposites.includes('lighter'), 'bloom off never composites lighter');
});

test('a zero-width playfield keeps a usable scale instead of collapsing to a point', () => {
  const { fx, playfield } = make();
  playfield.width = 0;
  playfield.height = 0;
  fx.resize();
  const map = fx.mapping();
  assert.equal(map.scale, 1, 'width falls back to the world width');
  assert.deepEqual(fx.worldToScreen(400, 225), { x: 400, y: 225 });
});

test('spawn helpers keep the default colour when the caller omits it', () => {
  const { fx, canvases } = make();
  const flash = fx.flash(10, 10);
  const spark = fx.spark(0, 0, 0, 50);
  const ring = fx.ring(0, 0);
  assert.equal(flash.color, '#ffffff');
  assert.equal(spark.color, '#ffffff');
  assert.equal(ring.color, '#ffffff');

  fx.step(0.01);
  fx.render();
  const used = layerCtx(canvases).calls.flatMap((call) => [call.state.fillStyle, call.state.strokeStyle]);
  assert.ok(!used.includes('undefined'), 'no draw uses the string "undefined" as a colour');
  assert.ok(!used.includes(undefined), 'no draw is handed an undefined colour');
});

test('fast frames never raise the DPR tier after a drop', () => {
  const { fx } = make({ dpr: 2 });
  for (let i = 0; i < 95; i++) fx.step(0.04);
  const dropped = fx.getDprTier();
  assert.ok(dropped < DPR_TIERS[0], 'a slow sustained average drops a tier');
  for (let i = 0; i < 400; i++) fx.step(0.005);
  assert.equal(fx.getDprTier(), dropped, 'a long run of fast frames does not climb back');
});

test('schedule fires once, not before its delay, and never synchronously', () => {
  const { fx } = make();
  let fired = 0;
  fx.schedule(0.2, () => { fired += 1; });
  assert.equal(fired, 0, 'a timer never fires during schedule()');
  fx.step(0.05);
  fx.step(0.05);
  fx.step(0.05);
  assert.equal(fired, 0, 'not fired before the delay elapses');
  fx.step(0.05);
  assert.equal(fired, 1, 'fires exactly once when the delay elapses');
  fx.step(0.2);
  assert.equal(fired, 1, 'does not fire again on later steps');

  let zeroFired = 0;
  fx.schedule(0, () => { zeroFired += 1; });
  assert.equal(zeroFired, 0, 'a zero-delay timer is not synchronous');
  fx.step(0.01);
  assert.equal(zeroFired, 1, 'a zero-delay timer fires on the next step');
});

test('emitter fires roughly rate×duration times with rising progress', () => {
  const { fx } = make();
  const seen = [];
  fx.emitter(1, 10, (progress) => seen.push(progress));
  for (let i = 0; i < 20; i++) fx.step(0.05);
  assert.equal(seen.length, 10, 'fires exactly rate × duration times');
  assert.ok(seen[0] < 0.2, 'first progress starts near 0');
  assert.ok(Math.abs(seen[seen.length - 1] - 1) < 1e-9, 'last progress reaches 1');
  for (let i = 1; i < seen.length; i++) {
    assert.ok(seen[i] >= seen[i - 1], 'progress rises monotonically');
  }
});

test('pause freezes scheduled timers and emitters', () => {
  const { fx } = make();
  let fired = 0;
  fx.schedule(0.1, () => { fired += 1; });
  const seen = [];
  fx.emitter(0.2, 10, (progress) => seen.push(progress));
  fx.pause();
  for (let i = 0; i < 10; i++) fx.step(0.05);
  assert.equal(fired, 0, 'timers do not fire while paused');
  assert.equal(seen.length, 0, 'emitters do not tick while paused');
  fx.resume();
  for (let i = 0; i < 5; i++) fx.step(0.05);
  assert.equal(fired, 1, 'the timer fires after resume');
  assert.equal(seen.length, 2, 'the emitter completes its ticks after resume');
});

test('destroy clears scheduled timers and emitters', () => {
  const { fx } = make();
  let fired = 0;
  fx.schedule(0.1, () => { fired += 1; });
  fx.emitter(1, 10, () => {});
  fx.destroy();
  fx.step(0.05);
  assert.equal(fired, 0);
  assert.equal(fx._timers.length, 0);
  assert.equal(fx._emitters.length, 0);
});

test('setEffects replaces the effect table and ignores non-object input', () => {
  const { fx } = make();
  assert.equal(fx.play('boom', {}), false);
  fx.setEffects({
    boom(api) {
      api.ember(0, 0, 0, 0, '#ffffff', 0.1);
    },
  });
  assert.equal(fx.play('boom', {}), true);
  fx.setEffects(null);
  assert.equal(fx.play('boom', {}), true, 'null input leaves the table intact');
  fx.setEffects('not-an-object');
  assert.equal(fx.play('boom', {}), true, 'string input leaves the table intact');
  fx.setEffects({ other() {} });
  assert.equal(fx.play('boom', {}), false, 'the old effect is gone after replacement');
  assert.equal(fx.play('other', {}), true);
});

test('countScale and alphaScale reflect intensity and reduced motion', () => {
  const normal = make();
  assert.equal(normal.fx.countScale(), DEFAULT_INTENSITY);
  assert.equal(normal.fx.alphaScale(), 1);
  normal.fx.setIntensity(0.5);
  assert.equal(normal.fx.countScale(), 0.5);
  assert.equal(normal.fx.alphaScale(), 1, 'alpha is unaffected by intensity');

  const reduced = make({ reducedMotion: true });
  assert.equal(reduced.fx.countScale(), 0.4 * DEFAULT_INTENSITY);
  assert.equal(reduced.fx.alphaScale(), 0.5);
  reduced.fx.setIntensity(1.3);
  assert.ok(Math.abs(reduced.fx.countScale() - 0.4 * 1.3) < 1e-9);
  assert.equal(reduced.fx.alphaScale(), 0.5, 'alpha is unaffected by intensity under reduced motion');
});

test('clear drops live particles, pending timers and running emitters', () => {
  const { fx } = make();
  fx.spark(0, 0, 0, 60, '#ffffff', 1);
  fx.schedule(0.2, () => fx.spark(0, 0, 0, 60, '#ffffff', 1));
  fx.emitter(0.5, 60, () => fx.spark(0, 0, 0, 60, '#ffffff', 1));
  fx.addWash('#ffffff', 0.2, 1);
  fx.shake(3, 0.5);
  assert.ok(fx.getParticleCount() > 0);

  fx.clear();
  assert.equal(fx.getParticleCount(), 0, 'particles are dropped immediately');

  for (let i = 0; i < 60; i++) fx.step(0.02);
  assert.equal(fx.getParticleCount(), 0, 'cleared timers and emitters never respawn');
  fx.render();
  assert.equal(fx.getParticleCount(), 0);
});

test('an emitter slower than one tick per step still fires once at the end', () => {
  const { fx } = make();
  const seen = [];
  fx.emitter(0.5, 1, (progress) => seen.push(progress));
  for (let i = 0; i < 40; i++) fx.step(1 / 60);
  assert.ok(seen.length >= 1, 'rate * dt < 1 still produces a tick');
  assert.equal(seen[seen.length - 1], 1, 'the guaranteed tick reports progress 1');
});

test('an emitter whose duration is not a step multiple still reaches progress 1', () => {
  const { fx } = make();
  const seen = [];
  fx.emitter(0.62, 10, (progress) => seen.push(progress));
  for (let i = 0; i < 60; i++) fx.step(1 / 60);
  assert.ok(seen.length > 0);
  assert.equal(seen[seen.length - 1], 1, 'the endpoint is always reported');
});

test('an emitter with a zero or negative rate never fires', () => {
  const { fx } = make();
  let calls = 0;
  fx.emitter(0.5, 0, () => { calls++; });
  fx.emitter(-1, 60, () => { calls++; });
  for (let i = 0; i < 60; i++) fx.step(1 / 60);
  assert.equal(calls, 0);
});

test('reduced motion suppresses flashes entirely', () => {
  const reduced = make({ reducedMotion: true });
  assert.equal(reduced.fx.flash(10, 10, '#ffffff', 30, 0.2, 1), null);
  reduced.fx.step(0.01);
  assert.equal(reduced.fx.getParticleCount(), 0);

  const normal = make();
  normal.fx.flash(10, 10, '#ffffff', 30, 0.2, 1);
  assert.equal(normal.fx.getParticleCount(), 1);
});

test('every particle is spawned at the shared size scale', () => {
  const { fx } = make();
  const ring = fx.ring(0, 0, '#ffffff', 10, 100, 0.5, 2);
  assert.equal(ring.r0, 10 * PARTICLE_SIZE_SCALE);
  assert.equal(ring.r1, 100 * PARTICLE_SIZE_SCALE);
  assert.equal(ring.width, 2 * PARTICLE_SIZE_SCALE);

  const ember = fx.ember(0, 0, 0, 0, '#ffffff', 0.5);
  assert.equal(ember.size, 3 * PARTICLE_SIZE_SCALE);
  assert.ok(PARTICLE_SIZE_SCALE > 1, 'the layer reads larger than the authored unit scale');
});

test('frame re-measures the playfield so effects follow a resized layout', () => {
  const env = fixture();
  const fx = createScreenFx({ document: env.doc });
  const before = fx.mapping();
  assert.equal(before.scale, 1);

  env.playfield.left = 100;
  env.playfield.top = 50;
  env.playfield.width = 400;
  env.playfield.height = 225;

  fx.frame(1 / 60);
  const after = fx.mapping();
  assert.equal(after.width, 400);
  assert.equal(after.scale, 0.5);
  assert.equal(after.offsetX, 100);
  assert.equal(after.offsetY, 50);
  assert.deepEqual(fx.worldToScreen(400, 225), { x: 300, y: 162.5 });
});

test('a viewport change reallocates the layer to the new size', () => {
  const env = fixture();
  const fx = createScreenFx({ document: env.doc });
  const initial = fx.canvas.width;
  env.doc.documentElement.clientWidth = 400;
  env.doc.documentElement.clientHeight = 300;
  fx.frame(1 / 60);
  assert.notEqual(fx.canvas.width, initial, 'the backing store follows the viewport');
  assert.equal(fx.canvas.style.width, '400px');
});
