/**
 * Coverage metric for the reading-book picker.
 *
 * A book is a list of sentences. Every sentence is a sequence of words, and
 * every word is a sequence of *sound units* (the same units `sounds.mjs`
 * tokenizes into). A child's current sound selection makes a word "readable"
 * when every one of its units has been selected; otherwise the word needs an
 * adult to read it aloud. The coverage of a book is then two fractions:
 *
 *   - tokens: the share of word *occurrences* that are readable;
 *   - types:  the share of *distinct* words that are readable.
 *
 * This module is pure: it never touches the DOM, storage or the network, so
 * the build (tools/build_books.mjs) and the picker (reader.mjs, wired in P5)
 * can both import it and the unit tests can run it with `node:test`.
 *
 * ## Selection
 *
 * A selection is the sounds the child has picked, keyed by language so that
 * tokenization knows which greedy multi-letter specials (and the `xx`
 * doubled-letter rule) apply:
 *
 *     { language: 'de' | 'en', consonants: string[], vowels: string[], specials: string[] }
 *
 * ## Compact per-language coverage table
 *
 * The build writes, and the picker reads, a compact table with three parts:
 *
 *   - `units`: the ordered unit index list for the book's language (index i
 *     is unit i, and bit i of every mask refers to this unit);
 *   - `words`: one row per distinct word — `{ w, n, m }` where `w` is the
 *     lowercase word, `n` its token count and `m` its unit mask;
 *   - `sentences`: one unit mask per sentence (the OR of its words' masks).
 *
 * In memory every mask is a BigInt bitmask; `serializeTable` and `parseTable`
 * convert those to and from the JSON form, where masks are decimal strings.
 */

import { getSoundsForLanguage, tokenizeWord } from "./sounds.mjs";

/** Split a text into lowercase word tokens (runs of Unicode letters). */
const WORD_RE = /[\p{L}]+/gu;

/**
 * Bit reserved for units outside the selectable alphabet — for example an
 * accented letter (`ê`, `é`) that `sounds.mjs` still tokenizes into a single
 * unit but that is not in the language's unit list. Such a unit can never be
 * selected, so a word (or sentence) whose mask has this bit is never readable,
 * no matter which selection is applied. The bit sits far above every real unit
 * index (German has 39 units, English 33) so it never collides with a
 * selection mask; the picker needs no special knowledge because readability is
 * simply "mask has no bit outside the selection mask".
 */
const FOREIGN_BIT_INDEX = 62n;
const FOREIGN_MASK = 1n << FOREIGN_BIT_INDEX;

/**
 * Return the lowercase word tokens of a text, in order. Everything that is
 * not a letter is a word boundary; this is the coverage metric's only notion
 * of "a word", and it never re-splits sentence boundaries (those come from
 * the importer, tools/epub.mjs).
 *
 * @param {string} text any text, typically one sentence
 * @returns {string[]} lowercase letter sequences
 */
export function wordsOf(text) {
  const tokens = [];
  for (const match of String(text).toLowerCase().matchAll(WORD_RE)) {
    tokens.push(match[0]);
  }
  return tokens;
}

/**
 * The ordered unit index list for a selection's language: consonants, then
 * vowels, then specials. This is exactly the set of units `sounds.mjs`
 * tokenizes into, including greedy multi-letter specials (e.g. `sch` before
 * `ch`) and the `xx` doubled-letter sentinel, so index i maps 1:1 to bit i of
 * every mask built against this list.
 *
 * @param {{language?: string}} selection a selection carrying the language
 * @returns {string[]} the full, ordered unit list for the language
 */
export function unitsOf(selection) {
  const sounds = getSoundsForLanguage(selection.language);
  return [...sounds.consonants, ...sounds.vowels, ...sounds.specials];
}

/**
 * The units a selection has selected, as a set of unit strings.
 *
 * @param {{consonants: readonly string[], vowels: readonly string[], specials?: readonly string[]}} selection
 * @returns {Set<string>} the selected units
 */
export function selectedUnits(selection) {
  return new Set([...(selection.consonants ?? []), ...(selection.vowels ?? []), ...(selection.specials ?? [])]);
}

/**
 * The bitmask of a single unit against a unit index list: `1n << index`.
 *
 * @param {string} unit the unit to mask
 * @param {readonly string[]} units the unit index list (see {@link unitsOf})
 * @returns {bigint} a mask with only the unit's bit set
 */
export function unitMaskOf(unit, units) {
  const index = units.indexOf(unit);
  if (index < 0) {
    throw new Error(`Unknown unit ${JSON.stringify(unit)} (not in the unit index list)`);
  }
  return 1n << BigInt(index);
}

/**
 * Map a tokenized unit to the unit it selects against. A doubled-letter unit
 * (`ll`, `nn`, …) whose base letter is itself a selectable unit is represented
 * by the `xx` sentinel; everything else is its own unit. Literal doubled-letter
 * specials (English `oo`, `ee`) are in the unit list themselves and are
 * therefore never remapped, and a doubled letter outside the alphabet (e.g.
 * `ëë`) stays itself so it falls through to the foreign bit.
 *
 * @param {string} unit a unit produced by `tokenizeWord`
 * @param {readonly string[]} units the unit index list for the language
 * @returns {string} the unit to check against a selection
 */
function canonicalUnit(unit, units) {
  if (units.includes(unit)) return unit;
  if (unit.length === 2 && unit[0] === unit[1] && units.includes(unit[0]) && units.includes("xx")) return "xx";
  return unit;
}

/**
 * The mask contribution of one tokenized (already canonical) unit: its bit in
 * the unit index list, or the foreign bit when the unit is not selectable.
 *
 * @param {string} unit a canonical unit
 * @param {readonly string[]} units the unit index list
 * @returns {bigint} a single-bit (or foreign-bit) mask
 */
function maskOfUnit(unit, units) {
  const index = units.indexOf(unit);
  if (index >= 0) return 1n << BigInt(index);
  return FOREIGN_MASK;
}

/**
 * The bitmask of all units a selection has selected (the OR of each selected
 * unit's mask). A word or sentence is readable exactly when its mask has no
 * bit outside this mask.
 *
 * @param {object} selection a selection
 * @param {readonly string[]} [units] the unit index list (defaults to {@link unitsOf}(selection))
 * @returns {bigint} the selection's mask
 */
export function selectionMask(selection, units = unitsOf(selection)) {
  let mask = 0n;
  for (const unit of selectedUnits(selection)) {
    mask |= unitMaskOf(unit, units);
  }
  return mask;
}

/**
 * The bitmask of a single word's units. The word is tokenized exactly as
 * `sounds.mjs` tokenizes it, and each unit contributes its bit; a doubled
 * letter contributes the `xx` bit.
 *
 * @param {string} word a lowercase word (casing is ignored)
 * @param {readonly string[]} units the unit index list
 * @param {readonly string[]} specials the language's specials (for tokenization)
 * @returns {bigint} the word's unit mask
 */
export function wordMask(word, units, specials) {
  const tokenized = tokenizeWord(String(word).toLowerCase(), specials);
  let mask = 0n;
  for (const unit of tokenized) {
    mask |= maskOfUnit(canonicalUnit(unit, units), units);
  }
  return mask;
}

/**
 * Classify one word against a selection: is it readable by the child, or does
 * it need an adult, and which units are still missing?
 *
 * A word is readable if and only if every one of its tokenized units is
 * selected; a doubled letter (`ll`, …) is selected exactly when `xx` is. The
 * returned `missing` array lists the canonical units still to select, so a
 * word is never reported readable while `missing` is non-empty.
 *
 * @param {string} word any word (casing is ignored)
 * @param {object} selection a selection (carries the language)
 * @returns {{readable: boolean, missing: string[]}} classification
 */
export function classifyWord(word, selection) {
  const units = unitsOf(selection);
  const selected = selectedUnits(selection);
  const specials = getSoundsForLanguage(selection.language).specials;
  const missing = [];
  for (const unit of tokenizeWord(String(word).toLowerCase(), specials)) {
    const canonical = canonicalUnit(unit, units);
    if (!selected.has(canonical)) missing.push(canonical);
  }
  return { readable: missing.length === 0, missing };
}

/**
 * Coverage of a list of word types against a selection.
 *
 * @param {Array<{w: string, n: number, m: bigint}>} types one row per distinct
 *   word: word text `w`, token count `n`, and unit mask `m` (as built by
 *   {@link buildCoverageTable} and restored by {@link parseTable})
 * @param {object} selection a selection
 * @returns {{tokens: number, types: number}} token and type fractions, each in
 *   [0, 1]: an empty selection yields 0, selecting every unit yields exactly 1
 */
export function coverageOfTypes(types, selection) {
  const selMask = selectionMask(selection);
  let totalTokens = 0;
  let readableTokens = 0;
  let totalTypes = 0;
  let readableTypes = 0;
  for (const row of types) {
    totalTypes += 1;
    const count = Number(row.n) || 0;
    totalTokens += count;
    if ((row.m & ~selMask) === 0n) {
      readableTypes += 1;
      readableTokens += count;
    }
  }
  return {
    tokens: totalTokens === 0 ? 0 : readableTokens / totalTokens,
    types: totalTypes === 0 ? 0 : readableTypes / totalTypes,
  };
}

/**
 * Share of sentences with no adult word (i.e. every word readable), computed
 * from sentence masks: a sentence is readable exactly when its mask has no bit
 * outside the selection's mask.
 *
 * @param {readonly bigint[]} sentenceMasks one unit mask per sentence
 * @param {object} selection a selection
 * @returns {number} readable sentences / total sentences, in [0, 1]
 */
export function readableSentenceShare(sentenceMasks, selection) {
  if (sentenceMasks.length === 0) return 0;
  const selMask = selectionMask(selection);
  let readable = 0;
  for (const mask of sentenceMasks) {
    if ((mask & ~selMask) === 0n) readable += 1;
  }
  return readable / sentenceMasks.length;
}

/**
 * Build the compact per-language coverage table for a list of sentence texts.
 *
 * Distinct words are counted by token frequency (in first-occurrence order),
 * each with its unit mask, and every sentence contributes one mask (the OR of
 * its words' masks). Masks are BigInt in the returned (in-memory) table.
 *
 * @param {string} language 'de' or 'en'
 * @param {readonly string[]} sentences sentence texts
 * @returns {{language: string, units: string[], words: Array<{w: string, n: number, m: bigint}>, sentences: bigint[]}}
 */
export function buildCoverageTable(language, sentences) {
  const units = unitsOf({ language });
  const specials = getSoundsForLanguage(language).specials;
  const counts = new Map();
  const sentenceMasks = [];
  for (const sentence of sentences) {
    let mask = 0n;
    for (const word of wordsOf(sentence)) {
      counts.set(word, (counts.get(word) ?? 0) + 1);
      mask |= wordMask(word, units, specials);
    }
    sentenceMasks.push(mask);
  }
  const words = [...counts.entries()].map(([w, n]) => ({ w, n, m: wordMask(w, units, specials) }));
  return { language, units, words, sentences: sentenceMasks };
}

/**
 * Serialize an in-memory coverage table to compact JSON. BigInt masks become
 * decimal strings; {@link parseTable} is the exact inverse.
 *
 * @param {object} table an in-memory table (see {@link buildCoverageTable})
 * @returns {string} JSON text
 */
export function serializeTable(table) {
  return JSON.stringify({
    language: table.language,
    units: table.units,
    words: table.words.map(({ w, n, m }) => ({ w, n, m: m.toString() })),
    sentences: table.sentences.map((mask) => mask.toString()),
  });
}

/**
 * Parse compact coverage-table JSON back into an in-memory table with BigInt
 * masks. Exact inverse of {@link serializeTable}.
 *
 * @param {string|object} json JSON text (or already-parsed object)
 * @returns {{language: string, units: string[], words: Array<{w: string, n: number, m: bigint}>, sentences: bigint[]}}
 */
export function parseTable(json) {
  const data = typeof json === "string" ? JSON.parse(json) : json;
  return {
    language: data.language,
    units: [...data.units],
    words: data.words.map((row) => ({ w: row.w, n: row.n, m: BigInt(row.m) })),
    sentences: data.sentences.map((mask) => BigInt(mask)),
  };
}
