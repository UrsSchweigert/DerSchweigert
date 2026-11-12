import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  RULE_IDS,
  SEQUENCE_RULES,
  canonicalKey,
  completions,
  countSolutions,
  evaluateStrike,
  hintFor,
  ruleInfo,
  solutionFor,
} from './boss-rules.js';

describe('seal rule metadata', () => {
  it('declares seven rules, each needing the parameters it consumes', () => {
    assert.deepEqual(RULE_IDS, [
      'ascending', 'descending', 'factorChain', 'composeTarget',
      'pairSum', 'oddOneOut', 'equalShare',
    ]);
    assert.deepEqual(SEQUENCE_RULES.ascending.params, []);
    assert.deepEqual(SEQUENCE_RULES.composeTarget.params, ['operation']);
    assert.deepEqual(SEQUENCE_RULES.pairSum.params, ['target']);
    assert.deepEqual(SEQUENCE_RULES.factorChain.params, ['factor']);
    assert.deepEqual(SEQUENCE_RULES.oddOneOut.params, ['factor']);
    assert.deepEqual(SEQUENCE_RULES.equalShare.params, ['pile']);
    for (const id of RULE_IDS) {
      const { orbCount, take } = ruleInfo(id);
      assert.ok(take >= 1 && take <= orbCount, `${id} must strike between one and all orbs`);
    }
  });

  it('rejects an unknown rule instead of guessing', () => {
    assert.throws(() => ruleInfo('sigil'), TypeError);
  });
});

describe('completions', () => {
  it('finds one ascending order and one descending order', () => {
    assert.deepEqual(completions({ ruleId: 'ascending', orbs: [3, 1, 2], params: {} }), [[1, 2, 0]]);
    assert.deepEqual(completions({ ruleId: 'descending', orbs: [3, 1, 2], params: {} }), [[0, 2, 1]]);
  });

  it('rejects malformed locks rather than scoring them', () => {
    assert.throws(() => completions({ ruleId: 'ascending', orbs: [3, 1], params: {} }), TypeError);
    assert.throws(() => completions({ ruleId: 'ascending', orbs: [3, 3, 2], params: {} }), TypeError);
    assert.throws(() => completions({ ruleId: 'ascending', orbs: [3, -1, 2], params: {} }), TypeError);
    assert.throws(() => completions({ ruleId: 'oddOneOut', orbs: [6, 9, 7], params: { factor: 3 } }), TypeError);
  });

  it('requires the parameters a rule consumes', () => {
    assert.throws(() => completions({ ruleId: 'pairSum', orbs: [3, 7, 4], params: {} }), TypeError);
    assert.throws(() => completions({ ruleId: 'factorChain', orbs: [2, 4, 8], params: { factor: 1 } }), TypeError);
    assert.throws(() => completions({ ruleId: 'factorChain', orbs: [2, 4, 8], params: { factor: 2.5 } }), TypeError);
    assert.throws(() => completions({ ruleId: 'composeTarget', orbs: [2, 3, 5], params: { operation: '%' } }), TypeError);
    assert.throws(() => completions({ ruleId: 'equalShare', orbs: [3, 5, 7], params: { pile: -12 } }), TypeError);
  });
});

describe('countSolutions', () => {
  it('counts one answer for each well-formed lock', () => {
    assert.equal(countSolutions({ ruleId: 'ascending', orbs: [3, 1, 2], params: {} }), 1);
    assert.equal(countSolutions({ ruleId: 'factorChain', orbs: [2, 4, 8], params: { factor: 2 } }), 1);
    assert.equal(countSolutions({ ruleId: 'composeTarget', orbs: [2, 3, 5], params: { operation: '+' } }), 1);
    assert.equal(countSolutions({ ruleId: 'composeTarget', orbs: [2, 4, 8], params: { operation: '*' } }), 1);
    assert.equal(countSolutions({ ruleId: 'pairSum', orbs: [3, 7, 4], params: { target: 10 } }), 1);
    assert.equal(countSolutions({ ruleId: 'oddOneOut', orbs: [6, 9, 12, 7], params: { factor: 3 } }), 1);
    assert.equal(countSolutions({ ruleId: 'equalShare', orbs: [3, 5, 7], params: { pile: 12 } }), 1);
  });

  it('treats interchangeable positions as one answer', () => {
    // 2 + 3 = 5 and 3 + 2 = 5 are the same lock, not a second answer.
    const swapped = completions({ ruleId: 'composeTarget', orbs: [2, 3, 5], params: { operation: '+' } });
    assert.equal(swapped.length, 2, 'both part orders are legal strikes');
    assert.equal(countSolutions({ ruleId: 'composeTarget', orbs: [2, 3, 5], params: { operation: '+' } }), 1);
  });

  it('exposes why subtraction can never be a compose rule', () => {
    // 7 - 3 = 4 and 7 - 4 = 3 are genuinely different answers on one lock,
    // which is exactly why generators only compose with + and x.
    assert.equal(countSolutions({ ruleId: 'composeTarget', orbs: [7, 3, 4], params: { operation: '-' } }), 2);
  });

  it('counts zero when the lock cannot be solved', () => {
    // 3+7=10, 3+4=7 and 7+4=11 are the only pairs, so 13 has no answer.
    assert.equal(countSolutions({ ruleId: 'pairSum', orbs: [3, 7, 4], params: { target: 13 } }), 0);
    assert.equal(countSolutions({ ruleId: 'factorChain', orbs: [2, 4, 8], params: { factor: 3 } }), 0);
    assert.equal(solutionFor({ ruleId: 'factorChain', orbs: [2, 4, 8], params: { factor: 3 } }), null);
  });
});

describe('solutionFor', () => {
  it('returns the canonical answer in orb indices', () => {
    assert.deepEqual(solutionFor({ ruleId: 'ascending', orbs: [3, 1, 2], params: {} }), [1, 2, 0]);
    assert.deepEqual(solutionFor({ ruleId: 'descending', orbs: [3, 1, 2], params: {} }), [0, 2, 1]);
    assert.deepEqual(solutionFor({ ruleId: 'pairSum', orbs: [3, 7, 4], params: { target: 10 } }), [0, 1]);
    assert.deepEqual(solutionFor({ ruleId: 'oddOneOut', orbs: [6, 9, 12, 7], params: { factor: 3 } }), [3]);
    assert.deepEqual(solutionFor({ ruleId: 'equalShare', orbs: [3, 5, 7], params: { pile: 12 } }), [0]);
  });

  it('never treats a share of one as the even split', () => {
    assert.equal(solutionFor({ ruleId: 'equalShare', orbs: [1, 5, 7], params: { pile: 12 } }), null);
  });
});

describe('canonicalKey', () => {
  it('sorts only the interchangeable prefix', () => {
    assert.equal(canonicalKey([2, 0, 1], 2), '0,2,1');
    assert.equal(canonicalKey([2, 0, 1], 0), '2,0,1');
    assert.equal(canonicalKey([2, 0, 1], 9), '0,1,2');
  });
});

describe('evaluateStrike', () => {
  const ascending = { ruleId: 'ascending', orbs: [3, 1, 2], params: {} };

  it('refuses a first strike that cannot start any answer', () => {
    const result = evaluateStrike({ ...ascending, order: [], orbIndex: 0 });
    assert.deepEqual(result, {
      accepted: false,
      complete: false,
      order: [],
      hint: { key: 'boss.hint.reset' },
    });
  });

  it('resets a part-built sequence on a strike that breaks it', () => {
    const first = evaluateStrike({ ...ascending, order: [], orbIndex: 1 });
    assert.deepEqual(first, { accepted: true, complete: false, order: [1], hint: null });
    const wrong = evaluateStrike({ ...ascending, order: first.order, orbIndex: 0 });
    assert.equal(wrong.accepted, false);
    assert.deepEqual(wrong.order, [], 'a wrong strike clears the sequence');
  });

  it('completes only on the last needed orb', () => {
    let order = [];
    for (const orbIndex of [1, 2]) {
      const step = evaluateStrike({ ...ascending, order, orbIndex });
      assert.equal(step.accepted, true);
      assert.equal(step.complete, false);
      order = step.order;
    }
    const last = evaluateStrike({ ...ascending, order, orbIndex: 0 });
    assert.deepEqual(last, { accepted: true, complete: true, order: [1, 2, 0], hint: null });
  });

  it('ignores a repeat strike without losing progress', () => {
    const repeat = evaluateStrike({ ...ascending, order: [1], orbIndex: 1 });
    assert.deepEqual(repeat, {
      accepted: false,
      complete: false,
      order: [1],
      hint: { key: 'boss.hint.repeat' },
    });
  });

  it('lets either part come first when the rule is symmetric', () => {
    const compose = { ruleId: 'composeTarget', orbs: [2, 3, 5], params: { operation: '+' } };
    assert.equal(evaluateStrike({ ...compose, order: [], orbIndex: 2 }).accepted, false,
      'the whole cannot be struck before its parts');
    let order = evaluateStrike({ ...compose, order: [], orbIndex: 1 }).order;
    order = evaluateStrike({ ...compose, order, orbIndex: 0 }).order;
    assert.deepEqual(order, [1, 0]);
    assert.equal(evaluateStrike({ ...compose, order, orbIndex: 2 }).complete, true);
  });

  it('rejects an orb that cannot take part in a pair', () => {
    const pair = { ruleId: 'pairSum', orbs: [3, 7, 4], params: { target: 10 } };
    assert.equal(evaluateStrike({ ...pair, order: [], orbIndex: 2 }).accepted, false);
    const first = evaluateStrike({ ...pair, order: [], orbIndex: 0 });
    assert.equal(first.accepted, true);
    assert.equal(evaluateStrike({ ...pair, order: first.order, orbIndex: 2 }).accepted, false);
    assert.equal(evaluateStrike({ ...pair, order: first.order, orbIndex: 1 }).complete, true);
  });

  it('rejects an out-of-range strike and an already-finished lock', () => {
    assert.throws(() => evaluateStrike({ ...ascending, order: [], orbIndex: 3 }), TypeError);
    assert.throws(() => evaluateStrike({ ...ascending, order: [], orbIndex: 1.5 }), TypeError);
    assert.throws(
      () => evaluateStrike({ ruleId: 'pairSum', orbs: [3, 7, 4], params: { target: 10 }, order: [0, 1], orbIndex: 2 }),
      Error,
    );
  });

  it('rejects a malformed order instead of trusting it', () => {
    assert.throws(() => evaluateStrike({ ...ascending, order: [7], orbIndex: 0 }), TypeError);
    assert.throws(() => evaluateStrike({ ...ascending, order: '1', orbIndex: 0 }), TypeError);
  });
});

describe('hintFor', () => {
  const lock = { ruleId: 'ascending', orbs: [3, 1, 2], params: {} };

  it('stays silent until the player has missed', () => {
    assert.equal(hintFor({ ...lock, order: [], missed: 0 }), null);
  });

  it('restates the rule on the first miss, then reveals the next orb', () => {
    assert.deepEqual(hintFor({ ...lock, order: [], missed: 1 }), { key: 'boss.hint.restate', ruleId: 'ascending' });
    assert.deepEqual(hintFor({ ...lock, order: [], missed: 2 }), { key: 'boss.hint.reveal', orbIndex: 1 });
    assert.deepEqual(hintFor({ ...lock, order: [1], missed: 3 }), { key: 'boss.hint.reveal', orbIndex: 2 });
  });

  it('falls back to restating the rule when nothing is left to reveal', () => {
    assert.deepEqual(hintFor({ ...lock, order: [1, 2, 0], missed: 2 }), { key: 'boss.hint.restate', ruleId: 'ascending' });
  });
});
