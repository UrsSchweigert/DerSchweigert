// story-intro.js — decides when the campaign intro (a story diorama, see
// ../story/) plays. Two rules:
//
//   * the very first time the app is opened, the intro plays once;
//   * starting level 1 plays it again on every later run — but never twice in
//     the same run, so the first run does not repeat what it just showed.
//
// The "opened before" flag is device-wide (localStorage, like the locale
// choice): it describes this install, not a player's progress, so it survives
// profile switches and is shared by every player on the device.

export const OPEN_SHOWN_KEY = 'arithmoslayer:story-intro-open-shown';
export const INTRO_SCENE = 'intro';
export const INTRO_LEVEL = 1;

function defaultStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    // Blocked storage (sandboxed frame, storage disabled) reads as "not seen".
    return null;
  }
}

function hasShownAtOpen(storage) {
  try {
    return storage?.getItem?.(OPEN_SHOWN_KEY) === '1';
  } catch {
    return false;
  }
}

function markShownAtOpen(storage) {
  try {
    storage?.setItem?.(OPEN_SHOWN_KEY, '1');
  } catch {
    // A failed write only means the intro may show again at the next open.
  }
}

/**
 * @param {object} options
 * @param {() => Promise<string|null>} options.play - plays a story scene and
 *   resolves when it is over; may resolve to null if it was unavailable.
 * @param {object|null} [options.storage] - localStorage-compatible store;
 *   defaults to the page's localStorage.
 * @param {string} [options.scene] - scene id to play.
 * @returns {object} intro controller
 */
export function createStoryIntro({ play, storage, scene = INTRO_SCENE } = {}) {
  if (typeof play !== 'function') throw new TypeError('createStoryIntro needs a play() function');
  const store = storage === undefined ? defaultStorage() : storage;
  let playedThisRun = false;

  async function playOnce() {
    if (playedThisRun) return null;
    playedThisRun = true;
    try {
      return await play(scene);
    } catch (error) {
      // A broken or missing scene must never block the game.
      console.error('Unable to play the story intro', error);
      return null;
    }
  }

  return {
    hasShownAtOpen: () => hasShownAtOpen(store),
    hasPlayedThisRun: () => playedThisRun,

    /** Call once at boot: plays on the first open of this install. */
    async playOnOpen() {
      if (hasShownAtOpen(store)) return null;
      // Marked before playing, so an interrupted intro cannot loop forever.
      markShownAtOpen(store);
      return playOnce();
    },

    /** Call when a level is about to start; the intro belongs to level 1. */
    async playBeforeLevel(levelNumber) {
      if (Number(levelNumber) !== INTRO_LEVEL) return null;
      return playOnce();
    },
  };
}
