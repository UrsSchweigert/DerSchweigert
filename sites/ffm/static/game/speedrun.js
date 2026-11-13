// speedrun.js — the continuous-run clock and the records it leaves behind.
//
// A run starts when level 1 of the campaign starts and follows the campaign
// through the levels in order: it only continues into the next level, and it
// only ever advances from 1 to 60. Anything that breaks the sequence — a replay
// of the level just finished, a jump to another level, returning to the title,
// losing the run, or finishing level 60 — ends it.
//
// Only "in level" time counts. The clock is fed by the caller, which knows when
// a level is actually being played, so pauses, level-clear screens, story
// scenes and loading never end up in the time.
//
// Records are local to the device (localStorage), like the locale and the
// story flag: they describe this install. The web build additionally reports a
// finished run to the server for the leaderboard.

export const FIRST_RUN_LEVEL = 1;
export const TOTAL_RUN_LEVELS = 60;
export const SPEEDRUN_STORAGE_KEY = 'arithmoslayer:speedrun:v1';

function defaultStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    // Blocked storage (sandboxed frame, storage disabled) means no records
    // rather than a broken game.
    return null;
  }
}

function isTime(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function normaliseLevels(levels) {
  if (!levels || typeof levels !== 'object') return {};
  const clean = {};
  for (const [key, value] of Object.entries(levels)) {
    const level = Number(key);
    if (!Number.isInteger(level) || level < FIRST_RUN_LEVEL || level > TOTAL_RUN_LEVELS) continue;
    if (!isTime(value)) continue;
    clean[level] = value;
  }
  return clean;
}

function readStored(storage) {
  let text = null;
  try {
    text = storage?.getItem?.(SPEEDRUN_STORAGE_KEY) ?? null;
  } catch {
    return null;
  }
  if (!text) return null;
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * A clock for one continuous run. The caller decides what "playing" means and
 * ticks it; the timer only knows the run's shape.
 *
 * @returns {object} timer
 */
export function createSpeedrunTimer() {
  let run = null;

  function clear() {
    run = null;
  }

  return {
    /** @returns {boolean} whether a run is active. */
    get active() {
      return run !== null;
    },

    /**
     * Called whenever a campaign level starts in a way that could continue a
     * run. Starts a run at level 1, continues one into the level that follows
     * the level it just finished, and ends one that was interrupted.
     *
     * @param {number} level - 1-based campaign level.
     * @returns {boolean} whether a run is active after the call.
     */
    start(level) {
      if (!Number.isInteger(level)) throw new TypeError('A speedrun needs a whole level number');
      if (run && level === run.level + 1) {
        run.level = level;
        run.levelMs = 0;
        run.running = true;
        return true;
      }
      // A replay, a jump or a fresh start: the run that was going no longer is.
      clear();
      if (level !== FIRST_RUN_LEVEL) return false;
      run = { level, runMs: 0, levelMs: 0, running: true };
      return true;
    },

    /**
     * @param {number} seconds - gameplay time to add, excluding pauses.
     * @returns {boolean} whether the time was counted.
     */
    tick(seconds) {
      if (!run || !run.running) return false;
      if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0) return false;
      run.runMs += seconds * 1000;
      run.levelMs += seconds * 1000;
      return true;
    },

    /**
     * Stops the clock on a finished level and reports its split. The run total
     * is frozen until the next level starts, so the level-clear screen costs no
     * time.
     *
     * @returns {{level: number, levelMs: number, runMs: number, final: boolean}|null}
     *   the split, or null when no run is active.
     */
    completeLevel() {
      if (!run) return null;
      run.running = false;
      const split = {
        level: run.level,
        levelMs: run.levelMs,
        runMs: run.runMs,
        final: run.level >= TOTAL_RUN_LEVELS,
      };
      if (split.final) clear();
      return split;
    },

    /** Ends the run without recording anything (title, game over, replay). */
    abandon() {
      const wasActive = run !== null;
      clear();
      return wasActive;
    },

    /** @returns {{active: boolean, level: number, runMs: number, levelMs: number, running: boolean}|null} */
    snapshot() {
      if (!run) return null;
      return {
        active: true,
        level: run.level,
        runMs: run.runMs,
        levelMs: run.levelMs,
        running: run.running,
      };
    },
  };
}

/**
 * The device's speedrun records: per-level bests and the best finished run.
 * Reads and writes are forgiving — a corrupt or blocked store resets to empty
 * rather than throwing at the player.
 *
 * @param {object} [options]
 * @param {object|null} [options.storage] - localStorage-compatible store.
 * @param {() => number} [options.now] - clock for the record's timestamp.
 * @returns {object} records
 */
export function createSpeedrunRecords({ storage, now = () => Date.now() } = {}) {
  const store = storage === undefined ? defaultStorage() : storage;
  const stored = readStored(store) ?? {};
  const state = {
    enabled: stored.enabled === true,
    levels: normaliseLevels(stored.levels),
    bestRun: stored.bestRun && isTime(stored.bestRun.totalMs)
      ? { totalMs: stored.bestRun.totalMs, at: typeof stored.bestRun.at === 'string' ? stored.bestRun.at : null }
      : null,
  };

  function save() {
    try {
      store?.setItem?.(SPEEDRUN_STORAGE_KEY, JSON.stringify({
        version: 1,
        enabled: state.enabled,
        levels: state.levels,
        bestRun: state.bestRun,
      }));
    } catch {
      // A full or blocked store keeps the session's records in memory only.
    }
  }

  return {
    get enabled() {
      return state.enabled;
    },

    setEnabled(enabled) {
      state.enabled = enabled === true;
      save();
      return state.enabled;
    },

    /** @returns {number|null} best time for a level in ms, or null. */
    bestForLevel(level) {
      const best = state.levels[level];
      return isTime(best) ? best : null;
    },

    /** @returns {{totalMs: number, at: string|null}|null} */
    get bestRun() {
      return state.bestRun ? { ...state.bestRun } : null;
    },

    /** @returns {Array<{level: number, ms: number}>} every recorded level, in order. */
    levelBests() {
      return Object.entries(state.levels)
        .map(([level, ms]) => ({ level: Number(level), ms }))
        .sort((a, b) => a.level - b.level);
    },

    /**
     * @returns {boolean} whether this beat the stored best for that level.
     */
    recordLevel(level, ms) {
      if (!Number.isInteger(level) || level < FIRST_RUN_LEVEL || level > TOTAL_RUN_LEVELS) return false;
      if (!isTime(ms)) return false;
      const current = state.levels[level];
      if (isTime(current) && current <= ms) return false;
      state.levels[level] = ms;
      save();
      return true;
    },

    /**
     * @returns {boolean} whether this beat the best finished run.
     */
    recordRun(totalMs) {
      if (!isTime(totalMs)) return false;
      if (state.bestRun && state.bestRun.totalMs <= totalMs) return false;
      state.bestRun = { totalMs, at: new Date(now()).toISOString() };
      save();
      return true;
    },
  };
}

function pad(value, size) {
  return String(Math.floor(value)).padStart(size, '0');
}

function splitTime(ms) {
  const safe = isTime(ms) ? Math.floor(ms) : 0;
  const hours = Math.floor(safe / 3_600_000);
  const minutes = Math.floor((safe % 3_600_000) / 60_000);
  const seconds = Math.floor((safe % 60_000) / 1000);
  const millis = safe % 1000;
  return { hours, minutes, seconds, millis };
}

/** The run clock: `1:23.4`, or `1:02:03.4` past an hour. Tenths, not millis. */
export function formatRunClock(ms) {
  const { hours, minutes, seconds, millis } = splitTime(ms);
  const tenths = Math.floor(millis / 100);
  return hours > 0
    ? `${hours}:${pad(minutes, 2)}:${pad(seconds, 2)}.${tenths}`
    : `${minutes}:${pad(seconds, 2)}.${tenths}`;
}

/** A record: `1:23.456`, or `1:02:03.456` past an hour. */
export function formatRunTime(ms) {
  const { hours, minutes, seconds, millis } = splitTime(ms);
  return hours > 0
    ? `${hours}:${pad(minutes, 2)}:${pad(seconds, 2)}.${pad(millis, 3)}`
    : `${minutes}:${pad(seconds, 2)}.${pad(millis, 3)}`;
}
