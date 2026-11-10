// renderer.test.js — the shared canvas renderer stays web-identical.
//
// The app-only header timer bar (mobile/game/timer-bar.js) interpolates its
// colour continuously. The web build must keep the original three-step banded
// colours painted by Renderer.drawTimerBar, so this regression test pins them.
import { test } from 'node:test';
import assert from 'node:assert/strict';

globalThis.Image = class FakeImage {
  constructor() {
    this._src = '';
    this._listeners = [];
  }
  addEventListener(type, listener) {
    this._listeners.push([type, listener]);
  }
  set src(value) {
    this._src = value;
  }
  get src() {
    return this._src;
  }
};

const { Renderer } = await import('./renderer.js');

function fakeCanvas() {
  const fills = [];
  const ctx = {
    fillStyle: '',
    fillRect(x, y, w, h) {
      fills.push({ style: this.fillStyle, x, y, w, h });
    },
  };
  return {
    canvas: { getContext: () => ctx, parentElement: null },
    fills,
  };
}

function fillStyles(ratio) {
  const { canvas, fills } = fakeCanvas();
  const renderer = new Renderer(canvas);
  renderer.drawTimerBar(0, 0, 100, ratio);
  return fills.map((fill) => fill.style);
}

test('the web timer bar keeps the banded green/yellow/red colours', () => {
  assert.ok(fillStyles(0.6).includes('#40e840'), 'ratio above 50% stays green');
  assert.ok(fillStyles(0.4).includes('#e8c040'), 'ratio above 25% stays yellow');
  assert.ok(fillStyles(0.2).includes('#e84040'), 'ratio at or below 25% stays red');
});

test('the band boundaries stay at 50% and 25%', () => {
  assert.ok(fillStyles(0.51).includes('#40e840'));
  assert.ok(fillStyles(0.5).includes('#e8c040'));
  assert.ok(fillStyles(0.26).includes('#e8c040'));
  assert.ok(fillStyles(0.25).includes('#e84040'));
  assert.ok(fillStyles(0).includes('#e84040'));
});

test('the web timer bar paints the track and clamps the filled width', () => {
  const { canvas, fills } = fakeCanvas();
  const renderer = new Renderer(canvas);
  renderer.drawTimerBar(10, 20, 100, 0.5);
  assert.deepEqual(fills.slice(0, 2).map((fill) => fill.style), ['#000', '#202020']);
  assert.deepEqual(fills[2], { style: '#e8c040', x: 10, y: 20, w: 50, h: 8 });

  const empty = fakeCanvas();
  new Renderer(empty.canvas).drawTimerBar(0, 0, 100, -1);
  assert.equal(empty.fills[2].w, 0, 'a negative ratio never fills backwards');
});
