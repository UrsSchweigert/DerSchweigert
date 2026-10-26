import test from "node:test";
import assert from "node:assert";
import { createStorage } from "../static/storage.mjs";
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
