// Pure, unit-testable logic for combo-triggered special abilities.
// No Math.random() here - randomness is injected via rollFn so tests are deterministic.

export const COMBO_ABILITY_RULES = [
  // Evaluated in this order (highest threshold first). The first band the combo
  // satisfies gets exactly one independent roll; if that roll fails, no ability
  // fires (it does not fall through to a lower band).
  { ability: 'dragon', minCombo: 20, chance: 0.8 },
  { ability: 'lightning', minCombo: 10, chance: 1.0 },
  { ability: 'fireball', minCombo: 5, chance: 1.0 },
];

/**
 * Decide which special ability (if any) fires for the current combo count.
 * @param {number} combo - the combo counter AFTER the current hit is counted.
 * @param {() => number} rollFn - returns a float in [0, 1); defaults to Math.random.
 * @returns {'dragon' | 'lightning' | 'fireball' | null}
 */
export function pickComboAbility(combo, rollFn = Math.random) {
  for (const rule of COMBO_ABILITY_RULES) {
    if (combo > rule.minCombo) {
      const roll = rollFn();
      return roll < rule.chance ? rule.ability : null;
    }
  }
  return null;
}

/**
 * Identify which ability "band" the current combo count falls in, purely from
 * its minCombo threshold - no roll involved. Used to drive persistent visual
 * feedback (e.g. a pulsating screen frame) that should reflect how close the
 * player is to triggering an ability, independent of whether the ability's
 * chance roll actually succeeds on any given hit.
 * @param {number} combo - the current combo counter.
 * @returns {'dragon' | 'lightning' | 'fireball' | null}
 */
export function getComboFrameBand(combo) {
  for (const rule of COMBO_ABILITY_RULES) {
    if (combo > rule.minCombo) return rule.ability;
  }
  return null;
}

export function getComboRewardProgress(combo) {
  if (!Number.isSafeInteger(combo) || combo < 0) {
    throw new TypeError('Combo must be a non-negative safe integer');
  }
  const upcoming = [...COMBO_ABILITY_RULES].reverse().find(rule => combo <= rule.minCombo);
  const active = COMBO_ABILITY_RULES.find(rule => combo > rule.minCombo);
  const rule = upcoming ?? active;
  return {
    ability: rule.ability,
    remaining: upcoming ? rule.minCombo + 1 - combo : 0,
    chance: rule.chance,
  };
}
