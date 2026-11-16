import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

globalThis.Image ??= class { constructor() { this.complete = true; this.naturalWidth = 64; this.naturalHeight = 64; } };
const { Hero } = await import('./entities.js');
const { drawStrikeFx, arrowX, BOW_REACH } = await import('./strike-fx.js');
const { HERO_CLIPS } = await import('./hero-anim.js');

function recorder() {
  const calls = [];
  const state = {};
  const ctx = new Proxy(state, {
    get(t, k) {
      if (k in t) return t[k];
      return (...a) => {
        calls.push([k, a.map((x) => (typeof x === 'object' ? 'obj' : x))]);
        if (k === 'createRadialGradient') return { addColorStop: (...s) => calls.push(['stop', s]) };
      };
    },
    set(t, k, v) { calls.push(['set', k, v]); t[k] = v; return true; },
  });
  return { calls, ctx };
}
const digest = (calls) => createHash('sha1').update(JSON.stringify(calls)).digest('hex').slice(0, 16);
const glow = (ctx, x, y, r, a) => { if (a > 0) ctx.arc(x, y, r, 0, 1); };
const HIT = 85 / 295;
const draw = (family, t) => {
  const { ctx, calls } = recorder();
  drawStrikeFx(ctx, family, { cx: 100, cy: 50, t, hitStart: HIT, glow });
  return calls;
};

describe('sword strike FX', () => {
  // Digests were recorded from Hero._drawSwingFx before the FX moved out.
  const GOLDEN = {
    0: '97d170e1550eee4a', 40: '97d170e1550eee4a', 85: '4e9f4ca63c5f1136', 100: '10c74ec3cbc1c733',
    140: '9f8aef09c090ce0f', 200: '95501175ab352ad2', 250: '97d170e1550eee4a', 295: '97d170e1550eee4a',
  };
  it('draws exactly the calls it drew before the move', () => {
    for (const [ms, want] of Object.entries(GOLDEN)) {
      const hero = new Hero();
      hero.anim.play('swing');
      hero.anim.update(Number(ms) / 1000);
      const { ctx, calls } = recorder();
      hero._drawSwingFx(ctx, 100, 200, { px: 50, py: 120 });
      assert.equal(digest(calls), want, `${ms}ms`);
    }
  });
  it('treats an unknown family as sword', () => {
    assert.deepEqual(draw('nonsense', 0.4), draw('sword', 0.4));
  });
});

describe('buckler, staff and fist strike FX', () => {
  for (const family of ['buckler', 'staff', 'fist']) {
    it(`${family} waits for the hit frame and fades with the shared constant`, () => {
      assert.equal(draw(family, HIT - 0.1).length, 0);
      assert.ok(draw(family, HIT).length > 0);
      assert.ok(draw(family, HIT + 0.3).length > 0);
      assert.equal(draw(family, HIT + 0.55).length, 0);
      const alphas = (t) => draw(family, t).filter((c) => c[0] === 'set' && c[1] === 'globalAlpha').map((c) => c[2]);
      assert.ok(Math.max(...alphas(HIT + 0.3)) < Math.max(...alphas(HIT)));
    });
    it(`${family} uses canvas primitives only`, () => {
      assert.ok(!draw(family, HIT).some((c) => c[0] === 'drawImage'));
    });
  }
});

describe('bow strike FX', () => {
  const arrowAt = (t) => draw('bow', t).filter((c) => c[0] === 'moveTo' || c[0] === 'lineTo');
  it('puts the arrow at the anchor when the clip starts', () => {
    assert.equal(arrowX(100, 0, HIT), 100);
    const shaft = arrowAt(0);
    assert.deepEqual(shaft[0][1], [84, 50]);
    assert.deepEqual(shaft[1][1], [100, 50]);
  });
  it('lands at the reach, inside the sword arc, when the hit frame starts', () => {
    assert.equal(arrowX(100, HIT, HIT), 100 + BOW_REACH);
    assert.ok(BOW_REACH <= 146);
    assert.equal(arrowX(100, 1, HIT), 100 + BOW_REACH);
    const mid = arrowX(100, HIT / 2, HIT);
    assert.ok(mid > 100 && mid < 100 + BOW_REACH);
  });
  it('flies as a shaft with a trail, then a fading burst with no shaft', () => {
    const flight = draw('bow', HIT / 2);
    assert.ok(flight.filter((c) => c[0] === 'arc').length >= 5, 'trail particles');
    const at = draw('bow', HIT);
    assert.ok(at.some((c) => c[0] === 'lineTo'), 'burst particles');
    assert.ok(!at.some((c) => c[0] === 'fill'), 'no shaft head after the hit frame starts');
    assert.ok(draw('bow', HIT + 0.3).length > 0);
    assert.equal(draw('bow', HIT + 0.55).length, 0);
    assert.equal(draw('bow', 1).length, 0);
    assert.ok(!draw('bow', HIT).some((c) => c[0] === 'drawImage'));
  });
  it('is a pure function of progress', () => {
    for (const t of [0, 0.1, HIT, 0.5]) assert.deepEqual(draw('bow', t), draw('bow', t));
  });
  it('anchors on the hit frame during the windup, so the path does not jump', () => {
    const hero = new Hero();
    hero.setSkin({ strike: 'bow', anchors: { strike: [30, -60], cast: [[0, 0], [0, 0]] } });
    const calls = [];
    for (const ms of [0, 40]) {
      hero.anim.play('swing', { restart: true });
      hero.anim.update(ms / 1000);
      const { ctx, calls: c } = recorder();
      hero._drawSwingFx(ctx, 100, 200, { px: 50, py: 120 });
      calls.push(c.find((x) => x[0] === 'moveTo' || x[0] === 'arc'));
    }
    assert.deepEqual(calls[0][1], [50 + 100 + 30 - 16, 200 + 120 - 60]);
    assert.equal(calls[1][1][1], calls[0][1][1], 'same height in both poses');
  });
  it('leaves the shared swing table with a single hit event and no release', () => {
    const frames = HERO_CLIPS.swing.frames;
    assert.equal(frames.filter((f) => f.at).length, 1);
    assert.equal(frames.filter((f) => f.at === 'hit').length, 1);
  });
});
