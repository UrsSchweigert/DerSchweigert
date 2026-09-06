import { LevelConfig } from './levels.js';
import { getFiendClassWeights, getFiendClass } from './difficulty-classes.js';

const SPEED_BONUS_MAX = 50;   // matches the max speedBonus in main.js's handleCorrectAnswer (perfect-timing assumption)
const COMBO_BONUS_PER_HIT = 10; // matches state.combo * 10 in main.js

/** Expected fiend score value for a level, using the same class-weighting
 *  distribution the real game draws fiend classes from (getFiendClassWeights),
 *  so the estimate matches actual average scoring instead of a guess. */
export function expectedClassScoreForLevel(level) {
  const weights = getFiendClassWeights(level);
  return weights.reduce((sum, w) => sum + w.weight * getFiendClass(w.id).scoreValue, 0);
}

/** Assumed score for a single level L, ASSUMING a flawless "dragon path" clear:
 *  every hit lands at max speed bonus and the combo never breaks, climbing
 *  1, 2, 3, ... for every correct answer in the level (no elites, no misses —
 *  a deliberately simple, deterministic upper-plausible-bound estimate). Each
 *  of the level's `waveSize` fiends needs `fiendHP` correct answers to kill,
 *  so total hits = waveSize * fiendHP. */
export function assumedDragonPathLevelScore(level) {
  const cfg = LevelConfig[level - 1];
  if (!cfg) return 0;
  const hits = cfg.waveSize * cfg.fiendHP;
  const classBase = expectedClassScoreForLevel(level);
  let total = 0;
  for (let i = 1; i <= hits; i++) {
    const comboBonus = (i - 1) * COMBO_BONUS_PER_HIT; // state.combo is the PRE-increment value at hit i
    total += classBase + SPEED_BONUS_MAX + comboBonus;
  }
  return Math.round(total);
}

/** Baseline score to seed a run that jumps straight into `targetLevel`
 *  (1-based), assuming a flawless dragon-path clear of every level
 *  strictly before it. Returns 0 for targetLevel <= 1. */
export function computeDragonPathBaselineScore(targetLevel) {
  let total = 0;
  for (let level = 1; level < targetLevel; level++) {
    total += assumedDragonPathLevelScore(level);
  }
  return total;
}
