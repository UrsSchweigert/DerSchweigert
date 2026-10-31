/**
 * Card scoring, Flop Training and deck assembly logic.
 *
 * recordAttempt updates card stats based on correctness and mode.
 * selectFlopDeck selects the worst-performing cards for focused practice.
 * buildSentenceOnlyDeck and buildMixedDeck assemble practice decks from the
 * committed sentence pool and word cards.
 */
import { readableSentenceCards } from "./sentences/cards.mjs";

/**
 * Determine whether a card can be read aloud.
 * Only word and sentence cards support text-to-speech; pattern cards do not.
 * @param {object} card a card object with optional kind property
 * @returns {boolean} true if the card is a word or sentence card
 */
export function isSpeakableCard(card) {
  return card?.kind === 'word' || card?.kind === 'sentence';
}

/**
 * Record an attempt on a card and update the stats map.
 * @param {object} stats - A map of card text to { correct_count, incorrect_count }
 * @param {string} key - The card text (unique identifier)
 * @param {boolean} correct - Whether the answer was correct
 * @param {{flop: boolean, recovery?: boolean}} options - Options object; flop=true awards 3 points for correct; recovery=true resets stats on flop success
 */
export function recordAttempt(stats, key, correct, { flop, recovery } = {}) {
  if (!stats[key]) {
    stats[key] = { correct_count: 0, incorrect_count: 0 };
  }

  if (correct) {
    // Flop mode awards 3 points for correct, normal mode awards 1
    stats[key].correct_count += flop ? 3 : 1;
  } else {
    // Incorrect always adds 1
    stats[key].incorrect_count += 1;
  }

  // If recovery flag is set on flop success, reset the card stats
  if (recovery && flop && correct) {
    stats[key].correct_count = 0;
    stats[key].incorrect_count = 0;
  }
}

/**
 * Reset card statistics for recovery mode.
 * Used when a card with previous misses is answered correctly in Flop Training.
 * @param {object} stats - A map of card text to { correct_count, incorrect_count }
 * @param {string} key - The card text (unique identifier)
 */
export function resetCardStats(stats, key) {
  if (stats[key]) {
    stats[key].correct_count = 0;
    stats[key].incorrect_count = 0;
  }
}

/**
 * Decide whether a card text can be spelled with the given sounds.
 *
 * Sounds may be single letters ("t", "a") or multi-character specials
 * ("au", "ei"), so the text is matched by walking every possible split
 * instead of checking character by character.
 *
 * When the allowedSounds set contains the 'xx' sentinel, a 2-letter substring
 * with identical characters (e.g., 'll') is considered reachable alongside
 * literal multi-character sounds.
 *
 * @param {string} text - Card text (any casing)
 * @param {Set<string>|readonly string[]} allowedSounds - Selected sounds
 * @returns {boolean} true when the text is fully covered by the sounds
 */
export function isSpellableWith(text, allowedSounds) {
  const sounds = allowedSounds instanceof Set ? allowedSounds : new Set(allowedSounds);
  if (!text || sounds.size === 0) {
    return false;
  }
  const letters = [...text.toLowerCase()];
  let longestSound = 1;
  for (const sound of sounds) {
    if (sound !== 'xx') { // Skip the sentinel when calculating longestSound
      longestSound = Math.max(longestSound, [...sound].length);
    }
  }

  const hasXxSentinel = sounds.has('xx');
  const reachable = new Array(letters.length + 1).fill(false);
  reachable[0] = true;
  for (let index = 0; index < letters.length; index++) {
    if (!reachable[index]) continue;
    // Try doubled letters if 'xx' is selected
    if (hasXxSentinel && index + 2 <= letters.length && letters[index] === letters[index + 1]) {
      reachable[index + 2] = true;
    }
    // Try regular sounds
    for (let length = 1; length <= longestSound && index + length <= letters.length; length++) {
      if (sounds.has(letters.slice(index, index + length).join(""))) {
        reachable[index + length] = true;
      }
    }
  }
  return reachable[letters.length];
}

/**
 * Collect the sentence texts of the given pool entries or cards.
 * @param {Iterable<string|{text?: string}>|undefined} sentenceCards
 * @returns {Set<string>} the texts that identify sentence cards
 */
function sentenceTextSet(sentenceCards) {
  const texts = new Set();
  for (const entry of sentenceCards || []) {
    const text = cardTextOf(entry);
    if (text) texts.add(text);
  }
  return texts;
}

/**
 * Collect the card texts from the recorded history that match the current
 * sound selection.
 *
 * Stats are keyed by card text (e.g. "ta", "Am", "Hut"), so Flop Training
 * candidates have to be derived from the history itself rather than from
 * freshly generated combinations.
 *
 * Word cards are filtered by spellability, exactly as before. Sentence cards
 * are eligible regardless of spellability: a sentence is a whole utterance
 * the child may still practise, even when not every one of its units is
 * selected. Because the statistics map stores only texts, the caller names
 * the sentence cards of the active language.
 *
 * @param {object} stats - A map of card text to { correct_count, incorrect_count }
 * @param {Set<string>|readonly string[]} allowedSounds - Selected consonants,
 *   vowels and specials
 * @param {Iterable<string|{text?: string}>} [sentenceCards] - texts of the
 *   sentence cards of the active language
 * @returns {string[]} Card texts usable with the current selection
 */
export function flopCandidateCards(stats, allowedSounds, sentenceCards = []) {
  if (!stats || typeof stats !== "object") {
    return [];
  }
  const sentenceTexts = sentenceTextSet(sentenceCards);
  return Object.keys(stats).filter(
    (text) => sentenceTexts.has(text) || isSpellableWith(text, allowedSounds)
  );
}

// Flop Training weak card selection constants
export const FLOP_WEAK_SUCCESS_RATE_THRESHOLD = 0.7;  // Cards below 70% success rate
export const FLOP_WEAK_MIN_ATTEMPTS = 2;              // At least 2 attempts required
export const FLOP_DECK_MIN_CARDS = 1;                 // Minimum cards in flop deck
export const FLOP_DECK_MAX_CARDS = 30;                // Maximum cards in flop deck
export const FLOP_DECK_PERCENTILE = 0.1;              // Bottom 10% of weak cards

/**
 * Select cards for Flop Training (focused practice on weak cards).
 *
 * Sentence and word cards share the same rule: only cards with success rate < 0.7
 * AND at least 2 total attempts qualify as "weak". Among weak candidates, the
 * worst tenth is practised. Because sentence cards reach this function through
 * {@link flopCandidateCards}, they are never dropped for being unspellable; word
 * cards keep the old spellability filter.
 *
 * Algorithm:
 * 1. Filter to allowedCards with success rate (correct/(correct+incorrect)) < 0.7
 * 2. Filter to cards with total attempts >= 2
 * 3. Sort ascending by success rate: worst first
 * 4. Take bottom 10% of the remaining weak cards (rounding up, with min 1 and max 30)
 * 
 * @param {object} stats - A map of card text to { correct_count, incorrect_count }
 * @param {string[]} allowedCards - Array of card texts to consider
 * @returns {string[]} Array of card texts for Flop Training
 */
export function selectFlopDeck(stats, allowedCards) {
  // Filter to only genuinely weak cards: success rate < 0.7 AND >= 2 attempts
  const weak = allowedCards.filter((card) => {
    const cardStats = stats[card];
    if (!cardStats) return false;
    const total = cardStats.correct_count + cardStats.incorrect_count;
    if (total < FLOP_WEAK_MIN_ATTEMPTS) return false;
    const successRate = cardStats.correct_count / total;
    return successRate < FLOP_WEAK_SUCCESS_RATE_THRESHOLD;
  });

  if (weak.length === 0) {
    return [];
  }

  // Sort by success rate ascending (worst first)
  const sorted = weak.sort((a, b) => {
    const statsA = stats[a];
    const statsB = stats[b];
    const rateA = statsA.correct_count / (statsA.correct_count + statsA.incorrect_count);
    const rateB = statsB.correct_count / (statsB.correct_count + statsB.incorrect_count);
    return rateA - rateB;
  });

  // Calculate bottom 10% of weak cards, with at least 1 and max 30
  const bottomPercent = Math.ceil(sorted.length * FLOP_DECK_PERCENTILE);
  const count = Math.min(Math.max(bottomPercent, FLOP_DECK_MIN_CARDS), FLOP_DECK_MAX_CARDS);

  return sorted.slice(0, count);
}

/**
 * Build the Flop Training deck as practice cards.
 *
 * Candidates are chosen kind-aware by {@link flopCandidateCards} and cut by
 * the worst-10 % rule of {@link selectFlopDeck}. Sentence cards keep their
 * kind so the practice screen can size them like other sentence cards; word
 * cards stay plain word cards. A single attempted sentence card therefore
 * yields a usable one-card deck.
 *
 * @param {object} stats - A map of card text to { correct_count, incorrect_count }
 * @param {Set<string>|readonly string[]} allowedSounds - Selected consonants,
 *   vowels and specials
 * @param {Iterable<string|{text?: string}>} [sentenceCards] - texts of the
 *   sentence cards of the active language
 * @returns {Array<{text: string, kind: "word"|"sentence", misses: number}>}
 *   the flop deck, worst first
 */
export function buildFlopDeck(stats, allowedSounds, sentenceCards = []) {
  const sentenceTexts = sentenceTextSet(sentenceCards);
  const candidates = flopCandidateCards(stats, allowedSounds, sentenceCards);
  return selectFlopDeck(stats, candidates).map((text) => ({
    text,
    kind: sentenceTexts.has(text) ? "sentence" : "word",
    misses: 0,
  }));
}

/**
 * Deterministic pseudo-random generator (mulberry32).
 *
 * Deck tests pin a seed instead of stubbing `Math.random`, so the same seed
 * always yields the same shuffle and the same card order.
 *
 * @param {number} seed any integer
 * @returns {() => number} random source in [0, 1)
 */
export function createSeededRandom(seed) {
  let state = Number(seed) >>> 0;
  return function random() {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Read the text of a pool entry, card or plain string.
 * @param {string|{text?: string}|null|undefined} entry
 * @returns {string} the text, or "" when the entry carries none
 */
function cardTextOf(entry) {
  if (typeof entry === "string") return entry;
  if (entry && typeof entry.text === "string") return entry.text;
  return "";
}

/**
 * Turn a requested deck size into a usable limit.
 * @param {number} count requested size; non-finite means "everything"
 * @returns {number} a non-negative integer, or Infinity
 */
function deckLimit(count) {
  if (count === undefined || count === null) return Infinity;
  const numeric = Number(count);
  if (!Number.isFinite(numeric)) return Infinity;
  return Math.max(0, Math.floor(numeric));
}

/**
 * Resolve the random source of a deck call.
 * @param {(() => number)|undefined} random explicit random source
 * @param {number|undefined} seed optional seed
 * @returns {() => number} the random source to use
 */
function deckRandom(random, seed) {
  if (typeof random === "function") return random;
  if (seed !== undefined && seed !== null) return createSeededRandom(seed);
  return Math.random;
}

/**
 * Shuffle a copy of the items with an injectable random source.
 * @param {any[]} items items to shuffle
 * @param {() => number} random random source in [0, 1)
 * @returns {any[]} a shuffled copy
 */
function shuffleWith(items, random) {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index--) {
    const other = Math.floor(random() * (index + 1));
    [result[index], result[other]] = [result[other], result[index]];
  }
  return result;
}

/**
 * Build a sentence-only deck from the committed sentence pool.
 *
 * Only sentences the current selection can read in full are eligible, so a
 * deck can never contain a sentence the child cannot read. Duplicate texts are
 * dropped, the readable sentences are shuffled and the deck is cut to `count`.
 * An empty or missing pool, an empty selection or `count` of 0 all yield an
 * empty deck instead of an error.
 *
 * @param {Array<string|{text?: string}>} pool sentence pool of the language
 * @param {{consonants?: Iterable<string>, vowels?: Iterable<string>, specials?: Iterable<string>}} selection
 * @param {string} [lang] language code ('de' or 'en')
 * @param {{count?: number, seed?: number, random?: () => number}} [options]
 *   `count` defaults to every readable sentence; `seed` pins the shuffle
 * @returns {Array<{text: string, kind: "sentence", misses: number}>} the deck
 */
export function buildSentenceOnlyDeck(pool, selection, lang = "de", { count, seed, random } = {}) {
  const limit = deckLimit(count);
  if (limit === 0) return [];

  const cards = [];
  const seen = new Set();
  for (const entry of readableSentenceCards(pool, selection, lang)) {
    const text = cardTextOf(entry);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    cards.push({ text, kind: "sentence", misses: 0 });
  }

  const deck = shuffleWith(cards, deckRandom(random, seed));
  return limit === Infinity ? deck : deck.slice(0, limit);
}

/**
 * Build a mixed deck that interleaves sentence and word cards.
 *
 * Sentences are filtered to the ones the current selection reads in full,
 * exactly like {@link buildSentenceOnlyDeck}. Both kinds are shuffled with the
 * same random source and then alternate strictly, starting with the kind the
 * seed picks. Cards are never grouped: when one kind runs out the deck ends,
 * so a mixed deck only contains as many cards as the scarcer kind allows.
 * A missing pool, an empty selection or no word cards yield an empty deck.
 *
 * @param {Array<string|{text?: string}>} pool sentence pool of the language
 * @param {{consonants?: Iterable<string>, vowels?: Iterable<string>, specials?: Iterable<string>}} selection
 * @param {string} [lang] language code ('de' or 'en')
 * @param {Array<string|{text?: string}>} wordCards readable word cards
 * @param {{count?: number, seed?: number, random?: () => number}} [options]
 * @returns {Array<{text: string, kind: "word"|"sentence", misses: number}>} the deck
 */
export function buildMixedDeck(pool, selection, lang = "de", wordCards = [], { count, seed, random } = {}) {
  const limit = deckLimit(count);
  if (limit === 0) return [];

  const rng = deckRandom(random, seed);
  const sentences = buildSentenceOnlyDeck(pool, selection, lang, { random: rng });

  const words = [];
  const seen = new Set();
  for (const entry of Array.isArray(wordCards) ? wordCards : []) {
    const text = cardTextOf(entry);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    words.push({ text, kind: "word", misses: 0 });
  }
  const shuffledWords = shuffleWith(words, rng);

  const pairs = Math.min(sentences.length, shuffledWords.length);
  if (pairs === 0) return [];
  const size = Math.min(limit, pairs * 2);
  const startsWithSentence = rng() < 0.5;

  const deck = [];
  for (let index = 0; index < size; index++) {
    const takeSentence = (index % 2 === 0) === startsWithSentence;
    const source = takeSentence ? sentences : shuffledWords;
    deck.push(source[Math.floor(index / 2)]);
  }
  return deck;
}
