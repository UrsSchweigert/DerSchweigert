/**
 * Injectable key-value store wrapper for persisting card statistics.
 *
 * The store is injected (e.g. `window.localStorage` on web) so these functions
 * stay pure and easy to unit test with a fake store. Each card's stats are
 * keyed by card text and include correct and incorrect attempt counts.
 *
 * Sentence cards use the same key and the same counter shape as word cards,
 * so an attempt on either kind is stored and re-read identically. The
 * persisted document is the flat map described above. A versioned document
 * (`{ version: 2, cards: { … } }`) is also understood on read, so a store
 * written by a newer schema is not lost; an unknown version reads as empty
 * instead of throwing.
 */

const CARD_STATS_KEY = "buchstabenzeit:card-stats";
const LANGUAGE_KEY = "buchstabenzeit:language";
const SELECTION_KEY = "buchstabenzeit:selection:";

/** The only statistics schema version this module understands. */
const CARD_STATS_VERSION = 2;

/**
 * Whether a parsed JSON value is a plain object (not an array or null).
 * @param {unknown} value parsed JSON value
 * @returns {boolean} true for `{}`-style objects
 */
function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * Turn a parsed statistics document into the flat counter map callers expect.
 *
 * Unversioned documents are the legacy flat map and are returned as they are,
 * so existing word-card statistics keep every counter. Versioned documents
 * carry their map under `cards`; a version this module does not know is
 * treated as empty rather than crashing.
 *
 * @param {unknown} parsed parsed JSON document
 * @returns {object} a map of card text to { correct_count, incorrect_count }
 */
function toStatsMap(parsed) {
  if (!isPlainObject(parsed)) {
    return {};
  }
  if (typeof parsed.version === "number") {
    if (parsed.version !== CARD_STATS_VERSION) {
      return {};
    }
    return isPlainObject(parsed.cards) ? parsed.cards : {};
  }
  // A legacy flat map may legitimately have a card called "version"; only a
  // numeric version field marks a versioned document.
  return parsed;
}

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
        return toStatsMap(JSON.parse(json));
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

/**
 * Get the word-list JSON filename for the given language.
 * Returns 'words-en.json' for English and 'words-de.json' for German.
 * @param {string} lang - The language code ('de' or 'en')
 * @returns {string} The word-list filename to fetch
 */
export function getWordListFilename(lang) {
  return lang === 'en' ? 'words-en.json' : 'words-de.json';
}

/**
 * Read the saved letter selection of one language.
 * Entries that are not strings are dropped; a missing or corrupt record
 * yields null so callers can fall back to their defaults.
 * @param {{getItem: (key: string) => string|null}|null|undefined} store
 * @param {string} lang - The language code ('de' or 'en')
 * @returns {{consonants: string[], vowels: string[], specials: string[]}|null} saved selection or null
 */
export function readSelection(store, lang) {
  if (!store || typeof store.getItem !== "function") {
    return null;
  }
  try {
    const json = store.getItem(SELECTION_KEY + lang);
    if (!json) {
      return null;
    }
    const parsed = JSON.parse(json);
    if (!isPlainObject(parsed)) {
      return null;
    }
    const clean = (list) => (Array.isArray(list) ? list.filter((unit) => typeof unit === "string") : []);
    return {
      consonants: clean(parsed.consonants),
      vowels: clean(parsed.vowels),
      specials: clean(parsed.specials),
    };
  } catch {
    return null;
  }
}

/**
 * Save the letter selection of one language.
 * @param {{setItem: (key: string, value: string) => void}|null|undefined} store
 * @param {string} lang - The language code ('de' or 'en')
 * @param {{consonants: Iterable<string>, vowels: Iterable<string>, specials: Iterable<string>}} selection
 */
export function writeSelection(store, lang, selection) {
  if (!store || typeof store.setItem !== "function") {
    return;
  }
  try {
    store.setItem(
      SELECTION_KEY + lang,
      JSON.stringify({
        consonants: [...selection.consonants],
        vowels: [...selection.vowels],
        specials: [...selection.specials],
      }),
    );
  } catch {
    // Ignore storage failures
  }
}
