import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { updateHealHold, getHealHoldRatio, isInHealZone } from './heal-hold.js';

describe('updateHealHold', () => {
  it('progress accumulates while isHolding and canHeal are both true', () => {
    const result = updateHealHold(0, 1, { isHolding: true, canHeal: true, secondsPerHeart: 9 });
    assert.strictEqual(result.progress, 1);
    assert.strictEqual(result.healed, false);
  });

  it('resets progress to 0 immediately when isHolding becomes false, even with prior progress', () => {
    const result = updateHealHold(5, 1, { isHolding: false, canHeal: true, secondsPerHeart: 9 });
    assert.strictEqual(result.progress, 0);
    assert.strictEqual(result.healed, false);
  });

  it('resets progress to 0 immediately when canHeal becomes false, even with prior progress', () => {
    const result = updateHealHold(5, 1, { isHolding: true, canHeal: false, secondsPerHeart: 9 });
    assert.strictEqual(result.progress, 0);
    assert.strictEqual(result.healed, false);
  });

  it('grants exactly one heart (healed: true, progress: 0) when reaching the threshold', () => {
    // Exactly at threshold
    const result1 = updateHealHold(9, 0, { isHolding: true, canHeal: true, secondsPerHeart: 9 });
    assert.strictEqual(result1.progress, 0);
    assert.strictEqual(result1.healed, true);

    // Slightly over threshold (9.5 seconds accumulated)
    const result2 = updateHealHold(8.5, 1, { isHolding: true, canHeal: true, secondsPerHeart: 9 });
    assert.strictEqual(result2.progress, 0);
    assert.strictEqual(result2.healed, true);
  });

  it('caps at one heart per call (does NOT carry over extra time even with huge dt)', () => {
    // Simulate a huge dt that would accumulate 2x the threshold
    // 0 + 20 = 20, which is > 9, but should grant only 1 heart and reset to 0
    const result = updateHealHold(0, 20, { isHolding: true, canHeal: true, secondsPerHeart: 9 });
    assert.strictEqual(result.healed, true, 'should grant one heart');
    assert.strictEqual(result.progress, 0, 'should reset to 0, not carry over to 11 (20-9)');
  });

  it('accumulates over multiple small calls, eventually crossing the threshold', () => {
    let progress = 0;
    let healed = false;

    // Simulate 10 calls of dt=1 each
    for (let i = 0; i < 10; i++) {
      const result = updateHealHold(progress, 1, { isHolding: true, canHeal: true, secondsPerHeart: 9 });
      progress = result.progress;
      healed = result.healed;
      
      if (i < 8) {
        // Calls 0-7: accumulating, should not trigger
        assert.strictEqual(result.healed, false, `call ${i} should not heal yet`);
      } else {
        // Call 8 (9 seconds accumulated) or later should trigger
        if (result.healed) {
          assert.strictEqual(i, 8, 'healing should trigger on the 9th call (i=8)');
          assert.strictEqual(result.progress, 0, 'progress should reset to 0 after healing');
          break;
        }
      }
    }

    assert.strictEqual(healed, true, 'should have healed by end of loop');
  });
});

describe('getHealHoldRatio', () => {
  it('returns 0 at progress 0', () => {
    assert.strictEqual(getHealHoldRatio(0, 9), 0);
  });

  it('returns 0.5 at halfway through the duration', () => {
    assert.strictEqual(getHealHoldRatio(4.5, 9), 0.5);
  });

  it('returns 1 at or above the threshold', () => {
    assert.strictEqual(getHealHoldRatio(9, 9), 1);
    assert.strictEqual(getHealHoldRatio(10, 9), 1);
    assert.strictEqual(getHealHoldRatio(100, 9), 1, 'should clamp to 1 even at 100 seconds');
  });

  it('does not exceed 1 even if progress > secondsPerHeart', () => {
    const ratio = getHealHoldRatio(20, 9);
    assert.strictEqual(ratio, 1);
    assert(ratio <= 1, 'ratio should never exceed 1');
  });

  it('returns 0 when secondsPerHeart is 0 or negative', () => {
    assert.strictEqual(getHealHoldRatio(5, 0), 0);
    assert.strictEqual(getHealHoldRatio(5, -1), 0);
  });

  it('returns correct intermediate values', () => {
    // 1/4 of the way through
    assert.strictEqual(getHealHoldRatio(2.25, 9), 0.25);
    // 3/4 of the way through
    assert.strictEqual(getHealHoldRatio(6.75, 9), 0.75);
  });
});

describe('isInHealZone', () => {
  const CANVAS_W = 800;

  it('returns true for a point in the middle of the left quarter', () => {
    assert.strictEqual(isInHealZone(100, CANVAS_W), true);
  });

  it('returns true for a point at the very left edge', () => {
    assert.strictEqual(isInHealZone(0, CANVAS_W), true);
  });

  it('returns false exactly at the quarter boundary', () => {
    // boundary itself belongs to the pause zone (strict less-than)
    assert.strictEqual(isInHealZone(CANVAS_W / 4, CANVAS_W), false);
  });

  it('returns false just past the quarter boundary', () => {
    assert.strictEqual(isInHealZone(CANVAS_W / 4 + 1, CANVAS_W), false);
  });

  it('returns false for a point in the remaining three quarters', () => {
    assert.strictEqual(isInHealZone(500, CANVAS_W), false);
  });

  it('returns false for a point at the far right edge', () => {
    assert.strictEqual(isInHealZone(CANVAS_W, CANVAS_W), false);
  });

  it('is independent of the y coordinate / hero position (x-only check)', () => {
    // Same x, regardless of where the hero sprite happens to be drawn
    assert.strictEqual(isInHealZone(50, CANVAS_W), true);
    assert.strictEqual(isInHealZone(600, CANVAS_W), false);
  });

  it('works with a different canvas width', () => {
    assert.strictEqual(isInHealZone(99, 400), true);
    assert.strictEqual(isInHealZone(101, 400), false);
  });
});
