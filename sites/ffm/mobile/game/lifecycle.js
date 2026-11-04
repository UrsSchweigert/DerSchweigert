// lifecycle.js — App lifecycle seam for the Capacitor build.
//
// The app must behave like a native game when the OS takes the foreground
// away: gameplay and background music pause on background/interruption and
// resume only when the pause was automatic, the Android back button walks
// back through pause -> quit confirmation -> exit, and the screen stays awake
// only while a level is actually running.
//
// Capacitor injects the native plugins on `globalThis.Capacitor.Plugins`, so
// the plugin readers below resolve `App` and `KeepAwake` lazily and return
// null when a plugin is absent (web preview, partial shell). The lifecycle
// itself only knows the injected `game` facade and is driven in node:test
// with fakes, so no device behaviour is claimed from these tests.

/** Native events the app maps into the game. */
export const LIFECYCLE_EVENTS = Object.freeze(['appStateChange', 'backButton']);

/**
 * Layout the app inherits from the web build: the 16:9 canvas is centred in
 * whatever viewport the device offers, in portrait and in both landscapes.
 * The shells deliberately keep every orientation unlocked (AndroidManifest
 * has no `screenOrientation`, Info.plist lists portrait plus both
 * landscapes), and `static/styles.css` already pads the title, top bar,
 * overlays and legal footer with `env(safe-area-inset-*)`, so notches,
 * rounded corners and gesture bars never cover controls — exactly like the
 * website. There is no runtime orientation lock to add.
 */
export const LAYOUT = Object.freeze({
  orientation: 'any',
  aspectRatio: '800 / 450',
  safeArea: 'env(safe-area-inset-*)',
});

/**
 * Behaviour that needs a real device and is therefore a manual gate, not a
 * JS-test claim. `tests/lifecycle.test.mjs` only asserts this list stays
 * documented; it never proves the device behaviour.
 */
export const PENDING_MANUAL_GATES = Object.freeze([
  Object.freeze({
    id: 'ios-silent-switch',
    platform: 'ios',
    title: 'Silent switch silences game audio',
    detail: 'Flip the iPhone silent switch and confirm BGM and effects are muted, '
      + 'and that unmuting restores them without a restart.',
  }),
  Object.freeze({
    id: 'audio-interruption',
    platform: 'ios-android',
    title: 'Audio interruption pauses and resumes cleanly',
    detail: 'Take a call or let another app take the audio session while playing: '
      + 'gameplay and BGM must pause, and returning to the app must resume both '
      + 'exactly once, with volume and mute preserved.',
  }),
  Object.freeze({
    id: 'notched-safe-area',
    platform: 'ios-android',
    title: 'Controls clear notches, rounded corners and gesture bars',
    detail: 'On a notched phone and in both orientations, confirm the title, top '
      + 'bar, pause and game-over overlays and the legal footer stay inside the '
      + 'safe-area insets and that the back gesture never covers a button.',
  }),
]);

/**
 * Read the Capacitor `App` plugin.
 * @param {object} [scope] global object that carries `Capacitor`
 * @returns {{addListener: Function, exitApp: Function}|null}
 */
export function createAppPlugin(scope = globalThis) {
  const plugin = scope?.Capacitor?.Plugins?.App;
  if (!plugin || typeof plugin.addListener !== 'function') return null;
  return Object.freeze({
    addListener(eventName, callback) {
      return Promise.resolve(plugin.addListener(eventName, callback));
    },
    exitApp() {
      return Promise.resolve(plugin.exitApp?.());
    },
  });
}

/**
 * Read the `@capacitor-community/keep-awake` plugin.
 * @param {object} [scope] global object that carries `Capacitor`
 * @returns {{keepAwake: Function, allowSleep: Function}|null}
 */
export function createKeepAwakePlugin(scope = globalThis) {
  const plugin = scope?.Capacitor?.Plugins?.KeepAwake;
  if (!plugin) return null;
  return Object.freeze({
    keepAwake: () => Promise.resolve(plugin.keepAwake?.()),
    allowSleep: () => Promise.resolve(plugin.allowSleep?.()),
  });
}

function callQuietly(method, ...args) {
  try {
    const result = method?.(...args);
    if (result && typeof result.catch === 'function') result.catch(() => {});
  } catch {
    // A missing or failing native plugin must never break the game loop.
  }
}

/**
 * Wire the OS lifecycle to the game facade.
 *
 * `game` supplies `isPlaying()`, `isPaused()`, `pause()`, `resume()` and
 * `goBack()`. `goBack()` returns true when it consumed the back press (for
 * example dismissing the quit confirmation) and false to let the app exit.
 *
 * @param {{app: object, keepAwake?: object|null, game: object}} options
 * @returns {{start: () => Promise<void>, stop: () => void, setKeepAwake: (active: boolean) => void}}
 */
export function createLifecycle({ app, keepAwake = null, game } = {}) {
  if (!app || typeof app.addListener !== 'function') {
    throw new TypeError('createLifecycle needs an app plugin');
  }
  if (!game || typeof game !== 'object') {
    throw new TypeError('createLifecycle needs a game facade');
  }
  for (const name of ['isPlaying', 'isPaused', 'pause', 'resume', 'goBack']) {
    if (typeof game[name] !== 'function') {
      throw new TypeError(`createLifecycle game facade is missing: ${name}`);
    }
  }

  let handles = [];
  let running = false;
  let autoPaused = false;
  let awake = false;

  const isPlaying = () => Boolean(game.isPlaying()) && !game.isPaused();

  // Idempotent so callers can sync on every state transition; only a real
  // change reaches the native plugin.
  function setKeepAwake(active) {
    const next = Boolean(active);
    if (next === awake) return;
    awake = next;
    callQuietly(() => (next ? keepAwake?.keepAwake() : keepAwake?.allowSleep()));
  }

  function onAppStateChange({ isActive } = {}) {
    if (isActive) {
      // Only an automatic pause resumes; a pause the player chose stays.
      const resume = autoPaused;
      autoPaused = false;
      if (resume && game.isPaused()) game.resume();
      setKeepAwake(isPlaying());
      return;
    }
    if (isPlaying()) {
      autoPaused = true;
      game.pause();
    }
    setKeepAwake(false);
  }

  function onBackButton() {
    if (isPlaying()) {
      autoPaused = false;
      game.pause();
      return;
    }
    if (game.goBack()) return;
    callQuietly(() => app.exitApp());
  }

  async function start() {
    if (running) return;
    running = true;
    const registered = [];
    try {
      registered.push(await app.addListener('appStateChange', onAppStateChange));
      registered.push(await app.addListener('backButton', onBackButton));
      handles = registered;
    } catch (error) {
      running = false;
      for (const handle of registered) callQuietly(() => handle?.remove());
      throw error;
    }
  }

  function stop() {
    running = false;
    autoPaused = false;
    const registered = handles;
    handles = [];
    for (const handle of registered) callQuietly(() => handle?.remove());
    setKeepAwake(false);
  }

  return { start, stop, setKeepAwake };
}
