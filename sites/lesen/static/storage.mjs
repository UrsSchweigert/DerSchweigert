/**
 * Injectable key-value store wrapper for persisting card statistics.
 *
 * The store is injected (e.g. `window.localStorage` on web) so these functions
 * stay pure and easy to unit test with a fake store. Each card's stats are
 * keyed by card text and include correct and incorrect attempt counts.
 */

const CARD_STATS_KEY = "buchstabenzeit:card-stats";
const LANGUAGE_KEY = "buchstabenzeit:language";

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

/**
 * Read the stored language from an injectable store.
 * Valid languages are 'de' and 'en'. Invalid or missing values default to 'de'.
 * @param {{getItem: (key: string) => string|null, setItem: (key: string, value: string) => void}|null|undefined} store
 * @returns {string} The stored language ('de' or 'en'), or 'de' if none stored or invalid
 */
export function readLanguage(store) {
  if (!store || typeof store.getItem !== "function") {
    return "de";
  }
  try {
    const value = store.getItem(LANGUAGE_KEY);
    if (value === "en" || value === "de") {
      return value;
    }
    return "de";
  } catch {
    return "de";
  }
}

/**
 * Write the language to an injectable store.
 * @param {{getItem: (key: string) => string|null, setItem: (key: string, value: string) => void}|null|undefined} store
 * @param {string} lang - The language to store ('de' or 'en')
 */
export function writeLanguage(store, lang) {
  if (!store || typeof store.setItem !== "function") {
    return;
  }
  try {
    store.setItem(LANGUAGE_KEY, lang);
  } catch {
    // Ignore storage failures
  }
}

/**
 * Get the TTS language code for the given language.
 * Returns 'en-US' for English and 'de-DE' for German.
 * @param {string} lang - The language code ('de' or 'en')
 * @returns {string} The TTS language code
 */
export function getTtsLanguageCode(lang) {
  return lang === 'en' ? 'en-US' : 'de-DE';
}
