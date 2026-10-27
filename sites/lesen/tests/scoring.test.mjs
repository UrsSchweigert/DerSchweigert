import test from "node:test";
import assert from "node:assert";
import { recordAttempt, selectFlopDeck, flopCandidateCards, isSpellableWith } from "../static/scoring.mjs";

test("recordAttempt: adds +1 to correct_count on correct answer in normal mode", () => {
  const stats = {};
  recordAttempt(stats, "Card 1", true, { flop: false });
  assert.deepStrictEqual(stats["Card 1"], { correct_count: 1, incorrect_count: 0 });
});

test("recordAttempt: adds +3 to correct_count on correct answer in flop mode", () => {
  const stats = {};
  recordAttempt(stats, "Card 2", true, { flop: true });
  assert.deepStrictEqual(stats["Card 2"], { correct_count: 3, incorrect_count: 0 });
});

test("recordAttempt: adds +1 to incorrect_count on incorrect answer in normal mode", () => {
  const stats = {};
  recordAttempt(stats, "Card 3", false, { flop: false });
  assert.deepStrictEqual(stats["Card 3"], { correct_count: 0, incorrect_count: 1 });
});

test("recordAttempt: adds +1 to incorrect_count on incorrect answer in flop mode", () => {
  const stats = {};
  recordAttempt(stats, "Card 4", false, { flop: true });
  assert.deepStrictEqual(stats["Card 4"], { correct_count: 0, incorrect_count: 1 });
});

test("recordAttempt: updates existing stats correctly", () => {
  const stats = {
    "Card 5": { correct_count: 2, incorrect_count: 1 },
  };
  recordAttempt(stats, "Card 5", true, { flop: false });
  assert.deepStrictEqual(stats["Card 5"], { correct_count: 3, incorrect_count: 1 });
});

test("recordAttempt: flop mode increments correctly on existing card", () => {
  const stats = {
    "Card 6": { correct_count: 1, incorrect_count: 0 },
  };
  recordAttempt(stats, "Card 6", true, { flop: true });
  assert.deepStrictEqual(stats["Card 6"], { correct_count: 4, incorrect_count: 0 });
});

test("selectFlopDeck: excludes cards never attempted", () => {
  const stats = {
    "Card A": { correct_count: 0, incorrect_count: 0 },
  };
  const allowedCards = ["Card A", "Card B", "Card C"];
  const deck = selectFlopDeck(stats, allowedCards);
  assert.deepStrictEqual(deck, []);
});

test("selectFlopDeck: includes only cards with at least one attempt", () => {
  const stats = {
    "Card A": { correct_count: 1, incorrect_count: 0 },
    "Card B": { correct_count: 0, incorrect_count: 0 },
    "Card C": { correct_count: 0, incorrect_count: 1 },
  };
  const allowedCards = ["Card A", "Card B", "Card C"];
  const deck = selectFlopDeck(stats, allowedCards);
  // Card B never attempted so excluded; A and C have attempts
  // Bottom 10% of 2 cards = 1 card minimum, so only the worst (Card C at 0%) is included
  assert.strictEqual(deck.length, 1);
  assert.ok(deck.includes("Card C"));
  assert.ok(!deck.includes("Card B"));
});

test("selectFlopDeck: sorts by success rate (correct/(correct+incorrect)) ascending", () => {
  const stats = {
    "Card A": { correct_count: 9, incorrect_count: 1 }, // 90%
    "Card B": { correct_count: 5, incorrect_count: 5 }, // 50%
    "Card C": { correct_count: 1, incorrect_count: 9 }, // 10%
  };
  const allowedCards = ["Card A", "Card B", "Card C"];
  const deck = selectFlopDeck(stats, allowedCards);
  // Bottom 10% of 3 = 0.3, rounds up to 1, so only Card C (worst performer)
  assert.deepStrictEqual(deck, ["Card C"]);
});

test("selectFlopDeck: selects bottom 10% of qualifying cards", () => {
  const stats = {};
  const allowedCards = [];
  // Create 20 cards with varying success rates
  for (let i = 0; i < 20; i++) {
    stats[`Card ${i}`] = { correct_count: i, incorrect_count: 20 - i };
    allowedCards.push(`Card ${i}`);
  }
  const deck = selectFlopDeck(stats, allowedCards);
  // Bottom 10% of 20 = 2 cards
  assert.strictEqual(deck.length, 2);
  // Should be the lowest success rate cards
  const expectedBottomTwo = ["Card 0", "Card 1"];
  assert.deepStrictEqual(deck, expectedBottomTwo);
});

test("selectFlopDeck: caps the result at 30 cards", () => {
  const stats = {};
  const allowedCards = [];
  // Create 400 cards all with 0% success rate (to all qualify for bottom 10%)
  for (let i = 0; i < 400; i++) {
    stats[`Card ${i}`] = { correct_count: 0, incorrect_count: 1 };
    allowedCards.push(`Card ${i}`);
  }
  const deck = selectFlopDeck(stats, allowedCards);
  // Bottom 10% of 400 = 40 cards, but capped at 30
  assert.strictEqual(deck.length, 30);
});

test("selectFlopDeck: returns at least 1 card when any qualifying cards exist", () => {
  const stats = {
    "Card A": { correct_count: 1, incorrect_count: 0 },
  };
  const allowedCards = ["Card A"];
  const deck = selectFlopDeck(stats, allowedCards);
  assert.deepStrictEqual(deck, ["Card A"]);
});

test("selectFlopDeck: returns at least 1 card from bottom 10% when exactly 10 cards", () => {
  const stats = {};
  const allowedCards = [];
  for (let i = 0; i < 10; i++) {
    stats[`Card ${i}`] = { correct_count: i, incorrect_count: 10 - i };
    allowedCards.push(`Card ${i}`);
  }
  const deck = selectFlopDeck(stats, allowedCards);
  // Bottom 10% of 10 = 1 card
  assert.strictEqual(deck.length, 1);
  assert.deepStrictEqual(deck, ["Card 0"]);
});

test("selectFlopDeck: filters by allowedCards", () => {
  const stats = {
    "Card A": { correct_count: 1, incorrect_count: 0 },
    "Card B": { correct_count: 1, incorrect_count: 9 },
    "Card C": { correct_count: 1, incorrect_count: 0 },
  };
  const allowedCards = ["Card A", "Card B"]; // Card C not allowed
  const deck = selectFlopDeck(stats, allowedCards);
  assert.ok(deck.includes("Card A") || deck.includes("Card B"));
  assert.ok(!deck.includes("Card C"));
});

test("flopCandidateCards: keeps history cards spelled with the selected sounds", () => {
  const stats = {
    ta: { correct_count: 1, incorrect_count: 1 },
    am: { correct_count: 1, incorrect_count: 0 },
    Hut: { correct_count: 0, incorrect_count: 1 },
  };
  const candidates = flopCandidateCards(stats, new Set(["t", "m", "a"]));
  assert.deepStrictEqual(candidates.sort(), ["am", "ta"]);
});

test("flopCandidateCards: matches regardless of card casing", () => {
  const stats = { Ta: { correct_count: 0, incorrect_count: 1 } };
  assert.deepStrictEqual(flopCandidateCards(stats, ["t", "a"]), ["Ta"]);
});

test("flopCandidateCards: supports multi-character specials", () => {
  const stats = {
    sau: { correct_count: 0, incorrect_count: 1 },
    sei: { correct_count: 0, incorrect_count: 1 },
  };
  assert.deepStrictEqual(flopCandidateCards(stats, ["s", "au"]), ["sau"]);
});

test("flopCandidateCards: ignores cards using unselected sounds", () => {
  const stats = { mö: { correct_count: 0, incorrect_count: 1 } };
  assert.deepStrictEqual(flopCandidateCards(stats, ["m", "a", "e"]), []);
  assert.deepStrictEqual(flopCandidateCards(stats, ["m", "ö"]), ["mö"]);
});

test("flopCandidateCards: returns an empty list without stats or sounds", () => {
  assert.deepStrictEqual(flopCandidateCards({}, ["a"]), []);
  assert.deepStrictEqual(flopCandidateCards(null, ["a"]), []);
  assert.deepStrictEqual(flopCandidateCards({ ta: { correct_count: 1, incorrect_count: 0 } }, []), []);
});

test("selectFlopDeck: deck built from history is min(ceil(10%), 30) and never empty", () => {
  const stats = {};
  for (let index = 0; index < 15; index++) {
    stats[`t${index}`] = { correct_count: index, incorrect_count: 15 - index };
  }
  const deck = selectFlopDeck(stats, Object.keys(stats));
  assert.strictEqual(deck.length, Math.min(Math.ceil(15 * 0.1), 30));
  assert.ok(deck.length > 0);
});

test("isSpellableWith: 'ball' can be spelled with b,a,l even without 'xx'", () => {
  const allowedSounds = new Set(["b", "a", "l"]);
  assert.strictEqual(isSpellableWith("ball", allowedSounds), true);
});

test("isSpellableWith: 'ball' can be spelled with just b,a,l,xx", () => {
  const allowedSounds = new Set(["b", "a", "xx"]);
  assert.strictEqual(isSpellableWith("ball", allowedSounds), true);
});

test("isSpellableWith: 'balle' can be spelled with b,a,l,e,xx", () => {
  const allowedSounds = new Set(["b", "a", "e", "xx"]);
  assert.strictEqual(isSpellableWith("balle", allowedSounds), true);
});

test("isSpellableWith: 'aabb' can be spelled with a,b,xx", () => {
  const allowedSounds = new Set(["a", "b", "xx"]);
  assert.strictEqual(isSpellableWith("aabb", allowedSounds), true);
});

test("isSpellableWith: 'bälle' can be spelled with b,ä,e,xx", () => {
  const allowedSounds = new Set(["b", "ä", "e", "xx"]);
  assert.strictEqual(isSpellableWith("bälle", allowedSounds), true);
});

test("isSpellableWith: 'schon' can be spelled with s,c,h,o,n or with sch special", () => {
  const allowedSounds = new Set(["s", "c", "h", "o", "n"]);
  assert.strictEqual(isSpellableWith("schon", allowedSounds), true);
});

test("isSpellableWith: 'stein' can be spelled with s,t,e,i,n", () => {
  const allowedSounds = new Set(["s", "t", "e", "i", "n"]);
  assert.strictEqual(isSpellableWith("stein", allowedSounds), true);
});
