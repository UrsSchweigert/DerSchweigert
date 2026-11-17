import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  RUNESTONE_HEIGHT, RUNESTONE_WIDTH,
  appendRunestones, drawRunestone, runestoneDataUri,
} from './runestone.js';
import { SHAPE_TYPES, generateShapesProblem } from './shapes.js';

describe('runestone', () => {
  it('draws nothing where there is no Image, and scales from its own height once decoded', () => {
    const calls = [];
    const ctx = {
      globalAlpha: 1, imageSmoothingEnabled: true,
      drawImage(...args) { calls.push({ args, alpha: this.globalAlpha, smooth: this.imageSmoothingEnabled }); },
    };
    assert.equal(drawRunestone(ctx, 100, 50, 48), false, 'no Image in node');
    globalThis.Image = class { set src(value) { this.loaded = value; this.complete = true; this.naturalWidth = RUNESTONE_WIDTH; } };
    try {
      assert.equal(drawRunestone(ctx, 100, 50, 24), true);
      const [, x, y, w, h] = calls[0].args;
      assert.equal(h, 24);
      assert.ok(Math.abs(w - 24 * RUNESTONE_WIDTH / RUNESTONE_HEIGHT) < 1e-9);
      assert.equal(x, 100 - w / 2);
      assert.equal(y, 50 - 12);
      assert.equal(calls[0].smooth, false, 'pixel art is never smoothed');
      drawRunestone(ctx, 0, 0, 24, { active: false });
      assert.ok(calls[1].alpha < calls[0].alpha, 'queued bubbles draw dimmer');
      assert.equal(ctx.globalAlpha, 1, 'alpha restored');
      assert.equal(ctx.imageSmoothingEnabled, true, 'smoothing restored');
    } finally {
      delete globalThis.Image;
    }
  });

  it('provides a PNG data URI at the declared size and appends that many images to a parent', () => {
    assert.match(runestoneDataUri(), /^data:image\/png;base64,/);
    const png = Buffer.from(runestoneDataUri().split(',')[1], 'base64');
    assert.equal(png.subarray(1, 4).toString(), 'PNG');
    assert.equal(png.readUInt32BE(16), RUNESTONE_WIDTH, 'PNG width');
    assert.equal(png.readUInt32BE(20), RUNESTONE_HEIGHT, 'PNG height');
    const parent = { children: [], appendChild(child) { this.children.push(child); } };
    const doc = { createElement: () => ({ setAttribute() {} }) };
    const stones = appendRunestones(doc, parent, 4);
    assert.equal(stones.length, 4);
    assert.equal(parent.children.length, 4);
    assert.ok(stones.every(stone => stone.className === 'runestone' && stone.src === runestoneDataUri() && stone.alt === ''));
  });

  it('is the only shape the Shapes mode counts', () => {
    assert.deepEqual(SHAPE_TYPES, ['runestone']);
    for (let seed = 0; seed < 50; seed++) assert.equal(generateShapesProblem(seed).shapeType, 'runestone');
  });
});
