export function resolveDragonBreath(fiends) {
  let defeated = 0;
  for (const fiend of fiends) {
    if (fiend.isDead || fiend.state === 'death' || fiend.state === 'retreat') continue;
    fiend.hp = 0;
    fiend.setState('death');
    defeated++;
  }
  return defeated;
}

/** Fiends that no longer represent a remaining encounter: already dead, blown
 *  off the field by wind or storm (the sprite is still flying out), or walking
 *  off after a retreat. */
const RESOLVED_FIEND_STATES = new Set(['death', 'retreat']);

/**
 * True when a fiend is no longer an encounter the level still owes the player:
 * dead, blown at the camera by wind or storm, or walking off after a retreat.
 *
 * This is the accounting question (how many encounters are left, what a dragon
 * breath or a storm may still claim). Whether the wave is *complete* is a
 * stricter one — a blown fiend is defeated but still owns the field for the
 * length of its flight — and `checkAllDefeated()` in main.js answers that.
 */
export function isResolvedFiend(fiend) {
  return !fiend || fiend.isDead === true || fiend.isLeaving === true ||
    RESOLVED_FIEND_STATES.has(fiend.state);
}

function isRemainingFiend(fiend) {
  return Boolean(fiend) && !isResolvedFiend(fiend);
}

/** How many encounters are still unresolved when a dragon breath lands: every
 *  entry still queued to spawn, every requeued fiend, and every live fiend on
 *  screen. A fiend object that is both on screen and in the requeue list (or
 *  listed twice) is counted exactly once. */
export function countDragonRemainingEncounters({ fiends = [], spawnQueue = [], requeuedFiends = [] } = {}) {
  const counted = new Set();
  let remaining = spawnQueue.length;
  for (const fiend of [...requeuedFiends, ...fiends]) {
    if (!isRemainingFiend(fiend) || counted.has(fiend)) continue;
    counted.add(fiend);
    remaining += 1;
  }
  return remaining;
}

export function createAnswerClock() {
  let elapsed = 0;
  return {
    reset() { elapsed = 0; },
    advance(seconds, active) {
      if (!Number.isFinite(seconds) || seconds < 0) throw new TypeError('Invalid answer-clock interval');
      if (active) elapsed += seconds;
    },
    read() { return elapsed; },
  };
}
