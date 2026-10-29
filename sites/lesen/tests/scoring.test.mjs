import test from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { recordAttempt, selectFlopDeck, flopCandidateCards, isSpellableWith, buildSentenceOnlyDeck, buildMixedDeck, createSeededRandom } from "../static/scoring.mjs";

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

const setupHtml = readFileSync(new URL("../static/index.html", import.meta.url), "utf8");

test("the Karten tab offers a sentence-only and a mixed deck", () => {
  assert.match(setupHtml, /<input type="radio" name="deck" value="SENTENCES">/);
  assert.match(setupHtml, /<input type="radio" name="deck" value="MIXED">/);
  assert.match(setupHtml, /id="deck-sentences-title"/);
  assert.match(setupHtml, /id="deck-mixed-title"/);
});

test("the Karten tab builds both decks through the scoring module", () => {
  assert.match(setupHtml, /window\.__scoring\.buildSentenceOnlyDeck\(/);
  assert.match(setupHtml, /window\.__scoring\.buildMixedDeck\(/);
  assert.match(setupHtml, /buildSentenceOnlyDeck, buildMixedDeck \} from '\.\/scoring\.mjs'/);
});
