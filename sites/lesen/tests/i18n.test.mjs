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
    "setup.mode",
    "setup.mode.patterns",
    "setup.mode.patterns_desc",
    "setup.mode.sub.ma",
    "setup.mode.sub.am",
    "setup.mode.sub.mam",
    "setup.mode.sub.ama",
    "setup.mode.words",
    "setup.mode.words_desc",
    "setup.mode.sentences",
    "setup.mode.sentences_desc",
    "setup.mode.flop",
    "setup.mode.flop_desc",
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

test("i18n: pattern mode keys exist in both languages and the old CV/VC keys are gone", () => {
  const patternKeys = [
    "setup.mode.patterns",
    "setup.mode.patterns_desc",
    "setup.mode.sub.ma",
    "setup.mode.sub.am",
    "setup.mode.sub.mam",
    "setup.mode.sub.ama",
    "setup.error.no_pattern",
  ];

  for (const key of patternKeys) {
    assert.ok(!(t("de", key) === key), `${key} should have a German translation`);
    assert.ok(!(t("en", key) === key), `${key} should have an English translation`);
  }

  assert.strictEqual(t("de", "setup.mode.patterns"), "Muster");
  assert.strictEqual(t("en", "setup.mode.patterns"), "Patterns");
  for (const key of ["setup.mode.sub.ma", "setup.mode.sub.am", "setup.mode.sub.mam", "setup.mode.sub.ama"]) {
    assert.strictEqual(t("de", key), t("en", key));
  }

  assert.ok(!("setup.pattern.cv" in DE), "setup.pattern.cv should be removed from the German dictionary");
  assert.ok(!("setup.pattern.vc" in DE), "setup.pattern.vc should be removed from the German dictionary");
  assert.ok(!("setup.pattern.cv" in EN), "setup.pattern.cv should be removed from the English dictionary");
  assert.ok(!("setup.pattern.vc" in EN), "setup.pattern.vc should be removed from the English dictionary");
});

test("i18n: German dictionary covers error messages", () => {
  const errorKeys = [
    "setup.error.selection",
    "setup.error.wordlist",
    "setup.error.no_flop",
    "setup.error.no_words",
    "setup.error.no_pattern",
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

test("tts: getTtsLanguageCode returns 'en-US' for English", async () => {
  const { getTtsLanguageCode } = await import("../static/storage.mjs");
  assert.strictEqual(getTtsLanguageCode('en'), 'en-US');
});

test("tts: getTtsLanguageCode returns 'de-DE' for German", async () => {
  const { getTtsLanguageCode } = await import("../static/storage.mjs");
  assert.strictEqual(getTtsLanguageCode('de'), 'de-DE');
});

test("tts: getTtsLanguageCode returns 'de-DE' for unknown language", async () => {
  const { getTtsLanguageCode } = await import("../static/storage.mjs");
  assert.strictEqual(getTtsLanguageCode('fr'), 'de-DE');
});

test("tts: voice hints in German dictionary use 'deutsche' wording", () => {
  const noVoiceHint = t("de", "feedback.tts_no_voice");
  assert.ok(noVoiceHint.includes("deutsche"), "German no-voice hint should mention 'deutsche'");
  assert.ok(noVoiceHint.includes("Stimme"), "German no-voice hint should mention 'Stimme'");
});

test("tts: voice hints in English dictionary use 'English' wording", () => {
  const noVoiceHint = t("en", "feedback.tts_no_voice");
  assert.ok(noVoiceHint.includes("English"), "English no-voice hint should mention 'English'");
  assert.ok(noVoiceHint.includes("voice"), "English no-voice hint should mention 'voice'");
});

test("tts: German error hint references German pronunciation", () => {
  const errorHint = t("de", "feedback.tts_error");
  assert.ok(errorHint.includes("deutsche"), "German error hint should mention 'deutsche'");
});

test("tts: English error hint references English pronunciation", () => {
  const errorHint = t("en", "feedback.tts_error");
  assert.ok(errorHint.includes("English"), "English error hint should mention 'English'");
});

test("tts: word-list filename follows language pattern", async () => {
  // German uses words-de.json, English uses words-en.json
  const { getWordListFilename } = await import("../static/storage.mjs");

  assert.strictEqual(getWordListFilename('en'), 'words-en.json');
  assert.strictEqual(getWordListFilename('de'), 'words-de.json');
});

test("tts: getTtsLanguageCode is consistent with language switching", async () => {
  const { getTtsLanguageCode } = await import("../static/storage.mjs");
  const languages = ['de', 'en'];
  const expected = { de: 'de-DE', en: 'en-US' };
  
  for (const lang of languages) {
    const code = getTtsLanguageCode(lang);
    assert.strictEqual(code, expected[lang], 
      `switching to ${lang} should produce TTS code ${expected[lang]}, got ${code}`);
  }
});

test("language selection: voice code, specials set and word-list filename all match per language", async () => {
  const { getTtsLanguageCode, getWordListFilename } = await import("../static/storage.mjs");
  const { getSoundsForLanguage } = await import("../static/sounds.mjs");

  const expectations = {
    de: {
      langPrefix: 'de-',
      filename: 'words-de.json',
      specials: ["ä", "ö", "ü", "au", "ei", "ie", "eu", "sch", "ch", "st", "ai", "xx"],
    },
    en: {
      langPrefix: 'en-',
      filename: 'words-en.json',
      specials: ["sh", "ch", "th", "oo", "ee", "ai", "ou"],
    },
  };

  for (const [lang, expected] of Object.entries(expectations)) {
    const langCode = getTtsLanguageCode(lang);
    const filename = getWordListFilename(lang);
    const { specials } = getSoundsForLanguage(lang);

    assert.ok(
      langCode.startsWith(expected.langPrefix),
      `${lang} voice code '${langCode}' should start with '${expected.langPrefix}'`,
    );
    assert.strictEqual(filename, expected.filename, `${lang} word-list filename mismatch`);
    assert.deepStrictEqual([...specials], expected.specials, `${lang} specials set mismatch`);
  }
});

test("language selection: switching in either direction updates voice code, specials and word list together", async () => {
  const { getTtsLanguageCode, getWordListFilename } = await import("../static/storage.mjs");
  const { getSoundsForLanguage } = await import("../static/sounds.mjs");

  function selectionFor(lang) {
    return {
      langCode: getTtsLanguageCode(lang),
      filename: getWordListFilename(lang),
      specials: [...getSoundsForLanguage(lang).specials],
    };
  }

  // de -> en
  let current = selectionFor('de');
  assert.ok(current.langCode.startsWith('de-'));
  current = selectionFor('en');
  assert.ok(current.langCode.startsWith('en-'), "switching de->en should produce an en- voice code");
  assert.strictEqual(current.filename, 'words-en.json', "switching de->en should load the English word list");
  assert.ok(current.specials.includes('sh'), "switching de->en should load English specials");
  assert.ok(!current.specials.includes('ä'), "switching de->en must not keep German specials");

  // en -> de
  current = selectionFor('de');
  assert.ok(current.langCode.startsWith('de-'), "switching en->de should produce a de- voice code");
  assert.strictEqual(current.filename, 'words-de.json', "switching en->de should load the German word list");
  assert.ok(current.specials.includes('ä'), "switching en->de should load German specials");
  assert.ok(!current.specials.includes('sh'), "switching en->de must not keep English specials");
});

/** Read the single-page app markup so tests can assert on its static HTML. */
async function readIndexHtml() {
  const { readFile } = await import("node:fs/promises");
  const { fileURLToPath } = await import("node:url");
  const path = await import("node:path");
  const file = path.join(path.dirname(fileURLToPath(import.meta.url)), "../static/index.html");
  return readFile(file, "utf8");
}

/** Read a committed sentence pool of the given language. */
async function readSentencePool(lang) {
  const { readFile } = await import("node:fs/promises");
  const { fileURLToPath } = await import("node:url");
  const path = await import("node:path");
  const file = path.join(path.dirname(fileURLToPath(import.meta.url)), `../static/sentences/${lang}.json`);
  return JSON.parse(await readFile(file, "utf8"));
}

const MODE_TEXT_IDS = [
  "mode-legend",
  "mode-patterns-title",
  "mode-patterns-desc",
  "mode-words-title",
  "words-mode-desc",
  "mode-sentences-title",
  "sentences-mode-desc",
  "mode-flop-title",
  "flop-mode-desc",
];

test("i18n: no key exists only in the English dictionary", () => {
  const enKeys = Object.keys(EN);
  const missingInDe = enKeys.filter((key) => !(key in DE));
  assert.deepStrictEqual(
    missingInDe,
    [],
    `the following keys from English dictionary are missing in German dictionary: ${missingInDe.join(", ")}`,
  );
});

test("i18n: mode keys exist in both languages", () => {
  const modeKeys = [
    "setup.mode",
    "setup.mode.patterns",
    "setup.mode.patterns_desc",
    "setup.mode.words",
    "setup.mode.words_desc",
    "setup.mode.sentences",
    "setup.mode.sentences_desc",
    "setup.mode.flop",
    "setup.mode.flop_desc",
    "setup.error.sentencepool",
    "setup.error.no_sentences",
    "practice.progress_label",
  ];

  for (const key of modeKeys) {
    for (const lang of ["de", "en"]) {
      const translated = t(lang, key);
      assert.notStrictEqual(translated, key, `${key} should have a ${lang} translation`);
      assert.ok(translated.trim().length > 0, `${key} ${lang} translation should not be empty`);
    }
  }
});

test("i18n: the mode UI has no hard-coded user-visible text", async () => {
  const html = await readIndexHtml();

  for (const id of MODE_TEXT_IDS) {
    const emptyElement = new RegExp(`id="${id}"[^>]*>\\s*</`);
    assert.match(
      html,
      emptyElement,
      `#${id} must be filled from the dictionaries instead of hard-coding German text`,
    );
  }
});

test("i18n: every mode text element is filled from a dictionary key", async () => {
  const html = await readIndexHtml();
  const wired = new Set();
  for (const match of html.matchAll(/byId\('([^']+)'\)\.textContent = tr\('([^']+)'\)/g)) {
    wired.add(match[1]);
  }

  for (const id of MODE_TEXT_IDS) {
    assert.ok(wired.has(id), `#${id} should be updated through tr()`);
  }
});

test("i18n: both language pools load", async () => {
  for (const lang of ["de", "en"]) {
    const data = await readSentencePool(lang);
    assert.strictEqual(data.lang, lang, `${lang} pool should declare its language`);
    assert.strictEqual(data.count, 1000, `${lang} pool should announce 1000 sentences`);
    assert.strictEqual(data.sentences.length, 1000, `${lang} pool should contain 1000 sentences`);

    const ids = new Set();
    for (const entry of data.sentences) {
      assert.strictEqual(typeof entry.text, "string", `${lang} entry should have text`);
      assert.ok(entry.text.trim().length > 0, `${lang} entry text should not be empty`);
      assert.ok(!ids.has(entry.id), `${lang} entry id ${entry.id} should be unique`);
      ids.add(entry.id);
    }
  }
});

test("i18n: both pools offer sentence cards the selection can read", async () => {
  const { readableSentenceCards } = await import("../static/sentences/cards.mjs");
  const { getSoundsForLanguage } = await import("../static/sounds.mjs");
  const { stageSets } = await import("../tools/validate_sentences.mjs");

  for (const lang of ["de", "en"]) {
    const data = await readSentencePool(lang);

    const allSounds = getSoundsForLanguage(lang);
    const fullSelection = readableSentenceCards(data.sentences, allSounds, lang);
    assert.strictEqual(fullSelection.length, 1000, `${lang} pool should be fully readable with all sounds`);

    const beginner = readableSentenceCards(data.sentences, stageSets(lang).S0, lang);
    assert.ok(beginner.length > 0, `${lang} pool should offer readable sentences to a beginner`);
    assert.ok(beginner.every((entry) => entry.text.trim().length > 0));
  }
});

test("a11y: the mode selector is a labelled radio group", async () => {
  const html = await readIndexHtml();

  assert.match(html, /<legend id="mode-legend">/);
  for (const value of ["PATTERNS", "WORDS", "SENTENCES", "FLOP"]) {
    assert.match(html, new RegExp(`<input type="radio" name="mode" value="${value}"`));
  }
  assert.doesNotMatch(html, /<input type="radio" name="deck"/);
  assert.doesNotMatch(html, /<input type="radio" name="pattern"/);
});

test("a11y: each mode count is rendered as plain text", async () => {
  const html = await readIndexHtml();

  assert.match(html, /id="words-match-count"/);
  assert.match(html, /id="sentences-match-count"/);
  assert.match(html, /id="flop-match-count"/);
  assert.doesNotMatch(html, /id="sentences-count" class="selection-count"/);
});

test("a11y: the practice progress bar has a translated accessible name", async () => {
  const html = await readIndexHtml();

  assert.doesNotMatch(html, /<progress[^>]*aria-label="[^"]+"/);
  assert.match(html, /byId\('progress'\)\.setAttribute\('aria-label', tr\('practice\.progress_label'\)\);/);
  assert.notStrictEqual(t("de", "practice.progress_label"), "practice.progress_label");
  assert.notStrictEqual(t("en", "practice.progress_label"), "practice.progress_label");
});
