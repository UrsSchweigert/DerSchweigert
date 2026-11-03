/**
 * Platform adapter contract for Buchstabenzeit.
 *
 * One interface exposes the device capabilities the app uses: speech,
 * progress, reminders, haptics and parent-report export. The web
 * implementations below preserve today's behaviour exactly (browser speech,
 * localStorage progress, no-op notifications and vibration, Blob download).
 * UI code depends only on this module, never on a Capacitor plugin.
 *
 * Practice reminders stay off until a parent enables them behind the parental
 * gate. Only then does the adapter touch the native LocalNotifications plugin,
 * it schedules one inexact daily notification, and it remembers a denial so the
 * permission prompt never loops.
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

/** Persisted key holding the accumulated on-device practice time in milliseconds. */
export const PRACTICE_TIME_KEY = 'buchstabenzeit:practice-ms';

/** Filename offered when the parent report is exported. */
export const REPORT_FILENAME = 'buchstabenzeit-report.csv';

/** Longest time a single card may contribute, guarding against idle tabs. */
export const MAX_CARD_PRACTICE_MS = 5 * 60 * 1000;

/** Fixed column order of the exported report. */
const REPORT_COLUMNS = ['card', 'correct', 'incorrect', 'attempts', 'accuracy_percent', 'practice_seconds'];

/** Browser vibration pattern for a correct answer: one short pulse. */
export const HAPTIC_CORRECT_PATTERN = [40];

/** Browser vibration pattern for an incorrect answer: two pulses. */
export const HAPTIC_INCORRECT_PATTERN = [40, 60, 40];

/**
 * Persisted key holding whether practice reminders are enabled.
 * Unset or any value other than 'true' means off, so reminders start off.
 */
export const REMINDERS_ENABLED_KEY = 'buchstabenzeit:reminders-enabled';

/** Persisted key remembering that notification permission was denied. */
export const REMINDERS_DENIED_KEY = 'buchstabenzeit:reminders-denied';

/** Persisted key holding the scheduled reminder so a cold start can restore it. */
export const REMINDERS_SCHEDULE_KEY = 'buchstabenzeit:reminders-schedule';

/** Fixed id of the single recurring practice reminder. */
export const REMINDER_NOTIFICATION_ID = 1;

/** Default local time of the daily practice reminder. */
export const DEFAULT_REMINDER_HOUR = 17;

/** Default minute of the daily practice reminder. */
export const DEFAULT_REMINDER_MINUTE = 0;

/** German-first title of the practice reminder; callers may override it. */
export const REMINDER_TITLE = 'Buchstabenzeit';

/** German-first body of the practice reminder; callers may override it. */
export const REMINDER_BODY = 'Zeit für eine kleine Leseübung.';

/**
 * Whether the user asked the operating system to reduce motion.
 * Mirrors the check the star animation already uses.
 * @param {Window} [win] - Window object that may expose matchMedia.
 * @returns {boolean} true when reduced motion is requested.
 */
export function prefersReducedMotion(win) {
  return Boolean(win?.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches);
}

/**
 * Whether a parsed JSON value is a plain object (not an array or null).
 * @param {unknown} value parsed value
 * @returns {boolean} true for `{}`-style objects
 */
function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Coerce a stored counter to a non-negative integer.
 * Numbers and numeric strings are accepted; anything else counts as zero.
 * @param {unknown} value stored counter
 * @returns {number} safe counter
 */
function toCount(value) {
  if (typeof value !== 'number' && typeof value !== 'string') {
    return 0;
  }
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.trunc(number) : 0;
}

/**
 * Coerce a stored duration to a non-negative whole number of milliseconds.
 * @param {unknown} value stored duration
 * @returns {number} safe duration
 */
function toMillis(value) {
  if (typeof value !== 'number' && typeof value !== 'string') {
    return 0;
  }
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.round(number) : 0;
}

/**
 * Accuracy of a set of attempts in percent, rounded to one decimal.
 * Zero attempts yield 0 instead of dividing by zero.
 * @param {number} correct correct attempts
 * @param {number} attempts total attempts
 * @returns {number} percentage between 0 and 100
 */
function accuracyPercent(correct, attempts) {
  return attempts > 0 ? Math.round((correct / attempts) * 1000) / 10 : 0;
}

/**
 * Read the accumulated practice time from a key-value store.
 * A missing, corrupt or negative value reads as zero.
 * @param {{getItem: (key: string) => string|null}|null|undefined} store
 * @returns {number} practice time in milliseconds
 */
export function readPracticeMs(store) {
  if (!store || typeof store.getItem !== 'function') {
    return 0;
  }
  try {
    return toMillis(store.getItem(PRACTICE_TIME_KEY));
  } catch {
    return 0;
  }
}

/**
 * Add one card's practice time to the accumulated total.
 * Each delta is capped at MAX_CARD_PRACTICE_MS and invalid deltas are ignored,
 * so a forgotten tab cannot inflate the report.
 * @param {{getItem: (key: string) => string|null, setItem: (key: string, value: string) => void}|null|undefined} store
 * @param {unknown} deltaMs - time spent on one card in milliseconds
 * @returns {number} the new total in milliseconds
 */
export function addPracticeMs(store, deltaMs) {
  const delta = Math.min(toMillis(deltaMs), MAX_CARD_PRACTICE_MS);
  const total = readPracticeMs(store) + delta;
  if (!store || typeof store.setItem !== 'function') {
    return total;
  }
  try {
    store.setItem(PRACTICE_TIME_KEY, String(total));
  } catch {
    // Ignore storage failures; the report still shows the in-memory total.
  }
  return total;
}

/**
 * Build the on-device parent report from stored card statistics.
 *
 * Cards are sorted by text so the report is deterministic. Counters are
 * coerced to non-negative integers and malformed entries are skipped. Cards
 * without any attempt (for example after a Flop recovery reset) are left out
 * because they carry no information for the report.
 * @param {object} [cards] map of card text to { correct_count, incorrect_count }
 * @param {unknown} [practiceMs] accumulated practice time in milliseconds
 * @returns {{cards: Array<Object>, totals: Object}} report summary
 */
export function buildReport(cards, practiceMs) {
  const source = isPlainObject(cards) ? cards : {};
  const rows = [];

  for (const [card, entry] of Object.entries(source)) {
    if (!isPlainObject(entry) || card === '') {
      continue;
    }
    const correct = toCount(entry.correct_count);
    const incorrect = toCount(entry.incorrect_count);
    const attempts = correct + incorrect;
    if (attempts === 0) {
      continue;
    }
    rows.push({ card, correct, incorrect, attempts, accuracy: accuracyPercent(correct, attempts) });
  }

  rows.sort((a, b) => (a.card < b.card ? -1 : a.card > b.card ? 1 : 0));

  const correct = rows.reduce((sum, row) => sum + row.correct, 0);
  const incorrect = rows.reduce((sum, row) => sum + row.incorrect, 0);
  const attempts = correct + incorrect;
  const millis = toMillis(practiceMs);

  return {
    cards: rows,
    totals: {
      cards: rows.length,
      correct,
      incorrect,
      attempts,
      accuracy: accuracyPercent(correct, attempts),
      practiceMs: millis,
      practiceSeconds: Math.round(millis / 1000),
    },
  };
}

/**
 * Quote one CSV field. Card texts may contain delimiters, quotes or newlines,
 * so every card value is quoted and inner quotes are doubled.
 * @param {unknown} value field value
 * @returns {string} quoted field
 */
function csvField(value) {
  return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

/**
 * Render a report as CSV with a fixed header and one total row.
 *
 * The card column is always quoted, numbers are plain, and the total row
 * carries the practice time in seconds so the file opens cleanly in a
 * spreadsheet.
 * @param {ReturnType<typeof buildReport>} report report built by buildReport
 * @returns {string} CSV text
 */
export function toCsv(report) {
  const rows = Array.isArray(report?.cards) ? report.cards : [];
  const totals = isPlainObject(report?.totals) ? report.totals : buildReport({}, 0).totals;
  const lines = [REPORT_COLUMNS.join(',')];

  for (const row of rows) {
    lines.push([
      csvField(row.card),
      String(toCount(row.correct)),
      String(toCount(row.incorrect)),
      String(toCount(row.attempts)),
      Number(row.accuracy ?? 0).toFixed(1),
      '',
    ].join(','));
  }

  lines.push([
    csvField('Total'),
    String(toCount(totals.correct)),
    String(toCount(totals.incorrect)),
    String(toCount(totals.attempts)),
    Number(totals.accuracy ?? 0).toFixed(1),
    String(toCount(totals.practiceSeconds)),
  ].join(','));

  return `${lines.join('\n')}\n`;
}

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
    readPracticeMs: () => readPracticeMs(store),
    addPracticeMs: (deltaMs) => addPracticeMs(store, deltaMs),
  };
}

/**
 * Read one persisted string from a key-value store.
 * @param {Object|null|undefined} store key-value store
 * @param {string} key persisted key
 * @returns {string|null} stored value, or null when missing or unreadable
 */
function readStoredValue(store, key) {
  if (!store || typeof store.getItem !== 'function') {
    return null;
  }
  try {
    return store.getItem(key);
  } catch {
    return null;
  }
}

/**
 * Persist one string value, ignoring stores that cannot write.
 * @param {Object|null|undefined} store key-value store
 * @param {string} key persisted key
 * @param {string} value value to persist
 * @returns {boolean} true when the value was stored
 */
function writeStoredValue(store, key, value) {
  if (!store || typeof store.setItem !== 'function') {
    return false;
  }
  try {
    store.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

/**
 * Remove one persisted value, ignoring stores that cannot remove.
 * @param {Object|null|undefined} store key-value store
 * @param {string} key persisted key
 */
function removeStoredValue(store, key) {
  if (!store || typeof store.removeItem !== 'function') {
    return;
  }
  try {
    store.removeItem(key);
  } catch {
    // Ignore storage failures; the in-memory schedule is cleared regardless.
  }
}

/**
 * Normalize a Capacitor LocalNotifications permission result.
 * @param {unknown} result plugin permission result
 * @returns {string} 'granted', 'denied', 'prompt' or 'unknown'
 */
function displayState(result) {
  const state = result?.display;
  return typeof state === 'string' ? state : 'unknown';
}

/**
 * Coerce a reminder hour to 0-23, falling back to the default.
 * @param {unknown} value stored hour
 * @returns {number} valid hour
 */
function toHour(value) {
  const number = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return Number.isInteger(number) && number >= 0 && number <= 23 ? number : DEFAULT_REMINDER_HOUR;
}

/**
 * Coerce a reminder minute to 0-59, falling back to the default.
 * @param {unknown} value stored minute
 * @returns {number} valid minute
 */
function toMinute(value) {
  const number = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return Number.isInteger(number) && number >= 0 && number <= 59 ? number : DEFAULT_REMINDER_MINUTE;
}

/**
 * Coerce reminder options into the persisted shape.
 * Missing or invalid values fall back to the daily default time and text.
 * @param {unknown} options caller-provided reminder options
 * @returns {{hour: number, minute: number, title: string, body: string}} schedule
 */
function normalizeSchedule(options) {
  const source = isPlainObject(options) ? options : {};
  return {
    hour: toHour(source.hour),
    minute: toMinute(source.minute),
    title: typeof source.title === 'string' && source.title.trim() !== '' ? source.title : REMINDER_TITLE,
    body: typeof source.body === 'string' && source.body.trim() !== '' ? source.body : REMINDER_BODY,
  };
}

/**
 * Read the persisted reminder schedule.
 * A missing or corrupt value reads as no schedule.
 * @param {Object|null|undefined} store key-value store
 * @returns {{hour: number, minute: number, title: string, body: string}|null} schedule
 */
function readStoredSchedule(store) {
  const raw = readStoredValue(store, REMINDERS_SCHEDULE_KEY);
  if (typeof raw !== 'string' || raw === '') {
    return null;
  }
  try {
    const parsed = JSON.parse(raw);
    return isPlainObject(parsed) ? normalizeSchedule(parsed) : null;
  } catch {
    return null;
  }
}

/**
 * Web reminders capability. Reminders are off by default and only prompt for
 * notification permission after the parent enabled them through the parental
 * gate (setEnabled). A denial is remembered, so the app never prompts again in
 * a loop; the web build without the native plugin never prompts at all.
 *
 * The reminder itself is one daily, inexact local notification. The resolved
 * schedule is persisted, so restore() can reapply it after a cold start
 * without asking for permission again.
 * @param {Object} [env] - Platform environment with an optional window/store.
 * @returns {Object} Reminders capability.
 */
export function createWebReminders(env = {}) {
  const win = env.window ?? (typeof window === 'undefined' ? undefined : window);
  const store = env.store ?? win?.localStorage;
  const plugin = win?.Capacitor?.Plugins?.LocalNotifications ?? null;
  const supported = Boolean(plugin);

  let enabled = readStoredValue(store, REMINDERS_ENABLED_KEY) === 'true';
  let denied = readStoredValue(store, REMINDERS_DENIED_KEY) === 'true';
  let pendingSchedule = readStoredSchedule(store);

  function rememberDenied() {
    denied = true;
    writeStoredValue(store, REMINDERS_DENIED_KEY, 'true');
  }

  function clearDenied() {
    denied = false;
    removeStoredValue(store, REMINDERS_DENIED_KEY);
  }

  function persistSchedule(value) {
    pendingSchedule = value;
    writeStoredValue(store, REMINDERS_SCHEDULE_KEY, JSON.stringify(value));
  }

  function clearSchedule() {
    pendingSchedule = null;
    removeStoredValue(store, REMINDERS_SCHEDULE_KEY);
  }

  async function checkPermission() {
    if (!plugin || typeof plugin.checkPermissions !== 'function') {
      return 'unknown';
    }
    try {
      return displayState(await plugin.checkPermissions());
    } catch {
      return 'unknown';
    }
  }

  async function requestPermission() {
    if (!supported) {
      return 'denied';
    }
    if (denied) {
      // A remembered denial is never re-prompted, but a permission granted in
      // the system settings clears it without any dialog.
      const grantedNow = await checkPermission();
      if (grantedNow === 'granted') {
        clearDenied();
        return 'granted';
      }
      return 'denied';
    }
    const current = await checkPermission();
    if (current === 'granted') {
      clearDenied();
      return 'granted';
    }
    if (current === 'denied') {
      rememberDenied();
      return 'denied';
    }
    try {
      if (displayState(await plugin.requestPermissions()) === 'granted') {
        clearDenied();
        return 'granted';
      }
    } catch {
      // Fall through to a remembered denial; the OS refused the request.
    }
    rememberDenied();
    return 'denied';
  }

  async function ensurePermission() {
    const current = await checkPermission();
    if (current === 'granted') {
      clearDenied();
      return 'granted';
    }
    if (denied || current === 'denied') {
      rememberDenied();
      return 'denied';
    }
    return requestPermission();
  }

  async function scheduleNative(value) {
    await plugin.schedule({
      notifications: [{
        id: REMINDER_NOTIFICATION_ID,
        title: value.title,
        body: value.body,
        schedule: {
          on: { hour: value.hour, minute: value.minute },
          repeats: true,
          isExactNotification: false,
        },
      }],
    });
  }

  async function cancelAll() {
    clearSchedule();
    if (!supported) {
      return UNSUPPORTED;
    }
    try {
      await plugin.cancel({ notifications: [{ id: REMINDER_NOTIFICATION_ID }] });
      return 'cancelled';
    } catch {
      return 'failed';
    }
  }

  return {
    kind: plugin ? 'native' : 'web',
    isSupported: () => supported,
    isEnabled: () => enabled,
    async setEnabled(value) {
      enabled = Boolean(value);
      writeStoredValue(store, REMINDERS_ENABLED_KEY, enabled ? 'true' : 'false');
      if (!enabled) {
        await cancelAll();
      }
      return enabled;
    },
    requestPermission,
    async schedule(options) {
      if (!supported) {
        return UNSUPPORTED;
      }
      if (!enabled) {
        return 'gated';
      }
      if ((await ensurePermission()) !== 'granted') {
        return 'denied';
      }
      const value = normalizeSchedule(options);
      try {
        await scheduleNative(value);
      } catch {
        return 'failed';
      }
      persistSchedule(value);
      return 'scheduled';
    },
    cancelAll,
    async restore() {
      if (!supported) {
        return UNSUPPORTED;
      }
      if (!enabled || !pendingSchedule) {
        return 'off';
      }
      if (denied) {
        return 'denied';
      }
      const current = await checkPermission();
      if (current === 'denied') {
        rememberDenied();
        return 'denied';
      }
      if (current !== 'granted' && current !== 'unknown') {
        return 'denied';
      }
      try {
        await scheduleNative(pendingSchedule);
        return 'scheduled';
      } catch {
        return 'failed';
      }
    },
    status() {
      if (!supported) {
        return UNSUPPORTED;
      }
      if (!enabled) {
        return 'off';
      }
      if (denied) {
        return 'denied';
      }
      return pendingSchedule ? 'scheduled' : 'off';
    },
  };
}

/**
 * Haptics capability. Grading feedback uses the Capacitor Haptics plugin when
 * present, otherwise the browser Vibration API, and stays silent when the
 * platform offers neither or the user asked for reduced motion.
 * @param {Object} [env] - Platform environment with an optional window/navigator.
 * @returns {Object} Haptics capability.
 */
export function createWebHaptics(env = {}) {
  const win = env.window ?? (typeof window === 'undefined' ? undefined : window);
  const plugin = win?.Capacitor?.Plugins?.Haptics ?? null;
  const navigator = env.navigator ?? win?.navigator;
  const canVibrate = typeof navigator?.vibrate === 'function';
  const supported = Boolean(plugin) || canVibrate;

  async function gradeNative(correct) {
    if (typeof plugin.notification === 'function') {
      await plugin.notification({ type: correct ? 'SUCCESS' : 'ERROR' });
      return 'native';
    }
    await plugin.impact?.({ style: correct ? 'MEDIUM' : 'HEAVY' });
    return 'native';
  }

  return {
    kind: plugin ? 'native' : 'web',
    isSupported: () => supported,
    impact: async () => UNSUPPORTED,
    vibrate: async () => UNSUPPORTED,
    async grade(correct) {
      if (!supported) {
        return UNSUPPORTED;
      }
      if (prefersReducedMotion(win)) {
        return 'suppressed';
      }
      if (plugin) {
        return gradeNative(correct);
      }
      navigator.vibrate(correct ? HAPTIC_CORRECT_PATTERN : HAPTIC_INCORRECT_PATTERN);
      return 'vibrate';
    },
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
    /**
     * Native app identity, including the version declared once in
     * android/app/build.gradle. Resolves null on the web and whenever the
     * plugin or its getInfo() call is unavailable, so callers can fall back
     * to a version-less label instead of showing a stale literal.
     * @returns {Promise<{id?: string, name?: string, version?: string, build?: string}|null>}
     */
    async getInfo() {
      if (!plugin || typeof plugin.getInfo !== 'function') {
        return null;
      }
      try {
        return await plugin.getInfo();
      } catch {
        return null;
      }
    },
  };
}

/**
 * Whether a window runs inside the native Capacitor shell.
 * Capacitor is only injected by the native shell, so its presence is enough
 * when the platform helpers are missing.
 * @param {Window} [win] - Window object.
 * @returns {boolean} true inside the native shell
 */
function isNativeShell(win) {
  const capacitor = win?.Capacitor;
  if (!capacitor) {
    return false;
  }
  if (typeof capacitor.isNativePlatform === 'function') {
    return Boolean(capacitor.isNativePlatform());
  }
  if (typeof capacitor.getPlatform === 'function') {
    return capacitor.getPlatform() !== 'web';
  }
  return true;
}

/**
 * CSV export capability for the parent report.
 *
 * On a device the report is written to the app cache through the Capacitor
 * Filesystem plugin and handed to the system share sheet through the Share
 * plugin, so no network is involved. In a plain browser the same bytes are
 * downloaded through a Blob and an anchor element. A native shell whose
 * plugins are missing reports failure instead of silently downloading, so a
 * broken device export never looks like a successful web fallback.
 * @param {Window} [win] - Window object that may carry Capacitor.
 * @returns {Object} Export capability with kind, isSupported and save.
 */
export function createWebExport(win) {
  const native = isNativeShell(win);
  const filesystem = win?.Capacitor?.Plugins?.Filesystem ?? null;
  const share = win?.Capacitor?.Plugins?.Share ?? null;
  const nativeReady = Boolean(
    filesystem
      && typeof filesystem.writeFile === 'function'
      && share
      && typeof share.share === 'function',
  );
  const BlobCtor = win?.Blob ?? (typeof Blob === 'function' ? Blob : null);
  const urlApi = win?.URL ?? (typeof URL === 'function' ? URL : null);
  const canDownload = Boolean(
    BlobCtor
      && urlApi
      && typeof urlApi.createObjectURL === 'function'
      && typeof win?.document?.createElement === 'function',
  );

  async function saveNative(csv, filename) {
    if (!nativeReady) {
      return { saved: false, kind: 'native', reason: UNSUPPORTED };
    }
    try {
      await filesystem.writeFile({
        path: filename,
        data: csv,
        directory: 'CACHE',
        encoding: 'UTF8',
      });
      let uri;
      if (typeof filesystem.getUri === 'function') {
        uri = await filesystem.getUri({ path: filename, directory: 'CACHE' });
      }
      await share.share({
        title: filename,
        url: uri?.uri ?? filename,
        dialogTitle: filename,
      });
      return { saved: true, kind: 'native' };
    } catch {
      return { saved: false, kind: 'native', reason: 'failed' };
    }
  }

  function saveDownload(csv, filename) {
    if (!canDownload) {
      return { saved: false, kind: 'download', reason: UNSUPPORTED };
    }
    try {
      const blob = new BlobCtor([csv], { type: 'text/csv;charset=utf-8' });
      const href = urlApi.createObjectURL(blob);
      const anchor = win.document.createElement('a');
      anchor.href = href;
      anchor.download = filename;
      anchor.rel = 'noopener';
      win.document.body?.appendChild?.(anchor);
      anchor.click?.();
      anchor.remove?.();
      urlApi.revokeObjectURL?.(href);
      return { saved: true, kind: 'download' };
    } catch {
      return { saved: false, kind: 'download', reason: 'failed' };
    }
  }

  return {
    kind: native ? 'native' : 'web',
    isSupported: () => (native ? nativeReady : canDownload),
    async save(csv, filename = REPORT_FILENAME) {
      return native ? saveNative(csv, filename) : saveDownload(csv, filename);
    },
  };
}

/**
 * Create the platform adapter for the current environment.
 * @param {{window?: Window, store?: Storage}} [env] - Injected environment.
 * @returns {{speech: Object, progress: Object, reminders: Object, haptics: Object, app: Object, export: Object}}
 */
export function createPlatformAdapter(env = {}) {
  const win = env.window ?? (typeof window === 'undefined' ? undefined : window);
  const store = env.store ?? win?.localStorage;

  return {
    speech: createWebSpeech(win),
    progress: createWebProgress(store),
    reminders: createWebReminders({ window: win, store }),
    haptics: createWebHaptics(env),
    app: createWebApp(win),
    export: createWebExport(win),
  };
}
