/**
 * Platform entitlement adapter for Buchstabenzeit.
 * Provides a unified interface for checking free-tier letter selection caps.
 * Web: always unlocked (no caps).
 * Native: enforces caps when not purchased.
 */

/**
 * Default limits for free-tier users.
 * @type {{consonants: number, vowels: number, specials: number}}
 */
const FREE_TIER_LIMITS = Object.freeze({
  consonants: 5,
  vowels: 5,
  specials: 1,
});

/**
 * Trim a selection array to a specific cap, keeping original relative order.
 * Never deletes down to zero: if cap is 0, all items are kept.
 * Never throws.
 *
 * @param {Array<string>} selectedArray - Array of selected items in order
 * @param {number} cap - Maximum number of items allowed (0 = unlimited)
 * @returns {Array<string>} Trimmed array, up to cap items
 */
export function trimSelectionToCap(selectedArray, cap) {
  try {
    if (cap <= 0) {
      return selectedArray;
    }
    return selectedArray.slice(0, cap);
  } catch (e) {
    // Never throw; return input as-is
    return selectedArray;
  }
}

/**
 * Get category-specific caps from limits object.
 * Used to extract caps for consonants, vowels, or specials category.
 *
 * @param {Object|null} limits - Limits object {consonants, vowels, specials} or null if unlocked
 * @param {string} category - 'consonants', 'vowels', or 'specials'
 * @returns {number} Cap value (0 = unlimited)
 */
export function getCapsForLimits(limits, category) {
  if (!limits) {
    return 0; // Unlocked: no cap
  }
  const cap = limits[category];
  return cap !== undefined ? cap : 0;
}

/**
 * Check if a selection can accept one more item without exceeding cap.
 * Synchronous predicate used both for async pre-check and post-await re-check.
 *
 * @param {Set<string>} currentSelection - Current selection Set
 * @param {number} cap - Maximum items allowed (0 = unlimited)
 * @returns {boolean} true if under cap (can add), false if at or over cap
 */
export function canAddToSelection(currentSelection, cap) {
  if (cap <= 0) {
    return true; // Unlocked: can always add
  }
  return currentSelection.size < cap;
}

/**
 * Sync check: can a letter be added to the current selection given a category cap?
 * Used for post-await re-check in click handlers to prevent race conditions.
 *
 * @param {Set<string>} currentSelection - Current selection Set
 * @param {string} category - 'consonants', 'vowels', or 'specials'
 * @param {Object|null} limits - Limits object {consonants, vowels, specials} or null if unlocked
 * @returns {boolean} true if letter can be added without exceeding cap
 */
export function canAddLetterSync(currentSelection, category, limits) {
  const cap = getCapsForLimits(limits, category);
  return canAddToSelection(currentSelection, cap);
}

/**
 * Try to add a letter to the selection, with fresh entitlement check.
 * Fetches limits async, then synchronously checks cap and mutates selection.
 * Prevents race conditions by doing cap check + mutation in one atomic sequence.
 *
 * @param {Object} adapter - Entitlement adapter with getLimits() method
 * @param {string} category - 'consonants', 'vowels', or 'specials'
 * @param {Set<string>} selected - Current selection Set (will be mutated if successful)
 * @param {string} letter - Letter to add
 * @returns {Promise<boolean>} true if letter was added, false if cap prevented it
 */
export async function tryAddLetter(adapter, category, selected, letter) {
  try {
    // Fetch fresh limits
    const limits = await adapter.getLimits();
    
    // Get cap for this category
    const cap = getCapsForLimits(limits, category);
    
    // Synchronously check and add (atomic with respect to this letter)
    if (canAddToSelection(selected, cap)) {
      selected.add(letter);
      return true;
    }
    
    return false;
  } catch (e) {
    // On error, fail safe and return false
    return false;
  }
}

/**
 * Create a web-based entitlement adapter (always unlocked).
 *
 * @returns {Object} Adapter with isUnlocked, getLimits, canToggleLetter, trimBulkLoad, purchase, restore
 */
export function createWebEntitlementAdapter() {
  return {
    kind: 'web',

    isUnlocked() {
      return true;
    },

    getLimits() {
      return null; // null = unlocked, no limits
    },

    canToggleLetter(category, currentSelection, newLetter) {
      // Web always allows any toggle
      return true;
    },

    trimBulkLoad(category, selectedArray) {
      // Web never trims; return as-is
      return selectedArray;
    },

    async purchase() {
      // No-op on web
    },

    async restore() {
      // No-op on web
    }
  };
}

/**
 * Create a native (Capacitor) entitlement adapter.
 * Enforces free-tier caps if not purchased.
 *
 * @param {Object} plugin - The Entitlement plugin from Capacitor.
 * @returns {Object} Adapter with isUnlocked, getLimits, canToggleLetter, trimBulkLoad, purchase, restore
 */
export function createNativeEntitlementAdapter(plugin) {
  let unlockedCache = null;

  return {
    kind: 'native',

    async isUnlocked() {
      try {
        if (unlockedCache === null) {
          const result = await plugin.isUnlocked();
          unlockedCache = result && result.unlocked === true;
        }
        return unlockedCache;
      } catch (e) {
        // On error, assume locked to be safe
        return false;
      }
    },

    async getLimits() {
      try {
        const unlocked = await this.isUnlocked();
        return unlocked ? null : FREE_TIER_LIMITS;
      } catch (e) {
        // On error, assume free tier (return limits)
        return FREE_TIER_LIMITS;
      }
    },

    async canToggleLetter(category, currentSelection, newLetter) {
      try {
        const limits = await this.getLimits();
        if (!limits) {
          return true; // Unlocked
        }

        // If letter already selected, toggle-off always allowed
        if (currentSelection.has(newLetter)) {
          return true;
        }

        // If trying to add, check cap
        const cap = getCapsForLimits(limits, category);
        return canAddToSelection(currentSelection, cap);
      } catch (e) {
        return false; // On error, deny toggle to be safe
      }
    },

    async trimBulkLoad(category, selectedArray) {
      try {
        const limits = await this.getLimits();
        if (!limits) {
          return selectedArray; // Unlocked, no trim
        }
        const cap = getCapsForLimits(limits, category);
        return trimSelectionToCap(selectedArray, cap);
      } catch (e) {
        // On error, return as-is (don't crash)
        return selectedArray;
      }
    },

    async purchase() {
      try {
        await plugin.purchase();
        unlockedCache = true; // Optimistically cache
      } catch (e) {
        // Ignore errors
      }
    },

    async restore() {
      try {
        await plugin.restore();
        unlockedCache = null; // Invalidate cache to re-check
      } catch (e) {
        // Ignore errors
      }
    }
  };
}

/**
 * Factory for the appropriate entitlement adapter.
 * Detects native entitlement and returns native adapter if available,
 * otherwise returns web adapter.
 *
 * @param {Window} [win=window] - Window object (for testing)
 * @returns {Object} Entitlement adapter
 */
export function createEntitlementAdapter(win = window) {
  const plugin = win.Capacitor?.Plugins?.Entitlement;
  if (plugin) {
    return createNativeEntitlementAdapter(plugin);
  }
  return createWebEntitlementAdapter();
}
