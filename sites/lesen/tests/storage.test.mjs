import test from "node:test";
import assert from "node:assert";
import { createStorage, readLanguage, writeLanguage } from "../static/storage.mjs";
import { recordAttempt, selectFlopDeck, flopCandidateCards } from "../static/scoring.mjs";

/** Minimal in-memory stand-in for localStorage. */
function createFakeStore() {
  const data = new Map();
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => {
      data.set(key, String(value));
    },
  };
}

test("storage: creates a default stats map with a fake store", () => {
  const store = createFakeStore();
  const storage = createStorage(store);
  const stats = storage.read();
  assert.strictEqual(typeof stats, "object");
  assert.deepStrictEqual(stats, {});
});

test("storage: persists stats to the backing store", () => {
  const store = createFakeStore();
  const storage = createStorage(store);
  const stats = storage.read();
  stats["Card A"] = { correct_count: 2, incorrect_count: 1 };
  storage.write(stats);
  
  const retrieved = store.getItem("buchstabenzeit:card-stats");
  assert.ok(retrieved);
  const parsed = JSON.parse(retrieved);
  assert.deepStrictEqual(parsed, { "Card A": { correct_count: 2, incorrect_count: 1 } });
});

test("storage: reads stats from the backing store", () => {
  const store = createFakeStore();
  store.setItem("buchstabenzeit:card-stats", JSON.stringify({
    "Card B": { correct_count: 5, incorrect_count: 2 },
  }));
  
  const storage = createStorage(store);
  const stats = storage.read();
  assert.deepStrictEqual(stats, {
    "Card B": { correct_count: 5, incorrect_count: 2 },
  });
});

test("storage: handles corrupted JSON gracefully", () => {
  const store = createFakeStore();
  store.setItem("buchstabenzeit:card-stats", "not valid json");
  
  const storage = createStorage(store);
  const stats = storage.read();
  assert.deepStrictEqual(stats, {});
});

test("storage: handles missing store gracefully", () => {
  const storage = createStorage(null);
  const stats = storage.read();
  assert.deepStrictEqual(stats, {});
  
  // write should not throw even with null store
  assert.doesNotThrow(() => {
    stats["Card C"] = { correct_count: 1, incorrect_count: 0 };
    storage.write(stats);
  });
});

test("storage: persists the +3 flop weight end-to-end", () => {
  const store = createFakeStore();
  const storage = createStorage(store);

  const practice = storage.read();
  recordAttempt(practice, "ta", false, { flop: false });
  recordAttempt(practice, "am", true, { flop: false });
  storage.write(practice);

  const setupStats = createStorage(store).read();
  const deck = selectFlopDeck(setupStats, flopCandidateCards(setupStats, ["t", "m", "a"]));
  assert.deepStrictEqual(deck, ["ta"]);

  const flopStats = createStorage(store).read();
  recordAttempt(flopStats, deck[0], true, { flop: true });
  createStorage(store).write(flopStats);

  const persisted = createStorage(store).read();
  assert.deepStrictEqual(persisted["ta"], { correct_count: 3, incorrect_count: 1 });
});

test("storage: a sentence attempt round-trips unchanged", () => {
  const store = createFakeStore();
  const stats = createStorage(store).read();
  recordAttempt(stats, "Mama malt.", true, { flop: false });
  recordAttempt(stats, "Mama malt.", false, { flop: false });
  createStorage(store).write(stats);

  const reloaded = createStorage(store).read();
  assert.deepStrictEqual(reloaded["Mama malt."], { correct_count: 1, incorrect_count: 1 });
  assert.deepStrictEqual(reloaded, stats);
});

test("storage: word-card statistics are unaffected by a sentence attempt", () => {
  const store = createFakeStore();
  store.setItem("buchstabenzeit:card-stats", JSON.stringify({
    "Hut": { correct_count: 4, incorrect_count: 2 },
  }));

  const stats = createStorage(store).read();
  recordAttempt(stats, "Oma mag Mama.", true, { flop: false });
  createStorage(store).write(stats);

  const reloaded = createStorage(store).read();
  assert.deepStrictEqual(reloaded["Hut"], { correct_count: 4, incorrect_count: 2 });
  assert.deepStrictEqual(reloaded["Oma mag Mama."], { correct_count: 1, incorrect_count: 0 });
});

test("storage: a versioned document is read as its card map", () => {
  const store = createFakeStore();
  store.setItem("buchstabenzeit:card-stats", JSON.stringify({
    version: 2,
    cards: { "Lisa erntet Ananas.": { correct_count: 2, incorrect_count: 0 } },
  }));

  assert.deepStrictEqual(createStorage(store).read(), {
    "Lisa erntet Ananas.": { correct_count: 2, incorrect_count: 0 },
  });
});

test("storage: an unknown version is empty and does not throw", () => {
  const store = createFakeStore();
  for (const document of [
    { version: 1, cards: { "Hut": { correct_count: 1, incorrect_count: 0 } } },
    { version: 99, cards: { "Hut": { correct_count: 1, incorrect_count: 0 } } },
    { version: 3 },
  ]) {
    store.setItem("buchstabenzeit:card-stats", JSON.stringify(document));
    assert.doesNotThrow(() => createStorage(store).read());
    assert.deepStrictEqual(createStorage(store).read(), {});
  }
});

test("storage: a versioned document without a cards map is empty", () => {
  const store = createFakeStore();
  for (const cards of [undefined, null, [], "Hut"]) {
    store.setItem("buchstabenzeit:card-stats", JSON.stringify({ version: 2, cards }));
    assert.deepStrictEqual(createStorage(store).read(), {});
  }
});

test("storage: a card called 'version' stays a legacy word card", () => {
  const store = createFakeStore();
  store.setItem("buchstabenzeit:card-stats", JSON.stringify({
    "version": { correct_count: 1, incorrect_count: 2 },
  }));

  assert.deepStrictEqual(createStorage(store).read(), {
    "version": { correct_count: 1, incorrect_count: 2 },
  });
});

test("language: a fake store with no prior value yields 'de'", () => {
  const store = createFakeStore();
  const lang = readLanguage(store);
  assert.strictEqual(lang, "de");
});

test("language: writing 'en' then reading returns 'en'", () => {
  const store = createFakeStore();
  writeLanguage(store, "en");
  const lang = readLanguage(store);
  assert.strictEqual(lang, "en");
});

test("language: writing 'de' then reading returns 'de'", () => {
  const store = createFakeStore();
  writeLanguage(store, "de");
  const lang = readLanguage(store);
  assert.strictEqual(lang, "de");
});

test("language: an invalid stored value falls back to 'de'", () => {
  const store = createFakeStore();
  store.setItem("buchstabenzeit:language", "fr");
  const lang = readLanguage(store);
  assert.strictEqual(lang, "de");
});

test("language: null store returns 'de'", () => {
  const lang = readLanguage(null);
  assert.strictEqual(lang, "de");
});

test("language: undefined store returns 'de'", () => {
  const lang = readLanguage(undefined);
  assert.strictEqual(lang, "de");
});

test("language: writeLanguage handles null store gracefully", () => {
  assert.doesNotThrow(() => {
    writeLanguage(null, "en");
  });
});

test("language: writeLanguage handles undefined store gracefully", () => {
  assert.doesNotThrow(() => {
    writeLanguage(undefined, "en");
  });
});

