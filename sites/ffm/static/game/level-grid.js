// Scrollable grid of illuminated level numerals on the Levels title page,
// shared by the website and offline apps. It replaces the old start-level
// <select>: `value` keeps the same contract ('' = default start, otherwise the
// replayed level as a string).

import { buildLevelNumeralMarkup } from './level-numerals.js';

export const LEVEL_GRID_ID = 'level-jump-grid';
export const LEVEL_TILE_CLASS = 'level-tile';

/**
 * Describe every tile of the grid.
 *
 * The default start level gets the '' value so starting there keeps using the
 * regular continuation path; other available levels carry their own number and
 * everything else is locked.
 *
 * @param {{total: number, defaultLevel?: number, available?: number[]}} options
 * @returns {{level: number, value: string, state: 'default'|'available'|'locked'}[]}
 */
export function buildLevelGridEntries({ total, defaultLevel = 1, available = [] }) {
  const open = new Set(available.map(Number));
  const count = Math.max(Number(total) || 0, defaultLevel, ...open);
  return Array.from({ length: count }, (_, index) => {
    const level = index + 1;
    if (level === defaultLevel) return { level, value: '', state: 'default' };
    if (open.has(level)) return { level, value: String(level), state: 'available' };
    return { level, value: null, state: 'locked' };
  });
}

/**
 * Create the grid widget inside the existing `#level-jump-grid` element.
 *
 * @param {object} [options]
 * @param {Document} [options.doc]
 * @param {string} [options.gridId]
 * @param {(value: string) => void} [options.onSelect]
 */
export function createLevelGrid({ doc = globalThis.document, gridId = LEVEL_GRID_ID, onSelect = () => {} } = {}) {
  const element = doc?.getElementById?.(gridId) ?? null;
  let value = '';
  let entries = [];

  function syncPressed() {
    if (!element) return;
    for (const tile of element.querySelectorAll(`.${LEVEL_TILE_CLASS}`)) {
      tile.setAttribute('aria-pressed', String(tile.dataset.value === value));
    }
  }

  function render({ total, defaultLevel = 1, available = [], labelFor = entry => String(entry.level) }) {
    entries = buildLevelGridEntries({ total, defaultLevel, available });
    if (!entries.some(entry => entry.value === value)) value = '';
    if (!element) return entries;
    element.textContent = '';
    for (const entry of entries) {
      const tile = doc.createElement('button');
      tile.type = 'button';
      tile.className = LEVEL_TILE_CLASS;
      tile.dataset.state = entry.state;
      tile.dataset.level = String(entry.level);
      tile.setAttribute('aria-label', labelFor(entry));
      tile.innerHTML = buildLevelNumeralMarkup(entry.level);
      if (entry.value === null) {
        tile.disabled = true;
      } else {
        tile.dataset.value = entry.value;
        tile.addEventListener('click', () => {
          value = entry.value;
          syncPressed();
          onSelect(value);
        });
      }
      element.appendChild(tile);
    }
    syncPressed();
    return entries;
  }

  return {
    element,
    render,
    get entries() {
      return entries;
    },
    get value() {
      return value;
    },
    set value(next) {
      const candidate = next == null ? '' : String(next);
      value = entries.some(entry => entry.value === candidate) ? candidate : '';
      syncPressed();
    },
  };
}
