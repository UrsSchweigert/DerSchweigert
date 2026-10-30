/**
 * Validator for the sentence pool in static/sentences/{de,en}.json.
 *
 * The pool is owner-provided content, so this only checks the properties the app
 * relies on: at most six words, unique text, and a stage that matches what the
 * real tokenizer says about every word. No sentence text is generated here.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { tokenizeWord, getSoundsForLanguage } from '../static/sounds.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const MAX_WORDS = 6;

const STAGE_SETS = {
  de: {
    S0: { consonants: [...'mlsrtnp'], vowels: [...'aei'], specials: [] },
    S2: { consonants: [...'bdfghklmnprstwz'], vowels: [...'aeiou'], specials: ['au', 'ei', 'ie', 'eu', 'ch', 'sch', 'st', 'xx'] },
  },
  en: {
    S0: { consonants: [...'mlsrtnp'], vowels: [...'aei'], specials: [] },
    S2: { consonants: [...'bcdfghklmnprstw'], vowels: [...'aeiou'], specials: ['sh', 'ch', 'th', 'oo', 'ee', 'ai', 'ou', 'xx'] },
  },
};

/** All four selections of the reference table, as unit sets for one language. */
export function stageSets(lang) {
  const sounds = getSoundsForLanguage(lang);
  const base = STAGE_SETS[lang];
  if (!base) throw new Error('unsupported language ' + lang);
  return {
    S0: base.S0,
    S1: { consonants: [...sounds.consonants], vowels: [...sounds.vowels], specials: [] },
    S2: base.S2,
    S3: { consonants: [...sounds.consonants], vowels: [...sounds.vowels], specials: [...sounds.specials] },
  };
}

/** The distinct sound units a sentence needs, ignoring punctuation and case. */
export function unitsOf(text, lang) {
  const specials = getSoundsForLanguage(lang).specials;
  return [...new Set(text.toLowerCase().replace(/[.,!?;:„“"'’]/g, '').split(/\s+/).filter(Boolean)
    .flatMap((word) => tokenizeWord(word, specials)))].sort();
}

/** The earliest stage in which every word of the sentence is fully readable, or null. */
export function stageOf(text, lang) {
  const units = unitsOf(text, lang);
  const sets = stageSets(lang);
  for (const stage of ['S0', 'S1', 'S2', 'S3']) {
    const allowed = new Set([...sets[stage].consonants, ...sets[stage].vowels, ...sets[stage].specials]);
    const readable = units.every((unit) =>
      allowed.has(unit) || (unit.length === 2 && unit[0] === unit[1] && sets[stage].specials.includes('xx')));
    if (readable) return stage;
  }
  return null;
}

export function load(lang) {
  return JSON.parse(readFileSync(join(HERE, '..', 'static', 'sentences', lang + '.json'), 'utf8'));
}

/** Problems that make a pool unusable. An empty list means the pool is consistent. */
export function validate(lang, data) {
  const problems = [];
  if (!Array.isArray(data.sentences)) return ['sentences must be an array'];
  const ids = new Set();
  const texts = new Set();
  for (const entry of data.sentences) {
    const where = entry && entry.id ? entry.id : JSON.stringify(entry).slice(0, 40);
    if (!entry || typeof entry.text !== 'string' || !entry.text.trim()) {
      problems.push(where + ': text is required');
      continue;
    }
    const words = entry.text.trim().split(/\s+/).length;
    if (words > MAX_WORDS) problems.push(where + ': ' + words + ' words, at most ' + MAX_WORDS + ' allowed');
    if (ids.has(entry.id)) problems.push(where + ': duplicate id');
    ids.add(entry.id);
    const key = entry.text.toLowerCase();
    if (texts.has(key)) problems.push(where + ': duplicate text ' + JSON.stringify(entry.text));
    texts.add(key);
    const stage = stageOf(entry.text, lang);
    if (stage === null) problems.push(where + ': no selection reads ' + JSON.stringify(entry.text));
    else if (stage !== entry.stage) problems.push(where + ': stage is ' + entry.stage + ' but the tokenizer says ' + stage);
    const required = unitsOf(entry.text, lang).join();
    if (required !== [...(entry.required || [])].sort().join()) problems.push(where + ': required units do not match');
    if (entry.words !== words) problems.push(where + ': words is ' + entry.words + ' but the text has ' + words);
  }
  if (data.count !== data.sentences.length) problems.push('count does not match the number of sentences');
  return problems;
}

// CLI: `node tools/validate_sentences.mjs <de|en>` prints problems and exits 1 when any exist.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const lang = process.argv[2];
  if (lang !== 'de' && lang !== 'en') {
    console.error('usage: node tools/validate_sentences.mjs <de|en>');
    process.exit(2);
  }
  const data = load(lang);
  const problems = validate(lang, data);
  for (const problem of problems) console.error(problem);
  console.log(lang + ': ' + data.sentences.length + ' sentences, ' + (problems.length ? problems.length + ' problems' : 'valid'));
  process.exit(problems.length ? 1 : 0);
}
