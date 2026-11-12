// level-art.test.js — validates the level-background tooling without any
// level image on disk. It reads only the manifest, the style spec and the
// prompts; it never reads a level-<NN>.webp file, and it spawns check-art.mjs
// to confirm the missing-image and missing-provenance exit-0 contracts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const execFileAsync = promisify(execFile);
const runCheck = (...args) => execFileAsync(process.execPath, [join(here, 'check-art.mjs'), ...args]);

// Copies the tooling into a scratch directory so the provenance tests control
// whether PROVENANCE.md exists without touching the committed levels folder.
async function scratchToolDir(provenance) {
  const dir = await mkdtemp(join(tmpdir(), 'level-art-'));
  await copyFile(join(here, 'check-art.mjs'), join(dir, 'check-art.mjs'));
  await copyFile(join(here, 'manifest.json'), join(dir, 'manifest.json'));
  if (provenance !== undefined) await writeFile(join(dir, 'PROVENANCE.md'), provenance);
  return dir;
}
const runCheckIn = (dir, ...args) => execFileAsync(process.execPath, [join(dir, 'check-art.mjs'), ...args]);

const manifest = JSON.parse(await readFile(join(here, 'manifest.json'), 'utf8'));
const style = await readFile(join(here, 'STYLE.md'), 'utf8');
const prompts = await readFile(join(here, 'PROMPTS.md'), 'utf8');

const CHAPTERS = ['I', 'II', 'III', 'IV', 'V', 'VI'];
const HEXES = ['#606149', '#8c593a', '#275228', '#5f9e66', '#3f2f36', '#2e293a'];

test('manifest maps levels 1-60 to files, chapters and the shared budget', () => {
  assert.equal(manifest.width, 1536);
  assert.equal(manifest.height, 1024);
  assert.equal(manifest.byteBudget, 409600);
  const keys = Object.keys(manifest.levels);
  assert.deepEqual(keys, Array.from({ length: 60 }, (_, i) => String(i + 1)));
  for (let n = 1; n <= 60; n++) {
    const entry = manifest.levels[String(n)];
    assert.equal(entry.file, `level-${String(n).padStart(2, '0')}.webp`);
    assert.equal(entry.chapter, CHAPTERS[Math.floor((n - 1) / 10)]);
  }
  for (const chapter of CHAPTERS) {
    assert.equal(
      Object.values(manifest.levels).filter((entry) => entry.chapter === chapter).length,
      10,
      `chapter ${chapter} must hold 10 levels`,
    );
  }
});

test('PROMPTS.md has exactly 60 numbered prompts, one per level', () => {
  const lines = prompts.split('\n').filter((line) => /^\d+\.\s/.test(line));
  assert.equal(lines.length, 60);
  for (let n = 1; n <= 60; n++) {
    assert.ok(lines.some((line) => line.startsWith(`${n}. `)), `prompt ${n} is missing`);
  }
  for (const line of lines) {
    assert.match(line, /horizon/, 'prompt names the next level setting on the horizon');
    assert.match(line, /ground plane/, 'prompt requires the empty ground plane');
    assert.ok(HEXES.some((hex) => line.includes(hex)), 'prompt names a chapter dominant colour');
    assert.match(line, /no characters, text, UI or frame/, 'prompt forbids characters, text, UI or a frame');
  }
});

test('STYLE.md records the measured style values', () => {
  for (const token of ['1536', '1024', '800', '80-944', '120-1416', '35-50', '3-5']) {
    assert.ok(style.includes(token), `STYLE.md is missing ${token}`);
  }
  for (const hex of HEXES) {
    assert.ok(style.includes(hex), `STYLE.md is missing ${hex}`);
  }
});

test('STYLE.md carries the six-chapter review checklist', () => {
  const lower = style.toLowerCase();
  for (const token of ['medium', 'palette', 'border', 'ground band', 'manifest-approved']) {
    assert.ok(lower.includes(token), `STYLE.md is missing ${token}`);
  }
  for (const chapter of CHAPTERS) {
    assert.ok(style.includes(`| ${chapter} |`), `STYLE.md is missing chapter ${chapter}`);
  }
});

test('check-art.mjs --manifest validates the manifest alone and exits 0', async () => {
  const { stdout, stderr } = await runCheck('--manifest');
  assert.equal(stderr, '');
  assert.match(stdout, /manifest ok/);
});

test('check-art.mjs --all exits 0 with no level images and prints each missing level', async () => {
  const { stdout } = await runCheck('--all');
  assert.match(stdout, /missing level-01\.webp/);
  assert.match(stdout, /missing level-60\.webp/);
  const missing = (stdout.match(/missing level-\d+\.webp/g) ?? []).length;
  assert.equal(missing, 60, 'all 60 absent levels must be reported missing');
});

test('check-art.mjs --provenance exits 0 with no PROVENANCE.md and reports every level', async () => {
  const dir = await scratchToolDir();
  try {
    const { stdout, stderr } = await runCheckIn(dir, '--provenance');
    assert.equal(stderr, '');
    assert.match(stdout, /missing provenance level-01\.webp/);
    assert.match(stdout, /missing provenance level-60\.webp/);
    const missing = (stdout.match(/missing provenance level-\d+\.webp/g) ?? []).length;
    assert.equal(missing, 60, 'all 60 levels lack a provenance row');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('check-art.mjs --provenance counts a sample row and reports only the rest', async () => {
  const provenance = [
    '# Level background provenance',
    '',
    '| File | Generator | SHA-256 | Date | Reviewer |',
    '| --- | --- | --- | --- | --- |',
    '| `level-01.webp` | sample model | `abc12345` | 2026-11-12 | owner |',
    '',
  ].join('\n');
  const dir = await scratchToolDir(provenance);
  try {
    const { stdout, stderr } = await runCheckIn(dir, '--provenance');
    assert.equal(stderr, '');
    assert.doesNotMatch(stdout, /missing provenance level-01\.webp/);
    assert.match(stdout, /missing provenance level-02\.webp/);
    assert.match(stdout, /missing provenance level-60\.webp/);
    const missing = (stdout.match(/missing provenance level-\d+\.webp/g) ?? []).length;
    assert.equal(missing, 59, 'only the one rowed level is covered');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('check-art.mjs --provenance exits 0 in the committed levels folder', async () => {
  const { stdout } = await runCheck('--provenance');
  assert.match(stdout, /provenance ok: \d+\/60 levels have a row/);
});
