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
