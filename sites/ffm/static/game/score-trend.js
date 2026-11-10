// score-trend.js — High-score development series for the score history chart.
//
// Saved history entries are single results: on the web one submitted run
// total, in the app the points of one level. The chart instead shows how the
// high score developed over time, so both are turned into a series that only
// rises or stays flat, one point per saved result (oldest first).

function points(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
}

function trendPoint(entry, score) {
  return {
    score,
    achieved_at: typeof entry?.achieved_at === 'string' ? entry.achieved_at : null,
    ...(entry?.unfinished === true ? { unfinished: true } : {}),
  };
}

/** Web: the best submitted score so far after each saved result. */
export function runningBestTrend(history) {
  let best = 0;
  return (Array.isArray(history) ? history : []).map((entry) => {
    best = Math.max(best, points(entry?.score));
    return trendPoint(entry, best);
  });
}

function timeOf(value) {
  const time = typeof value === 'string' ? Date.parse(value) : NaN;
  return Number.isNaN(time) ? null : time;
}

/**
 * App: the total high score (sum of the per-level bests) after each saved
 * result. History keeps only the newest results, so a level whose current
 * best predates the oldest kept result starts from that best; the last point
 * therefore always equals the sum of the current per-level bests.
 */
export function highScoreTrend(history, best = []) {
  const entries = Array.isArray(history) ? history : [];
  const levelBests = new Map();
  const windowStart = timeOf(entries[0]?.achieved_at);
  for (const entry of Array.isArray(best) ? best : []) {
    const achieved = timeOf(entry?.achieved_at);
    if (windowStart !== null && achieved !== null && achieved < windowStart) {
      levelBests.set(entry.level, points(entry.score));
    }
  }
  let total = [...levelBests.values()].reduce((sum, value) => sum + value, 0);
  return entries.map((entry) => {
    const score = points(entry?.score);
    const previous = levelBests.get(entry?.level) ?? 0;
    if (score > previous) {
      levelBests.set(entry.level, score);
      total += score - previous;
    }
    return trendPoint(entry, total);
  });
}
