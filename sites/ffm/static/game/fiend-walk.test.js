import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { walkFrameIndex, walkSourceRect, WALK_FPS } from './fiend-walk.js';
import { WALK_FRAMES } from './difficulty-classes.js';

describe('walkFrameIndex', () => {
  it('starts on frame 0 and advances one frame every 1/WALK_FPS seconds', () => {
    assert.strictEqual(walkFrameIndex(0), 0);
    assert.strictEqual(walkFrameIndex(0.5 / WALK_FPS), 0);
    assert.strictEqual(walkFrameIndex(1 / WALK_FPS + 1e-6), 1);
    assert.strictEqual(walkFrameIndex(3.5 / WALK_FPS), 3);
  });

  it('loops after the last frame', () => {
    assert.strictEqual(walkFrameIndex((WALK_FRAMES - 0.5) / WALK_FPS), WALK_FRAMES - 1);
    assert.strictEqual(walkFrameIndex((WALK_FRAMES + 0.5) / WALK_FPS), 0);
    assert.strictEqual(walkFrameIndex(1000), Math.floor(1000 * WALK_FPS) % WALK_FRAMES);
  });

  it('treats negative, NaN and missing clocks as the first frame', () => {
    for (const clock of [-1, NaN, undefined, null]) assert.strictEqual(walkFrameIndex(clock), 0);
  });
});

describe('walkSourceRect', () => {
  const strip = (w, h = 40, complete = true) => ({ complete, naturalWidth: w, naturalHeight: h });

  it('cuts one equal-width frame out of the strip', () => {
    const r = walkSourceRect(strip(8 * 30, 40), 3);
    assert.deepStrictEqual(r, { sx: 90, sy: 0, sw: 30, sh: 40 });
  });

  it('returns null while the strip is loading or broken, so the still keeps drawing', () => {
    assert.strictEqual(walkSourceRect(null, 0), null);
    assert.strictEqual(walkSourceRect(strip(240, 40, false), 0), null);
    assert.strictEqual(walkSourceRect(strip(0, 0), 0), null);
  });

  it('refuses a strip that does not divide into whole frames', () => {
    assert.strictEqual(walkSourceRect(strip(8 * 30 + 1), 0), null);
  });
});
