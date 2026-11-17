import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { HERO_CLIPS, HERO_TIMING, DEFAULT_HERO_ANCHORS, buildHeroClips } from './hero-anim.js';
import { HERO_FRAMES } from './hero/hero-frames.js';

// Literal snapshot of the clips as they shipped before the skin seam: frames,
// loop, next and the track sampled at five points.
const SNAPSHOT = {"idle":{"frames":[{"f":"idle-1","ms":620},{"f":"idle-2","ms":620},{"f":"idle-3","ms":620},{"f":"idle-4","ms":620}],"loop":true,"track":[{"dy":0},{"dy":-0.8},{"dy":-9.797174393178826e-17},{"dy":0.8},{"dy":1.9594348786357652e-16}]},"walk":{"frames":[{"f":"walk-1","ms":115},{"f":"walk-2","ms":115},{"f":"walk-3","ms":115},{"f":"walk-4","ms":115}],"loop":true,"track":[{"dy":0,"dx":0},{"dy":-1.6,"dx":0.5},{"dy":-1.9594348786357652e-16,"dx":6.123233995736766e-17},{"dy":-1.6,"dx":-0.5},{"dy":-3.9188697572715305e-16,"dx":-1.2246467991473532e-16}]},"swing":{"frames":[{"f":"swing-1","ms":85},{"f":"swing-2","ms":55,"at":"hit","fx":"slash","fxAt":[70,-55]},{"f":"swing-3","ms":60},{"f":"swing-4","ms":95}],"next":"idle","track":[{"dx":-2,"rot":-0.04},{"dx":2.2857142857142856,"rot":-0.02},{"dx":2.6153846153846154,"rot":0},{"dx":0.3076923076923075,"rot":0.019999999999999997},{"dx":-2,"rot":0.04}]},"hurt":{"frames":[{"f":"hurt-1","ms":90,"at":"hurt","fx":"hurt"},{"f":"hurt-2","ms":90},{"f":"hurt-3","ms":110},{"f":"hurt-4","ms":120}],"next":"idle","track":[{"dx":0,"rot":0},{"dx":-6.657395614066075,"rot":-0.028531695488854605},{"dx":-4.114496766047313,"rot":-0.017633557568774196},{"dx":-8.572527594031472e-16,"rot":-3.673940397442059e-18},{"dx":-8.572527594031472e-16,"rot":-3.673940397442059e-18}]},"dead":{"frames":[{"f":"dead-1","ms":120,"at":"collapse"},{"f":"dead-2","ms":150},{"f":"dead-3","ms":220},{"f":"dead-4","ms":900}],"next":"dead","track":[{"dy":1.5},{"dy":0},{"dy":0},{"dy":0},{"dy":0}]},"victory":{"frames":[{"f":"victory-1","ms":230,"at":"raise"},{"f":"victory-2","ms":230,"at":"cheer"},{"f":"victory-3","ms":230,"at":"plant"},{"f":"victory-4","ms":260,"at":"hold"}],"next":"victory","track":[{"dy":0},{"dy":-1.1086554390135441},{"dy":-1.4695761589768238e-16},{"dy":-1.4695761589768238e-16},{"dy":-1.4695761589768238e-16}]},"cast":{"frames":[{"f":"cast-1","ms":90,"at":"charge"},{"f":"cast-2","ms":110,"at":"release","fx":"cast","fxAt":[100,-122]},{"f":"cast-3","ms":140,"fx":"cast","fxAt":[94,-126]},{"f":"cast-4","ms":170}],"next":"idle","track":[{"dx":-2},{"dx":0.8571428571428572},{"dx":2.6923076923076925},{"dx":3.8461538461538463},{"dx":5}]}};
const SAMPLES = [0, 0.25, 0.5, 0.75, 1];

describe('default hero clips', () => {
  it('match the pre-seam snapshot', () => {
    assert.deepEqual(Object.keys(HERO_CLIPS), Object.keys(SNAPSHOT));
    for (const [name, want] of Object.entries(SNAPSHOT)) {
      const got = HERO_CLIPS[name];
      assert.deepEqual(got.frames, want.frames, name);
      assert.equal(got.loop, want.loop, name);
      assert.equal(got.next, want.next, name);
      // JSON round trip: the snapshot cannot hold -0.
      assert.deepEqual(JSON.parse(JSON.stringify(SAMPLES.map((t) => got.track(t)))), want.track, name);
    }
  });

  it('only reference frames the default atlas has', () => {
    for (const clip of Object.values(HERO_CLIPS)) {
      for (const fr of clip.frames) assert.ok(HERO_FRAMES[fr.f], fr.f);
    }
  });
});

const timingOf = (clips) => Object.fromEntries(Object.entries(clips).map(([n, c]) => [n, {
  loop: c.loop, next: c.next,
  frames: c.frames.map(({ f, ms, at, fx }) => ({ f, ms, at, fx })),
}]));

function assertSharedTiming(clips, frames, label) {
  assert.deepEqual(timingOf(clips), timingOf(HERO_TIMING), label);
  for (const [name, clip] of Object.entries(clips)) {
    for (const fr of clip.frames) assert.ok(frames[fr.f], `${label} ${name} ${fr.f}`);
  }
}

describe('buildHeroClips', () => {
  it('with default anchors equals HERO_CLIPS and the snapshot', () => {
    const built = buildHeroClips(DEFAULT_HERO_ANCHORS);
    assert.deepEqual(built.swing.frames, HERO_CLIPS.swing.frames);
    for (const [name, want] of Object.entries(SNAPSHOT)) {
      assert.deepEqual(built[name].frames, want.frames, name);
    }
    assertSharedTiming(built, HERO_FRAMES, 'default');
  });

  it('lets a skin move only the strike and cast anchors', () => {
    const built = buildHeroClips({
      strike: [1, 2], cast: [[3, 4], [5, 6]], ms: 5, frames: [], loop: false,
    });
    assert.deepEqual(built.swing.frames[1].fxAt, [1, 2]);
    assert.deepEqual(built.cast.frames[1].fxAt, [3, 4]);
    assert.deepEqual(built.cast.frames[2].fxAt, [5, 6]);
    assertSharedTiming(built, HERO_FRAMES, 'skinned');
  });

  it('falls back to today\'s values for missing or malformed anchors', () => {
    for (const bad of [undefined, null, 7, {}, { strike: 'x', cast: 4 }, { strike: [1], cast: [[NaN, 1]] }]) {
      assert.deepEqual(buildHeroClips(bad).swing.frames, HERO_CLIPS.swing.frames);
      assert.deepEqual(buildHeroClips(bad).cast.frames, HERO_CLIPS.cast.frames);
    }
    const half = buildHeroClips({ strike: [9, 9], cast: [null, [7, 8]] });
    assert.deepEqual(half.swing.frames[1].fxAt, [9, 9]);
    assert.deepEqual(half.cast.frames[1].fxAt, DEFAULT_HERO_ANCHORS.cast[0]);
    assert.deepEqual(half.cast.frames[2].fxAt, [7, 8]);
  });

  it('does not share frames with the frozen table', () => {
    const built = buildHeroClips();
    assert.ok(Object.isFrozen(HERO_TIMING.swing.frames[0]));
    assert.notEqual(built.swing.frames[0], HERO_TIMING.swing.frames[0]);
  });
});

describe('every hero on disk', () => {
  const dir = new URL('./heroes/', import.meta.url);
  const manifest = JSON.parse(fs.readFileSync(new URL('manifest.json', dir), 'utf8'));
  for (const hero of manifest.heroes) {
    const url = new URL(hero.frames, import.meta.url);
    it(hero.id, async (t) => {
      if (!fs.existsSync(url)) return t.skip('no frames module');
      const mod = await import(url.href);
      const clips = buildHeroClips(mod.HERO_ANCHORS);
      assertSharedTiming(clips, mod.HERO_FRAMES, hero.id);
    });
  }
});
