// Arithmo Slayer - Levels Tests
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LevelConfig, generateProblem, getArithmeticOptionCount, chapterForLevel, getFiendWeights, sampleFiendType, revealQuestion, MISSING_OPERAND_FROM_LEVEL, missingOperandShare, bossRoundKinds, isBossRoundLevel, BOSS_ROUND_LEVELS, TOP_WEIGHT_FROM_LEVEL, TOTAL_LEVELS } from './levels.js';
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

  it('grows the largest operand steeply early and softly late: 3 at level 1, 10 at level 4, 30 at level 60', () => {
    const cap = level => _FullLevelConfig[level - 1].operandRange.a[1];
    _FullLevelConfig.forEach(cfg => {
      assert.deepEqual(cfg.operandRange.b, cfg.operandRange.a, `level ${cfg.level}`);
      assert.equal(cfg.operandRange.a[0], cfg.level >= 5 ? 0 : 1, `level ${cfg.level} lower bound`);
      assert.equal(cfg.maxResult, 2 * cap(cfg.level));
    });
    assert.equal(cap(1), 3);
    assert.equal(cap(4), 10);
    assert.equal(cap(60), 30);
    _FullLevelConfig.slice(1).forEach(cfg => {
      assert.ok(cap(cfg.level) >= cap(cfg.level - 1), `level ${cfg.level} never gets easier`);
    });
    const gain = (from, to) => cap(to) - cap(from);
    assert.ok(gain(1, 11) > gain(25, 35) && gain(25, 35) > gain(50, 60), 'growth slows down');
    assert.ok(gain(1, 4) >= 7, 'the first three levels already climb to 10');
  });

  it('unlocks one operation every ten levels and mixes all four from level 40', () => {
    const unlock = { '+': 1, '-': 10, '*': 20, '/': 30 };
    _FullLevelConfig.forEach(cfg => {
      const ops = new Set(cfg.operations);
      for (const [op, from] of Object.entries(unlock)) {
        assert.equal(ops.has(op), cfg.level >= from, `level ${cfg.level} ${op}`);
      }
    });
    _FullLevelConfig.filter(cfg => cfg.level >= 40).forEach(cfg => {
      assert.deepEqual(cfg.operations, ['+', '-', '*', '/'], `level ${cfg.level}`);
    });
  });

  it('leans half of the unlock levels (10, 20, 30) on the new operation', () => {
    [[10, '-'], [20, '*'], [30, '/']].forEach(([level, op]) => {
      const ops = _FullLevelConfig[level - 1].operations;
      assert.equal(ops.filter(o => o === op).length * 2, ops.length, `level ${level}`);
    });
  });

  it('keeps every product and dividend within 30 x 30', () => {
    assert.ok(_FullLevelConfig.every(cfg => cfg.operandRange.a[1] <= 30 && cfg.operandRange.b[1] <= 30));
    assert.ok(_FullLevelConfig.every(cfg => !('maxProduct' in cfg) && !('maxDividend' in cfg)));
  });
});

describe('generateProblem', () => {
  it('should return correct math for all 60 levels', () => {
    for (let i = 0; i < TOTAL_LEVELS; i++) {
      for (let seed = 0; seed < 60; seed++) {
        const problem = generateProblem(i, seed, _FullLevelConfig[i]);
        const match = problem.question.match(/^(\?|\d+)\s*([+\-−×÷])\s*(\?|\d+)\s*=\s*(\?|\d+)$/);
        assert.ok(match, `Level ${i + 1} question should be "a OP b = ?" or a missing-operand form, got: ${problem.question}`);
        const sign = { '+': '+', '-': '-', '*': '×', '/': '÷' }[problem.operation];
        assert.equal(match[2].replace('−', '-'), sign.replace('−', '-'));
        const apply = { '+': (x, y) => x + y, '-': (x, y) => x - y, '*': (x, y) => x * y, '/': (x, y) => x / y }[problem.operation];
        assert.equal(apply(problem.a, problem.b), problem.result, `${problem.question} operands`);
        const blanks = [match[1], match[3], match[4]].filter(part => part === '?').length;
        assert.equal(blanks, 1, `${problem.question} has exactly one blank`);
        if (problem.hidden === 'a') assert.equal(problem.answer, problem.a);
        else if (problem.hidden === 'b') assert.equal(problem.answer, problem.b);
        else assert.equal(problem.answer, problem.result);
        assert.equal(revealQuestion(problem), problem.question.replace('?', String(problem.answer)));
      }
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
          assert.ok(problem.result >= rangeA[0] && problem.result <= rangeA[1]);
          assert.ok(problem.b >= Math.max(1, rangeB[0]) && problem.b <= rangeB[1]);
          assert.equal(problem.a, problem.result * problem.b);
        } else {
          assert.ok(problem.a >= rangeA[0] && problem.a <= rangeA[1]);
          assert.ok(problem.b >= rangeB[0] && problem.b <= rangeB[1]);
        }
        if (problem.operation === '-') assert.ok(problem.b <= problem.a);
        if (['+', '-'].includes(problem.operation)) {
          assert.ok(problem.result <= _FullLevelConfig[i].maxResult);
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
      assert.ok(problem.result <= multiplicationConfig.maxProduct);
      assert.equal(problem.result, problem.a * problem.b);
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
      assert.equal(problem.a, problem.result * problem.b);
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

describe('missing-operand questions and zero', () => {
  const unlockLevel = MISSING_OPERAND_FROM_LEVEL;

  it('only appear from level 10 and never before', () => {
    for (let i = 0; i < unlockLevel - 1; i++) {
      for (let seed = 0; seed < 200; seed++) {
        assert.equal(generateProblem(i, seed, _FullLevelConfig[i]).hidden, null);
      }
    }
  });

  it('hide either operand for every operation, with the hidden value as the answer', () => {
    const seen = new Set();
    for (let i = unlockLevel - 1; i < TOTAL_LEVELS; i++) {
      for (let seed = 0; seed < 300; seed++) {
        const p = generateProblem(i, seed, _FullLevelConfig[i]);
        if (p.hidden) seen.add(`${p.operation}${p.hidden}`);
      }
    }
    for (const op of ['+', '-', '*', '/']) {
      assert.ok(seen.has(`${op}a`) && seen.has(`${op}b`), `${op} hides both operands`);
    }
  });

  it('ramps from one question in four at level 10 to one in two at level 60', () => {
    assert.equal(missingOperandShare(9), 0);
    assert.equal(missingOperandShare(10), 0.25);
    assert.equal(missingOperandShare(60), 0.5);
    for (const level of [10, 35, 60]) {
      let hidden = 0;
      const total = 4000;
      for (let seed = 0; seed < total; seed++) {
        if (generateProblem(level - 1, seed, _FullLevelConfig[level - 1]).hidden) hidden++;
      }
      // Zero-operand multiplications and zero quotients stay ordinary, so allow a small dip.
      const expected = missingOperandShare(level);
      assert.ok(hidden / total > expected - 0.06 && hidden / total < expected + 0.03,
        `level ${level}: share ${hidden / total} vs ${expected}`);
    }
  });

  it('has exactly one solution and never divides by zero', () => {
    for (let i = 0; i < TOTAL_LEVELS; i++) {
      for (let seed = 0; seed < 400; seed++) {
        const p = generateProblem(i, seed, _FullLevelConfig[i]);
        if (p.operation === '/') assert.ok(p.b >= 1, `${p.question} divides by a non-zero number`);
        if (p.hidden && p.operation === '*') {
          assert.ok((p.hidden === 'a' ? p.b : p.a) !== 0, `${p.question} is ambiguous`);
        }
        if (p.hidden && p.operation === '/') {
          assert.ok(p.result !== 0 || p.hidden === 'a', `${p.question} is ambiguous`);
          if (p.hidden === 'b') assert.ok(p.answer >= 1);
        }
        assert.ok(!/÷\s*0\b/.test(p.question), p.question);
      }
    }
  });

  it('offers zero as an operand only from level 5', () => {
    for (let level = 1; level <= 6; level++) {
      const questions = new Set();
      for (let seed = 0; seed < 400; seed++) {
        questions.add(generateProblem(level - 1, seed, _FullLevelConfig[level - 1]).question);
      }
      const hasZero = [...questions].some(q => /(^|\s)0(\s|$)/.test(q));
      assert.equal(hasZero, level >= 5, `level ${level}`);
    }
    const level1 = new Set();
    for (let seed = 0; seed < 300; seed++) level1.add(generateProblem(0, seed, _FullLevelConfig[0]).question);
    assert.ok([...level1].every(q => !/[4-9]/.test(q)), 'level 1 stays within 1-3');
  });

  it('keeps answer choices valid for hidden operands', () => {
    for (let seed = 0; seed < 300; seed++) {
      const p = generateProblem(9, seed, _FullLevelConfig[9]);
      assert.equal(p.options.length, 5);
      assert.equal(p.options.filter(n => n === p.answer).length, 1);
      assert.ok(p.options.every(n => n >= 0));
    }
  });
});

describe('livelier questions', () => {
  const cfgOf = level => _FullLevelConfig[level - 1];
  const sample = (level, count, options) =>
    Array.from({ length: count }, (_, seed) => generateProblem(level - 1, seed, cfgOf(level), options));

  it('skips dull ordinary questions from level 10 on', () => {
    for (let level = 10; level <= 60; level++) {
      for (const p of sample(level, 300, { missing: false })) {
        if (p.operation === '*') assert.ok(p.a > 1 && p.b > 1, `${p.question}`);
        if (p.operation === '/') assert.ok(p.b > 1 && p.result > 0, `${p.question}`);
        if (p.operation === '-') assert.ok(p.a !== p.b, `${p.question}`);
        if (p.operation === '+') assert.ok(p.a + p.b > 0, `${p.question}`);
      }
    }
  });

  it('opens x and / gently: operands stay at 10 for five levels, then grow to the level cap', () => {
    for (const [op, from] of [['*', 20], ['/', 30]]) {
      for (let level = from; level < from + 5; level++) {
        const cap = cfgOf(level).operandRangeByOp?.[op]?.a[1];
        assert.equal(cap, 10, `${op} at level ${level}`);
        for (const p of sample(level, 300, { operations: [op], missing: false })) {
          const factors = op === '*' ? [p.a, p.b] : [p.result, p.b];
          assert.ok(factors.every(n => n <= 10), `${p.question} at level ${level}`);
        }
      }
      const later = cfgOf(from + 5).operandRangeByOp?.[op]?.a[1] ?? cfgOf(from + 5).operandRange.a[1];
      assert.ok(later > 10);
    }
  });

  it('eases the new operation after each unlock level and climbs back to an even mix', () => {
    for (const [op, from] of [['-', 10], ['*', 20], ['/', 30]]) {
      const share = level => {
        const ops = cfgOf(level).operations;
        return ops.filter(o => o === op).length / ops.length;
      };
      assert.equal(share(from), 0.5);
      assert.ok(share(from + 1) < 0.25, `level ${from + 1} is easier`);
      for (let level = from + 1; level < from + 4; level++) {
        assert.ok(share(level + 1) > share(level), `level ${level + 1} climbs back`);
      }
      const unique = new Set(cfgOf(from + 5).operations);
      assert.equal(cfgOf(from + 5).operations.length, unique.size, `level ${from + 5} is an even mix`);
    }
  });

  it('weights operand draws towards the top third of the range from level 5', () => {
    assert.equal(TOP_WEIGHT_FROM_LEVEL, 5);
    const level = 30;
    const cap = cfgOf(level).operandRange.a[1];
    const problems = sample(level, 3000, { operations: ['+'], missing: false });
    const topShare = problems.filter(p => p.a >= (cap * 2) / 3).length / problems.length;
    assert.ok(topShare > 0.45, `top-third share ${topShare}`);
  });

  it('keeps the data deterministic per seed with forced kinds', () => {
    assert.deepEqual(generateProblem(29, 7, cfgOf(30), { missing: true }), generateProblem(29, 7, cfgOf(30), { missing: true }));
  });

  it('shows runestone counts for some additions on levels 1-2 only', () => {
    const shown = sample(1, 200).filter(p => p.visual);
    assert.ok(shown.length > 40 && shown.length < 160, `${shown.length} runestone questions`);
    shown.forEach(p => {
      assert.ok(p.a + p.b <= 6, `${p.question} has at most six stones`);
      assert.deepEqual(p.visual, { a: p.a, b: p.b });
      assert.equal(p.operation, '+');
      assert.match(p.question, /^\d \+ \d = \?$/, 'the digits stay in the question for reveals and summaries');
    });
    for (const level of [3, 9, 10, 30]) assert.ok(sample(level, 100).every(p => p.visual === null));
    const level2 = sample(2, 600).filter(p => p.operation === '+');
    assert.ok(level2.some(p => p.a + p.b > 6 && p.visual === null), 'bigger sums stay digits on level 2');
    assert.ok(level2.some(p => p.a + p.b <= 6 && p.visual), 'small sums still get stones on level 2');
    assert.ok(level2.every(p => p.a + p.b > 6 ? p.visual === null : true));
    assert.ok(sample(1, 100).every(p => !('display' in p)));
  });

  it('asks a boss round three different question types', () => {
    assert.deepEqual([...BOSS_ROUND_LEVELS], [20, 30, 40, 50, 60]);
    assert.ok(BOSS_ROUND_LEVELS.every(isBossRoundLevel) && !isBossRoundLevel(25));
    for (const level of BOSS_ROUND_LEVELS) {
      const [ordinary, newest, missing] = bossRoundKinds(level);
      assert.deepEqual(ordinary, { missing: false });
      assert.ok(newest.operations.length > 0);
      for (const p of sample(level, 100, newest)) {
        assert.ok(newest.operations.includes(p.operation));
        assert.equal(p.hidden, null, 'the second hit is a plain question of the newest operation');
      }
      for (const p of sample(level, 100, ordinary)) assert.equal(p.hidden, null);
      for (const p of sample(level, 100, missing)) {
        assert.ok(p.hidden, `${p.question} hides an operand`);
        assert.ok(p.question.includes('?') && !p.question.endsWith('= ?'));
      }
    }
  });
});

describe('fiends from the two levels before', () => {
  it('every level still mixes its own fiend type with the two before it (50/30/20)', () => {
    for (let level = 3; level <= 60; level++) {
      const weights = getFiendWeights(level);
      const types = new Set(weights.map(w => w.type));
      for (const back of [0, 1, 2]) {
        const prior = getFiendWeights(level - back)[0].type;
        assert.ok(types.has(prior), `level ${level} includes the fiend of level ${level - back}`);
      }
      assert.ok(Math.abs(weights.reduce((sum, w) => sum + w.weight, 0) - 1) < 1e-9);
    }
  });
});
