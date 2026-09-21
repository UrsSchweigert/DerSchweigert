// Pure, DOM-free, unit-testable module for hold-to-heal mechanics.
// No side effects; only pure functions and constants.

/**
 * Update the hold-to-heal progress accumulator.
 * 
 * When the player holds a finger/pointer on the hero for continuous time,
 * progress accumulates toward healing one heart. Once progress reaches the
 * secondsPerHeart threshold, exactly one heart is granted (progress resets
 * to 0) and healed is set to true. If holding stops or canHeal becomes false,
 * progress resets immediately to 0 with no heart granted.
 * 
 * Design note: this function grants AT MOST one heart per call, by design.
 * Even if dt is very large and next >= 2*secondsPerHeart, only one heart is
 * granted and progress is reset to 0 (not carried over to the next frame).
 * This prevents "catching up" multiple hearts in a single frame due to a
 * long frame time or lag spike.
 * 
 * Caller contract: canHeal must already encode hearts < maxHearts AND
 * heroState !== 'hurt' AND game is running/not paused. This function does
 * not know about hearts/maxHearts/hero state itself — it is purely a time
 * accumulator that returns true when a threshold is crossed.
 * 
 * @param {number} progress - current accumulated progress (0 to secondsPerHeart-1)
 * @param {number} dt - delta time in seconds since last call
 * @param {{ isHolding: boolean, canHeal: boolean, secondsPerHeart: number }} options
 * @returns {{ progress: number, healed: boolean }}
 */
export function updateHealHold(progress, dt, { isHolding, canHeal, secondsPerHeart }) {
  if (!isHolding || !canHeal) {
    return { progress: 0, healed: false };
  }
  
  const next = progress + dt;
  if (next >= secondsPerHeart) {
    return { progress: 0, healed: true };
  }
  
  return { progress: next, healed: false };
}

/**
 * Compute the visual intensity of the hold-to-heal aura, from 0 (nothing) to 1 (full).
 * Used to drive the pulsating green aura opacity and HUD heart glow.
 * 
 * @param {number} progress - current accumulated progress
 * @param {number} secondsPerHeart - seconds needed to heal one heart
 * @returns {number} ratio in [0, 1], clamped to never exceed 1
 */
export function getHealHoldRatio(progress, secondsPerHeart) {
  if (secondsPerHeart <= 0) return 0;
  return Math.min(1, progress / secondsPerHeart);
}

/**
 * Pure geometry check: is a given canvas-space x coordinate inside the
 * "heal zone" — the left quarter of the canvas? Tapping/holding here
 * triggers the hold-to-heal mechanic instead of the pause/resume toggle,
 * which applies to the remaining three quarters of the screen.
 *
 * Deliberately x-only (no y check): the heal zone spans the full height of
 * the canvas, independent of where the hero sprite is currently drawn.
 *
 * @param {number} pointX - pointer/touch x coordinate in logical canvas space
 * @param {number} canvasWidth - logical canvas width (e.g. CANVAS_W = 800)
 * @returns {boolean} true if pointX falls within the left quarter of the canvas
 */
export function isInHealZone(pointX, canvasWidth) {
  return pointX < canvasWidth / 4;
}
