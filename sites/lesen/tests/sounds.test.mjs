import test from "node:test";
import assert from "node:assert";
import {
  CONSONANTS,
  VOWELS,
  SPECIALS,
  WORDS_MODE_THRESHOLD,
  buildCombinations,
  countMatchingWords,
  isWordsModeEligible,
} from "../static/sounds.mjs";

test("alphabets: CONSONANTS, VOWELS and SPECIALS are the expected German sets", () => {
  assert.deepStrictEqual(CONSONANTS, [..."bcdfghjklmnpqrstvwxyzß"]);
  assert.deepStrictEqual(VOWELS, [..."aeiou"]);
  assert.deepStrictEqual(SPECIALS, ["ä", "ö", "ü", "au", "ei", "ie", "eu"]);
});

test("buildCombinations: CV pattern with single-letter consonants/vowels (existing behaviour)", () => {
  const result = buildCombinations("CV", ["m", "s"], ["a", "o"]);
  assert.deepStrictEqual(result.sort(), ["ma", "mo", "sa", "so"].sort());
});

test("buildCombinations: VC pattern with single-letter consonants/vowels (existing behaviour)", () => {
  const result = buildCombinations("VC", ["m", "s"], ["a", "o"]);
  assert.deepStrictEqual(result.sort(), ["am", "om", "as", "os"].sort());
});

test("buildCombinations: CVC pattern produces three-slot combinations", () => {
  const result = buildCombinations("CVC", ["m"], ["a"]);
  assert.deepStrictEqual(result, ["mam"]);
});

test("buildCombinations: specials merged into the vowel slot act as vowel-slot fillers", () => {
  const vowelsWithSpecials = [...VOWELS, ...SPECIALS];
  const result = buildCombinations("CV", ["m"], vowelsWithSpecials);
  assert.deepStrictEqual(
    result.sort(),
    ["ma", "me", "mi", "mo", "mu", "mä", "mö", "mü", "mau", "mei", "mie", "meu"].sort(),
  );
});

test("buildCombinations: multi-character specials do not break single-letter consonant slots", () => {
  const result = buildCombinations("CV", CONSONANTS, ["au"]);
  assert.strictEqual(result.length, CONSONANTS.length);
  for (const consonant of CONSONANTS) {
    assert.ok(result.includes(`${consonant}au`));
  }
});

test("buildCombinations: empty letter list for a slot yields no combinations", () => {
  assert.deepStrictEqual(buildCombinations("CV", [], ["a"]), []);
  assert.deepStrictEqual(buildCombinations("CV", ["m"], []), []);
});

test("buildCombinations: throws on an unknown pattern slot", () => {
  assert.throws(() => buildCombinations("CX", ["m"], ["a"]));
});

test("countMatchingWords: counts words whose letters are all within the selection and within maxLength", () => {
  const words = ["Oma", "Mama", "Opa", "Tee"];
  const selection = { consonants: ["m"], vowels: ["a", "o"] };
  assert.strictEqual(countMatchingWords(words, selection, 4), 2); // Oma, Mama ("Opa" needs 'p', "Tee" needs 't'/'e')
});

test("countMatchingWords: excludes words longer than maxLength", () => {
  const words = ["oma", "mama"];
  const selection = { consonants: ["m"], vowels: ["a", "o"] };
  assert.strictEqual(countMatchingWords(words, selection, 3), 1); // only "oma"
});

test("countMatchingWords: excludes words containing a letter outside the selection", () => {
  const words = ["oma", "opa"];
  const selection = { consonants: ["m"], vowels: ["a", "o"] };
  assert.strictEqual(countMatchingWords(words, selection, 4), 1); // "opa" needs 'p'
});

test("countMatchingWords: is case-insensitive and deduplicates by lowercase spelling", () => {
  const words = ["Oma", "oma", "OMA"];
  const selection = { consonants: ["m"], vowels: ["a", "o"] };
  assert.strictEqual(countMatchingWords(words, selection, 4), 1);
});

test("countMatchingWords: ignores empty words", () => {
  const words = ["", "oma"];
  const selection = { consonants: ["m"], vowels: ["a", "o"] };
  assert.strictEqual(countMatchingWords(words, selection, 4), 1);
});

test("countMatchingWords: returns 0 for an empty word list", () => {
  const selection = { consonants: ["m"], vowels: ["a"] };
  assert.strictEqual(countMatchingWords([], selection, 4), 0);
});

test("isWordsModeEligible: exact threshold of 10 is eligible", () => {
  assert.strictEqual(WORDS_MODE_THRESHOLD, 10);
  assert.strictEqual(isWordsModeEligible(10), true);
});

test("isWordsModeEligible: one below threshold is not eligible", () => {
  assert.strictEqual(isWordsModeEligible(9), false);
});

test("isWordsModeEligible: above threshold is eligible", () => {
  assert.strictEqual(isWordsModeEligible(11), true);
});

test("isWordsModeEligible: zero is not eligible", () => {
  assert.strictEqual(isWordsModeEligible(0), false);
});
