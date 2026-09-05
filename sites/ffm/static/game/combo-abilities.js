// Pure, unit-testable logic for combo-triggered special abilities.
// No Math.random() here - randomness is injected via rollFn so tests are deterministic.

export const COMBO_ABILITY_RULES = [
  // Evaluated in this order (highest threshold first). The first band the combo
  // satisfies gets exactly one independent roll; if that roll fails, no ability
  // fires (it does not fall through to a lower band).
  { ability: 'dragon', minCombo: 20, chance: 0.8 },
  { ability: 'lightning', minCombo: 10, chance: 0.7 },
  { ability: 'fireball', minCombo: 5, chance: 0.5 },
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
