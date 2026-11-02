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
import { VOCAB } from "./sentence_vocab.mjs";

// ---------------------------------------------------------------------------
// Curated vocabulary lives in sentence_vocab.mjs. Subjects carry ability groups
// and each verb lists complements per group, so a candidate only combines a
// subject with a verb and complement that make sense together.
// ---------------------------------------------------------------------------

/** Capitalise the first letter of a string. */
function capitalize(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Complements a verb allows for one subject: the first matching group wins. */
function complementsFor(verb, subject) {
  const group = Object.keys(verb.c).find((key) => key === "any" || subject.g.includes(key));
  if (!group) return [];
  return verb.c[group].flatMap((item) => (item === "$diet" ? subject.diet : item === "$drink" ? subject.drink : [item]));
}

/** The conjugated verb for a subject, or "" when the subject cannot use it. */
function verbFor(verb, subject) {
  if (verb.v === "$sound") return subject.sound;
  if (typeof verb.v === "string") return verb.v;
  return subject.g.includes("H") ? verb.v.H : verb.v.default;
}

/**
 * Expand the vocabulary into the ordered candidate stream. Plain sentences come
 * first, then the same sentences with one adverb each. Within a block the order
 * rotates through subjects so a truncated stream stays varied. Deterministic.
 */
export function candidates(lang) {
  const vocab = VOCAB[lang];
  if (!vocab) throw new Error("unsupported language " + lang);
  const out = [];
  const variants = [null, ...vocab.adverbs];
  for (const adverb of variants) {
    for (const verb of vocab.verbs) {
      if (adverb && verb.advOnly && !verb.advOnly.includes(adverb.w)) continue;
      const lists = vocab.subjects.map((subject) => {
        const form = verbFor(verb, subject);
        return form ? complementsFor(verb, subject).map((complement) => ({ subject, form, complement })) : [];
      });
      const longest = Math.max(0, ...lists.map((list) => list.length));
      for (let index = 0; index < longest; index++) {
        for (const list of lists) {
          if (index >= list.length) continue;
          const { subject, form, complement } = list[index];
          const parts = [subject.t];
          if (adverb && adverb.pos === "pre") parts.push(adverb.w);
          parts.push(form);
          if (adverb && adverb.pos === "verb") parts.push(adverb.w);
          if (complement) parts.push(complement);
          if (adverb && adverb.pos === "end") parts.push(adverb.w);
          const words = parts.join(" ");
          if (words.split(" ").length <= MAX_WORDS) out.push(capitalize(words) + ".");
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
