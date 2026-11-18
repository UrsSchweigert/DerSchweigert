// Which campaign a player has chosen (1: the 60-level campaign, 2: the Genius
// Campaign), remembered per player on the device like the Campaign 2 progress
// (./progress.js). A family shares one device, so the choice belongs to the
// player: switching to a sibling must not drop them into fractions. Storage
// failures read as Campaign 1, the campaign every player can always play.
export const SELECTION_KEY_PREFIX = 'arithmoslayer:campaign:';

export function createCampaignSelection({ storage = globalThis.localStorage, playerId = 'default' } = {}) {
  const key = `${SELECTION_KEY_PREFIX}${playerId}`;
  return {
    /** The chosen campaign: 2 only when it was stored as such, otherwise 1. */
    get() {
      try { return storage.getItem(key) === '2' ? 2 : 1; } catch { return 1; }
    },
    /** Remember the choice; Campaign 1 is the default, so it clears the record. */
    set(campaign) {
      try {
        if (campaign === 2) storage.setItem(key, '2');
        else storage.removeItem(key);
      } catch { /* the choice then lasts only for this session */ }
    },
  };
}
