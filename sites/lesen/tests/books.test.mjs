import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  wordsOf,
  unitsOf,
  selectedUnits,
  unitMaskOf,
  selectionMask,
  wordMask,
  classifyWord,
  coverageOfTypes,
  readableSentenceShare,
  buildCoverageTable,
  serializeTable,
  parseTable,
} from "../static/books.mjs";
import { tokenizeWord } from "../static/sounds.mjs";

// ---------------------------------------------------------------------------
// Hand-written constants. These pin the language alphabets and the reference
// selections of section 5.2 (S0-S3) so the tests below never depend on the
// module under test to produce their own expected values.
// ---------------------------------------------------------------------------

const DE_CONS = [..."bcdfghjklmnpqrstvwxyzß"];
const DE_VOW = [..."aeiou"];
const DE_SPECIALS = ["ä", "ö", "ü", "au", "ei", "ie", "eu", "sch", "ch", "st", "ai", "xx"];
const DE_UNITS = [...DE_CONS, ...DE_VOW, ...DE_SPECIALS];

const EN_CONS = [..."bcdfghjklmnpqrstvwxyz"];
const EN_VOW = [..."aeiou"];
const EN_SPECIALS = ["sh", "ch", "th", "oo", "ee", "ai", "ou"];
const EN_UNITS = [...EN_CONS, ...EN_VOW, ...EN_SPECIALS];

// Reference selections: S0 (nothing) -> S3 (everything -> exactly 100 %).
const S0 = { language: "de", consonants: [], vowels: [], specials: [] };
const S1 = { language: "de", consonants: [..."mstpn"], vowels: [..."aeo"], specials: [] };
const S2 = { language: "de", consonants: DE_CONS, vowels: DE_VOW, specials: [] };
const S3 = { language: "de", consonants: DE_CONS, vowels: DE_VOW, specials: DE_SPECIALS };

// A tiny synthetic fixture book (one prose paragraph, one verse paragraph,
// ~30 words, obviously invented). It exists only to pin the tokenizer.
const FIXTURE_SENTENCES = [
  "Die Maus mag Mais und ein Ei.",
  "Der Ball rollt im Hof.",
  "Oma ist am Ofen.",
  "Im Mai ist es warm,",
  "die Sonne scheint am Morgen.",
];

// Expected counts for the fixture, computed by hand (see tokenization notes
// below each word): 26 tokens across 22 distinct word types.
const FIXTURE_TOKENS = 26;
const FIXTURE_TYPES = 22;

// Hand-computed coverage of the fixture for S0-S3, as readable/total.
//   S0: nothing selected.
//   S1: consonants m,s,t,p,n + vowels a,e,o -> "am"(x2), "es", "oma".
//   S2: all single letters, no specials -> every word without a special or a
//       doubled letter (13 tokens / 11 types, exactly half).
//   S3: everything -> 100 %.
const FIXTURE_COVERAGE = {
  S0: { tokens: [0, FIXTURE_TOKENS], types: [0, FIXTURE_TYPES] },
  S1: { tokens: [4, FIXTURE_TOKENS], types: [3, FIXTURE_TYPES] },
  S2: { tokens: [13, FIXTURE_TOKENS], types: [11, FIXTURE_TYPES] },
  S3: { tokens: [FIXTURE_TOKENS, FIXTURE_TOKENS], types: [FIXTURE_TYPES, FIXTURE_TYPES] },
};

/** OR the bit masks of the named units (an independent mask computation). */
function maskOf(units, ...which) {
  let mask = 0n;
  for (const unit of which) mask |= 1n << BigInt(units.indexOf(unit));
  return mask;
}

/** Coverage over the *expanded* word list, using only classifyWord. */
function coverageFromExpanded(table, selection) {
  const distinct = new Set();
  const readableDistinct = new Set();
  let totalTokens = 0;
  let readableTokens = 0;
  for (const row of table.words) {
    distinct.add(row.w);
    const readable = classifyWord(row.w, selection).readable;
    if (readable) readableDistinct.add(row.w);
    for (let i = 0; i < row.n; i++) {
      totalTokens += 1;
      if (readable) readableTokens += 1;
    }
  }
  return {
    tokens: totalTokens === 0 ? 0 : readableTokens / totalTokens,
    types: distinct.size === 0 ? 0 : readableDistinct.size / distinct.size,
  };
}

/** Share of sentences without an adult word, by re-classifying the texts. */
function directReadableShare(sentences, selection) {
  if (sentences.length === 0) return 0;
  let readable = 0;
  for (const sentence of sentences) {
    const words = wordsOf(sentence);
    if (words.length > 0 && words.every((word) => classifyWord(word, selection).readable)) {
      readable += 1;
    }
  }
  return readable / sentences.length;
}

const FIXTURE_TABLE = buildCoverageTable("de", FIXTURE_SENTENCES);

// ---------------------------------------------------------------------------
// unitsOf
// ---------------------------------------------------------------------------

test("unitsOf: returns the German unit list, specials last, including greedy specials and xx", () => {
  assert.deepEqual(unitsOf(S3), DE_UNITS);
  // multi-letter specials are included, and the doubled-letter sentinel too
  for (const special of ["ä", "ö", "ü", "au", "ei", "ie", "eu", "sch", "ch", "st", "ai", "xx"]) {
    assert.ok(DE_UNITS.includes(special), `missing ${special}`);
  }
  // 'sch' is ordered before 'ch' so the tokenizer's greedy left-to-right scan
  // still matches the mask order (the order itself is fixed, not greedy).
  assert.ok(DE_UNITS.indexOf("sch") < DE_UNITS.indexOf("ch"));
});

test("unitsOf: returns the English unit list", () => {
  assert.deepEqual(unitsOf({ language: "en" }), EN_UNITS);
});

test("unitsOf: a selection without language defaults to German", () => {
  assert.deepEqual(unitsOf({ consonants: [], vowels: [], specials: [] }), DE_UNITS);
});

test("unitMaskOf: maps index 0 to 1n and the last German unit (xx) to bit 38", () => {
  assert.strictEqual(unitMaskOf("b", DE_UNITS), 1n);
  // German has 22 consonants + 5 vowels + 12 specials = 39 units; 'xx' is the
  // final special, so its index is 38.
  assert.strictEqual(DE_UNITS.length, 39);
  assert.strictEqual(unitMaskOf("xx", DE_UNITS), 1n << 38n);
});

test("selectionMask: empty selection has mask 0n, full selection has every unit", () => {
  assert.strictEqual(selectionMask(S0, DE_UNITS), 0n);
  assert.strictEqual(selectionMask(S3, DE_UNITS), (1n << 39n) - 1n);
});

// ---------------------------------------------------------------------------
// classifyWord
// ---------------------------------------------------------------------------

test("classifyWord: auf stays adult until au is selected", () => {
  const without = classifyWord("auf", { language: "de", consonants: ["f"], vowels: ["a", "u"], specials: [] });
  assert.deepEqual(without, { readable: false, missing: ["au"] });
  const withAu = classifyWord("auf", { language: "de", consonants: ["f"], vowels: ["a", "u"], specials: ["au"] });
  assert.deepEqual(withAu, { readable: true, missing: [] });
});

test("classifyWord: you stays adult until ou is selected (English)", () => {
  const without = classifyWord("you", { language: "en", consonants: ["y"], vowels: ["o", "u"], specials: [] });
  assert.deepEqual(without, { readable: false, missing: ["ou"] });
  const withOu = classifyWord("you", { language: "en", consonants: ["y"], vowels: ["o", "u"], specials: ["ou"] });
  assert.deepEqual(withOu, { readable: true, missing: [] });
});

test("classifyWord: könig stays adult until ö is selected", () => {
  const without = classifyWord("könig", { language: "de", consonants: ["k", "n", "g"], vowels: ["i"], specials: [] });
  assert.deepEqual(without, { readable: false, missing: ["ö"] });
  const withOe = classifyWord("könig", { language: "de", consonants: ["k", "n", "g"], vowels: ["i"], specials: ["ö"] });
  assert.deepEqual(withOe, { readable: true, missing: [] });
});

test("classifyWord: a doubled letter needs xx, not the plain letter twice", () => {
  const ballWithout = classifyWord("ball", { language: "de", consonants: ["b"], vowels: ["a"], specials: [] });
  assert.deepEqual(ballWithout, { readable: false, missing: ["xx"] });
  const ballWith = classifyWord("ball", { language: "de", consonants: ["b"], vowels: ["a"], specials: ["xx"] });
  assert.deepEqual(ballWith, { readable: true, missing: [] });
});

test("classifyWord: a vowel-only word (Ei -> ei) needs the ei special", () => {
  const without = classifyWord("ei", { language: "de", consonants: [], vowels: ["e", "i"], specials: [] });
  assert.deepEqual(without, { readable: false, missing: ["ei"] });
  const withEi = classifyWord("ei", { language: "de", consonants: [], vowels: [], specials: ["ei"] });
  assert.deepEqual(withEi, { readable: true, missing: [] });
});

test("classifyWord: never reports a word readable while a unit is missing, and agrees with wordMask", () => {
  const words = ["die", "maus", "mag", "mais", "und", "ein", "ei", "der", "ball", "rollt", "im", "hof",
    "oma", "ist", "am", "ofen", "mai", "es", "warm", "sonne", "scheint", "morgen", "auf", "könig", "haus"];
  for (const selection of [S0, S1, S2, S3]) {
    const selMask = selectionMask(selection, DE_UNITS);
    for (const word of words) {
      const result = classifyWord(word, selection);
      assert.strictEqual(result.readable, result.missing.length === 0, `${word}: readable iff no unit missing`);
      assert.strictEqual(
        result.readable,
        (wordMask(word, DE_UNITS, DE_SPECIALS) & ~selMask) === 0n,
        `${word}: classifyWord agrees with wordMask`,
      );
    }
  }
});

test("classifyWord: tokenizes 'die' as d+ie (greedy special, not i+e)", () => {
  assert.deepEqual(tokenizeWord("die", DE_SPECIALS), ["d", "ie"]);
  const result = classifyWord("die", { language: "de", consonants: ["d"], vowels: ["i", "e"], specials: [] });
  assert.deepEqual(result, { readable: false, missing: ["ie"] });
});

// ---------------------------------------------------------------------------
// coverageOfTypes
// ---------------------------------------------------------------------------

test("coverageOfTypes: empty selection yields 0, full selection yields exactly 1", () => {
  assert.deepEqual(coverageOfTypes(FIXTURE_TABLE.words, S0), { tokens: 0, types: 0 });
  assert.strictEqual(coverageOfTypes(FIXTURE_TABLE.words, S3).tokens, 1);
  assert.strictEqual(coverageOfTypes(FIXTURE_TABLE.words, S3).types, 1);
});

test("coverageOfTypes: adding a unit never lowers either fraction", () => {
  // Grow a selection one German unit at a time and check monotonicity.
  let selection = { language: "de", consonants: [], vowels: [], specials: [] };
  let previous = coverageOfTypes(FIXTURE_TABLE.words, selection);
  for (const unit of DE_UNITS) {
    if (DE_CONS.includes(unit)) selection.consonants = [...selection.consonants, unit];
    else if (DE_VOW.includes(unit)) selection.vowels = [...selection.vowels, unit];
    else selection.specials = [...selection.specials, unit];
    const next = coverageOfTypes(FIXTURE_TABLE.words, selection);
    assert.ok(next.tokens >= previous.tokens, `tokens did not stay monotonic at ${unit}`);
    assert.ok(next.types >= previous.types, `types did not stay monotonic at ${unit}`);
    previous = next;
  }
  assert.strictEqual(previous.tokens, 1);
  assert.strictEqual(previous.types, 1);
});

test("coverageOfTypes: matches the hand-computed fixture numbers for S0-S3", () => {
  for (const name of ["S0", "S1", "S2", "S3"]) {
    const [readableTokens, totalTokens] = FIXTURE_COVERAGE[name].tokens;
    const [readableTypes, totalTypes] = FIXTURE_COVERAGE[name].types;
    const coverage = coverageOfTypes(FIXTURE_TABLE.words, { S0, S1, S2, S3 }[name]);
    assert.strictEqual(coverage.tokens, readableTokens / totalTokens, `${name} token coverage`);
    assert.strictEqual(coverage.types, readableTypes / totalTypes, `${name} type coverage`);
  }
  // S3 must be exactly 100.0 %.
  assert.strictEqual(coverageOfTypes(FIXTURE_TABLE.words, S3).tokens, 1.0);
  assert.strictEqual(coverageOfTypes(FIXTURE_TABLE.words, S3).types, 1.0);
});

// ---------------------------------------------------------------------------
// Table format: build, serialize, parse
// ---------------------------------------------------------------------------

test("buildCoverageTable: one row per distinct word with token count and unit mask", () => {
  assert.strictEqual(FIXTURE_TABLE.language, "de");
  assert.deepEqual(FIXTURE_TABLE.units, DE_UNITS);
  assert.strictEqual(FIXTURE_TABLE.words.length, FIXTURE_TYPES);
  const totalTokens = FIXTURE_TABLE.words.reduce((sum, row) => sum + row.n, 0);
  assert.strictEqual(totalTokens, FIXTURE_TOKENS);
  // every word row carries a BigInt mask and a positive token count
  for (const row of FIXTURE_TABLE.words) {
    assert.strictEqual(typeof row.w, "string");
    assert.ok(Number.isInteger(row.n) && row.n > 0);
    assert.strictEqual(typeof row.m, "bigint");
  }
  assert.strictEqual(FIXTURE_TABLE.sentences.length, FIXTURE_SENTENCES.length);
});

test("table round-trips exactly through serializeTable/parseTable", () => {
  assert.deepEqual(parseTable(serializeTable(FIXTURE_TABLE)), FIXTURE_TABLE);
});

test("coverageOfTypes over a parsed table equals coverage over the expanded word list", () => {
  const parsed = parseTable(serializeTable(FIXTURE_TABLE));
  for (const selection of [S0, S1, S2, S3]) {
    assert.deepEqual(coverageOfTypes(parsed.words, selection), coverageFromExpanded(parsed, selection));
  }
});

test("readableSentenceShare over sentence masks equals the direct count of sentences without an adult word", () => {
  for (const selection of [S0, S1, S2, S3]) {
    assert.strictEqual(
      readableSentenceShare(FIXTURE_TABLE.sentences, selection),
      directReadableShare(FIXTURE_SENTENCES, selection),
    );
  }
});

test("readableSentenceShare: empty sentence list is 0", () => {
  assert.strictEqual(readableSentenceShare([], S3), 0);
});

// ---------------------------------------------------------------------------
// Hand-computed small tables (section 6 cases)
// ---------------------------------------------------------------------------

test("hand-computed table: a word with an unselected special (Haus -> h+au+s)", () => {
  const table = buildCoverageTable("de", ["Das Haus ist alt."]);
  const haus = table.words.find((row) => row.w === "haus");
  assert.ok(haus);
  assert.strictEqual(haus.m, maskOf(DE_UNITS, "h", "au", "s"));
  const without = { language: "de", consonants: ["h", "s"], vowels: [], specials: [] };
  assert.deepEqual(coverageOfTypes([haus], without), { tokens: 0, types: 0 });
  const withAu = { language: "de", consonants: ["h", "s"], vowels: [], specials: ["au"] };
  assert.deepEqual(coverageOfTypes([haus], withAu), { tokens: 1, types: 1 });
});

test("hand-computed table: a doubled consonant with and without xx (Ball -> b+a+xx)", () => {
  const table = buildCoverageTable("de", ["Der Ball rollt."]);
  const ball = table.words.find((row) => row.w === "ball");
  const rollt = table.words.find((row) => row.w === "rollt");
  assert.ok(ball);
  assert.ok(rollt);
  assert.strictEqual(ball.m, maskOf(DE_UNITS, "b", "a", "xx"));
  assert.strictEqual(rollt.m, maskOf(DE_UNITS, "r", "o", "xx", "t"));
  const withoutXx = { language: "de", consonants: ["b", "a"], vowels: [], specials: [] };
  assert.strictEqual(classifyWord("ball", withoutXx).readable, false);
  const withXx = { language: "de", consonants: ["b"], vowels: ["a"], specials: ["xx"] };
  assert.strictEqual(classifyWord("ball", withXx).readable, true);
  assert.deepEqual(coverageOfTypes([ball], withXx), { tokens: 1, types: 1 });
});

test("hand-computed table: a vowel-only word (Ei -> ei)", () => {
  const table = buildCoverageTable("de", ["Ein Ei liegt da."]);
  const ei = table.words.find((row) => row.w === "ei");
  assert.ok(ei);
  assert.strictEqual(ei.m, maskOf(DE_UNITS, "ei"));
  assert.deepEqual(wordsOf("Ei"), ["ei"]);
  assert.strictEqual(classifyWord("ei", { language: "de", consonants: [], vowels: [], specials: [] }).readable, false);
  assert.strictEqual(classifyWord("ei", { language: "de", consonants: [], vowels: [], specials: ["ei"] }).readable, true);
});

test("a word with a foreign letter (cafê) is never readable, even with every unit selected", () => {
  const full = selectionMask(S3, DE_UNITS);
  const mask = wordMask("cafê", DE_UNITS, DE_SPECIALS);
  // The word's mask has a bit outside every possible selection mask.
  assert.notEqual(mask & ~full, 0n);
  const classification = classifyWord("cafê", S3);
  assert.deepEqual(classification, { readable: false, missing: ["ê"] });
  assert.strictEqual(coverageOfTypes([{ w: "cafê", n: 1, m: mask }], S3).tokens, 0);
  assert.strictEqual(coverageOfTypes([{ w: "cafê", n: 1, m: mask }], S3).types, 0);
});

// ---------------------------------------------------------------------------
// Purity and build wiring
// ---------------------------------------------------------------------------

test("books.mjs is pure: imports only sounds.mjs and never touches DOM/storage/network", () => {
  const source = readFileSync(new URL("../static/books.mjs", import.meta.url), "utf8");
  const imports = [...source.matchAll(/^import\s[^;]+?from\s+["']([^"']+)["']/gm)].map((m) => m[1]);
  assert.deepEqual(imports, ["./sounds.mjs"]);
  for (const forbidden of ["document", "window", "localStorage", "sessionStorage", "fetch", "XMLHttpRequest", "navigator", "navigator."]) {
    assert.ok(!source.includes(forbidden), `books.mjs references ${forbidden}`);
  }
});

test("books.mjs is imported by tools/build_books.mjs", () => {
  const source = readFileSync(new URL("../tools/build_books.mjs", import.meta.url), "utf8");
  assert.match(source, /from\s+["']\.\.\/static\/books\.mjs["']/);
  assert.match(source, /buildCoverageTable/);
});
