import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { buildWardenRows, ruleText } from './boss-run.js';
import { generateSequenceProblem } from './boss-problems.js';

const BAND = { level: 10, operations: ['+', '-'], operandRange: { a: [2, 12], b: [1, 7] }, maxResult: 19 };

describe('buildWardenRows', () => {
  it('lists every Warden, locked until its act is cleared', () => {
    const rows = buildWardenRows({ clearedLevels: [], results: {} });
    assert.equal(rows.length, 7, 'six Wardens plus the Hollow King');
    assert.deepEqual(rows.map(row => row.unlocked), [false, false, false, false, false, false, false]);
    assert.deepEqual(rows.map(row => row.act), [1, 2, 3, 4, 5, 6, 6]);
  });

  it('opens act I once its ten levels are cleared, and later acts after their gatekeeper', () => {
    const quarter = buildWardenRows({
      clearedLevels: Array.from({ length: 10 }, (_, index) => index + 1),
      results: {},
    });
    assert.equal(quarter[0].unlocked, true);
    assert.equal(quarter[1].unlocked, false, 'act II still waits for the dawn Warden');

    const afterDawn = buildWardenRows({
      clearedLevels: Array.from({ length: 20 }, (_, index) => index + 1),
      results: { 'warden-dawn': { cleared: true, crowns: 3 } },
    });
    assert.equal(afterDawn[1].unlocked, true);
    assert.equal(afterDawn[0].cleared, true);
    assert.equal(afterDawn[0].crowns, 3);
    assert.equal(afterDawn[2].unlocked, false);
  });

  it('keeps a defeated Warden playable and the Hollow King last', () => {
    const allWardens = ['warden-dawn', 'warden-harvest', 'warden-memory', 'warden-keep', 'warden-market', 'warden-throne'];
    const results = Object.fromEntries(allWardens.map(id => [id, { cleared: true, crowns: 2 }]));
    const rows = buildWardenRows({
      clearedLevels: Array.from({ length: 60 }, (_, index) => index + 1),
      results,
    });
    assert.deepEqual(rows.map(row => row.unlocked), [true, true, true, true, true, true, true]);
    assert.equal(rows.at(-1).bossId, 'hollow-king');
    assert.equal(rows.filter(row => row.cleared).length, 6, 'the Hollow King is not won yet');
  });
});

describe('ruleText', () => {
  it('names every rule in words, with its own numbers', () => {
    for (const ruleId of ['ascending', 'descending', 'pairSum', 'factorChain', 'oddOneOut', 'equalShare', 'composeTarget']) {
      const lock = generateSequenceProblem({
        ruleId,
        band: ruleId === 'factorChain' ? { ...BAND, operandRange: { a: [1, 12], b: [1, 7] } } : BAND,
        seed: 3,
      });
      const text = ruleText(lock);
      assert.ok(text.length > 10, `${ruleId} has no rule text`);
      assert.ok(!text.includes('boss.rule.'), `${ruleId} is missing its translation`);
    }
  });

  it('fills the target, factor and pile into the sentence', () => {
    const pair = generateSequenceProblem({ ruleId: 'pairSum', band: BAND, seed: 1 });
    assert.ok(ruleText(pair).includes(String(pair.params.target)));
    const chain = generateSequenceProblem({ ruleId: 'factorChain', band: BAND, seed: 1 });
    assert.ok(ruleText(chain).includes(String(chain.params.factor)));
    const share = generateSequenceProblem({ ruleId: 'equalShare', band: BAND, seed: 1 });
    assert.ok(ruleText(share).includes(String(share.params.pile)));
  });
});
