import { CANVAS_W, HERO_X } from './renderer.js';

export const FIEND_ENTRY_TRIGGER_X = CANVAS_W - 40;
// Where a fiend appears. It used to walk in from off-screen (CANVAS_W + 20), which
// on most level backgrounds meant sliding across a wall, a gate or a dark edge; it
// now steps out of a portal on the ground line instead. Kept a portal-radius away
// from the right edge so the light pool is not chopped off by the canvas, and left
// of FIEND_ENTRY_TRIGGER_X so the question bubble appears on the first frame.
// Callers must pass this x to getFiendWalkSpeed() — the arrival has to stay on the
// level's timer even though the walk is 40 px shorter.
export const FIEND_PORTAL_X = CANVAS_W - 80;
export const FIEND_COMBAT_X = HERO_X + 108;
const DEFAULT_FIEND_WALK_SPEED = 50;

export function getFiendWalkSpeed(timerSeconds, startX = FIEND_ENTRY_TRIGGER_X) {
  if (!Number.isFinite(timerSeconds) || timerSeconds <= 0) {
    return DEFAULT_FIEND_WALK_SPEED;
  }

  const distance = Math.max(0, startX - FIEND_COMBAT_X);
  return distance / timerSeconds;
}

export function shouldPreserveTimerAfterHit(fiend) {
  return Boolean(fiend?.isElite && fiend.hp > 0);
}

export function getProblemTimerRemaining(timerMax, currentRemaining, preserveRemaining = false) {
  return preserveRemaining ? currentRemaining : timerMax;
}
