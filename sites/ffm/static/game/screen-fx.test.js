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
