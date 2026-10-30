/**
 * Deterministic generator for the sentence pool in static/sentences/{de,en}.json.
 *
 * The pool is owner-curated content, so this tool only *extends* it: it expands a
 * curated vocabulary into grammatical, child-appropriate sentences of at most six
 * words, computes the metadata the app relies on (stage, required units, word
 * count) with the same tokenizer as `validate_sentences.mjs`, and appends compact
 * one-line entries to a pool file without reformatting the hand-written part.
 *
 * Two modes:
 *   dump   print a JSON array of generated entries (for tests and inspection)
 *   append surgically append `--count` new entries to a pool file and update its
 *          count field, so the diff stays small enough for the harness review cap
 *
 * The candidate stream is ordered and deterministic, so repeated runs produce the
 * same sentences; an append skips texts that are already present in the file, so
 * sequential chunks never repeat a sentence.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { stageOf, unitsOf, MAX_WORDS } from "./validate_sentences.mjs";

// ---------------------------------------------------------------------------
// Curated vocabulary. Every word stays inside the language's sound inventory
// (a-z, plus German umlauts and ß) so every generated sentence is readable in
// at least one stage. Subjects are third-person singular, verbs are their
// third-person singular forms, and complements are grouped by verb class so
// every combination is grammatical.
// ---------------------------------------------------------------------------
const VOCAB = {
  de: {
    subjects: [
      "Lisa", "Mama", "Papa", "Tim", "Anna", "Emma", "Ben", "Mia",
      "der Hund", "die Katze", "das Kind", "der Mann", "die Frau",
      "der Vogel", "die Maus", "das Pferd", "der Fisch", "die Kuh",
      "das Schaf", "der Bär", "die Ente", "der Fuchs", "die Biene",
      "das Huhn", "der Löwe",
    ],
    verbs: {
      loc: [
        "schläft", "sitzt", "steht", "spielt", "tanzt", "rennt", "lacht",
        "weint", "arbeitet", "singt", "malt", "liest", "lernt", "kocht",
        "sucht", "findet", "wartet", "ruht", "geht", "schwimmt", "springt",
      ],
      food: ["isst", "trinkt", "kocht", "backt"],
      obj: [
        "liest", "malt", "singt", "sucht", "findet", "bringt", "holt",
        "kauft", "pflanzt", "erntet", "zählt", "öffnet", "wäscht", "macht",
        "sieht", "hört",
      ],
    },
    complements: {
      loc: [
        "im Garten", "im Haus", "am Tisch", "im Bett", "auf dem Sofa",
        "in der Schule", "im Park", "am See", "im Wald", "auf der Wiese",
        "im Schnee", "im Regen", "in der Sonne", "",
      ],
      food: ["einen Apfel", "eine Birne", "Brot", "Kuchen", "Suppe", "Wasser", "Milch", "Kakao", "Tee", ""],
      obj: ["ein Buch", "eine Blume", "ein Lied", "einen Ball", "einen Brief", "eine Tür", ""],
    },
  },
  en: {
    subjects: [
      "Lisa", "Mom", "Dad", "Tim", "Anna", "Emma", "Ben", "Mia",
      "the dog", "the cat", "the kid", "the man", "the woman",
      "the bird", "the mouse", "the horse", "the fish", "the cow",
      "the sheep", "the bear", "the duck", "the fox", "the bee",
      "the hen", "the lion",
    ],
    verbs: {
      loc: [
        "sleeps", "sits", "stands", "plays", "dances", "runs", "laughs",
        "cries", "works", "sings", "paints", "reads", "learns", "cooks",
        "searches", "finds", "waits", "rests", "swims", "jumps",
      ],
      food: ["eats", "drinks", "cooks", "bakes"],
      obj: [
        "reads", "paints", "sings", "searches", "finds", "brings", "fetches",
        "buys", "plants", "harvests", "counts", "opens", "washes", "makes",
        "sees", "hears",
      ],
    },
    complements: {
      loc: [
        "in the garden", "in the house", "at the table", "in bed",
        "on the sofa", "at school", "in the park", "at the lake",
        "in the woods", "in the snow", "in the rain", "in the sun", "",
      ],
      food: ["an apple", "a pear", "bread", "cake", "soup", "water", "milk", "cocoa", "tea", ""],
      obj: ["a book", "a flower", "a song", "a ball", "a letter", "a door", ""],
    },
  },
};

/** Capitalise the first letter of a string. */
function capitalize(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Expand the vocabulary into the ordered candidate stream: subject, then verb
 * class, then verb, then complement. The order is deterministic.
 */
export function candidates(lang) {
  const vocab = VOCAB[lang];
  if (!vocab) throw new Error("unsupported language " + lang);
  const out = [];
  for (const subject of vocab.subjects) {
    for (const cls of ["loc", "food", "obj"]) {
      for (const verb of vocab.verbs[cls]) {
        for (const complement of vocab.complements[cls]) {
          const words = complement ? [subject, verb, complement] : [subject, verb];
          out.push(capitalize(words.join(" ")) + ".");
        }
      }
    }
  }
  return out;
}

/** Keep the first occurrence of each lowercased text, preserving order. */
export function dedupe(list) {
  const seen = new Set();
  const out = [];
  for (const text of list) {
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  return out;
}

/** Build one pool entry with the metadata the app relies on. */
export function entryFor(lang, id, text) {
  const words = text.trim().split(/\s+/).length;
  if (words > MAX_WORDS) throw new Error(id + ": " + words + " words, at most " + MAX_WORDS + " allowed");
  return { id, text, stage: stageOf(text, lang), words, required: unitsOf(text, lang) };
}

/**
 * The new entries an append would add: the first `count` candidates not already
 * present in `existing` (lowercased texts), starting ids at `maxId + 1`.
 */
export function nextEntries(lang, count, existing, maxId) {
  const have = new Set([...(existing || [])].map((text) => String(text).toLowerCase()));
  const picked = [];
  for (const text of dedupe(candidates(lang))) {
    if (picked.length >= count) break;
    if (have.has(text.toLowerCase())) continue;
    have.add(text.toLowerCase());
    picked.push(text);
  }
  if (picked.length < count) {
    throw new Error("only " + picked.length + " unique sentences available, wanted " + count);
  }
  return picked.map((text, index) => entryFor(lang, lang + "-" + String(maxId + 1 + index).padStart(3, "0"), text));
}

/** Read a pool file and report its entries, existing texts, and next id. */
export function readPool(file) {
  const data = JSON.parse(readFileSync(file, "utf8"));
  const existing = data.sentences.map((entry) => entry.text);
  let maxId = 0;
  for (const entry of data.sentences) {
    const match = /^[a-z]{2}-(\d+)$/.exec(entry.id || "");
    if (match) maxId = Math.max(maxId, parseInt(match[1], 10));
  }
  return { data, existing, maxId };
}

/**
 * Append `count` new entries to a pool file without reformatting the
 * hand-written part: the file keeps its existing layout, new entries are one
 * compact JSON line each (at the existing two-space entry indent), and the
 * `count` field is updated in place.
 */
export function append(file, lang, count) {
  const { data, existing, maxId } = readPool(file);
  const entries = nextEntries(lang, count, existing, maxId);
  const newTotal = data.sentences.length + entries.length;

  let raw = readFileSync(file, "utf8");
  raw = raw.replace(/"count":\s*\d+\s*,/, '"count": ' + newTotal + ",");

  // The sentence array is the last array in the file: it closes with the only
  // one-space-indented "] }" tail, so that marker is unambiguous.
  const closeAt = raw.lastIndexOf("\n ]\n}");
  if (closeAt === -1) throw new Error("pool file does not end with the sentence array");
  const lines = entries.map((entry) => "  " + JSON.stringify(entry)).join(",\n");
  raw = raw.slice(0, closeAt) + ",\n" + lines + raw.slice(closeAt);
  writeFileSync(file, raw);

  const check = JSON.parse(readFileSync(file, "utf8"));
  if (check.sentences.length !== newTotal) {
    throw new Error("pool file count mismatch after append: " + check.sentences.length + " vs " + newTotal);
  }
  return entries.length;
}

function parseArgs(argv) {
  const args = { lang: null, count: null, file: null, mode: null };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === "--lang") args.lang = next;
    else if (arg === "--count") args.count = parseInt(next, 10);
    else if (arg === "--file") args.file = next;
    else if (arg === "dump" || arg === "append") args.mode = arg;
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.mode || !args.lang) {
    console.error("usage: node generate_sentences.mjs <dump|append> --lang <de|en> [--count N] [--file PATH]");
    process.exit(2);
  }
  if (args.mode === "dump") {
    const count = args.count && args.count > 0 ? args.count : 10;
    const entries = nextEntries(args.lang, count, [], 0);
    process.stdout.write(JSON.stringify(entries, null, 2) + "\n");
    return;
  }
  if (!args.file) {
    console.error("append needs --file PATH");
    process.exit(2);
  }
  if (!Number.isInteger(args.count) || args.count <= 0) {
    console.error("append needs a positive --count");
    process.exit(2);
  }
  const file = resolve(process.cwd(), args.file);
  const added = append(file, args.lang, args.count);
  console.log("appended " + added + " " + args.lang + " sentences to " + args.file);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
