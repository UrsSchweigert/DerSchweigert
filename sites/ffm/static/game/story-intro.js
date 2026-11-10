// story-intro.js — decides which story diorama (see ../story/) plays, and when.
// Three rules:
//
//   * the very first time the app is opened, the intro (prologue) plays once;
//   * starting the first level of an act plays that act's opening scene, at
//     most once per scene per run;
//   * on the very first run the act I opening is skipped when the prologue has
//     just played, so a new player is not shown two scenes before level 1.
//
// The "opened before" flag is device-wide (localStorage, like the locale
// choice): it describes this install, not a player's progress, so it survives
// profile switches and is shared by every player on the device.

export const OPEN_SHOWN_KEY = 'arithmoslayer:story-intro-open-shown';
export const INTRO_SCENE = 'intro';
export const FIRST_LEVEL = 1;

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
 * @param {(sceneId: string) => Promise<string|null>} options.play - plays a
 *   story scene and resolves when it is over; may resolve to null.
 * @param {(level: number) => Promise<string|null>} [options.sceneForLevel] -
 *   resolves the scene id that opens the act a level belongs to, or null.
 * @param {() => void} [options.beforeScene] - runs immediately before a scene
 *   starts; the game uses it to put the title playlist under the diorama. A
 *   failure here must never cost the player the scene.
 * @param {object|null} [options.storage] - localStorage-compatible store;
 *   defaults to the page's localStorage.
 * @param {string} [options.scene] - the prologue scene id.
 * @returns {object} story controller
 */
export function createStoryIntro({ play, storage, scene = INTRO_SCENE, sceneForLevel, beforeScene } = {}) {
  if (typeof play !== 'function') throw new TypeError('createStoryIntro needs a play() function');
  const store = storage === undefined ? defaultStorage() : storage;
  const playedThisRun = new Set();
  // Only one scene may be on screen: the player mounts a full-screen overlay.
  let inFlight = null;

  async function showScene(sceneId) {
    try {
      beforeScene?.();
    } catch (error) {
      console.error('Unable to start the music for the story scene', error);
    }
    try {
      return await play(sceneId);
    } catch (error) {
      // A broken or missing scene must never block the game.
      console.error(`Unable to play story scene ${sceneId}`, error);
      return null;
    }
  }

  async function playOnce(sceneId) {
    if (playedThisRun.has(sceneId) || inFlight) return null;
    playedThisRun.add(sceneId);
    inFlight = showScene(sceneId);
    try {
      return await inFlight;
    } finally {
      inFlight = null;
    }
  }

  return {
    hasShownAtOpen: () => hasShownAtOpen(store),
    hasPlayedThisRun: (sceneId = scene) => playedThisRun.has(sceneId),

    /** Call once at boot: plays the prologue on the first open of an install. */
    async playOnOpen() {
      if (hasShownAtOpen(store)) return null;
      // Marked before playing, so an interrupted intro cannot loop forever.
      markShownAtOpen(store);
      return playOnce(scene);
    },

    /** Call when a level is about to start: opens the act that level begins. */
    async playBeforeLevel(levelNumber) {
      if (typeof sceneForLevel !== 'function') return null;
      const level = Number(levelNumber);
      // The prologue has just played in this run, so the first act opening
      // would be a second scene before the player has done anything.
      if (level === FIRST_LEVEL && playedThisRun.has(scene)) return null;
      const sceneId = await sceneForLevel(level);
      if (!sceneId) return null;
      return playOnce(sceneId);
    },

    /** Call when the player asks for the prologue again, e.g. from the title
     * screen: it plays even though it already ran in this install. */
    async replay() {
      if (inFlight) return null;
      // Counted as played so the act I opening still does not stack on it.
      playedThisRun.add(scene);
      inFlight = showScene(scene);
      try {
        return await inFlight;
      } finally {
        inFlight = null;
      }
    },
  };
}
