import { TOTAL_LEVELS } from './levels.js';

export function getCampaignProgress(completed) {
  if (!Array.isArray(completed) || completed.some(level =>
    !Number.isInteger(level) || level < 1 || level > TOTAL_LEVELS)) {
    throw new TypeError('Completed levels must be valid curriculum level numbers');
  }
  const cleared = [...new Set(completed)].sort((a, b) => a - b);
  const nextLevel = Array.from({ length: TOTAL_LEVELS }, (_, index) => index + 1)
    .find(level => !cleared.includes(level));
  return { cleared, nextLevel: nextLevel ?? null, complete: nextLevel === undefined };
}

export function resetLevelAttempt(state, checkpoint) {
  state.hearts = state.maxHearts;
  state.timerRemaining = state.timerMax;
  state.timerActive = false;
  state.score = checkpoint;
  state.combo = 0;
}
