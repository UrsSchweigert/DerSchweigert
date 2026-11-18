import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFile, stat } from 'node:fs/promises';

const PLAY_DIR = new URL('../store-art/google-play/', import.meta.url);
const COMPOSE = await readFile(new URL('../store-art/tools/compose.py', import.meta.url), 'utf8');

async function readPng(name) {
  const bytes = await readFile(new URL(name, PLAY_DIR));
  assert.equal(bytes.subarray(1, 4).toString('latin1'), 'PNG', `${name} is not a PNG`);
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
    bitDepth: bytes[24],
    colourType: bytes[25],
    bytes: bytes.length,
  };
}

test('Play listing icon is a 512 px square 32-bit PNG with an alpha channel', async () => {
  const png = await readPng('icon-512x512.png');
  assert.equal(png.width, 512);
  assert.equal(png.height, 512);
  assert.equal(png.bitDepth, 8);
  assert.equal(png.colourType, 6, 'Play asks for a 32-bit PNG with alpha; colour type 6 is 8-bit RGBA');
  assert.ok(png.bytes < 1024 * 1024, `icon is ${png.bytes} bytes, Play caps it at 1 MB`);
});

test('feature graphics are 1024x500 PNGs without an alpha channel in German and English', async () => {
  for (const locale of ['de', 'en']) {
    const png = await readPng(`feature-graphic-${locale}-1024x500.png`);
    assert.equal(png.width, 1024, `${locale} width`);
    assert.equal(png.height, 500, `${locale} height`);
    assert.equal(png.bitDepth, 8);
    assert.equal(png.colourType, 2, 'Play caps the feature graphic at 24-bit PNG');
    assert.ok(png.bytes < 15 * 1024 * 1024, `${locale} graphic is ${png.bytes} bytes, Play caps it at 15 MB`);
  }
});

test('feature graphic titles are the approved ones and match the marketing copy', async () => {
  assert.match(COMPOSE, /"de": \("Buchstabenzeit", "geführt lesen"\)/);
  assert.match(COMPOSE, /"en": \("Letter time", "guided reading"\)/);

  const german = await readFile(new URL('../marketing-pack/copy/de.md', import.meta.url), 'utf8');
  const english = await readFile(new URL('../marketing-pack/copy/en.md', import.meta.url), 'utf8');
  assert.match(german, /gef[üu]hrt lesen/i, 'the German feature graphic should use the approved German wording');
  assert.match(english, /guided reading/i, 'the English feature graphic should use the approved English wording');
});

test('the graphic alt texts stay inside the length Play recommends', async () => {
  for (const [file, rows] of [
    ['de.md', /^\| (Feature-Grafik|App-Icon) .*$/gm],
    ['en.md', /^\| (Feature graphic|App icon) .*$/gm],
  ]) {
    const copy = await readFile(new URL(`../marketing-pack/copy/${file}`, import.meta.url), 'utf8');
    const altTexts = [...copy.matchAll(rows)].map((match) => match[0].split('|').at(-2).trim());
    assert.equal(altTexts.length, 2, `${file} should list one alt text per graphic`);
    for (const alt of altTexts) {
      assert.ok(alt.length > 0, `${file} has an empty alt text`);
      assert.ok(alt.length <= 140, `${file} alt text is ${alt.length} chars: ${alt}`);
    }
  }
});

test('the key art master and the launcher icon art the script renders from are present', async () => {
  for (const path of ['../store-art/source/key-art-3136x1344.png', '../assets/icon-only.png']) {
    const info = await stat(new URL(path, import.meta.url));
    assert.ok(info.size > 0, `${path} is empty`);
  }
});
