import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { computeDragonPathBaselineScore, assumedDragonPathLevelScore, calculateLevelBaselineScore } from './level-baseline-score.js';
import { getFiendClass } from './difficulty-classes.js';
import { readFileSync } from 'node:fs';
const _FullLevelConfig = JSON.parse(readFileSync(new URL('../../app/level_data.json', import.meta.url))).levels;

describe('computeDragonPathBaselineScore', () => {
  it('returns 0 for targetLevel <= 1', () => {
    assert.strictEqual(computeDragonPathBaselineScore(1, _FullLevelConfig), 0);
  });

  it('returns the level 1 score for targetLevel 2', () => {
    assert.strictEqual(
      computeDragonPathBaselineScore(2, _FullLevelConfig),
      assumedDragonPathLevelScore(1, _FullLevelConfig)
    );
  });

  it('returns the sum of levels 1 and 2 for targetLevel 3', () => {
    const expected = assumedDragonPathLevelScore(1, _FullLevelConfig) + assumedDragonPathLevelScore(2, _FullLevelConfig);
    assert.strictEqual(computeDragonPathBaselineScore(3, _FullLevelConfig), expected);
  });
});

describe('assumedDragonPathLevelScore', () => {
  it('is deterministic: calling it twice with the same level returns the same value', () => {
    const first = assumedDragonPathLevelScore(1, _FullLevelConfig);
    const second = assumedDragonPathLevelScore(1, _FullLevelConfig);
    assert.strictEqual(first, second);
  });

  it('returns exactly 7350 for level 1 (hand-computed)', () => {
    // Level 1: fiendHP=1, waveSize=30, so hits=30
    // classIdForLevel(1)=1 (one class per level), scoreValue=50,
    // SPEED_BONUS_MAX=50, COMBO_BONUS_PER_HIT=10
    // sum = 30*100 + 10*(0+1+...+29) = 3000 + 4350 = 7350
    assert.strictEqual(assumedDragonPathLevelScore(1, _FullLevelConfig), 7350);
  });

  it('trends upward within chapter 1 (when comparing select levels with same fiendHP)', () => {
    // All levels 1-15 have fiendHP: 1, waveSize: 30, but classBase varies
    // Pick specific pairs that exhibit upward trend in their classBase values
    const level1 = assumedDragonPathLevelScore(1, _FullLevelConfig);
    const level3 = assumedDragonPathLevelScore(3, _FullLevelConfig);
    const level9 = assumedDragonPathLevelScore(9, _FullLevelConfig);
    const level11 = assumedDragonPathLevelScore(11, _FullLevelConfig);

    assert.ok(level1 < level3, `Level 1 score (${level1}) should be less than level 3 (${level3})`);
    assert.ok(level9 < level11, `Level 9 score (${level9}) should be less than level 11 (${level11})`);
  });

  it('returns 0 for invalid level (outside LevelConfig)', () => {
    assert.strictEqual(assumedDragonPathLevelScore(999, _FullLevelConfig), 0);
  });
});

describe('shipped level_data.json baselines', () => {
  // app/level_data.json is what the backend serves as baseline_score when a
  // player jumps into a later level. Regenerate it with
  // `node sites/ffm/scripts/update-level-data.mjs` after any change to the
  // level->class ladder or the score scale; otherwise a jump is seeded with a
  // score the player can no longer earn (the 60-class ladder replaced a
  // 36-class table, which left every baseline 30-130% off).
  it('matches the current level->class ladder for all 60 levels', () => {
    for (const cfg of _FullLevelConfig) {
      assert.strictEqual(
        cfg.baseline_score,
        computeDragonPathBaselineScore(cfg.level, _FullLevelConfig),
        `level ${cfg.level} baseline_score is stale - re-run update-level-data.mjs`,
      );
    }
  });

  it('seeds level 2 with a flawless clear of level 1 (7350, class 1)', () => {
    assert.strictEqual(_FullLevelConfig[0].baseline_score, 0);
    assert.strictEqual(_FullLevelConfig[1].baseline_score, 7350);
  });
});
