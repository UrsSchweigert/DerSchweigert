// scroll-focus.js — scroll a list container so one row sits at its top.
//
// Used by the practice list (highest level with a score) and the speedrun card
// (last level with a recorded time). It only moves the container's own
// scrollTop, never the page, and does nothing while the container is hidden
// (a hidden element has no layout, so offsets would all be 0).

/** The row whose numeric `data-level` is highest, or null for an empty list. */
export function highestLevelRow(container) {
  let best = null;
  let bestLevel = -Infinity;
  for (const row of container?.querySelectorAll?.('[data-level]') ?? []) {
    const level = Number(row.dataset.level);
    if (Number.isFinite(level) && level > bestLevel) {
      best = row;
      bestLevel = level;
    }
  }
  return best;
}

/** Scroll `container` so `row` is at its top (the browser clamps at the end). */
export function scrollRowToTop(container, row) {
  if (!container || !row) return false;
  // The lists are `position: relative`, so a row's offsetTop is measured from
  // the container itself.
  container.scrollTop = Math.max(0, row.offsetTop);
  return true;
}

/** No rows with a level = start at the top. */
export function scrollToHighestLevel(container) {
  const row = highestLevelRow(container);
  if (!row) {
    if (container) container.scrollTop = 0;
    return false;
  }
  return scrollRowToTop(container, row);
}
