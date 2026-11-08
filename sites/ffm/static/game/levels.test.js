// Arithmo Slayer - Levels Tests
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LevelConfig, generateProblem, getArithmeticOptionCount, chapterForLevel, getFiendWeights, sampleFiendType, TOTAL_LEVELS } from './levels.js';
const _FullLevelConfig = JSON.parse(readFileSync(new URL('../../app/level_data.json', import.meta.url))).levels;

describe('LevelConfig', () => {
  it('should have exactly 2 public entries (free levels)', () => {
    assert.strictEqual(LevelConfig.length, 2, 'Public LevelConfig should have 2 entries');

    LevelConfig.forEach((cfg, idx) => {
      assert.strictEqual(cfg.level, idx + 1, `Level ${idx + 1} should have level=${idx + 1}`);
      assert.ok(cfg.chapter >= 1 && cfg.chapter <= 4, `Level ${idx + 1} should have chapter 1-4`);
    });
  });

  it('should have TOTAL_LEVELS=60', () => {
    assert.strictEqual(TOTAL_LEVELS, 60, 'TOTAL_LEVELS should be 60');
  });

  it('full internal config should have exactly 60 entries with valid fields', () => {
    assert.strictEqual(_FullLevelConfig.length, TOTAL_LEVELS, '_FullLevelConfig should have 60 entries');

    _FullLevelConfig.forEach((cfg, idx) => {
      assert.strictEqual(cfg.level, idx + 1, `Level ${idx + 1} should have level=${idx + 1}`);
      assert.ok(cfg.chapter >= 1 && cfg.chapter <= 4, `Level ${idx + 1} should have chapter 1-4`);
      assert.ok(Array.isArray(cfg.operations) && cfg.operations.length > 0, `Level ${idx + 1} should have non-empty operations array`);
      assert.ok(typeof cfg.fiendType === 'string' && cfg.fiendType.length > 0, `Level ${idx + 1} should have valid fiendType`);
      assert.equal(cfg.inputMode, 'multiple-choice', `Level ${idx + 1} should use multiple choice`);
      assert.ok(typeof cfg.fiendHP === 'number' && cfg.fiendHP >= 1 && cfg.fiendHP <= 4, `Level ${idx + 1} should have fiendHP in 1-4`);
    });
  });

  it('should enforce 15-level curriculum blocks', () => {
    const block1 = _FullLevelConfig.slice(0, 15);
    const block2 = _FullLevelConfig.slice(15, 30);
    const block3 = _FullLevelConfig.slice(30, 45);
    const block4 = _FullLevelConfig.slice(45, 60);

    assert.ok(block1.every(cfg => cfg.chapter === 1), 'Levels 1-15 should be chapter 1');
    assert.ok(block1.every(cfg => cfg.maxResult <= 20), 'Levels 1-15 should stay in Zahlenraum 20');
    assert.ok(block1.every(cfg => cfg.operations.every(op => ['+', '-'].includes(op))), 'Levels 1-15 should use only + and -');

    assert.ok(block2.every(cfg => cfg.chapter === 2), 'Levels 16-30 should be chapter 2');
    assert.ok(block2.some(cfg => cfg.operations.includes('*')), 'Levels 16-30 should introduce multiplication');
    assert.ok(block2.every(cfg => !cfg.operations.includes('/')), 'Levels 16-30 should not include division');

    assert.ok(block3.every(cfg => cfg.chapter === 3), 'Levels 31-45 should be chapter 3');
    assert.ok(block3.some(cfg => cfg.operations.includes('*')), 'Levels 31-45 should include multiplication');
    assert.ok(block3.some(cfg => cfg.operations.includes('/')), 'Levels 31-45 should include division');

    assert.ok(block4.every(cfg => cfg.chapter === 4), 'Levels 46-60 should be chapter 4');
    assert.ok(block4.every(cfg => cfg.operations.length >= 2), 'Levels 46-60 should use mixed operations');
  });

  it('keeps level 11 familiar before level 12 widens the operands', () => {
    assert.deepEqual(_FullLevelConfig[10].operandRange, _FullLevelConfig[9].operandRange);
    assert.equal(_FullLevelConfig[10].maxResult, _FullLevelConfig[9].maxResult);
    assert.deepEqual(_FullLevelConfig[11].operandRange, { a: [1, 20], b: [1, 20] });
  });

  it('audits unchanged product (2–7500) and dividend (4–7500) envelopes across all 60 levels and 59 transitions', () => {
    const adjacentTransitions = _FullLevelConfig.slice(1).map((cfg, index) => [
      _FullLevelConfig[index],
      cfg,
    ]);
    assert.equal(adjacentTransitions.length, 59);
    adjacentTransitions.forEach(([previous, current]) => {
      assert.equal(current.level, previous.level + 1);
      assert.ok(current.operandRange.a.every(Number.isSafeInteger));
      assert.ok(current.operandRange.b.every(Number.isSafeInteger));
    });

    const envelopes = operation => {
      const applicable = _FullLevelConfig.filter(cfg => cfg.operations.includes(operation));
      return {
        min: Math.min(...applicable.map(cfg => cfg.operandRange.a[0] * cfg.operandRange.b[0])),
        max: Math.max(...applicable.map(cfg => cfg.operandRange.a[1] * cfg.operandRange.b[1])),
      };
    };

    assert.deepEqual(envelopes('*'), { min: 2, max: 7500 });
    assert.deepEqual(envelopes('/'), { min: 4, max: 7500 });
    assert.ok(_FullLevelConfig.every(cfg => !('maxProduct' in cfg) && !('maxDividend' in cfg)),
      'Canonical operand/product/dividend ranges remain unchanged pending a curriculum decision');
  });
});

describe('generateProblem', () => {
  it('should return correct math for all 60 levels', () => {
    for (let i = 0; i < TOTAL_LEVELS; i++) {
      const problem = generateProblem(i, 42, _FullLevelConfig[i]);

      const questionMatch = problem.question.match(/^(\d+)\s*([+\-−×÷])\s*(\d+)\s*=\s*\?$/);
      assert.ok(questionMatch, `Level ${i + 1} question should be in format "a OP b = ?", got: ${problem.question}`);

      const a = parseInt(questionMatch[1], 10);
      const op = questionMatch[2];
      const b = parseInt(questionMatch[3], 10);

      let expected;
      if (op === '+') {
        expected = a + b;
      } else if (op === '-' || op === '−') {
        expected = a - b;
      } else if (op === '×') {
        expected = a * b;
      } else if (op === '÷') {
        expected = Math.floor(a / b);
      } else {
        assert.fail(`Unknown operator: ${op}`);
      }

      assert.strictEqual(problem.answer, expected, `Level ${i + 1} answer mismatch: expected ${expected}, got ${problem.answer}`);
    }
  });

  it('returns seeded, distinct nearby choices for every level', () => {
    for (let i = 0; i < TOTAL_LEVELS; i++) {
      const count = i < 10 ? 5 : 10;
      assert.equal(getArithmeticOptionCount(i + 1), count);
      for (let seed = 0; seed < 100; seed++) {
        const problem = generateProblem(i, seed, _FullLevelConfig[i]);
        const { a: rangeA, b: rangeB } = _FullLevelConfig[i].operandRange;
        const radius = Math.max(count - 1, Math.ceil(Math.abs(problem.answer) * 0.1));
        assert.equal(problem.options.length, count);
        assert.equal(new Set(problem.options).size, count);
        assert.equal(problem.options.filter(n => n === problem.answer).length, 1);
        assert.equal(problem.distractors.length, count - 1);
        assert.deepEqual(new Set(problem.distractors), new Set(problem.options.filter(n => n !== problem.answer)));
        assert.ok(problem.options.every(n =>
          Number.isSafeInteger(n) && n >= 0 && Math.abs(n - problem.answer) <= radius));
        if (problem.operation === '/') {
          assert.ok(problem.answer >= rangeA[0] && problem.answer <= rangeA[1]);
          assert.ok(problem.b >= Math.max(1, rangeB[0]) && problem.b <= rangeB[1]);
          assert.equal(problem.a, problem.answer * problem.b);
        } else {
          assert.ok(problem.a >= rangeA[0] && problem.a <= rangeA[1]);
          assert.ok(problem.b >= rangeB[0] && problem.b <= rangeB[1]);
        }
        if (problem.operation === '-') assert.ok(problem.b <= problem.a);
        if (['+', '-'].includes(problem.operation)) {
          assert.ok(problem.answer <= _FullLevelConfig[i].maxResult);
        }
        assert.deepEqual(problem, generateProblem(i, seed, _FullLevelConfig[i]));
      }
    }
    assert.throws(() => getArithmeticOptionCount(0), RangeError);
    assert.throws(() => getArithmeticOptionCount(61), RangeError);
    assert.throws(() => getArithmeticOptionCount(1.5), RangeError);
  });

  it('varies answer rank for fixed problems across all operations, including zero and one', () => {
    const fixtures = [
      { operation: '+', rangeA: [0, 0], rangeB: [0, 0], a: 0, b: 0, answer: 0 },
      { operation: '+', rangeA: [0, 0], rangeB: [1, 1], a: 0, b: 1, answer: 1 },
      { operation: '-', rangeA: [1, 1], rangeB: [1, 1], a: 1, b: 1, answer: 0 },
      { operation: '-', rangeA: [2, 2], rangeB: [1, 1], a: 2, b: 1, answer: 1 },
      { operation: '*', rangeA: [0, 0], rangeB: [2, 2], a: 0, b: 2, answer: 0 },
      { operation: '*', rangeA: [1, 1], rangeB: [1, 1], a: 1, b: 1, answer: 1 },
      { operation: '/', rangeA: [0, 0], rangeB: [3, 3], a: 0, b: 3, answer: 0 },
      { operation: '/', rangeA: [1, 1], rangeB: [1, 1], a: 1, b: 1, answer: 1 },
    ];

    for (const fixture of fixtures) {
      const config = {
        level: 1,
        operations: [fixture.operation],
        operandRange: { a: fixture.rangeA, b: fixture.rangeB },
        maxResult: 100,
      };
      const answerPositions = new Set();
      for (let seed = 0; seed < 100; seed++) {
        const problem = generateProblem(0, seed, config);
        assert.equal(problem.a, fixture.a);
        assert.equal(problem.b, fixture.b);
        assert.equal(problem.answer, fixture.answer);
        assert.equal(problem.options.filter(option => option === problem.answer).length, 1);
        assert.equal(problem.options.length, 5);
        assert.equal(new Set(problem.options).size, 5);
        assert.ok(problem.options.every(option =>
          Number.isSafeInteger(option) && option >= 0 && Math.abs(option - problem.answer) <= 4));
        answerPositions.add(problem.options.indexOf(problem.answer));
      }
      assert.ok(answerPositions.size > 1, `${fixture.operation} answer rank should vary for answer ${fixture.answer}`);
    }
  });

  it('terminates with safe choices at zero and the safe-integer boundary', () => {
    const zero = generateProblem(10, 7, {
      level: 11,
      operations: ['+'],
      operandRange: { a: [0, 0], b: [0, 0] },
      maxResult: 0,
    });
    assert.equal(zero.answer, 0);
    assert.equal(zero.options.length, 10);
    assert.equal(new Set(zero.options).size, 10);
    assert.ok(zero.options.every(option => Number.isSafeInteger(option) && option >= 0 && option <= 9));

    const largest = Number.MAX_SAFE_INTEGER;
    const boundary = generateProblem(10, 7, {
      level: 11,
      operations: ['+'],
      operandRange: { a: [largest, largest], b: [0, 0] },
      maxResult: largest,
    });
    assert.equal(boundary.answer, largest);
    assert.equal(boundary.options.length, 10);
    assert.equal(new Set(boundary.options).size, 10);
    assert.ok(boundary.options.every(option =>
      Number.isSafeInteger(option) && option >= 0 && option <= largest &&
      largest - option <= Math.ceil(largest * 0.1)));
  });

  it('uses operation-specific operand ranges and maxResult semantics', () => {
    const subtractionConfig = {
      level: 1, operations: ['-'], operandRange: { a: [10, 10], b: [3, 3] }, maxResult: 7,
    };
    const subtraction = generateProblem(0, 42, subtractionConfig);
    assert.equal(subtraction.a, 10);
    assert.equal(subtraction.b, 3);
    assert.equal(subtraction.answer, 7);

    const multiplicationConfig = {
      level: 1, operations: ['*'], operandRange: { a: [10, 10], b: [10, 10] }, maxResult: 5,
    };
    assert.equal(generateProblem(0, 42, multiplicationConfig).answer, 100);

    const divisionConfig = {
      level: 1, operations: ['/'], operandRange: { a: [12, 12], b: [3, 3] }, maxResult: 1,
    };
    const division = generateProblem(0, 42, divisionConfig);
    assert.equal(division.question, '36 ÷ 3 = ?');
    assert.equal(division.answer, 12);

    assert.throws(() => generateProblem(0, 42, {
      level: 1, operations: ['+'], operandRange: { a: [5, 5], b: [5, 5] }, maxResult: 9,
    }), /Level 1 cannot generate a safe \+ problem/);
    assert.throws(() => generateProblem(0, 42, {
      level: 1, operations: ['-'], operandRange: { a: [1, 2], b: [3, 4] }, maxResult: 10,
    }), /adjust the configured ranges/);
    assert.throws(() => generateProblem(0, 42, {
      level: 1, operations: ['/'], operandRange: { a: [1, 1], b: [0, 0] }, maxResult: 1,
    }), /adjust the configured ranges/);
  });

  it('samples within optional product and dividend caps and rejects impossible cap configurations', () => {
    const multiplicationConfig = {
      level: 11,
      operations: ['*'],
      operandRange: { a: [2, 8], b: [2, 8] },
      maxProduct: 19,
    };
    for (let seed = 0; seed < 100; seed++) {
      const problem = generateProblem(10, seed, multiplicationConfig);
      assert.ok(problem.answer <= multiplicationConfig.maxProduct);
      assert.equal(problem.answer, problem.a * problem.b);
    }

    const divisionConfig = {
      level: 11,
      operations: ['/'],
      operandRange: { a: [1, 8], b: [2, 5] },
      maxDividend: 17,
    };
    for (let seed = 0; seed < 100; seed++) {
      const problem = generateProblem(10, seed, divisionConfig);
      assert.ok(problem.a <= divisionConfig.maxDividend);
      assert.equal(problem.a, problem.answer * problem.b);
    }

    assert.throws(() => generateProblem(10, 42, {
      level: 11,
      operations: ['*'],
      operandRange: { a: [4, 5], b: [3, 4] },
      maxProduct: 11,
    }), /cannot generate a safe \* problem/);
    assert.throws(() => generateProblem(10, 42, {
      level: 11,
      operations: ['/'],
      operandRange: { a: [7, 10], b: [2, 4] },
      maxDividend: 13,
    }), /cannot generate a safe \/ problem/);
    assert.throws(() => generateProblem(10, 42, {
      level: 11,
      operations: ['*'],
      operandRange: { a: [1, 2], b: [1, 2] },
      maxProduct: -1,
    }), /invalid maxProduct/);
  });

  it('should never produce negative subtraction results', () => {
    for (let idx = 0; idx < TOTAL_LEVELS; idx++) {
      if (!_FullLevelConfig[idx].operations.includes('-')) continue;
      for (let seed = 0; seed < 250; seed++) {
        const p = generateProblem(idx, seed, _FullLevelConfig[idx]);
        if (p.operation === '-') {
          assert.ok(p.answer >= 0, `Level ${idx + 1} seed ${seed} produced negative subtraction: ${p.question} = ${p.answer}`);
        }
      }
    }
  });

  it('should produce only integer division results', () => {
    for (let idx = 0; idx < TOTAL_LEVELS; idx++) {
      if (!_FullLevelConfig[idx].operations.includes('/')) continue;
      for (let seed = 0; seed < 250; seed++) {
        const p = generateProblem(idx, seed, _FullLevelConfig[idx]);
        if (p.operation === '/') {
          assert.strictEqual(p.answer % 1, 0, `Level ${idx + 1} seed ${seed} produced non-integer division: ${p.question} = ${p.answer}`);
        }
      }
    }
  });

  it('should have correct waveSize values', () => {
    _FullLevelConfig.forEach((cfg, i) => {
      assert.strictEqual(cfg.waveSize, 30, `Level ${i + 1} waveSize ${cfg.waveSize} should be 30`);
    });
    assert.strictEqual(_FullLevelConfig[0].waveSize, 30, 'Level 1 should have waveSize=30');
    assert.strictEqual(_FullLevelConfig[14].waveSize, 30, 'Level 15 should have waveSize=30');
    assert.strictEqual(_FullLevelConfig[59].waveSize, 30, 'Level 60 should have waveSize=30');
  });

  it('should produce the same problem for the same seed', () => {
    for (let i = 0; i < TOTAL_LEVELS; i++) {
      const p1 = generateProblem(i, 12345, _FullLevelConfig[i]);
      const p2 = generateProblem(i, 12345, _FullLevelConfig[i]);

      assert.strictEqual(p1.question, p2.question, `Level ${i + 1} should produce same question with same seed`);
      assert.strictEqual(p1.answer, p2.answer, `Level ${i + 1} should produce same answer with same seed`);
      assert.deepStrictEqual(p1.distractors, p2.distractors, `Level ${i + 1} should produce same distractors with same seed`);
      assert.strictEqual(p1.operation, p2.operation, `Level ${i + 1} should produce same operation with same seed`);
    }
  });
});

describe('fiend composition 50/30/20 rule', () => {
  it('level 1: getFiendWeights(1) has exactly 1 entry with correct type and weight', () => {
    const weights = getFiendWeights(1);
    assert.strictEqual(weights.length, 1, 'Level 1 should have exactly 1 entry');
    assert.strictEqual(weights[0].type, _FullLevelConfig[0].fiendType, 'Entry type should match _FullLevelConfig[0].fiendType');
    assert.ok(Math.abs(weights[0].weight - 1.0) < 1e-9, 'Entry weight should be 1.0');
  });

  it('level 2: getFiendWeights(2) entries sum to 1.0, own type at 0.625', () => {
    const weights = getFiendWeights(2);
    const sum = weights.reduce((s, e) => s + e.weight, 0);
    assert.ok(Math.abs(sum - 1.0) < 1e-9, 'Weights should sum to 1.0');

    const ownEntry = weights.find(e => e.type === _FullLevelConfig[1].fiendType);
    assert.ok(ownEntry, 'Should have entry for _FullLevelConfig[1].fiendType');
    assert.ok(Math.abs(ownEntry.weight - 0.625) < 1e-9, 'Own type weight should be 0.625');
  });

  it('level 20: verify own/prev/prev-2 types with their weights', () => {
    const weights = getFiendWeights(20);
    const sum = weights.reduce((s, e) => s + e.weight, 0);
    assert.ok(Math.abs(sum - 1.0) < 1e-9, 'Weights should sum to 1.0');

    const type20 = _FullLevelConfig[19].fiendType;
    const type19 = _FullLevelConfig[18].fiendType;
    const type18 = _FullLevelConfig[17].fiendType;

    // Check if all three types are distinct
    const distinctTypes = new Set([type20, type19, type18]).size;

    if (distinctTypes === 3) {
      // All three are distinct, check 50/30/20 split
      const entry20 = weights.find(e => e.type === type20);
      const entry19 = weights.find(e => e.type === type19);
      const entry18 = weights.find(e => e.type === type18);

      assert.ok(entry20, `Should have entry for level 20 type (${type20})`);
      assert.ok(entry19, `Should have entry for level 19 type (${type19})`);
      assert.ok(entry18, `Should have entry for level 18 type (${type18})`);

      assert.ok(Math.abs(entry20.weight - 0.5) < 1e-9, `Level 20 type weight should be 0.5, got ${entry20.weight}`);
      assert.ok(Math.abs(entry19.weight - 0.3) < 1e-9, `Level 19 type weight should be 0.3, got ${entry19.weight}`);
      assert.ok(Math.abs(entry18.weight - 0.2) < 1e-9, `Level 18 type weight should be 0.2, got ${entry18.weight}`);
    } else if (distinctTypes === 2) {
      // Two types are the same, verify merged weight
      if (type20 === type19) {
        // 50% + 30% = 80% for this type, 20% for the other
        const mergedEntry = weights.find(e => e.type === type20);
        const otherEntry = weights.find(e => e.type === type18);
        assert.ok(Math.abs(mergedEntry.weight - 0.8) < 1e-9, 'Merged weight should be 0.8');
        assert.ok(Math.abs(otherEntry.weight - 0.2) < 1e-9, 'Other weight should be 0.2');
      } else if (type20 === type18) {
        // 50% + 20% = 70% for this type, 30% for the other
        const mergedEntry = weights.find(e => e.type === type20);
        const otherEntry = weights.find(e => e.type === type19);
        assert.ok(Math.abs(mergedEntry.weight - 0.7) < 1e-9, 'Merged weight should be 0.7');
        assert.ok(Math.abs(otherEntry.weight - 0.3) < 1e-9, 'Other weight should be 0.3');
      } else if (type19 === type18) {
        // 30% + 20% = 50% for this type, 50% for the other
        const mergedEntry = weights.find(e => e.type === type19);
        const otherEntry = weights.find(e => e.type === type20);
        assert.ok(Math.abs(mergedEntry.weight - 0.5) < 1e-9, 'Merged weight should be 0.5');
        assert.ok(Math.abs(otherEntry.weight - 0.5) < 1e-9, 'Other weight should be 0.5');
      }
    }
  });

  it('chapterForLevel: boundary checks', () => {
    assert.strictEqual(chapterForLevel(15), 1, 'Level 15 should be chapter 1');
    assert.strictEqual(chapterForLevel(16), 2, 'Level 16 should be chapter 2');
    assert.strictEqual(chapterForLevel(30), 2, 'Level 30 should be chapter 2');
    assert.strictEqual(chapterForLevel(31), 3, 'Level 31 should be chapter 3');
    assert.strictEqual(chapterForLevel(45), 3, 'Level 45 should be chapter 3');
    assert.strictEqual(chapterForLevel(46), 4, 'Level 46 should be chapter 4');
  });

  it('determinism: sampleFiendType returns consistent results', () => {
    const testCases = [[1, 0], [2, 3], [20, 5], [16, 0], [46, 12]];

    for (const [level, spawnIndex] of testCases) {
      const sample1 = sampleFiendType(level, spawnIndex);
      const sample2 = sampleFiendType(level, spawnIndex);
      assert.strictEqual(sample1, sample2, `Level ${level} spawn ${spawnIndex} should be deterministic`);

      const validTypes = getFiendWeights(level).map(e => e.type);
      assert.ok(validTypes.includes(sample1), `Level ${level} spawn ${spawnIndex} returned ${sample1}, not in valid types`);
    }
  });

  it('distribution: level 20 sample distribution matches weights', () => {
    const weights = getFiendWeights(20);
    const counts = {};

    for (const w of weights) {
      counts[w.type] = 0;
    }

    const numSamples = 2000;
    for (let i = 0; i < numSamples; i++) {
      const type = sampleFiendType(20, i);
      if (counts.hasOwnProperty(type)) {
        counts[type]++;
      }
    }

    for (const w of weights) {
      const observed = counts[w.type] / numSamples;
      assert.ok(Math.abs(observed - w.weight) < 0.05,
        `Type ${w.type} observed frequency ${observed} should be within 0.05 of weight ${w.weight}`);
    }
  });
});
