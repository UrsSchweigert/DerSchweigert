// low-health.js — when the hero counts as "low on health" and the heartbeat
// that signals it. Pure: no DOM, no timers; the game loop feeds it frame deltas.

export const LOW_HEALTH_RATIO = 0.3;
export const HEARTBEAT_PERIOD = 1;

/**
 * Low health: at least one heart left, below the maximum, and under 30% of the
 * maximum or the last heart. A full-health hero is never low, even at maxHearts 1.
 */
export function isLowHealth(hearts, maxHearts) {
  if (!(hearts > 0) || hearts >= maxHearts) return false;
  return hearts === 1 || hearts / maxHearts < LOW_HEALTH_RATIO;
}

/**
 * A beat scheduler. tick(dt, active) returns true when a beat is due: at once
 * on entering the active state, then once per period. At most one beat per call.
 */
export function createHeartbeat(period = HEARTBEAT_PERIOD) {
  let wait = 0;
  let running = false;
  return {
    tick(dt, active) {
      if (!active) {
        running = false;
        return false;
      }
      if (!running) {
        running = true;
        wait = period;
        return true;
      }
      wait -= Math.max(0, dt || 0);
      if (wait > 0) return false;
      wait = period;
      return true;
    },
    reset() {
      running = false;
    },
  };
}
