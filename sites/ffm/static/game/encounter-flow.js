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

/** Fiends that no longer represent a remaining encounter: already dead, or
 *  walking off the field after a retreat. */
const RESOLVED_FIEND_STATES = new Set(['death', 'retreat']);

function isRemainingFiend(fiend) {
  return Boolean(fiend) && !fiend.isDead && !RESOLVED_FIEND_STATES.has(fiend.state);
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
