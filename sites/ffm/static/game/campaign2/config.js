// The level config of a Campaign 2 level, shaped like the Campaign 1 configs so the game's
// level start, fiend factory and HUD read it unchanged. Campaign 2 has no art of its own:
// it plays on the scenes of levels 21-60 (`artLevel`), and the player arrives with every
// hero ability (`abilityLevel`). Its questions need more thinking time than arithmetic, so
// `timerScale` stretches the chosen difficulty's timer, a little at first and up to double.
import { actForLevel, TOTAL_LEVELS_2 } from './campaign2-levels.js';
import { chapterForLevel } from '../levels.js';

export const WAVE_SIZE_2 = 24;
export const ART_LEVEL_OFFSET = 20;
export const ABILITY_LEVEL = 60;

export const timerScale2 = level => Math.round((1.2 + (0.8 * (level - 1)) / (TOTAL_LEVELS_2 - 1)) * 100) / 100;

export function getCampaign2LevelConfig(level) {
  const act = actForLevel(level);
  return {
    campaign: 2,
    level,
    chapter: chapterForLevel(ART_LEVEL_OFFSET + level),   // the scene/music chapter it plays in
    act: act.act,
    chapterName: act.name,
    fiendType: 'slimeling',
    fiendHP: 1,
    waveSize: WAVE_SIZE_2,
    inputMode: 'multiple-choice',
    artLevel: ART_LEVEL_OFFSET + level,
    abilityLevel: ABILITY_LEVEL,
    timerScale: timerScale2(level),
    baseline_score: 0,
  };
}
