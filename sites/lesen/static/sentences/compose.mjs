/**
 * Runtime sentence composer.
 *
 * The committed pools in `de.json`/`en.json` are a fixed, ordered stream of
 * generated sentences, so a narrow letter selection often reads only a few
 * near-identical ones. The composer instead starts from the letter selection:
 * it keeps only the vocabulary the selection can read, then draws sentences
 * from what is left.
 *
 * Memory stays small on purpose. Nothing is enumerated: for a selection the
 * composer builds a compact index (per subject/verb pair, the readable
 * complements, held by reference to the vocabulary strings) and computes the
 * number of possible sentences by arithmetic. Sentences are only built for the
 * few that are actually drawn. The index is rebuilt per selection and dropped
 * with the composer.
 *
 * The same sentence grammar feeds `tools/generate_sentences.mjs`, through
 * {@link complementsFor}, {@link verbFor} and {@link assemble}, so the pool
 * and the composer cannot drift apart.
 *
 * No DOM or storage access lives here; `node:test` exercises it directly.
 */
import { classifySentence } from "../coverage.mjs";
import { VOCAB } from "./vocab.mjs";

/** Longest sentence offered, in words. Mirrors MAX_WORDS in tools/validate_sentences.mjs. */
export const MAX_SENTENCE_WORDS = 6;

/** Capitalise the first letter of a string. */
export function capitalize(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Complements a verb allows for one subject: the first matching group wins. */
export function complementsFor(verb, subject) {
  const group = Object.keys(verb.c).find((key) => key === "any" || subject.g.includes(key));
  if (!group) return [];
  return verb.c[group].flatMap((item) => (item === "$diet" ? subject.diet : item === "$drink" ? subject.drink : [item]));
}

/** The conjugated verb for a subject, or "" when the subject cannot use it. */
export function verbFor(verb, subject) {
  if (verb.v === "$sound") return subject.sound;
  if (typeof verb.v === "string") return verb.v;
  return subject.g.includes("H") ? verb.v.H : verb.v.default;
}

/** Whether an adverb may be combined with a verb. */
function adverbFits(verb, adverb) {
  return !(adverb && verb.advOnly && !verb.advOnly.includes(adverb.w));
}

/**
 * Join the parts of one sentence in German/English word order.
 * @param {string} subject subject phrase
 * @param {string} form conjugated verb
 * @param {{w: string, pos: "pre"|"verb"|"end"}|null} adverb optional adverb
 * @param {string} complement complement phrase, or "" for none
 * @returns {string} the capitalised sentence with a full stop
 */
export function assemble(subject, form, adverb, complement) {
  const parts = [subject];
  if (adverb && adverb.pos === "pre") parts.push(adverb.w);
  parts.push(form);
  if (adverb && adverb.pos === "verb") parts.push(adverb.w);
  if (complement) parts.push(complement);
  if (adverb && adverb.pos === "end") parts.push(adverb.w);
  return capitalize(parts.join(" ")) + ".";
}

/** Lowercased words of a phrase. */
function lowerWords(phrase) {
  return phrase ? phrase.toLowerCase().match(/[^\s.,!?]+/g) || [] : [];
}

/**
 * Whether the complement repeats a word of the subject, as in "Nina singt mit
 * Nina". Articles and verbs never collide, so any shared word is a repeat.
 */
function repeatsSubject(subject, complement) {
  const own = lowerWords(subject);
  return lowerWords(complement).some((word) => own.includes(word));
}

/** Number of whitespace-separated words in a phrase. */
function wordsIn(phrase) {
  return phrase ? phrase.trim().split(/\s+/).length : 0;
}

/**
 * Index the readable part of a vocabulary for one selection.
 *
 * Blocks are (adverb variant, verb, subject) combinations with at least one
 * readable complement. They are grouped by conjugated verb form, so a verb
 * with a long complement list (or listed twice) does not crowd out the others:
 * a draw picks a verb group first, then a sentence within it.
 *
 * @param {{subjects: object[], verbs: object[], adverbs: object[]}} vocab language vocabulary
 * @param {object} selection letter selection
 * @param {string} lang language code
 * @returns {{groups: Array<{blocks: object[], cumulative: number[], total: number}>, total: number}} the index
 */
function buildIndex(vocab, selection, lang) {
  const readableMemo = new Map();
  const readable = (phrase) => {
    if (!phrase) return true;
    let known = readableMemo.get(phrase);
    if (known === undefined) {
      known = classifySentence(phrase, selection, lang).readable;
      readableMemo.set(phrase, known);
    }
    return known;
  };

  const subjects = vocab.subjects.filter((subject) => readable(subject.t));
  const adverbs = [null, ...vocab.adverbs.filter((adverb) => readable(adverb.w))];
  const byForm = new Map();
  let total = 0;

  for (const verb of vocab.verbs) {
    for (const subject of subjects) {
      const form = verbFor(verb, subject);
      if (!form || !readable(form)) continue;
      const complements = complementsFor(verb, subject)
        .filter((complement) => readable(complement) && !repeatsSubject(subject.t, complement));
      if (!complements.length) continue;
      const base = wordsIn(subject.t) + wordsIn(form);
      for (const adverb of adverbs) {
        if (!adverbFits(verb, adverb)) continue;
        const room = MAX_SENTENCE_WORDS - base - (adverb ? 1 : 0);
        // Complements that keep the sentence within the word limit.
        const fitting = complements.filter((complement) => wordsIn(complement) <= room);
        if (!fitting.length) continue;
        let group = byForm.get(form);
        if (!group) {
          group = { blocks: [], cumulative: [], total: 0 };
          byForm.set(form, group);
        }
        group.total += fitting.length;
        total += fitting.length;
        group.blocks.push({ subject: subject.t, form, adverb, fitting });
        group.cumulative.push(group.total);
      }
    }
  }
  return { groups: [...byForm.values()], total };
}

/** Index of the first block whose cumulative size exceeds `position`. */
function blockAt(cumulative, position) {
  let low = 0;
  let high = cumulative.length - 1;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (cumulative[mid] > position) high = mid;
    else low = mid + 1;
  }
  return low;
}

/** The sentence at a position inside one verb group. */
function textAt(group, position) {
  const index = blockAt(group.cumulative, position);
  const block = group.blocks[index];
  const start = group.cumulative[index] - block.fitting.length;
  return assemble(block.subject, block.form, block.adverb, block.fitting[position - start]);
}

/**
 * Build a composer for one letter selection.
 *
 * @param {object} selection `{consonants, vowels, specials}`
 * @param {string} [lang] language code ('de' or 'en')
 * @param {object} [vocab] vocabulary override; defaults to the shipped one
 * @returns {{
 *   capacity: number,
 *   sample: (count: number, random?: () => number, exclude?: Set<string>) => string[],
 * }} composer; `capacity` is the number of sentences it can draw (duplicates
 *   across verbs are rare, so this is an upper bound within a few percent)
 */
export function createComposer(selection, lang = "de", vocab = VOCAB[lang]) {
  const empty = { capacity: 0, sample: () => [] };
  if (!vocab) return empty;
  const { groups, total } = buildIndex(vocab, selection, lang);
  if (total === 0) return empty;

  return {
    capacity: total,

    /**
     * Draw up to `count` distinct sentences, spread evenly over the verbs.
     * @param {number} count how many to draw
     * @param {() => number} [random] random source in [0, 1)
     * @param {Set<string>} [exclude] texts that must not be returned
     * @returns {string[]} distinct sentence texts
     */
    sample(count, random = Math.random, exclude = new Set()) {
      const wanted = Math.max(0, Math.floor(Number(count)) || 0);
      if (wanted === 0) return [];
      const picked = new Set();

      // A request covering most of the space reads every sentence once, in
      // shuffled order, instead of retrying draws that keep hitting taken ones.
      if (total <= wanted * 3) {
        const all = [];
        for (const group of groups) {
          for (let position = 0; position < group.total; position++) all.push(textAt(group, position));
        }
        for (let index = all.length - 1; index > 0; index--) {
          const other = Math.floor(random() * (index + 1));
          [all[index], all[other]] = [all[other], all[index]];
        }
        for (const text of all) {
          if (picked.size >= wanted) break;
          if (!exclude.has(text)) picked.add(text);
        }
        return [...picked];
      }

      let attempts = wanted * 20 + 50;
      while (picked.size < wanted && attempts-- > 0) {
        const group = groups[Math.min(groups.length - 1, Math.floor(random() * groups.length))];
        const text = textAt(group, Math.min(group.total - 1, Math.floor(random() * group.total)));
        if (!exclude.has(text)) picked.add(text);
      }
      return [...picked];
    },
  };
}
