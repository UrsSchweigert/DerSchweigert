import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  unitsOf,
  classifyWord,
  coverageOfTypes,
  readableSentenceShare,
} from "../static/coverage.mjs";
import { getSoundsForLanguage } from "../static/sounds.mjs";

test("unitsOf: greedy specials win over single letters", () => {
  assert.deepEqual(unitsOf("schon", "de"), ["sch", "o", "n"]);
  assert.deepEqual(unitsOf("auf", "de"), ["au", "f"]);
  assert.deepEqual(unitsOf("Straße", "de"), ["st", "r", "a", "ß", "e"]);
  assert.deepEqual(unitsOf("Eichhörnchen", "de"), ["ei", "ch", "h", "ö", "r", "n", "ch", "e", "n"]);
});

test("unitsOf: doubled letters become one unit when the language has the xx sentinel", () => {
  assert.deepEqual(unitsOf("kommt", "de"), ["k", "o", "mm", "t"]);
  assert.deepEqual(unitsOf("Bett", "de"), ["b", "e", "tt"]);
  assert.deepEqual(unitsOf("happy", "de"), ["h", "a", "pp", "y"]);
});

test("unitsOf: English splits its own digraphs and keeps doubled letters apart", () => {
  assert.deepEqual(unitsOf("said", "en"), ["s", "ai", "d"]);
  assert.deepEqual(unitsOf("you", "en"), ["y", "ou"]);
  assert.deepEqual(unitsOf("moon", "en"), ["m", "oo", "n"]);
  assert.deepEqual(unitsOf("happy", "en"), ["h", "a", "p", "p", "y"]);
});

test("unitsOf: is case-insensitive and handles the empty word", () => {
  assert.deepEqual(unitsOf("Mama", "de"), ["m", "a", "m", "a"]);
  assert.deepEqual(unitsOf(""), []);
});

test("classifyWord: a word with every unit selected is readable and misses nothing", () => {
  const selection = { consonants: [..."m"], vowels: [..."a"], specials: [] };
  assert.deepEqual(classifyWord("Mama", selection), { readable: true, missing: [] });
});

test("classifyWord: reports the missing units in order of first appearance", () => {
  const selection = { consonants: [..."m"], vowels: [..."a"], specials: [] };
  assert.deepEqual(classifyWord("Oma", selection), { readable: false, missing: ["o"] });
  assert.deepEqual(classifyWord("Eichhörnchen", { consonants: [], vowels: ["e"], specials: [] }), {
    readable: false,
    missing: ["ei", "ch", "h", "ö", "r", "n"],
  });
});

test("classifyWord: never calls a word readable while a unit is missing", () => {
  const selection = { consonants: [..."ml"], vowels: [..."aei"], specials: [] };
  for (const word of ["Mama", "Oma", "liest", "Bett", "schon", "Eichhörnchen", "Straße"]) {
    const result = classifyWord(word, selection);
    assert.equal(result.readable, result.missing.length === 0, word);
  }
});

test("classifyWord: xx makes doubled-letter units readable", () => {
  const withXx = { consonants: [..."kmt"], vowels: [..."o"], specials: ["xx"] };
  const withoutXx = { consonants: [..."kmt"], vowels: [..."o"], specials: [] };
  assert.deepEqual(classifyWord("kommt", withXx), { readable: true, missing: [] });
  assert.deepEqual(classifyWord("kommt", withoutXx), { readable: false, missing: ["mm"] });
});

test("coverageOfTypes: an empty selection covers nothing", () => {
  assert.deepEqual(coverageOfTypes("Mama mag Oma.", {}), { tokens: 0, types: 0 });
  assert.deepEqual(coverageOfTypes("Mama mag Oma.", { consonants: [], vowels: [], specials: [] }), {
    tokens: 0,
    types: 0,
  });
});

test("coverageOfTypes: every unit of the language covers everything", () => {
  const sounds = getSoundsForLanguage("de");
  assert.deepEqual(coverageOfTypes("Mama mag Oma. Schon kommt das Eichhörnchen!", sounds), {
    tokens: 1,
    types: 1,
  });
});

test("coverageOfTypes: reports token and type fractions separately", () => {
  const selection = { consonants: [..."m"], vowels: [..."a"], specials: [] };
  // "Mama mag Oma." -> tokens: mama (readable), mag (needs g), oma (needs o)
  assert.deepEqual(coverageOfTypes("Mama mag Oma.", selection), {
    tokens: 1 / 3,
    types: 1 / 3,
  });
  // Repeated unreadable tokens lower token coverage but not type coverage.
  assert.deepEqual(coverageOfTypes("Mama mag mag.", selection), {
    tokens: 1 / 3,
    types: 1 / 2,
  });
});

test("coverageOfTypes: ignores punctuation and digits and is case-insensitive", () => {
  const selection = { consonants: [..."m"], vowels: [..."a"], specials: [] };
  assert.deepEqual(coverageOfTypes("MAMA, mag! 42", selection), { tokens: 0.5, types: 0.5 });
  assert.deepEqual(coverageOfTypes("", selection), { tokens: 0, types: 0 });
});

test("coverageOfTypes: adding a unit never lowers token or type coverage", () => {
  const text = "Mama mag Oma. Schon kommt das Eichhörnchen über die Straße.";
  const consonants = [..."mgschtdrhbklpfnß"];
  const vowels = [..."aoeiu"];
  const specials = ["xx", "au", "ei", "ie", "eu", "sch", "ch", "st", "ai", "ä", "ö", "ü"];
  const selection = { consonants: [], vowels: [], specials: [] };
  let previous = coverageOfTypes(text, selection);
  for (const [unit, bucket] of [
    ...consonants.map((unit) => [unit, "consonants"]),
    ...vowels.map((unit) => [unit, "vowels"]),
    ...specials.map((unit) => [unit, "specials"]),
  ]) {
    selection[bucket].push(unit);
    const current = coverageOfTypes(text, selection);
    assert.ok(current.tokens >= previous.tokens, "token coverage dropped after adding " + unit);
    assert.ok(current.types >= previous.types, "type coverage dropped after adding " + unit);
    previous = current;
  }
  assert.deepEqual(previous, { tokens: 1, types: 1 });
});

test("readableSentenceShare: counts only sentences that are readable in full", () => {
  const pool = ["Mama malt.", "Oma liest.", "Das Eichhörnchen sammelt Nüsse."];
  const selection = { consonants: [..."mlt"], vowels: [..."a"], specials: [] };
  // "Mama malt." is fully readable; the other two need units outside the selection.
  assert.equal(readableSentenceShare(pool, selection), 1 / 3);
});

test("readableSentenceShare: accepts pool entries with a text field", () => {
  const pool = [{ id: "de-001", text: "Mama malt." }, { id: "de-002", text: "Oma liest." }];
  const selection = { consonants: [..."mlt"], vowels: [..."a"], specials: [] };
  assert.equal(readableSentenceShare(pool, selection), 0.5);
});

test("readableSentenceShare: 0 for an empty pool or empty selection and 1 for every unit", () => {
  const pool = ["Mama malt.", "Oma liest."];
  assert.equal(readableSentenceShare([], { consonants: [..."m"], vowels: [..."a"] }), 0);
  assert.equal(readableSentenceShare(pool, {}), 0);
  assert.equal(readableSentenceShare(pool, getSoundsForLanguage("de")), 1);
});

test("the module is pure: it imports only the tokenizer and touches no browser or network globals", () => {
  const source = readFileSync(new URL("../static/coverage.mjs", import.meta.url), "utf8");
  const imports = [...source.matchAll(/^import\s+.*?from\s+["']([^"']+)["'];/gm)].map((match) => match[1]);
  assert.deepEqual(imports, ["./sounds.mjs"]);
  for (const forbidden of ["document", "window", "localStorage", "sessionStorage", "fetch(", "XMLHttpRequest", "indexedDB"]) {
    assert.ok(!source.includes(forbidden), "coverage.mjs must not reference " + forbidden);
  }
});
