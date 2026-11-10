// bubble-timer.js — App-only portrait answer bubble timer.
//
// main.js loads this module only behind `platform.isApp` (chained onto the
// mobile-ui.js/timer-bar.js/level-numerals.js imports), so the web build never
// imports it. The widget appends a decorative row of bubbles to #input-zone
// immediately before #mc-buttons and paints it from the published timer state
// (the same hook that drives the header bar), so it can never drift from the
// countdown. The bubbles are aria-hidden: the accessible header timer keeps
// announcing the remaining time.
//
//   const widget = createBubbleTimer({ doc: document });
//   mobileUi.registerWidget('bubble-timer', widget);
//   widget.updateTimerState({ remaining, max, untimed, paused });
//
// The module owns no clock. It never starts an interval, timeout or animation
// frame; the game loop publishes the timer state once per frame, and CSS owns
// the bounded, constant-size bubble animation.

import { resolveTimerBar, timerBarColor } from './timer-bar.js';

/** Fixed bubble budget: the widget never creates more than this many nodes. */
export const BUBBLE_COUNT = 10;

export const BUBBLE_TIMER_CLASS = 'app-answer-bubble-timer';
export const BUBBLE_CLASS = 'app-answer-bubble-timer-bubble';
export const BUBBLE_FILLED_CLASS = 'app-answer-bubble-timer-bubble--filled';
export const BUBBLE_TIMER_CONTAINER_ID = 'input-zone';
export const BUBBLE_TIMER_ANCHOR_ID = 'mc-buttons';
export const BUBBLE_TIMER_STATE_ATTRIBUTE = 'data-timer-state';
export const BUBBLE_TIMER_BACKGROUNDED_ATTRIBUTE = 'data-backgrounded';

/**
 * How many bubbles the ratio fills. Always an integer inside 0..BUBBLE_COUNT.
 * @param {unknown} ratio
 */
export function filledBubbleCount(ratio) {
  const value = Number(ratio);
  const clamped = Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
  return Math.round(clamped * BUBBLE_COUNT);
}

/**
 * Append the decorative bubble timer and return its widget.
 *
 * @param {object} [options]
 * @param {Document} [options.doc]
 * @param {string} [options.containerId]
 * @param {string} [options.anchorId]
 * @returns {{
 *   element: object|null,
 *   bubbles: object[],
 *   updateTimerState: (state?: object) => object|null,
 *   destroy: () => void,
 * }}
 */
export function createBubbleTimer({
  doc = globalThis.document,
  containerId = BUBBLE_TIMER_CONTAINER_ID,
  anchorId = BUBBLE_TIMER_ANCHOR_ID,
} = {}) {
  const container = doc?.getElementById?.(containerId) ?? null;
  const anchor = doc?.getElementById?.(anchorId) ?? null;
  const bubbles = [];
  let element = null;
  let lastColor = '';
  let lastFilled = -1;
  let backgrounded = false;

  if (container && anchor && typeof doc.createElement === 'function') {
    element = doc.createElement('div');
    element.className = BUBBLE_TIMER_CLASS;
    element.setAttribute('aria-hidden', 'true');
    // Nothing is drawn until the first published timer state arrives.
    element.hidden = true;
    for (let index = 0; index < BUBBLE_COUNT; index += 1) {
      const bubble = doc.createElement('span');
      bubble.className = BUBBLE_CLASS;
      bubble.style?.setProperty?.('--bubble-index', String(index));
      bubbles.push(bubble);
      element.appendChild(bubble);
    }
    if (typeof container.insertBefore === 'function') {
      container.insertBefore(element, anchor);
    } else {
      container.appendChild(element);
    }
  }

  function setBackgrounded(value) {
    backgrounded = value === true;
    if (!element) return;
    element.setAttribute(BUBBLE_TIMER_BACKGROUNDED_ATTRIBUTE, String(backgrounded));
  }

  const onVisibilityChange = () => {
    const hidden = doc?.visibilityState === 'hidden' || doc?.hidden === true;
    setBackgrounded(hidden);
  };

  if (element && typeof doc?.addEventListener === 'function') {
    doc.addEventListener('visibilitychange', onVisibilityChange);
    onVisibilityChange();
  }

  function updateTimerState(state = {}) {
    if (!element) return null;
    const resolved = resolveTimerBar(state);
    const stateName = resolved.untimed ? 'untimed' : resolved.paused ? 'paused' : 'running';
    element.hidden = resolved.untimed;
    if (element.getAttribute(BUBBLE_TIMER_STATE_ATTRIBUTE) !== stateName) {
      element.setAttribute(BUBBLE_TIMER_STATE_ATTRIBUTE, stateName);
    }
    const color = timerBarColor(resolved.ratio);
    if (color !== lastColor) {
      element.style?.setProperty?.('--bubble-color', color);
      lastColor = color;
    }
    const filled = filledBubbleCount(resolved.ratio);
    if (filled !== lastFilled) {
      bubbles.forEach((bubble, index) => {
        bubble.classList?.toggle?.(BUBBLE_FILLED_CLASS, index < filled);
      });
      lastFilled = filled;
    }
    return resolved;
  }

  function destroy() {
    if (typeof doc?.removeEventListener === 'function') {
      doc.removeEventListener('visibilitychange', onVisibilityChange);
    }
    if (element) element.remove?.();
    element = null;
    bubbles.length = 0;
    lastColor = '';
    lastFilled = -1;
  }

  return {
    get element() {
      return element;
    },
    bubbles,
    get backgrounded() {
      return backgrounded;
    },
    updateTimerState,
    destroy,
  };
}
