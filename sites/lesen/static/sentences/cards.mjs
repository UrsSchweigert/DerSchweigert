/**
 * Sentence cards for the Karten tab.
 *
 * The committed pools in `sentences/{de,en}.json` are content, not code. This
 * module turns a pool into the cards the current letter selection can read: a
 * sentence is offered only when every sound unit of every word is selected.
 * The classification is delegated to {@link classifySentence} from
 * `coverage.mjs`, so the sentence cards and the readability metric agree by
 * construction.
 *
 * A sentence card is a plain object the existing practice engine understands:
 * `{ text, kind: "sentence", misses: 0 }`. Statistics are keyed by the card
 * text, exactly like word cards, so sentence attempts are counted and stored
 * by the same code path.
 *
 * No DOM or storage access lives here; `node:test` exercises it directly.
 */
import { classifySentence } from "../coverage.mjs";

/**
 * Read the display text of a pool entry or card.
 * @param {string|{text?: string}|null|undefined} entry pool entry or card text
 * @returns {string} the text, or "" when the entry carries none
 */
function textOf(entry) {
  if (typeof entry === "string") return entry;
  if (entry && typeof entry.text === "string") return entry.text;
  return "";
}

/**
 * Whether a pool entry can be read in full with a selection.
 *
 * A sentence with no word at all is never readable.
 *
 * @param {string|{text?: string}} entry sentence text or pool entry
 * @param {{consonants?: Iterable<string>, vowels?: Iterable<string>, specials?: Iterable<string>}} selection
 * @param {string} [lang] language code ('de' or 'en')
 * @returns {boolean} true when every unit of every word is selected
 */
export function isSentenceReadable(entry, selection, lang = "de") {
  const text = textOf(entry);
  return text.trim().length > 0 && classifySentence(text, selection, lang).readable;
}

/**
 * The pool entries the current selection reads in full, in pool order.
 * @param {Array<string|{text?: string}>} pool sentence pool
 * @param {{consonants?: Iterable<string>, vowels?: Iterable<string>, specials?: Iterable<string>}} selection
 * @param {string} [lang] language code ('de' or 'en')
 * @returns {Array<string|{text?: string}>} readable entries
 */
export function readableSentenceCards(pool, selection, lang = "de") {
  if (!Array.isArray(pool)) return [];
  return pool.filter((entry) => isSentenceReadable(entry, selection, lang));
}

/**
 * The texts of the pool entries the current selection reads in full.
 * @param {Array<string|{text?: string}>} pool sentence pool
 * @param {{consonants?: Iterable<string>, vowels?: Iterable<string>, specials?: Iterable<string>}} selection
 * @param {string} [lang] language code ('de' or 'en')
 * @returns {string[]} readable sentence texts, in pool order
 */
export function readableSentenceTexts(pool, selection, lang = "de") {
  return readableSentenceCards(pool, selection, lang).map(textOf);
}

/**
 * Shuffle a copy of the given items with an injectable random source.
 * @param {any[]} items items to shuffle
 * @param {() => number} random random source in [0, 1)
 * @returns {any[]} a shuffled copy
 */
function shuffled(items, random) {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index--) {
    const other = Math.floor(random() * (index + 1));
    [result[index], result[other]] = [result[other], result[index]];
  }
  return result;
}

/**
 * Build a practice deck from explicitly chosen sentence cards.
 *
 * Only cards that the current selection can read are kept, so a card added
 * under an earlier letter selection can never reach the practice screen after
 * its units were removed. Unknown texts and duplicates are dropped.
 *
 * @param {Array<string|{text?: string}>} pool sentence pool of the active language
 * @param {{consonants?: Iterable<string>, vowels?: Iterable<string>, specials?: Iterable<string>}} selection
 * @param {string} lang language code ('de' or 'en')
 * @param {Iterable<string>} texts chosen sentence texts
 * @param {() => number} [random] random source in [0, 1); injectable for tests
 * @returns {Array<{text: string, kind: "sentence", misses: number}>} shuffled cards
 */
export function buildSentenceDeck(pool, selection, lang, texts, random = Math.random) {
  const chosen = new Set(texts || []);
  const cards = [];
  const seen = new Set();
  for (const entry of readableSentenceCards(pool, selection, lang)) {
    const text = textOf(entry);
    if (!chosen.has(text) || seen.has(text)) continue;
    seen.add(text);
    cards.push({ text, kind: "sentence", misses: 0 });
  }
  return shuffled(cards, random);
}

/**
 * In-memory selection of sentence cards for the next round.
 *
 * The Karten tab adds a card when the adult taps it and removes it on the next
 * tap; the count it shows is `count()`. Keeping this state in a small factory
 * makes the add/remove/count behaviour testable without a DOM.
 *
 * @returns {{
 *   add: (text: string) => boolean,
 *   remove: (text: string) => boolean,
 *   toggle: (text: string) => boolean,
 *   has: (text: string) => boolean,
 *   count: () => number,
 *   texts: () => string[],
 *   clear: () => void,
 *   retain: (readableTexts: Iterable<string>) => string[],
 * }} sentence selection
 */
export function createSentenceSelection() {
  const chosen = new Set();

  return {
    /** Add a text; true when it was not selected before. */
    add(text) {
      if (typeof text !== "string" || !text) return false;
      const wasChosen = chosen.has(text);
      chosen.add(text);
      return !wasChosen;
    },

    /** Remove a text; true when it was selected before. */
    remove(text) {
      return chosen.delete(text);
    },

    /** Add when absent, remove when present; returns the new selected state. */
    toggle(text) {
      if (typeof text !== "string" || !text) return false;
      if (chosen.has(text)) {
        chosen.delete(text);
        return false;
      }
      chosen.add(text);
      return true;
    },

    /** Whether a text is selected. */
    has(text) {
      return chosen.has(text);
    },

    /** Number of selected cards. */
    count() {
      return chosen.size;
    },

    /** Selected texts in insertion order. */
    texts() {
      return [...chosen];
    },

    /** Drop every selected card. */
    clear() {
      chosen.clear();
    },

    /**
     * Drop selected cards that the current selection no longer reads.
     * @param {Iterable<string>} readableTexts texts that are still readable
     * @returns {string[]} the texts that were dropped
     */
    retain(readableTexts) {
      const readable = new Set(readableTexts || []);
      const dropped = [];
      for (const text of [...chosen]) {
        if (readable.has(text)) continue;
        chosen.delete(text);
        dropped.push(text);
      }
      return dropped;
    },
  };
}
