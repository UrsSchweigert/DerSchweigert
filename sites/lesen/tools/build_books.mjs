/**
 * Build the compact per-language coverage tables for every shipped book.
 *
 * Reads `books-src/sources.json`, extracts each EPUB's sentences with
 * `tools/epub.mjs` (the only place segmentation happens), and writes one
 * coverage table per book under `static/books/<id>.json` using the compact
 * format defined by `static/books.mjs`:
 *
 *   { language, units, words: [{ w, n, m }], sentences: [mask, ...] }
 *
 * where `units` is the ordered unit index list, `words` is one row per
 * distinct word (text `w`, token count `n`, unit mask `m`) and `sentences` is
 * one unit mask per sentence. Masks are decimal strings in the JSON form.
 *
 * This script is pure Node (no DOM); it is the only writer of `static/books/`.
 *
 *   node tools/build_books.mjs                 # write static/books/<id>.json
 *   node tools/build_books.mjs --out DIR       # write elsewhere (for checks)
 */

import { readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { inflateRawSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { parsePackage, extractBlocks } from "./epub.mjs";
import { buildCoverageTable, serializeTable } from "../static/books.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

/**
 * The reading sentences of one EPUB, in spine order. Sentence segmentation is
 * `tools/epub.mjs`'s job (section 5.5 / D13): we only collect its `sentences`.
 *
 * @param {Buffer|Uint8Array} epubBytes the EPUB archive bytes
 * @returns {string[]} every sentence across every non-navigation document
 */
export function sentencesOfBook(epubBytes) {
  const { documents } = parsePackage(epubBytes, { inflate: inflateRawSync });
  const sentences = [];
  for (const document of documents) {
    const { blocks } = extractBlocks(document.xhtml, { navigation: document.navigation });
    for (const block of blocks) {
      sentences.push(...block.sentences);
    }
  }
  return sentences;
}

/**
 * Build the in-memory coverage table for one EPUB.
 *
 * @param {Buffer|Uint8Array} epubBytes the EPUB archive bytes
 * @param {string} language 'de' or 'en' (matches the book's `lang`)
 * @returns {ReturnType<typeof buildCoverageTable>} the coverage table
 */
export function coverageTableForBook(epubBytes, language) {
  return buildCoverageTable(language, sentencesOfBook(epubBytes));
}

/**
 * Build every shipped book's coverage table and write it as compact JSON.
 *
 * @param {object} options
 * @param {string} [options.sourcesPath] path to `sources.json`
 * @param {string} [options.booksDir] directory the EPUB files live in
 * @param {string} [options.outDir] directory to write `<id>.json` tables into
 * @returns {Promise<Array<{ id: string, language: string, words: number, sentences: number }>>}
 */
export async function buildAll({
  sourcesPath = join(root, "books-src", "sources.json"),
  booksDir = join(root, "books-src"),
  outDir = join(root, "static", "books"),
} = {}) {
  const sources = JSON.parse(readFileSync(sourcesPath, "utf8"));
  await mkdir(outDir, { recursive: true });
  const written = [];
  for (const book of sources.books) {
    const bytes = await readFile(join(booksDir, book.file));
    const table = coverageTableForBook(bytes, book.lang);
    await writeFile(join(outDir, `${book.id}.json`), `${serializeTable(table)}\n`, "utf8");
    written.push({ id: book.id, language: book.lang, words: table.words.length, sentences: table.sentences.length });
  }
  return written;
}

// CLI entry: `node tools/build_books.mjs [--out DIR]`.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const outFlag = process.argv.indexOf("--out");
  const options = outFlag >= 0 && process.argv[outFlag + 1] ? { outDir: resolve(process.argv[outFlag + 1]) } : {};
  const written = await buildAll(options);
  for (const row of written) {
    console.log(`${row.id} (${row.language}): ${row.words} word types, ${row.sentences} sentences`);
  }
}
