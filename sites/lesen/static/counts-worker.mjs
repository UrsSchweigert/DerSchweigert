// Module worker: computes the word/sentence match counts off the main thread.
import { computeCounts } from './counts-compute.mjs';

const cache = new Map();

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Not available: ${url}`);
  return response.json();
}

function loadWords(lang) {
  const key = `words-${lang}`;
  if (!cache.has(key)) {
    const promise = fetchJson(lang === 'en' ? './words-en.json' : './words-de.json')
      .then(data => {
        if (!data || !Array.isArray(data.words)) throw new Error('Invalid word list');
        return data.words;
      })
      .catch(error => { cache.delete(key); throw error; });
    cache.set(key, promise);
  }
  return cache.get(key);
}

function loadSentences(lang) {
  const key = `sentences-${lang}`;
  if (!cache.has(key)) {
    const promise = fetchJson(`./sentences/${lang}.json`)
      .then(data => {
        if (!data || !Array.isArray(data.sentences)) throw new Error('Invalid sentence pool');
        return data.sentences;
      })
      .catch(error => { cache.delete(key); throw error; });
    cache.set(key, promise);
  }
  return cache.get(key);
}

self.onmessage = async ({ data: { requestId, lang, selection } }) => {
  try {
    const [words, sentences] = await Promise.all([
      loadWords(lang).catch(() => null),
      loadSentences(lang).catch(() => null),
    ]);
    self.postMessage({ requestId, lang, ...computeCounts({ words, sentences }, lang, selection) });
  } catch (error) {
    self.postMessage({ requestId, lang, error: String(error && error.message || error) });
  }
};
