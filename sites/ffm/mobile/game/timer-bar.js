// timer-bar.js — App-only question timer bar for the mobile header row.
//
// main.js loads this module only behind `platform.isApp` (chained onto the
// mobile-ui.js import), so the web build never imports it and keeps the
// banded colours painted by renderer.drawTimerBar(). The widget appends a
// decorative bar to #gameplay-chrome, vertically centred in its header row,
// and paints it from a continuous green -> yellow -> red interpolation of the
// remaining-time ratio. The bar is aria-hidden: the existing accessible timer
// text and <progress> element in the header keep announcing the countdown.
//
//   const widget = createTimerBar({ doc: document });
//   mobileUi.registerWidget('timer-bar', widget);
//   widget.updateTimerState({ remaining, max, untimed, paused });

/** Green at a full timer (#40e840). */
export const TIMER_GREEN_RGB = Object.freeze([0x40, 0xe8, 0x40]);
/** Yellow at half the timer (#e8c040). */
export const TIMER_YELLOW_RGB = Object.freeze([0xe8, 0xc0, 0x40]);
/** Red at an empty timer (#e84040). */
export const TIMER_RED_RGB = Object.freeze([0xe8, 0x40, 0x40]);
/** Neutral fill for modes without a countdown. */
export const TIMER_UNTIMED_COLOR = 'rgb(111, 127, 159)';

export const TIMER_BAR_CLASS = 'app-header-timer';
export const TIMER_FILL_CLASS = 'app-header-timer-fill';
export const TIMER_UNTIMED_CLASS = 'app-header-timer--untimed';
export const TIMER_PAUSED_CLASS = 'app-header-timer--paused';
export const TIMER_STATE_ATTRIBUTE = 'data-timer-state';

/** Clamp any input to a usable 0..1 ratio (non-numbers become 0). */
export function clampTimerRatio(ratio) {
  const value = Number(ratio);
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function mix(from, to, t) {
  return from.map((channel, index) => Math.round(channel + (to[index] - channel) * t));
}

/**
 * Continuous timer colour as an [r, g, b] triple.
 *
 * ratio 1 -> 0.5 walks green -> yellow, ratio 0.5 -> 0 walks yellow -> red.
 * Both halves meet exactly at the yellow midpoint, so the hue moves
 * monotonically from 120° to 0° with no band jump.
 */
export function timerBarRgb(ratio) {
  const clamped = clampTimerRatio(ratio);
  if (clamped >= 0.5) return mix(TIMER_GREEN_RGB, TIMER_YELLOW_RGB, (1 - clamped) / 0.5);
  return mix(TIMER_YELLOW_RGB, TIMER_RED_RGB, 1 - clamped / 0.5);
}

/** Continuous timer colour as a CSS `rgb()` string. */
export function timerBarColor(ratio) {
  return `rgb(${timerBarRgb(ratio).join(', ')})`;
}

/**
 * Resolve the widget state without touching the DOM.
 *
 * `untimed` is explicit for timerMax <= 0 or when the caller already knows the
 * mode has no countdown, so an untimed bar never masquerades as full or empty.
 * @param {{remaining?: number, max?: number, untimed?: boolean, paused?: boolean}} [state]
 */
export function resolveTimerBar({ remaining = 0, max = 0, untimed = false, paused = false } = {}) {
  const maxValue = Number(max);
  const isUntimed = untimed === true || !(maxValue > 0);
  return {
    ratio: isUntimed ? 1 : clampTimerRatio(Number(remaining) / maxValue),
    untimed: isUntimed,
    paused: paused === true,
  };
}

/**
 * Append the decorative header timer bar and return its widget.
 *
 * @param {object} [options]
 * @param {Document} [options.doc]
 * @param {string} [options.containerId]
 * @returns {{element: object|null, fill: object|null, updateTimerState: (state?: object) => object|null}}
 */
export function createTimerBar({ doc = globalThis.document, containerId = 'gameplay-chrome' } = {}) {
  const container = doc?.getElementById?.(containerId) ?? null;
  let element = null;
  let fill = null;

  if (container && typeof doc.createElement === 'function') {
    element = doc.createElement('div');
    element.className = TIMER_BAR_CLASS;
    element.setAttribute('aria-hidden', 'true');
    fill = doc.createElement('div');
    fill.className = TIMER_FILL_CLASS;
    element.appendChild(fill);
    container.appendChild(element);
  }

  function updateTimerState(state = {}) {
    if (!element || !fill) return null;
    const resolved = resolveTimerBar(state);
    const stateName = resolved.untimed ? 'untimed' : resolved.paused ? 'paused' : 'running';
    element.classList.toggle(TIMER_UNTIMED_CLASS, resolved.untimed);
    element.classList.toggle(TIMER_PAUSED_CLASS, resolved.paused);
    if (element.getAttribute(TIMER_STATE_ATTRIBUTE) !== stateName) {
      element.setAttribute(TIMER_STATE_ATTRIBUTE, stateName);
    }
    // scaleX, not width: the loop publishes a fresh ratio every frame, so a
    // width write put the bar on the layout path 60 times a second and a width
    // transition could never settle. A transform is composited instead.
    fill.style.transform = `scaleX(${Math.round(resolved.ratio * 1000) / 1000})`;
    fill.style.backgroundColor = resolved.untimed
      ? TIMER_UNTIMED_COLOR
      : timerBarColor(resolved.ratio);
    return resolved;
  }

  return { element, fill, updateTimerState };
}
