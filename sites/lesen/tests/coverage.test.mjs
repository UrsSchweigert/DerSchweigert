import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  unitsOf,
  classifyWord,
  classifySentence,
  sentenceUnits,
  isUnitAllowed,
  coverageOfTypes,
  readableSentenceShare,
  wordTokens,
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

test("wordTokens: hyphens, apostrophes and digits separate words", () => {
  assert.deepEqual(wordTokens("Schaukel-pferd, don't 42"), ["schaukel", "pferd", "don", "t"]);
  assert.deepEqual(wordTokens(""), []);
});

test("classifyWord: English uses its own greedy digraphs", () => {
  const withoutAi = { consonants: [..."sd"], vowels: [..."i"], specials: [] };
  const withAi = { consonants: [..."sd"], vowels: [..."i"], specials: ["ai"] };
  assert.deepEqual(classifyWord("said", withoutAi, "en"), { readable: false, missing: ["ai"] });
  assert.deepEqual(classifyWord("said", withAi, "en"), { readable: true, missing: [] });
});

test("classifyWord: accepts a Set of specials and still applies the xx rule", () => {
  const selection = { consonants: [..."kmt"], vowels: [..."o"], specials: new Set(["xx"]) };
  assert.deepEqual(classifyWord("kommt", selection), { readable: true, missing: [] });
});

test("readableSentenceShare: xx unlocks doubled-letter sentences", () => {
  const pool = ["Mama kommt.", "Oma kommt."];
  const withoutXx = { consonants: [..."mkt"], vowels: [..."oa"], specials: [] };
  const withXx = { consonants: [..."mkt"], vowels: [..."oa"], specials: ["xx"] };
  assert.equal(readableSentenceShare(pool, withoutXx), 0);
  assert.equal(readableSentenceShare(pool, withXx), 1);
});

test("readableSentenceShare: adding a unit never lowers the share", () => {
  const pool = ["Mama malt.", "Oma liest.", "Das Eichhörnchen sammelt Nüsse."];
  const selection = { consonants: [], vowels: [], specials: [] };
  let previous = readableSentenceShare(pool, selection);
  for (const [unit, bucket] of [
    ...["m", "l", "t", "s", "r", "n", "d", "h", "ch", "st", "ß"].map((unit) => [unit, "consonants"]),
    ...["a", "e", "i", "o", "u"].map((unit) => [unit, "vowels"]),
    ...["ei", "ie", "xx", "ä", "ö", "ü"].map((unit) => [unit, "specials"]),
  ]) {
    selection[bucket].push(unit);
    const current = readableSentenceShare(pool, selection);
    assert.ok(current >= previous, "sentence share dropped after adding " + unit);
    previous = current;
  }
  assert.equal(previous, 1);
});

// --- Golden values ---------------------------------------------------------
//
// The four reference selections of the requirements (S0 "erste Buchstaben",
// S1 "alle Buchstaben", S2 "Startset", S3 "alles"). S1 and S3 are derived from
// the app's sound inventory; S0 and S2 are the fixed reference table. The
// expected numbers below are hand-computed from these selections and the
// committed tokenizer, so any tokenizer or selection drift fails loudly.

const REFERENCE_STAGE_UNITS = {
  de: {
    S0: { consonants: [..."mlsrtnp"], vowels: [..."aei"], specials: [] },
    S2: {
      consonants: [..."bdfghklmnprstwz"],
      vowels: [..."aeiou"],
      specials: ["au", "ei", "ie", "eu", "ch", "sch", "st", "xx"],
    },
  },
  en: {
    S0: { consonants: [..."mlsrtnp"], vowels: [..."aei"], specials: [] },
    S2: {
      consonants: [..."bcdfghklmnprstw"],
      vowels: [..."aeiou"],
      specials: ["sh", "ch", "th", "oo", "ee", "ai", "ou", "xx"],
    },
  },
};

function referenceStages(lang) {
  const sounds = getSoundsForLanguage(lang);
  return {
    S0: REFERENCE_STAGE_UNITS[lang].S0,
    S1: { consonants: [...sounds.consonants], vowels: [...sounds.vowels], specials: [] },
    S2: REFERENCE_STAGE_UNITS[lang].S2,
    S3: {
      consonants: [...sounds.consonants],
      vowels: [...sounds.vowels],
      specials: [...sounds.specials],
    },
  };
}

// One sentence per stage, so the fixture walks the whole ladder. "ist" pins
// the greedy "st" special and "The" the greedy "th" special.
const GOLDEN = {
  de: {
    sentences: [
      "Mama malt.",
      "Das Kind antwortet.",
      "Das Brot ist frisch.",
      "Das Eichhörnchen sammelt Nüsse.",
    ],
    tokens: [
      "mama", "malt", "das", "kind", "antwortet", "das", "brot", "ist", "frisch",
      "das", "eichhörnchen", "sammelt", "nüsse",
    ],
    units: [
      ["m", "a", "l", "t"],
      ["d", "a", "s", "k", "i", "n", "t", "w", "o", "r", "e"],
      ["d", "a", "s", "b", "r", "o", "t", "i", "st", "f", "sch"],
      ["d", "a", "s", "ei", "ch", "h", "ö", "r", "n", "e", "mm", "l", "t", "ü", "ss"],
    ],
    missing: {
      S0: [
        [],
        ["d", "k", "w", "o"],
        ["d", "b", "o", "st", "f", "sch"],
        ["d", "ei", "ch", "h", "ö", "mm", "ü", "ss"],
      ],
      S1: [[], [], ["st", "sch"], ["ei", "ch", "ö", "mm", "ü", "ss"]],
      S2: [[], [], [], ["ö", "ü"]],
      S3: [[], [], [], []],
    },
    coverage: {
      S0: { tokens: 2 / 13, types: 2 / 11 },
      S1: { tokens: 8 / 13, types: 6 / 11 },
      S2: { tokens: 11 / 13, types: 9 / 11 },
      S3: { tokens: 1, types: 1 },
    },
    share: { S0: 1 / 4, S1: 2 / 4, S2: 3 / 4, S3: 1 },
  },
  en: {
    sentences: [
      "A man naps.",
      "A cat runs.",
      "The moon is bright.",
      "The fox jumps.",
    ],
    tokens: [
      "a", "man", "naps", "a", "cat", "runs", "the", "moon", "is", "bright",
      "the", "fox", "jumps",
    ],
    units: [
      ["a", "m", "n", "p", "s"],
      ["a", "c", "t", "r", "u", "n", "s"],
      ["th", "e", "m", "oo", "n", "i", "s", "b", "r", "g", "h", "t"],
      ["th", "e", "f", "o", "x", "j", "u", "m", "p", "s"],
    ],
    missing: {
      S0: [
        [],
        ["c", "u"],
        ["th", "oo", "b", "g", "h"],
        ["th", "f", "o", "x", "j", "u"],
      ],
      S1: [[], [], ["th", "oo"], ["th"]],
      S2: [[], [], [], ["x", "j"]],
      S3: [[], [], [], []],
    },
    coverage: {
      S0: { tokens: 5 / 13, types: 4 / 11 },
      S1: { tokens: 10 / 13, types: 9 / 11 },
      S2: { tokens: 11 / 13, types: 9 / 11 },
      S3: { tokens: 1, types: 1 },
    },
    share: { S0: 1 / 4, S1: 2 / 4, S2: 3 / 4, S3: 1 },
  },
};

const STAGES = ["S0", "S1", "S2", "S3"];

for (const lang of ["de", "en"]) {
  const golden = GOLDEN[lang];
  const stages = referenceStages(lang);

  test(lang + " golden: the fixture splits into exactly these word tokens", () => {
    assert.deepEqual(wordTokens(golden.sentences.join(" ")), golden.tokens);
  });

  test(lang + " golden: every sentence needs exactly these units", () => {
    assert.deepEqual(
      golden.sentences.map((text) => sentenceUnits(text, lang)),
      golden.units,
    );
  });

  test(lang + " golden: exact missing units and readable flags per stage S0-S3", () => {
    for (const stage of STAGES) {
      const selection = stages[stage];
      const classified = golden.sentences.map((text) => classifySentence(text, selection, lang));
      assert.deepEqual(classified.map((result) => result.missing), golden.missing[stage], stage + " missing units");
      assert.deepEqual(
        classified.map((result) => result.readable),
        golden.missing[stage].map((missing) => missing.length === 0),
        stage + " readable flags",
      );
    }
  });

  test(lang + " golden: exact token/type coverage and sentence share per stage S0-S3", () => {
    const text = golden.sentences.join(" ");
    for (const stage of STAGES) {
      const selection = stages[stage];
      assert.deepEqual(coverageOfTypes(text, selection, lang), golden.coverage[stage], stage + " coverage");
      assert.equal(readableSentenceShare(golden.sentences, selection, lang), golden.share[stage], stage + " share");
    }
  });
}

test("golden: classifyWord walks the ladder word by word", () => {
  const stages = referenceStages("de");
  assert.deepEqual(
    STAGES.map((stage) => classifyWord("Eichhörnchen", stages[stage], "de")),
    [
      { readable: false, missing: ["ei", "ch", "h", "ö"] },
      { readable: false, missing: ["ei", "ch", "ö"] },
      { readable: false, missing: ["ö"] },
      { readable: true, missing: [] },
    ],
  );
  // "ist" is one "st" unit, not "s" + "t", even when "st" is not selected.
  assert.deepEqual(classifyWord("ist", stages.S1, "de"), { readable: false, missing: ["st"] });
  assert.deepEqual(unitsOf("ist", "de"), ["i", "st"]);
});

test("golden: isUnitAllowed pins the xx rule and the prebuilt allowed set", () => {
  assert.equal(isUnitAllowed("m", { consonants: ["m"] }), true);
  assert.equal(isUnitAllowed("m", {}), false);
  assert.equal(isUnitAllowed("mm", { consonants: ["m"] }), false);
  assert.equal(isUnitAllowed("mm", { consonants: ["m"], specials: ["xx"] }), true);
  assert.equal(isUnitAllowed("sch", { specials: ["sch"] }), true);
  assert.equal(isUnitAllowed("sch", getSoundsForLanguage("de")), true);
  assert.equal(isUnitAllowed("sch", {}, new Set(["sch"])), true);
});

// --- The committed pool ----------------------------------------------------
//
// The same metric must hold for all 1000 sentences of each language, not only
// for the fixture: every unit reads everything, nothing reads with an empty
// selection, and adding a unit never lowers coverage.

function loadPool(lang) {
  return JSON.parse(readFileSync(new URL("../static/sentences/" + lang + ".json", import.meta.url), "utf8"));
}

for (const lang of ["de", "en"]) {
  test(lang + ": selecting every unit reads all 1000 pool sentences", () => {
    const pool = loadPool(lang);
    const sounds = getSoundsForLanguage(lang);
    assert.equal(pool.sentences.length, 1000);
    assert.equal(readableSentenceShare(pool.sentences, sounds, lang), 1);
    const unreadable = pool.sentences
      .filter((entry) => !classifySentence(entry.text, sounds, lang).readable)
      .map((entry) => entry.id);
    assert.deepEqual(unreadable, []);
  });

  test(lang + ": an empty selection reads none of the pool", () => {
    const pool = loadPool(lang);
    assert.equal(readableSentenceShare(pool.sentences, {}, lang), 0);
    const readable = pool.sentences.filter((entry) => classifySentence(entry.text, {}, lang).readable);
    assert.equal(readable.length, 0);
  });

  test(lang + ": adding a unit never lowers coverage over the pool", () => {
    const pool = loadPool(lang);
    const sounds = getSoundsForLanguage(lang);
    const text = pool.sentences.map((entry) => entry.text).join(" ");
    const selection = { consonants: [], vowels: [], specials: [] };
    let share = readableSentenceShare(pool.sentences, selection, lang);
    let coverage = coverageOfTypes(text, selection, lang);
    assert.equal(share, 0);
    assert.deepEqual(coverage, { tokens: 0, types: 0 });

    const additions = [
      ...sounds.consonants.map((unit) => [unit, "consonants"]),
      ...sounds.vowels.map((unit) => [unit, "vowels"]),
      ...sounds.specials.map((unit) => [unit, "specials"]),
    ];
    for (const [unit, bucket] of additions) {
      selection[bucket].push(unit);
      const nextShare = readableSentenceShare(pool.sentences, selection, lang);
      const nextCoverage = coverageOfTypes(text, selection, lang);
      assert.ok(nextShare >= share, lang + ": sentence share dropped after adding " + unit);
      assert.ok(nextCoverage.tokens >= coverage.tokens, lang + ": token coverage dropped after adding " + unit);
      assert.ok(nextCoverage.types >= coverage.types, lang + ": type coverage dropped after adding " + unit);
      share = nextShare;
      coverage = nextCoverage;
    }
    assert.equal(share, 1);
    assert.deepEqual(coverage, { tokens: 1, types: 1 });
  });
}
