import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { BOSSES, getBoss } from './boss-data.js';
import { HIDDEN_RULE_SECONDS, planFight, planPhase, problemFor } from './boss-plan.js';
import { countSolutions } from './boss-rules.js';

// Real level configs from app/level_data.json, one per act end, because a
// direct boss problem goes through the campaign generator.
const ACT_BANDS = {
  1: { level: 10, operations: ['+', '-'], operandRange: { a: [2, 12], b: [1, 7] }, maxResult: 19 },
  2: { level: 20, operations: ['+', '-'], operandRange: { a: [10, 100], b: [1, 50] }, maxResult: 100 },
  3: { level: 30, operations: ['+', '-', '*'], operandRange: { a: [1, 100], b: [2, 10] }, maxResult: 200 },
  4: { level: 40, operations: ['+', '-', '*', '/'], operandRange: { a: [10, 60], b: [2, 12] }, maxResult: 720 },
  5: { level: 50, operations: ['+', '-', '*', '/'], operandRange: { a: [20, 120], b: [2, 15] }, maxResult: 1800 },
  6: { level: 60, operations: ['+', '-', '*', '/'], operandRange: { a: [150, 350], b: [2, 20] }, maxResult: 7000 },
};

function bandFor(boss) {
  return ACT_BANDS[boss.act];
}

describe('planPhase', () => {
  it('is deterministic and differs between seeds', () => {
    const first = planPhase({ bossId: 'warden-dawn', phaseIndex: 2, band: ACT_BANDS[1], seed: 42 });
    const again = planPhase({ bossId: 'warden-dawn', phaseIndex: 2, band: ACT_BANDS[1], seed: 42 });
    assert.deepEqual(first, again);
    const other = planPhase({ bossId: 'warden-dawn', phaseIndex: 2, band: ACT_BANDS[1], seed: 43 });
    assert.notDeepEqual(first, other);
  });

  it('matches the phase it comes from', () => {
    for (const boss of BOSSES) {
      const band = bandFor(boss);
      boss.phases.forEach((phase, phaseIndex) => {
        const entries = planPhase({ bossId: boss.id, phaseIndex, band, seed: 9 });
        assert.equal(entries.length, phase.seals, `${boss.id}/${phase.id} plans the wrong number of seals`);
        entries.forEach((entry, index) => {
          assert.equal(entry.index, index);
          assert.equal(entry.kind, phase.kind === 'sequence' ? 'sequence' : phase.kind === 'inverse' ? 'inverse' : 'direct');
          if (entry.kind === 'sequence') {
            assert.ok(phase.rules.includes(entry.ruleId), `${entry.ruleId} is not a rule of ${phase.id}`);
          } else {
            assert.ok(band.operations.includes(entry.operation));
          }
          assert.ok(Number.isSafeInteger(entry.seed) && entry.seed >= 0);
        });
      });
    }
  });

  it('shows every rule a phase owns before repeating one', () => {
    const entries = planPhase({ bossId: 'warden-throne', phaseIndex: 1, band: ACT_BANDS[6], seed: 3 });
    const rules = getBoss('warden-throne').phases[1].rules;
    assert.equal(entries.length, 3);
    assert.equal(new Set(entries.map(entry => entry.ruleId)).size, 3);
    for (const entry of entries) assert.ok(rules.includes(entry.ruleId));
  });

  it('refuses a phase or band it cannot plan', () => {
    assert.throws(() => planPhase({ bossId: 'warden-dawn', phaseIndex: 9, band: ACT_BANDS[1], seed: 1 }), RangeError);
    assert.throws(() => planPhase({ bossId: 'warden-dawn', phaseIndex: 0, band: { operations: [] }, seed: 1 }), TypeError);
  });
});

describe('problemFor', () => {
  it('builds a playable problem for every planned seal', () => {
    for (const boss of BOSSES) {
      const band = bandFor(boss);
      const fight = planFight({ bossId: boss.id, band, seed: 5 });
      for (const { phase, entries } of fight) {
        for (const entry of entries) {
          const built = problemFor({ band, plan: entry });
          if (built.kind === 'sequence') {
            assert.equal(built.lock.ruleId, entry.ruleId);
            assert.equal(
              countSolutions({ ruleId: built.lock.ruleId, orbs: built.lock.orbs, params: built.lock.params }),
              1,
              `${boss.id}/${phase.id}: lock is not single-answer`,
            );
            assert.ok(built.lock.answer.length >= 1);
          } else if (built.kind === 'inverse') {
            assert.equal(built.problem.operation, entry.operation);
            assert.equal(built.problem.options.length, 4);
            assert.ok(built.problem.options.includes(built.problem.answer));
          } else {
            assert.equal(built.problem.operation, entry.operation);
            assert.ok(built.problem.options.includes(built.problem.answer));
          }
        }
      }
    }
  });

  it('needs a real level config for a direct problem', () => {
    const plan = planPhase({ bossId: 'warden-dawn', phaseIndex: 0, band: ACT_BANDS[1], seed: 1 })[0];
    assert.throws(() => problemFor({ band: { operations: ['+'] }, plan }), TypeError);
  });
});

describe('planFight', () => {
  it('covers every phase of a fight, in order', () => {
    const boss = getBoss('hollow-king');
    const fight = planFight({ bossId: boss.id, band: ACT_BANDS[6], seed: 7 });
    assert.equal(fight.length, boss.phases.length);
    fight.forEach((entry, index) => {
      assert.equal(entry.phaseIndex, index);
      assert.equal(entry.phase.id, boss.phases[index].id);
      assert.equal(entry.entries.length, boss.phases[index].seals);
    });
  });

  it('keeps the hidden-rule phases short enough to be fair', () => {
    assert.ok(HIDDEN_RULE_SECONDS >= 3 && HIDDEN_RULE_SECONDS <= 6);
    const hidden = BOSSES.flatMap(boss => boss.phases).filter(phase => phase.hideRule);
    assert.ok(hidden.length >= 1, 'at least the final act withholds a rule');
  });
});
