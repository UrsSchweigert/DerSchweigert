import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  FIEND_COMBAT_X,
  FIEND_ENTRY_TRIGGER_X,
  FIEND_PORTAL_X,
  getFiendWalkSpeed,
  getProblemTimerRemaining,
  shouldPreserveTimerAfterHit,
} from './difficulty.js';

describe('getFiendWalkSpeed', () => {
  it('matches the selected timer when a fiend becomes active', () => {
    for (const timerSeconds of [30, 15, 7]) {
      const speed = getFiendWalkSpeed(timerSeconds);
      const arrivalX = FIEND_ENTRY_TRIGGER_X - speed * timerSeconds;
      assert.ok(Math.abs(arrivalX - FIEND_COMBAT_X) < 1e-9);
    }
  });

  it('recalculates from the fiend current position', () => {
    const currentX = 500;
    const timerSeconds = 10;
    const speed = getFiendWalkSpeed(timerSeconds, currentX);
    const arrivalX = currentX - speed * timerSeconds;
    assert.ok(Math.abs(arrivalX - FIEND_COMBAT_X) < 1e-9);
  });

  it('falls back to the legacy walk speed for invalid timers', () => {
    assert.strictEqual(getFiendWalkSpeed(0), 50);
    assert.strictEqual(getFiendWalkSpeed(Number.NaN), 50);
  });
});

describe('elite timer behavior', () => {
  it('preserves the shared timer only for surviving elite fiends', () => {
    assert.strictEqual(shouldPreserveTimerAfterHit({ isElite: true, hp: 2 }), true);
    assert.strictEqual(shouldPreserveTimerAfterHit({ isElite: true, hp: 0 }), false);
    assert.strictEqual(shouldPreserveTimerAfterHit({ isElite: false, hp: 2 }), false);
  });

  it('reuses remaining time only when preserving the timer', () => {
    assert.strictEqual(getProblemTimerRemaining(15, 6.5, true), 6.5);
    assert.strictEqual(getProblemTimerRemaining(15, 6.5, false), 15);
  });
});

describe('fiend entrance', () => {
  it('spawns inside the canvas and still arrives on the level timer', () => {
    // The portal sits a light-pool away from the right edge (so it is not chopped
    // off) and left of the entry trigger (so the question appears immediately).
    assert.ok(FIEND_PORTAL_X <= FIEND_ENTRY_TRIGGER_X - 40);
    assert.ok(FIEND_PORTAL_X + 80 <= 800, 'the portal glow stays on canvas');
    const speed = getFiendWalkSpeed(10, FIEND_PORTAL_X);
    assert.ok(Math.abs(FIEND_PORTAL_X - speed * 10 - FIEND_COMBAT_X) < 1e-9);
  });
});
