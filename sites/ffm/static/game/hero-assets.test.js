import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HEROES } from './heroes.js';
import { checkHeroes, REFERENCE_FRAME_IDS } from './heroes/check-heroes.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const manifestPath = join(here, 'heroes', 'manifest.json');

function row(entry) {
  const dir = `heroes/${entry.id}`;
  return {
    id: entry.id,
    strike: entry.strike,
    portrait: `${dir}/portrait.webp`,
    atlas: `${dir}/hero-atlas.webp`,
    frames: `${dir}/hero-frames.js`,
  };
}

function webp(width, height, size) {
  const buf = Buffer.alloc(size);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(size - 8, 4);
  buf.write('WEBPVP8L', 8, 'ascii');
  buf[20] = 0x2f;
  buf.writeUInt32LE((width - 1) | ((height - 1) << 14), 21);
  return buf;
}

function framesSource({ drop, bad, anchors } = {}) {
  const frames = {};
  for (const id of REFERENCE_FRAME_IDS) {
    if (id !== drop) frames[id] = { x: 0, y: 0, w: 10, h: 10, px: 5, py: 9 };
  }
  if (bad) delete frames['idle-1'].px;
  let out = `export const HERO_FRAMES = ${JSON.stringify(frames)};\n`;
  if (anchors !== undefined) out += `export const HERO_ANCHORS = ${JSON.stringify(anchors)};\n`;
  return out;
}

async function withTree(setup, fn, rows = HEROES.map(row)) {
  const dir = await mkdtemp(join(tmpdir(), 'ffm-heroes-'));
  try {
    await writeFile(join(dir, 'manifest.json'), JSON.stringify({ version: 1, heroes: rows, entries: [] }));
    await setup?.(async (rel, content) => {
      await mkdir(dirname(join(dir, rel)), { recursive: true });
      await writeFile(join(dir, rel), content);
    }, dir);
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const validArt = async (put) => {
  await put('wood/portrait.webp', webp(256, 256, 2000));
  await put('wood/hero-atlas.webp', webp(512, 512, 5000));
  await put('wood/hero-frames.js', framesSource({ anchors: { strike: [1, 2], cast: [[3, 4], [5, 6]] } }));
};

async function problemsFor(setup, rows) {
  return withTree(setup, async (dir) => (await checkHeroes({ dir })).problems, rows);
}

test('the committed tree passes and reports missing files as notes', async () => {
  const { problems, notes } = await checkHeroes();
  assert.deepEqual(problems, []);
  assert.ok(Array.isArray(notes));
});

test('every manifest row agrees with the roster', async () => {
  const doc = JSON.parse(await readFile(manifestPath, 'utf8'));
  assert.equal(doc.version, 1);
  assert.deepEqual(doc.entries, []);
  assert.equal(doc.heroes.length, HEROES.length);
  HEROES.forEach((entry, index) => {
    const got = doc.heroes[index];
    assert.equal(got.id, entry.id);
    assert.equal(got.strike, entry.strike);
    assert.equal(got.portrait, entry.portrait);
    if (entry.atlas.startsWith('heroes/')) assert.equal(got.atlas, entry.atlas);
    if (entry.frames.startsWith('heroes/')) assert.equal(got.frames, entry.frames);
  });
});

test('a complete valid hero passes and one missing hero id is only a note', async () => {
  const rows = HEROES.map(row).filter((r) => r.id !== 'quirl');
  await withTree(validArt, async (dir) => {
    const { problems, notes } = await checkHeroes({ dir, require: 'wood' });
    assert.deepEqual(problems, []);
    assert.ok(notes.includes('no manifest row for quirl'));
  }, rows);
});

test('manifest defects fail', async () => {
  const base = HEROES.map(row);
  const cases = {
    'unknown id': [...base, { ...base[0], id: 'wizard' }],
    duplicate: [...base, base[0]],
    'out of order': [base[1], base[0], ...base.slice(2)],
    strike: [{ ...base[0], strike: 'bow' }, ...base.slice(1)],
    path: [{ ...base[0], atlas: 'hero/hero-atlas.webp' }, ...base.slice(1)],
  };
  for (const [name, rows] of Object.entries(cases)) {
    assert.notDeepEqual(await problemsFor(null, rows), [], name);
  }
});

test('an entries item whose path does not exist fails', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ffm-heroes-'));
  try {
    await writeFile(join(dir, 'manifest.json'), JSON.stringify({
      version: 1, heroes: HEROES.map(row), entries: [{ path: 'heroes/wood/portrait.webp' }],
    }));
    const { problems } = await checkHeroes({ dir });
    assert.equal(problems.length, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('file defects fail', async () => {
  const cases = {
    'atlas not webp': (put) => put('wood/hero-atlas.webp', Buffer.alloc(100)),
    'atlas too big': (put) => put('wood/hero-atlas.webp', webp(512, 512, 700 * 1024 + 1)),
    'portrait not webp': (put) => put('wood/portrait.webp', Buffer.alloc(100)),
    'portrait wrong size': (put) => put('wood/portrait.webp', webp(128, 256, 2000)),
    'portrait too big': (put) => put('wood/portrait.webp', webp(256, 256, 24 * 1024 + 1)),
    'stray file': (put) => put('wood/notes.txt', 'x'),
    'missing frame': (put) => put('wood/hero-frames.js', framesSource({ drop: 'cast-4' })),
    'frame without px': (put) => put('wood/hero-frames.js', framesSource({ bad: true })),
    'bad strike anchor': (put) => put('wood/hero-frames.js', framesSource({ anchors: { strike: [1], cast: [[1, 2], [3, 4]] } })),
    'bad cast anchor': (put) => put('wood/hero-frames.js', framesSource({ anchors: { strike: [1, 2], cast: [[1, 2]] } })),
    'non-finite anchor': (put) => put('wood/hero-frames.js', 'export const HERO_FRAMES = {};\nexport const HERO_ANCHORS = { strike: [NaN, 1], cast: [[1, 2], [3, 4]] };\n'),
  };
  for (const [name, setup] of Object.entries(cases)) {
    assert.notDeepEqual(await problemsFor(setup), [], name);
  }
});

test('source/ and the three art files are allowed', async () => {
  const problems = await problemsFor(async (put, dir) => {
    await validArt(put);
    await put('wood/source/sheet.png', 'x');
  });
  assert.deepEqual(problems, []);
});

test('macOS conflict copies ("name 2.ext") are ignored, a real stray file still fails', async () => {
  const copies = await problemsFor(async (put) => {
    await validArt(put);
    await put('wood/hero-atlas 2.webp', 'x');
    await put('wood/portrait 2.webp', 'x');
    await put('wood/hero-frames 2.js', 'x');
  });
  assert.deepEqual(copies, []);
  const stray = await problemsFor(async (put) => {
    await validArt(put);
    await put('wood/notes.txt', 'x');
  });
  assert.notDeepEqual(stray, []);
});

test('--require and --settled', async () => {
  const run = (options, setup, rows) =>
    withTree(setup, async (dir) => (await checkHeroes({ dir, ...options })).problems, rows);
  assert.notDeepEqual(await run({ require: 'wood' }), []);
  assert.deepEqual(await run({ require: 'wood' }, validArt), []);
  assert.notDeepEqual(await run({ settled: 'wood' }), []);
  assert.deepEqual(await run({ settled: 'wood' }, null, HEROES.map(row).filter((r) => r.id !== 'wood')), []);
  assert.deepEqual(await run({ settled: 'wood' }, validArt), []);
  assert.notDeepEqual(await run({ require: 'nobody' }), []);
});
