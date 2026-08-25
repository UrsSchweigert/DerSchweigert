import { CANVAS_W, HERO_X } from './renderer.js';

export const FIEND_ENTRY_TRIGGER_X = CANVAS_W - 40;
export const FIEND_COMBAT_X = HERO_X + 108;
const DEFAULT_FIEND_WALK_SPEED = 50;

export function getFiendWalkSpeed(timerSeconds, startX = FIEND_ENTRY_TRIGGER_X) {
  if (!Number.isFinite(timerSeconds) || timerSeconds <= 0) {
    return DEFAULT_FIEND_WALK_SPEED;
  }

  const distance = Math.max(0, startX - FIEND_COMBAT_X);
  return distance / timerSeconds;
}
