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

const SITE_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const TEST_SOURCE = fileURLToPath(import.meta.url);

const sorted = (items) => [...items].sort();

function occurrences(items) {
  const counts = new Map();
  for (const item of items) counts.set(item, (counts.get(item) || 0) + 1);
  return counts;
}

/** Assert that `actual` is a cut of `pool`: no card outside it, no over-use. */
function assertCutOfPool(actual, pool, message) {
  const available = occurrences(pool);
  for (const [card, count] of occurrences(actual)) {
    const inPool = available.get(card) || 0;
    assert.ok(inPool > 0, `${message}: "${card}" is not part of the expected pool`);
    assert.ok(count <= inPool, `${message}: "${card}" appears ${count} times but the pool holds ${inPool}`);
  }
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

const VOWEL_SLOTS = [...VOWELS, ...SPECIALS];
const SMALL_CONSONANTS = ["m", "s"];
const SMALL_VOWELS = ["a", "o"];
const SUBS = ["ma", "am", "mam", "ama"];
const SUB_PATTERN_CODES = { ma: "CV", am: "VC", mam: "CVC", ama: "VCV" };

/** Expected pools derived from buildCombinations, never copied by hand. */
function expectedPools(patternIds, consonants, vowels) {
  const pools = new Map();
  for (const pattern of patternIds) {
    pools.set(pattern, buildCombinations(SUB_PATTERN_CODES[pattern], consonants, vowels));
  }
  return pools;
}

test("buildPatternDeck: 'ma' reproduces the CV pool and 'am' the VC pool", () => {
  for (const [sub, code] of [["ma", "CV"], ["am", "VC"]]) {
    const pool = buildCombinations(code, CONSONANTS, VOWEL_SLOTS);
    const deck = buildPatternDeck([sub], CONSONANTS, VOWEL_SLOTS, pool.length, seededRandom(7));
    assert.strictEqual(deck.length, pool.length);
    assert.deepStrictEqual(sorted(deck), sorted(pool), `${sub} should be a permutation of the ${code} pool`);
    assert.strictEqual(new Set(deck).size, deck.length, `${sub} should not repeat a card`);
  }
});

test("buildPatternDeck: a partial 'ma'/'am' deck is a repeat-free cut of the CV/VC pool", () => {
  for (const [sub, code] of [["ma", "CV"], ["am", "VC"]]) {
    const pool = buildCombinations(code, CONSONANTS, VOWEL_SLOTS);
    const deck = buildPatternDeck([sub], CONSONANTS, VOWEL_SLOTS, 10, seededRandom(101));
    assert.strictEqual(deck.length, 10);
    assert.strictEqual(new Set(deck).size, deck.length, `${sub} should not repeat before the pool is exhausted`);
    assertCutOfPool(deck, pool, `${sub} partial deck`);
  }
});

test("buildPatternDeck: 'mam' yields only three-letter cards and 'ma'+'am' only two-letter cards", () => {
  const cvcPool = buildCombinations("CVC", SMALL_CONSONANTS, SMALL_VOWELS);
  const cvc = buildPatternDeck(["mam"], SMALL_CONSONANTS, SMALL_VOWELS, cvcPool.length, seededRandom(5));
  assert.strictEqual(cvc.length, cvcPool.length);
  for (const card of cvc) assert.strictEqual(card.length, 3, `${card} is not a three-letter card`);
  assert.deepStrictEqual(sorted(cvc), sorted(cvcPool), "'mam' should be a permutation of the CVC pool");

  const vcv = buildPatternDeck(["ama"], SMALL_CONSONANTS, SMALL_VOWELS, 8, seededRandom(5));
  assert.strictEqual(vcv.length, 8);
  for (const card of vcv) assert.strictEqual(card.length, 3, `${card} is not a three-letter card`);
  assert.deepStrictEqual(
    sorted(vcv),
    sorted(buildCombinations("VCV", SMALL_CONSONANTS, SMALL_VOWELS)),
    "'ama' should be a permutation of the VCV pool",
  );

  const twoLetter = buildPatternDeck(["ma", "am"], SMALL_CONSONANTS, SMALL_VOWELS, 8, seededRandom(5));
  assert.strictEqual(twoLetter.length, 8);
  for (const card of twoLetter) assert.strictEqual(card.length, 2, `${card} is not a two-letter card`);
  const cvAndVc = [
    ...buildCombinations("CV", SMALL_CONSONANTS, SMALL_VOWELS),
    ...buildCombinations("VC", SMALL_CONSONANTS, SMALL_VOWELS),
  ];
  assert.deepStrictEqual(sorted(twoLetter), sorted(cvAndVc));
});

test("buildPatternDeck: all four patterns produce the union pool without duplicate card text", () => {
  const pools = expectedPools(SUBS, SMALL_CONSONANTS, SMALL_VOWELS);
  const union = [...pools.values()].flat();
  const deck = buildPatternDeck(SUBS, SMALL_CONSONANTS, SMALL_VOWELS, union.length, seededRandom(13));

  assert.strictEqual(deck.length, union.length);
  assert.strictEqual(new Set(deck).size, deck.length, "every card text appears at most once");
  assert.deepStrictEqual(sorted(deck), sorted(union), "the deck is exactly the union of the checked pools");
});

test("buildPatternDeck: interleaves the patterns and starts with two different ones", () => {
  const origin = new Map();
  for (const [pattern, cards] of expectedPools(SUBS, SMALL_CONSONANTS, SMALL_VOWELS)) {
    for (const card of cards) origin.set(card, pattern);
  }
  const deck = buildPatternDeck(SUBS, SMALL_CONSONANTS, SMALL_VOWELS, 24, seededRandom(19));

  assert.strictEqual(deck.length, 24);
  assert.notStrictEqual(origin.get(deck[0]), origin.get(deck[1]), "the first two cards must come from different patterns");
  for (let index = 1; index < deck.length; index++) {
    assert.notStrictEqual(
      origin.get(deck[index]),
      origin.get(deck[index - 1]),
      `cards ${index - 1} and ${index} share a pattern`,
    );
  }
});

test("buildPatternDeck: a count above the pool size repeats the whole pool and returns exactly count cards", () => {
  const pool = buildCombinations("CV", SMALL_CONSONANTS, SMALL_VOWELS);
  const count = pool.length + 3;
  const deck = buildPatternDeck(["ma"], SMALL_CONSONANTS, SMALL_VOWELS, count, seededRandom(103));

  assert.strictEqual(deck.length, count);
  assert.deepStrictEqual(sorted(deck.slice(0, pool.length)), sorted(pool), "the whole pool is dealt before anything repeats");
  const counts = [...occurrences(deck).values()];
  assert.strictEqual(counts.length, pool.length, "every pool card is used");
  assert.deepStrictEqual(
    sorted(counts),
    sorted([...Array(count - pool.length).fill(2), ...Array(pool.length * 2 - count).fill(1)]),
  );
});

test("buildPatternDeck: an empty pattern selection yields an empty deck", () => {
  assert.deepStrictEqual(buildPatternDeck([], SMALL_CONSONANTS, SMALL_VOWELS, 10), []);
  assert.deepStrictEqual(buildPatternDeck(new Set(), SMALL_CONSONANTS, SMALL_VOWELS, 10), []);
});

test("setup guard: an empty sub-pattern selection disables start and reports the missing selection", async () => {
  const htmlSource = await readFile(path.join(SITE_ROOT, "static", "index.html"), "utf8");

  assert.match(
    htmlSource,
    /function selectedSubPatterns\(\)\s*\{\s*return \[\.\.\.document\.querySelectorAll\('input\[name="subpattern"\]:checked'\)\]/,
    "the guard must read the checked sub-patterns",
  );
  assert.match(
    htmlSource,
    /const missingSubPattern = pattern === 'PATTERNS' && selectedSubPatterns\(\)\.length === 0;/,
    "the guard must treat an empty sub-pattern selection as missing",
  );
  assert.match(
    htmlSource,
    /byId\('start-button'\)\.disabled = startLoading \|\| missingSubPattern;/,
    "the missing selection must disable the start button",
  );
  assert.match(
    htmlSource,
    /byId\('setup-error'\)\.textContent = tr\('setup\.error\.no_pattern'\);/,
    "the missing selection must be reported to the player",
  );
});

test("buildPatternDeck: the same seed yields the same deck and a different seed another one", () => {
  const first = buildPatternDeck(["ma"], CONSONANTS, VOWELS, 10, seededRandom(31));
  const second = buildPatternDeck(["ma"], CONSONANTS, VOWELS, 10, seededRandom(31));
  const third = buildPatternDeck(["ma"], CONSONANTS, VOWELS, 10, seededRandom(37));

  assert.deepStrictEqual(first, second, "the same seed produces the same deck");
  assert.notDeepStrictEqual(first, third, "a different seed produces a different deck");
  assert.notDeepStrictEqual(first, buildCombinations("CV", CONSONANTS, VOWELS).slice(0, 10), "the deck is not simply the pool order");
});

test("buildPatternDeck: duplicate sub-pattern ids do not duplicate cards", () => {
  const pool = buildCombinations("CV", SMALL_CONSONANTS, SMALL_VOWELS);
  const deck = buildPatternDeck(["ma", "ma"], SMALL_CONSONANTS, SMALL_VOWELS, pool.length, seededRandom(41));
  assert.strictEqual(deck.length, pool.length);
  assert.deepStrictEqual(sorted(deck), sorted(pool));
});

test("buildPatternDeck: specials fill the vowel slot like the setup screen does", () => {
  const deck = buildPatternDeck(["ma"], ["m"], ["a", "au"], 2, seededRandom(43));
  assert.deepStrictEqual(sorted(deck), ["ma", "mau"]);
});

test("buildPatternDeck: a count of 0 or less yields an empty deck", () => {
  assert.deepStrictEqual(buildPatternDeck(["ma"], SMALL_CONSONANTS, SMALL_VOWELS, 0), []);
  assert.deepStrictEqual(buildPatternDeck(["ma"], SMALL_CONSONANTS, SMALL_VOWELS, -3), []);
  assert.deepStrictEqual(buildPatternDeck(["ma"], SMALL_CONSONANTS, SMALL_VOWELS, Number.NaN), []);
});

test("buildPatternDeck: throws on an unknown sub-pattern", () => {
  assert.throws(() => buildPatternDeck(["cx"], SMALL_CONSONANTS, SMALL_VOWELS, 5), /Unknown sub-pattern/);
});

test("patterns.test.mjs imports the production builder and reimplements none of it", async () => {
  const source = await readFile(TEST_SOURCE, "utf8");

  assert.match(
    source,
    /import \{[^}]*\bbuildPatternDeck\b[^}]*\} from "\.\.\/static\/sounds\.mjs";/,
    "the test must import buildPatternDeck from sounds.mjs",
  );
  assert.ok(
    !/function\s+\w*shuffle\w*\s*\(/i.test(source),
    "the test must not reimplement the production shuffle",
  );
  assert.ok(
    !/function\s+buildCombinations\s*\(/.test(source),
    "the test must not reimplement buildCombinations",
  );
});

test("buildCombinations lives only in sounds.mjs and index.html uses the imported module", async () => {
  const soundsSource = await readFile(path.join(SITE_ROOT, "static", "sounds.mjs"), "utf8");
  const htmlSource = await readFile(path.join(SITE_ROOT, "static", "index.html"), "utf8");

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
  const htmlSource = await readFile(path.join(SITE_ROOT, "static", "index.html"), "utf8");
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
});
