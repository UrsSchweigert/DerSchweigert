import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createProfileStore, PROFILE_KEY } from '../game/profile-store.js';

function fixture() {
  const data = new Map();
  let id = 0;
  const backend = {
    failWrites: false, writes: 0,
    get: async (key) => data.get(key) ?? null,
    async set(key, value) {
      if (this.failWrites) throw new Error('failed');
      this.writes++;
      data.set(key, value);
    },
  };
  const options = { makeId: () => `owner-${++id}` };
  return { data, backend, options, store: createProfileStore(backend, options) };
}

test('practice is one atomic profile-local write without campaign statistics or progress', async () => {
  const { store, backend, data } = fixture();
  const first = await store.initialize();
  const second = await store.createProfile('Other');
  await store.recordLevel({ profileId: first.id, completionId: 'campaign', level: 1, score: 30 });
  const before = JSON.parse(data.get(PROFILE_KEY)).profiles[0];
  const writes = backend.writes;
  assert.deepEqual(await store.recordPractice({
    profileId: first.id, sessionId: 'practice', badgeIds: ['practice-addition', 'practice-targeted'],
  }), { persisted: true, badges: ['practice-addition', 'practice-targeted'] });
  assert.equal(backend.writes, writes + 1);
  const after = JSON.parse(data.get(PROFILE_KEY)).profiles[0];
  for (const key of ['best', 'history', 'completed', 'completions']) assert.deepEqual(after[key], before[key]);
  assert.equal(Object.hasOwn(after, 'attemptLast'), false);
  assert.deepEqual(await store.getPracticeBadges(second.id), { badges: [] });
  assert.equal(JSON.parse(data.get(PROFILE_KEY)).version, 1);
});

test('practice receipts are stable after subsequent earns and relaunch, conflict cannot overwrite', async () => {
  const { store, backend, options, data } = fixture();
  const { id } = await store.initialize();
  const input = { profileId: id, sessionId: '__proto__', badgeIds: ['practice-shapes', 'practice-addition'] };
  const result = await store.recordPractice(input);
  assert.deepEqual(await store.recordPractice({ ...input, badgeIds: [...input.badgeIds].reverse() }), result);
  assert.deepEqual(await store.recordPractice({ ...input, sessionId: 'next' }), { persisted: true, badges: [] });
  const reload = createProfileStore(backend, options);
  await reload.initialize();
  const writes = backend.writes;
  assert.deepEqual(await reload.recordPractice(input), result);
  assert.equal(backend.writes, writes);
  result.badges.length = 0;
  assert.equal((await reload.recordPractice(input)).badges.length, 2);
  const before = data.get(PROFILE_KEY);
  await assert.rejects(reload.recordPractice({ ...input, badgeIds: ['practice-targeted'] }), { code: 'practice_conflict' });
  assert.equal(data.get(PROFILE_KEY), before);
});

test('invocation captures primitive owner/session and badge array before queued writes', async () => {
  const { store } = fixture();
  const first = await store.initialize();
  const second = await store.createProfile('Other');
  const input = { profileId: first.id, sessionId: 'one', badgeIds: ['practice-addition'] };
  const pending = store.recordPractice(input);
  input.profileId = second.id;
  input.sessionId = 'changed';
  input.badgeIds[0] = 'practice-division';
  await Promise.all([pending, store.selectProfile(second.id),
    store.recordPractice({ profileId: first.id, sessionId: 'two', badgeIds: ['practice-shapes'] })]);
  assert.deepEqual(await store.getPracticeBadges(first.id), { badges: ['practice-addition', 'practice-shapes'] });
  assert.deepEqual(await store.getPracticeBadges(second.id), { badges: [] });
});

test('failed practice leaves cache and document unchanged and retry can succeed', async () => {
  const { store, backend, data } = fixture();
  const { id } = await store.initialize();
  const input = { profileId: id, sessionId: 'retry', badgeIds: ['practice-targeted'] };
  const before = data.get(PROFILE_KEY);
  backend.failWrites = true;
  await assert.rejects(store.recordPractice(input), { code: 'storage_unavailable' });
  assert.equal(data.get(PROFILE_KEY), before);
  assert.deepEqual(await store.getPracticeBadges(id), { badges: [] });
  backend.failWrites = false;
  assert.deepEqual(await store.recordPractice(input), { persisted: true, badges: ['practice-targeted'] });
});

test('legacy version-one profiles load unchanged; optional practice fields are strictly validated', async () => {
  const { store, backend, data, options } = fixture();
  await store.initialize();
  const legacy = data.get(PROFILE_KEY);
  const reload = createProfileStore(backend, options);
  await reload.initialize();
  assert.equal(data.get(PROFILE_KEY), legacy);
  const doc = JSON.parse(legacy);
  for (const fields of [
    { practiceBadges: [] },
    { practiceBadges: ['practice-mastery'], practiceReceipts: {} },
    { practiceBadges: ['practice-shapes'], practiceReceipts: {} },
    { practiceBadges: [], practiceReceipts: { s: { badgeIds: [], badges: [], score: 1 } } },
    { practiceBadges: [], practiceReceipts: { s: { badgeIds: ['practice-shapes'], badges: [] } } },
    { practiceBadges: ['practice-shapes', 'practice-shapes'], practiceReceipts: {} },
  ]) {
    const corrupt = structuredClone(doc);
    Object.assign(corrupt.profiles[0], fields);
    data.set(PROFILE_KEY, JSON.stringify(corrupt));
    await assert.rejects(createProfileStore(backend, options).initialize(), { code: 'storage_unavailable' });
  }
});

test('invalid badges and unavailable storage are consistent and never write a receipt', async () => {
  const { store, backend } = fixture();
  const { id } = await store.initialize();
  const writes = backend.writes;
  for (const badgeIds of [null, ['practice-mastery'], ['practice-shapes', 'practice-shapes'], [1]]) {
    await assert.rejects(store.recordPractice({ profileId: id, sessionId: 'bad', badgeIds }), { code: 'invalid_practice' });
  }
  assert.equal(backend.writes, writes);
  const unavailable = createProfileStore(undefined);
  await assert.rejects(unavailable.recordPractice({
    profileId: id, sessionId: 'valid', badgeIds: [],
  }), { code: 'storage_unavailable' });
  await assert.rejects(store.recordPractice({
    profileId: 'missing', sessionId: 'valid', badgeIds: [],
  }), { code: 'profile_not_found' });
});
