// Pure bonus ladder for the ability progression.
//
// Every player level from 2 to 60 grants exactly one bonus. The ladder cycles
// through four types in a fixed order and applies each bonus through the
// documented values and caps below. The module never reads a clock, never
// rolls dice and never touches the page: bonusForLevel(level) is a pure
// function of the level and applyBonus() returns a new frozen runtime, so the
// HUD and gameplay can replay the same ladder deterministically.

import {
  ABILITY_ROSTER,
  FIEND_SPEED_FLOOR,
  FIEND_SPEED_STEP,
  SPIKE_SLOW_CAPS,
} from './cooldown-abilities.js';

/**
 * Bonus types in ladder order. Level `n` starts at index `(n - 2) % 4`.
 * @type {ReadonlyArray<'cooldown' | 'storm' | 'slowSpeed' | 'slowTargets'>}
 */
export const BONUS_TYPES = Object.freeze(['cooldown', 'storm', 'slowSpeed', 'slowTargets']);

/**
 * Bonus granted per type: 6 s cooldown reduction, one storm rank, 0.05 passive
 * speed reduction and one earth-spike target.
 */
export const BONUS_VALUES = Object.freeze({
  cooldownSeconds: 6,
  stormRank: 1,
  speedStep: FIEND_SPEED_STEP,
  spikeTargets: 1,
});

/**
 * Documented caps: the cooldown reduction never exceeds 90 s, storm rank and
 * earth-spike targets never exceed 5. The passive speed floor lives in
 * cooldown-abilities.js (FIEND_SPEED_FLOOR) and is expressed here as
 * MAX_SLOW_BONUSES.
 */
export const BONUS_CAPS = Object.freeze({
  cooldownSeconds: 90,
  stormRank: 5,
  spikeTargets: SPIKE_SLOW_CAPS.targets,
});

/** Highest level that grants a bonus. */
export const MAX_BONUS_LEVEL = 60;

/**
 * Ability each bonus type strengthens. `cooldown` has no fixed owner: it is
 * spread round-robin over the abilities unlocked at that level. `storm` owns
 * storm, while both earth bonuses own earth.
 * @type {Readonly<Record<'cooldown' | 'storm' | 'slowSpeed' | 'slowTargets', 'wind' | 'storm' | 'earth' | null>>}
 */
export const BONUS_TYPE_OWNERS = Object.freeze({
  cooldown: null,
  storm: 'storm',
  slowSpeed: 'earth',
  slowTargets: 'earth',
});

/**
 * Slow bonuses a runtime can collect before the passive speed floor stops
 * helping: (1 - 0.7) / 0.05 = 6.
 */
export const MAX_SLOW_BONUSES = Math.round((1 - FIEND_SPEED_FLOOR) / FIEND_SPEED_STEP);

const BONUS_VALUE_FOR_TYPE = Object.freeze({
  cooldown: BONUS_VALUES.cooldownSeconds,
  storm: BONUS_VALUES.stormRank,
  slowSpeed: BONUS_VALUES.speedStep,
  slowTargets: BONUS_VALUES.spikeTargets,
});

function isAbilityUnlocked(id, level) {
  const ability = ABILITY_ROSTER.find((entry) => entry.id === id);
  return Boolean(ability) && level >= ability.unlockLevel;
}

function unlockedAbilityIds(level) {
  return ABILITY_ROSTER.filter((ability) => level >= ability.unlockLevel).map(
    (ability) => ability.id,
  );
}

function requireLevel(level) {
  if (!Number.isSafeInteger(level)) throw new TypeError('level must be a safe integer');
  return level;
}

// Walk the four types cyclically from `startIndex` and stop at the first one
// whose owner is unlocked. `cooldown` has no owner, so a type is always found.
function resolveTypeIndex(level, startIndex) {
  for (let offset = 0; offset < BONUS_TYPES.length; offset += 1) {
    const index = (startIndex + offset) % BONUS_TYPES.length;
    const owner = BONUS_TYPE_OWNERS[BONUS_TYPES[index]];
    if (owner === null || isAbilityUnlocked(owner, level)) return index;
  }
  throw new Error('bonus ladder has no applicable type');
}

/**
 * Bonus granted by one player level.
 *
 * Levels below 2 or above 60 grant nothing and return null; a non-integer
 * level throws. Levels 2-60 return exactly one frozen
 * `{ level, type, abilityId, value }`. The type is the first applicable type
 * in the cycle starting at `(level - 2) % 4`, so a bonus never strengthens a
 * locked ability. Cooldown bonuses rotate round-robin over the abilities
 * unlocked at that level, in roster order.
 * @param {number} level - player level, 1-based.
 * @returns {{ level: number, type: string, abilityId: string, value: number } | null}
 */
export function bonusForLevel(level) {
  requireLevel(level);
  if (level < 2 || level > MAX_BONUS_LEVEL) return null;

  let cooldownBonuses = 0;
  let typeIndex = 0;
  for (let current = 2; current <= level; current += 1) {
    typeIndex = resolveTypeIndex(current, (current - 2) % BONUS_TYPES.length);
    if (current === level) break;
    if (BONUS_TYPES[typeIndex] === 'cooldown') cooldownBonuses += 1;
  }

  const type = BONUS_TYPES[typeIndex];
  let abilityId = BONUS_TYPE_OWNERS[type];
  if (abilityId === null) {
    const unlocked = unlockedAbilityIds(level);
    abilityId = unlocked[cooldownBonuses % unlocked.length];
  }

  return Object.freeze({ level, type, abilityId, value: BONUS_VALUE_FOR_TYPE[type] });
}

/**
 * Create the empty bonus runtime for one player level.
 * @param {object} options
 * @param {number} options.level - current player level (1-based).
 * @returns {Readonly<{
 *   level: number,
 *   cooldownReductionSeconds: number,
 *   stormRank: number,
 *   slowBonuses: number,
 *   spikeTargets: number,
 *   appliedLevels: ReadonlyArray<number>,
 * }>}
 */
export function createBonusRuntime({ level } = {}) {
  const currentLevel = requireLevel(level);
  if (currentLevel < 1) throw new TypeError('level must be at least 1');
  return Object.freeze({
    level: currentLevel,
    cooldownReductionSeconds: 0,
    stormRank: 0,
    slowBonuses: 0,
    spikeTargets: 0,
    appliedLevels: Object.freeze([]),
  });
}

function requireRuntime(runtime) {
  if (runtime === null || typeof runtime !== 'object') {
    throw new TypeError('runtime must be an object');
  }
  for (const key of ['cooldownReductionSeconds', 'stormRank', 'slowBonuses', 'spikeTargets']) {
    if (!Number.isFinite(runtime[key]) || runtime[key] < 0) {
      throw new TypeError(`runtime.${key} must be a non-negative number`);
    }
  }
  if (!Array.isArray(runtime.appliedLevels)) {
    throw new TypeError('runtime.appliedLevels must be an array');
  }
  return runtime;
}

function requireBonus(bonus) {
  if (bonus === null || typeof bonus !== 'object') {
    throw new TypeError('bonus must be an object');
  }
  const { level, type, abilityId, value } = bonus;
  if (!Number.isSafeInteger(level) || level < 2 || level > MAX_BONUS_LEVEL) {
    throw new TypeError('bonus.level must be an integer from 2 to 60');
  }
  if (!BONUS_TYPES.includes(type)) throw new TypeError(`Unknown bonus type: ${String(type)}`);
  if (!ABILITY_ROSTER.some((ability) => ability.id === abilityId)) {
    throw new TypeError(`Unknown bonus ability: ${String(abilityId)}`);
  }
  if (value !== BONUS_VALUE_FOR_TYPE[type]) {
    throw new TypeError(`${type} bonuses are worth ${BONUS_VALUE_FOR_TYPE[type]}`);
  }
  if (!isAbilityUnlocked(abilityId, level)) {
    throw new TypeError(`${String(abilityId)} is locked at level ${level}`);
  }
  return bonus;
}

const cap = (current, addition, max) => Math.min(max, current + addition);

/**
 * Apply one bonus to a runtime. Returns the same runtime when the bonus level
 * was already applied, so replaying the ladder is idempotent. Otherwise the
 * matching counter grows by the bonus value up to its documented cap (one slow
 * bonus counts as one 0.05 step) and the level is appended to `appliedLevels`;
 * the result is a new frozen runtime.
 *
 * The passive speed multiplier is `fiendSpeedMultiplier(runtime.slowBonuses)`
 * from cooldown-abilities.js and never drops below FIEND_SPEED_FLOOR because
 * `slowBonuses` is capped at MAX_SLOW_BONUSES.
 * @param {object} runtime - runtime from createBonusRuntime or applyBonus.
 * @param {{ level: number, type: string, abilityId: string, value: number }} bonus
 * @returns {object} the runtime, unchanged when the level was already applied.
 */
export function applyBonus(runtime, bonus) {
  requireRuntime(runtime);
  requireBonus(bonus);
  if (runtime.appliedLevels.includes(bonus.level)) return runtime;

  return Object.freeze({
    level: runtime.level,
    cooldownReductionSeconds:
      bonus.type === 'cooldown'
        ? cap(runtime.cooldownReductionSeconds, bonus.value, BONUS_CAPS.cooldownSeconds)
        : runtime.cooldownReductionSeconds,
    stormRank:
      bonus.type === 'storm'
        ? cap(runtime.stormRank, bonus.value, BONUS_CAPS.stormRank)
        : runtime.stormRank,
    // slowBonuses counts collected slow bonuses; each one is a
    // BONUS_VALUES.speedStep (0.05) step, so a bonus adds one.
    slowBonuses:
      bonus.type === 'slowSpeed'
        ? cap(runtime.slowBonuses, 1, MAX_SLOW_BONUSES)
        : runtime.slowBonuses,
    spikeTargets:
      bonus.type === 'slowTargets'
        ? cap(runtime.spikeTargets, bonus.value, BONUS_CAPS.spikeTargets)
        : runtime.spikeTargets,
    appliedLevels: Object.freeze([...runtime.appliedLevels, bonus.level]),
  });
}
