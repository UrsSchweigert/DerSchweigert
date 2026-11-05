// progress-store.js — Local, versioned progress for the app build.
//
// The app has no account and no server, so per-level best scores, the
// timestamped score history behind the title-screen chart and the set of
// completed levels live on the device. The production backend is Capacitor
// Preferences (Android SharedPreferences, iOS NSUserDefaults), both of which
// the OS includes in device and cloud backups. The store only needs a
// key-value backend with async get/set, so tests inject a Map-backed fake.
//
// Every record kind has its own key and is stored as one JSON document
// written with a single setItem: a write either replaces that record or
// leaves the previous one untouched. A missing key, a corrupt document or a
// document from an unknown (newer) schema reads as empty instead of throwing.
// Documents written before the version wrapper (schema version 0: a bare map
// or array) are migrated on read and persisted in the current shape on the
// next write.

/** The only progress schema version this module understands. */
export const PROGRESS_SCHEMA_VERSION = 1;

/** Number of score-history entries kept, matching the web score-history API. */
export const SCORE_HISTORY_LIMIT = 100;

/** One key per record kind, so a write never rewrites unrelated progress. */
export const PROGRESS_KEYS = Object.freeze({
  best: 'arithmoslayer:progress:best',
  history: 'arithmoslayer:progress:history',
  completed: 'arithmoslayer:progress:completed',
});

/**
 * Whether a parsed JSON value is a plain object (not an array or null).
 * @param {unknown} value parsed JSON value
 * @returns {boolean} true for `{}`-style objects
 */
function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Whether a value is a 1-based level number.
 * @param {unknown} value candidate level
 * @returns {boolean} true for integers >= 1
 */
function isLevel(value) {
  return Number.isInteger(value) && value >= 1;
}

/**
 * Whether a value is a score the game can persist.
 * @param {unknown} value candidate score
 * @returns {boolean} true for finite numbers >= 0
 */
function isScore(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

/**
 * Normalize one history entry, or null when it cannot be trusted.
 * @param {unknown} entry candidate entry
 * @returns {{level: number, score: number, difficulty: string|null, achieved_at: string|null}|null}
 */
function normalizeEntry(entry) {
  if (!isPlainObject(entry) || !isLevel(entry.level) || !isScore(entry.score)) {
    return null;
  }
  return {
    level: entry.level,
    score: entry.score,
    difficulty: typeof entry.difficulty === 'string' ? entry.difficulty : null,
    achieved_at: typeof entry.achieved_at === 'string' && entry.achieved_at ? entry.achieved_at : null,
  };
}

/**
 * Turn a best-score document into a map keyed by level number.
 *
 * Version 1 stores `{ version, levels: { "<level>": { score, difficulty,
 * achieved_at } } }`. Version 0 (before the wrapper) was a bare map whose
 * values were either a score or such an object. Any other version reads as
 * empty instead of being reinterpreted as the current schema.
 * @param {unknown} parsed parsed JSON document
 * @returns {Object<string, {score: number, difficulty: string|null, achieved_at: string|null}>}
 */
function migrateBest(parsed) {
  if (!isPlainObject(parsed)) {
    return {};
  }
  let source = parsed;
  if ('version' in parsed) {
    if (parsed.version !== PROGRESS_SCHEMA_VERSION || !isPlainObject(parsed.levels)) {
      return {};
    }
    source = parsed.levels;
  }
  const levels = {};
  for (const [key, value] of Object.entries(source)) {
    const level = Number(key);
    if (!isLevel(level)) {
      continue;
    }
    if (isScore(value)) {
      levels[String(level)] = { score: value, difficulty: null, achieved_at: null };
      continue;
    }
    if (!isPlainObject(value) || !isScore(value.score)) {
      continue;
    }
    levels[String(level)] = {
      score: value.score,
      difficulty: typeof value.difficulty === 'string' ? value.difficulty : null,
      achieved_at: typeof value.achieved_at === 'string' && value.achieved_at ? value.achieved_at : null,
    };
  }
  return levels;
}

/**
 * Turn a history document into an oldest-to-newest entry list.
 * Version 1 stores `{ version, entries: [...] }`; version 0 was a bare array.
 * @param {unknown} parsed parsed JSON document
 * @returns {Array<{level: number, score: number, difficulty: string|null, achieved_at: string|null}>}
 */
function migrateHistory(parsed) {
  let entries;
  if (Array.isArray(parsed)) {
    entries = parsed;
  } else if (
    isPlainObject(parsed)
    && parsed.version === PROGRESS_SCHEMA_VERSION
    && Array.isArray(parsed.entries)
  ) {
    entries = parsed.entries;
  } else {
    return [];
  }
  return entries.map(normalizeEntry).filter(Boolean);
}

/**
 * Turn a completed-levels document into a sorted, duplicate-free list.
 * Version 1 stores `{ version, levels: [1, 2] }`; version 0 was a bare array.
 * @param {unknown} parsed parsed JSON document
 * @returns {number[]} completed level numbers, ascending
 */
function migrateCompleted(parsed) {
  let levels;
  if (Array.isArray(parsed)) {
    levels = parsed;
  } else if (
    isPlainObject(parsed)
    && parsed.version === PROGRESS_SCHEMA_VERSION
    && Array.isArray(parsed.levels)
  ) {
    levels = parsed.levels;
  } else {
    return [];
  }
  return [...new Set(levels.filter(isLevel))].sort((a, b) => a - b);
}

/**
 * Key-value backend over the Capacitor Preferences plugin.
 *
 * The plugin is looked up lazily on every call because the native bridge is
 * injected into the WebView and is absent while unit tests run. On Android it
 * is SharedPreferences and on iOS NSUserDefaults, both included in the OS
 * backup model.
 * @param {object} [scope] object that carries the injected Capacitor bridge
 * @returns {{isAvailable: () => boolean, get: (key: string) => Promise<string|null>, set: (key: string, value: string) => Promise<void>}}
 */
export function createPreferencesBackend(scope = globalThis) {
  const plugin = () => scope?.Capacitor?.Plugins?.Preferences ?? null;
  return {
    isAvailable() {
      const preferences = plugin();
      return Boolean(
        preferences
        && typeof preferences.get === 'function'
        && typeof preferences.set === 'function',
      );
    },
    async get(key) {
      const preferences = plugin();
      if (!preferences) {
        return null;
      }
      const result = await preferences.get({ key });
      return typeof result?.value === 'string' ? result.value : null;
    },
    async set(key, value) {
      const preferences = plugin();
      if (!preferences) {
        throw new Error('Capacitor Preferences is unavailable');
      }
      await preferences.set({ key, value });
    },
  };
}

/**
 * Create the progress store around an injectable key-value backend.
 *
 * All mutations are serialized, so two appends that overlap cannot lose one
 * entry through a read-modify-write race. A backend that throws on write
 * leaves the previously stored record untouched and the mutation reports
 * `saved: false`; storage failures never reach gameplay.
 * @param {{get: (key: string) => Promise<string|null>, set: (key: string, value: string) => Promise<void>, isAvailable?: () => boolean}|null|undefined} backend
 * @returns {object} store API
 */
export function createProgressStore(backend) {
  let pendingWrite = Promise.resolve();

  const available = () => Boolean(
    backend
    && typeof backend.get === 'function'
    && typeof backend.set === 'function'
    && (typeof backend.isAvailable !== 'function' || backend.isAvailable()),
  );

  async function readDocument(key, migrate) {
    if (!available()) {
      return migrate(undefined);
    }
    try {
      const raw = await backend.get(key);
      return typeof raw === 'string' && raw !== '' ? migrate(JSON.parse(raw)) : migrate(undefined);
    } catch {
      return migrate(undefined);
    }
  }

  async function writeDocument(key, document) {
    if (!available()) {
      return false;
    }
    try {
      await backend.set(key, JSON.stringify(document));
      return true;
    } catch {
      return false;
    }
  }

  function serialized(operation) {
    const result = pendingWrite.then(operation, operation);
    pendingWrite = result.then(() => undefined, () => undefined);
    return result;
  }

  return {
    /** Whether progress can be persisted at all (false in plain Node tests). */
    isAvailable() {
      return available();
    },

    /**
     * Read every stored per-level best, ascending by level.
     * @returns {Promise<Array<{level: number, score: number, difficulty: string|null, achieved_at: string|null}>>}
     */
    async readBestScores() {
      const levels = await readDocument(PROGRESS_KEYS.best, migrateBest);
      return Object.entries(levels)
        .map(([key, value]) => ({ level: Number(key), ...value }))
        .sort((a, b) => a.level - b.level);
    },

    /**
     * Read the best score of one level, or 0 when none was stored.
     * @param {number} level 1-based level number
     * @returns {Promise<number>}
     */
    async readBestScore(level) {
      if (!isLevel(level)) {
        return 0;
      }
      const levels = await readDocument(PROGRESS_KEYS.best, migrateBest);
      return levels[String(level)]?.score ?? 0;
    },

    /**
     * Store a level score when it beats the stored best.
     * @param {number} level 1-based level number
     * @param {number} score level score
     * @param {string|null} [difficulty] difficulty the score was achieved on
     * @returns {Promise<{saved: boolean, score: number}>} stored best afterwards
     */
    writeBestScore(level, score, difficulty = null) {
      return serialized(async () => {
        const levels = await readDocument(PROGRESS_KEYS.best, migrateBest);
        const key = String(level);
        const existing = levels[key] ?? null;
        if (!isLevel(level) || !isScore(score)) {
          return { saved: false, score: existing?.score ?? 0 };
        }
        if (existing && existing.score >= score) {
          return { saved: false, score: existing.score };
        }
        levels[key] = {
          score,
          difficulty: typeof difficulty === 'string' ? difficulty : null,
          achieved_at: new Date().toISOString(),
        };
        const saved = await writeDocument(PROGRESS_KEYS.best, {
          version: PROGRESS_SCHEMA_VERSION,
          levels,
        });
        return { saved, score: saved ? score : existing?.score ?? 0 };
      });
    },

    /**
     * Read the timestamped score history, oldest first.
     * @returns {Promise<Array<{level: number, score: number, difficulty: string|null, achieved_at: string|null}>>}
     */
    async readHistory() {
      const entries = await readDocument(PROGRESS_KEYS.history, migrateHistory);
      return entries.slice(-SCORE_HISTORY_LIMIT);
    },

    /**
     * Append one timestamped score-history entry.
     * @param {{level: number, score: number, difficulty?: string|null, achieved_at?: string}} entry
     * @returns {Promise<{saved: boolean, entry: object|null}>}
     */
    appendHistory(entry) {
      return serialized(async () => {
        const normalized = normalizeEntry({
          achieved_at: new Date().toISOString(),
          ...entry,
        });
        if (!normalized) {
          return { saved: false, entry: null };
        }
        const entries = await readDocument(PROGRESS_KEYS.history, migrateHistory);
        entries.push(normalized);
        const saved = await writeDocument(PROGRESS_KEYS.history, {
          version: PROGRESS_SCHEMA_VERSION,
          entries: entries.slice(-SCORE_HISTORY_LIMIT),
        });
        return { saved, entry: saved ? normalized : null };
      });
    },

    /**
     * Read the completed levels, ascending.
     * @returns {Promise<number[]>}
     */
    async readCompletedLevels() {
      return readDocument(PROGRESS_KEYS.completed, migrateCompleted);
    },

    /**
     * Mark a level as completed; marking an already completed level is a no-op.
     * @param {number} level 1-based level number
     * @returns {Promise<{saved: boolean, completed: number[]}>}
     */
    markCompleted(level) {
      return serialized(async () => {
        const completed = await readDocument(PROGRESS_KEYS.completed, migrateCompleted);
        if (!isLevel(level) || completed.includes(level)) {
          return { saved: false, completed };
        }
        const next = [...completed, level].sort((a, b) => a - b);
        const saved = await writeDocument(PROGRESS_KEYS.completed, {
          version: PROGRESS_SCHEMA_VERSION,
          levels: next,
        });
        return { saved, completed: saved ? next : completed };
      });
    },
  };
}
