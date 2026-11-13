// Layout only: resizing never changes the logical canvas or gameplay state.
const RATIO = 800 / 450;
const TARGET = 44;
const GAP = 6;
const PADDING = 8;
// The ability bar always shows three circles, and in landscape it lives in the
// answer column above the answers. Their row is therefore a floor on that
// column's width: below it the orbs shrink to a few pixels and vanish.
const ORB_COLUMNS = 3;

/**
 * The narrowest a landscape answer column may be. The answer grid always fits;
 * the row of ability circles above it is what may give way, and only on a window
 * too small for both — there it may claim at most 45% of the width, so the scene
 * above still has something to render.
 *
 * @param {number} width - available width in CSS pixels.
 * @param {number} columns - answer grid columns.
 * @param {number} targetWidth - one answer's minimum readable width.
 * @returns {number} the reserved answer width in CSS pixels.
 */
export function landscapeAnswerFloor(width, columns, targetWidth) {
  const gridWidth = columns * targetWidth + (columns - 1) * GAP + 2 * PADDING;
  const orbRowWidth = ORB_COLUMNS * targetWidth + (ORB_COLUMNS - 1) * GAP + 2 * PADDING;
  const usable = Math.max(0, Number(width) || 0);
  return Math.min(Math.max(gridWidth, orbRowWidth), Math.max(gridWidth, usable * 0.45));
}

// reservedHeight is the space the answer zone spends on rows that are not the
// answer grid (today: the ability circles and their caption line), so the grid
// is sized from what is actually left for it.
export function calculateSceneLayout(width, height, optionCount = 10, landscape = width >= height, minimumAnswerWidth = TARGET, reservedHeight = 0) {
  width = Math.max(0, Number(width) || 0);
  height = Math.max(0, Number(height) || 0);
  const count = Math.max(1, Math.floor(Number(optionCount) || 1));
  const targetWidth = Math.max(TARGET, Number(minimumAnswerWidth) || TARGET);
  const reserved = Math.min(height, Math.max(0, Number(reservedHeight) || 0));
  const answerBudget = Math.max(0, height - reserved);
  let columns;
  let rows;
  let sceneWidth;
  let sceneHeight;
  // The answer column has to hold whichever of the two is wider: the answer grid
  // itself, or the row of ability circles above it. Reserving both before the
  // scene is sized is what keeps the circles visible — sizing the scene first and
  // clamping the answers to what was left used to shrink them to ~6px.
  let reservedAnswerWidth = 0;
  if (landscape) {
    const availableRows = Math.max(1, Math.floor((answerBudget - 2 * PADDING + GAP) / (TARGET + GAP)));
    // A compact three-column grid preserves a playable scene below a readable HUD.
    columns = Math.ceil(count / Math.min(5, availableRows));
    rows = Math.ceil(count / columns);
    reservedAnswerWidth = landscapeAnswerFloor(width, columns, targetWidth);
    sceneWidth = Math.max(0, Math.min(width - reservedAnswerWidth - GAP, height * RATIO));
    sceneHeight = sceneWidth / RATIO;
  } else {
    const availableColumns = Math.max(1, Math.floor((width - 2 * PADDING + GAP) / (targetWidth + GAP)));
    columns = count === 10 ? (availableColumns >= 5 ? 5 : 2)
      : count === 5 ? (availableColumns >= 5 ? 5 : 1) : Math.min(count, availableColumns);
    rows = Math.ceil(count / columns);
    const answerHeight = rows * TARGET + (rows - 1) * GAP + 2 * PADDING;
    sceneHeight = Math.max(0, Math.min(answerBudget - answerHeight - GAP, width / RATIO));
    sceneWidth = sceneHeight * RATIO;
  }
  return {
    landscape, columns, rows, sceneWidth, sceneHeight, minimumAnswerWidth: targetWidth,
    answerWidth: landscape
      // Never below the reserved floor, never past the space the scene left; the
      // 320px comfort width only widens a column that already has the room.
      ? Math.max(reservedAnswerWidth, Math.min(width - sceneWidth - GAP, Math.max(320, reservedAnswerWidth)))
      : width,
    answerHeight: landscape ? answerBudget : height - sceneHeight - GAP,
  };
}

export function initViewportLayout({ win = globalThis.window, doc = globalThis.document } = {}) {
  const root = doc?.documentElement;
  const wrap = doc?.getElementById('game-wrap');
  const options = doc?.getElementById('mc-buttons');
  const chrome = doc?.getElementById('gameplay-chrome');
  const abilityBar = doc?.getElementById?.('ability-bar');
  if (!win || !root || !wrap) return { refresh() {}, destroy() {} };
  let destroyed = false;
  let frame = null;
  const viewport = win.visualViewport;
  const measuringContext = doc.createElement?.('canvas').getContext?.('2d');
  function labelWidth() {
    let minimum = TARGET;
    for (const button of options?.children ?? []) {
      if (button.hidden) continue;
      const css = win.getComputedStyle?.(button);
      if (!css) continue;
      const fontSize = parseFloat(css.fontSize) || 14;
      const text = button.textContent ?? '';
      if (measuringContext) measuringContext.font = css.font || `${fontSize}px ${css.fontFamily}`;
      const measuredTextWidth = measuringContext?.measureText(text).width ?? text.length * fontSize;
      const letterSpacing = parseFloat(css.letterSpacing) || 0;
      const textWidth = measuredTextWidth + Math.max(0, text.length - 1) * letterSpacing;
      const decoration = ['paddingLeft', 'paddingRight', 'borderLeftWidth', 'borderRightWidth']
        .reduce((total, property) => total + (parseFloat(css[property]) || 0), 0);
      minimum = Math.max(minimum, Math.ceil(textWidth + decoration + 2));
    }
    return minimum;
  }
  function refresh() {
    if (destroyed) return;
    const width = viewport?.width ?? win.innerWidth;
    const height = viewport?.height ?? win.innerHeight;
    root.style.setProperty('--viewport-width', `${width}px`);
    root.style.setProperty('--viewport-height', `${height}px`);
    root.style.setProperty('--viewport-left', `${viewport?.offsetLeft ?? 0}px`);
    root.style.setProperty('--viewport-top', `${viewport?.offsetTop ?? 0}px`);
    root.dataset.viewportCompact = String(height <= 400);
    root.dataset.viewportKeyboard = String(height < win.innerHeight - 80);
    const count = Number(options?.dataset.optionCount)
      || [...(options?.children ?? [])].filter((el) => !el.hidden).length || 1;
    const minimumAnswerWidth = labelWidth();
    const chromeHeight = chrome && !chrome.hidden ? (chrome.offsetHeight || 0) + GAP : 0;
    const abilityRow = abilityBar?.offsetHeight ? abilityBar.offsetHeight + GAP : 0;
    const layout = calculateSceneLayout(wrap.clientWidth, Math.max(0, wrap.clientHeight - chromeHeight), count,
      win.innerWidth >= win.innerHeight, minimumAnswerWidth, abilityRow);
    wrap.dataset.layout = layout.landscape ? 'landscape' : 'portrait';
    wrap.style.setProperty('--scene-width', `${layout.sceneWidth}px`);
    wrap.style.setProperty('--scene-height', `${layout.sceneHeight}px`);
    wrap.style.setProperty('--answer-columns', layout.columns);
    wrap.style.setProperty('--answer-rows', layout.rows);
    wrap.style.setProperty('--answer-min-width', `${minimumAnswerWidth}px`);
    wrap.style.setProperty('--answer-width', `${layout.answerWidth}px`);
    wrap.style.setProperty('--answer-portrait-width', `${Math.max(620, layout.columns * minimumAnswerWidth + (layout.columns - 1) * GAP + 2 * PADDING)}px`);
  }
  function schedule() {
    if (destroyed || frame !== null) return;
    frame = win.requestAnimationFrame(() => {
      frame = null;
      refresh();
    });
  }
  const resizeObserver = win.ResizeObserver ? new win.ResizeObserver(schedule) : null;
  resizeObserver?.observe(wrap);
  if (chrome) resizeObserver?.observe(chrome);
  if (abilityBar) resizeObserver?.observe(abilityBar);
  const mutationObserver = win.MutationObserver ? new win.MutationObserver(schedule) : null;
  if (options) mutationObserver?.observe(options, {
    childList: true, characterData: true, attributes: true,
    attributeFilter: ['data-option-count', 'hidden'], subtree: true,
  });
  win.addEventListener('resize', schedule);
  viewport?.addEventListener('resize', schedule);
  viewport?.addEventListener('scroll', schedule);
  refresh();
  return {
    refresh,
    destroy() {
      destroyed = true;
      if (frame !== null) win.cancelAnimationFrame(frame);
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
      win.removeEventListener('resize', schedule);
      viewport?.removeEventListener('resize', schedule);
      viewport?.removeEventListener('scroll', schedule);
    },
  };
}
