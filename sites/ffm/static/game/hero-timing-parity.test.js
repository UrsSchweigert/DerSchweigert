import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { HERO_CLIPS } from './hero-anim.js';
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
      assert.deepEqual(SAMPLES.map((t) => got.track(t)), want.track, name);
    }
  });

  it('only reference frames the default atlas has', () => {
    for (const clip of Object.values(HERO_CLIPS)) {
      for (const fr of clip.frames) assert.ok(HERO_FRAMES[fr.f], fr.f);
    }
  });
});
