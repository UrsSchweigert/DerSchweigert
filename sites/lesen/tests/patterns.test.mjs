import test from "node:test";
import assert from "node:assert";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CONSONANTS,
  VOWELS,
  SPECIALS,
  buildCombinations,
  buildPatternDeck,
} from "../static/sounds.mjs";

const sorted = (items) => [...items].sort();

function occurrences(items) {
  const counts = new Map();
  for (const item of items) counts.set(item, (counts.get(item) || 0) + 1);
  return counts;
}

/** Deterministic mulberry32 RNG so deck assertions are reproducible. */
function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SMALL = { consonants: ["m", "s"], vowels: ["a", "o"] };
const SMALL_CONSONANTS = SMALL.consonants;
const SMALL_VOWELS = SMALL.vowels;
const CV_POOL = buildCombinations("CV", SMALL_CONSONANTS, SMALL_VOWELS);
const VC_POOL = buildCombinations("VC", SMALL_CONSONANTS, SMALL_VOWELS);

const SUBS = ["ma", "am", "mam", "ama"];

test("buildPatternDeck: no checked sub-pattern yields an empty deck", () => {
  assert.deepStrictEqual(buildPatternDeck([], SMALL_CONSONANTS, SMALL_VOWELS, 10), []);
  assert.deepStrictEqual(buildPatternDeck(new Set(), SMALL_CONSONANTS, SMALL_VOWELS, 10), []);
});

test("buildPatternDeck: a count of 0 or less yields an empty deck", () => {
  assert.deepStrictEqual(buildPatternDeck(["ma"], SMALL_CONSONANTS, SMALL_VOWELS, 0), []);
  assert.deepStrictEqual(buildPatternDeck(["ma"], SMALL_CONSONANTS, SMALL_VOWELS, -3), []);
  assert.deepStrictEqual(buildPatternDeck(["ma"], SMALL_CONSONANTS, SMALL_VOWELS, Number.NaN), []);
});

test("buildPatternDeck: only 'ma' reproduces the CV deck multiset", () => {
  const cvPool = buildCombinations("CV", CONSONANTS, [...VOWELS, ...SPECIALS]);
  const deck = buildPatternDeck(["ma"], CONSONANTS, [...VOWELS, ...SPECIALS], cvPool.length, seededRandom(7));
  assert.strictEqual(deck.length, cvPool.length);
  assert.deepStrictEqual(sorted(deck), sorted(cvPool));
  assert.strictEqual(new Set(deck).size, deck.length);
});

test("buildPatternDeck: only 'am' reproduces the VC deck multiset", () => {
  const vcPool = buildCombinations("VC", CONSONANTS, [...VOWELS, ...SPECIALS]);
  const deck = buildPatternDeck(["am"], CONSONANTS, [...VOWELS, ...SPECIALS], vcPool.length, seededRandom(11));
  assert.strictEqual(deck.length, vcPool.length);
  assert.deepStrictEqual(sorted(deck), sorted(vcPool));
  assert.strictEqual(new Set(deck).size, deck.length);
});

test("buildPatternDeck: 'ma'/'am' use the same CV/VC combinations as buildCombinations", () => {
  const cv = buildPatternDeck(["ma"], SMALL_CONSONANTS, SMALL_VOWELS, CV_POOL.length, seededRandom(3));
  const vc = buildPatternDeck(["am"], SMALL_CONSONANTS, SMALL_VOWELS, VC_POOL.length, seededRandom(3));
  assert.deepStrictEqual(sorted(cv), sorted(CV_POOL));
  assert.deepStrictEqual(sorted(vc), sorted(VC_POOL));
});

test("buildPatternDeck: 'mam' maps to CVC and 'ama' to VCV", () => {
  const cvcPool = buildCombinations("CVC", SMALL_CONSONANTS, SMALL_VOWELS);
  const vcvPool = buildCombinations("VCV", SMALL_CONSONANTS, SMALL_VOWELS);

  const cvc = buildPatternDeck(["mam"], SMALL_CONSONANTS, SMALL_VOWELS, cvcPool.length, seededRandom(5));
  const vcv = buildPatternDeck(["ama"], SMALL_CONSONANTS, SMALL_VOWELS, vcvPool.length, seededRandom(5));

  assert.deepStrictEqual(sorted(cvc), sorted(cvcPool));
  assert.deepStrictEqual(sorted(vcv), sorted(vcvPool));
  for (const card of cvc) assert.strictEqual(card.length, 3);
  for (const card of vcv) assert.strictEqual(card.length, 3);
});

test("buildPatternDeck: all four sub-patterns yield two- and three-letter cards without duplicates", () => {
  const deck = buildPatternDeck(SUBS, SMALL_CONSONANTS, SMALL_VOWELS, 24, seededRandom(13));
  assert.strictEqual(deck.length, 24);
  assert.strictEqual(new Set(deck).size, deck.length, "every card text appears at most once");
  assert.ok(deck.some((card) => card.length === 2), "the deck contains two-letter cards");
  assert.ok(deck.some((card) => card.length === 3), "the deck contains three-letter cards");

  const allowed = new Set([
    ...buildCombinations("CV", SMALL_CONSONANTS, SMALL_VOWELS),
    ...buildCombinations("VC", SMALL_CONSONANTS, SMALL_VOWELS),
    ...buildCombinations("CVC", SMALL_CONSONANTS, SMALL_VOWELS),
    ...buildCombinations("VCV", SMALL_CONSONANTS, SMALL_VOWELS),
  ]);
  for (const card of deck) assert.ok(allowed.has(card), `${card} does not come from any checked pattern`);
});

test("buildPatternDeck: interleaves sub-patterns instead of concatenating them", () => {
  const deck = buildPatternDeck(["ma", "am"], SMALL_CONSONANTS, SMALL_VOWELS, 12, seededRandom(17));
  assert.strictEqual(deck.length, 12);
  const cvSet = new Set(CV_POOL);
  const vcSet = new Set(VC_POOL);
  deck.forEach((card, index) => {
    const expected = index % 2 === 0 ? cvSet : vcSet;
    assert.ok(expected.has(card), `card ${index} (${card}) is not interleaved as expected`);
  });
});

test("buildPatternDeck: no two neighbouring cards share a sub-pattern while both still have cards", () => {
  const deck = buildPatternDeck(SUBS, SMALL_CONSONANTS, SMALL_VOWELS, 24, seededRandom(19));
  const origin = new Map();
  for (const [sub, code] of [["ma", "CV"], ["am", "VC"], ["mam", "CVC"], ["ama", "VCV"]]) {
    for (const card of buildCombinations(code, SMALL_CONSONANTS, SMALL_VOWELS)) origin.set(card, sub);
  }
  for (let index = 1; index < deck.length; index++) {
    assert.notStrictEqual(origin.get(deck[index]), origin.get(deck[index - 1]), `cards ${index - 1} and ${index} share a sub-pattern`);
  }
});

test("buildPatternDeck: a short pool is repeated to reach the requested count", () => {
  const deck = buildPatternDeck(["ma"], ["m", "s"], ["a"], 5, seededRandom(23));
  assert.strictEqual(deck.length, 5);
  for (const card of deck) assert.ok(["ma", "sa"].includes(card));
  assert.deepStrictEqual(sorted([...occurrences(deck).values()]), [2, 3]);
  assert.deepStrictEqual(sorted([...new Set(deck)]), ["ma", "sa"]);
});

test("buildPatternDeck: repeats only after the whole pool was dealt", () => {
  const deck = buildPatternDeck(["ma"], SMALL_CONSONANTS, SMALL_VOWELS, 6, seededRandom(29));
  assert.strictEqual(deck.length, 6);
  for (const card of deck) assert.ok(CV_POOL.includes(card));
  assert.deepStrictEqual(sorted([...occurrences(deck).values()]), [1, 1, 2, 2]);
});

test("buildPatternDeck: shuffles the deck deterministically for a given RNG", () => {
  const pool = buildCombinations("CV", CONSONANTS, VOWELS);
  const first = buildPatternDeck(["ma"], CONSONANTS, VOWELS, 10, seededRandom(31));
  const second = buildPatternDeck(["ma"], CONSONANTS, VOWELS, 10, seededRandom(31));
  const third = buildPatternDeck(["ma"], CONSONANTS, VOWELS, 10, seededRandom(37));

  assert.deepStrictEqual(first, second, "the same seed produces the same deck");
  assert.notDeepStrictEqual(first, third, "a different seed produces a different deck");
  assert.notDeepStrictEqual(first, pool.slice(0, 10), "the deck is not simply the pool order");
});

test("buildPatternDeck: duplicate sub-pattern ids do not duplicate cards", () => {
  const deck = buildPatternDeck(["ma", "ma"], SMALL_CONSONANTS, SMALL_VOWELS, CV_POOL.length, seededRandom(41));
  assert.strictEqual(deck.length, CV_POOL.length);
  assert.deepStrictEqual(sorted(deck), sorted(CV_POOL));
});

test("buildPatternDeck: specials fill the vowel slot like the setup screen does", () => {
  const deck = buildPatternDeck(["ma"], ["m"], ["a", "au"], 2, seededRandom(43));
  assert.deepStrictEqual(sorted(deck), ["ma", "mau"]);
});

test("buildPatternDeck: throws on an unknown sub-pattern", () => {
  assert.throws(() => buildPatternDeck(["cx"], SMALL_CONSONANTS, SMALL_VOWELS, 5), /Unknown sub-pattern/);
});

test("buildCombinations lives only in sounds.mjs and index.html uses the imported module", async () => {
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
  const soundsSource = await readFile(path.join(root, "static", "sounds.mjs"), "utf8");
  const htmlSource = await readFile(path.join(root, "static", "index.html"), "utf8");

  assert.strictEqual(
    (soundsSource.match(/function buildCombinations\b/g) || []).length,
    1,
    "sounds.mjs should define buildCombinations exactly once",
  );
  assert.ok(
    !/function buildCombinations\b/.test(htmlSource),
    "index.html must not keep an inline buildCombinations copy",
  );
  assert.match(htmlSource, /import \{[^}]*\bbuildCombinations\b[^}]*\} from '\.\/sounds\.mjs'/);
  assert.match(htmlSource, /\bbuildCombinations\(/);
});

test("setup markup: one PATTERNS radio with ma/am/mam/ama checkboxes", async () => {
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
  const htmlSource = await readFile(path.join(root, "static", "index.html"), "utf8");
  const markup = htmlSource.split("<script")[0];

  assert.strictEqual((markup.match(/<input[^>]*name="pattern"/g) || []).length, 3, "expected PATTERNS, WORDS and FLOP radios");
  assert.strictEqual((markup.match(/<input[^>]*value="PATTERNS"/g) || []).length, 1);
  assert.ok(!/value="CV"/.test(markup), "the CV radio value must be gone");
  assert.ok(!/value="VC"/.test(markup), "the VC radio value must be gone");
  assert.strictEqual((markup.match(/<input[^>]*name="subpattern"/g) || []).length, 4);
  for (const sub of SUBS) {
    assert.match(markup, new RegExp(`name="subpattern" value="${sub}"`));
  }
  assert.match(markup, /name="subpattern" value="ma"\s+checked/);
  assert.match(markup, /name="subpattern" value="am"\s+checked/);
  assert.match(htmlSource, /tr\('setup\.error\.no_pattern'\)/);
});
