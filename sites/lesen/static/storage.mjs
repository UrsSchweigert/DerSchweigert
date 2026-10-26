/**
 * Injectable key-value store wrapper for persisting card statistics.
 *
 * The store is injected (e.g. `window.localStorage` on web) so these functions
 * stay pure and easy to unit test with a fake store. Each card's stats are
 * keyed by card text and include correct and incorrect attempt counts.
 */

const CARD_STATS_KEY = "buchstabenzeit:card-stats";

/**
 * Create a storage wrapper around an injectable store.
 * @param {{getItem: (key: string) => string|null, setItem: (key: string, value: string) => void}|null|undefined} store
 * @returns {{read: () => object, write: (stats: object) => void}}
 */
export function createStorage(store) {
  return {
    /**
     * Read the card stats map from the store.
     * @returns {object} A map of card text to { correct_count, incorrect_count }
     */
    read() {
      if (!store || typeof store.getItem !== "function") {
        return {};
      }
      try {
        const json = store.getItem(CARD_STATS_KEY);
        if (!json) {
          return {};
        }
        return JSON.parse(json);
      } catch {
        // If JSON parsing fails, return empty stats
        return {};
      }
    },

    /**
     * Write the card stats map to the store.
     * @param {object} stats - A map of card text to { correct_count, incorrect_count }
     */
    write(stats) {
      if (!store || typeof store.setItem !== "function") {
        return;
      }
      try {
        const json = JSON.stringify(stats);
        store.setItem(CARD_STATS_KEY, json);
      } catch {
        // Ignore storage failures
      }
    },
  };
}
