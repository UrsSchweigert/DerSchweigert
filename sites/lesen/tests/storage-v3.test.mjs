import test from 'node:test';
import assert from 'node:assert';
import { recordAttempt } from '../static/scoring.mjs';
import { CARD_STATS_KEY } from '../static/storage.mjs';
import {
  createMemoryBackend,
  createIndexedDbBackend,
  createProgressV3,
  makeDoc,
  migrateFromV2,
  toCardsV3,
  MIGRATION_KEY,
  PROGRESS_KEY,
} from '../static/storage-v3.mjs';

/** Minimal in-memory stand-in for localStorage. */
function createFakeStore(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => {
      data.set(key, String(value));
    },
  };
}

/**
 * Minimal fake IndexedDB: open/onupgradeneeded, one object store per database,
 * transaction/objectStore/get/put, with asynchronous request dispatch.
 */
function createFakeIndexedDB() {
  const databases = new Map();

  function makeDb(record) {
    return {
      objectStoreNames: { contains: (name) => record.stores.has(name) },
      createObjectStore(name) {
        record.stores.set(name, new Map());
        return {};
      },
      transaction(storeName, mode) {
        const storeData = record.stores.get(storeName);
        const pending = [];
        const store = {
          get(key) {
            const request = { result: undefined, error: null, onsuccess: null, onerror: null };
            pending.push(() => {
              request.result = storeData?.has(key) ? structuredClone(storeData.get(key)) : undefined;
              request.onsuccess?.();
            });
            return request;
          },
          put(value, key) {
            const request = { result: key, error: null, onsuccess: null, onerror: null };
            pending.push(() => {
              if (!storeData) throw new Error('missing object store ' + storeName);
              if (mode !== 'readwrite') throw new Error('read-only transaction');
              storeData.set(key, structuredClone(value));
              request.onsuccess?.();
            });
            return request;
          },
        };
        const tx = { oncomplete: null, onerror: null, onabort: null, error: null, objectStore: () => store };
        setTimeout(() => {
          try {
            for (const operation of pending) operation();
            tx.oncomplete?.();
          } catch (error) {
            tx.error = error;
            tx.onerror?.();
          }
        }, 0);
        return tx;
      },
    };
  }

  return {
    databases,
    open(name) {
      const request = { onupgradeneeded: null, onsuccess: null, onerror: null, result: undefined, error: null };
      setTimeout(() => {
        const fresh = !databases.has(name);
        if (fresh) {
          databases.set(name, { stores: new Map() });
        }
        const db = makeDb(databases.get(name));
        request.result = db;
        if (fresh) {
          request.onupgradeneeded?.({ target: request });
        }
        request.onsuccess?.({ target: request });
      }, 0);
      return request;
    },
  };
}

const V2_STATS = {
  Hut: { correct_count: 4, incorrect_count: 2 },
  'Mama malt.': { correct_count: 7, incorrect_count: 1 },
  'ta': { correct_count: 3, incorrect_count: 5, flop_seen: true },
};

test('v3: v2 localStorage statistics migrate losslessly with every counter kept', async () => {
  const store = createFakeStore({ [CARD_STATS_KEY]: JSON.stringify(V2_STATS) });
  const backend = createMemoryBackend();

  const result = await migrateFromV2({ backend, store });

  assert.equal(result.migrated, true);
  assert.deepEqual(result.cards, V2_STATS);
  assert.deepEqual(await backend.get(PROGRESS_KEY), { version: 3, cards: V2_STATS });
  assert.ok(await backend.get(MIGRATION_KEY));
});

test('v3: a versioned v2 document migrates as its card map', async () => {
  const store = createFakeStore({ [CARD_STATS_KEY]: JSON.stringify({ version: 2, cards: V2_STATS }) });
  const backend = createMemoryBackend();

  await migrateFromV2({ backend, store });

  assert.deepEqual(toCardsV3(await backend.get(PROGRESS_KEY)), V2_STATS);
});

test('v3: migration runs once and never overwrites existing v3 cards', async () => {
  const store = createFakeStore({ [CARD_STATS_KEY]: JSON.stringify(V2_STATS) });
  const backend = createMemoryBackend({ [PROGRESS_KEY]: { version: 3, cards: { Neu: { correct_count: 1, incorrect_count: 0 } } } });

  const first = await migrateFromV2({ backend, store });
  assert.equal(first.migrated, false);
  assert.equal(first.reason, 'v3-present');
  assert.deepEqual(toCardsV3(await backend.get(PROGRESS_KEY)), {
    Neu: { correct_count: 1, incorrect_count: 0 },
  });

  store.setItem(CARD_STATS_KEY, JSON.stringify({ Spaeter: { correct_count: 9, incorrect_count: 9 } }));
  const second = await migrateFromV2({ backend, store });
  assert.equal(second.migrated, false);
  assert.equal(second.reason, 'already-migrated');
  assert.deepEqual(toCardsV3(await backend.get(PROGRESS_KEY)), {
    Neu: { correct_count: 1, incorrect_count: 0 },
  });
});

test('v3: a repeated migration after a fresh run is a no-op', async () => {
  const store = createFakeStore({ [CARD_STATS_KEY]: JSON.stringify(V2_STATS) });
  const backend = createMemoryBackend();

  assert.equal((await migrateFromV2({ backend, store })).migrated, true);
  const again = await migrateFromV2({ backend, store });
  assert.equal(again.migrated, false);
  assert.equal(again.reason, 'already-migrated');
  assert.deepEqual(toCardsV3(await backend.get(PROGRESS_KEY)), V2_STATS);
});

test('v3: unknown schema versions read as empty without throwing', () => {
  for (const document of [
    { version: 1, cards: V2_STATS },
    { version: 99, cards: V2_STATS },
    { version: 2, cards: V2_STATS },
    { version: '3', cards: V2_STATS },
    { cards: V2_STATS },
    { version: 3, cards: null },
    { version: 3, cards: [] },
    V2_STATS,
    [],
    null,
    undefined,
    'not json',
  ]) {
    assert.doesNotThrow(() => toCardsV3(document));
    assert.deepEqual(toCardsV3(document), {});
  }
});

test('v3: an unknown-version backend document hydrates as empty progress', async () => {
  const backend = createMemoryBackend({
    [PROGRESS_KEY]: { version: 42, cards: V2_STATS },
    [MIGRATION_KEY]: { from: 2 },
  });
  const progress = await createProgressV3({ backend, store: createFakeStore() });

  assert.deepEqual(progress.read(), {});
});

test('v3: export then restore round-trips identical data', async () => {
  const store = createFakeStore();
  const backend = createMemoryBackend();
  const progress = await createProgressV3({ backend, store });

  const stats = {};
  recordAttempt(stats, 'Hut', true);
  recordAttempt(stats, 'Hut', false);
  recordAttempt(stats, 'Mama malt.', true);
  await progress.write(stats);

  const exported = progress.exportData();
  assert.deepEqual(exported, { version: 3, cards: stats });

  await progress.write({});
  assert.deepEqual(progress.read(), {});

  const restored = await progress.restore(exported);
  assert.deepEqual(restored, { version: 3, cards: stats });
  assert.deepEqual(progress.read(), stats);
  assert.deepEqual(toCardsV3(await backend.get(PROGRESS_KEY)), stats);
  assert.deepEqual(progress.exportData(), exported);
});

test('v3: export is a deep copy that cannot mutate stored progress', async () => {
  const backend = createMemoryBackend();
  const progress = await createProgressV3({ backend, store: createFakeStore() });

  await progress.write({ Hut: { correct_count: 2, incorrect_count: 0 } });
  const exported = progress.exportData();
  exported.cards.Hut.correct_count = 99;

  assert.deepEqual(progress.read(), { Hut: { correct_count: 2, incorrect_count: 0 } });
});

test('v3: read after write returns the written statistics and persists a v3 document', async () => {
  const backend = createMemoryBackend();
  const progress = await createProgressV3({ backend, store: createFakeStore() });

  const stats = { Hut: { correct_count: 1, incorrect_count: 0 } };
  await progress.write(stats);

  assert.deepEqual(progress.read(), stats);
  assert.deepEqual(await backend.get(PROGRESS_KEY), makeDoc(stats));
});

test('v3: a corrupt v3 document reads as empty and writes still persist', async () => {
  const backend = createMemoryBackend({ [PROGRESS_KEY]: { version: 3, cards: 'nope' }, [MIGRATION_KEY]: {} });
  const progress = await createProgressV3({ backend, store: createFakeStore() });

  assert.deepEqual(progress.read(), {});
  await progress.write({ Hut: { correct_count: 1, incorrect_count: 1 } });
  assert.deepEqual(toCardsV3(await backend.get(PROGRESS_KEY)), {
    Hut: { correct_count: 1, incorrect_count: 1 },
  });
});

test('v3: the browser path migrates, writes and round-trips through IndexedDB', async () => {
  const store = createFakeStore({ [CARD_STATS_KEY]: JSON.stringify(V2_STATS) });
  const indexedDB = createFakeIndexedDB();

  const progress = await createProgressV3({ indexedDB, store });
  assert.deepEqual(progress.read(), V2_STATS);

  const stats = { ...progress.read(), Neu: { correct_count: 1, incorrect_count: 0 } };
  await progress.write(stats);

  const reopened = await createProgressV3({ indexedDB, store });
  assert.deepEqual(reopened.read(), stats);

  const exported = reopened.exportData();
  await reopened.write({});
  await reopened.restore(exported);
  assert.deepEqual(reopened.read(), stats);
});

test('v3: the IndexedDB backend is a null-safe no-op without indexedDB', async () => {
  const backend = createIndexedDbBackend({});
  assert.equal(backend.kind, 'unavailable');
  assert.equal(await backend.get(PROGRESS_KEY), null);
  await assert.doesNotReject(() => backend.put(PROGRESS_KEY, { version: 3, cards: {} }));

  const progress = await createProgressV3({ store: createFakeStore() });
  assert.deepEqual(progress.read(), {});
  await assert.doesNotReject(() => progress.write({ Hut: { correct_count: 1, incorrect_count: 0 } }));
});

test('v3: language and selection still reach the injected localStorage store', async () => {
  const store = createFakeStore();
  const progress = await createProgressV3({ backend: createMemoryBackend(), store });

  assert.equal(progress.readLanguage(), 'de');
  progress.writeLanguage('en');
  assert.equal(progress.readLanguage(), 'en');
  assert.equal(store.data.get('buchstabenzeit:language'), 'en');

  assert.equal(progress.readSelection('de'), null);
  progress.writeSelection('de', { consonants: new Set(['b']), vowels: ['i'], specials: [] });
  assert.deepEqual(progress.readSelection('de'), { consonants: ['b'], vowels: ['i'], specials: [] });
  assert.equal(store.data.get('buchstabenzeit:selection:de'), '{"consonants":["b"],"vowels":["i"],"specials":[]}');
});
