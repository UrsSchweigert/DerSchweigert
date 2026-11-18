import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// entities.js builds its sprite caches at module load, which needs a browser
// Image. The stub reports itself as loaded so the atlas path is available.
globalThis.Image ??= class { constructor() { this.complete = true; this.naturalWidth = 64; this.naturalHeight = 64; } };
const { Hero } = await import('./entities.js');

const tick = (hero, seconds, step = 1 / 60) => {
  for (let t = 0; t < seconds; t += step) hero.update(step);
};

// The knockback home from a strike holds the swing's last pose instead of
// walking, so the hero never runs backwards while facing forwards.
describe('holding a strike pose', () => {
  it('keeps the strike parked on its last frame past the end of the clip', () => {
    const hero = new Hero();
    hero.setState('swing');
    hero.holdPose();
    tick(hero, 1);
    assert.equal(hero.anim.clip, 'swing');
    assert.equal(hero.anim.frameId, 'swing-4');
    assert.equal(hero.state, 'swing');
    assert.equal(hero.anim.finished, true);
  });

  it('hands over to idle as soon as the pose is released', () => {
    const hero = new Hero();
    hero.setState('swing');
    hero.holdPose();
    tick(hero, 1);
    hero.releasePose();
    tick(hero, 1 / 60);
    assert.equal(hero.anim.clip, 'idle');
    assert.equal(hero.state, 'idle');
  });

  it('does not leak into the next clip', () => {
    const hero = new Hero();
    hero.setState('swing');
    hero.holdPose();
    tick(hero, 1);
    hero.setState('walk');
    tick(hero, 0.2);
    assert.equal(hero.anim.clip, 'walk');
    hero.setState('swing');
    tick(hero, 1);
    assert.equal(hero.anim.clip, 'idle', 'a later strike must still finish on its own');
  });

  it('leaves a still-playing strike alone until its last frame', () => {
    const hero = new Hero();
    hero.setState('swing');
    hero.holdPose();
    tick(hero, 0.12);          // mid strike: still travelling through the frames
    assert.notEqual(hero.anim.frameId, 'swing-4');
    tick(hero, 0.5);
    assert.equal(hero.anim.frameId, 'swing-4');
  });
});

// Skin seam: a hero that never gets setSkin draws exactly as before.
describe('hero skin', () => {
  const fakeCtx = () => {
    const calls = [];
    const ctx = new Proxy({}, {
      get: (_, k) => (k === 'calls' ? calls : (...a) => { if (k === 'drawImage') calls.push(a); return { addColorStop() {} }; }),
      set: () => true,
    });
    return ctx;
  };
  const drawn = (hero, clip) => {
    hero.setState(clip);
    tick(hero, 0.1);
    const ctx = fakeCtx();
    hero.draw(ctx);
    return ctx.calls;
  };
  const atlas = { complete: true, naturalWidth: 8 };

  it('draws the default atlas frame for each clip', async () => {
    const { HERO_FRAMES } = await import('./hero/hero-frames.js');
    for (const clip of ['idle', 'walk', 'swing', 'hurt', 'dead', 'victory', 'cast']) {
      const hero = new Hero();
      const calls = drawn(hero, clip);
      const f = HERO_FRAMES[hero.anim.frameId];
      assert.equal(calls.length, 1, clip);
      assert.deepEqual(calls[0].slice(1, 5), [f.x, f.y, f.w, f.h], clip);
    }
  });

  it('setSkin changes one instance only', () => {
    const a = new Hero();
    const b = new Hero();
    const frames = { 'idle-1': { x: 1, y: 2, w: 3, h: 4, px: 1, py: 4 } };
    a.setSkin({ atlas, frames, strike: 'bow', anchors: { strike: [1, 2], cast: [[3, 4], [5, 6]] } });
    const calls = drawn(a, 'idle');
    assert.equal(calls[0][0], atlas);
    assert.equal(a.strike, 'bow');
    assert.equal(b.strike, 'sword');
    assert.notEqual(b._atlas, atlas);
    assert.notEqual(b._frames, frames);
    assert.deepEqual(a.castHandAnchor(), [3, 4]);
    assert.deepEqual(b.castHandAnchor(), [100, -122]);
  });

  it('ignores a missing skin and keeps the procedural hero without a usable atlas', () => {
    const hero = new Hero();
    hero.setSkin(undefined);
    hero.setSkin('x');
    assert.deepEqual(hero.castHandAnchor(), [100, -122]);
    hero.setSkin({ atlas: { complete: false, naturalWidth: 0 } });
    assert.equal(drawn(hero, 'idle').length, 0);
  });
});
