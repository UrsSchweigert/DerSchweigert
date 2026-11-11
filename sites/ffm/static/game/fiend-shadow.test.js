import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// entities.js builds its sprite caches at module load, which needs a browser
// Image. The stub reports itself as loaded so the class-sprite path runs.
globalThis.Image ??= class { constructor() { this.complete = true; this.naturalWidth = 64; this.naturalHeight = 64; } };
const { drawSoftShadow, fiendShadowRadii, Fiend, Hero } = await import('./entities.js');

function recordingCtx() {
  const calls = [];
  const gradient = (args) => {
    const stops = [];
    calls.push({ name: 'gradient', args, stops });
    return { addColorStop: (offset, colour) => stops.push([offset, colour]) };
  };
  return {
    calls,
    save: () => calls.push({ name: 'save' }),
    restore: () => calls.push({ name: 'restore' }),
    translate: (...args) => calls.push({ name: 'translate', args }),
    scale: (...args) => calls.push({ name: 'scale', args }),
    createRadialGradient: (...args) => gradient(args),
    beginPath: () => calls.push({ name: 'beginPath' }),
    arc: (...args) => calls.push({ name: 'arc', args }),
    fill: () => calls.push({ name: 'fill' }),
    fillRect: (...args) => calls.push({ name: 'fillRect', args }),
    drawImage: (...args) => calls.push({ name: 'drawImage', args }),
    set fillStyle(value) { calls.push({ name: 'fillStyle', value }); },
    get fillStyle() { return null; },
    set globalAlpha(_) {},
    set imageSmoothingEnabled(_) {},
  };
}

const gradients = (ctx) => ctx.calls.filter((c) => c.name === 'gradient');

describe('shared ground shadow', () => {
  it('draws one radial gradient squashed onto the ground line', () => {
    const ctx = recordingCtx();
    drawSoftShadow(ctx, 100, 200, 40, 8);
    const [g] = gradients(ctx);
    assert.deepEqual(g.args, [0, 0, 0, 0, 0, 40]);
    assert.deepEqual(g.stops, [
      [0, 'rgba(0,0,0,0.45)'],
      [0.6, 'rgba(0,0,0,0.220)'],
      [1, 'rgba(0,0,0,0)'],
    ]);
    // the ellipse is squashed by ry/rx around the ground line
    assert.deepEqual(ctx.calls.find((c) => c.name === 'translate').args, [100, 201]);
    assert.deepEqual(ctx.calls.find((c) => c.name === 'scale').args, [1, 8 / 40]);
    assert.deepEqual(ctx.calls.find((c) => c.name === 'arc').args, [0, 0, 40, 0, Math.PI * 2]);
  });

  it('scales the whole gradient when a fainter shadow is asked for', () => {
    const ctx = recordingCtx();
    drawSoftShadow(ctx, 0, 0, 10, 4, 0.225);
    const [[, mid]] = gradients(ctx)[0].stops.filter(([offset]) => offset === 0.6);
    assert.equal(mid, 'rgba(0,0,0,0.110)');
  });

  it('draws nothing for a degenerate ellipse', () => {
    const ctx = recordingCtx();
    drawSoftShadow(ctx, 10, 10, 0, 4);
    assert.equal(ctx.calls.length, 0);
  });

  it('sizes a fiend shadow from the drawn sprite box', () => {
    assert.deepEqual(fiendShadowRadii(200, 240), [68, 12]);
    assert.deepEqual(fiendShadowRadii(10, 10), [16, 4]);   // floors keep small fiends grounded
  });

  it('gives the hero and a fiend the same shadow gradient', () => {
    const heroCtx = recordingCtx();
    Hero.prototype._drawGroundShadow.call({}, heroCtx, 120, 300, { w: 100 });
    const fiendCtx = recordingCtx();
    drawSoftShadow(fiendCtx, 120, 300, 34, 12);
    assert.deepEqual(gradients(heroCtx)[0].stops, gradients(fiendCtx)[0].stops);
  });
});

describe('fiend drawing', () => {
  it('draws the ground shadow under the sprite, one light for the whole cast', () => {
    const fiend = new Fiend(200, 300, { hp: 1, palette: {}, fiendClassId: 1 });
    const ctx = recordingCtx();
    const drew = fiend._drawClassSprite(ctx);
    assert.equal(drew, true, 'class sprite path should be used');
    const shadowIndex = ctx.calls.findIndex((c) => c.name === 'gradient');
    const spriteIndex = ctx.calls.findIndex((c) => c.name === 'drawImage');
    assert.ok(shadowIndex >= 0, 'a soft shadow is drawn');
    assert.ok(shadowIndex < spriteIndex, 'the shadow is under the sprite');
    assert.deepEqual(ctx.calls.find((c) => c.name === 'translate').args,
      [200, 301], 'centred on the fiend, on the ground line');
  });
});
