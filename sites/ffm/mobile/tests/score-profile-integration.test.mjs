import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPreferencesBackend } from '../game/progress-store.js';
import { createLocalProfileAdapter } from '../game/local-profile-adapter.js';
import { createLevelCompletion } from '../../static/game/level-completion.js';
import { getCampaignProgress } from '../../static/game/campaign-progress.js';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

test('completed scores survive a title refresh and relaunch, isolated by captured player', async () => {
  const values = new Map();
  let unavailable = false;
  globalThis.Capacitor = { Plugins: { Preferences: {
    async get({ key }) { return { value: values.get(key) ?? null }; },
    async set({ key, value }) {
      if (unavailable) throw new Error('disk full');
      values.set(key, value);
    },
  } } };
  try {
    const { default: platform } = await import('../game/platform-adapter.js');
    await platform.localProfiles.initialize({ defaultName: 'First player' });
    const first = platform.localProfiles.getActiveProfile();
    const attemptSummary = { firstAttemptCorrect: 4, firstAttemptTotal: 5, correctAnswers: 5,
      incorrectAnswers: 1, timeouts: 0, bestStreak: 4 };
    const save = createLevelCompletion(platform, {
      level: 1, score: 900, difficulty: 'easy', profileId: first.id, completionId: 'first-level-clear',
      attemptSummary,
    });

    const second = await platform.localProfiles.createProfile('Second player');
    assert.deepEqual(await save(), { saved: true, previousAttemptSummary: null });
    assert.deepEqual(await platform.localProfiles.getAttemptSummary(first.id, 1, 'easy'), attemptSummary);
    assert.deepEqual(await platform.getBestScores(), { best: [] });
    await platform.localProfiles.selectProfile(first.id);
    assert.equal((await platform.getBestScores()).best[0].score, 900);
    assert.deepEqual(await platform.getCompletedLevels(), { completed: [1] });
    assert.equal(getCampaignProgress((await platform.getCompletedLevels()).completed).nextLevel, 2);

    const relaunched = createLocalProfileAdapter({ backend: createPreferencesBackend() });
    await relaunched.initialize();
    assert.equal(relaunched.getActiveProfile().id, first.id);
    assert.equal((await relaunched.getBestScores(first.id)).best[0].score, 900);
    assert.deepEqual(await relaunched.getAttemptSummary(first.id, 1, 'easy'), attemptSummary);
    assert.equal(await relaunched.getAttemptSummary(second.id, 1, 'easy'), null);
    assert.deepEqual(await relaunched.getBestScores(second.id), { best: [] });
    assert.equal(getCampaignProgress((await relaunched.getCompletedLevels(first.id)).completed).nextLevel, 2);
    assert.equal(getCampaignProgress((await relaunched.getCompletedLevels(second.id)).completed).nextLevel, 1);
    const replay = await platform.postLevelScore(1, 800, 'easy', {
      profileId: first.id, completionId: 'improved-accuracy-clear',
      attemptSummary: { firstAttemptCorrect: 5, firstAttemptTotal: 5, correctAnswers: 5,
        incorrectAnswers: 0, timeouts: 0, bestStreak: 5 },
    });
    assert.deepEqual(replay, { saved: false, previousAttemptSummary: attemptSummary });
    assert.deepEqual(await save(), { saved: true, previousAttemptSummary: null });

    unavailable = true;
    await assert.rejects(platform.postLevelScore(60, 1000, 'hard', {
      profileId: first.id, completionId: 'last-level-clear',
    }), { code: 'storage_unavailable' });
    assert.deepEqual(await platform.getCompletedLevels(), { completed: [1] });
    unavailable = false;
    await platform.postLevelScore(60, 1000, 'hard', {
      profileId: first.id, completionId: 'last-level-clear',
    });
    assert.deepEqual(await platform.getCompletedLevels(), { completed: [1, 60] });
    assert.equal(getCampaignProgress((await platform.getCompletedLevels()).completed).nextLevel, 2);
  } finally {
    delete globalThis.Capacitor;
  }
});

test('a late progress response never displays the previous player data', async () => {
  const source = readFileSync(new URL('../../static/game/main.js', import.meta.url), 'utf8');
  const refresh = source.match(/async function refreshPersonalDevelopment\([\s\S]*?\n\}/)[0];
  let selected = 'player-a';
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const rendered = [];
  const context = {
    platform: {
      isApp: true,
      localProfiles: { getActiveProfile: () => ({ id: selected }) },
      async getBestScores(id) { assert.equal(id, 'player-a'); await pending; return { best: [{ level: 1, score: 900 }] }; },
      async getScoreHistory(id) { assert.equal(id, 'player-a'); await pending; return { history: [] }; },
      async getCompletedLevels(id) { assert.equal(id, 'player-a'); await pending; return { completed: [1] }; },
    },
    renderPersonalDevelopment: data => rendered.push(data),
    showProgressError() {}, console, t: key => key,
  };
  vm.createContext(context);
  vm.runInContext(refresh, context);
  const reading = context.refreshPersonalDevelopment();
  selected = 'player-b';
  release();
  await reading;
  assert.deepEqual(rendered, []);
});
