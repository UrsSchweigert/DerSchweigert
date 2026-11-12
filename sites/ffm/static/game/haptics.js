// haptics.js — Pure haptic event patterns shared by the web and app builds.
//
// The module owns only the decision to vibrate: it holds no device API and no
// storage. The shell resolves a `vibrate` function (see haptics-source.js) and
// feeds the persisted preference (see vibration-preferences.js) through
// setEnabled/setReducedMotion, so one instance can follow both for the whole
// session. Every pattern is deliberately short; reduced motion and the user
// preference suppress the call entirely instead of shortening it.

/** One short pattern per gameplay event, in navigator.vibrate units (ms). */
export const HAPTIC_PATTERNS = Object.freeze({
  impact: Object.freeze([20]),
  heal: Object.freeze([12]),
  levelClear: Object.freeze([15, 50, 15]),
});

/**
 * Create the haptics facade for one session.
 *
 * @param {object} [options]
 * @param {Function} [options.vibrate] device driver; may be missing
 * @param {boolean} [options.enabled] persisted preference, defaults to on
 * @param {boolean} [options.reducedMotion] OS/browser reduced-motion signal
 */
export function createHaptics({ vibrate, enabled = true, reducedMotion = false } = {}) {
  const state = {
    enabled: enabled !== false,
    reducedMotion: !!reducedMotion,
  };

  function fire(pattern) {
    if (!state.enabled || state.reducedMotion) return false;
    if (typeof vibrate !== 'function') return false;
    try {
      const result = vibrate(pattern);
      // Drivers may return a promise; a rejection must never reach gameplay.
      if (result && typeof result.then === 'function') result.then(undefined, () => {});
      return true;
    } catch {
      return false;
    }
  }

  return {
    get enabled() {
      return state.enabled;
    },
    get reducedMotion() {
      return state.reducedMotion;
    },
    setEnabled(value) {
      state.enabled = value !== false;
      return state.enabled;
    },
    setReducedMotion(value) {
      state.reducedMotion = !!value;
      return state.reducedMotion;
    },
    impact() {
      return fire(HAPTIC_PATTERNS.impact);
    },
    heal() {
      return fire(HAPTIC_PATTERNS.heal);
    },
    levelClear() {
      return fire(HAPTIC_PATTERNS.levelClear);
    },
  };
}
