import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PROGRESS_KEYS,
  PROGRESS_SCHEMA_VERSION,
  SCORE_HISTORY_LIMIT,
  createPreferencesBackend,
  createProgressStore,
} from '../game/progress-store.js';

/** Minimal in-memory key-value backend that can simulate a failing write. */
function createFakeBackend(initial = {}) {
  const data = new Map(Object.entries(initial));
  const backend = {
    data,
    writes: [],
    failWrites: false,
    async get(key) {
      return data.has(key) ? data.get(key) : null;
    },
    async set(key, value) {
      if (backend.failWrites) {
        throw new Error('storage unavailable');
      }
      backend.writes.push({ key, value });
      data.set(key, value);
    },
  };
  return backend;
}

const readJson = (backend, key) => JSON.parse(backend.data.get(key));

test('an empty store reads as empty', async () => {
  const store = createProgressStore(createFakeBackend());

  assert.equal(store.isAvailable(), true);
  assert.deepEqual(await store.readBestScores(), []);
  assert.equal(await store.readBestScore(1), 0);
  assert.deepEqual(await store.readHistory(), []);
  assert.deepEqual(await store.readCompletedLevels(), []);
});

test('a missing or unusable backend never throws', async () => {
  for (const backend of [undefined, null, {}]) {
    const store = createProgressStore(backend);
    assert.equal(store.isAvailable(), false);
    assert.deepEqual(await store.readBestScores(), []);
    assert.equal(await store.readBestScore(1), 0);
    assert.deepEqual(await store.readHistory(), []);
    assert.deepEqual(await store.readCompletedLevels(), []);
    assert.deepEqual(await store.writeBestScore(1, 10), { saved: false, score: 0 });
    assert.deepEqual(await store.appendHistory({ level: 1, score: 10 }), { saved: false, entry: null });
    assert.deepEqual(await store.markCompleted(1), { saved: false, completed: [] });
  }
});

test('stores a per-level best score only when it improves', async () => {
  const store = createProgressStore(createFakeBackend());

  assert.deepEqual(await store.writeBestScore(3, 120, 'easy'), { saved: true, score: 120 });
  assert.equal(await store.readBestScore(3), 120);

  assert.deepEqual(await store.writeBestScore(3, 90, 'hard'), { saved: false, score: 120 });
  assert.equal(await store.readBestScore(3), 120);

  assert.deepEqual(await store.writeBestScore(3, 150, 'hard'), { saved: true, score: 150 });
  assert.equal(await store.readBestScore(3), 150);
  assert.equal(await store.readBestScore(4), 0);

  const [best] = await store.readBestScores();
  assert.equal(best.level, 3);
  assert.equal(best.score, 150);
  assert.equal(best.difficulty, 'hard');
  assert.match(best.achieved_at, /^\d{4}-\d{2}-\d{2}T/);
});

test('reads per-level bests ascending by level', async () => {
  const store = createProgressStore(createFakeBackend());
  await store.writeBestScore(5, 50);
  await store.writeBestScore(1, 10);

  assert.deepEqual((await store.readBestScores()).map((best) => best.level), [1, 5]);
});

test('appends timestamped score history oldest first', async () => {
  const store = createProgressStore(createFakeBackend());

  const first = await store.appendHistory({
    level: 1, score: 40, difficulty: 'easy', achieved_at: '2026-01-01T10:00:00.000Z',
  });
  const second = await store.appendHistory({ level: 2, score: 70, difficulty: 'medium' });
  assert.equal(first.saved, true);
  assert.equal(second.saved, true);

  const history = await store.readHistory();
  assert.deepEqual(history.map((entry) => entry.score), [40, 70]);
  assert.equal(history[0].achieved_at, '2026-01-01T10:00:00.000Z');
  assert.match(history[1].achieved_at, /^\d{4}-\d{2}-\d{2}T/);
  assert.deepEqual(history[1], {
    level: 2, score: 70, difficulty: 'medium', achieved_at: history[1].achieved_at,
  });
});

test('keeps only the most recent history entries', async () => {
  const store = createProgressStore(createFakeBackend());
  for (let score = 0; score < SCORE_HISTORY_LIMIT + 5; score++) {
    await store.appendHistory({ level: 1, score });
  }

  const history = await store.readHistory();
  assert.equal(history.length, SCORE_HISTORY_LIMIT);
  assert.equal(history[0].score, 5);
  assert.equal(history.at(-1).score, SCORE_HISTORY_LIMIT + 4);
});

test('marks levels completed once and reads them sorted', async () => {
  const store = createProgressStore(createFakeBackend());

  assert.deepEqual(await store.markCompleted(3), { saved: true, completed: [3] });
  await store.markCompleted(1);
  assert.deepEqual(await store.markCompleted(3), { saved: false, completed: [1, 3] });
  assert.deepEqual(await store.readCompletedLevels(), [1, 3]);
});

test('writes one record per key with a single atomic write', async () => {
  const backend = createFakeBackend();
  const store = createProgressStore(backend);

  await store.writeBestScore(2, 30, 'easy');
  await store.appendHistory({ level: 2, score: 30, difficulty: 'easy' });
  await store.markCompleted(2);

  assert.deepEqual(
    [...backend.data.keys()].sort(),
    [PROGRESS_KEYS.best, PROGRESS_KEYS.completed, PROGRESS_KEYS.history].sort(),
  );
  assert.equal(backend.writes.length, 3);
  assert.deepEqual(backend.writes.map((write) => write.key), [
    PROGRESS_KEYS.best, PROGRESS_KEYS.history, PROGRESS_KEYS.completed,
  ]);
  for (const write of backend.writes) {
    assert.equal(JSON.parse(write.value).version, PROGRESS_SCHEMA_VERSION);
  }

  // A later best-score write rewrites only the best record.
  await store.writeBestScore(2, 40, 'easy');
  assert.equal(backend.writes.at(-1).key, PROGRESS_KEYS.best);
  assert.equal((await store.readHistory()).length, 1);
  assert.deepEqual(await store.readCompletedLevels(), [2]);
});

test('a failed write leaves the previous record intact', async () => {
  const backend = createFakeBackend();
  const store = createProgressStore(backend);
  await store.writeBestScore(1, 80, 'easy');
  await store.appendHistory({ level: 1, score: 80, difficulty: 'easy' });
  const before = new Map(backend.data);

  backend.failWrites = true;
  assert.deepEqual(await store.writeBestScore(1, 90, 'easy'), { saved: false, score: 80 });
  assert.deepEqual(
    await store.appendHistory({ level: 1, score: 90, difficulty: 'easy' }),
    { saved: false, entry: null },
  );
  assert.deepEqual(await store.markCompleted(1), { saved: false, completed: [] });

  assert.deepEqual(new Map(backend.data), before);
  assert.equal(await store.readBestScore(1), 80);
  assert.equal((await store.readHistory()).length, 1);
  assert.deepEqual(await store.readCompletedLevels(), []);
});

test('corrupt data reads as empty without throwing', async () => {
  const backend = createFakeBackend({
    [PROGRESS_KEYS.best]: '{"version":1,"levels":',
    [PROGRESS_KEYS.history]: 'not json',
    [PROGRESS_KEYS.completed]: '',
  });
  const store = createProgressStore(backend);

  assert.deepEqual(await store.readBestScores(), []);
  assert.equal(await store.readBestScore(1), 0);
  assert.deepEqual(await store.readHistory(), []);
  assert.deepEqual(await store.readCompletedLevels(), []);

  // The next write replaces the corrupt record with a valid document.
  await store.writeBestScore(1, 25);
  assert.equal(readJson(backend, PROGRESS_KEYS.best).levels['1'].score, 25);

  // Structurally valid documents with unusable entries keep the usable ones.
  const partial = createFakeBackend({
    [PROGRESS_KEYS.history]: JSON.stringify([{ level: 1, score: 10 }, { level: 'x', score: 5 }, null]),
    [PROGRESS_KEYS.completed]: JSON.stringify([2, 0, '3']),
  });
  const tolerant = createProgressStore(partial);
  assert.deepEqual((await tolerant.readHistory()).map((entry) => entry.score), [10]);
  assert.deepEqual(await tolerant.readCompletedLevels(), [2]);
});

test('unknown schema versions and shapes read as empty', async () => {
  const newer = createFakeBackend({
    [PROGRESS_KEYS.best]: JSON.stringify({ version: 2, levels: { 1: { score: 500 } } }),
    [PROGRESS_KEYS.history]: JSON.stringify({ version: 2, entries: [{ level: 1, score: 500 }] }),
    [PROGRESS_KEYS.completed]: JSON.stringify({ version: 2, levels: [1] }),
  });
  const store = createProgressStore(newer);
  assert.deepEqual(await store.readBestScores(), []);
  assert.deepEqual(await store.readHistory(), []);
  assert.deepEqual(await store.readCompletedLevels(), []);

  const wrongShape = createFakeBackend({
    [PROGRESS_KEYS.best]: JSON.stringify([1, 2]),
    [PROGRESS_KEYS.history]: JSON.stringify({ version: 1, entries: 'nope' }),
    [PROGRESS_KEYS.completed]: JSON.stringify({ version: 1, levels: {} }),
  });
  const shaped = createProgressStore(wrongShape);
  assert.deepEqual(await shaped.readBestScores(), []);
  assert.deepEqual(await shaped.readHistory(), []);
  assert.deepEqual(await shaped.readCompletedLevels(), []);
});

test('migrates version 0 documents and persists the current version', async () => {
  const backend = createFakeBackend({
    [PROGRESS_KEYS.best]: JSON.stringify({
      2: 40,
      3: { score: 70, difficulty: 'hard', achieved_at: '2026-02-01T08:00:00.000Z' },
    }),
    [PROGRESS_KEYS.history]: JSON.stringify([
      { level: 1, score: 10, achieved_at: '2026-01-01T08:00:00.000Z' },
      { level: 1, score: 20 },
    ]),
    [PROGRESS_KEYS.completed]: JSON.stringify([1, 2]),
  });
  const store = createProgressStore(backend);

  assert.deepEqual(await store.readBestScores(), [
    { level: 2, score: 40, difficulty: null, achieved_at: null },
    { level: 3, score: 70, difficulty: 'hard', achieved_at: '2026-02-01T08:00:00.000Z' },
  ]);
  assert.deepEqual((await store.readHistory()).map((entry) => entry.score), [10, 20]);
  assert.deepEqual(await store.readCompletedLevels(), [1, 2]);

  await store.writeBestScore(2, 45);
  const migratedBest = readJson(backend, PROGRESS_KEYS.best);
  assert.equal(migratedBest.version, PROGRESS_SCHEMA_VERSION);
  assert.equal(migratedBest.levels['2'].score, 45);
  assert.equal(migratedBest.levels['3'].score, 70);

  await store.appendHistory({ level: 2, score: 45 });
  const migratedHistory = readJson(backend, PROGRESS_KEYS.history);
  assert.equal(migratedHistory.version, PROGRESS_SCHEMA_VERSION);
  assert.deepEqual(migratedHistory.entries.map((entry) => entry.score), [10, 20, 45]);
});

test('ignores invalid levels, scores and entries', async () => {
  const store = createProgressStore(createFakeBackend());

  assert.deepEqual(await store.writeBestScore(0, 10), { saved: false, score: 0 });
  assert.deepEqual(await store.writeBestScore(1.5, 10), { saved: false, score: 0 });
  assert.deepEqual(await store.writeBestScore(1, -3), { saved: false, score: 0 });
  assert.deepEqual(await store.writeBestScore(1, Number.NaN), { saved: false, score: 0 });
  assert.deepEqual(await store.appendHistory({ level: 1, score: 'high' }), { saved: false, entry: null });
  assert.deepEqual(await store.markCompleted(0), { saved: false, completed: [] });
  assert.equal(await store.readBestScore('1'), 0);
});

test('concurrent appends keep every entry', async () => {
  const store = createProgressStore(createFakeBackend());
  await Promise.all([1, 2, 3, 4, 5].map((score) => store.appendHistory({ level: 1, score })));

  const scores = (await store.readHistory()).map((entry) => entry.score).sort((a, b) => a - b);
  assert.deepEqual(scores, [1, 2, 3, 4, 5]);
});

test('the Capacitor Preferences backend reads and writes the plugin', async () => {
  const values = new Map();
  const scope = {
    Capacitor: {
      Plugins: {
        Preferences: {
          async get({ key }) {
            return { value: values.has(key) ? values.get(key) : null };
          },
          async set({ key, value }) {
            values.set(key, value);
          },
        },
      },
    },
  };
  const store = createProgressStore(createPreferencesBackend(scope));

  assert.equal(store.isAvailable(), true);
  await store.writeBestScore(1, 60, 'easy');
  await store.appendHistory({ level: 1, score: 60, difficulty: 'easy' });
  await store.markCompleted(1);

  assert.equal(values.size, 3);
  assert.equal(await store.readBestScore(1), 60);
  assert.equal((await store.readHistory()).length, 1);
  assert.deepEqual(await store.readCompletedLevels(), [1]);
});

test('the Capacitor Preferences backend is unavailable outside the app', async () => {
  const scopes = [
    undefined,
    {},
    { Capacitor: {} },
    { Capacitor: { Plugins: { Preferences: { get() {} } } } },
  ];
  for (const scope of scopes) {
    const store = createProgressStore(createPreferencesBackend(scope));
    assert.equal(store.isAvailable(), false);
    assert.deepEqual(await store.readHistory(), []);
    assert.equal((await store.appendHistory({ level: 1, score: 1 })).saved, false);
  }
});
