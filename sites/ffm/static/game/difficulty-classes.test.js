import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

import { FIEND_CLASSES, getFiendClass } from './difficulty-classes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('FIEND_CLASSES', () => {
  it('has exactly 36 entries', () => {
    assert.strictEqual(FIEND_CLASSES.length, 36);
  });

  it('has unique and contiguous ids 1..36', () => {
    const ids = FIEND_CLASSES.map((c) => c.id);
    assert.deepStrictEqual(ids.sort((a, b) => a - b), Array.from({ length: 36 }, (_, i) => i + 1));
  });

  it('has strictly increasing scoreValue when sorted by id', () => {
    const sorted = [...FIEND_CLASSES].sort((a, b) => a.id - b.id);
    for (let i = 1; i < sorted.length; i++) {
      assert.ok(sorted[i].scoreValue > sorted[i - 1].scoreValue);
    }
  });

  it('maps spriteSet and gridIndex correctly', () => {
    for (const fiend of FIEND_CLASSES) {
      if (fiend.id <= 18) {
        assert.strictEqual(fiend.spriteSet, 1);
        assert.strictEqual(fiend.gridIndex, fiend.id);
      } else {
        assert.strictEqual(fiend.spriteSet, 2);
        assert.strictEqual(fiend.gridIndex, fiend.id - 18);
      }
    }
  });

  it('pairs classes with same gridIndex and name (class N+18 matches class N)', () => {
    for (let n = 1; n <= 18; n++) {
      const classN = FIEND_CLASSES.find((c) => c.id === n);
      const classNPlus18 = FIEND_CLASSES.find((c) => c.id === n + 18);
      assert.strictEqual(classNPlus18.gridIndex, classN.gridIndex);
      assert.strictEqual(classNPlus18.name, classN.name);
    }
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
