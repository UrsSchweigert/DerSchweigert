// Pure ability/cooldown model for the three player abilities.
//
// The model never reads a clock, never rolls dice and never touches the page:
// elapsed time arrives through tick(dt, ...), so the HUD, gameplay and tests
// all drive the exact same logic deterministically.

/**
 * Ability roster. `unlockLevel` is the first player level at which the ability
 * is usable; `baseCooldownSeconds` is the cooldown after every activation.
 * @type {ReadonlyArray<{ id: 'wind' | 'storm' | 'earth', unlockLevel: number, baseCooldownSeconds: number }>}
 */
export const ABILITY_ROSTER = Object.freeze([
  Object.freeze({ id: 'wind', unlockLevel: 1, baseCooldownSeconds: 180 }),
  Object.freeze({ id: 'storm', unlockLevel: 6, baseCooldownSeconds: 180 }),
  Object.freeze({ id: 'earth', unlockLevel: 11, baseCooldownSeconds: 180 }),
]);

/**
 * Default earth-spike slow. The spike slows at most one fiend by 35 % for 8 s.
 */
export const SPIKE_SLOW_DEFAULTS = Object.freeze({
  durationSeconds: 8,
  factor: 0.65,
  targets: 1,
});

/**
 * Documented caps for the earth-spike slow: at most 15 s, a speed factor that
 * never drops below 0.4, and at most 5 simultaneous targets.
 */
export const SPIKE_SLOW_CAPS = Object.freeze({
  durationSeconds: 15,
  factorFloor: 0.4,
  targets: 5,
});

/** Passive fiend-speed multiplier floor (a 30 % slow). */
export const FIEND_SPEED_FLOOR = 0.7;

/** Speed the passive modifier removes per slow bonus. */
export const FIEND_SPEED_STEP = 0.05;

const INACTIVE_SPIKE = Object.freeze({
  active: false,
  remainingSeconds: 0,
  durationSeconds: 0,
  factor: 1,
  targets: 0,
});

function requireFinite(value, name) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`${name} must be a finite number`);
  }
  return value;
}

function requireCount(value, name) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${name} must be a non-negative safe integer`);
  }
  return value;
}

function requireAbility(id) {
  const ability = ABILITY_ROSTER.find((entry) => entry.id === id);
  if (!ability) throw new TypeError(`Unknown ability: ${String(id)}`);
  return ability;
}

/**
 * Clamp earth-spike slow parameters to the documented caps. Missing or
 * non-finite values fall back to the defaults; durations never go below zero,
 * factors never exceed 1 and targets are whole numbers of at least one.
 * @param {{ durationSeconds?: number, factor?: number, targets?: number }} [params]
 * @returns {{ durationSeconds: number, factor: number, targets: number }}
 */
export function clampSpikeSlow(params = {}) {
  const source = params ?? {};
  const duration = Number.isFinite(source.durationSeconds)
    ? source.durationSeconds
    : SPIKE_SLOW_DEFAULTS.durationSeconds;
  const factor = Number.isFinite(source.factor)
    ? source.factor
    : SPIKE_SLOW_DEFAULTS.factor;
  const targets = Number.isFinite(source.targets)
    ? source.targets
    : SPIKE_SLOW_DEFAULTS.targets;

  return {
    durationSeconds: Math.min(SPIKE_SLOW_CAPS.durationSeconds, Math.max(0, duration)),
    factor: Math.min(1, Math.max(SPIKE_SLOW_CAPS.factorFloor, factor)),
    targets: Math.min(SPIKE_SLOW_CAPS.targets, Math.max(1, Math.trunc(targets))),
  };
}

/**
 * Passive fiend-speed modifier: starts at 1, drops 0.05 per slow bonus and
 * never falls below 0.7.
 * @param {number} [slowBonuses] - number of collected slow bonuses.
 * @returns {number} multiplier in [0.7, 1].
 */
export function fiendSpeedMultiplier(slowBonuses = 0) {
  const bonuses = requireCount(slowBonuses, 'slowBonuses');
  return Math.max(FIEND_SPEED_FLOOR, 1 - FIEND_SPEED_STEP * bonuses);
}

/**
 * Create a deterministic ability runtime for one player level.
 * @param {object} options
 * @param {number} options.level - current player level (1-based).
 * @param {number} [options.rank] - storm bonus rank; each rank removes one
 *   additional enemy. Defaults to 0.
 * @param {number} [options.slowBonuses] - collected passive slow bonuses.
 *   Defaults to 0.
 * @param {{ durationSeconds?: number, factor?: number, targets?: number }} [options.spikeSlow]
 *   earth-spike slow parameters, clamped to SPIKE_SLOW_CAPS. Defaults to
 *   SPIKE_SLOW_DEFAULTS.
 */
export function createAbilityRuntime({
  level,
  rank = 0,
  slowBonuses = 0,
  spikeSlow = SPIKE_SLOW_DEFAULTS,
} = {}) {
  let currentLevel = requireFinite(level, 'level');
  if (currentLevel < 1) throw new TypeError('level must be at least 1');
  const stormRank = requireCount(rank, 'rank');
  const passiveSlow = requireCount(slowBonuses, 'slowBonuses');
  const spikeConfig = clampSpikeSlow(spikeSlow);

  const remaining = new Map(ABILITY_ROSTER.map((ability) => [ability.id, 0]));
  let spike = { ...INACTIVE_SPIKE };

  const isUnlocked = (id) => {
    const ability = requireAbility(id);
    return currentLevel >= ability.unlockLevel;
  };

  const resetSpike = () => {
    spike = { ...INACTIVE_SPIKE };
  };

  return {
    get level() {
      return currentLevel;
    },
    rank: stormRank,
    fiendSpeedMultiplier: fiendSpeedMultiplier(passiveSlow),

    /**
     * Move the runtime to another player level. Unlocks refresh immediately;
     * cooldowns already running keep their remaining time, so a level
     * transition never grants a free activation.
     * @param {number} nextLevel - the new 1-based player level.
     * @returns {number} the new level.
     */
    setLevel(nextLevel) {
      const value = requireFinite(nextLevel, 'level');
      if (value < 1) throw new TypeError('level must be at least 1');
      currentLevel = value;
      return currentLevel;
    },

    /**
     * True when the player level has reached the ability's unlock level.
     * Throws for an unknown ability id.
     */
    isUnlocked,

    /**
     * Advance the model by `dt` seconds. Cooldowns and an active spike slow
     * only count down while `encounterRunning` is true; both stop at 0.
     * @param {number} dt - elapsed seconds, finite and non-negative.
     * @param {{ encounterRunning?: boolean }} [state]
     */
    tick(dt, { encounterRunning = false } = {}) {
      requireFinite(dt, 'dt');
      if (dt < 0) throw new TypeError('dt must not be negative');
      if (!encounterRunning) return;

      for (const ability of ABILITY_ROSTER) {
        if (currentLevel < ability.unlockLevel) continue;
        remaining.set(ability.id, Math.max(0, remaining.get(ability.id) - dt));
      }

      if (spike.active) {
        const left = Math.max(0, spike.remainingSeconds - dt);
        if (left === 0) {
          resetSpike();
        } else {
          spike = { ...spike, remainingSeconds: left };
        }
      }
    },

    /**
     * Activate an ability. Unlocked abilities restart their full base cooldown
     * and return true; locked abilities do nothing and return false. Activating
     * earth also starts the spike slow with the clamped parameters.
     * Throws for an unknown ability id.
     * @param {'wind' | 'storm' | 'earth'} id
     * @returns {boolean} whether the ability was activated.
     */
    activate(id) {
      const ability = requireAbility(id);
      if (currentLevel < ability.unlockLevel) return false;

      remaining.set(id, ability.baseCooldownSeconds);
      if (id === 'earth') {
        spike = {
          active: true,
          remainingSeconds: spikeConfig.durationSeconds,
          durationSeconds: spikeConfig.durationSeconds,
          factor: spikeConfig.factor,
          targets: spikeConfig.targets,
        };
      }
      return true;
    },

    /**
     * Cooldown progress in [0, 1]: 0 right after activation, 1 when ready.
     * Locked abilities always report 0.
     * @param {'wind' | 'storm' | 'earth'} id
     * @returns {number}
     */
    progress(id) {
      const ability = requireAbility(id);
      if (currentLevel < ability.unlockLevel) return 0;
      const left = remaining.get(id);
      return Math.min(1, Math.max(0, 1 - left / ability.baseCooldownSeconds));
    },

    /**
     * Enemies the storm removes from a group of `remaining` enemies:
     * min(1 + rank, max(0, remaining - 1)), so at least one always survives.
     * @param {number} remainingEnemies - enemies currently in the encounter.
     * @returns {number}
     */
    stormRemovals(remainingEnemies) {
      const left = requireFinite(remainingEnemies, 'remaining');
      return Math.min(1 + stormRank, Math.max(0, left - 1));
    },

    /** Snapshot of the earth-spike slow; reset to an inert state after it ends. */
    get spikeState() {
      return { ...spike };
    },

    /** End the earth-spike slow immediately, leaving no residual effect. */
    clearSpike() {
      resetSpike();
    },
  };
}
