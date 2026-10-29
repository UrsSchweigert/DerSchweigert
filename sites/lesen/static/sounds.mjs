/**
 * Pure sound/letter model for the reading practice setup screen.
 *
 * This module has no DOM/browser dependencies so it can be unit tested with
 * `node:test` and reused across sites (web + Android) and future locales.
 */

/** German consonant alphabet shown as individually selectable letters. */
const CONSONANTS_DE = Object.freeze([..."bcdfghjklmnpqrstvwxyzß"]);

/** German vowel alphabet shown as individually selectable letters. */
const VOWELS_DE = Object.freeze([..."aeiou"]);

/**
 * German "special" sounds: umlauts, common diphthongs, consonant digraphs, and
 * a sentinel for doubled letters. These are not plain single letters, but they
 * behave like extra vowel or consonant-slot fillers when building letter combinations.
 *
 * Order note: 'sch' must come before 'ch' in the list so that when tokenizeWord
 * iterates left-to-right, it tries 'sch' first. This ensures that words like
 * "schon" split into ["sch", "o", "n"] rather than ["s", "ch", "o", "n"].
 * The 'xx' sentinel at the end represents "any doubled letter" and is handled
 * specially by tokenizeWord and countMatchingWords to match two identical
 * adjacent characters as a single sound unit.
 */
const SPECIALS_DE = Object.freeze(["ä", "ö", "ü", "au", "ei", "ie", "eu", "sch", "ch", "st", "ai", "xx"]);

/** English consonant alphabet shown as individually selectable letters. */
const CONSONANTS_EN = Object.freeze([..."bcdfghjklmnpqrstvwxyz"]);

/** English vowel alphabet shown as individually selectable letters. */
const VOWELS_EN = Object.freeze([..."aeiou"]);

/**
 * English "special" sounds: common consonant digraphs and vowel digraphs/diphthongs.
 * These behave like extra vowel-slot fillers when building CV/VC-style letter combinations.
 */
const SPECIALS_EN = Object.freeze(["sh", "ch", "th", "oo", "ee", "ai", "ou"]);

/**
 * Get language-specific consonants, vowels, and specials.
 * @param {string} lang language code ('de' or 'en')
 * @returns {{consonants: readonly string[], vowels: readonly string[], specials: readonly string[]}}
 */
export function getSoundsForLanguage(lang) {
  if (lang === 'en') {
    return { consonants: CONSONANTS_EN, vowels: VOWELS_EN, specials: SPECIALS_EN };
  }
  return { consonants: CONSONANTS_DE, vowels: VOWELS_DE, specials: SPECIALS_DE };
}

// Export defaults for German (backward compatibility)
export const CONSONANTS = CONSONANTS_DE;
export const VOWELS = VOWELS_DE;
export const SPECIALS = SPECIALS_DE;

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
 * Sub-patterns offered on the setup screen, mapped to the letter-slot
 * sequence understood by {@link buildCombinations}.
 */
const SUB_PATTERN_CODES = Object.freeze({
  ma: "CV",
  am: "VC",
  mam: "CVC",
  ama: "VCV",
});

/** Fisher–Yates shuffle of a copy of `items`, using the supplied RNG. */
function shuffleItems(items, random) {
  const shuffled = [...items];
  for (let index = shuffled.length - 1; index > 0; index--) {
    const other = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[other]] = [shuffled[other], shuffled[index]];
  }
  return shuffled;
}

/**
 * Build a practice deck from any checked subset of the setup sub-patterns
 * "ma" (CV), "am" (VC), "mam" (CVC) and "ama" (VCV).
 *
 * Every sub-pattern contributes its {@link buildCombinations} pool. The pools
 * are de-duplicated by card text (also across sub-patterns), shuffled, then
 * dealt round-robin so the sub-patterns are interleaved rather than
 * concatenated. Once every pool is exhausted the pools are reshuffled and
 * dealt again, so a short pool is repeated until `count` cards exist. The
 * deck is cut to exactly `count` cards.
 *
 * Capitalisation is a presentation concern and is not applied here; cards are
 * returned exactly as built by {@link buildCombinations}.
 *
 * @param {Iterable<string>} patterns checked sub-patterns, e.g. ["ma", "am"]
 * @param {readonly string[]} [consonantLetters] letters usable in 'C' slots
 * @param {readonly string[]} [vowelLetters] letters (and/or specials) usable
 *   in 'V' slots
 * @param {number} count requested number of cards; 0 or less yields []
 * @param {() => number} [rng] random source in [0, 1); injectable for tests
 * @returns {string[]} de-duplicated, interleaved, shuffled deck of `count`
 *   cards (empty when no patterns or no positive count is given)
 */
export function buildPatternDeck(patterns, consonantLetters = CONSONANTS, vowelLetters = VOWELS, count = 0, rng = Math.random) {
  const total = Math.floor(Number(count));
  if (!patterns || !Number.isFinite(total) || total <= 0) return [];

  const patternList = typeof patterns === "string" ? [patterns] : patterns;
  const seen = new Set();
  const pools = [];
  for (const pattern of patternList) {
    const code = SUB_PATTERN_CODES[pattern];
    if (!code) throw new Error(`Unknown sub-pattern: ${pattern}`);
    const cards = [];
    for (const text of buildCombinations(code, consonantLetters, vowelLetters)) {
      if (seen.has(text)) continue;
      seen.add(text);
      cards.push(text);
    }
    if (cards.length) pools.push({ cards: shuffleItems(cards, rng), cursor: 0 });
  }
  if (!pools.length) return [];

  const deck = [];
  while (deck.length < total) {
    let dealt = false;
    for (const pool of pools) {
      if (deck.length >= total) break;
      if (pool.cursor >= pool.cards.length) continue;
      deck.push(pool.cards[pool.cursor++]);
      dealt = true;
    }
    if (!dealt) {
      for (const pool of pools) {
        pool.cards = shuffleItems(pool.cards, rng);
        pool.cursor = 0;
      }
    }
  }
  return deck;
}

/**
 * Tokenize a lowercase word left to right into sound units.
 * At each position, a special from the specials list is taken first if the
 * word continues with it, otherwise one character is taken.
 *
 * When the specials list contains the 'xx' sentinel, two identical adjacent
 * letters are treated as a single unit (e.g., 'll' -> 'll'), in addition to
 * matching literal specials.
 *
 * @param {string} word lowercase word to tokenize
 * @param {readonly string[]} specials special multi-character sounds to recognize
 * @returns {string[]} array of sound units
 */
export function tokenizeWord(word, specials) {
  const units = [];
  let pos = 0;
  const hasXxSentinel = specials.includes('xx');
  
  while (pos < word.length) {
    let matched = false;
    
    // Check if we have a doubled letter at the current position (only if 'xx' is in specials)
    if (hasXxSentinel && pos + 1 < word.length && word[pos] === word[pos + 1]) {
      units.push(word[pos] + word[pos + 1]);
      pos += 2;
      matched = true;
    }
    
    // Try to match specials (but skip 'xx' sentinel itself)
    if (!matched) {
      for (const special of specials) {
        if (special === 'xx') continue; // Skip the sentinel itself
        if (word.startsWith(special, pos)) {
          units.push(special);
          pos += special.length;
          matched = true;
          break;
        }
      }
    }
    
    if (!matched) {
      // No special matched, take one character
      units.push(word[pos]);
      pos++;
    }
  }
  return units;
}

/**
 * Count distinct real words (case-insensitively, by spelling) that are
 * usable with a given letter selection: every sound unit in the word must be
 * an allowed letter or special, and the word's length must be within `maxLength`.
 *
 * When the selection includes the 'xx' sentinel, a tokenized doubled-letter
 * unit (e.g., 'll') is considered allowed even if 'xx' itself is not literally
 * in the allowedUnits set.
 *
 * This mirrors the eligibility check used to build Words Mode decks, so it
 * can drive a live "X words available" counter on the setup screen.
 *
 * @param {readonly string[]} words candidate word list (any casing)
 * @param {{consonants: readonly string[], vowels: readonly string[], specials?: readonly string[]}} selection
 *   currently selected single-character consonants and vowels, and optional multi-character specials
 * @param {number} maxLength maximum word length (inclusive)
 * @param {readonly string[]} allSpecials all available specials for tokenization (optional; uses selection.specials if omitted)
 * @returns {number} count of distinct eligible words
 */
export function countMatchingWords(words, selection, maxLength, allSpecials) {
  const specials = selection.specials || [];
  const tokenizerSpecials = allSpecials || specials;
  const allowedUnits = new Set([...selection.consonants, ...selection.vowels, ...specials]);
  const hasXxSentinel = specials.includes('xx');
  const seen = new Set();
  let count = 0;
  for (const word of words) {
    const key = word.toLowerCase();
    if (seen.has(key)) continue;
    const units = tokenizeWord(key, tokenizerSpecials);
    let eligible = units.length > 0 && key.length <= maxLength;
    if (eligible) {
      for (const unit of units) {
        // Accept the unit if it's in allowedUnits, or if it's a doubled letter and 'xx' is selected
        const isDoubledLetter = unit.length === 2 && unit[0] === unit[1];
        if (!allowedUnits.has(unit) && !(isDoubledLetter && hasXxSentinel)) {
          eligible = false;
          break;
        }
      }
    }
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
