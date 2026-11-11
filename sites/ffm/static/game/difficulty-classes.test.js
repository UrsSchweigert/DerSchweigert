import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

import { FIEND_CLASSES, getFiendClass } from './difficulty-classes.js';

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

  it('keeps one creature per grid position across all three stages', () => {
    for (let n = 1; n <= 18; n++) {
      const young = FIEND_CLASSES.find((c) => c.id === n);
      const old = FIEND_CLASSES.find((c) => c.id === n + 18);
      const ancient = FIEND_CLASSES.find((c) => c.id === n + 36);
      for (const stage of [old, ancient]) {
        assert.strictEqual(stage.gridIndex, young.gridIndex);
        assert.strictEqual(stage.name, young.name);
      }
      assert.strictEqual(young.stage, 'young');
      assert.strictEqual(old.stage, 'old');
      assert.strictEqual(ancient.stage, 'ancient');
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
