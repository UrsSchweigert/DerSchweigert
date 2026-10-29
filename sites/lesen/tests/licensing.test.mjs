import test from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  EU_DEATH_YEAR_BELOW,
  US_PUBLICATION_YEAR_AT_MOST,
  VALIDATED_FOR_YEAR,
  RULES,
  RightsError,
  evaluateRights,
  assertRights,
  assertAllRights,
  convertAllWithRightsGate,
} from "../tools/licensing.mjs";

const sources = JSON.parse(
  readFileSync(new URL("../books-src/sources.json", import.meta.url), "utf8"),
);

function book(overrides = {}) {
  return {
    id: "de-test",
    authorDeathYear: 1955,
    firstPublicationYear: 1930,
    ...overrides,
  };
}

test("licensing: exports the two cutoffs and the validated year", () => {
  assert.strictEqual(EU_DEATH_YEAR_BELOW, 1956);
  assert.strictEqual(US_PUBLICATION_YEAR_AT_MOST, 1930);
  assert.strictEqual(VALIDATED_FOR_YEAR, 2026);
  assert.deepStrictEqual(RULES, {
    euDeathYearBelow: 1956,
    usPublicationYearAtMost: 1930,
    validatedForYear: 2026,
  });
});

test("licensing: the exported rules match the manifest in sources.json", () => {
  assert.deepStrictEqual(sources.rules, RULES);
});

test("licensing: accepts the exact EU boundary and refuses one year later", () => {
  const accepted = evaluateRights(book({ authorDeathYear: 1955 }));
  assert.deepStrictEqual(accepted, { ok: true, reasons: [], validatedForYear: 2026 });

  const refused = evaluateRights(book({ authorDeathYear: 1956 }));
  assert.strictEqual(refused.ok, false);
  assert.strictEqual(refused.reasons.length, 1);
  assert.match(refused.reasons[0], /de-test/);
  assert.match(refused.reasons[0], /authorDeathYear/);
  assert.match(refused.reasons[0], /1956/);
});

test("licensing: accepts the exact US boundary and refuses one year later", () => {
  assert.strictEqual(evaluateRights(book({ firstPublicationYear: 1930 })).ok, true);

  const refused = evaluateRights(book({ firstPublicationYear: 1931 }));
  assert.strictEqual(refused.ok, false);
  assert.strictEqual(refused.reasons.length, 1);
  assert.match(refused.reasons[0], /de-test/);
  assert.match(refused.reasons[0], /firstPublicationYear/);
  assert.match(refused.reasons[0], /1931/);
});

test("licensing: refuses missing required year fields", () => {
  const missingDeath = evaluateRights({ id: "de-test", firstPublicationYear: 1930 });
  assert.strictEqual(missingDeath.ok, false);
  assert.match(missingDeath.reasons[0], /de-test/);
  assert.match(missingDeath.reasons[0], /authorDeathYear/);
  assert.match(missingDeath.reasons[0], /1956/);

  const missingPublication = evaluateRights({ id: "de-test", authorDeathYear: 1955 });
  assert.strictEqual(missingPublication.ok, false);
  assert.match(missingPublication.reasons[0], /de-test/);
  assert.match(missingPublication.reasons[0], /firstPublicationYear/);
  assert.match(missingPublication.reasons[0], /1930/);
});

test("licensing: refuses null and non-numeric year fields", () => {
  for (const authorDeathYear of [null, "1955", Number.NaN, 1955.5, Number.POSITIVE_INFINITY]) {
    const result = evaluateRights(book({ authorDeathYear }));
    assert.strictEqual(result.ok, false, `authorDeathYear ${String(authorDeathYear)} must be refused`);
    assert.match(result.reasons[0], /authorDeathYear/);
  }

  for (const firstPublicationYear of [null, "1930", Number.NaN, 1930.5]) {
    const result = evaluateRights(book({ firstPublicationYear }));
    assert.strictEqual(result.ok, false, `firstPublicationYear ${String(firstPublicationYear)} must be refused`);
    assert.match(result.reasons[0], /firstPublicationYear/);
  }
});

test("licensing: a record without an id or year is refused, not trusted", () => {
  const result = evaluateRights({});
  assert.strictEqual(result.ok, false);
  assert.ok(result.reasons.length >= 2);
  assert.match(result.reasons[0], /\(unknown book\)/);
});

test("licensing: per-book claims never bypass either rule", () => {
  const claimed = book({
    authorDeathYear: 1956,
    firstPublicationYear: 1931,
    licenseBasis: "PD-EU-70 / PD-US-pre-1931",
    publicDomain: true,
    exception: true,
  });
  const result = evaluateRights(claimed);
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.reasons.length, 2);
});

test("licensing: validatedForYear is reported but does not move the cutoffs", () => {
  const lateDeath = book({ authorDeathYear: 1956 });
  const earlyDeath = book({ authorDeathYear: 1955 });

  assert.strictEqual(evaluateRights(earlyDeath, { validatedForYear: 2026 }).ok, true);
  assert.strictEqual(evaluateRights(earlyDeath, { validatedForYear: 2050 }).ok, true);
  assert.strictEqual(evaluateRights(lateDeath, { validatedForYear: 2026 }).ok, false);
  assert.strictEqual(evaluateRights(lateDeath, { validatedForYear: 2050 }).ok, false);
  assert.strictEqual(evaluateRights(earlyDeath, { validatedForYear: 2050 }).validatedForYear, 2050);
});

test("licensing: all sixteen committed sources pass", () => {
  assert.strictEqual(sources.books.length, 16);
  const ids = new Set();
  for (const record of sources.books) {
    const result = evaluateRights(record);
    assert.deepStrictEqual(result.reasons, [], `${record.id} must pass the rights gate`);
    assert.strictEqual(result.ok, true, `${record.id} must pass the rights gate`);
    assert.strictEqual(result.validatedForYear, VALIDATED_FOR_YEAR);
    ids.add(record.id);
  }
  assert.strictEqual(ids.size, 16);
});

test("licensing: assertRights throws a RightsError naming book, field and year", () => {
  assert.throws(
    () => assertRights(book({ authorDeathYear: 1956 })),
    (error) => {
      assert.ok(error instanceof RightsError);
      assert.strictEqual(error.code, "RIGHTS_REFUSED");
      assert.deepStrictEqual(error.bookIds, ["de-test"]);
      assert.match(error.message, /de-test/);
      assert.match(error.message, /authorDeathYear/);
      assert.match(error.message, /1956/);
      return true;
    },
  );
});

test("licensing: assertAllRights reports every refused book at once", () => {
  const records = [
    book({ id: "de-late-death", authorDeathYear: 1956 }),
    book({ id: "en-late-publication", firstPublicationYear: 1931 }),
    book({ id: "de-ok" }),
  ];
  assert.throws(
    () => assertAllRights(records),
    (error) => {
      assert.ok(error instanceof RightsError);
      assert.deepStrictEqual(error.bookIds, ["de-late-death", "en-late-publication"]);
      assert.strictEqual(error.reasons.length, 2);
      assert.match(error.message, /de-late-death/);
      assert.match(error.message, /en-late-publication/);
      return true;
    },
  );
});

test("licensing: a refused book produces no output file", async () => {
  const outDir = await mkdtemp(join(tmpdir(), "lesen-rights-"));
  const converted = [];
  const convert = async (record, { validatedForYear }) => {
    assert.strictEqual(validatedForYear, VALIDATED_FOR_YEAR);
    converted.push(record.id);
    await writeFile(join(outDir, `${record.id}.json`), JSON.stringify({ id: record.id }));
    return record.id;
  };

  try {
    const records = [
      book({ id: "de-first-ok" }),
      book({ id: "de-refused", authorDeathYear: 1956 }),
      book({ id: "de-never-reached" }),
    ];

    await assert.rejects(
      convertAllWithRightsGate(records, convert),
      (error) => {
        assert.ok(error instanceof RightsError);
        assert.match(error.message, /de-refused/);
        assert.match(error.message, /authorDeathYear/);
        assert.match(error.message, /1956/);
        return true;
      },
    );

    assert.deepStrictEqual(converted, [], "conversion must not start when any book is refused");
    assert.deepStrictEqual(await readdir(outDir), [], "a refused book must leave no output file");
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
});

test("licensing: cleared books convert and record the validated year", async () => {
  const outDir = await mkdtemp(join(tmpdir(), "lesen-rights-ok-"));
  try {
    const records = [book({ id: "de-one" }), book({ id: "en-two", firstPublicationYear: 1900 })];
    const result = await convertAllWithRightsGate(records, async (record, { validatedForYear }) => {
      const path = join(outDir, `${record.id}.json`);
      await writeFile(path, JSON.stringify({ id: record.id, validatedForYear }));
      return path;
    });

    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.count, 2);
    assert.strictEqual(result.validatedForYear, VALIDATED_FOR_YEAR);
    assert.deepStrictEqual((await readdir(outDir)).sort(), ["de-one.json", "en-two.json"]);
    const written = JSON.parse(await readFile(join(outDir, "de-one.json"), "utf8"));
    assert.strictEqual(written.validatedForYear, VALIDATED_FOR_YEAR);
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
});
