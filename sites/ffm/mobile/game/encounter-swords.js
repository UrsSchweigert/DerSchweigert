// encounter-swords.js — App-only portrait encounter progress row.
//
// main.js loads this module only behind `platform.isApp` (chained onto the
// mobile-ui.js/timer-bar.js imports), so the web build never imports it. The
// widget inserts a decorative row of little swords into #input-zone directly
// above #mc-buttons: one sword per enemy in the level, filled green from left
// to right as enemies are beaten. It renders the same defeated/total count the
// header's "Defeated" readout announces, so it is aria-hidden.
//
//   const widget = createEncounterSwords({ doc: document });
//   mobileUi.registerWidget('encounter-swords', widget);
//   widget.updateEncounterProgress({ defeated, total });
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
    if (swords.length !== resolved.swords) {
      while (swords.length > resolved.swords) swords.pop().remove?.();
      while (swords.length < resolved.swords) {
        const sword = doc.createElement('span');
        sword.className = SWORD_CLASS;
        swords.push(sword);
        element.appendChild(sword);
      }
      filledCount = -1;
    }
    if (filledCount !== resolved.filled) {
      swords.forEach((sword, index) => {
        sword.classList?.toggle?.(SWORD_FILLED_CLASS, index < resolved.filled);
      });
      filledCount = resolved.filled;
    }
    return resolved;
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
    destroy,
  };
}
