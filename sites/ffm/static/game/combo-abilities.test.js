import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { COMBO_ABILITY_RULES, pickComboAbility, getComboFrameBand, getComboRewardProgress } from './combo-abilities.js';

it('reward hints use the real strict thresholds and never promise a guaranteed dragon', () => {
  for (const [combo, ability, remaining, chance] of [
    [0, 'fireball', 6, 1], [5, 'fireball', 1, 1], [6, 'lightning', 5, 1],
    [10, 'lightning', 1, 1], [11, 'dragon', 10, 0.8], [20, 'dragon', 1, 0.8],
    [21, 'dragon', 0, 0.8],
  ]) assert.deepEqual(getComboRewardProgress(combo), { ability, remaining, chance });
  for (const value of [-1, 1.5, NaN]) assert.throws(() => getComboRewardProgress(value), TypeError);
});

describe('pickComboAbility', () => {
  it('returns null for combos 0, 1, 3, 5 with rollFn () => 0', () => {
    const always0 = () => 0;
    assert.strictEqual(pickComboAbility(0, always0), null);
    assert.strictEqual(pickComboAbility(1, always0), null);
    assert.strictEqual(pickComboAbility(3, always0), null);
    assert.strictEqual(pickComboAbility(5, always0), null);
  });

  it('fireball: combo 6, 8, 10 always fires regardless of roll (100% chance)', () => {
    const roll0 = () => 0;
    const roll0999 = () => 0.999;

    for (const combo of [6, 8, 10]) {
      assert.strictEqual(pickComboAbility(combo, roll0), 'fireball');
      assert.strictEqual(pickComboAbility(combo, roll0999), 'fireball');
    }
  });

  it('lightning: combo 11, 15, 20 always fires regardless of roll (100% chance)', () => {
    const roll0 = () => 0;
    const roll0999 = () => 0.999;

    for (const combo of [11, 15, 20]) {
      assert.strictEqual(pickComboAbility(combo, roll0), 'lightning');
      assert.strictEqual(pickComboAbility(combo, roll0999), 'lightning');
    }
  });

  it('dragon: combo 21, 30, 100 with roll 0.79 returns dragon; 0.8+ returns null', () => {
    const roll079 = () => 0.79;
    const roll08 = () => 0.8;
    
    for (const combo of [21, 30, 100]) {
      assert.strictEqual(pickComboAbility(combo, roll079), 'dragon');
      assert.strictEqual(pickComboAbility(combo, roll08), null);
    }
  });

  it('boundary conditions', () => {
    assert.strictEqual(pickComboAbility(5, () => 0), null);
    assert.strictEqual(pickComboAbility(10, () => 0), 'fireball');
    assert.strictEqual(pickComboAbility(20, () => 0), 'lightning');
  });

  it('combo 25 with failing roll (0.9) returns null AND calls rollFn exactly once', () => {
    let callCount = 0;
    const roll09 = () => {
      callCount++;
      return 0.9;
    };
    
    const result = pickComboAbility(25, roll09);
    assert.strictEqual(result, null);
    assert.strictEqual(callCount, 1, 'rollFn should be called exactly once');
  });

  it('COMBO_ABILITY_RULES maps to [dragon, lightning, fireball] in order with correct minCombo', () => {
    assert.strictEqual(COMBO_ABILITY_RULES.length, 3);
    assert.strictEqual(COMBO_ABILITY_RULES[0].ability, 'dragon');
    assert.strictEqual(COMBO_ABILITY_RULES[0].minCombo, 20);
    assert.strictEqual(COMBO_ABILITY_RULES[1].ability, 'lightning');
    assert.strictEqual(COMBO_ABILITY_RULES[1].minCombo, 10);
    assert.strictEqual(COMBO_ABILITY_RULES[2].ability, 'fireball');
    assert.strictEqual(COMBO_ABILITY_RULES[2].minCombo, 5);
  });
});

describe('getComboFrameBand', () => {
  it('returns null for combos 0 through 5 (no ability band yet)', () => {
    for (const combo of [0, 1, 3, 5]) {
      assert.strictEqual(getComboFrameBand(combo), null);
    }
  });

  it('returns fireball for combos 6 through 10', () => {
    for (const combo of [6, 8, 10]) {
      assert.strictEqual(getComboFrameBand(combo), 'fireball');
    }
  });

  it('returns lightning for combos 11 through 20', () => {
    for (const combo of [11, 15, 20]) {
      assert.strictEqual(getComboFrameBand(combo), 'lightning');
    }
  });

  it('returns dragon for combos above 20, regardless of ability roll outcome', () => {
    for (const combo of [21, 30, 100]) {
      assert.strictEqual(getComboFrameBand(combo), 'dragon');
    }
  });
});
