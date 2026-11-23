// Pure computation behind the live match counts; runs inside counts-worker.mjs
// and is importable without a Worker for tests.
import { countMatchingWords, getSoundsForLanguage } from './sounds.mjs';
import { bestNextUnits } from './coverage.mjs';
import { readableSentenceCards } from './sentences/cards.mjs';
import { createComposer } from './sentences/compose.mjs';

/**
 * @param {{words: string[]|null, sentences: Array<{id: string, text: string}>|null}} data
 *   a null list yields null results for the parts that depend on it
 * @param {string} lang language code
 * @param {{consonants: string[], vowels: string[], specials: string[]}} selection
 * @returns {{wordCount: number|null, best: object|null, sentenceCount: number|null}}
 */
export function computeCounts({ words, sentences }, lang, selection) {
  const sounds = getSoundsForLanguage(lang);
  let wordCount = null;
  let best = null;
  if (words) {
    wordCount = countMatchingWords(words, selection, Infinity, sounds.specials);
    best = bestNextUnits(words, selection, sounds, lang);
  }
  // The composer draws from the same vocabulary the pool was generated from, so
  // its capacity overlaps the pool; the larger of the two is the honest floor.
  const sentenceCount = sentences
    ? Math.max(readableSentenceCards(sentences, selection, lang).length, createComposer(selection, lang).capacity)
    : null;
  return { wordCount, best, sentenceCount };
}
