// Arithmo Slayer - Levels Tests
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { LevelConfig, generateProblem, chapterForLevel, getFiendWeights, sampleFiendType } from './levels.js';

const TOTAL_LEVELS = 60;

describe('LevelConfig', () => {
  it('should have exactly 60 entries with valid fields', () => {
    assert.strictEqual(LevelConfig.length, TOTAL_LEVELS, 'LevelConfig should have 60 entries');

    LevelConfig.forEach((cfg, idx) => {
      assert.strictEqual(cfg.level, idx + 1, `Level ${idx + 1} should have level=${idx + 1}`);
      assert.ok(cfg.chapter >= 1 && cfg.chapter <= 4, `Level ${idx + 1} should have chapter 1-4`);
      assert.ok(Array.isArray(cfg.operations) && cfg.operations.length > 0, `Level ${idx + 1} should have non-empty operations array`);
      assert.ok(typeof cfg.fiendType === 'string' && cfg.fiendType.length > 0, `Level ${idx + 1} should have valid fiendType`);
      assert.ok(typeof cfg.inputMode === 'string' && (cfg.inputMode === 'multiple-choice' || cfg.inputMode === 'free-text'), `Level ${idx + 1} should have valid inputMode`);
      assert.ok(typeof cfg.fiendHP === 'number' && cfg.fiendHP >= 1 && cfg.fiendHP <= 4, `Level ${idx + 1} should have fiendHP in 1-4`);
    });
  });

  it('should enforce 15-level curriculum blocks', () => {
    const block1 = LevelConfig.slice(0, 15);
    const block2 = LevelConfig.slice(15, 30);
    const block3 = LevelConfig.slice(30, 45);
    const block4 = LevelConfig.slice(45, 60);

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
});

describe('generateProblem', () => {
  it('should return correct math for all 60 levels', () => {
    for (let i = 0; i < TOTAL_LEVELS; i++) {
      const problem = generateProblem(i, 42);

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

  it('should return distractors only for multiple-choice levels', () => {
    for (let i = 0; i < TOTAL_LEVELS; i++) {
      const cfg = LevelConfig[i];
      const problem = generateProblem(i, 42);

      if (cfg.inputMode === 'multiple-choice') {
        assert.ok(Array.isArray(problem.distractors), `Level ${i + 1} should have distractors array`);
        assert.strictEqual(problem.distractors.length, 3, `Level ${i + 1} should have 3 distractors`);

        problem.distractors.forEach(d => {
          assert.notStrictEqual(d, problem.answer, `Level ${i + 1} distractor ${d} should not equal answer ${problem.answer}`);
        });

        const uniqueDistractors = new Set(problem.distractors);
        assert.strictEqual(uniqueDistractors.size, 3, `Level ${i + 1} should have 3 distinct distractors`);
      } else {
        assert.ok(!problem.distractors || problem.distractors.length === 0, `Level ${i + 1} should have empty or no distractors`);
      }
    }
  });

  it('should never produce negative subtraction results', () => {
    for (let idx = 0; idx < TOTAL_LEVELS; idx++) {
      if (!LevelConfig[idx].operations.includes('-')) continue;
      for (let seed = 0; seed < 250; seed++) {
        const p = generateProblem(idx, seed);
        if (p.operation === '-') {
          assert.ok(p.answer >= 0, `Level ${idx + 1} seed ${seed} produced negative subtraction: ${p.question} = ${p.answer}`);
        }
      }
    }
  });

  it('should produce only integer division results', () => {
    for (let idx = 0; idx < TOTAL_LEVELS; idx++) {
      if (!LevelConfig[idx].operations.includes('/')) continue;
      for (let seed = 0; seed < 250; seed++) {
        const p = generateProblem(idx, seed);
        if (p.operation === '/') {
          assert.strictEqual(p.answer % 1, 0, `Level ${idx + 1} seed ${seed} produced non-integer division: ${p.question} = ${p.answer}`);
        }
      }
    }
  });

  it('should have correct waveSize values', () => {
    LevelConfig.forEach((cfg, i) => {
      assert.strictEqual(cfg.waveSize, 30, `Level ${i + 1} waveSize ${cfg.waveSize} should be 30`);
    });
    assert.strictEqual(LevelConfig[0].waveSize, 30, 'Level 1 should have waveSize=30');
    assert.strictEqual(LevelConfig[14].waveSize, 30, 'Level 15 should have waveSize=30');
    assert.strictEqual(LevelConfig[59].waveSize, 30, 'Level 60 should have waveSize=30');
  });

  it('should produce the same problem for the same seed', () => {
    for (let i = 0; i < TOTAL_LEVELS; i++) {
      const p1 = generateProblem(i, 12345);
      const p2 = generateProblem(i, 12345);

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
    assert.strictEqual(weights[0].type, LevelConfig[0].fiendType, 'Entry type should match LevelConfig[0].fiendType');
    assert.ok(Math.abs(weights[0].weight - 1.0) < 1e-9, 'Entry weight should be 1.0');
  });

  it('level 2: getFiendWeights(2) entries sum to 1.0, own type at 0.625', () => {
    const weights = getFiendWeights(2);
    const sum = weights.reduce((s, e) => s + e.weight, 0);
    assert.ok(Math.abs(sum - 1.0) < 1e-9, 'Weights should sum to 1.0');
    
    const ownEntry = weights.find(e => e.type === LevelConfig[1].fiendType);
    assert.ok(ownEntry, 'Should have entry for LevelConfig[1].fiendType');
    assert.ok(Math.abs(ownEntry.weight - 0.625) < 1e-9, 'Own type weight should be 0.625');
  });

  it('level 20: verify own/prev/prev-2 types with their weights', () => {
    const weights = getFiendWeights(20);
    const sum = weights.reduce((s, e) => s + e.weight, 0);
    assert.ok(Math.abs(sum - 1.0) < 1e-9, 'Weights should sum to 1.0');

    const type20 = LevelConfig[19].fiendType;
    const type19 = LevelConfig[18].fiendType;
    const type18 = LevelConfig[17].fiendType;

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
