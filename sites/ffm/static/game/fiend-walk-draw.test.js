import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// A stand-in browser Image that reports itself loaded. A walk strip (a URL under
// fiend-walk/) is eight times as wide as a still, as the real files are.
const FRAME_W = 64;
globalThis.Image = class {
  constructor() { this.complete = true; this.naturalHeight = 64; this.naturalWidth = FRAME_W; }
  set src(url) { this._src = url; this.naturalWidth = String(url).includes('/fiend-walk/') ? FRAME_W * 8 : FRAME_W; }
  get src() { return this._src; }
};
const { Fiend } = await import('./entities.js');
const { WALK_FPS } = await import('./fiend-walk.js');

function ctxRecorder() {
  const calls = [];
  const note = (name) => (...args) => calls.push({ name, args });
  return {
    calls,
    save: note('save'), restore: note('restore'), translate: note('translate'), scale: note('scale'),
    createRadialGradient: () => ({ addColorStop() {} }),
    beginPath() {}, arc() {}, fill() {}, fillRect() {},
    drawImage: note('drawImage'),
    set fillStyle(_) {}, get fillStyle() { return null; },
    set globalAlpha(_) {}, set imageSmoothingEnabled(_) {},
  };
}

const sprite = (ctx) => ctx.calls.filter((c) => c.name === 'drawImage').at(-1);
const newFiend = () => new Fiend(600, 360, { hp: 1, palette: {}, fiendClassId: 1 });

describe('fiend walk cycle drawing', () => {
  it('draws frame 0 of the strip the moment the fiend starts walking', () => {
    const ctx = ctxRecorder();
    newFiend()._drawClassSprite(ctx);
    const args = sprite(ctx).args;
    assert.strictEqual(args.length, 9, 'a strip frame is drawn with the 9-argument drawImage');
    assert.deepStrictEqual(args.slice(1, 5), [0, 0, FRAME_W, 64]);
  });

  it('advances through the strip as it walks', () => {
    const fiend = newFiend();
    fiend.update(2.5 / WALK_FPS);
    const ctx = ctxRecorder();
    fiend._drawClassSprite(ctx);
    assert.strictEqual(sprite(ctx).args[1], 2 * FRAME_W);
  });

  it('holds the still, not a strip frame, when it is idle at combat range', () => {
    const fiend = newFiend();
    fiend.setState('idle');
    const ctx = ctxRecorder();
    fiend._drawClassSprite(ctx);
    assert.strictEqual(sprite(ctx).args.length, 5);
  });

  it('plays the walk mirrored while retreating', () => {
    const fiend = newFiend();
    fiend.setState('retreat');
    const ctx = ctxRecorder();
    fiend._drawClassSprite(ctx);
    assert.strictEqual(sprite(ctx).args.length, 9);
    assert.ok(ctx.calls.some((c) => c.name === 'scale' && c.args[0] === -1), 'not mirrored');
  });

  it('keeps the walk clock still while the fiend is not moving', () => {
    const fiend = newFiend();
    fiend.setState('idle');
    fiend.update(5);
    assert.strictEqual(fiend._walkClock, 0);
  });
});
