import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  generateShapesProblem,
  generateShapeCountDistractors,
  SHAPE_TYPES,
  MIN_SHAPE_COUNT,
  MAX_SHAPE_COUNT,
} from './shapes.js';
import { lcg } from './levels.js';

describe('generateShapesProblem', () => {
  it('returns a shapeType from SHAPE_TYPES', () => {
    const p = generateShapesProblem(1);
    assert.ok(SHAPE_TYPES.includes(p.shapeType));
  });

  it('returns a count within [MIN_SHAPE_COUNT, MAX_SHAPE_COUNT] across many seeds', () => {
    for (let seed = 0; seed < 100; seed++) {
      const p = generateShapesProblem(seed);
      assert.ok(
        p.count >= MIN_SHAPE_COUNT && p.count <= MAX_SHAPE_COUNT,
        `count ${p.count} out of range for seed ${seed}`
      );
    }
  });

  it('sets answer equal to count', () => {
    const p = generateShapesProblem(42);
    assert.strictEqual(p.answer, p.count);
  });

  it('returns exactly 3 distractors, all distinct from the answer and from each other', () => {
    for (let seed = 0; seed < 100; seed++) {
      const p = generateShapesProblem(seed);
      assert.strictEqual(p.distractors.length, 3);
      assert.ok(!p.distractors.includes(p.answer), `seed ${seed} distractors include the answer`);
      assert.strictEqual(new Set(p.distractors).size, 3, `seed ${seed} distractors has duplicates`);
    }
  });

  it('marks displayMode as "shapes" with no text question field', () => {
    const p = generateShapesProblem(7);
    assert.strictEqual(p.displayMode, 'shapes');
    assert.strictEqual(p.question, undefined);
  });

  it('is deterministic: the same seed produces the same problem', () => {
    const a = generateShapesProblem(123);
    const b = generateShapesProblem(123);
    assert.deepStrictEqual(a, b);
  });

  it('produces different problems for different seeds (not a constant)', () => {
    const seen = new Set();
    for (let seed = 0; seed < 20; seed++) {
      const p = generateShapesProblem(seed);
      seen.add(`${p.shapeType}:${p.count}`);
    }
    assert.ok(seen.size > 1, 'expected variety across seeds');
  });
});

describe('generateShapeCountDistractors', () => {
  it('never includes the answer itself', () => {
    for (let seed = 0; seed < 20; seed++) {
      const distractors = generateShapeCountDistractors(5, lcg(seed));
      assert.ok(!distractors.includes(5));
    }
  });

  it('returns exactly 3 distinct values even for edge-case answers (min/max)', () => {
    assert.strictEqual(generateShapeCountDistractors(MIN_SHAPE_COUNT, lcg(1)).length, 3);
    assert.strictEqual(generateShapeCountDistractors(MAX_SHAPE_COUNT, lcg(2)).length, 3);
    assert.ok(!generateShapeCountDistractors(MIN_SHAPE_COUNT, lcg(1)).includes(MIN_SHAPE_COUNT));
    assert.ok(!generateShapeCountDistractors(MAX_SHAPE_COUNT, lcg(2)).includes(MAX_SHAPE_COUNT));
  });

  it('all distractors stay within [MIN_SHAPE_COUNT, MAX_SHAPE_COUNT]', () => {
    const distractors = generateShapeCountDistractors(6, lcg(55));
    distractors.forEach((v) => {
      assert.ok(v >= MIN_SHAPE_COUNT && v <= MAX_SHAPE_COUNT);
    });
  });
});
