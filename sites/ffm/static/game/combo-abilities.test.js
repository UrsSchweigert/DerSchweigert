import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { COMBO_ABILITY_RULES, pickComboAbility } from './combo-abilities.js';

describe('pickComboAbility', () => {
  it('returns null for combos 0, 1, 3, 5 with rollFn () => 0', () => {
    const always0 = () => 0;
    assert.strictEqual(pickComboAbility(0, always0), null);
    assert.strictEqual(pickComboAbility(1, always0), null);
    assert.strictEqual(pickComboAbility(3, always0), null);
    assert.strictEqual(pickComboAbility(5, always0), null);
  });

  it('fireball: combo 6, 8, 10 with roll 0.49 returns fireball; 0.5+ returns null', () => {
    const roll049 = () => 0.49;
    const roll05 = () => 0.5;
    const roll0999 = () => 0.999;
    
    for (const combo of [6, 8, 10]) {
      assert.strictEqual(pickComboAbility(combo, roll049), 'fireball');
      assert.strictEqual(pickComboAbility(combo, roll05), null);
      assert.strictEqual(pickComboAbility(combo, roll0999), null);
    }
  });

  it('lightning: combo 11, 15, 20 with roll 0.69 returns lightning; 0.7+ returns null', () => {
    const roll069 = () => 0.69;
    const roll07 = () => 0.7;
    
    for (const combo of [11, 15, 20]) {
      assert.strictEqual(pickComboAbility(combo, roll069), 'lightning');
      assert.strictEqual(pickComboAbility(combo, roll07), null);
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
