/**
 * Progress store v3 for Buchstabenzeit.
 *
 * Card statistics move from the localStorage document of ./storage.mjs (v2)
 * into a versioned `{ version: 3, cards: { … } }` document held by an
 * asynchronous backend. The browser backend is IndexedDB; tests inject an
 * in-memory backend. A one-time migration copies the existing v2 localStorage
 * document into v3 without dropping any counter, and a marker keeps it from
 * running twice. Documents of an unknown schema version read as empty instead
 * of throwing, and export/restore round-trips identical data.
 *
 * Language and letter-selection preferences stay in the injected key-value
 * store (localStorage on web), so their keys and behaviour are unchanged.
 */
import {
  CARD_STATS_KEY,
  toStatsMap,
  readLanguage,
  writeLanguage,
  readSelection,
  writeSelection,
} from './storage.mjs';

/** The only progress schema version this module understands. */
export const PROGRESS_VERSION = 3;

/** Backend key holding the v3 progress document. */
export const PROGRESS_KEY = 'progress';

/** Backend key marking that the one-time v2 migration already ran. */
export const MIGRATION_KEY = 'migrated-from-v2';

/** Default IndexedDB database and object-store names. */
export const DB_NAME = 'buchstabenzeit-progress';
export const STORE_NAME = 'documents';

/**
 * Whether a parsed JSON value is a plain object (not an array or null).
 * @param {unknown} value parsed JSON value
 * @returns {boolean} true for `{}`-style objects
 */
function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Deep copy of a JSON-shaped value so callers and the backend cannot share
 * mutable state.
 * @param {unknown} value JSON-shaped value
 * @returns {unknown} an independent copy
 */
function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

/**
 * Turn a parsed progress document into the card map callers expect.
 *
 * Only a versioned v3 document carries cards; anything else (non-objects,
 * arrays, documents of another version, unversioned maps) reads as empty. This
 * never throws, so a corrupt or future document degrades to "no progress"
 * instead of breaking the app.
 * @param {unknown} parsed parsed JSON document
 * @returns {object} a map of card text to { correct_count, incorrect_count }
 */
export function toCardsV3(parsed) {
  if (!isPlainObject(parsed)) {
    return {};
  }
  if (parsed.version !== PROGRESS_VERSION) {
    return {};
  }
  if (!isPlainObject(parsed.cards)) {
    return {};
  }
  return clone(parsed.cards);
}

/**
 * Build a v3 document around a card map, deep-copying the cards.
 * @param {object} [cards] map of card text to counters
 * @returns {{version: number, cards: object}} a v3 document
 */
export function makeDoc(cards) {
  return { version: PROGRESS_VERSION, cards: isPlainObject(cards) ? clone(cards) : {} };
}

/**
 * In-memory backend for tests. Values are copied on the way in and out, just
 * like IndexedDB structured clones.
 * @param {object} [initial] initial key/value pairs
 * @returns {{kind: string, get: (key: string) => Promise<unknown>, put: (key: string, value: unknown) => Promise<void>}}
 */
export function createMemoryBackend(initial = {}) {
  const data = new Map(Object.entries(initial).map(([key, value]) => [key, clone(value)]));

  return {
    kind: 'memory',
    async get(key) {
      return data.has(key) ? clone(data.get(key)) : null;
    },
    async put(key, value) {
      data.set(key, clone(value));
    },
  };
}

/**
 * Backend used when no storage API is available: reads nothing and silently
 * discards writes, so callers never have to branch.
 * @returns {{kind: string, get: () => Promise<null>, put: () => Promise<void>}}
 */
function createUnavailableBackend() {
  return {
    kind: 'unavailable',
    async get() {
      return null;
    },
    async put() {},
  };
}

/**
 * IndexedDB backend with promise-based get/put.
 *
 * One object store is created on first upgrade. When the environment has no
 * IndexedDB (older browsers, Node) the returned backend is a null-safe no-op
 * rather than an error, so the rest of the app keeps working.
 * @param {{indexedDB?: IDBFactory, name?: string, storeName?: string}} [options]
 * @returns {{kind: string, get: (key: string) => Promise<unknown>, put: (key: string, value: unknown) => Promise<void>}}
 */
export function createIndexedDbBackend({ indexedDB, name = DB_NAME, storeName = STORE_NAME } = {}) {
  if (!indexedDB || typeof indexedDB.open !== 'function') {
    return createUnavailableBackend();
  }

  let dbPromise = null;

  /** Open (once) and memoise the database. */
  function openDb() {
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(name, 1);
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains(storeName)) {
            db.createObjectStore(storeName);
          }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error('indexedDB open failed'));
      });
      // A failed open must be retried on the next call instead of cached.
      dbPromise.catch(() => {
        dbPromise = null;
      });
    }
    return dbPromise;
  }

  /** Run one request in its own transaction and settle when it completes. */
  function run(mode, action) {
    return openDb().then(
      (db) =>
        new Promise((resolve, reject) => {
          let request;
          try {
            const tx = db.transaction(storeName, mode);
            request = action(tx.objectStore(storeName));
            tx.oncomplete = () => resolve(request?.result ?? null);
            tx.onerror = () => reject(tx.error ?? request?.error ?? new Error('indexedDB request failed'));
            tx.onabort = () => reject(tx.error ?? new Error('indexedDB transaction aborted'));
          } catch (error) {
            reject(error);
          }
        }),
    );
  }

  return {
    kind: 'indexeddb',
    async get(key) {
      try {
        const value = await run('readonly', (store) => store.get(key));
        return value ?? null;
      } catch {
        return null;
      }
    },
    async put(key, value) {
      try {
        await run('readwrite', (store) => store.put(value, key));
      } catch {
        // Persisting progress is best effort; the in-memory cache stays valid.
      }
    },
  };
}

/**
 * Read the v2 card map from a key-value store (localStorage on web).
 * Unversioned legacy maps, v2 documents and unknown versions are handled by
 * the v2 parser, so the migration copies exactly what v2 would have read.
 * @param {{getItem: (key: string) => string|null}|null|undefined} store
 * @returns {object} a map of card text to counters
 */
function readV2Cards(store) {
  if (!store || typeof store.getItem !== 'function') {
    return {};
  }
  try {
    const json = store.getItem(CARD_STATS_KEY);
    if (!json) {
      return {};
    }
    return toStatsMap(JSON.parse(json));
  } catch {
    return {};
  }
}

/**
 * Copy the v2 localStorage document into the v3 backend once.
 *
 * The migration writes the copied cards only when the backend holds no v3
 * cards yet, so an existing v3 document is never overwritten, and it records a
 * marker so it never runs again. Failures are swallowed and reported as
 * `migrated: false`, leaving the app on empty progress rather than throwing.
 * @param {{backend?: Object, store?: Object}} [options]
 * @returns {Promise<{migrated: boolean, reason: string, cards: object}>}
 */
export async function migrateFromV2({ backend, store } = {}) {
  const target = backend ?? createUnavailableBackend();

  try {
    const marker = await target.get(MIGRATION_KEY);
    if (marker) {
      return { migrated: false, reason: 'already-migrated', cards: {} };
    }

    const existing = toCardsV3(await target.get(PROGRESS_KEY));
    if (Object.keys(existing).length > 0) {
      await target.put(MIGRATION_KEY, { from: 2 });
      return { migrated: false, reason: 'v3-present', cards: existing };
    }

    const cards = readV2Cards(store);
    await target.put(PROGRESS_KEY, makeDoc(cards));
    await target.put(MIGRATION_KEY, { from: 2 });
    return { migrated: true, reason: 'migrated', cards };
  } catch {
    return { migrated: false, reason: 'failed', cards: {} };
  }
}

/**
 * Create the v3 progress capability.
 *
 * Migration runs first, then the card map is hydrated into memory so `read()`
 * stays synchronous for the UI. `write()` updates the cache immediately and
 * persists through the backend, swallowing backend failures. Export and
 * restore work on deep copies, and the language/selection helpers delegate to
 * the injected key-value store exactly as before.
 * @param {{indexedDB?: IDBFactory, store?: Object, backend?: Object}} [options]
 * @returns {Promise<Object>} progress capability
 */
export async function createProgressV3({ indexedDB, store, backend } = {}) {
  const target = backend ?? createIndexedDbBackend({ indexedDB });

  await migrateFromV2({ backend: target, store });

  let cards = {};
  try {
    cards = toCardsV3(await target.get(PROGRESS_KEY));
  } catch {
    cards = {};
  }

  async function persist() {
    try {
      await target.put(PROGRESS_KEY, makeDoc(cards));
    } catch {
      // Persisting progress is best effort; the in-memory cache stays valid.
    }
  }

  return {
    kind: 'v3',
    read: () => cards,
    write(stats) {
      cards = isPlainObject(stats) ? clone(stats) : {};
      return persist();
    },
    exportData: () => makeDoc(cards),
    async restore(doc) {
      cards = toCardsV3(doc);
      await persist();
      return makeDoc(cards);
    },
    readLanguage: () => readLanguage(store),
    writeLanguage: (lang) => writeLanguage(store, lang),
    readSelection: (lang) => readSelection(store, lang),
    writeSelection: (lang, selection) => writeSelection(store, lang, selection),
  };
}
