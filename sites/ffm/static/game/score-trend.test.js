import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dailyBestTrend, highScoreTrend } from './score-trend.js';

const scores = series => series.map(point => point.score);

test('the app total adds up the per-level bests as they are beaten', () => {
  const trend = highScoreTrend([
    { level: 1, score: 300, achieved_at: '2026-11-01T10:00:00' },
    { level: 2, score: 400, achieved_at: '2026-11-01T12:00:00' },
    { level: 1, score: 100, achieved_at: '2026-11-02T10:00:00' },
    { level: 1, score: 500, achieved_at: '2026-11-02T12:00:00' },
  ]);
  assert.deepEqual(scores(trend), [300, 700, 700, 900]);
});

test('a level best that predates the kept history still counts', () => {
  const trend = highScoreTrend([
    { level: 2, score: 400, achieved_at: '2026-11-05T10:00:00' },
  ], [
    { level: 1, score: 300, achieved_at: '2026-10-01T10:00:00' },
    { level: 3, score: 900, achieved_at: '2026-11-05T11:00:00' },
  ]);
  assert.deepEqual(scores(trend), [700], 'only the older level best is seeded');
});

test('an unfinished attempt counts once it improves the level best', () => {
  const trend = highScoreTrend([
    { level: 1, score: 400, achieved_at: '2026-11-01T10:00:00', unfinished: true },
  ]);
  assert.deepEqual(scores(trend), [400]);
  assert.equal(trend[0].unfinished, true);
});

test('the total survives scores that are missing or invalid', () => {
  const trend = highScoreTrend([{ level: 1 }, { level: 2, score: 'x' }, { level: 2, score: 250 }]);
  assert.deepEqual(scores(trend), [0, 0, 250]);
  assert.deepEqual(highScoreTrend(null), []);
  assert.deepEqual(highScoreTrend(undefined, [{ level: 1, score: 10 }]), []);
});

test('one point per day holding that day\'s best result', () => {
  const trend = dailyBestTrend([
    { score: 500, achieved_at: '2026-11-01T09:00:00' },
    { score: 900, achieved_at: '2026-11-01T18:00:00' },
    { score: 200, achieved_at: '2026-11-01T20:00:00' },
    { score: 400, achieved_at: '2026-11-02T09:00:00' },
  ]);
  assert.deepEqual(scores(trend), [900, 400]);
  assert.deepEqual(trend.map((point) => point.results), [3, 1]);
  assert.equal(trend[0].achieved_at, '2026-11-01T18:00:00', 'the day keeps the time of its best result');
});

test('the curve falls when a later day is weaker', () => {
  const trend = dailyBestTrend([
    { score: 900, achieved_at: '2026-11-01T10:00:00' },
    { score: 200, achieved_at: '2026-11-02T10:00:00' },
    { score: 600, achieved_at: '2026-11-03T10:00:00' },
  ]);
  assert.deepEqual(scores(trend), [900, 200, 600]);
});

test('days are local calendar days, not rolling 24-hour windows', () => {
  const trend = dailyBestTrend([
    { score: 100, achieved_at: '2026-11-01T00:30:00' },
    { score: 300, achieved_at: '2026-11-01T23:30:00' },
    { score: 200, achieved_at: '2026-11-02T00:10:00' },
  ]);
  assert.deepEqual(scores(trend), [300, 200]);
});

test('results without a usable timestamp keep their own point', () => {
  const trend = dailyBestTrend([{ score: 10 }, { score: 20 }, { score: 'x' }]);
  assert.deepEqual(scores(trend), [10, 20, 0]);
  assert.deepEqual(trend.map((point) => point.results), [1, 1, 1]);
});

test('an unfinished day peak is marked, a cleared one is not', () => {
  const unfinished = dailyBestTrend([
    { score: 400, achieved_at: '2026-11-01T10:00:00', unfinished: true },
  ]);
  assert.equal(unfinished[0].unfinished, true);

  const overtaken = dailyBestTrend([
    { score: 400, achieved_at: '2026-11-01T10:00:00', unfinished: true },
    { score: 500, achieved_at: '2026-11-01T12:00:00' },
  ]);
  assert.equal(overtaken[0].unfinished, undefined, 'a cleared day peak hides the weaker unfinished attempt');

  const peakUnfinished = dailyBestTrend([
    { score: 500, achieved_at: '2026-11-01T10:00:00' },
    { score: 600, achieved_at: '2026-11-01T12:00:00', unfinished: true },
  ]);
  assert.equal(peakUnfinished[0].unfinished, true);
});

test('empty and absent histories produce an empty series', () => {
  assert.deepEqual(dailyBestTrend(null), []);
  assert.deepEqual(dailyBestTrend([]), []);
  assert.deepEqual(dailyBestTrend(undefined), []);
});
