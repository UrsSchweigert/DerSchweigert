/**
 * Pure coverage math for reading selections.
 *
 * A "selection" is the set of sounds a child can currently read:
 * `{ consonants, vowels, specials }`, each an iterable of sound units.
 * A word is readable when every sound unit of it is allowed by the selection.
 *
 * Tokenization is delegated to {@link tokenizeWord} from `sounds.mjs`, so
 * coverage and Words Mode agree by construction. This module has no DOM,
 * storage or network dependencies and can be unit tested with `node:test`.
 */
import { getSoundsForLanguage, tokenizeWord } from "./sounds.mjs";

/** Letters counted as word characters; everything else separates tokens. */
const WORD_PATTERN = /[A-Za-zÀ-ÖØ-öø-ÿĀ-ž]+/g;

/**
 * Split raw text into lowercased word tokens, the way coverage counts them.
 * Punctuation, digits, whitespace and symbols separate words, so
 * "Schaukel-pferd" and "don't" each count as two tokens.
 *
 * @param {string} text raw text
 * @returns {string[]} lowercased word tokens, in order
 */
export function wordTokens(text) {
  const matches = String(text ?? "").match(WORD_PATTERN);
  return matches ? matches.map((token) => token.toLowerCase()) : [];
}

/**
 * Split one word into sound units using the language's complete special list,
 * so digraphs and doubled letters are recognized even when not selected.
 *
 * @param {string} word word in any casing
 * @param {string} [lang] language code ('de' or 'en')
 * @returns {string[]} sound units, in order
 */
export function unitsOf(word, lang = "de") {
  const { specials } = getSoundsForLanguage(lang);
  return tokenizeWord(String(word ?? "").toLowerCase(), specials);
}

/**
 * Build the set of allowed sound units for a selection.
 * @param {{consonants?: Iterable<string>, vowels?: Iterable<string>, specials?: Iterable<string>}} selection
 * @returns {Set<string>} allowed units
 */
function allowedUnits(selection) {
  const chosen = selection || {};
  return new Set([
    ...(chosen.consonants || []),
    ...(chosen.vowels || []),
    ...(chosen.specials || []),
  ]);
}

/**
 * Whether a single sound unit is allowed by a selection.
 *
 * A two-character unit of identical letters (e.g. "ll") counts as allowed
 * when the selection includes the 'xx' sentinel, mirroring Words Mode.
 *
 * @param {string} unit sound unit
 * @param {{consonants?: Iterable<string>, vowels?: Iterable<string>, specials?: Iterable<string>}} selection
 * @param {Set<string>} [allowed] prebuilt allowed set, to avoid rebuilding it per unit
 * @returns {boolean} true when the unit is readable
 */
export function isUnitAllowed(unit, selection, allowed = allowedUnits(selection)) {
  if (allowed.has(unit)) return true;
  const doubled = unit.length === 2 && unit[0] === unit[1];
  const specials = selection && selection.specials ? [...selection.specials] : [];
  return doubled && specials.includes("xx");
}

/**
 * Classify one word against a selection.
 *
 * `readable` is true only when the word has at least one unit and every unit
 * is allowed; `missing` lists the distinct units the selection lacks, in order
 * of first appearance. A word is never reported readable while a unit is
 * missing.
 *
 * @param {string} word word in any casing
 * @param {{consonants?: Iterable<string>, vowels?: Iterable<string>, specials?: Iterable<string>}} selection
 * @param {string} [lang] language code ('de' or 'en')
 * @returns {{readable: boolean, missing: string[]}} classification
 */
export function classifyWord(word, selection, lang = "de") {
  const allowed = allowedUnits(selection);
  const units = unitsOf(word, lang);
  const missing = [];
  for (const unit of units) {
    if (!isUnitAllowed(unit, selection, allowed) && !missing.includes(unit)) missing.push(unit);
  }
  return { readable: units.length > 0 && missing.length === 0, missing };
}

/**
 * Token and type coverage of a text for a selection, as fractions in [0, 1].
 *
 * Token coverage is readable tokens ÷ all tokens; type coverage is readable
 * distinct lowercased tokens ÷ all distinct lowercased tokens. An empty
 * selection or empty text yields 0, and adding a unit never lowers either
 * fraction.
 *
 * @param {string} text raw text
 * @param {{consonants?: Iterable<string>, vowels?: Iterable<string>, specials?: Iterable<string>}} selection
 * @param {string} [lang] language code ('de' or 'en')
 * @returns {{tokens: number, types: number}} fractions, 0 when there is nothing to count
 */
export function coverageOfTypes(text, selection, lang = "de") {
  const allowed = allowedUnits(selection);
  const tokens = wordTokens(text);
  if (!tokens.length) return { tokens: 0, types: 0 };

  let readableTokens = 0;
  const types = new Set();
  const readableTypes = new Set();
  for (const token of tokens) {
    types.add(token);
    const readable = unitsOf(token, lang).every((unit) => isUnitAllowed(unit, selection, allowed));
    if (readable) {
      readableTokens++;
      readableTypes.add(token);
    }
  }
  return {
    tokens: readableTokens / tokens.length,
    types: readableTypes.size / types.size,
  };
}

/**
 * Share of pool sentences a selection can read in full.
 *
 * Every token of a sentence must be readable; punctuation and casing are
 * ignored. Entries may be strings or objects with a `text` field.
 *
 * @param {Iterable<string|{text: string}>} sentences sentence pool
 * @param {{consonants?: Iterable<string>, vowels?: Iterable<string>, specials?: Iterable<string>}} selection
 * @param {string} [lang] language code ('de' or 'en')
 * @returns {number} fraction in [0, 1], 0 for an empty pool
 */
export function readableSentenceShare(sentences, selection, lang = "de") {
  const allowed = allowedUnits(selection);
  const pool = sentences ? [...sentences] : [];
  if (!pool.length) return 0;

  let readable = 0;
  for (const entry of pool) {
    const text = typeof entry === "string" ? entry : entry && entry.text;
    const tokens = wordTokens(text);
    const fullyReadable = tokens.length > 0
      && tokens.every((token) => unitsOf(token, lang).every((unit) => isUnitAllowed(unit, selection, allowed)));
    if (fullyReadable) readable++;
  }
  return readable / pool.length;
}
