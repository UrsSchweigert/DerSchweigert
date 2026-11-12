import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { countSolutions, evaluateStrike, ruleInfo } from './boss-rules.js';
import {
  COMPOSE_OPERATIONS,
  generateComposeProblem,
  generateEqualShareProblem,
  generateFactorChainProblem,
  generateInverseProblem,
  generateOddOneOutProblem,
  generateOrderingProblem,
  generatePairSumProblem,
  generateSequenceProblem,
  orbRangeForBand,
} from './boss-problems.js';

// The band each act ends on, mirrored from app/level_data.json so the locks
// this prototype generates are the ones those levels actually pose.
const ACT_BANDS = {
  1: { operations: ['+', '-'], operandRange: { a: [2, 12], b: [1, 7] }, maxResult: 19 },
  2: { operations: ['+', '-'], operandRange: { a: [10, 100], b: [1, 50] }, maxResult: 100 },
  3: { operations: ['+', '-', '*'], operandRange: { a: [1, 100], b: [2, 10] }, maxResult: 200 },
  4: { operations: ['+', '-', '*', '/'], operandRange: { a: [10, 60], b: [2, 12] }, maxResult: 720 },
  5: { operations: ['+', '-', '*', '/'], operandRange: { a: [20, 120], b: [2, 15] }, maxResult: 1800 },
  6: { operations: ['+', '-', '*', '/'], operandRange: { a: [150, 350], b: [2, 20] }, maxResult: 7000 },
};

const BAND_IDS = Object.keys(ACT_BANDS).map(Number);
const SEEDS = 10_000;
const BAND_SWEEP_SEEDS = 200;
const INVERSE_SEEDS = 500;

const EXPECTED_FIRST_STRIKES = {
  ascending: 1,
  descending: 1,
  factorChain: 1,
  composeTarget: 2,
  pairSum: 2,
  oddOneOut: 1,
  equalShare: 1,
};

function firstStrikes(lock) {
  return lock.orbs
    .map((_, orbIndex) => evaluateStrike({
      ruleId: lock.ruleId, orbs: lock.orbs, params: lock.params, order: [], orbIndex,
    }))
    .filter(result => result.accepted).length;
}

function replayAnswer(lock) {
  let order = [];
  let complete = false;
  for (const orbIndex of lock.answer) {
    complete = false;
    const step = evaluateStrike({
      ruleId: lock.ruleId, orbs: lock.orbs, params: lock.params, order, orbIndex,
    });
    assert.equal(step.accepted, true, `${lock.ruleId} answer strikes a refused orb`);
    order = step.order;
    complete = step.complete;
  }
  assert.equal(complete, true, `${lock.ruleId} answer must finish the lock`);
  return order;
}

function assertLock(lock, band, label) {
  const info = ruleInfo(lock.ruleId);
  assert.equal(lock.orbs.length, info.orbCount, `${label}: wrong orb count`);
  assert.equal(new Set(lock.orbs).size, lock.orbs.length, `${label}: duplicate orb values`);
  assert.equal(lock.answer.length, info.take, `${label}: answer has the wrong length`);

  const [low, high] = orbRangeForBand(band);
  for (const orb of lock.orbs) {
    assert.ok(Number.isSafeInteger(orb) && orb >= low && orb <= high,
      `${label}: orb ${orb} outside band ${low}..${high}`);
  }
  for (const index of lock.answer) {
    assert.ok(Number.isInteger(index) && index >= 0 && index < lock.orbs.length,
      `${label}: answer points outside the lock`);
  }

  assert.equal(countSolutions({ ruleId: lock.ruleId, orbs: lock.orbs, params: lock.params }), 1,
    `${label}: lock ${JSON.stringify(lock.orbs)} has more than one right answer`);
  assert.equal(firstStrikes(lock), EXPECTED_FIRST_STRIKES[lock.ruleId],
    `${label}: unexpected number of acceptable first strikes`);
  replayAnswer(lock);
}

const GENERATORS = [
  { name: 'ascending', make: (band, seed) => generateOrderingProblem({ band, seed }) },
  { name: 'descending', make: (band, seed) => generateOrderingProblem({ band, seed, descending: true }) },
  { name: 'pairSum', make: (band, seed) => generatePairSumProblem({ band, seed }) },
  { name: 'factorChain', make: (band, seed) => generateFactorChainProblem({ band, seed, factor: 2 }) },
  { name: 'oddOneOut', make: (band, seed) => generateOddOneOutProblem({ band, seed }) },
  { name: 'equalShare', make: (band, seed) => generateEqualShareProblem({ band, seed }) },
  { name: 'composeTarget', make: (band, seed) => generateComposeProblem({ band, seed }) },
];

describe('orbRangeForBand', () => {
  it('derives each act band from its own operands and answer ceiling', () => {
    assert.deepEqual(BAND_IDS.map(id => orbRangeForBand(ACT_BANDS[id])), [
      [1, 12], [1, 100], [1, 100], [2, 60], [2, 120], [2, 350],
    ]);
  });

  it('refuses a band it cannot read', () => {
    assert.throws(() => orbRangeForBand(undefined), TypeError);
    assert.throws(() => orbRangeForBand({ operandRange: { a: [1] } }), TypeError);
    assert.throws(() => orbRangeForBand({ operandRange: { a: [1.5, 4] } }), TypeError);
  });
});

for (const generator of GENERATORS) {
  describe(`${generator.name} locks`, () => {
    it(`are single-answer, in band and playable across ${SEEDS} seeds`, () => {
      for (let seed = 0; seed < SEEDS; seed++) {
        assertLock(generator.make(ACT_BANDS[1], seed), ACT_BANDS[1], `${generator.name}/${seed}`);
      }
    });

    it('are deterministic for a seed', () => {
      for (const seed of [0, 1, 7, 424242, 4294967295]) {
        assert.deepEqual(
          generator.make(ACT_BANDS[4], seed),
          generator.make(ACT_BANDS[4], seed),
        );
      }
    });

    it(`hold for every act band (${BAND_SWEEP_SEEDS} seeds each)`, () => {
      for (const id of BAND_IDS) {
        for (let seed = 0; seed < BAND_SWEEP_SEEDS; seed++) {
          const lock = generator.make(ACT_BANDS[id], seed);
          assertLock(lock, ACT_BANDS[id], `${generator.name}/act${id}/${seed}`);
        }
      }
    });
  });
}

describe('composeTarget generation', () => {
  it('composes the whole from its parts', () => {
    for (let seed = 0; seed < 500; seed++) {
      const lock = generateComposeProblem({ band: ACT_BANDS[3], seed });
      const [first, second, whole] = lock.answer.map(index => lock.orbs[index]);
      const expected = lock.params.operation === '+' ? first + second : first * second;
      assert.equal(whole, expected);
    }
  });

  it('never composes with a relation that points both ways', () => {
    assert.deepEqual([...COMPOSE_OPERATIONS], ['+', '*']);
    for (let seed = 0; seed < 100; seed++) {
      const lock = generateComposeProblem({ band: ACT_BANDS[2], seed, operation: '-' });
      assert.ok(COMPOSE_OPERATIONS.includes(lock.params.operation));
    }
    const division = generateComposeProblem({ band: ACT_BANDS[2], seed: 3, operation: '/' });
    assert.ok(COMPOSE_OPERATIONS.includes(division.params.operation));
  });
});

describe('impossible bands', () => {
  it('fail loudly instead of handing the Warden an unfair lock', () => {
    const tiny = { operations: ['+'], operandRange: { a: [1, 2], b: [1, 2] }, maxResult: 4 };
    assert.throws(() => generateOrderingProblem({ band: tiny, seed: 1 }), RangeError);
    assert.throws(() => generateFactorChainProblem({ band: tiny, seed: 1, factor: 5 }), RangeError);
    assert.throws(() => generateEqualShareProblem({ band: tiny, seed: 1 }), RangeError);
    assert.throws(() => generatePairSumProblem({ band: ACT_BANDS[1], seed: 1, target: 100 }), RangeError);
    assert.throws(() => generateOddOneOutProblem({ band: tiny, seed: 1 }), RangeError);
  });
});

describe('generateSequenceProblem', () => {
  it('dispatches every rule id and nothing else', () => {
    for (const { name, make } of GENERATORS) {
      const viaDispatcher = generateSequenceProblem({ ruleId: name, band: ACT_BANDS[3], seed: 11 });
      assert.equal(viaDispatcher.ruleId, name);
      assert.deepEqual(viaDispatcher, make(ACT_BANDS[3], 11));
    }
    assert.throws(() => generateSequenceProblem({ ruleId: 'sigil', band: ACT_BANDS[1], seed: 1 }), TypeError);
  });
});

describe('inverse problems', () => {
  const PATTERNS = {
    '+': /^(\d+) \+ \? = (\d+)$/,
    '-': /^(\d+) − \? = (\d+)$/,
    '*': /^\? × (\d+) = (\d+)$/,
    '/': /^(\d+) ÷ \? = (\d+)$/,
  };

  function assertInverse(problem, band, label) {
    const pattern = PATTERNS[problem.operation];
    const match = pattern.exec(problem.question);
    assert.ok(match, `${label}: "${problem.question}" does not match the ${problem.operation} form`);
    const shown = Number(match[1]);
    const result = Number(match[2]);
    const { answer } = problem;
    const holds = {
      '+': () => shown + answer === result,
      '-': () => shown - answer === result,
      '*': () => answer * shown === result,
      '/': () => shown / answer === result,
    }[problem.operation]();
    assert.ok(holds, `${label}: "${problem.question}" is not solved by ${answer}`);

    assert.equal(problem.options.length, 4, `${label}: needs four choices`);
    assert.equal(new Set(problem.options).size, 4, `${label}: choices must be distinct`);
    assert.equal(problem.options.filter(value => value === answer).length, 1,
      `${label}: the answer must appear exactly once`);
    for (const value of problem.options) {
      assert.ok(Number.isSafeInteger(value) && value >= 0, `${label}: choice ${value} is not a plain number`);
    }
    assert.deepEqual(problem.values, {
      '+': { a: shown, b: answer, result },
      '-': { a: shown, b: answer, result },
      '*': { a: answer, b: shown, result },
      '/': { a: shown, b: answer, result },
    }[problem.operation], `${label}: hidden slot is reported wrong`);
    assert.equal(problem.hidden, problem.operation === '*' ? 'a' : 'b');

    const [low, high] = orbRangeForBand(band);
    assert.ok(answer >= low && answer <= high, `${label}: answer ${answer} outside band ${low}..${high}`);
  }

  for (const operation of ['+', '-', '*', '/']) {
    it(`holds for ${operation} across every band (${INVERSE_SEEDS} seeds each)`, () => {
      for (const id of BAND_IDS) {
        if (!ACT_BANDS[id].operations.includes(operation)) continue;
        for (let seed = 0; seed < INVERSE_SEEDS; seed++) {
          const problem = generateInverseProblem({ band: ACT_BANDS[id], seed, operation });
          assert.equal(problem.operation, operation);
          assertInverse(problem, ACT_BANDS[id], `act${id}/${operation}/${seed}`);
        }
      }
    });
  }

  it('falls back to an operation the band actually teaches', () => {
    for (let seed = 0; seed < 100; seed++) {
      const problem = generateInverseProblem({ band: ACT_BANDS[1], seed, operation: '/' });
      assert.ok(ACT_BANDS[1].operations.includes(problem.operation));
    }
  });

  it('is deterministic for a seed', () => {
    for (const seed of [0, 5, 99, 4294967295]) {
      assert.deepEqual(
        generateInverseProblem({ band: ACT_BANDS[6], seed, operation: '*' }),
        generateInverseProblem({ band: ACT_BANDS[6], seed, operation: '*' }),
      );
    }
  });
});
