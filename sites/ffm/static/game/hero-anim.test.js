import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { HeroAnimator, HERO_CLIPS, castHandAnchor } from './hero-anim.js';
import { HERO_FRAMES } from './hero/hero-frames.js';

const clips = {
  idle: { frames: [{ f: 'a', ms: 1000 }], loop: true },
  two: {
    frames: [
      { f: 'a', ms: 100, at: 'first' },
      { f: 'b', ms: 50, at: 'second' },
    ],
    next: 'idle',
  },
  one: { frames: [{ f: 'a', ms: 100, at: 'start' }], next: 'idle' },
};

describe('HeroAnimator timing', () => {
  it('advances frames on wall-clock time, not on a fixed tick count', () => {
    const anim = new HeroAnimator(clips);
    anim.play('two');
    anim.update(0.09);
    assert.equal(anim.frameId, 'a');
    anim.update(0.02);
    assert.equal(anim.frameId, 'b');
  });

  it('stays on the last frame of a non-looping clip and reports done once', () => {
    const anim = new HeroAnimator(clips);
    const events = [];
    anim.on('done', (e) => events.push(e));
    anim.play('one');
    anim.update(0.05);
    assert.equal(anim.frameId, 'a');
    anim.update(0.2);
    assert.equal(anim.finished, true);
    anim.update(0.2);
    assert.equal(anim.finished, true);
    assert.deepEqual(events, ['done']);
  });

  it('finishes a multi-frame clip when it is stepped frame by frame', () => {
    // Regression: parking on the last frame used to carry the overshoot into
    // `_elapsed`, so a clip longer than one frame reported finished=false
    // forever and the hero never left his swing/cast pose. A 16 ms step is
    // what the game loop actually does; the tests below only passed with a
    // single-frame clip or one huge step.
    const anim = new HeroAnimator(clips);
    const events = [];
    anim.on('done', (e) => events.push(e));
    anim.play('two');
    for (let i = 0; i < 20 && !anim.finished; i++) anim.update(0.016);
    assert.equal(anim.finished, true, 'two-frame clip must finish when stepped at 16 ms');
    assert.equal(anim.frameId, 'b');
    assert.deepEqual(events, ['done']);
    anim.update(0.5);
    assert.equal(anim.finished, true);
    assert.deepEqual(events, ['done'], 'done fires once per play()');
  });

  it('hands the shipped swing clip back to idle after its last frame', () => {
    const anim = new HeroAnimator();
    anim.play('swing', { restart: true });
    const total = HERO_CLIPS.swing.frames.reduce((sum, f) => sum + f.ms, 0);
    const steps = Math.ceil(total / 16) + 2;
    for (let i = 0; i < steps && !anim.finished; i++) anim.update(0.016);
    assert.equal(anim.finished, true);
    anim.play(HERO_CLIPS.swing.next);
    assert.equal(anim.clip, 'idle');
    assert.equal(anim.finished, false);
  });

  it('loops back to the first frame', () => {
    const anim = new HeroAnimator(clips);
    anim.play('idle');
    anim.update(1.5);
    assert.equal(anim.frameId, 'a');
    assert.equal(anim.clip, 'idle');
    assert.equal(anim.finished, false);
  });

  it('survives a long stall by consuming at most one lap per update step', () => {
    const anim = new HeroAnimator(clips);
    anim.play('two');
    anim.update(10);
    assert.equal(anim.clip, 'two');
    assert.equal(anim.finished, true);
  });

  it('ignores non-positive or non-finite steps', () => {
    const anim = new HeroAnimator(clips);
    anim.play('two');
    anim.update(0);
    anim.update(-1);
    anim.update(Number.NaN);
    assert.equal(anim.frameId, 'a');
  });
});

describe('HeroAnimator clip entry and events', () => {
  it('fires frame-0 events when the clip starts', () => {
    const anim = new HeroAnimator(clips);
    const seen = [];
    anim.on('start', () => seen.push('start'));
    anim.play('one');
    assert.deepEqual(seen, ['start']);
  });

  it('fires events at the frame they belong to', () => {
    const anim = new HeroAnimator(clips);
    const seen = [];
    anim.on('second', () => seen.push('second'));
    anim.play('two');
    anim.update(0.12);
    assert.deepEqual(seen, ['second']);
  });

  it('re-playing the running clip does not restart it unless asked', () => {
    const anim = new HeroAnimator(clips);
    anim.play('two');
    anim.update(0.12);
    anim.play('two');
    assert.equal(anim.frameId, 'b');
    anim.play('two', { restart: true });
    assert.equal(anim.frameId, 'a');
  });

  it('returns false for an unknown clip and keeps playing the current one', () => {
    const anim = new HeroAnimator(clips);
    anim.play('two');
    assert.equal(anim.play('nope'), false);
    assert.equal(anim.clip, 'two');
  });
});

describe('HeroAnimator transform track', () => {
  it('is identity for a clip without a track', () => {
    const anim = new HeroAnimator(clips);
    anim.play('two');
    assert.deepEqual(anim.transform, { dx: 0, dy: 0, rot: 0 });
  });

  it('reports increasing progress across the clip as time is read', () => {
    const seen = [];
    const anim = new HeroAnimator({
      ramp: { frames: [{ f: 'a', ms: 100 }], track: (t) => { seen.push(t); return { dy: t }; } },
    });
    anim.play('ramp');
    anim.update(0.025);
    const first = anim.transform.dy;
    anim.update(0.05);
    const second = anim.transform.dy;
    assert.ok(first > 0 && first < second && second < 1, `progress ${first} -> ${second}`);
    assert.deepEqual(seen.length, 2);
  });
});

describe('shipped hero clips', () => {
  it('reference only frames the atlas builder produces', () => {
    // Taken from the built atlas metadata, so a clip that names a frame the
    // build does not emit fails here instead of at draw time.
    const built = new Set(Object.keys(HERO_FRAMES));
    for (const [name, clip] of Object.entries(HERO_CLIPS)) {
      for (const frame of clip.frames) {
        assert.ok(built.has(frame.f), `${name} references unknown frame ${frame.f}`);
        assert.ok(frame.ms > 0, `${name}/${frame.f} needs a duration`);
      }
    }
  });

  it('keeps the clip that resolves gameplay short enough to stay responsive', () => {
    const swing = HERO_CLIPS.swing.frames.reduce((sum, f) => sum + f.ms, 0);
    assert.ok(swing <= 300, `swing clip is ${swing}ms`);
    assert.equal(HERO_CLIPS.swing.frames.some((f) => f.at === 'hit'), true);
  });

  it('anchors every locomotion frame on the same point, so the hero cannot slide', () => {
    // The atlas pivot is what puts the sprite at the hero's x. It used to be
    // the midpoint of the bottom row, which is the blade tip whenever the
    // blade dips below the boots - the exhale pose sat 18 px left of the
    // others and the breathing cycle visibly drifted. Torso-centred pivots
    // keep a standing cycle within a few pixels.
    for (const clip of ['idle', 'walk']) {
      const px = HERO_CLIPS[clip].frames.map((f) => HERO_FRAMES[f.f].px);
      const spread = Math.max(...px) - Math.min(...px);
      assert.ok(spread <= 6, `${clip} pivots spread ${spread} px across ${px.join(',')}`);
    }
    for (const [id, frame] of Object.entries(HERO_FRAMES)) {
      assert.ok(frame.px > 0 && frame.px < frame.w, `${id} pivot ${frame.px} outside its ${frame.w}px box`);
    }
  });
});

describe('cast hand anchor', () => {
  it('points at the hand the release frame draws the palm glow in', () => {
    const release = HERO_CLIPS.cast.frames.find((f) => f.at === 'release');
    assert.deepEqual(castHandAnchor(), release.fxAt);
  });

  it('sits in the upper body, above the hip, so a spell erupts from the hand', () => {
    const [dx, dy] = castHandAnchor();
    // Frame pixels relative to the ground pivot: the hand is above the hero's
    // belt (roughly -70) and forward of the body's centre line.
    assert.ok(dy <= -100, `hand anchor y is ${dy}, not up in the raised hand`);
    assert.ok(dx > 0, `hand anchor x is ${dx}, not forward of the body`);
  });

  it('falls back to the frame list head when a clip has no release event', () => {
    const anchor = castHandAnchor({ frames: [{ f: 'x', ms: 10, fxAt: [7, -9] }] });
    assert.deepEqual(anchor, [7, -9]);
    assert.deepEqual(castHandAnchor({ frames: [{ f: 'x', ms: 10 }] }), [0, 0]);
  });
});
