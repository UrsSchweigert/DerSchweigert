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
export const SWORD_CLASS = 'app-encounter-sword';
export const SWORD_FILLED_CLASS = 'app-encounter-sword--filled';
export const SWORDS_CONTAINER_ID = 'input-zone';
export const SWORDS_ANCHOR_ID = 'mc-buttons';

function toCount(value) {
  const number = Math.floor(Number(value));
  return Number.isFinite(number) && number > 0 ? number : 0;
}

/**
 * Resolve how many swords to draw and how many are filled. A total above
 * MAX_SWORDS is scaled down so every sword still stands for a share of the
 * level, and a level that is fully beaten always shows every sword filled.
 * @param {{ defeated?: unknown, total?: unknown }} [progress]
 * @returns {{ swords: number, filled: number }}
 */
export function resolveSwords({ defeated, total } = {}) {
  const enemies = toCount(total);
  if (enemies === 0) return { swords: 0, filled: 0 };
  const beaten = Math.min(toCount(defeated), enemies);
  if (enemies <= MAX_SWORDS) return { swords: enemies, filled: beaten };
  return { swords: MAX_SWORDS, filled: Math.floor((beaten / enemies) * MAX_SWORDS) };
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
  const swords = [];
  let element = null;
  let filledCount = 0;

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
  }

  function updateEncounterProgress(progress = {}) {
    if (!element) return null;
    const resolved = resolveSwords(progress);
    element.hidden = resolved.swords === 0;
    // A length change is a new level or a storm shrinking the row, not a kill:
    // it must not glint as if a sword had been earned.
    let countChanged = false;
    if (swords.length !== resolved.swords) {
      while (swords.length > resolved.swords) swords.pop().remove?.();
      while (swords.length < resolved.swords) {
        const sword = doc.createElement('span');
        sword.className = SWORD_CLASS;
        swords.push(sword);
        element.appendChild(sword);
      }
      filledCount = -1;
      countChanged = true;
    }
    if (filledCount !== resolved.filled) {
      const gained = !countChanged && resolved.filled > filledCount
        ? resolved.filled - filledCount
        : 0;
      swords.forEach((sword, index) => {
        sword.classList?.toggle?.(SWORD_FILLED_CLASS, index < resolved.filled);
      });
      if (gained > 0) glint(swords[resolved.filled - 1]);
      filledCount = resolved.filled;
    }
    return resolved;
  }

  // Spark at the sword that just filled. The screen-FX layer lives in main.js,
  // so it is reached through the same global handle the rest of the game uses;
  // on a page without it this is simply a no-op.
  function glint(sword) {
    playAtSword(sword, 'swordGain');
  }

  // The storm's receipt on the row: the rightmost `count` swords are about to
  // be taken off the level, so puff them out at their own positions before the
  // next update() removes the nodes. A hidden row (landscape) reports a 0x0
  // rect and stays silent, exactly like the glint.
  function shatter(count) {
    const removed = Math.min(toCount(count), swords.length);
    if (removed === 0) return 0;
    for (const sword of swords.slice(swords.length - removed)) {
      playAtSword(sword, 'swordLost');
    }
    return removed;
  }

  function playAtSword(sword, effect) {
    const fx = globalThis.ffmScreenFx;
    const rect = sword?.getBoundingClientRect?.();
    if (!fx || !rect) return;
    // The row only renders in portrait; landscape keeps it display:none, so a
    // sword there reports a 0x0 rect at the viewport origin and the world
    // conversion below would spray the effect into the top-left corner of the
    // screen.
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
    swords.length = 0;
    filledCount = 0;
  }

  return {
    get element() {
      return element;
    },
    swords,
    updateEncounterProgress,
    shatter,
    destroy,
  };
}
