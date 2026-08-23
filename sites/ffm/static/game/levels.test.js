// Arithmo Slayer - Levels Tests
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { LevelConfig, generateProblem } from './levels.js';

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

      const questionMatch = problem.question.match(/^(\d+)\s*([+−×÷])\s*(\d+)\s*=\s*\?$/);
      assert.ok(questionMatch, `Level ${i + 1} question should be in format "a OP b = ?", got: ${problem.question}`);

      const a = parseInt(questionMatch[1], 10);
      const op = questionMatch[2];
      const b = parseInt(questionMatch[3], 10);

      let expected;
      if (op === '+') {
        expected = a + b;
      } else if (op === '−') {
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
      assert.ok(cfg.waveSize >= 5 && cfg.waveSize <= 8,
        `Level ${i + 1} waveSize ${cfg.waveSize} is outside 5–8`);
    });
    assert.strictEqual(LevelConfig[0].waveSize, 5, 'Level 1 should have waveSize=5');
    assert.strictEqual(LevelConfig[14].waveSize, 6, 'Level 15 should have waveSize=6');
    assert.strictEqual(LevelConfig[59].waveSize, 8, 'Level 60 should have waveSize=8');
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
