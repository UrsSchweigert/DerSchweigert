import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BASICS_DEFAULT_DURATION,
  BASICS_DURATIONS,
  BASICS_OPTION_COUNT,
  BASICS_SETS,
  SQUARE_ROOT_MAX,
  SQUARE_ROOT_MIN,
  basicsBadgeIds,
  basicsFactorRange,
  basicsLevelConfig,
  basicsSetUnlocked,
  generateBasicsProblem,
  normaliseBasicsDuration,
  normaliseBasicsFactors,
} from './basics-math.js';
import { revealQuestion } from './levels.js';

const SEEDS = Array.from({ length: 400 }, (_, index) => index + 1);

function assertUsableProblem(problem) {
  assert.equal(problem.options.length, BASICS_OPTION_COUNT);
  assert.equal(new Set(problem.options).size, BASICS_OPTION_COUNT, 'choices must be distinct');
  assert.equal(problem.options.filter((value) => value === problem.answer).length, 1);
  assert.equal(problem.distractors.length, BASICS_OPTION_COUNT - 1);
  assert.ok(!problem.distractors.includes(problem.answer));
  for (const value of problem.options) {
    assert.ok(Number.isSafeInteger(value) && value >= 0, `${value} must be a non-negative integer`);
  }
  assert.ok(problem.question.endsWith(' = ?'));
  assert.ok(revealQuestion(problem).endsWith(` = ${problem.answer}`));
}

test('the three sets are the small tables, the big tables and squares/roots', () => {
  assert.deepEqual(BASICS_SETS.map((set) => set.id), ['tables-1-10', 'tables-1-15', 'squares-roots']);
  assert.deepEqual(BASICS_SETS.map((set) => set.gate), ['campaign1', 'campaign2', 'campaign2']);
});

test('the small tables need the Campaign I unlock, the rest Campaign II', () => {
  assert.equal(basicsSetUnlocked('tables-1-10', { campaign1: true, campaign2: false }), true);
  assert.equal(basicsSetUnlocked('tables-1-10', { campaign1: false, campaign2: true }), false);
  assert.equal(basicsSetUnlocked('tables-1-15', { campaign1: true, campaign2: false }), false);
  assert.equal(basicsSetUnlocked('tables-1-15', { campaign1: false, campaign2: true }), true);
  assert.equal(basicsSetUnlocked('squares-roots', { campaign1: false, campaign2: true }), true);
  assert.equal(basicsSetUnlocked('squares-roots', {}), false);
  assert.throws(() => basicsSetUnlocked('tables-1-100', { campaign1: true }), TypeError);
});

test('every table problem is a real fact from its own set', () => {
  for (const set of BASICS_SETS.filter((entry) => entry.min !== undefined)) {
    const seen = new Set();
    for (const seed of SEEDS) {
      const problem = generateBasicsProblem(set.id, seed);
      assertUsableProblem(problem);
      assert.match(problem.question, /^(\d+) × (\d+) = \?$/);
      const [, a, b] = problem.question.match(/^(\d+) × (\d+) = \?$/);
      assert.ok(Number(a) >= set.min && Number(a) <= set.max, `${a} outside ${set.id}`);
      assert.ok(Number(b) >= set.min && Number(b) <= set.max, `${b} outside ${set.id}`);
      assert.equal(problem.answer, Number(a) * Number(b));
      seen.add(problem.question);
    }
    assert.ok(seen.size > 50, `${set.id} must not repeat itself`);
  }
});

test('every series of the small tables actually appears', () => {
  const factors = new Set();
  for (const seed of SEEDS) {
    const [, a, b] = generateBasicsProblem('tables-1-10', seed).question.match(/^(\d+) × (\d+)/);
    factors.add(Number(a));
    factors.add(Number(b));
  }
  assert.deepEqual([...factors].sort((x, y) => x - y), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
});

test('squares and roots use the n² and √n² forms with their own answers', () => {
  const forms = new Set();
  const roots = new Set();
  for (const seed of SEEDS) {
    const problem = generateBasicsProblem('squares-roots', seed);
    assertUsableProblem(problem);
    if (problem.question.includes('²')) {
      forms.add('square');
      const [, n] = problem.question.match(/^(\d+)² = \?$/);
      assert.ok(Number(n) >= SQUARE_ROOT_MIN && Number(n) <= SQUARE_ROOT_MAX);
      assert.equal(problem.answer, Number(n) ** 2);
    } else {
      forms.add('root');
      const [, square] = problem.question.match(/^√(\d+) = \?$/);
      const n = Math.sqrt(Number(square));
      assert.ok(Number.isInteger(n) && n >= SQUARE_ROOT_MIN && n <= SQUARE_ROOT_MAX);
      assert.equal(problem.answer, n);
      roots.add(n);
    }
  }
  assert.deepEqual([...forms].sort(), ['root', 'square']);
  assert.equal(roots.size, SQUARE_ROOT_MAX - SQUARE_ROOT_MIN + 1);
});

test('a chosen mix asks only the chosen tables, on either side of the ×', () => {
  const questions = SEEDS.map((seed) =>
    generateBasicsProblem('tables-1-10', seed, { factors: [3, 7] }).question);
  for (const question of questions) {
    const [, a, b] = question.match(/^(\d+) × (\d+) = \?$/);
    assert.ok([3, 7].includes(Number(a)) || [3, 7].includes(Number(b)), question);
    assert.ok(Number(a) <= 10 && Number(b) <= 10, question);
  }
  assert.ok(questions.some((question) => question.startsWith('3 × ')), 'the table can lead');
  assert.ok(questions.some((question) => /^\d+ × 3 = \?$/.test(question)), 'the table can follow');
  assert.ok(questions.some((question) => question.startsWith('7 × ')));
});

test('the chosen tables are cleaned, sorted and limited to the set', () => {
  assert.deepEqual(basicsFactorRange('tables-1-10'), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.deepEqual(basicsFactorRange('tables-1-15'), Array.from({ length: 15 }, (_, index) => index + 1));
  assert.deepEqual(basicsFactorRange('squares-roots'), []);
  assert.deepEqual(normaliseBasicsFactors('tables-1-10', [7, 3, 3, 99, 0, 'x']), [3, 7]);
  assert.deepEqual(normaliseBasicsFactors('tables-1-10', ['9']), [9]);
  // No choice (or a choice that fits nothing) means the whole set, never none.
  assert.deepEqual(normaliseBasicsFactors('tables-1-10', []), basicsFactorRange('tables-1-10'));
  assert.deepEqual(normaliseBasicsFactors('tables-1-10', null), basicsFactorRange('tables-1-10'));
  assert.deepEqual(normaliseBasicsFactors('tables-1-10', [99]), basicsFactorRange('tables-1-10'));
  assert.deepEqual(normaliseBasicsFactors('squares-roots', [3]), []);
});

test('the synthetic level config stays in chapter 1 and names its set', () => {
  for (const set of BASICS_SETS) {
    const cfg = basicsLevelConfig(set.id);
    assert.equal(cfg.level, 1);
    assert.equal(cfg.artLevel, 1);
    assert.equal(cfg.waveSize, 10);
    assert.equal(cfg.basicsSetId, set.id);
    assert.deepEqual(cfg.operations, ['*']);
  }
  assert.throws(() => basicsLevelConfig('nope'), TypeError);
});

test('only the offered run lengths play, everything else falls back to the default', () => {
  assert.deepEqual([...BASICS_DURATIONS], [5, 10, 15, 20, 30]);
  assert.equal(BASICS_DEFAULT_DURATION, 15);
  for (const minutes of BASICS_DURATIONS) assert.equal(normaliseBasicsDuration(minutes), minutes);
  assert.equal(normaliseBasicsDuration(String(20)), 20, 'a stored value comes back as a string');
  for (const bad of [undefined, null, '', 0, -5, 7, 120, 'fast', Number.NaN]) {
    assert.equal(normaliseBasicsDuration(bad), BASICS_DEFAULT_DURATION, String(bad));
  }
});

test('badge ids name the practised set', () => {
  assert.deepEqual(basicsBadgeIds('tables-1-10'), ['practice-basics-tables-1-10']);
  assert.deepEqual(basicsBadgeIds('squares-roots'), ['practice-basics-squares-roots']);
  assert.throws(() => basicsBadgeIds('nope'), TypeError);
});

test('the generator is seeded, so a session can be replayed', () => {
  assert.deepEqual(generateBasicsProblem('tables-1-15', 42), generateBasicsProblem('tables-1-15', 42));
});
