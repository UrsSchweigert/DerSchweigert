import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createProfileStore, PROFILE_KEY, PROFILE_SCHEMA_VERSION } from '../game/profile-store.js';
import { SCORE_HISTORY_LIMIT, PROGRESS_KEYS } from '../game/progress-store.js';

function fixture(initial = {}) {
  const data = new Map(Object.entries(initial));
  let id = 0;
  const backend = {
    failReads: false, failWrites: false, writes: [],
    async get(key) {
      if (this.failReads) throw new Error('read failed');
      return data.get(key) ?? null;
    },
    async set(key, value) {
      if (this.failWrites) throw new Error('write failed');
      this.writes.push({ key, value });
      data.set(key, value);
    },
  };
  const options = { makeId: () => `profile-${++id}`, now: () => '2026-11-08T12:00:00.000Z' };
  const store = createProfileStore(backend, options);
  return { store, backend, data, options };
}
const completion = (profileId, completionId, score = 10, level = 1) => ({
  profileId, completionId, level, score, difficulty: 'easy',
});
const storageError = { code: 'storage_unavailable' };
const attempt = (overrides = {}) => ({
  firstAttemptCorrect: 2, firstAttemptTotal: 3, correctAnswers: 3,
  incorrectAnswers: 1, timeouts: 0, bestStreak: 2, ...overrides,
});

test('fresh initialization creates a default, skips legacy records and preserves device entitlement', async () => {
  const initial = {
    'arithmoslayer:entitlement': '{"premium_access":true}',
    [PROGRESS_KEYS.best]: '{"version":1,"levels":{"1":{"score":500}}}',
  };
  const { store, backend, data } = fixture(initial);
  const active = await store.initialize({ defaultName: ' Player 1 ' });
  assert.deepEqual(active, { id: 'profile-1', name: 'Player 1' });
  assert.deepEqual(store.getActiveProfile(), active);
  assert.deepEqual(await store.listProfiles(), [active]);
  assert.deepEqual(await store.getBestScores(active.id), { best: [] });
  assert.equal(backend.writes.length, 1);
  assert.equal(JSON.parse(data.get(PROFILE_KEY)).version, PROFILE_SCHEMA_VERSION);
  for (const [key, value] of Object.entries(initial)) assert.equal(data.get(key), value);
  await store.initialize({ defaultName: 'Ignored' });
  assert.equal(backend.writes.length, 1);
});

test('duplicate names have stable IDs and isolated progress across selection and reload', async () => {
  const { store, backend, options, data } = fixture({ 'arithmoslayer:entitlement': 'device-wide' });
  const first = await store.initialize({ defaultName: 'Alex' });
  const second = await store.createProfile('Alex');
  assert.notEqual(first.id, second.id);
  assert.deepEqual(store.getActiveProfile(), second);
  await store.recordLevel(completion(first.id, 'run-1', 90, 3));
  await store.recordLevel(completion(second.id, 'run-1', 30, 2));
  assert.equal((await store.getBestScores(first.id)).best[0].score, 90);
  assert.equal((await store.getScoreHistory(second.id)).history[0].score, 30);
  assert.deepEqual(await store.getCompletedLevels(first.id), { completed: [3] });
  await store.selectProfile(first.id);
  const reloaded = createProfileStore(backend, options);
  await reloaded.initialize();
  assert.deepEqual(reloaded.getActiveProfile(), first);
  assert.deepEqual(await reloaded.listProfiles(), [first, second]);
  assert.deepEqual(await reloaded.getBestScores(first.id), await store.getBestScores(first.id));
  assert.deepEqual(await reloaded.getScoreHistory(second.id), await store.getScoreHistory(second.id));
  assert.equal(data.get('arithmoslayer:entitlement'), 'device-wide');
});

test('one completion commits best, history, completed and receipt with one write', async () => {
  const { store, backend, data } = fixture();
  const profile = await store.initialize();
  backend.writes.length = 0;
  assert.deepEqual(await store.recordLevel(completion(profile.id, 'run')), { persisted: true, bestImproved: true });
  assert.equal(backend.writes.length, 1);
  assert.equal(backend.writes[0].key, PROFILE_KEY);
  const stored = JSON.parse(data.get(PROFILE_KEY)).profiles[0];
  assert.equal(stored.best[0].score, 10);
  assert.equal(stored.history[0].score, 10);
  assert.deepEqual(stored.completed, [1]);
  assert.equal(stored.completions.run.bestImproved, true);
  assert.deepEqual(stored.best[0], {
    level: 1, score: 10, difficulty: 'easy', achieved_at: '2026-11-08T12:00:00.000Z',
  });
});

test('lower and zero scores still persist completed progress without best improvements', async () => {
  const { store } = fixture();
  const { id } = await store.initialize();
  await store.recordLevel(completion(id, 'high', 40));
  assert.deepEqual(await store.recordLevel(completion(id, 'low', 20)), { persisted: true, bestImproved: false });
  assert.deepEqual(await store.recordLevel(completion(id, 'zero', 0, 2)), { persisted: true, bestImproved: false });
  assert.equal((await store.getBestScores(id)).best[0].score, 40);
  assert.equal((await store.getScoreHistory(id)).history.length, 3);
  assert.deepEqual(await store.getCompletedLevels(id), { completed: [1, 2] });
});

test('overlapping writes serialize without losing progress, and invocation captures the owner', async () => {
  const { store } = fixture();
  const first = await store.initialize();
  const second = await store.createProfile('Second');
  const input = completion(first.id, 'first', 50, 3);
  const pending = store.recordLevel(input);
  input.profileId = second.id;
  input.score = 999;
  await Promise.all([
    pending,
    store.selectProfile(second.id),
    store.recordLevel(completion(first.id, 'second', 70, 2)),
    store.recordLevel(completion(first.id, 'third', 90, 1)),
  ]);
  assert.deepEqual((await store.getScoreHistory(first.id)).history.map((entry) => entry.score), [50, 70, 90]);
  assert.deepEqual((await store.getBestScores(first.id)).best.map((entry) => entry.level), [1, 2, 3]);
  assert.deepEqual(await store.getCompletedLevels(first.id), { completed: [1, 2, 3] });
  assert.deepEqual(await store.getScoreHistory(second.id), { history: [] });
});

test('idempotent receipts survive reload and history truncation, including special ID strings', async () => {
  const { store, backend, options } = fixture();
  const { id } = await store.initialize();
  const original = completion(id, '__proto__', 20);
  const result = await store.recordLevel(original);
  const writes = backend.writes.length;
  assert.deepEqual(await store.recordLevel(original), result);
  assert.equal(backend.writes.length, writes);
  for (let index = 0; index < SCORE_HISTORY_LIMIT + 3; index++) {
    await store.recordLevel(completion(id, `run-${index}`, index));
  }
  const reloaded = createProfileStore(backend, options);
  await reloaded.initialize();
  const before = await reloaded.getScoreHistory(id);
  assert.equal(before.history.length, SCORE_HISTORY_LIMIT);
  assert.deepEqual(await reloaded.recordLevel(original), result);
  assert.deepEqual(await reloaded.getScoreHistory(id), before);
  await assert.rejects(reloaded.recordLevel({ ...original, score: 999 }), { code: 'completion_conflict' });
});

test('a failed completion rejects and preserves all committed state, with a successful retry', async () => {
  const { store, backend, data } = fixture();
  const { id } = await store.initialize();
  await store.recordLevel(completion(id, 'before', 40));
  const before = data.get(PROFILE_KEY);
  backend.failWrites = true;
  await assert.rejects(store.recordLevel(completion(id, 'retry', 90, 2)), storageError);
  assert.equal(data.get(PROFILE_KEY), before);
  assert.equal((await store.getScoreHistory(id)).history.length, 1);
  assert.deepEqual(await store.getCompletedLevels(id), { completed: [1] });
  backend.failWrites = false;
  assert.deepEqual(await store.recordLevel(completion(id, 'retry', 90, 2)), { persisted: true, bestImproved: true });
  assert.equal((await store.getScoreHistory(id)).history.length, 2);
});

test('failed initialization and unavailable backends never appear initialized', async () => {
  for (const backend of [undefined, {}, { get() {}, set() {}, isAvailable: () => false }]) {
    const store = createProfileStore(backend);
    await assert.rejects(store.initialize(), storageError);
    assert.throws(() => store.getActiveProfile(), storageError);
  }
  const { store, backend, data } = fixture();
  backend.failWrites = true;
  await assert.rejects(store.initialize(), storageError);
  assert.throws(() => store.getActiveProfile(), storageError);
  assert.equal(data.has(PROFILE_KEY), false);
  backend.failWrites = false;
  await store.initialize();
  assert.equal((await store.listProfiles()).length, 1);
});

test('read failures, corrupt data and unsupported versions never trigger replacement writes', async () => {
  for (const raw of ['broken', '{}', '{"version":2,"profiles":[]}', '']) {
    const { store, backend, data } = fixture({ [PROFILE_KEY]: raw });
    await assert.rejects(store.initialize(), storageError);
    assert.equal(backend.writes.length, 0);
    assert.equal(data.get(PROFILE_KEY), raw);
  }
  const { store, backend, data } = fixture({ [PROFILE_KEY]: 'keep-existing' });
  backend.failReads = true;
  await assert.rejects(store.initialize(), storageError);
  assert.equal(backend.writes.length, 0);
  assert.equal(data.get(PROFILE_KEY), 'keep-existing');
});

test('rename preserves IDs; deletion requires confirmation and preserves one profile', async () => {
  const { store } = fixture();
  const first = await store.initialize();
  const second = await store.createProfile('Other');
  await store.recordLevel(completion(second.id, 'second', 80));
  assert.deepEqual(await store.renameProfile(second.id, 'Renamed'), { id: second.id, name: 'Renamed' });
  assert.equal((await store.getBestScores(second.id)).best[0].score, 80);
  await assert.rejects(store.deleteProfile(second.id), { code: 'confirmation_required' });
  assert.deepEqual(await store.deleteProfile(second.id, { confirmed: true }), first);
  assert.deepEqual(store.getActiveProfile(), first);
  await assert.rejects(store.getBestScores(second.id), { code: 'profile_not_found' });
  await assert.rejects(store.deleteProfile(first.id, { confirmed: true }), { code: 'last_profile' });
});

test('failed create/select/rename/delete preserve visible committed state', async () => {
  const { store, backend, data } = fixture();
  const first = await store.initialize();
  const second = await store.createProfile('Other');
  const before = data.get(PROFILE_KEY);
  backend.failWrites = true;
  for (const operation of [
    () => store.createProfile('New'),
    () => store.selectProfile(first.id),
    () => store.renameProfile(second.id, 'Changed'),
    () => store.deleteProfile(second.id, { confirmed: true }),
  ]) await assert.rejects(operation(), storageError);
  assert.equal(data.get(PROFILE_KEY), before);
  assert.deepEqual(store.getActiveProfile(), second);
  assert.deepEqual(await store.listProfiles(), [first, second]);
});

test('invalid names, IDs and completion inputs reject before writing', async () => {
  const { store, backend } = fixture();
  const { id } = await store.initialize();
  const writes = backend.writes.length;
  for (const name of ['', ' ', 'x'.repeat(41), null]) {
    await assert.rejects(store.createProfile(name), { code: 'invalid_profile_name' });
  }
  for (const input of [null, completion(id, '', 10), completion(id, 'x', -1), completion(id, 'x', 10, 0)]) {
    await assert.rejects(store.recordLevel(input), { code: 'invalid_completion' });
  }
  await assert.rejects(store.recordLevel(completion(undefined, 'x')), { code: 'profile_not_found' });
  assert.equal(backend.writes.length, writes);
  const duplicate = createProfileStore(backend, { makeId: () => id });
  await duplicate.initialize();
  await assert.rejects(duplicate.createProfile('New'), { code: 'invalid_profile_id' });
});

test('summaries commit atomically and compare only the previous same-level same-difficulty attempt', async () => {
  const { store, backend, data, options } = fixture();
  const first = await store.initialize();
  const second = await store.createProfile('Second');
  assert.equal(await store.getAttemptSummary(first.id, 1, 'easy'), null);
  const summary = attempt();
  const firstRun = { ...completion(first.id, 'first'), attemptSummary: summary };
  const writes = backend.writes.length;
  assert.deepEqual(await store.recordLevel(firstRun), {
    persisted: true, bestImproved: true, previousAttemptSummary: null,
  });
  assert.equal(backend.writes.length, writes + 1);
  const saved = JSON.parse(data.get(PROFILE_KEY)).profiles[0];
  assert.deepEqual(saved.history[0].attemptSummary, summary);
  assert.deepEqual(saved.best[0].attemptSummary, summary);
  assert.deepEqual(saved.completions.first.attemptSummary, summary);
  assert.equal(await store.getAttemptSummary(second.id, 1, 'easy'), null);
  assert.equal(await store.getAttemptSummary(first.id, 2, 'easy'), null);
  assert.equal(await store.getAttemptSummary(first.id, 1, 'hard'), null);
  const different = [
    { ...completion(second.id, 'first'), attemptSummary: summary },
    { ...completion(first.id, 'hard'), difficulty: 'hard', attemptSummary: summary },
    { ...completion(first.id, 'level2', 30, 2), attemptSummary: summary },
  ];
  for (const input of different) assert.equal((await store.recordLevel(input)).previousAttemptSummary, null);
  const lower = attempt({ firstAttemptCorrect: 1, incorrectAnswers: 2, bestStreak: 1 });
  const later = { ...completion(first.id, 'later', 5), attemptSummary: lower };
  assert.deepEqual(await store.recordLevel(later), {
    persisted: true, bestImproved: false, previousAttemptSummary: summary,
  });
  const reloaded = createProfileStore(backend, options);
  await reloaded.initialize();
  assert.deepEqual(await reloaded.getAttemptSummary(first.id, 1, 'easy'), lower);
  const next = await reloaded.recordLevel({ ...completion(first.id, 'next', 4), attemptSummary: summary });
  assert.deepEqual(next.previousAttemptSummary, lower, 'compare previous, not best');
  next.previousAttemptSummary.bestStreak = 99;
  assert.deepEqual((await reloaded.recordLevel(later)).previousAttemptSummary, summary, 'receipt is detached');
});

test('nested summary capture, failed writes, retries and summary conflicts are exactly once', async () => {
  const { store, backend, data, options } = fixture();
  const first = await store.initialize();
  const second = await store.createProfile('Second');
  const original = attempt();
  const input = { ...completion(first.id, 'captured'), attemptSummary: { ...original } };
  const pending = store.recordLevel(input);
  input.profileId = second.id;
  input.attemptSummary.bestStreak = 999;
  input.attemptSummary = null;
  await pending;
  assert.deepEqual(await store.getAttemptSummary(first.id, 1, 'easy'), original);
  assert.equal(await store.getAttemptSummary(second.id, 1, 'easy'), null);
  const retry = { ...completion(first.id, 'retry', 50), attemptSummary: attempt({ bestStreak: 3 }) };
  const before = data.get(PROFILE_KEY);
  backend.failWrites = true;
  await assert.rejects(store.recordLevel(retry), storageError);
  assert.equal(data.get(PROFILE_KEY), before);
  assert.deepEqual(await store.getAttemptSummary(first.id, 1, 'easy'), original);
  backend.failWrites = false;
  const result = await store.recordLevel(retry);
  assert.deepEqual(result.previousAttemptSummary, original);
  await store.recordLevel({ ...completion(first.id, 'later'), attemptSummary: original });
  const reloaded = createProfileStore(backend, options);
  await reloaded.initialize();
  const writes = backend.writes.length;
  assert.deepEqual(await reloaded.recordLevel(retry), result);
  assert.equal(backend.writes.length, writes);
  for (const changed of [
    { ...retry, attemptSummary: original },
    completion(first.id, 'retry', 50),
  ]) await assert.rejects(reloaded.recordLevel(changed), { code: 'completion_conflict' });
  await store.recordLevel(completion(first.id, 'legacy'));
  await assert.rejects(store.recordLevel({ ...completion(first.id, 'legacy'), attemptSummary: original }),
    { code: 'completion_conflict' });
});

test('previous summary and stable receipts survive unrelated history truncation', async () => {
  const { store, backend, options } = fixture();
  const { id } = await store.initialize();
  const original = { ...completion(id, 'first'), attemptSummary: attempt() };
  const result = await store.recordLevel(original);
  for (let index = 0; index < SCORE_HISTORY_LIMIT + 1; index++) {
    await store.recordLevel(completion(id, `${index}`, 1, 2));
  }
  const reloaded = createProfileStore(backend, options);
  await reloaded.initialize();
  assert.deepEqual(await reloaded.recordLevel(original), result);
  assert.deepEqual((await reloaded.recordLevel({
    ...completion(id, 'new'), attemptSummary: attempt(),
  })).previousAttemptSummary, attempt());
});

test('summary capture precedes a pending asynchronous write and serializes two completions', async () => {
  const { store, backend } = fixture();
  const { id } = await store.initialize();
  const realSet = backend.set.bind(backend);
  let release;
  let entered;
  const started = new Promise((resolve) => { entered = resolve; });
  const blocked = new Promise((resolve) => { release = resolve; });
  backend.set = async (key, value) => { entered(); await blocked; await realSet(key, value); };
  const first = store.recordLevel({ ...completion(id, 'first'), attemptSummary: attempt() });
  await started;
  const secondSummary = attempt({ bestStreak: 3 });
  const second = store.recordLevel({ ...completion(id, 'second'), attemptSummary: secondSummary });
  secondSummary.bestStreak = 999;
  backend.set = realSet;
  release();
  const results = await Promise.all([first, second]);
  assert.equal(results[0].previousAttemptSummary, null);
  assert.deepEqual(results[1].previousAttemptSummary, attempt());
  assert.deepEqual(await store.getAttemptSummary(id, 1, 'easy'), attempt({ bestStreak: 3 }));
});

test('zero-reply summaries remain actual zeros rather than invented accuracy', async () => {
  const { store, backend, options } = fixture();
  const { id } = await store.initialize();
  const zero = attempt({
    firstAttemptCorrect: 0, firstAttemptTotal: 0, correctAnswers: 0,
    incorrectAnswers: 0, timeouts: 0, bestStreak: 0,
  });
  await store.recordLevel({ ...completion(id, 'zero'), attemptSummary: zero });
  const reloaded = createProfileStore(backend, options);
  await reloaded.initialize();
  assert.deepEqual(await reloaded.getAttemptSummary(id, 1, 'easy'), zero);
});

test('legacy documents retain progress and never fabricate summary statistics', async () => {
  const { store, backend, options, data } = fixture();
  const { id } = await store.initialize();
  await store.recordLevel(completion(id, 'legacy', 25, 3));
  const before = data.get(PROFILE_KEY);
  const reloaded = createProfileStore(backend, options);
  await reloaded.initialize();
  assert.equal(data.get(PROFILE_KEY), before);
  assert.deepEqual(await reloaded.getCompletedLevels(id), { completed: [3] });
  assert.equal(await reloaded.getAttemptSummary(id, 3, 'easy'), null);
  assert.deepEqual(await reloaded.recordLevel(completion(id, 'legacy', 25, 3)),
    { persisted: true, bestImproved: true });
  await reloaded.recordLevel({ ...completion(id, 'summary', 10, 3), attemptSummary: attempt() });
  await reloaded.recordLevel(completion(id, 'legacy-after', 10, 3));
  assert.equal(await reloaded.getAttemptSummary(id, 3, 'easy'), null);
  assert.equal((await reloaded.recordLevel({
    ...completion(id, 'summary-after', 10, 3), attemptSummary: attempt(),
  })).previousAttemptSummary, null);
});

test('optional summaries are strictly validated in input and persisted document without overwriting data', async () => {
  const { store, backend, data, options } = fixture();
  const { id } = await store.initialize();
  const invalid = [
    null, undefined, {}, [], { ...attempt(), extra: 1 }, attempt({ timeouts: -1 }),
    attempt({ incorrectAnswers: 0.5 }), attempt({ firstAttemptCorrect: 4 }),
    attempt({ firstAttemptTotal: 9 }), attempt({ bestStreak: 4 }),
    attempt({ bestStreak: 0 }), attempt({ correctAnswers: Infinity }),
    attempt({ timeouts: Number.MAX_SAFE_INTEGER }), attempt({ firstAttemptTotal: 0, firstAttemptCorrect: 0 }),
  ];
  const writes = backend.writes.length;
  for (const attemptSummary of invalid) {
    await assert.rejects(store.recordLevel({
      ...completion(id, 'invalid'), attemptSummary,
    }), { code: 'invalid_completion' });
  }
  assert.equal(backend.writes.length, writes);
  await store.recordLevel({ ...completion(id, 'valid'), attemptSummary: attempt() });
  const validDocument = JSON.parse(data.get(PROFILE_KEY));
  for (const location of ['best', 'history', 'completions', 'attemptLast', 'previousAttemptSummary']) {
    for (const bad of invalid.filter((value) => value !== undefined)) {
      const doc = structuredClone(validDocument);
      const profile = doc.profiles[0];
      if (location === 'completions') profile.completions.valid.attemptSummary = bad;
      else if (location === 'previousAttemptSummary') {
        if (bad === null) continue;
        profile.completions.valid.previousAttemptSummary = bad;
      } else profile[location][0].attemptSummary = bad;
      const raw = JSON.stringify(doc);
      data.set(PROFILE_KEY, raw);
      const reloaded = createProfileStore(backend, options);
      await assert.rejects(reloaded.initialize(), storageError);
      assert.equal(data.get(PROFILE_KEY), raw);
    }
  }
});
