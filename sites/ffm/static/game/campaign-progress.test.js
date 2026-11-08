import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getCampaignProgress, resetLevelAttempt } from './campaign-progress.js';

test('campaign continuation chooses the first unfinished level, including gaps and final completion', () => {
  assert.deepEqual(getCampaignProgress([]), { cleared: [], nextLevel: 1, complete: false });
  assert.deepEqual(getCampaignProgress([3, 1, 1]), { cleared: [1, 3], nextLevel: 2, complete: false });
  assert.equal(getCampaignProgress([1, 2]).nextLevel, 3);
  assert.equal(getCampaignProgress(Array.from({ length: 59 }, (_, i) => i + 1)).nextLevel, 60);
  assert.equal(getCampaignProgress(Array.from({ length: 60 }, (_, i) => i + 1)).nextLevel, null);
  assert.equal(getCampaignProgress(Array.from({ length: 60 }, (_, i) => i + 1)).complete, true);
});

test('invalid continuation data is rejected instead of claiming a new campaign', () => {
  for (const completed of [null, [0], [61], ['1'], [1.5]]) {
    assert.throws(() => getCampaignProgress(completed), TypeError);
  }
});

test('retries restore difficulty hearts and time without banking unfinished points', () => {
  for (const [maxHearts, timerMax] of [[7, 15], [5, 10], [3, 5]]) {
    const state = { maxHearts, timerMax, hearts: 0, score: 900, combo: 12, timerRemaining: 0, timerActive: true };
    resetLevelAttempt(state, 400);
    assert.deepEqual(state, { maxHearts, timerMax, hearts: maxHearts, score: 400, combo: 0,
      timerRemaining: timerMax, timerActive: false });
    resetLevelAttempt(state, 400);
    assert.equal(state.score, 400);
  }
});
