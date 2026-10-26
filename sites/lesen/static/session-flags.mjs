/**
 * Session-scoped "already shown" flags for one-time in-app notices.
 *
 * The store is injected (e.g. `window.sessionStorage` on web and in the
 * Android WebView) so these functions stay pure and easy to unit test with a
 * fake store. Flags are intentionally session-scoped only: nothing here
 * persists across sessions (no localStorage, no native storage).
 */

const TTS_DISCLAIMER_KEY = "buchstabenzeit:tts-disclaimer-shown";

/**
 * Read a flag value from the store, tolerating a missing/throwing store.
 * @param {{getItem: (key: string) => string|null}|null|undefined} store
 * @param {string} key
 * @returns {string|null}
 */
function readFlag(store, key) {
  if (!store || typeof store.getItem !== "function") return null;
  try {
    return store.getItem(key);
  } catch {
    return null;
  }
}

/**
 * Write a flag value to the store, tolerating a missing/throwing store.
 * @param {{setItem: (key: string, value: string) => void}|null|undefined} store
 * @param {string} key
 */
function writeFlag(store, key) {
  if (!store || typeof store.setItem !== "function") return;
  try {
    store.setItem(key, "1");
  } catch {
    // Ignore storage failures (e.g. disabled storage); worst case the
    // disclaimer is shown again, which is harmless.
  }
}

/**
 * Decide whether the one-time TTS disclaimer should still be shown in this
 * session, given an injectable store.
 * @param {{getItem: (key: string) => string|null}|null|undefined} store
 * @returns {boolean} true if the disclaimer has not been shown yet this session
 */
export function shouldShowTtsDisclaimer(store) {
  return readFlag(store, TTS_DISCLAIMER_KEY) !== "1";
}

/**
 * Record that the TTS disclaimer has been shown, so later checks in this
 * session report it should stay hidden.
 * @param {{setItem: (key: string, value: string) => void}|null|undefined} store
 */
export function markTtsDisclaimerShown(store) {
  writeFlag(store, TTS_DISCLAIMER_KEY);
}

/**
 * Decide-and-record in one step: returns whether the disclaimer should be
 * shown right now, and if so, immediately marks it as shown so any
 * subsequent call (this click or a later one) in the same session reports
 * false. Safe to call on every "speak-card" click.
 * @param {{getItem: (key: string) => string|null, setItem: (key: string, value: string) => void}|null|undefined} store
 * @returns {boolean} true the first time it is called for a given store/session
 */
export function consumeTtsDisclaimerFlag(store) {
  const shouldShow = shouldShowTtsDisclaimer(store);
  if (shouldShow) {
    markTtsDisclaimerShown(store);
  }
  return shouldShow;
}
