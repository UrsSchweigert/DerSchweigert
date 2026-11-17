// encounter-swords.js — Shared portrait encounter progress row.
//
// main.js imports this module once for both channels and feeds it the same
// defeated/total count as the header's "Defeated" readout, so the website and
// the app show one row from one implementation. The widget inserts a
// decorative row of little swords into #input-zone directly above
// #mc-buttons: one sword per enemy in the level, filled green from left to
// right as enemies are beaten. The row renders the same count the header's
// "Defeated" readout announces, so it is aria-hidden. CSS keeps it
// display:none outside portrait, so landscape and the app bundle's portrait
// layout decide visibility; see .app-encounter-swords in styles.css.
//
// Landscape shows the same swords as a narrow vertical column at the left edge
// of #game-wrap. The module creates that mirror itself (no markup), keeps it in
// step with the row after every update, and CSS shows exactly one of the two.
//
// `total` is what the level still holds: a storm that removes enemies from the
// level shrinks it, so those swords leave the row. The caller may fire
// `shatter(count)` on the cast to puff the departing swords off before the next
// update removes them.
//
//   const widget = createEncounterSwords({ doc: document });
//   widget.updateEncounterProgress({ defeated, total });
//   widget.shatter(3);
//
// The module owns no clock and only touches the DOM when the count changes.

/** Upper bound on sword nodes; a campaign level has 30 enemies. */
export const MAX_SWORDS = 30;

export const SWORDS_CLASS = 'app-encounter-swords';
export const SWORDS_COLUMN_CLASS = 'app-encounter-swords-column';
export const SWORDS_WRAP_ID = 'game-wrap';
export const SWORD_CLASS = 'app-encounter-sword';
export const SWORD_FILLED_CLASS = 'app-encounter-sword--filled';
// A sword a storm took off the level: the slot stays in the row and goes empty,
// so the player sees where the removed enemies were instead of watching every
// remaining sword slide towards the middle.
export const SWORD_LOST_CLASS = 'app-encounter-sword--lost';
export const SWORDS_CONTAINER_ID = 'input-zone';
export const SWORDS_ANCHOR_ID = 'mc-buttons';

function toCount(value) {
  const number = Math.floor(Number(value));
  return Number.isFinite(number) && number > 0 ? number : 0;
}

/**
 * Resolve how many sword slots to draw, how many are filled and how many the
 * storm emptied.
 *
 * `slots` is the count the level started with and `total` what it still holds;
 * a storm shrinks `total`, so the difference stays in the row as empty slots.
 * A slot count above MAX_SWORDS is scaled down so every sword still stands for a
 * share of the level, and a level that is fully beaten always shows every sword
 * filled.
 * @param {{ defeated?: unknown, total?: unknown, slots?: unknown }} [progress]
 * @returns {{ swords: number, filled: number, lost: number }}
 */
export function resolveSwords({ defeated, total, slots } = {}) {
  const remaining = toCount(total);
  const original = Math.max(remaining, toCount(slots));
  if (original === 0) return { swords: 0, filled: 0, lost: 0 };
  const beaten = Math.min(toCount(defeated), remaining);
  const lost = original - remaining;
  if (original <= MAX_SWORDS) return { swords: original, filled: beaten, lost };
  const scale = MAX_SWORDS / original;
  const scaledLost = Math.min(MAX_SWORDS, Math.round(lost * scale));
  return {
    swords: MAX_SWORDS,
    filled: Math.min(MAX_SWORDS - scaledLost, Math.floor(beaten * scale)),
    lost: scaledLost,
  };
}

/**
 * Insert the decorative sword row and return its widget.
 *
 * @param {object} [options]
 * @param {Document} [options.doc]
 * @param {string} [options.containerId]
 * @param {string} [options.anchorId]
 */
export function createEncounterSwords({
  doc = globalThis.document,
  containerId = SWORDS_CONTAINER_ID,
  anchorId = SWORDS_ANCHOR_ID,
} = {}) {
  const container = doc?.getElementById?.(containerId) ?? null;
  const anchor = doc?.getElementById?.(anchorId) ?? null;
  const wrap = doc?.getElementById?.(SWORDS_WRAP_ID) ?? null;
  const swords = [];
  const columnSwords = [];
  let element = null;
  let column = null;
  let filledCount = 0;
  let lostCount = 0;

  if (container && anchor && typeof doc.createElement === 'function') {
    element = doc.createElement('div');
    element.className = SWORDS_CLASS;
    element.setAttribute('aria-hidden', 'true');
    // Nothing is drawn until the first encounter count arrives.
    element.hidden = true;
    if (typeof container.insertBefore === 'function') {
      container.insertBefore(element, anchor);
    } else {
      container.appendChild(element);
    }
    if (wrap && typeof wrap.appendChild === 'function') {
      column = doc.createElement('div');
      column.className = SWORDS_COLUMN_CLASS;
      column.setAttribute('aria-hidden', 'true');
      column.hidden = true;
      wrap.appendChild(column);
    }
  }

  function updateEncounterProgress(progress = {}) {
    if (!element) return null;
    const resolved = resolveSwords(progress);
    // The loop calls this on every frame: re-assigning the same hidden value
    // invalidated style each time.
    const hide = resolved.swords === 0;
    if (element.hidden !== hide) element.hidden = hide;
    if (column && column.hidden !== hide) column.hidden = hide;
    // A length change is a new level or a storm emptying slots, not a kill: it
    // must not glint as if a sword had been earned.
    let countChanged = false;
    if (swords.length !== resolved.swords) {
      while (swords.length > resolved.swords) swords.pop().remove?.();
      while (swords.length < resolved.swords) {
        const sword = doc.createElement('span');
        sword.className = SWORD_CLASS;
        swords.push(sword);
        element.appendChild(sword);
      }
      while (columnSwords.length > resolved.swords) columnSwords.pop().remove?.();
      while (column && columnSwords.length < resolved.swords) {
        const sword = doc.createElement('span');
        sword.className = SWORD_CLASS;
        columnSwords.push(sword);
        column.appendChild(sword);
      }
      filledCount = -1;
      lostCount = -1;
      countChanged = true;
    }
    if (filledCount !== resolved.filled || lostCount !== resolved.lost) {
      const gained = !countChanged && resolved.filled > filledCount
        ? resolved.filled - filledCount
        : 0;
      // The emptied slots are the row's tail: the storm takes the enemies at the
      // end of the level, so the swords that remain keep their positions.
      const firstLost = resolved.swords - resolved.lost;
      for (const list of [swords, columnSwords]) {
        list.forEach((sword, index) => {
          sword.classList?.toggle?.(SWORD_FILLED_CLASS, index < resolved.filled);
          sword.classList?.toggle?.(SWORD_LOST_CLASS, index >= firstLost);
        });
      }
      if (gained > 0) glint(resolved.filled - 1);
      filledCount = resolved.filled;
      lostCount = resolved.lost;
    }
    return resolved;
  }

  // Spark at the sword that just filled. The screen-FX layer lives in main.js,
  // so it is reached through the same global handle the rest of the game uses;
  // on a page without it this is simply a no-op.
  function glint(index) {
    playAtSword(index, 'swordGain');
  }

  // The storm's receipt on the row: the rightmost swords that still stand for
  // an enemy are about to be taken off the level, so puff them out at their own
  // positions before the next update() empties their slots. Slots an earlier
  // storm already emptied are skipped — there is no sword left to shatter.
  function shatter(count) {
    const live = [];
    swords.forEach((sword, index) => {
      if (!sword.classList?.contains?.(SWORD_LOST_CLASS)) live.push(index);
    });
    const removed = Math.min(toCount(count), live.length);
    if (removed === 0) return 0;
    for (const index of live.slice(live.length - removed)) {
      playAtSword(index, 'swordLost');
    }
    return removed;
  }

  // The sword at `index` of whichever container is laid out; the other one is
  // display:none and reports a 0x0 rect.
  function playAtSword(index, effect) {
    const fx = globalThis.ffmScreenFx;
    if (!fx) return;
    let rect = null;
    for (const list of [swords, columnSwords]) {
      const candidate = list[index]?.getBoundingClientRect?.();
      if (candidate && candidate.width > 0 && candidate.height > 0) {
        rect = candidate;
        break;
      }
      rect ??= candidate ?? null;
    }
    if (!rect) return;
    // A container that is not laid out reports a 0x0 rect at the viewport
    // origin and the world conversion below would spray the effect into the
    // top-left corner of the screen.
    if (!(rect.width > 0) || !(rect.height > 0)) return;
    const map = fx.mapping?.();
    if (!map || !map.scale) return;
    fx.play(effect, {
      x: (rect.left + rect.width / 2 - map.offsetX) / map.scale,
      y: (rect.top + rect.height / 2 - map.offsetY) / map.scale,
    });
  }

  function destroy() {
    if (element) element.remove?.();
    element = null;
    if (column) column.remove?.();
    column = null;
    swords.length = 0;
    columnSwords.length = 0;
    filledCount = 0;
    lostCount = 0;
  }

  return {
    get element() {
      return element;
    },
    get column() {
      return column;
    },
    swords,
    columnSwords,
    updateEncounterProgress,
    shatter,
    destroy,
  };
}
