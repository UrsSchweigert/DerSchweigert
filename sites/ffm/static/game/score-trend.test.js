import { test } from 'node:test';
import assert from 'node:assert/strict';
import { highScoreTrend, runningBestTrend } from './score-trend.js';

const scores = series => series.map(point => point.score);

test('runningBestTrend keeps the best submitted score so far', () => {
  assert.deepEqual(scores(runningBestTrend([{ score: 500 }, { score: 200 }, { score: 900 }, { score: 0 }])),
    [500, 500, 900, 900]);
  assert.deepEqual(runningBestTrend(null), []);
  assert.deepEqual(runningBestTrend([{ score: 'x', achieved_at: '2026-11-01T00:00:00Z' }]),
    [{ score: 0, achieved_at: '2026-11-01T00:00:00Z' }]);
});

test('highScoreTrend sums per-level bests and never drops on a weaker replay', () => {
  const history = [
    { level: 1, score: 300, achieved_at: '2026-11-01T10:00:00Z' },
    { level: 2, score: 400, achieved_at: '2026-11-02T10:00:00Z' },
    { level: 1, score: 100, achieved_at: '2026-11-03T10:00:00Z' },
    { level: 1, score: 500, achieved_at: '2026-11-04T10:00:00Z' },
    { level: 3, score: 250, achieved_at: '2026-11-05T10:00:00Z', unfinished: true },
  ];
  const trend = highScoreTrend(history, []);
  assert.deepEqual(scores(trend), [300, 700, 700, 900, 1150]);
  assert.equal(trend[4].unfinished, true);
  assert.equal(trend[1].achieved_at, '2026-11-02T10:00:00Z');
});

test('bests from before the kept history window form the starting total', () => {
  const history = [
    { level: 2, score: 100, achieved_at: '2026-11-05T10:00:00Z' },
    { level: 3, score: 200, achieved_at: '2026-11-06T10:00:00Z' },
  ];
  const best = [
    { level: 1, score: 600, achieved_at: '2026-10-01T10:00:00Z' },
    { level: 2, score: 400, achieved_at: '2026-10-02T10:00:00Z' },
    { level: 3, score: 200, achieved_at: '2026-11-06T10:00:00Z' },
  ];
  const trend = highScoreTrend(history, best);
  assert.deepEqual(scores(trend), [1000, 1200]);
  assert.equal(trend.at(-1).score, best.reduce((sum, entry) => sum + entry.score, 0),
    'the last point equals the sum of the current level bests');
});
