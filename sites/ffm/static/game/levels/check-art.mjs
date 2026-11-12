// Validates the level-background manifest and, with --all, any committed
// level-<NN>.webp files. The manifest alone must validate without any image on
// disk, so this phase passes before the owner delivers the level art. With
// --provenance it audits PROVENANCE.md when present and only reports levels
// that have no row yet, so it passes before and after delivery.
import { readFile, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const manifestPath = join(here, 'manifest.json');
const provenancePath = join(here, 'PROVENANCE.md');

const WIDTH = 1536;
const HEIGHT = 1024;
const BYTE_BUDGET = 409600;
const CHAPTERS = ['I', 'II', 'III', 'IV', 'V', 'VI'];
const LEVEL_COUNT = 60;

const pad = (n) => String(n).padStart(2, '0');
const chapterFor = (n) => CHAPTERS[Math.floor((n - 1) / 10)];

// Parses width/height from a WebP bitstream without a decoder. Handles the
// three container forms: VP8 (lossy), VP8L (lossless) and VP8X (extended).
function readDimensions(buf) {
  if (buf.length < 30) throw new Error('file is too small to be WebP');
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WEBP') {
    throw new Error('not a WebP file (missing RIFF/WEBP header)');
  }
  const chunk = buf.toString('ascii', 12, 16);
  if (chunk === 'VP8 ') {
    // Lossy: 3-byte frame tag at 20, key-frame start code 9D 01 2A at 23,
    // then 14-bit little-endian width and height at 26 and 28.
    if (buf.readUIntBE(23, 3) !== 0x9d012a) throw new Error('VP8 key frame header not found');
    return {
      width: buf.readUInt16LE(26) & 0x3fff,
      height: buf.readUInt16LE(28) & 0x3fff,
    };
  }
  if (chunk === 'VP8L') {
    // Lossless: 0x2F signature at 20, then a 32-bit word with width-1 in the
    // low 14 bits and height-1 in the next 14 bits.
    const bits = buf.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  if (chunk === 'VP8X') {
    // Extended: 1 flag byte at 20, 3 reserved bytes, then 24-bit width-1 and
    // height-1 little-endian values.
    return {
      width: 1 + buf.readUIntLE(24, 3),
      height: 1 + buf.readUIntLE(27, 3),
    };
  }
  throw new Error(`unsupported WebP chunk ${JSON.stringify(chunk)}`);
}

async function validateManifest() {
  let raw;
  try {
    raw = JSON.parse(await readFile(manifestPath, 'utf8'));
  } catch (err) {
    throw new Error(`cannot read manifest.json: ${err.message}`);
  }
  const errors = [];
  if (raw.width !== WIDTH) errors.push(`width must be ${WIDTH}, got ${raw.width}`);
  if (raw.height !== HEIGHT) errors.push(`height must be ${HEIGHT}, got ${raw.height}`);
  if (raw.byteBudget !== BYTE_BUDGET) errors.push(`byteBudget must be ${BYTE_BUDGET}, got ${raw.byteBudget}`);

  const levels = raw.levels;
  if (!levels || typeof levels !== 'object' || Array.isArray(levels)) {
    errors.push('levels must be an object keyed "1".."60"');
  } else {
    const keys = Object.keys(levels);
    const expected = Array.from({ length: LEVEL_COUNT }, (_, i) => String(i + 1));
    if (keys.length !== LEVEL_COUNT || keys.some((key, i) => key !== expected[i])) {
      errors.push(`levels must have keys ${expected[0]}..${expected[expected.length - 1]} in order`);
    }
    for (let n = 1; n <= LEVEL_COUNT; n++) {
      const entry = levels[String(n)];
      if (!entry) {
        errors.push(`level ${n} has no entry`);
        continue;
      }
      const file = `level-${pad(n)}.webp`;
      if (entry.file !== file) errors.push(`level ${n} file must be ${file}, got ${entry.file}`);
      const chapter = chapterFor(n);
      if (entry.chapter !== chapter) errors.push(`level ${n} chapter must be ${chapter}, got ${entry.chapter}`);
    }
    for (const chapter of CHAPTERS) {
      const count = Object.values(levels).filter((entry) => entry?.chapter === chapter).length;
      if (count !== 10) errors.push(`chapter ${chapter} must have 10 levels, got ${count}`);
    }
  }
  if (errors.length > 0) throw new Error(errors.join('\n'));
  return raw;
}

async function runManifest() {
  await validateManifest();
  console.log(`manifest ok: levels 1-${LEVEL_COUNT}, ${WIDTH}x${HEIGHT}, ${BYTE_BUDGET}-byte budget`);
}

async function runAll() {
  await validateManifest();
  let invalid = false;
  for (let n = 1; n <= LEVEL_COUNT; n++) {
    const file = `level-${pad(n)}.webp`;
    const path = join(here, file);
    const info = await stat(path).catch(() => null);
    if (!info?.isFile()) {
      console.log(`missing ${file}`);
      continue;
    }
    if (info.size > BYTE_BUDGET) {
      console.log(`oversized ${file}: ${info.size} bytes > ${BYTE_BUDGET}`);
      invalid = true;
      continue;
    }
    let dims;
    try {
      dims = readDimensions(await readFile(path));
    } catch (err) {
      console.log(`invalid ${file}: ${err.message}`);
      invalid = true;
      continue;
    }
    if (dims.width !== WIDTH || dims.height !== HEIGHT) {
      console.log(`wrong size ${file}: ${dims.width}x${dims.height}, expected ${WIDTH}x${HEIGHT}`);
      invalid = true;
      continue;
    }
    console.log(`ok ${file}: ${dims.width}x${dims.height}, ${info.size} bytes`);
  }
  if (invalid) process.exitCode = 1;
}

// A row counts as provenance for a level when any cell of a Markdown table row
// names its file. Rows are owner-written, so the match stays tolerant: backticks
// and surrounding prose are ignored.
function provenanceRows(text) {
  return text
    .split('\n')
    .filter((line) => line.trim().startsWith('|'))
    .map((line) => line.split('|').map((cell) => cell.trim().replaceAll('`', '')));
}

async function runProvenance() {
  const manifest = await validateManifest();
  let text = null;
  try {
    text = await readFile(provenancePath, 'utf8');
  } catch (err) {
    if (err.code !== 'ENOENT') throw new Error(`cannot read PROVENANCE.md: ${err.message}`);
  }
  const rows = provenanceRows(text ?? '');
  let missing = 0;
  for (const entry of Object.values(manifest.levels)) {
    const covered = rows.some((cells) => cells.some((cell) => cell.includes(entry.file)));
    if (covered) continue;
    console.log(`missing provenance ${entry.file}`);
    missing++;
  }
  const source = text === null ? 'PROVENANCE.md is absent' : 'PROVENANCE.md is present';
  console.log(`provenance ok: ${LEVEL_COUNT - missing}/${LEVEL_COUNT} levels have a row (${source})`);
}

const mode = process.argv[2];
if (mode === '--manifest') {
  await runManifest();
} else if (mode === '--all') {
  await runAll();
} else if (mode === '--provenance') {
  await runProvenance();
} else {
  console.error('usage: check-art.mjs --manifest | --all | --provenance');
  process.exit(2);
}
