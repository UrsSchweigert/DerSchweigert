/**
 * Pure sound/letter model for the reading practice setup screen.
 *
 * This module has no DOM/browser dependencies so it can be unit tested with
 * `node:test` and reused across sites (web + Android) and future locales.
 */

/** German consonant alphabet shown as individually selectable letters. */
export const CONSONANTS = Object.freeze([..."bcdfghjklmnpqrstvwxyzß"]);

/** German vowel alphabet shown as individually selectable letters. */
export const VOWELS = Object.freeze([..."aeiou"]);

/**
 * German "special" sounds: umlauts and the common diphthongs. These are not
 * plain single letters (diphthongs are two characters), but they behave like
 * extra vowel-slot fillers when building CV/VC-style letter combinations.
 */
export const SPECIALS = Object.freeze(["ä", "ö", "ü", "au", "ei", "ie", "eu"]);

/** Number of distinct eligible words required to unlock Words Mode. */
export const WORDS_MODE_THRESHOLD = 10;

/**
 * Build every letter-combination for a pattern (e.g. "CV", "VC", "CVC") out
 * of the given consonant and vowel-slot letters.
 *
 * "Vowel-slot" letters may be plain vowels, or a mix of plain vowels and
 * specials (umlauts/diphthongs) supplied by the caller, e.g.
 * `buildCombinations('CV', consonants, [...vowels, ...specials])`. Because
 * each letter is treated as an opaque string, multi-character specials (like
 * "au") slot in exactly like single-character vowels, without any change to
 * the existing single-letter CV/VC behaviour.
 *
 * @param {string} pattern sequence of 'C' (consonant slot) and 'V' (vowel
 *   slot) characters, e.g. "CV", "VC", "CVC"
 * @param {readonly string[]} consonantLetters letters usable in 'C' slots
 * @param {readonly string[]} vowelLetters letters (and/or specials) usable
 *   in 'V' slots
 * @returns {string[]} every combination, in pattern order, consonant/vowel
 *   letters combined positionally (no deduplication)
 */
export function buildCombinations(pattern, consonantLetters, vowelLetters) {
  let combinations = [""];
  for (const slot of pattern) {
    if (slot !== "C" && slot !== "V") {
      throw new Error(`Unknown pattern slot: ${slot}`);
    }
    const letters = slot === "C" ? consonantLetters : vowelLetters;
    combinations = combinations.flatMap((prefix) => letters.map((letter) => prefix + letter));
  }
  return combinations;
}

/**
 * Count distinct real words (case-insensitively, by spelling) that are
 * usable with a given letter selection: every character in the word must be
 * an allowed letter, and the word's length must be within `maxLength`.
 *
 * This mirrors the eligibility check used to build Words Mode decks, so it
 * can drive a live "X words available" counter on the setup screen.
 *
 * @param {readonly string[]} words candidate word list (any casing)
 * @param {{consonants: readonly string[], vowels: readonly string[]}} selection
 *   currently selected single-character consonants and vowels (specials are
 *   not part of real-word matching: real words are spelled with plain
 *   letters, not diphthong "slots")
 * @param {number} maxLength maximum word length (inclusive)
 * @returns {number} count of distinct eligible words
 */
export function countMatchingWords(words, selection, maxLength) {
  const allowedLetters = new Set([...selection.consonants, ...selection.vowels]);
  const seen = new Set();
  let count = 0;
  for (const word of words) {
    const key = word.toLowerCase();
    if (seen.has(key)) continue;
    const letters = [...key];
    const eligible =
      letters.length > 0 && letters.length <= maxLength && letters.every((letter) => allowedLetters.has(letter));
    if (eligible) {
      seen.add(key);
      count++;
    }
  }
  return count;
}

/**
 * Decide whether a count of matching words is enough to offer Words Mode.
 * @param {number} count result of {@link countMatchingWords}
 * @returns {boolean} true once count reaches {@link WORDS_MODE_THRESHOLD}
 */
export function isWordsModeEligible(count) {
  return count >= WORDS_MODE_THRESHOLD;
}
