import test from "node:test";
import assert from "node:assert";
import {
  CONSONANTS,
  VOWELS,
  SPECIALS,
  WORDS_MODE_THRESHOLD,
  buildCombinations,
  tokenizeWord,
  countMatchingWords,
  isWordsModeEligible,
} from "../static/sounds.mjs";

test("alphabets: CONSONANTS, VOWELS and SPECIALS are the expected German sets", () => {
  assert.deepStrictEqual(CONSONANTS, [..."bcdfghjklmnpqrstvwxyzß"]);
  assert.deepStrictEqual(VOWELS, [..."aeiou"]);
  assert.deepStrictEqual(SPECIALS, ["ä", "ö", "ü", "au", "ei", "ie", "eu", "sch", "ch", "st", "ai", "xx"]);
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
    ["ma", "me", "mi", "mo", "mu", "mä", "mö", "mü", "mau", "mei", "mie", "meu", "msch", "mch", "mst", "mai", "mxx"].sort(),
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

test("tokenizeWord: splits a plain word into single-character units when no specials apply", () => {
  assert.deepStrictEqual(tokenizeWord("oma", SPECIALS), ["o", "m", "a"]);
});

test("tokenizeWord: takes a special left to right as soon as the word continues with it", () => {
  assert.deepStrictEqual(tokenizeWord("sau", SPECIALS), ["s", "au"]);
});

test("tokenizeWord: recognizes 'ie' as a single unit within a longer word", () => {
  assert.deepStrictEqual(tokenizeWord("tier", SPECIALS), ["t", "ie", "r"]);
});

test("tokenizeWord: an umlaut is its own unit, distinct from the plain vowel", () => {
  assert.deepStrictEqual(tokenizeWord("bär", SPECIALS), ["b", "ä", "r"]);
});

test("tokenizeWord: with an empty specials list every character is its own unit", () => {
  assert.deepStrictEqual(tokenizeWord("sau", []), ["s", "a", "u"]);
});

test("countMatchingWords: 'sau' does not match when a,u,s are selected but no special is selected", () => {
  const selection = { consonants: ["s"], vowels: ["a", "u"], specials: [] };
  assert.strictEqual(countMatchingWords(["sau"], selection, 4, SPECIALS), 0);
});

test("countMatchingWords: 'sau' matches once the 'au' special is also selected", () => {
  const selection = { consonants: ["s"], vowels: ["a", "u"], specials: ["au"] };
  assert.strictEqual(countMatchingWords(["sau"], selection, 4, SPECIALS), 1);
});

test("countMatchingWords: 'Tier' does not match with i,e,t,r selected but 'ie' unselected", () => {
  const selection = { consonants: ["t", "r"], vowels: ["i", "e"], specials: [] };
  assert.strictEqual(countMatchingWords(["Tier"], selection, 4, SPECIALS), 0);
});

test("countMatchingWords: 'Tier' matches once 'ie' is selected as a special", () => {
  const selection = { consonants: ["t", "r"], vowels: ["i", "e"], specials: ["ie"] };
  assert.strictEqual(countMatchingWords(["Tier"], selection, 4, SPECIALS), 1);
});

test("countMatchingWords: a word with umlaut 'ä' does not match unless 'ä' is selected, even with 'a' selected", () => {
  const selection = { consonants: ["b", "r"], vowels: ["a"], specials: [] };
  assert.strictEqual(countMatchingWords(["bär"], selection, 4, SPECIALS), 0);
  const withUmlaut = { consonants: ["b", "r"], vowels: ["a"], specials: ["ä"] };
  assert.strictEqual(countMatchingWords(["bär"], withUmlaut, 4, SPECIALS), 1);
});

test("countMatchingWords: specials-aware matching is case-insensitive and deduplicates by lowercase spelling", () => {
  const selection = { consonants: ["s"], vowels: ["a", "u"], specials: ["au"] };
  assert.strictEqual(countMatchingWords(["Sau", "sau", "SAU"], selection, 4, SPECIALS), 1);
});

test("countMatchingWords: an empty selection (including empty specials) matches zero words", () => {
  const selection = { consonants: [], vowels: [], specials: [] };
  assert.strictEqual(countMatchingWords(["sau", "oma", "tier"], selection, 4, SPECIALS), 0);
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

test("tokenizeWord: recognizes 'sch' as a single unit before 'ch'", () => {
  assert.deepStrictEqual(tokenizeWord("schon", SPECIALS), ["sch", "o", "n"]);
});

test("tokenizeWord: recognizes 'st' as a single unit", () => {
  assert.deepStrictEqual(tokenizeWord("stein", SPECIALS), ["st", "ei", "n"]);
});

test("tokenizeWord: recognizes 'ai' as a single unit", () => {
  assert.deepStrictEqual(tokenizeWord("mais", SPECIALS), ["m", "ai", "s"]);
});

test("tokenizeWord: recognizes 'ch' as a single unit when not preceded by 's'", () => {
  assert.deepStrictEqual(tokenizeWord("chop", SPECIALS), ["ch", "o", "p"]);
});

test("tokenizeWord: treats doubled letters as a single unit when 'xx' is in specials", () => {
  assert.deepStrictEqual(tokenizeWord("ball", SPECIALS), ["b", "a", "ll"]);
});

test("tokenizeWord: treats multiple doubled letters correctly", () => {
  assert.deepStrictEqual(tokenizeWord("bälle", SPECIALS), ["b", "ä", "ll", "e"]);
});

test("tokenizeWord: doubled letter takes precedence over single characters", () => {
  assert.deepStrictEqual(tokenizeWord("alle", SPECIALS), ["a", "ll", "e"]);
});

test("tokenizeWord: does not create doubled units for different adjacent letters", () => {
  assert.deepStrictEqual(tokenizeWord("ball", []), ["b", "a", "l", "l"]);
});

test("tokenizeWord: handles consecutive doubled pairs (e.g., 'aa' followed by 'bb')", () => {
  assert.deepStrictEqual(tokenizeWord("aabb", SPECIALS), ["aa", "bb"]);
});

test("countMatchingWords: 'ball' does not match with b,a,l selected but 'xx' unselected", () => {
  const selection = { consonants: ["b"], vowels: ["a"], specials: [] };
  assert.strictEqual(countMatchingWords(["ball"], selection, 4, SPECIALS), 0);
});

test("countMatchingWords: 'ball' matches once 'xx' is selected", () => {
  const selection = { consonants: ["b"], vowels: ["a"], specials: ["xx"] };
  assert.strictEqual(countMatchingWords(["ball"], selection, 4, SPECIALS), 1);
});

test("countMatchingWords: 'bälle' matches with ä and 'xx' selected", () => {
  const selection = { consonants: ["b"], vowels: ["e"], specials: ["ä", "xx"] };
  assert.strictEqual(countMatchingWords(["bälle"], selection, 5, SPECIALS), 1);
});

test("countMatchingWords: 'schon' matches with sch and s,o,n selected", () => {
  const selection = { consonants: ["s", "n"], vowels: ["o"], specials: ["sch"] };
  assert.strictEqual(countMatchingWords(["schon"], selection, 5, SPECIALS), 1);
});

test("countMatchingWords: 'mais' matches with ai selected", () => {
  const selection = { consonants: ["m", "s"], vowels: ["i"], specials: ["ai"] };
  assert.strictEqual(countMatchingWords(["mais"], selection, 4, SPECIALS), 1);
});

test("countMatchingWords: 'stein' matches with st and ei selected", () => {
  const selection = { consonants: ["s", "t", "n"], vowels: ["i"], specials: ["st", "ei"] };
  assert.strictEqual(countMatchingWords(["stein"], selection, 5, SPECIALS), 1);
});
