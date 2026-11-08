import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLocalProfileAdapter } from '../game/local-profile-adapter.js';
import { PROFILE_KEY } from '../game/profile-store.js';

test('local adapter exposes the integration API and leaves entitlement outside its document', async () => {
  const data = new Map([['arithmoslayer:entitlement', 'unlocked']]);
  let id = 0;
  const adapter = createLocalProfileAdapter({
    backend: { get: async (key) => data.get(key) ?? null, set: async (key, value) => { data.set(key, value); } },
    makeId: () => `id-${++id}`,
  });
  for (const name of ['initialize', 'listProfiles', 'getActiveProfile', 'createProfile', 'selectProfile',
    'renameProfile', 'deleteProfile', 'getBestScores', 'getScoreHistory', 'getCompletedLevels',
    'getAttemptSummary', 'recordLevel', 'recordPractice', 'getPracticeBadges']) {
    assert.equal(typeof adapter[name], 'function', name);
  }
  const first = await adapter.initialize({ defaultName: 'First' });
  const second = await adapter.createProfile('Second');
  assert.deepEqual(adapter.getActiveProfile(), second);
  await adapter.recordLevel({ profileId: first.id, completionId: 'owner-run', level: 1, score: 25 });
  assert.equal((await adapter.getBestScores(first.id)).best[0].score, 25);
  assert.deepEqual(await adapter.getBestScores(second.id), { best: [] });
  assert.equal(data.get('arithmoslayer:entitlement'), 'unlocked');
  assert.deepEqual([...data.keys()], ['arithmoslayer:entitlement', PROFILE_KEY]);
});

test('default adapter without a Preferences bridge rejects rather than returning success', async () => {
  const adapter = createLocalProfileAdapter();
  await assert.rejects(adapter.initialize(), { code: 'storage_unavailable' });
});

test('local adapter forwards optional attempt summaries and stable previous-attempt receipts', async () => {
  const data = new Map();
  const options = {
    backend: { get: async (key) => data.get(key) ?? null, set: async (key, value) => { data.set(key, value); } },
    makeId: () => 'local-owner',
  };
  const adapter = createLocalProfileAdapter(options);
  const { id } = await adapter.initialize();
  const attemptSummary = {
    firstAttemptCorrect: 1, firstAttemptTotal: 2, correctAnswers: 2,
    incorrectAnswers: 0, timeouts: 1, bestStreak: 2,
  };
  const input = { profileId: id, completionId: 'first', level: 3, score: 20, difficulty: 'easy', attemptSummary };
  assert.deepEqual(await adapter.recordLevel(input), {
    persisted: true, bestImproved: true, previousAttemptSummary: null,
  });

  const reloaded = createLocalProfileAdapter(options);
  await reloaded.initialize();
  assert.deepEqual(await reloaded.getAttemptSummary(id, 3, 'easy'), attemptSummary);
  const next = { ...input, completionId: 'next', score: 10 };
  const result = await reloaded.recordLevel(next);
  assert.deepEqual(result, { persisted: true, bestImproved: false, previousAttemptSummary: attemptSummary });
  assert.deepEqual(await reloaded.recordLevel(next), result);
});

test('adapter persists practice locally across relaunch without forwarding campaign completion', async () => {
  const data = new Map();
  const options = {
    backend: { get: async (key) => data.get(key) ?? null, set: async (key, value) => { data.set(key, value); } },
    makeId: () => 'practice-owner',
  };
  const adapter = createLocalProfileAdapter(options);
  const { id } = await adapter.initialize();
  const input = { profileId: id, sessionId: 'practice', badgeIds: ['practice-multiplication'] };
  const receipt = await adapter.recordPractice(input);
  const reloaded = createLocalProfileAdapter(options);
  await reloaded.initialize();
  assert.deepEqual(await reloaded.getPracticeBadges(id), { badges: ['practice-multiplication'] });
  assert.deepEqual(await reloaded.recordPractice(input), receipt);
  assert.deepEqual(await reloaded.getBestScores(id), { best: [] });
  assert.deepEqual(await reloaded.getScoreHistory(id), { history: [] });
  assert.deepEqual(await reloaded.getCompletedLevels(id), { completed: [] });
});
