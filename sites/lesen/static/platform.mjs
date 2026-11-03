/**
 * Platform adapter contract for Buchstabenzeit.
 *
 * One interface exposes the four device capabilities the app uses:
 * speech, progress, reminders and haptics. The web implementations below
 * preserve today's behaviour exactly (browser speech, localStorage progress,
 * no-op notifications and vibration). Native plugin bodies arrive in later
 * phases; UI code depends only on this module, never on a Capacitor plugin.
 */
import { createSpeechAdapter } from './speech-adapter.js';
import {
  createStorage,
  readLanguage,
  writeLanguage,
  readSelection,
  writeSelection,
} from './storage.mjs';

/** Status reported when the current platform cannot provide a capability. */
export const UNSUPPORTED = 'unsupported';

/**
 * Web speech capability backed by the existing speech adapter.
 * `win` may be omitted; the resulting adapter then reports itself unsupported.
 * @param {Window} [win] - Window object (injected for tests).
 * @returns {Object} Speech capability.
 */
export function createWebSpeech(win) {
  const adapter = createSpeechAdapter(win ?? {});

  return {
    kind: adapter.kind,
    isSupported: () => adapter.isSupported(),
    voiceStatus: (lang) => adapter.voiceStatus(lang),
    warm: () => adapter.warm(),
    cancel: () => adapter.cancel(),
    speak: (options) => adapter.speak(options),
  };
}

/**
 * Web progress capability backed by localStorage through ./storage.mjs.
 * Every read and write goes to the injected store, so web behaviour and the
 * persisted keys stay identical to the pre-adapter implementation.
 * @param {Storage} [store] - Key-value store (e.g. window.localStorage).
 * @returns {Object} Progress capability.
 */
export function createWebProgress(store) {
  const stats = createStorage(store);

  return {
    kind: 'web',
    read: () => stats.read(),
    write: (value) => stats.write(value),
    readLanguage: () => readLanguage(store),
    writeLanguage: (lang) => writeLanguage(store, lang),
    readSelection: (lang) => readSelection(store, lang),
    writeSelection: (lang, selection) => writeSelection(store, lang, selection),
  };
}

/**
 * Web reminders capability. The web build never prompts for notification
 * permission and never schedules anything, so the Notification API is not
 * touched at all.
 * @param {Object} [env] - Platform environment (unused on web).
 * @returns {Object} Reminders capability.
 */
export function createWebReminders(env = {}) {
  return {
    kind: 'web',
    isSupported: () => false,
    requestPermission: async () => 'denied',
    schedule: async () => UNSUPPORTED,
    cancelAll: async () => UNSUPPORTED,
    status: () => UNSUPPORTED,
  };
}

/**
 * Web haptics capability. Browsers get no vibration so the current silent
 * behaviour is preserved.
 * @param {Object} [env] - Platform environment (unused on web).
 * @returns {Object} Haptics capability.
 */
export function createWebHaptics(env = {}) {
  return {
    kind: 'web',
    isSupported: () => false,
    impact: async () => UNSUPPORTED,
    vibrate: async () => UNSUPPORTED,
  };
}

/**
 * Null-safe wrapper around the Capacitor App plugin.
 * Without the plugin every call is a no-op and isSupported() is false, which
 * keeps the plain website behaviour unchanged.
 * @param {Window} [win] - Window object that may carry Capacitor.
 * @returns {Object} App lifecycle capability.
 */
export function createWebApp(win) {
  const plugin = win?.Capacitor?.Plugins?.App ?? null;

  return {
    kind: plugin ? 'native' : 'web',
    isSupported: () => Boolean(plugin),
    addListener(eventName, handler) {
      if (!plugin) {
        return { remove() {} };
      }
      const handle = plugin.addListener(eventName, handler);
      return {
        remove() {
          handle?.remove?.();
        },
      };
    },
    exitApp() {
      plugin?.exitApp?.();
    },
  };
}

/**
 * Create the platform adapter for the current environment.
 * @param {{window?: Window, store?: Storage}} [env] - Injected environment.
 * @returns {{speech: Object, progress: Object, reminders: Object, haptics: Object, app: Object}}
 */
export function createPlatformAdapter(env = {}) {
  const win = env.window ?? (typeof window === 'undefined' ? undefined : window);
  const store = env.store ?? win?.localStorage;

  return {
    speech: createWebSpeech(win),
    progress: createWebProgress(store),
    reminders: createWebReminders(env),
    haptics: createWebHaptics(env),
    app: createWebApp(win),
  };
}
