import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { computeCounts } from '../static/counts-compute.mjs';
import { countMatchingWords, getSoundsForLanguage } from '../static/sounds.mjs';
import { bestNextUnits } from '../static/coverage.mjs';
import { readableSentenceCards } from '../static/sentences/cards.mjs';

const read = path => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));

for (const lang of ['de', 'en']) {
  test(`computeCounts matches the direct calls (${lang})`, () => {
    const words = read(`../static/words-${lang}.json`).words;
    const sentences = read(`../static/sentences/${lang}.json`).sentences;
    const sounds = getSoundsForLanguage(lang);
    const selection = {
      consonants: sounds.consonants.slice(0, 8),
      vowels: sounds.vowels.slice(0, 3),
      specials: [],
    };
    const result = computeCounts({ words, sentences }, lang, selection);
    assert.equal(result.wordCount, countMatchingWords(words, selection, Infinity, sounds.specials));
    assert.deepEqual(result.best, bestNextUnits(words, selection, sounds, lang));
    assert.equal(result.sentenceCount, readableSentenceCards(sentences, selection, lang).length);
  });
}

test('computeCounts returns null for unavailable data', () => {
  const selection = { consonants: [], vowels: [], specials: [] };
  assert.deepEqual(computeCounts({ words: null, sentences: null }, 'de', selection),
    { wordCount: null, best: null, sentenceCount: null });
});
