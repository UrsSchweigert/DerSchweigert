// The "Genius Campaign" title button appears for a player once they have beaten level 40 of
// the main campaign for the first time, and then stays. The reveal is remembered per player on
// the device; it is also derived from what the profile already shows (the app's cleared list,
// the web profile's scores), so a player who got there before this feature existed, or on
// another device, sees the button too. Storage failures read as "not revealed yet".
export const GENIUS_REVEAL_LEVEL = 40;
export const GENIUS_KEY_PREFIX = 'arithmoslayer:genius:';

/** True when the progress shows level 40 beaten: cleared, or play has gone beyond it. */
export function geniusEarned({ cleared = [], reachedLevels = [] } = {}) {
  return cleared.includes(GENIUS_REVEAL_LEVEL) || reachedLevels.some(level => level > GENIUS_REVEAL_LEVEL);
}

export function createGeniusReveal({ storage = globalThis.localStorage, playerId = 'default' } = {}) {
  const key = `${GENIUS_KEY_PREFIX}${playerId}`;
  const read = () => { try { return storage.getItem(key) === '1'; } catch { return false; } };
  return {
    isRevealed: read,
    /** Remember the reveal; returns true when this call is the first time. */
    reveal() {
      if (read()) return false;
      try { storage.setItem(key, '1'); } catch { /* the reveal then lasts only while the progress shows it */ }
      return true;
    },
  };
}
