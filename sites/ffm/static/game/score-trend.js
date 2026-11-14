// score-trend.js — Series for the score history chart.
//
// Saved history entries are single results: in the app the points of one level,
// on the web one submitted level score. Two series are built from them:
//
//   * highScoreTrend — the app's chart. The player keeps a per-level best, so
//     their total high score (the sum of those bests) exists and is plotted
//     after every saved result: the curve shows how the cumulative score grew.
//   * dailyBestTrend — the web chart, which has no per-level bests to add up.
//     Results are grouped by the day they were achieved and only a day's best
//     result is plotted, so the curve rises and falls with the daily results
//     instead of flattening into a never-decreasing record line.

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

function timeOf(value) {
  const time = typeof value === 'string' ? Date.parse(value) : NaN;
  return Number.isNaN(time) ? null : time;
}

/**
 * App: the total high score (sum of the per-level bests) after each saved
 * result, oldest first. A later, lower result for a level it already beat does
 * not lower the total, so the curve only ever rises or stays flat. History
 * keeps only the newest results, so a level whose current best predates the
 * oldest kept result starts from that best; the last point therefore always
 * equals the sum of the current per-level bests.
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

/** The local calendar day of a result, or null when it has no usable timestamp. */
function dayOf(value) {
  const time = timeOf(value);
  if (time === null) return null;
  const date = new Date(time);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

/**
 * One point per day, carrying that day's best result, oldest day first.
 * `results` counts the saved results that collapsed into the point, so the
 * summary can still report how many results were saved. Results without a
 * usable timestamp cannot be grouped and keep their own point.
 */
export function dailyBestTrend(history) {
  const series = [];
  const days = new Map();
  for (const entry of Array.isArray(history) ? history : []) {
    const score = points(entry?.score);
    const day = dayOf(entry?.achieved_at);
    const point = day === null ? null : days.get(day);
    if (!point) {
      const fresh = { ...trendPoint(entry, score), results: 1 };
      if (day !== null) days.set(day, fresh);
      series.push(fresh);
      continue;
    }
    point.results += 1;
    if (score > point.score) {
      Object.assign(point, trendPoint(entry, score));
      if (entry?.unfinished !== true) delete point.unfinished;
    }
  }
  return series;
}
