// shapes-header.js — App-only two-row Shapes question header.
//
// main.js loads this module only behind `platform.isApp` (chained onto the
// mobile-ui.js/timer-bar.js/level-numerals.js/bubble-timer.js imports), so the
// web build never imports it and keeps the single-line shapes prompt painted
// by gameplay-chrome.js.
//
// The widget takes over #active-question while a Shapes problem is active and
// renders it as exactly two deliberate rows: the localized instruction
// ("Count the shapes" / "Zähle die Formen") and one unbroken row holding every
// shape. The shape row is `white-space: nowrap`, and its font size is scaled
// from the measured header width, so counts 1-10 never wrap between shapes,
// never clip and never lose a shape at 320px portrait or landscape. It changes
// no gameplay, scoring or problem generation: the count comes straight from the
// published problem.
//
//   const header = createShapesHeader({ doc: document });
//   chrome.setShapesHeader(header);
//   header.render({ problem, instruction: t('hud.countShapes') });

export const SHAPES_HEADER_TARGET_ID = 'active-question';
export const SHAPES_HEADER_ATTRIBUTE = 'data-shapes-header';
export const SHAPES_HEADER_ATTRIBUTE_VALUE = 'two-rows';
export const SHAPES_INSTRUCTION_CLASS = 'app-shapes-header-instruction';
export const SHAPES_ROW_CLASS = 'app-shapes-header-shapes';
export const SHAPES_ROW_KIND_ATTRIBUTE = 'data-row';

/** Exactly two rows: instruction + shapes. */
export const SHAPES_HEADER_ROW_COUNT = 2;
/** Matches the web header's `font: bold 22px/28px monospace`. */
export const SHAPES_HEADER_BASE_FONT_SIZE = 22;
/** Compact two-row line height, inside the 56px two-line wrap budget. */
export const SHAPES_HEADER_LINE_HEIGHT_RATIO = 26 / 22;
/** Lower bound before a row is allowed to report `fits: false`. */
export const SHAPES_HEADER_MIN_FONT_SIZE = 8;
/** Conservative monospace advance per em; 0.6 is typical, 0.65 leaves slack. */
export const SHAPES_HEADER_GLYPH_RATIO = 0.65;
export const SHAPES_HEADER_MIN_COUNT = 1;
export const SHAPES_HEADER_MAX_COUNT = 10;

export const SHAPE_SYMBOLS = Object.freeze({
  square: '■',
  circle: '●',
  triangle: '▲',
});
export const DEFAULT_SHAPE_SYMBOL = '■';

/**
 * Usable header widths at the smallest supported viewports. The portrait value
 * is 320px minus the header's 8px side padding; landscape is 568px minus that
 * padding, the 68px pause button and its 8px column gap.
 */
export const SHAPES_HEADER_WIDTHS = Object.freeze({
  portrait: 304,
  landscape: 476,
});

/** The glyph for a problem's shape type; unknown types fall back to a square. */
export function shapeSymbol(shapeType) {
  return SHAPE_SYMBOLS[shapeType] ?? DEFAULT_SHAPE_SYMBOL;
}

/** Clamp any input to an integer shape count in 0..10 (non-numbers become 0). */
export function normalizeShapeCount(count) {
  const value = Math.floor(Number(count));
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(SHAPES_HEADER_MAX_COUNT, value));
}

function positive(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

/**
 * Lay out the two header rows without touching the DOM.
 *
 * Both rows are always present and are always one line: the shape row joins
 * `count` glyphs with single spaces (2*count-1 characters), and a row whose
 * text would exceed `maxWidth` gets a smaller font size instead of wrapping.
 * `fits` is false only when even the minimum font size cannot fit, which the
 * supported 320px+ headers never hit.
 *
 * @param {object} [options]
 * @param {number} [options.count] problem count (clamped to 0..10)
 * @param {string} [options.shapeType] square | circle | triangle
 * @param {string} [options.instruction] localized instruction text
 * @param {number} [options.maxWidth] measured header width in px (0 = unknown)
 * @param {number} [options.baseFontSize]
 * @param {number} [options.minFontSize]
 * @param {number} [options.glyphRatio]
 * @param {number} [options.lineHeightRatio]
 */
export function layoutShapesHeader({
  count,
  shapeType = 'square',
  instruction = '',
  maxWidth = 0,
  baseFontSize = SHAPES_HEADER_BASE_FONT_SIZE,
  minFontSize = SHAPES_HEADER_MIN_FONT_SIZE,
  glyphRatio = SHAPES_HEADER_GLYPH_RATIO,
  lineHeightRatio = SHAPES_HEADER_LINE_HEIGHT_RATIO,
} = {}) {
  const shapeCount = normalizeShapeCount(count);
  const symbol = shapeSymbol(shapeType);
  const shapeText = Array.from({ length: shapeCount }, () => symbol).join(' ');
  const label = String(instruction ?? '').trim();
  const instructionText = label ? `${label}:` : '';
  const width = positive(maxWidth, 0);
  const base = positive(baseFontSize, SHAPES_HEADER_BASE_FONT_SIZE);
  const floor = Math.min(positive(minFontSize, 0), base);
  const advance = positive(glyphRatio, SHAPES_HEADER_GLYPH_RATIO);
  const lineRatio = positive(lineHeightRatio, SHAPES_HEADER_LINE_HEIGHT_RATIO);

  const scale = (text) => {
    if (width <= 0) return base;
    const characters = Math.max(1, text.length);
    return Math.min(base, Math.max(floor, width / (characters * advance)));
  };

  const row = (kind, text, fontSize, extra = {}) => ({
    kind,
    text,
    characters: text.length,
    fontSize,
    lineHeight: fontSize * lineRatio,
    whiteSpace: 'nowrap',
    wrap: false,
    ...extra,
  });

  const instructionFontSize = scale(instructionText);
  const shapeFontSize = scale(shapeText);
  const rows = [
    row('instruction', instructionText, instructionFontSize),
    row('shapes', shapeText, shapeFontSize, {
      count: shapeCount,
      shapeType,
      symbol,
    }),
  ];
  const requiredWidth = Math.max(...rows.map(({ characters, fontSize }) => characters * fontSize * advance));
  return {
    rows,
    rowCount: rows.length,
    shapeRows: 1,
    shapeCount,
    shapeType,
    symbol,
    instruction: instructionText,
    shapeText,
    maxWidth: width,
    width: requiredWidth,
    fits: width <= 0 || requiredWidth <= width + 0.5,
  };
}

function measure(element) {
  if (!element) return 0;
  const client = Number(element.clientWidth);
  if (Number.isFinite(client) && client > 0) return client;
  const rect = element.getBoundingClientRect?.();
  const rectWidth = Number(rect?.width);
  return Number.isFinite(rectWidth) && rectWidth > 0 ? rectWidth : 0;
}

/**
 * Create the two-row Shapes header renderer.
 *
 * @param {object} [options]
 * @param {Document} [options.doc]
 * @param {string} [options.targetId]
 * @param {number} [options.baseFontSize]
 * @param {number} [options.minFontSize]
 * @param {number} [options.glyphRatio]
 * @returns {{
 *   element: object|null,
 *   render: (input?: object) => object|null,
 *   clear: () => void,
 *   destroy: () => void,
 * }}
 */
export function createShapesHeader({
  doc = globalThis.document,
  targetId = SHAPES_HEADER_TARGET_ID,
  baseFontSize = SHAPES_HEADER_BASE_FONT_SIZE,
  minFontSize = SHAPES_HEADER_MIN_FONT_SIZE,
  glyphRatio = SHAPES_HEADER_GLYPH_RATIO,
} = {}) {
  const target = doc?.getElementById?.(targetId) ?? null;
  let mounted = null;
  let rows = [];
  let signature = '';

  function applyRow(row, spec) {
    if (row.textContent !== spec.text) row.textContent = spec.text;
    row.style.fontSize = `${spec.fontSize}px`;
    row.style.lineHeight = `${spec.lineHeight}px`;
    row.setAttribute?.(SHAPES_ROW_KIND_ATTRIBUTE, spec.kind);
  }

  function ensureRows(element) {
    if (rows.length === SHAPES_HEADER_ROW_COUNT && rows.every((row) => row.parentNode === element)) {
      return false;
    }
    if (typeof doc?.createElement !== 'function') return false;
    // Replace any plain single-line prompt the shared chrome wrote before this
    // app-only renderer was wired, so the header is exactly two rows.
    element.textContent = '';
    rows = [doc.createElement('span'), doc.createElement('span')];
    rows[0].className = SHAPES_INSTRUCTION_CLASS;
    rows[1].className = SHAPES_ROW_CLASS;
    for (const row of rows) element.appendChild(row);
    return true;
  }

  function render({ element = target, problem = {}, instruction = '' } = {}) {
    if (!element) return null;
    const width = measure(element);
    const layout = layoutShapesHeader({
      count: problem?.count,
      shapeType: problem?.shapeType,
      instruction,
      maxWidth: width,
      baseFontSize,
      minFontSize,
      glyphRatio,
    });
    const rebuilt = ensureRows(element);
    if (rows.length !== SHAPES_HEADER_ROW_COUNT) return layout;
    mounted = element;
    element.setAttribute?.(SHAPES_HEADER_ATTRIBUTE, SHAPES_HEADER_ATTRIBUTE_VALUE);
    const nextSignature = `${layout.shapeType}|${layout.shapeCount}|${layout.instruction}|${
      layout.rows.map((row) => row.fontSize.toFixed(2)).join(',')}`;
    if (rebuilt || nextSignature !== signature) {
      applyRow(rows[0], layout.rows[0]);
      applyRow(rows[1], layout.rows[1]);
      signature = nextSignature;
    }
    return layout;
  }

  function clear() {
    for (const row of rows) row.remove?.();
    rows = [];
    signature = '';
    if (mounted?.removeAttribute) mounted.removeAttribute(SHAPES_HEADER_ATTRIBUTE);
    mounted = null;
  }

  function destroy() {
    clear();
  }

  return {
    get element() {
      return target;
    },
    get rows() {
      return rows;
    },
    render,
    clear,
    destroy,
  };
}
