// level-numerals.js — App-only decorative level numerals for the title screen.
//
// main.js loads this module only behind `platform.isApp` (chained onto the
// mobile-ui.js/timer-bar.js imports), so the web build never imports it. The
// widget appends a role="img" element to #difficulty-select and paints the
// active starting/continuation level as old-book numerals in the empty
// upper-left title space. The numerals are visual only; the element carries a
// localized aria-label from the shared i18n dictionary so assistive
// technology still hears the level.
//
//   const widget = createLevelNumerals({ doc: document, translate: t });
//   mobileUi.registerWidget('level-numerals', widget);
//   mobileUi.updateLevelSelection({ level: 5, mode: 'continuation' });

export const LEVEL_NUMERALS_CLASS = 'title-level-numerals';
export const LEVEL_NUMERALS_CONTAINER_ID = 'difficulty-select';
export const LEVEL_NUMERALS_MODE_ATTRIBUTE = 'data-level-mode';
export const LEVEL_NUMERALS_LABEL_KEY = 'title.levelNumerals';

/**
 * Resolve a level-selection payload into the numeral to draw.
 *
 * Accepts the mobile-ui hook shape `{ level, mode }` and returns
 * `{ level, mode }` for a usable curriculum level, or null when nothing
 * should be drawn. `mode` is `replay` for a cleared-level replay selection
 * and `continuation` otherwise; an unknown mode falls back to continuation.
 *
 * @param {{level?: unknown, mode?: unknown}} [selection]
 * @returns {{level: number, mode: 'replay'|'continuation'}|null}
 */
export function resolveLevelSelection(selection) {
  if (!selection || typeof selection !== 'object') return null;
  const level = Number(selection.level);
  if (!Number.isInteger(level) || level < 1) return null;
  return { level, mode: selection.mode === 'replay' ? 'replay' : 'continuation' };
}

/**
 * Append the decorative level numerals and return their widget.
 *
 * @param {object} [options]
 * @param {Document} [options.doc]
 * @param {string} [options.containerId]
 * @param {(key: string, vars?: object) => string} [options.translate]
 * @returns {{
 *   element: object|null,
 *   updateLevelSelection: (selection?: object) => object|null,
 *   get selection(): object|null,
 * }}
 */
export function createLevelNumerals({
  doc = globalThis.document,
  containerId = LEVEL_NUMERALS_CONTAINER_ID,
  translate = () => '',
} = {}) {
  const container = doc?.getElementById?.(containerId) ?? null;
  let element = null;
  let current = null;

  if (container && typeof doc.createElement === 'function') {
    element = doc.createElement('div');
    element.className = LEVEL_NUMERALS_CLASS;
    element.setAttribute('role', 'img');
    element.hidden = true;
    container.appendChild(element);
  }

  function updateLevelSelection(selection) {
    const resolved = resolveLevelSelection(selection);
    current = resolved;
    if (!element) return resolved;
    if (!resolved) {
      element.textContent = '';
      element.hidden = true;
      element.removeAttribute('aria-label');
      element.removeAttribute(LEVEL_NUMERALS_MODE_ATTRIBUTE);
      return null;
    }
    element.textContent = String(resolved.level);
    element.setAttribute('aria-label', translate(LEVEL_NUMERALS_LABEL_KEY, { level: resolved.level }));
    element.setAttribute(LEVEL_NUMERALS_MODE_ATTRIBUTE, resolved.mode);
    element.hidden = false;
    return resolved;
  }

  return {
    element,
    updateLevelSelection,
    get selection() {
      return current;
    },
  };
}
