import test from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { recordAttempt, resetCardStats, selectFlopDeck, flopCandidateCards, buildFlopDeck, isSpellableWith, buildSentenceOnlyDeck, buildMixedDeck, createSeededRandom, isSpeakableCard, FLOP_WEAK_SUCCESS_RATE_THRESHOLD, FLOP_WEAK_MIN_ATTEMPTS } from "../static/scoring.mjs";

const SENTENCE_POOL = [
  { id: "a", text: "Mama malt." },
  { id: "b", text: "Oma mag Mama." },
  { id: "c", text: "Das Brot ist frisch." },
];
const SMALL_SELECTION = { consonants: ["m", "l", "t", "g", "o"], vowels: ["a"], specials: [] };
const WORDS = ["Mama", "Oma", "malt", "mag"];

const kinds = (deck) => deck.map((card) => card.kind);
const alternates = (deck) => deck.every((card, index) => index === 0 || card.kind !== deck[index - 1].kind);

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

test("recordAttempt: recovery flag resets stats on flop success after misses", () => {
  const stats = {
    "Card Recovered": { correct_count: 0, incorrect_count: 3 },
  };
  recordAttempt(stats, "Card Recovered", true, { flop: true, recovery: true });
  // Stats should be reset to 0, 0 (not incremented)
  assert.deepStrictEqual(stats["Card Recovered"], { correct_count: 0, incorrect_count: 0 });
});

test("recordAttempt: recovery flag does not affect normal (non-flop) mode", () => {
  const stats = {
    "Card Normal": { correct_count: 0, incorrect_count: 2 },
  };
  recordAttempt(stats, "Card Normal", true, { flop: false, recovery: true });
  // In normal mode, recovery should not trigger reset; just add +1
  assert.deepStrictEqual(stats["Card Normal"], { correct_count: 1, incorrect_count: 2 });
});

test("recordAttempt: recovery flag does not reset on incorrect answer", () => {
  const stats = {
    "Card Miss": { correct_count: 1, incorrect_count: 1 },
  };
  recordAttempt(stats, "Card Miss", false, { flop: true, recovery: true });
  // Incorrect should just add +1 to incorrect_count, no reset
  assert.deepStrictEqual(stats["Card Miss"], { correct_count: 1, incorrect_count: 2 });
});

test("recordAttempt: first-try flop success (no recovery) keeps +3 behavior with no reset", () => {
  const stats = {
    "Card FirstTry": { correct_count: 0, incorrect_count: 0 },
  };
  recordAttempt(stats, "Card FirstTry", true, { flop: true, recovery: false });
  // First-try flop success should add +3 without reset
  assert.deepStrictEqual(stats["Card FirstTry"], { correct_count: 3, incorrect_count: 0 });
});

test("resetCardStats: resets stats for a given card", () => {
  const stats = {
    "Card A": { correct_count: 5, incorrect_count: 3 },
    "Card B": { correct_count: 2, incorrect_count: 1 },
  };
  resetCardStats(stats, "Card A");
  assert.deepStrictEqual(stats["Card A"], { correct_count: 0, incorrect_count: 0 });
  // Card B should remain unchanged
  assert.deepStrictEqual(stats["Card B"], { correct_count: 2, incorrect_count: 1 });
});

test("resetCardStats: handles non-existent card gracefully", () => {
  const stats = {};
  resetCardStats(stats, "Non-existent");
  assert.deepStrictEqual(stats, {});
});


test("selectFlopDeck: excludes cards never attempted", () => {
  const stats = {
    "Card A": { correct_count: 0, incorrect_count: 0 },
  };
  const allowedCards = ["Card A", "Card B", "Card C"];
  const deck = selectFlopDeck(stats, allowedCards);
  assert.deepStrictEqual(deck, []);
});

test("selectFlopDeck: excludes cards with fewer than 2 total attempts (weak criteria)", () => {
  const stats = {
    "Card A": { correct_count: 1, incorrect_count: 0 }, // 1 attempt, 100% - not weak
    "Card B": { correct_count: 0, incorrect_count: 0 }, // 0 attempts
    "Card C": { correct_count: 0, incorrect_count: 1 }, // 1 attempt, 0% - not weak (too few attempts)
  };
  const allowedCards = ["Card A", "Card B", "Card C"];
  const deck = selectFlopDeck(stats, allowedCards);
  // All cards have too few attempts or are not weak
  assert.deepStrictEqual(deck, []);
});

test("selectFlopDeck: excludes cards with success rate >= 0.7 (healthy cards)", () => {
  const stats = {
    "Card A": { correct_count: 7, incorrect_count: 3 }, // 70%, exactly at threshold - not weak (>= 0.7)
    "Card B": { correct_count: 8, incorrect_count: 2 }, // 80%, healthy
    "Card C": { correct_count: 6, incorrect_count: 4 }, // 60%, weak
  };
  const allowedCards = ["Card A", "Card B", "Card C"];
  const deck = selectFlopDeck(stats, allowedCards);
  // Only Card C qualifies as weak (< 70% success rate and >= 2 attempts)
  assert.deepStrictEqual(deck, ["Card C"]);
});

test("selectFlopDeck: sorts by success rate (correct/(correct+incorrect)) ascending, worst first", () => {
  const stats = {
    "Card A": { correct_count: 1, incorrect_count: 9 }, // 10%, weak
    "Card B": { correct_count: 3, incorrect_count: 7 }, // 30%, weak
    "Card C": { correct_count: 6, incorrect_count: 4 }, // 60%, weak
  };
  const allowedCards = ["Card A", "Card B", "Card C"];
  const deck = selectFlopDeck(stats, allowedCards);
  // All are weak, return all sorted worst first
  assert.deepStrictEqual(deck, ["Card A", "Card B", "Card C"]);
});

test("selectFlopDeck: returns all weak cards, sorted worst first", () => {
  const stats = {};
  const allowedCards = [];
  // Create 20 weak cards (all < 70% success rate, >= 2 attempts)
  // Use correct_count: i, incorrect_count: 30 - i so all cards have < 70% success
  for (let i = 0; i < 20; i++) {
    stats[`Card ${i}`] = { correct_count: i, incorrect_count: 30 - i }; 
    allowedCards.push(`Card ${i}`);
  }
  const deck = selectFlopDeck(stats, allowedCards);
  // All 20 cards are weak (all have success rate < 70%); now we return all of them
  assert.strictEqual(deck.length, 20);
  // Worst first: Card 0 (0%), Card 1 (1/31≈3%), etc.
  assert.deepStrictEqual(deck[0], "Card 0");
  assert.ok(deck.every((card) => card.startsWith("Card")));
});

test("selectFlopDeck: returns all weak cards regardless of count", () => {
  const stats = {};
  const allowedCards = [];
  // Create 400 weak cards all with 0% success rate (0 correct, 2 incorrect)
  for (let i = 0; i < 400; i++) {
    stats[`Card ${i}`] = { correct_count: 0, incorrect_count: 2 };
    allowedCards.push(`Card ${i}`);
  }
  const deck = selectFlopDeck(stats, allowedCards);
  // All 400 cards are weak; no cap, return all
  assert.strictEqual(deck.length, 400);
});

test("selectFlopDeck: returns exactly 1 weak card when exactly 1 weak card exists", () => {
  const stats = {
    "Card A": { correct_count: 1, incorrect_count: 9 }, // 10%, weak
  };
  const allowedCards = ["Card A"];
  const deck = selectFlopDeck(stats, allowedCards);
  assert.deepStrictEqual(deck, ["Card A"]);
});

test("selectFlopDeck: returns all weak cards when exactly 10 weak cards", () => {
  const stats = {};
  const allowedCards = [];
  // Create 10 weak cards with success rates 0% to 45% (all weak: < 70%)
  // Card i has i correct out of (10 - i) incorrect, so i/(10) total attempts = i*10% success
  for (let i = 0; i < 10; i++) {
    stats[`Card ${i}`] = { correct_count: i, incorrect_count: 10 - i };
    allowedCards.push(`Card ${i}`);
  }
  const deck = selectFlopDeck(stats, allowedCards);
  // All 10 are weak (0%, 1/9≈11%, ..., 9/10=90%)... wait, some are not weak
  // Let me create cards where all are weak: use high incorrect counts
  const weakStats = {};
  const weakAllowed = [];
  for (let i = 0; i < 10; i++) {
    // i correct, (30-i) incorrect: gives success rates from 0% to 25%
    weakStats[`Card ${i}`] = { correct_count: i, incorrect_count: 30 - i };
    weakAllowed.push(`Card ${i}`);
  }
  const weakDeck = selectFlopDeck(weakStats, weakAllowed);
  // All 10 are weak, return all
  assert.strictEqual(weakDeck.length, 10);
  assert.deepStrictEqual(weakDeck[0], "Card 0");
  assert.ok(weakDeck.every((card) => card.startsWith("Card")));
});

test("selectFlopDeck: filters by allowedCards and excludes non-weak", () => {
  const stats = {
    "Card A": { correct_count: 7, incorrect_count: 3 }, // 70%, not weak
    "Card B": { correct_count: 1, incorrect_count: 9 }, // 10%, weak
    "Card C": { correct_count: 8, incorrect_count: 2 }, // 80%, not weak
  };
  const allowedCards = ["Card A", "Card B"]; // Card C not allowed
  const deck = selectFlopDeck(stats, allowedCards);
  // Only Card B is weak among allowed cards
  assert.deepStrictEqual(deck, ["Card B"]);
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

test("flopCandidateCards: a sentence card is a candidate even when unspellable", () => {
  const stats = {
    "Das Brot ist frisch.": { correct_count: 0, incorrect_count: 1 },
    Hut: { correct_count: 0, incorrect_count: 1 },
  };
  const candidates = flopCandidateCards(stats, new Set(["m", "l", "t", "g", "o", "a"]), SENTENCE_POOL);
  assert.ok(candidates.includes("Das Brot ist frisch."));
  assert.ok(!candidates.includes("Hut"), "an unspellable word card must stay out");
});

test("flopCandidateCards: sentence cards bypass spellability only when named", () => {
  const stats = { "Das Brot ist frisch.": { correct_count: 0, incorrect_count: 1 } };
  assert.deepStrictEqual(flopCandidateCards(stats, new Set(["m", "l", "t", "g", "o", "a"])), []);
  assert.deepStrictEqual(
    flopCandidateCards(stats, new Set(["m", "l", "t", "g", "o", "a"]), ["Das Brot ist frisch."]),
    ["Das Brot ist frisch."],
  );
});

test("flopCandidateCards: a sentence card stays a candidate with an empty selection", () => {
  const stats = { "Mama malt.": { correct_count: 0, incorrect_count: 1 } };
  assert.deepStrictEqual(flopCandidateCards(stats, [], SENTENCE_POOL), ["Mama malt."]);
  assert.deepStrictEqual(flopCandidateCards({ Hut: stats["Mama malt."] }, [], SENTENCE_POOL), []);
});

test("selectFlopDeck: sentence cards are included among weak cards", () => {
  const stats = {};
  const allowedCards = [];
  // Create 9 healthy words (90% success rate) - not weak
  for (let index = 0; index < 9; index++) {
    stats[`Word ${index}`] = { correct_count: 9, incorrect_count: 1 };
    allowedCards.push(`Word ${index}`);
  }
  // Add a weak sentence (0% success rate, 2 attempts)
  stats["Das Brot ist frisch."] = { correct_count: 0, incorrect_count: 2 };
  allowedCards.push("Das Brot ist frisch.");
  // Only the sentence is weak among 10 candidates, so it's included
  assert.deepStrictEqual(selectFlopDeck(stats, allowedCards), ["Das Brot ist frisch."]);
});

test("buildFlopDeck: a deck with one weak sentence card is usable", () => {
  const stats = { "Das Brot ist frisch.": { correct_count: 0, incorrect_count: 2 } };
  const deck = buildFlopDeck(stats, new Set(["m", "a"]), SENTENCE_POOL);
  assert.deepStrictEqual(deck, [
    { text: "Das Brot ist frisch.", kind: "sentence", misses: 0 },
  ]);
});

test("buildFlopDeck: word cards return all weak ones with their kind", () => {
  const stats = {
    aa: { correct_count: 1, incorrect_count: 9 }, // 10%, weak
    ab: { correct_count: 3, incorrect_count: 7 }, // 30%, weak
    ba: { correct_count: 1, incorrect_count: 9 }, // 10%, weak
  };
  const deck = buildFlopDeck(stats, ["a", "b"]);
  // All 3 are weak, return all
  assert.strictEqual(deck.length, 3);
  // Verify all are words
  assert.ok(deck.every(card => card.kind === "word"));
  // Verify all texts are present
  const texts = new Set(deck.map(d => d.text));
  assert.ok(texts.has("aa"));
  assert.ok(texts.has("ab"));
  assert.ok(texts.has("ba"));
});

test("buildFlopDeck: sentence and word cards return all weak ones with their kind", () => {
  const stats = {};
  // Create 10 weak word cards that are spellable with ["a", "b"]
  for (let index = 0; index < 10; index++) {
    stats[`a${"b".repeat(index + 1)}`] = { correct_count: 1, incorrect_count: 9 }; // 10% weak, spellable
  }
  // Add "Das Brot ist frisch." which is in SENTENCE_POOL with 0% success (weak)
  stats["Das Brot ist frisch."] = { correct_count: 0, incorrect_count: 2 };
  
  const deck = buildFlopDeck(stats, ["a", "b"], SENTENCE_POOL);
  
  // All weak cards are included: 10 words + 1 sentence = 11 total
  assert.strictEqual(deck.length, 11);
  
  // Verify the sentence is included and marked as sentence
  const sentenceCard = deck.find(c => c.text === "Das Brot ist frisch.");
  assert.ok(sentenceCard);
  assert.strictEqual(sentenceCard.kind, "sentence");
  
  // Verify words are marked as word
  const wordCards = deck.filter(c => c.text !== "Das Brot ist frisch.");
  assert.ok(wordCards.every(c => c.kind === "word"));
  assert.strictEqual(wordCards.length, 10);
});

test("selectFlopDeck: returns all weak history cards", () => {
  const stats = {};
  // Create 15 weak cards with success rates from 0% to 50% (all < 70%)
  // Use higher incorrect counts to ensure all are weak
  for (let index = 0; index < 15; index++) {
    stats[`t${index}`] = { correct_count: index, incorrect_count: 30 - index };
  }
  const deck = selectFlopDeck(stats, Object.keys(stats));
  // All 15 cards are weak (< 70%), return all
  assert.strictEqual(deck.length, 15);
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

test("createSeededRandom: the same seed yields the same sequence", () => {
  const first = createSeededRandom(1234);
  const second = createSeededRandom(1234);
  const a = Array.from({ length: 8 }, () => first());
  const b = Array.from({ length: 8 }, () => second());
  assert.deepStrictEqual(a, b);
  assert.ok(a.every((value) => value >= 0 && value < 1));
});

test("buildSentenceOnlyDeck: draws only sentences the selection reads in full", () => {
  const deck = buildSentenceOnlyDeck(SENTENCE_POOL, SMALL_SELECTION, "de", { seed: 7 });
  const texts = deck.map((card) => card.text);
  assert.ok(!texts.includes("Das Brot ist frisch."));
  assert.deepStrictEqual(texts.sort(), ["Mama malt.", "Oma mag Mama."]);
  for (const card of deck) {
    assert.strictEqual(card.kind, "sentence");
    assert.strictEqual(card.misses, 0);
  }
});

test("buildSentenceOnlyDeck: cuts the readable pool to the requested count", () => {
  const deck = buildSentenceOnlyDeck(SENTENCE_POOL, SMALL_SELECTION, "de", { count: 1, seed: 3 });
  assert.strictEqual(deck.length, 1);
  assert.strictEqual(deck[0].kind, "sentence");
});

test("buildSentenceOnlyDeck: an empty pool or selection yields an empty deck", () => {
  assert.deepStrictEqual(buildSentenceOnlyDeck([], SMALL_SELECTION, "de"), []);
  assert.deepStrictEqual(buildSentenceOnlyDeck(null, SMALL_SELECTION, "de"), []);
  assert.deepStrictEqual(buildSentenceOnlyDeck(SENTENCE_POOL, {}, "de"), []);
  assert.deepStrictEqual(buildSentenceOnlyDeck(SENTENCE_POOL, { consonants: [], vowels: [], specials: [] }, "de"), []);
  assert.deepStrictEqual(buildSentenceOnlyDeck(SENTENCE_POOL, SMALL_SELECTION, "de", { count: 0 }), []);
});

test("buildSentenceOnlyDeck: the same seed yields the same deck", () => {
  const pool = Array.from({ length: 20 }, (_, index) => ({ text: `Mama malt ${index}.` }));
  const first = buildSentenceOnlyDeck(pool, SMALL_SELECTION, "de", { seed: 99 });
  const second = buildSentenceOnlyDeck(pool, SMALL_SELECTION, "de", { seed: 99 });
  assert.deepStrictEqual(first, second);
  assert.strictEqual(first.length, pool.length);
});

test("buildMixedDeck: alternates sentence and word cards", () => {
  const deck = buildMixedDeck(SENTENCE_POOL, SMALL_SELECTION, "de", WORDS, { count: 4, seed: 5 });
  assert.strictEqual(deck.length, 4);
  assert.ok(alternates(deck), `kinds do not alternate: ${kinds(deck).join(",")}`);
  assert.strictEqual(new Set(kinds(deck)).size, 2);
});

test("buildMixedDeck: the same seed yields the same order and kinds", () => {
  const first = buildMixedDeck(SENTENCE_POOL, SMALL_SELECTION, "de", WORDS, { count: 4, seed: 42 });
  const second = buildMixedDeck(SENTENCE_POOL, SMALL_SELECTION, "de", WORDS, { count: 4, seed: 42 });
  assert.deepStrictEqual(first, second);
});

test("buildMixedDeck: only mixes sentences the selection reads in full", () => {
  for (let seed = 0; seed < 25; seed++) {
    const deck = buildMixedDeck(SENTENCE_POOL, SMALL_SELECTION, "de", WORDS, { seed });
    const texts = deck.map((card) => card.text);
    assert.ok(!texts.includes("Das Brot ist frisch."), "unreadable sentence in mixed deck");
  }
});

test("buildMixedDeck: an empty pool, selection or word list yields an empty deck", () => {
  assert.deepStrictEqual(buildMixedDeck([], SMALL_SELECTION, "de", WORDS), []);
  assert.deepStrictEqual(buildMixedDeck(SENTENCE_POOL, {}, "de", WORDS), []);
  assert.deepStrictEqual(buildMixedDeck(SENTENCE_POOL, SMALL_SELECTION, "de", []), []);
  assert.deepStrictEqual(buildMixedDeck(SENTENCE_POOL, SMALL_SELECTION, "de", WORDS, { count: 0 }), []);
});

test("buildMixedDeck: never groups one kind when the other runs out", () => {
  // Two readable sentences and many words: strict alternation ends at 4 cards.
  const deck = buildMixedDeck(SENTENCE_POOL, SMALL_SELECTION, "de", WORDS, { count: 10, seed: 11 });
  assert.strictEqual(deck.length, 4);
  assert.ok(alternates(deck));
});

test("buildMixedDeck: cards carry their kind and start with no misses", () => {
  const deck = buildMixedDeck(SENTENCE_POOL, SMALL_SELECTION, "de", WORDS, { seed: 8 });
  assert.ok(deck.length > 0);
  for (const card of deck) {
    assert.ok(card.kind === "word" || card.kind === "sentence", `unexpected kind ${card.kind}`);
    assert.strictEqual(card.misses, 0);
    assert.strictEqual(typeof card.text, "string");
    assert.ok(card.text.length > 0);
  }
});

// Recovery and weakness filtering comprehensive tests
test("recovery: recovered card is reset and absent from next flop deck", () => {
  // Scenario: card has misses, is answered correctly with recovery, then should not appear in next deck
  const stats = {
    "weak-card": { correct_count: 0, incorrect_count: 3 }, // 0%, weak
  };
  // Initial flop deck includes it
  let deck = selectFlopDeck(stats, ["weak-card"]);
  assert.deepStrictEqual(deck, ["weak-card"]);
  
  // User answers correctly with recovery flag set
  recordAttempt(stats, "weak-card", true, { flop: true, recovery: true });
  assert.deepStrictEqual(stats["weak-card"], { correct_count: 0, incorrect_count: 0 });
  
  // Next flop deck should not include it (0 attempts)
  deck = selectFlopDeck(stats, ["weak-card"]);
  assert.deepStrictEqual(deck, []);
});

test("recovery: first-try flop success keeps +3 and is not reset", () => {
  // Scenario: card is answered correctly on first try in flop mode
  const stats = {
    "first-try": { correct_count: 0, incorrect_count: 0 },
  };
  recordAttempt(stats, "first-try", true, { flop: true, recovery: false });
  // Should add +3 without reset
  assert.deepStrictEqual(stats["first-try"], { correct_count: 3, incorrect_count: 0 });
  // It will have 3 attempts (all correct), so success rate = 100%, not weak
  const deck = selectFlopDeck(stats, ["first-try"]);
  assert.deepStrictEqual(deck, []);
});

test("weak filtering: cards below 70% success rate are weak", () => {
  const stats = {
    "weak-69": { correct_count: 69, incorrect_count: 31 }, // 69%, weak
    "weak-60": { correct_count: 6, incorrect_count: 4 },   // 60%, weak
    "weak-50": { correct_count: 5, incorrect_count: 5 },   // 50%, weak
    "weak-40": { correct_count: 4, incorrect_count: 6 },   // 40%, weak
    "healthy-70": { correct_count: 70, incorrect_count: 30 }, // 70%, not weak (at threshold)
    "healthy-80": { correct_count: 8, incorrect_count: 2 }, // 80%, not weak
  };
  const weak = selectFlopDeck(stats, Object.keys(stats));
  // All 4 weak cards are returned
  assert.strictEqual(weak.length, 4);
  // Worst first: 40%, 50%, 60%, 69%
  assert.deepStrictEqual(weak, ["weak-40", "weak-50", "weak-60", "weak-69"]);
});

test("weak filtering: cards with fewer than 2 attempts are not weak", () => {
  const stats = {
    "single-attempt-fail": { correct_count: 0, incorrect_count: 1 }, // 0%, but only 1 attempt
    "single-attempt-pass": { correct_count: 1, incorrect_count: 0 }, // 100%, but only 1 attempt
    "two-attempts-weak": { correct_count: 0, incorrect_count: 2 },   // 0%, 2 attempts - weak
  };
  const weak = selectFlopDeck(stats, Object.keys(stats));
  assert.ok(!weak.includes("single-attempt-fail"), "single failed attempt should not qualify");
  assert.ok(!weak.includes("single-attempt-pass"), "single passed attempt should not qualify");
  assert.ok(weak.includes("two-attempts-weak"), "two weak attempts should qualify");
});

test("weak filtering: empty result when no genuinely weak cards", () => {
  const stats = {
    "healthy-1": { correct_count: 8, incorrect_count: 2 },  // 80%, healthy
    "healthy-2": { correct_count: 7, incorrect_count: 3 },  // 70%, at threshold
    "one-attempt": { correct_count: 0, incorrect_count: 1 }, // too few attempts
  };
  const weak = selectFlopDeck(stats, Object.keys(stats));
  assert.deepStrictEqual(weak, []);
});

test("weak filtering: returns all weak cards regardless of count", () => {
  // Test with only 1 weak card available
  let stats = {
    "only-weak": { correct_count: 0, incorrect_count: 2 },  // weak
    "healthy": { correct_count: 9, incorrect_count: 1 },    // healthy
  };
  let weak = selectFlopDeck(stats, Object.keys(stats));
  assert.strictEqual(weak.length, 1);
  assert.deepStrictEqual(weak, ["only-weak"]);

  // Test with 400 weak cards: all are returned (no cap)
  stats = {};
  const allowedCards = [];
  for (let i = 0; i < 400; i++) {
    stats[`Card ${i}`] = { correct_count: 0, incorrect_count: 2 }; // all weak (0%, >= 2 attempts)
    allowedCards.push(`Card ${i}`);
  }
  weak = selectFlopDeck(stats, allowedCards);
  assert.strictEqual(weak.length, 400);
});

const setupHtml = readFileSync(new URL("../static/index.html", import.meta.url), "utf8");

test("the Karten tab offers a sentence mode in the single mode group", () => {
  assert.match(setupHtml, /<input type="radio" name="mode" value="SENTENCES">/);
  assert.doesNotMatch(setupHtml, /<input type="radio" name="deck"/);
  assert.doesNotMatch(setupHtml, /value="MIXED"/);
  assert.match(setupHtml, /id="mode-sentences-title"/);
});

test("the Karten tab builds the sentence deck through the scoring module", () => {
  assert.match(setupHtml, /window\.__scoring\.buildSentenceOnlyDeck\(/);
  assert.doesNotMatch(setupHtml, /buildMixedDeck/);
  assert.match(setupHtml, /buildSentenceOnlyDeck,?\s*.*? \} from '\.\/scoring\.mjs'/);
});

test("the Flops mode builds a kind-aware deck from the active sentence pool", () => {
  assert.match(setupHtml, /buildFlopDeck.*?buildSentenceOnlyDeck.*? \} from '\.\/scoring\.mjs'/);
  assert.match(setupHtml, /sentenceTexts\[lang\] = new Set\(/);
  assert.match(setupHtml, /buildFlopDeck\(stats, allowedSounds, sentenceTexts\[currentLanguage\] \|\| \[\]\)/);
  assert.match(setupHtml, /queue = shuffle\(flopDeck\);/);
});

test("regression: word flop candidates keep the old spellability filter", () => {
  const stats = {
    ta: { correct_count: 1, incorrect_count: 1 },
    am: { correct_count: 0, incorrect_count: 1 },
    Hut: { correct_count: 0, incorrect_count: 1 },
    "Mama malt.": { correct_count: 0, incorrect_count: 1 },
  };
  const sounds = new Set(["t", "m", "a"]);
  const expected = Object.keys(stats).filter((text) => isSpellableWith(text, sounds));
  assert.deepStrictEqual(expected, ["ta", "am"]);
  assert.deepStrictEqual(flopCandidateCards(stats, sounds), expected);
  assert.deepStrictEqual(flopCandidateCards(stats, sounds, []), expected);
});

test("regression: a word-only flop deck is exactly the weak selectFlopDeck result", () => {
  const stats = {
    aa: { correct_count: 1, incorrect_count: 9 }, // 10%, weak
    ab: { correct_count: 3, incorrect_count: 7 }, // 30%, weak
    ba: { correct_count: 1, incorrect_count: 9 }, // 10%, weak
  };
  const legacy = selectFlopDeck(stats, Object.keys(stats));
  assert.deepStrictEqual(
    buildFlopDeck(stats, ["a", "b"]),
    legacy.map((text) => ({ text, kind: "word", misses: 0 })),
  );
  assert.deepStrictEqual(buildFlopDeck(stats, ["a", "b"], []), buildFlopDeck(stats, ["a", "b"]));
});

test("regression: the sentence deck builders do not mutate the pool or word cards", () => {
  const pool = SENTENCE_POOL.map((entry) => ({ ...entry }));
  const words = [...WORDS];
  const poolBefore = JSON.stringify(pool);
  const wordsBefore = JSON.stringify(words);

  buildSentenceOnlyDeck(pool, SMALL_SELECTION, "de", { seed: 1 });
  buildMixedDeck(pool, SMALL_SELECTION, "de", words, { seed: 1 });

  assert.strictEqual(JSON.stringify(pool), poolBefore);
  assert.strictEqual(JSON.stringify(words), wordsBefore);
});

test("regression: a word deck after a sentence deck still contains only words", () => {
  buildSentenceOnlyDeck(SENTENCE_POOL, SMALL_SELECTION, "de", { seed: 2 });
  const stats = {
    aa: { correct_count: 1, incorrect_count: 1 },
    ab: { correct_count: 0, incorrect_count: 1 },
  };
  const deck = buildFlopDeck(stats, ["a", "b"]);
  assert.ok(deck.length > 0);
  assert.ok(deck.every((card) => card.kind === "word"));
});

test("the sentence mode keeps no manual selection state behind", () => {
  assert.doesNotMatch(setupHtml, /sentenceSelection/);
  assert.doesNotMatch(setupHtml, /clearSentenceSelection/);
  assert.doesNotMatch(setupHtml, /id="sentences-clear"/);
  assert.match(setupHtml, /applySentenceCount\(cards\.length\)/);
});

test("regression: the patterns mode stays the default", () => {
  assert.match(setupHtml, /name="mode" value="PATTERNS"\s+checked/);
  for (const value of ["PATTERNS", "WORDS", "SENTENCES", "FLOP"]) {
    assert.match(setupHtml, new RegExp(`name="mode" value="${value}"`));
  }
});

test("isSpeakableCard: returns true for word cards", () => {
  assert.strictEqual(isSpeakableCard({ text: "hello", kind: "word" }), true);
});

test("isSpeakableCard: returns true for sentence cards", () => {
  assert.strictEqual(isSpeakableCard({ text: "Hello world.", kind: "sentence" }), true);
});

test("isSpeakableCard: returns false for pattern cards", () => {
  assert.strictEqual(isSpeakableCard({ text: "ma", kind: "pattern" }), false);
});

test("isSpeakableCard: returns false for cards without kind", () => {
  assert.strictEqual(isSpeakableCard({ text: "hello" }), false);
});

test("isSpeakableCard: returns false for null", () => {
  assert.strictEqual(isSpeakableCard(null), false);
});

test("isSpeakableCard: returns false for undefined", () => {
  assert.strictEqual(isSpeakableCard(undefined), false);
});

test("isSpeakableCard: returns false for unknown kind", () => {
  assert.strictEqual(isSpeakableCard({ text: "test", kind: "unknown" }), false);
});

test("full flop round: after correct answers to all flop deck cards, deck is empty", () => {
  // Create 50 weak word cards all with 0% success rate
  const stats = {};
  const allowedCards = [];
  for (let i = 0; i < 50; i++) {
    stats[`weak-word-${i}`] = { correct_count: 0, incorrect_count: 2 };
    allowedCards.push(`weak-word-${i}`);
  }

  // Build the initial flop deck
  let deck = buildFlopDeck(stats, new Set(allowedCards.slice(0, 26))); // subset of 26 cards are "spellable"
  const initialDeckSize = deck.length;
  
  // Simulate a complete round: every card is answered correctly at least once
  // This tests that:
  // 1. All weak cards start in the deck
  // 2. Each card answered correctly resets its stats (recovery: true in flop mode)
  // 3. After full round with all correct answers, a fresh call to buildFlopDeck returns empty
  for (const card of deck) {
    recordAttempt(stats, card.text, true, { flop: true, recovery: true });
  }

  // After all cards are correctly answered in flop mode with recovery, their stats should be reset (0, 0)
  // So they are no longer weak (< 2 attempts or >= 70% success)
  const newDeck = buildFlopDeck(stats, new Set(allowedCards.slice(0, 26)));
  
  // Verify the deck is now empty
  assert.strictEqual(newDeck.length, 0, `Expected empty deck after completing all ${initialDeckSize} flop cards, but got ${newDeck.length}`);
});


test('startup: the 4.5 MB sentence pool stays off the critical startup path', async () => {
  const readStatic = name => readFileSync(new URL(`../static/${name}`, import.meta.url), 'utf8');
  const html = readStatic('index.html');

  assert.match(html, /function scheduleSentencePool\(\)/);
  assert.match(
    html,
    /if \(sentencePoolScheduled \|\| Object\.keys\(stats\)\.length === 0\) return;/,
    'a fresh install has no history, so the pool must not be fetched at all',
  );
  assert.match(html, /requestIdleCallback\(load, \{ timeout: 2000 \}\)/, 'load the pool while idle, not during startup');
  assert.match(html, /function runHeavyCounts\(\) \{\s*scheduleSentencePool\(\);/, 'startup counting must not await the pool');

  // The counts worker keeps its own copy, so the match counts never depend on
  // the main thread having loaded the pool.
  const worker = readStatic('counts-worker.mjs');
  assert.match(worker, /loadSentences\(lang\)/);
});
