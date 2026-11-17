// Validates the hero asset manifest and any hero art committed under
// heroes/<id>/. With no art on disk it passes and prints one line per missing
// file, so it is green before the art lands. Real defects exit 1.
//   --require <id>  that hero's three art files must be present and valid
//   --settled <id>  also passes when none of the three exists and the id has
//                   no row in the heroes list (a hero that was dropped)
import { readFile, readdir, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { HEROES } from '../heroes.js';

const here = dirname(fileURLToPath(import.meta.url));

const POSES = ['idle', 'walk', 'swing', 'hurt', 'dead', 'victory', 'cast'];
// Held here so the check does not depend on static/game/hero/.
export const REFERENCE_FRAME_IDS = Object.freeze(
  POSES.flatMap((pose) => [1, 2, 3, 4].map((n) => `${pose}-${n}`)),
);
export const ATLAS_MAX_BYTES = 700 * 1024;
export const PORTRAIT_MAX_BYTES = 24 * 1024;
export const PORTRAIT_SIZE = 256;
const FILES = Object.freeze({
  portrait: 'portrait.webp',
  atlas: 'hero-atlas.webp',
  frames: 'hero-frames.js',
});
const ALLOWED = new Set([...Object.values(FILES), 'source']);
// macOS sync or copy conflicts leave "hero-atlas 2.webp" next to the original. They are local leftovers,
// not art, so the check skips them instead of failing on files nobody committed.
const CONFLICT_COPY = /^.+ \d+(\.[A-Za-z0-9]+)?$/;
const FRAME_KEYS = ['x', 'y', 'w', 'h', 'px', 'py'];

function webpDimensions(buf) {
  if (buf.length < 30 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WEBP') {
    return null;
  }
  const chunk = buf.toString('ascii', 12, 16);
  if (chunk === 'VP8 ') {
    return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
  }
  if (chunk === 'VP8L') {
    const bits = buf.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  if (chunk === 'VP8X') {
    return { width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) };
  }
  return { width: 0, height: 0 };
}

const isPoint = (p) => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite);

async function exists(path) {
  return Boolean(await stat(path).catch(() => null));
}

async function checkManifest(dir, roster, problems, notes) {
  let doc;
  try {
    doc = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8'));
  } catch (err) {
    problems.push(`cannot read manifest.json: ${err.message}`);
    return [];
  }
  const rows = Array.isArray(doc?.heroes) ? doc.heroes : null;
  if (!rows) {
    problems.push('manifest.json: heroes must be a list');
    return [];
  }
  const order = roster.map((entry) => entry.id);
  const seen = new Set();
  let last = -1;
  for (const row of rows) {
    const id = row?.id;
    const entry = roster.find((candidate) => candidate.id === id);
    if (!entry) {
      problems.push(`manifest.json: ${JSON.stringify(id)} is not in the roster`);
      continue;
    }
    if (seen.has(id)) {
      problems.push(`manifest.json: duplicate row ${id}`);
      continue;
    }
    seen.add(id);
    const index = order.indexOf(id);
    if (index < last) problems.push(`manifest.json: row ${id} is out of roster order`);
    last = Math.max(last, index);
    if (row.strike !== entry.strike) {
      problems.push(`manifest.json: ${id} strike must be ${entry.strike}, got ${row.strike}`);
    }
    for (const [key, file] of Object.entries(FILES)) {
      const want = `heroes/${id}/${file}`;
      if (row[key] !== want) problems.push(`manifest.json: ${id} ${key} must be ${want}, got ${row[key]}`);
    }
  }
  for (const id of order) {
    if (!seen.has(id)) notes.push(`no manifest row for ${id}`);
  }
  if (doc.entries !== undefined) {
    if (!Array.isArray(doc.entries)) {
      problems.push('manifest.json: entries must be a list');
    } else {
      for (const item of doc.entries) {
        const path = typeof item === 'string' ? item : item?.path;
        if (typeof path !== 'string' || !((await exists(join(dir, path))) || (await exists(join(dir, '..', path))))) {
          problems.push(`manifest.json: entries path does not exist: ${path}`);
        }
      }
    }
  }
  return [...seen];
}

async function checkWebp(path, label, maxBytes, square, problems) {
  const buf = await readFile(path);
  const dims = webpDimensions(buf);
  if (!dims) {
    problems.push(`${label} is not a WebP file`);
    return;
  }
  if (buf.length > maxBytes) problems.push(`${label} is ${buf.length} bytes, over ${maxBytes}`);
  if (square && (dims.width !== square || dims.height !== square)) {
    problems.push(`${label} must be ${square}x${square}, got ${dims.width}x${dims.height}`);
  }
}

async function checkFrames(path, label, problems) {
  let mod;
  try {
    const info = await stat(path);
    mod = await import(`${pathToFileURL(path).href}?v=${info.mtimeMs}-${info.size}`);
  } catch (err) {
    problems.push(`${label} cannot be loaded: ${err.message}`);
    return;
  }
  const frames = mod.HERO_FRAMES;
  if (!frames || typeof frames !== 'object') {
    problems.push(`${label} must export HERO_FRAMES`);
  } else {
    const ids = Object.keys(frames);
    const missing = REFERENCE_FRAME_IDS.filter((id) => !ids.includes(id));
    const extra = ids.filter((id) => !REFERENCE_FRAME_IDS.includes(id));
    if (missing.length) problems.push(`${label} lacks frames: ${missing.join(', ')}`);
    if (extra.length) problems.push(`${label} has unexpected frames: ${extra.join(', ')}`);
    for (const id of ids) {
      const bad = FRAME_KEYS.filter((key) => !Number.isFinite(frames[id]?.[key]));
      if (bad.length) problems.push(`${label} frame ${id} lacks numeric ${bad.join(', ')}`);
    }
  }
  const anchors = mod.HERO_ANCHORS;
  if (anchors !== undefined) {
    const ok = anchors && isPoint(anchors.strike) && Array.isArray(anchors.cast)
      && anchors.cast.length === 2 && anchors.cast.every(isPoint);
    if (!ok) problems.push(`${label} HERO_ANCHORS must be {strike: [x, y], cast: [[x, y], [x, y]]}`);
  }
}

/**
 * @param {{dir?: string, roster?: object[], require?: string, settled?: string}} [options]
 * @returns {Promise<{problems: string[], notes: string[]}>}
 */
export async function checkHeroes({ dir = here, roster = HEROES, require, settled } = {}) {
  const problems = [];
  const notes = [];
  const rowIds = await checkManifest(dir, roster, problems, notes);

  const dirs = (await readdir(dir, { withFileTypes: true }).catch(() => []))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
  for (const id of new Set([...roster.map((entry) => entry.id), ...dirs])) {
    const heroDir = join(dir, id);
    const present = {};
    for (const [key, file] of Object.entries(FILES)) {
      present[key] = await exists(join(heroDir, file));
      if (!present[key]) notes.push(`missing heroes/${id}/${file}`);
    }
    if (dirs.includes(id)) {
      for (const entry of await readdir(heroDir)) {
        if (CONFLICT_COPY.test(entry)) continue;
        if (!ALLOWED.has(entry)) problems.push(`heroes/${id}/${entry} is not an allowed hero file`);
      }
    }
    const label = (file) => `heroes/${id}/${file}`;
    if (present.portrait) {
      await checkWebp(join(heroDir, FILES.portrait), label(FILES.portrait), PORTRAIT_MAX_BYTES, PORTRAIT_SIZE, problems);
    }
    if (present.atlas) {
      await checkWebp(join(heroDir, FILES.atlas), label(FILES.atlas), ATLAS_MAX_BYTES, 0, problems);
    }
    if (present.frames) await checkFrames(join(heroDir, FILES.frames), label(FILES.frames), problems);

    const all = present.portrait && present.atlas && present.frames;
    const none = !present.portrait && !present.atlas && !present.frames;
    if (id === require && !all) problems.push(`--require ${id}: the three art files are not all present`);
    if (id === settled && !all && !(none && !rowIds.includes(id))) {
      problems.push(`--settled ${id}: neither complete art nor an absent hero without a row`);
    }
  }
  for (const id of [require, settled]) {
    if (id && !roster.some((entry) => entry.id === id)) problems.push(`unknown hero id ${id}`);
  }
  return { problems, notes };
}

function parseArgs(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--require') options.require = argv[++i];
    else if (argv[i] === '--settled') options.settled = argv[++i];
    else throw new Error(`unknown argument ${argv[i]}`);
  }
  return options;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`${err.message}\nusage: check-heroes.mjs [--require <id>] [--settled <id>]`);
    process.exit(2);
  }
  const { problems, notes } = await checkHeroes(options);
  for (const note of notes) console.log(note);
  for (const problem of problems) console.error(`problem: ${problem}`);
  if (problems.length > 0) process.exit(1);
  console.log('heroes ok');
}
