// Arithmo Slayer - Levels Tests
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { LevelConfig, generateProblem } from './levels.js';

describe('LevelConfig', () => {
  it('should have exactly 40 entries with valid fields', () => {
    assert.strictEqual(LevelConfig.length, 40, 'LevelConfig should have 40 entries');

    LevelConfig.forEach((cfg, idx) => {
      assert.strictEqual(cfg.level, idx + 1, `Level ${idx} should have level=${idx + 1}`);
      assert.ok(cfg.chapter >= 1 && cfg.chapter <= 4, `Level ${idx + 1} should have chapter 1-4`);
      assert.ok(Array.isArray(cfg.operations) && cfg.operations.length > 0, `Level ${idx + 1} should have non-empty operations array`);
      assert.ok(typeof cfg.fiendType === 'string' && cfg.fiendType.length > 0, `Level ${idx + 1} should have valid fiendType`);
      assert.ok(typeof cfg.inputMode === 'string' && (cfg.inputMode === 'multiple-choice' || cfg.inputMode === 'free-text'), `Level ${idx + 1} should have valid inputMode`);
    });
  });
});

describe('generateProblem', () => {
  it('should return correct math for all 40 levels', () => {
    for (let i = 0; i < 40; i++) {
      const problem = generateProblem(i, 42);
      
      // Parse the question
      const questionMatch = problem.question.match(/^(\d+)\s*([+−×÷])\s*(\d+)\s*=\s*\?$/);
      assert.ok(questionMatch, `Level ${i + 1} question should be in format "a OP b = ?", got: ${problem.question}`);
      
      const a = parseInt(questionMatch[1], 10);
      const op = questionMatch[2];
      const b = parseInt(questionMatch[3], 10);
      
      let expected;
      if (op === '+') {
        expected = a + b;
      } else if (op === '−') { // U+2212
        expected = a - b;
      } else if (op === '×') { // U+00D7
        expected = a * b;
      } else if (op === '÷') { // U+00F7
        expected = Math.floor(a / b);
      } else {
        assert.fail(`Unknown operator: ${op}`);
      }
      
      assert.strictEqual(problem.answer, expected, `Level ${i + 1} answer mismatch: expected ${expected}, got ${problem.answer}`);
    }
  });

  it('should return 3 distinct distractors for levels 1-5', () => {
    for (let i = 0; i < 5; i++) {
      const problem = generateProblem(i, 42);
      
      assert.ok(Array.isArray(problem.distractors), `Level ${i + 1} should have distractors array`);
      assert.strictEqual(problem.distractors.length, 3, `Level ${i + 1} should have 3 distractors`);
      
      // Check all values are distinct from answer
      problem.distractors.forEach(d => {
        assert.notStrictEqual(d, problem.answer, `Level ${i + 1} distractor ${d} should not equal answer ${problem.answer}`);
      });
      
      // Check all distractors are distinct from each other
      const uniqueDistractors = new Set(problem.distractors);
      assert.strictEqual(uniqueDistractors.size, 3, `Level ${i + 1} should have 3 distinct distractors`);
    }
  });

  it('should return empty or no distractors for levels 6-40', () => {
    for (let i = 5; i < 40; i++) {
      const problem = generateProblem(i, 42);
      
      assert.ok(
        !problem.distractors || problem.distractors.length === 0,
        `Level ${i + 1} should have empty or no distractors, got: ${problem.distractors}`
      );
    }
  });

  it('should never produce negative subtraction results', () => {
    // Test levels 11-20 (indices 10-19) with various seeds
    for (let idx = 10; idx < 20; idx++) {
      for (let seed = 0; seed < 1000; seed++) {
        const p = generateProblem(idx, seed);
        if (p.operation === '-') {
          assert.ok(p.answer >= 0, `Level ${idx + 1} seed ${seed} produced negative subtraction: ${p.question} = ${p.answer}`);
        }
      }
    }
  });

  it('should produce only integer division results', () => {
    // Test levels 31-40 (indices 30-39) with various seeds
    for (let idx = 30; idx < 40; idx++) {
      for (let seed = 0; seed < 1000; seed++) {
        const p = generateProblem(idx, seed);
        if (p.operation === '/') {
          assert.strictEqual(p.answer % 1, 0, `Level ${idx + 1} seed ${seed} produced non-integer division: ${p.question} = ${p.answer}`);
        }
      }
    }
  });

  it('should have correct waveSize values', () => {
    // All levels must be in the 5–8 range
    LevelConfig.forEach((cfg, i) => {
      assert.ok(cfg.waveSize >= 5 && cfg.waveSize <= 8,
        `Level ${i + 1} waveSize ${cfg.waveSize} is outside 5–8`);
    });
    assert.strictEqual(LevelConfig[0].waveSize,  5, 'Level 1 should have waveSize=5');
    assert.strictEqual(LevelConfig[9].waveSize,  6, 'Level 10 should have waveSize=6');
    assert.strictEqual(LevelConfig[39].waveSize, 8, 'Level 40 should have waveSize=8');
  });

  it('should produce the same problem for the same seed', () => {
    // Test determinism across all levels
    for (let i = 0; i < 40; i++) {
      const p1 = generateProblem(i, 12345);
      const p2 = generateProblem(i, 12345);
      
      assert.strictEqual(p1.question, p2.question, `Level ${i + 1} should produce same question with same seed`);
      assert.strictEqual(p1.answer, p2.answer, `Level ${i + 1} should produce same answer with same seed`);
      assert.deepStrictEqual(p1.distractors, p2.distractors, `Level ${i + 1} should produce same distractors with same seed`);
      assert.strictEqual(p1.operation, p2.operation, `Level ${i + 1} should produce same operation with same seed`);
    }
  });
});
