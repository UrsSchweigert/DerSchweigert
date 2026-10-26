import test from "node:test";
import assert from "node:assert";
import { t, DE, EN } from "../static/i18n.mjs";

test("i18n: every key present in 'de' has a corresponding 'en' entry", () => {
  // Get all keys from the German dictionary
  const deKeys = Object.keys(DE);
  
  // Check that EN dictionary has all the same keys
  const missingInEn = deKeys.filter(key => !(key in EN));
  
  assert.deepStrictEqual(
    missingInEn,
    [],
    `the following keys from German dictionary are missing in English dictionary: ${missingInEn.join(", ")}`,
  );
});

test("i18n: t() returns the translated string for a valid German key", () => {
  assert.strictEqual(t("de", "setup.title"), "Lesen lernen, Karte für Karte.");
  assert.strictEqual(t("de", "practice.title"), "Deine Lesekarten");
  assert.strictEqual(t("de", "complete.title"), "Alle Karten geschafft!");
});

test("i18n: t() falls back to the key itself if not found", () => {
  assert.strictEqual(t("de", "nonexistent.key"), "nonexistent.key");
  assert.strictEqual(t("de", "missing.translation"), "missing.translation");
});

test("i18n: t() falls back to the key for unsupported languages", () => {
  assert.strictEqual(t("fr", "setup.title"), "setup.title");
  assert.strictEqual(t("fr", "practice.title"), "practice.title");
});

test("i18n: t() returns English translations for 'en' language", () => {
  assert.strictEqual(t("en", "setup.title"), "Learn to read, card by card.");
  assert.strictEqual(t("en", "practice.title"), "Your reading cards");
});

test("i18n: German dictionary covers setup form strings", () => {
  const setupStrings = [
    "setup.consonants",
    "setup.vowels",
    "setup.specials",
    "setup.pattern",
    "setup.pattern.cv",
    "setup.pattern.vc",
    "setup.pattern.words",
    "setup.pattern.flop",
    "setup.wordlength",
    "setup.cardcount",
    "setup.start",
  ];
  
  for (const key of setupStrings) {
    const translated = t("de", key);
    assert.ok(translated !== key, `${key} should have a translation`);
    assert.ok(translated.length > 0, `${key} translation should not be empty`);
  }
});

test("i18n: German dictionary covers error messages", () => {
  const errorKeys = [
    "setup.error.selection",
    "setup.error.wordlist",
    "setup.error.no_flop",
    "setup.error.no_words",
  ];
  
  for (const key of errorKeys) {
    const translated = t("de", key);
    assert.ok(translated !== key, `${key} should have a translation`);
    assert.ok(translated.length > 0, `${key} translation should not be empty`);
  }
});

test("i18n: German dictionary covers practice screen strings", () => {
  const practiceStrings = [
    "practice.stats.cleared",
    "practice.stats.remaining",
    "practice.stats.total",
    "practice.button.speak",
    "practice.button.retry",
    "practice.button.correct",
  ];
  
  for (const key of practiceStrings) {
    const translated = t("de", key);
    assert.ok(translated !== key, `${key} should have a translation`);
  }
});

test("i18n: German dictionary covers feedback messages", () => {
  const feedbackKeys = [
    "feedback.card_done",
    "feedback.try_again",
    "feedback.try_later",
    "feedback.tts_unsupported",
    "feedback.tts_no_voice",
    "feedback.tts_error",
  ];
  
  for (const key of feedbackKeys) {
    const translated = t("de", key);
    assert.ok(translated !== key, `${key} should have a translation`);
    assert.ok(translated.length > 0, `${key} translation should not be empty`);
  }
});

test("i18n: German dictionary covers dialog strings", () => {
  const dialogKeys = [
    "dialog.confirm_end.title",
    "dialog.confirm_end.text",
    "dialog.confirm_end.cancel",
    "dialog.confirm_end.confirm",
    "dialog.tts_disclaimer.title",
    "dialog.tts_disclaimer.close",
    "dialog.about.title",
  ];
  
  for (const key of dialogKeys) {
    const translated = t("de", key);
    assert.ok(translated !== key, `${key} should have a translation`);
  }
});

test("i18n: German dictionary covers unit pluralization keys", () => {
  const unitKeys = [
    "unit.card",
    "unit.cards",
    "unit.attempt",
    "unit.attempts",
    "unit.selected",
    "unit.in_flop",
  ];
  
  for (const key of unitKeys) {
    const translated = t("de", key);
    assert.ok(translated !== key, `${key} should have a translation`);
  }
});

test("i18n: t() preserves German special characters (umlauts, etc.)", () => {
  const result = t("de", "setup.title");
  assert.ok(result.includes("ü"), "should contain umlaut ü");
  
  const consonants = t("de", "setup.consonants");
  assert.strictEqual(consonants, "Konsonanten");
  
  const vowels = t("de", "setup.vowels");
  assert.strictEqual(vowels, "Vokale");
});

test("i18n: key fallback returns the exact key for missing translations", () => {
  const key = "some.missing.key.with.dots";
  assert.strictEqual(t("de", key), key);
});

test("i18n: every tr(...) key referenced in index.html resolves to a real dictionary entry", async () => {
  const { readFile } = await import("node:fs/promises");
  const { fileURLToPath } = await import("node:url");
  const path = await import("node:path");

  const htmlPath = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "../static/index.html",
  );
  const html = await readFile(htmlPath, "utf8");

  // Find every key used via tr('...') in the page's inline language-switch
  // script. If an element is wired up to re-render on language change but
  // its key is missing from the dictionary, t() would silently fall back
  // to the key itself, so this guards against that gap.
  const keyPattern = /\btr\(\s*'([^']+)'\s*\)/g;
  const keys = new Set();
  for (const match of html.matchAll(keyPattern)) {
    keys.add(match[1]);
  }

  assert.ok(keys.size > 0, "expected to find at least one tr(...) call in index.html");

  const missing = [...keys].filter((key) => t("de", key) === key);
  assert.deepStrictEqual(
    missing,
    [],
    `the following keys referenced via tr() in index.html have no German dictionary entry: ${missing.join(", ")}`,
  );
});
