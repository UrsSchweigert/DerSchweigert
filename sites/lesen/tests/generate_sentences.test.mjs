import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { candidates, dedupe, nextEntries, append } from "../tools/generate_sentences.mjs";
import { validate, unitsOf, stageOf, MAX_WORDS } from "../tools/validate_sentences.mjs";

const LANGS = ["de", "en"];

for (const lang of LANGS) {
  test(lang + ": every generated candidate is short, unique and readable in some stage", () => {
    const list = dedupe(candidates(lang));
    assert.ok(list.length > 1000, lang + " should offer a large candidate pool");
    const seen = new Set();
    for (const text of list) {
      const words = text.trim().split(/\s+/).length;
      assert.ok(words >= 2 && words <= MAX_WORDS, lang + ": " + text + " has " + words + " words");
      assert.ok(!seen.has(text.toLowerCase()), lang + ": duplicate candidate " + text);
      seen.add(text.toLowerCase());
      assert.ok(stageOf(text, lang), lang + ": " + text + " is readable in no stage");
      assert.ok(unitsOf(text, lang).length > 0, lang + ": " + text + " has no units");
    }
  });

  test(lang + ": generated entries carry correct metadata", () => {
    for (const entry of nextEntries(lang, 50, [], 0)) {
      assert.equal(entry.words, entry.text.trim().split(/\s+/).length);
      assert.equal(entry.stage, stageOf(entry.text, lang));
      assert.deepEqual(entry.required, unitsOf(entry.text, lang));
    }
  });

  test(lang + ": generation is deterministic", () => {
    assert.deepEqual(nextEntries(lang, 100, [], 0), nextEntries(lang, 100, [], 0));
  });

  test(lang + ": append extends a copy of the committed pool and stays validator-clean", () => {
    const dir = mkdtempSync(join(tmpdir(), "sentgen-"));
    try {
      const file = join(dir, lang + ".json");
      const poolUrl = new URL("../static/sentences/" + lang + ".json", import.meta.url);
      const committed = JSON.parse(readFileSync(poolUrl, "utf8"));
      writeFileSync(file, readFileSync(poolUrl, "utf8"));

      append(file, lang, 750);
      append(file, lang, 750);

      const data = JSON.parse(readFileSync(file, "utf8"));
      assert.equal(data.count, committed.sentences.length + 1500);
      assert.equal(data.sentences.length, committed.sentences.length + 1500);
      assert.deepEqual(validate(lang, data), []);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}
