// score-trend.js — Series for the score history chart.
//
// Saved history entries are single results: on the web one submitted run
// total, in the app the points of one level. The chart shows the player's form
// over time, so results are grouped by the day they were achieved and only a
// day's best result is plotted. One point per day keeps the curve readable and
// lets it rise and fall with the day-to-day results instead of flattening into
// a never-decreasing record line.

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
