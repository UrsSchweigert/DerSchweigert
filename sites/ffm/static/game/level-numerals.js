// Hand-drawn illuminated numerals, shared by the website and offline apps.

export const LEVEL_NUMERALS_CLASS = 'title-level-numerals';
export const LEVEL_NUMERALS_CONTAINER_ID = 'difficulty-select';
export const LEVEL_NUMERALS_MODE_ATTRIBUTE = 'data-level-mode';
export const LEVEL_NUMERALS_LABEL_KEY = 'title.levelNumerals';

const DIGITS = Object.freeze([
  'M12 5 C2 5 2 17 2 26 S2 47 12 47 S22 35 22 26 S22 5 12 5 Z M5 41 L19 11',
  'M5 13 Q13 12 15 5 L15 46 M6 46 L23 46 M11 7 L18 7',
  'M3 15 C3 1 24 1 23 15 C22 25 7 28 3 46 L23 46 L24 39',
  'M3 9 Q14 1 22 9 C29 19 14 25 10 25 C28 22 30 47 13 47 Q5 47 2 40',
  'M19 46 L19 5 L2 32 L26 32 M12 46 L25 46',
  'M24 6 L5 6 L3 25 C29 14 31 48 13 47 Q5 47 2 41 M6 3 L6 9',
  'M23 7 C5 -1 0 26 3 39 C7 53 27 47 24 33 C22 20 7 22 3 32',
  'M2 13 L3 6 L25 6 C17 19 9 31 9 47 M5 27 L22 27',
  'M13 25 C-6 15 5 -1 19 7 C31 17 13 25 13 25 C-9 33 4 54 21 45 C35 34 13 25 13 25 Z',
  'M23 24 C19 33 3 30 3 16 C3 0 25 0 25 18 C27 34 18 54 4 44',
]);

export function buildLevelNumeralMarkup(level) {
  const resolved = resolveLevelSelection({ level });
  if (!resolved) throw new RangeError('A positive level is required');
  const digits = String(resolved.level);
  const width = digits.length * 30 + 22;
  const glyphs = [...digits].map((digit, index) =>
    `<path transform="translate(${11 + index * 30} 18)" d="${DIGITS[Number(digit)]}"/>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} 86" aria-hidden="true" focusable="false">
    <path d="M4 17 Q4 4 17 4 H${width - 17} Q${width - 4} 4 ${width - 4} 17 V69 Q${width - 4} 82 ${width - 17} 82 H17 Q4 82 4 69 Z" fill="#10271e" stroke="#a77a34" stroke-width="2"/>
    <g fill="none" stroke="#e4c577" stroke-width="1">
      <path d="M7 25 Q18 16 7 9 Q23 8 25 16 M${width - 7} 25 Q${width - 18} 16 ${width - 7} 9 Q${width - 23} 8 ${width - 25} 16 M7 61 Q18 70 7 77 Q23 78 25 70 M${width - 7} 61 Q${width - 18} 70 ${width - 7} 77 Q${width - 23} 78 ${width - 25} 70"/>
    </g>
    <g fill="none" stroke="#070e0b" stroke-width="7" stroke-linecap="square" stroke-linejoin="round">${glyphs}</g>
    <g fill="none" stroke="#e4c577" stroke-width="4" stroke-linecap="square" stroke-linejoin="round">${glyphs}</g>
    <path d="M${width / 2} 7 l3 4 -3 4 -3 -4 Z M${width / 2} 72 l3 4 -3 4 -3 -4 Z" fill="#e4c577"/>
  </svg>`;
}

/**
 * Resolve a level-selection payload into the numeral to draw.
 *
 * Accepts `{ level, mode }` and returns
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
  if (!Number.isSafeInteger(level) || level < 1) return null;
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
      element.innerHTML = '';
      element.hidden = true;
      element.removeAttribute('aria-label');
      element.removeAttribute(LEVEL_NUMERALS_MODE_ATTRIBUTE);
      return null;
    }
    element.innerHTML = buildLevelNumeralMarkup(resolved.level);
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
