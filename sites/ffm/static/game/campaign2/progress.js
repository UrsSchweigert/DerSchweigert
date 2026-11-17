// Campaign 2 progress: which levels the player has cleared. Stored on the device only (a
// browser's localStorage on the web, the app's WebView storage in the apps), one record
// per player. The web has no server record of Campaign 2 yet, so progress does not follow
// an account to another device. Storage failures never break play: they read as "nothing
// cleared" and a write that fails is dropped.
import { TOTAL_LEVELS_2 } from './campaign2-levels.js';

export const PROGRESS_KEY_PREFIX = 'arithmoslayer:campaign2:';

const clean = list => [...new Set((Array.isArray(list) ? list : [])
  .filter(l => Number.isInteger(l) && l >= 1 && l <= TOTAL_LEVELS_2))].sort((a, b) => a - b);

export function createCampaign2Progress({ storage = globalThis.localStorage, playerId = 'default' } = {}) {
  const key = `${PROGRESS_KEY_PREFIX}${playerId}`;
  const read = () => {
    try {
      const parsed = JSON.parse(storage.getItem(key));
      return parsed?.version === 1 ? clean(parsed.cleared) : [];
    } catch { return []; }
  };
  return {
    cleared: read,
    /** The first level not cleared yet, or null when all 40 are. */
    next() {
      const done = read();
      for (let level = 1; level <= TOTAL_LEVELS_2; level++) if (!done.includes(level)) return level;
      return null;
    },
    markCleared(level) {
      if (!Number.isInteger(level) || level < 1 || level > TOTAL_LEVELS_2) throw new RangeError('Invalid Campaign 2 level');
      const cleared = clean([...read(), level]);
      try { storage.setItem(key, JSON.stringify({ version: 1, cleared })); } catch { /* storage full or blocked */ }
      return cleared;
    },
  };
}
