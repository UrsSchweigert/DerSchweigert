// frame-loop-idle.test.js — the frame loop must park when nothing it draws can
// change. It used to repaint the whole playfield 60 times a second behind the
// title, pause, level-clear and game-over overlays: a full-canvas raster every
// frame for a screen nobody is looking at, which is what made phones run hot.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('./main.js', import.meta.url), 'utf8');

function functionBody(name) {
  const body = source.match(new RegExp(`function ${name}\\([^)]*\\)[\\s\\S]*?\\n\\}`))?.[0];
  assert.ok(body, `${name} must exist in main.js`);
  return body;
}

function needsFrame(overrides = {}) {
  const context = {
    paused: false,
    gameRunning: false,
    gameplayTimers: [],
    ffmScreenFx: { isActive: () => false },
    ...overrides,
  };
  vm.createContext(context);
  vm.runInContext(functionBody('needsFrame'), context);
  return vm.runInContext('needsFrame()', context);
}

test('a live level keeps the loop running', () => {
  assert.equal(needsFrame({ gameRunning: true }), true);
});

test('a paused level parks even though the level is still live', () => {
  assert.equal(needsFrame({ gameRunning: true, paused: true }), false);
});

test('the menus park once nothing is left to draw', () => {
  assert.equal(needsFrame(), false, 'title, level clear and game over');
});

test('a pending gameplay timer keeps the loop running', () => {
  // The practice wave-clear delay and the chained hit sequences advance out of
  // the loop after gameRunning has already gone false.
  assert.equal(needsFrame({ gameplayTimers: [{ callback() {}, remaining: 0.4 }] }), true);
});

test('a fading screen effect keeps the loop running until it ends', () => {
  let active = true;
  const ffmScreenFx = { isActive: () => active };
  assert.equal(needsFrame({ ffmScreenFx }), true);
  active = false;
  assert.equal(needsFrame({ ffmScreenFx }), false);
});

test('a build without the screen-fx layer still parks', () => {
  assert.equal(needsFrame({ ffmScreenFx: undefined }), false);
});

test('kickGameLoop only wakes a parked loop', () => {
  const context = {
    animFrameId: null,
    calls: 0,
    performance: { now: () => 42 },
    gameLoop() { context.calls++; },
  };
  vm.createContext(context);
  vm.runInContext(functionBody('kickGameLoop'), context);
  vm.runInContext('kickGameLoop();', context);
  assert.equal(context.calls, 1);
  context.animFrameId = 7;
  vm.runInContext('kickGameLoop();', context);
  assert.equal(context.calls, 1, 'a running loop is not started twice');
});

test('the loop asks needsFrame before it asks for another frame', () => {
  const loop = functionBody('gameLoop');
  assert.ok(loop.indexOf('needsFrame()') >= 0, 'gameLoop must consult needsFrame');
  assert.ok(
    loop.indexOf('needsFrame()') < loop.indexOf('requestAnimationFrame(gameLoop)'),
    'the decision comes before the next frame is scheduled',
  );
});

test('every way back into a live level wakes the parked loop', () => {
  for (const name of ['resumeGame', 'resumeFromHelp']) {
    assert.match(functionBody(name), /kickGameLoop\(\);/, `${name} must wake the loop`);
  }
  const healTip = source.slice(source.indexOf('btnHealTipConfirm.addEventListener('));
  assert.match(healTip.slice(0, 300), /kickGameLoop\(\);/, 'dismissing the heal tip must wake the loop');
  assert.match(
    functionBody('handleAppBack'),
    /healTipOverlay\.style\.display === 'flex'[\s\S]*?kickGameLoop\(\);/,
    'closing the heal tip with Back must wake the loop',
  );
});
