import test from "node:test";
import assert from "node:assert/strict";
import { createComposer, MAX_SENTENCE_WORDS } from "../static/sentences/compose.mjs";
import { VOCAB } from "../static/sentences/vocab.mjs";
import { classifySentence, wordTokens } from "../static/coverage.mjs";
import { MAX_WORDS } from "../tools/validate_sentences.mjs";
import { buildSentenceOnlyDeck } from "../static/scoring.mjs";
import { computeCounts } from "../static/counts-compute.mjs";
import { createSeededRandom } from "../static/scoring.mjs";

// The selection from the bug report: early letters plus the digraphs au and ei.
const EARLY = { consonants: [..."stmnlkgr"], vowels: [..."aeiou"], specials: ["au", "ei"] };
const FULL_DE = {
  consonants: [..."bcdfghjklmnpqrstvwxyzß"],
  vowels: [..."aeiou"],
  specials: ["ä", "ö", "ü", "au", "ei", "ie", "eu", "sch", "ch", "st", "ai", "xx"],
};

test("composer word limit matches the pool validator", () => {
  assert.equal(MAX_SENTENCE_WORDS, MAX_WORDS);
});

test("every composed sentence is fully readable with the selection", () => {
  const composer = createComposer(EARLY, "de");
  const texts = composer.sample(2000, createSeededRandom(1));
  assert.ok(texts.length > 500);
  for (const text of texts) {
    assert.ok(classifySentence(text, EARLY, "de").readable, text + " is not readable");
    const words = text.trim().split(/\s+/).length;
    assert.ok(words >= 2 && words <= MAX_SENTENCE_WORDS, text);
  }
});

test("composer is sensitive to special characters", () => {
  const withEi = createComposer(EARLY, "de").sample(100000);
  const withoutEi = createComposer({ ...EARLY, specials: ["au"] }, "de").sample(100000);
  const needsEi = (text) => classifySentence(text, { ...EARLY, specials: ["au"] }, "de").missing.includes("ei");
  assert.ok(withEi.some(needsEi), "ei words appear when ei is selected");
  assert.ok(!withoutEi.some((text) => /ei/i.test(text) && needsEi(text)), "no ei words without ei");
  assert.ok(!withoutEi.some((text) => /[äöüß]/i.test(text)), "no umlaut or ß without them");
  assert.ok(withEi.some((text) => /\b(Eis|Reis|Mareike|Eike)\b/.test(text)), "digraph vocabulary is used");
});

test("the early selection gets far more varied sentences than the committed pool alone", () => {
  const composer = createComposer(EARLY, "de");
  assert.ok(composer.capacity > 2000, "capacity " + composer.capacity);
  const all = composer.sample(1e6);
  const words = new Set(all.flatMap(wordTokens));
  assert.ok(words.size > 60, "distinct words " + words.size);
  const known = ["singt", "malt", "lernt", "trinkt", "erntet", "mag", "teilt", "sagt", "reist", "liest", "kennt", "isst", "sammelt"];
  const verbs = new Set(all.map((text) => known.find((verb) => text.split(" ").includes(verb))).filter(Boolean));
  assert.ok(verbs.size >= 7, "distinct verbs " + [...verbs]);
});

test("sampling spreads over verbs instead of favouring the longest complement list", () => {
  const texts = createComposer(EARLY, "de").sample(400, createSeededRandom(5));
  const counts = new Map();
  for (const text of texts) {
    const verb = text.split(" ").find((word) => ["singt", "malt", "lernt", "trinkt", "erntet", "mag", "teilt", "sagt"].includes(word));
    if (verb) counts.set(verb, (counts.get(verb) || 0) + 1);
  }
  const top = Math.max(...counts.values());
  assert.ok(top < texts.length * 0.35, "one verb dominates: " + JSON.stringify([...counts]));
});

test("a complement never repeats a word of the subject", () => {
  for (const text of createComposer(EARLY, "de").sample(1e6)) {
    assert.ok(!/\b(\w+) .*\bmit \1\b/.test(text), text);
  }
});

test("samples are distinct, honour the count and the exclusion set", () => {
  const composer = createComposer(EARLY, "de");
  const first = composer.sample(50, createSeededRandom(2));
  assert.equal(first.length, 50);
  assert.equal(new Set(first).size, 50);
  const second = composer.sample(50, createSeededRandom(2), new Set(first));
  assert.ok(second.every((text) => !first.includes(text)));
  assert.deepEqual(composer.sample(0), []);
});

test("a tiny selection yields few sentences and an unreadable one yields none", () => {
  const tiny = createComposer({ consonants: ["m"], vowels: ["a"], specials: [] }, "de");
  assert.ok(tiny.sample(1000).every((text) => /^[MmAa .]+$/.test(text)));
  const none = createComposer({ consonants: [], vowels: [], specials: [] }, "de");
  assert.equal(none.capacity, 0);
  assert.deepEqual(none.sample(10), []);
  assert.equal(createComposer(EARLY, "xx").capacity, 0);
});

test("capacity is computed without materialising sentences", () => {
  const composer = createComposer(FULL_DE, "de");
  assert.ok(composer.capacity > 100000);
  const before = process.memoryUsage().heapUsed;
  createComposer(FULL_DE, "de");
  assert.ok(process.memoryUsage().heapUsed - before < 200e6, "index stays small");
  assert.equal(composer.sample(30).length, 30);
});

test("English vocabulary composes too", () => {
  const en = { consonants: [..."bcdfghjklmnpqrstvwxyz"], vowels: [..."aeiou"], specials: ["sh", "ch", "th", "oo", "ee", "ai", "ou"] };
  const texts = createComposer(en, "en").sample(50);
  assert.equal(texts.length, 50);
  for (const text of texts) assert.ok(classifySentence(text, en, "en").readable, text);
});

test("vocabulary keeps the kid group for names that may take 'mit Mama'", () => {
  const kids = VOCAB.de.subjects.filter((subject) => subject.g.includes("K")).map((subject) => subject.t);
  assert.ok(kids.includes("Mia") && kids.includes("Mareike"));
  assert.ok(!kids.includes("Mama") && !kids.includes("Oma"));
});

test("a sentence deck mixes composed sentences with the pool and rechecks readability", () => {
  const pool = [{ text: "Mama lernt." }, { text: "Tom malt." }, { text: "Der Hund bellt." }];
  const composed = createComposer(EARLY, "de").sample(10, createSeededRandom(3)).concat(["Der Hund bellt."]);
  const deck = buildSentenceOnlyDeck(pool, EARLY, "de", { count: 8, seed: 4, composed });
  assert.equal(deck.length, 8);
  assert.ok(deck.every((card) => card.kind === "sentence" && classifySentence(card.text, EARLY, "de").readable));
  assert.equal(new Set(deck.map((card) => card.text)).size, 8);
  assert.ok(deck.some((card) => card.text === "Mama lernt." || card.text === "Tom malt."));
  // Without composed sentences the deck is the pool's readable ones, as before.
  assert.equal(buildSentenceOnlyDeck(pool, EARLY, "de", { seed: 4 }).length, 2);
});

test("the sentence count reports the composer capacity when it exceeds the pool", () => {
  const pool = [{ text: "Mama lernt." }];
  const { sentenceCount } = computeCounts({ words: null, sentences: pool }, "de", EARLY);
  assert.ok(sentenceCount > 2000);
  assert.equal(computeCounts({ words: null, sentences: null }, "de", EARLY).sentenceCount, null);
});
