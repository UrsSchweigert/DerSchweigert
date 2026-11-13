// speedrun-ui.js — the two places a speedrun touches the screen.
//
//   * The run clock is opt-in and lives in the HUD readouts: it appears only
//     while the player turned the timer on *and* a run is actually going.
//   * The records are hidden: three taps on the title's level number open a
//     card with the best time per level and the best finished run, which is
//     also where the timer is turned on.
//
// Nothing here decides when time passes — see speedrun.js for the run itself.

import { formatRunClock, formatRunTime } from './speedrun.js';

const TAP_WINDOW_MS = 700;
const TAPS_TO_OPEN = 3;
// The level number the title screen shows: the "Starting level N" line, the
// illuminated numeral above it, and — on the roomier layouts only — the intro
// sentence that used to be the sole target.
const TAP_TARGET_SELECTOR = '#continue-level, .title-level-numerals, .splash-intro';

/**
 * @param {object} options
 * @param {Document} [options.doc] - document to wire up.
 * @param {(key: string, vars?: object) => string} [options.translate]
 * @param {object} options.records - the store from createSpeedrunRecords().
 * @param {(enabled: boolean) => void} [options.onEnabledChange] - fired when
 *   the hidden card flips the timer on or off.
 * @param {() => number} [options.now] - timestamp source for the tap detector.
 * @returns {object} UI controller
 */
export function createSpeedrunUi({ doc = globalThis.document, translate, records, onEnabledChange, now } = {}) {
  if (!records) throw new TypeError('createSpeedrunUi needs the speedrun records');
  const element = id => doc?.getElementById(id) ?? null;
  const overlay = element('speedrun-overlay');
  const toggle = element('speedrun-toggle');
  const bestRunLine = element('speedrun-best-run');
  const levelList = element('speedrun-levels');
  const emptyLine = element('speedrun-empty');
  const closeButton = element('speedrun-close');
  const clockWrap = element('speedrun-readout-wrap');
  const clock = element('speedrun-readout');
  const stamp = now ?? (() => (globalThis.performance?.now?.() ?? Date.now()));
  let taps = [];
  let lastClockText = null;

  const message = (key, fallback, vars) => {
    const translated = translate?.(key, vars);
    if (typeof translated === 'string' && translated && translated !== key) return translated;
    if (!vars) return fallback;
    return String(fallback).replace(/\{(\w+)\}/g, (match, name) => (
      Object.hasOwn(vars, name) ? String(vars[name]) : match
    ));
  };

  function render() {
    if (toggle) toggle.checked = records.enabled;
    const best = records.bestRun;
    if (bestRunLine) {
      bestRunLine.textContent = best
        ? message('speedrun.bestRun', 'Best run: {time}', { time: formatRunTime(best.totalMs) })
        : message('speedrun.noRun', 'No finished run yet — finish all 60 levels in one go.');
    }
    const bests = records.levelBests();
    if (emptyLine) emptyLine.hidden = bests.length > 0;
    if (!levelList) return;
    levelList.textContent = '';
    for (const { level, ms } of bests) {
      const row = doc.createElement('li');
      const label = doc.createElement('span');
      label.textContent = message('levels.level', 'Level {level}', { level });
      const time = doc.createElement('strong');
      time.textContent = formatRunTime(ms);
      row.append(label, time);
      levelList.append(row);
    }
  }

  function open() {
    render();
    if (!overlay) return false;
    overlay.hidden = false;
    overlay.style.display = 'flex';
    closeButton?.focus?.({ preventScroll: true });
    return true;
  }

  function close() {
    if (!overlay) return false;
    overlay.hidden = true;
    overlay.style.display = 'none';
    return true;
  }

  function isOpen() {
    return Boolean(overlay) && overlay.hidden !== true;
  }

  function setEnabled(enabled) {
    const next = records.setEnabled(enabled);
    if (toggle) toggle.checked = next;
    if (!next) hideClock();
    onEnabledChange?.(next);
    return next;
  }

  // Three taps inside one window, and not three taps spread across a session:
  // each tap keeps the chain alive only if it follows the previous one quickly.
  function registerTap() {
    const at = stamp();
    taps = taps.filter(time => at - time <= TAP_WINDOW_MS);
    taps.push(at);
    if (taps.length < TAPS_TO_OPEN) return false;
    taps = [];
    open();
    return true;
  }

  function hideClock() {
    if (!clockWrap) return;
    if (clockWrap.hidden !== true) clockWrap.hidden = true;
    lastClockText = null;
  }

  // The level number is the target, not the intro sentence: `#continue-level`
  // ("Starting level 1") and the illuminated numeral above it are what the title
  // screen always shows, while the intro line is hidden on short and compact
  // phones. Delegated from the document because the numeral widget is built
  // after this module (see level-numerals.js in main.js).
  const onTap = event => {
    if (!event?.target?.closest?.(TAP_TARGET_SELECTOR)) return;
    event.preventDefault?.();
    registerTap();
  };
  doc?.addEventListener?.('click', onTap);
  toggle?.addEventListener?.('change', () => setEnabled(toggle.checked === true));
  closeButton?.addEventListener?.('click', close);
  overlay?.addEventListener?.('click', event => {
    if (event.target === overlay) close();
  });
  doc?.addEventListener?.('keydown', event => {
    if (event?.key === 'Escape' && isOpen()) close();
  });

  return {
    open,
    close,
    isOpen,
    render,
    /** Feeds the HUD clock; call it every frame, it only writes when needed. */
    updateClock(run) {
      if (!clockWrap) return;
      const visible = records.enabled && Boolean(run?.active);
      if (!visible) {
        hideClock();
        return;
      }
      if (clockWrap.hidden !== false) clockWrap.hidden = false;
      if (!clock) return;
      const text = formatRunClock(run.runMs);
      if (text === lastClockText) return;
      lastClockText = text;
      clock.textContent = text;
      clockWrap.title = message('speedrun.levelSplit', 'Level {level}: {time}', {
        level: run.level,
        time: formatRunClock(run.levelMs),
      });
    },
    /** Exposed for tests: the tap detector without a DOM event. */
    registerTap,
    destroy() {
      doc?.removeEventListener?.('click', onTap);
    },
  };
}
