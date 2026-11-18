import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

import { FIEND_CLASSES, WALK_FRAMES, getFiendClass } from './difficulty-classes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('FIEND_CLASSES', () => {
  it('has exactly 60 entries - one per campaign level', () => {
    assert.strictEqual(FIEND_CLASSES.length, 60);
  });

  it('has unique and contiguous ids 1..60', () => {
    const ids = FIEND_CLASSES.map((c) => c.id);
    assert.deepStrictEqual(ids.sort((a, b) => a - b), Array.from({ length: 60 }, (_, i) => i + 1));
  });

  it('has strictly increasing scoreValue when sorted by id', () => {
    const sorted = [...FIEND_CLASSES].sort((a, b) => a.id - b.id);
    for (let i = 1; i < sorted.length; i++) {
      assert.ok(sorted[i].scoreValue > sorted[i - 1].scoreValue);
    }
  });

  it('maps the three art stages onto sprite sets 1-3 and the dragons onto set 4', () => {
    for (const fiend of FIEND_CLASSES) {
      if (fiend.id <= 54) {
        const set = Math.ceil(fiend.id / 18);
        assert.strictEqual(fiend.spriteSet, set);
        assert.strictEqual(fiend.gridIndex, fiend.id - (set - 1) * 18);
      } else {
        assert.strictEqual(fiend.spriteSet, 4, 'dragon variants live in their own set');
        assert.strictEqual(fiend.gridIndex, 5, 'every variant derives from the dragon slot');
        assert.ok(fiend.spritePath.includes('dragon-'), fiend.spritePath);
      }
    }
  });

  it('gives every class its own creature - the art is redrawn per stage', () => {
    const names = FIEND_CLASSES.map((c) => c.name);
    for (const name of names) assert.ok(typeof name === 'string' && name.length > 2, `bad name ${name}`);
    assert.strictEqual(new Set(names).size, names.length, 'two classes share a name');
    for (const fiend of FIEND_CLASSES.filter((c) => c.id <= 54)) {
      assert.strictEqual(fiend.stage, ['young', 'old', 'ancient'][Math.ceil(fiend.id / 18) - 1]);
    }
  });

  it('ends on the six dragon variants', () => {
    const dragons = FIEND_CLASSES.filter((c) => c.stage === 'dragon');
    assert.strictEqual(dragons.length, 6);
    assert.deepStrictEqual(dragons.map((c) => c.id), [55, 56, 57, 58, 59, 60]);
    assert.strictEqual(new Set(dragons.map((c) => c.spritePath)).size, 6, 'each variant has its own art');
  });

  it('has spritePaths pointing to existing files larger than 1024 bytes', () => {
    for (const fiend of FIEND_CLASSES) {
      const fullPath = path.resolve(__dirname, fiend.spritePath);
      assert.ok(fs.existsSync(fullPath), `File missing: ${fullPath}`);
      const stat = fs.statSync(fullPath);
      assert.ok(stat.size > 1024, `File too small: ${fullPath} (${stat.size} bytes)`);
    }
  });
});

// Width and height of a WebP file, read from its header (VP8X, lossy VP8 or lossless VP8L).
function webpSize(file) {
  const b = fs.readFileSync(file);
  assert.strictEqual(b.toString('ascii', 0, 4), 'RIFF', `${file} is not a WebP`);
  const kind = b.toString('ascii', 12, 16);
  if (kind === 'VP8X') return { w: 1 + b.readUIntLE(24, 3), h: 1 + b.readUIntLE(27, 3) };
  if (kind === 'VP8 ') return { w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff };
  if (kind === 'VP8L') {
    const bits = b.readUInt32LE(21);
    return { w: (bits & 0x3fff) + 1, h: ((bits >> 14) & 0x3fff) + 1 };
  }
  throw new Error(`unknown WebP chunk ${kind} in ${file}`);
}

describe('fiend walk strips', () => {
  it('gives every class a walk strip of WALK_FRAMES frames cut like its still', () => {
    for (const fiend of FIEND_CLASSES) {
      assert.strictEqual(fiend.walkFrames, WALK_FRAMES);
      const strip = path.resolve(__dirname, fiend.walkPath);
      assert.ok(fs.existsSync(strip), `walk strip missing: ${strip}`);
      const still = webpSize(path.resolve(__dirname, fiend.spritePath));
      const walk = webpSize(strip);
      // Same box for the still and every frame is what keeps the fiend's size and
      // hit box from jumping when the walk starts or stops.
      assert.strictEqual(walk.h, still.h, `${fiend.walkPath}: frame height differs from the still`);
      assert.strictEqual(walk.w, still.w * WALK_FRAMES, `${fiend.walkPath}: strip is not ${WALK_FRAMES} stills wide`);
    }
  });

  it('starts every class on the ground line: the redrawn art is cropped tight, so no padding shift', () => {
    for (const fiend of FIEND_CLASSES) {
      assert.ok(fiend.bottomPadRatio >= 0 && fiend.bottomPadRatio <= 0.2, `${fiend.name}: ${fiend.bottomPadRatio}`);
    }
  });
});

describe('getFiendClass', () => {
  it('returns the entry with id 7 when called with 7', () => {
    const fiend = getFiendClass(7);
    assert.strictEqual(fiend.id, 7);
  });

  it('falls back to id 1 for invalid id (999)', () => {
    const fiend = getFiendClass(999);
    assert.strictEqual(fiend.id, 1);
  });

  it('falls back to id 1 for null', () => {
    const fiend = getFiendClass(null);
    assert.strictEqual(fiend.id, 1);
  });
});
