import { readFileSync, writeFileSync } from 'node:fs';
import { computeDragonPathBaselineScore } from '../static/game/level-baseline-score.js';

const file = new URL('../app/level_data.json', import.meta.url);
const data = JSON.parse(readFileSync(file, 'utf8'));
if (data.levels.length !== 60) throw new Error('Expected the complete private curriculum');
for (const cfg of data.levels) {
  cfg.baseline_score = computeDragonPathBaselineScore(cfg.level, data.levels);
}
writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
