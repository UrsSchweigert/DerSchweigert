// personal-development.test.mjs — the app title screen's local panel.
//
// The app has no account and no leaderboard, so the title screen branches to a
// personal-development panel: per-level best, the score-history chart (the
// same buildScoreHistorySvg the web build uses) and a levels-completed
// overview, all read from the on-device progress store.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { highScoreTrend } from '../../static/game/score-trend.js';

// api.js captures window.location.origin at import time.
globalThis.window = { location: { origin: 'https://game.example' } };

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const gameDir = join(root, '..', 'static', 'game');
const read = (rel) => readFile(join(gameDir, rel), 'utf8');

const { PLATFORM_METHODS, PERSONAL_METHODS } = await import('../../static/game/platform.js');
const { default: appPlatform } = await import('../game/platform-adapter.js');
const { default: webPlatform } = await import('../../static/game/platform-adapter.js');
const { setLocale, t, _resetForTests } = await import('../../static/game/i18n.js');

function installFakePreferences() {
  const values = new Map();
  globalThis.Capacitor = {
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
  };
  return values;
}

afterEach(() => {
  delete globalThis.Capacitor;
  _resetForTests();
});

test('the platform seam advertises the personal-development surface', () => {
  assert.deepEqual([...PERSONAL_METHODS], [
    'getAccountAvailability',
    'getBestScores',
    'getCompletedLevels',
  ]);
  for (const name of PERSONAL_METHODS) {
    assert.ok(PLATFORM_METHODS.includes(name), name);
    assert.equal(typeof appPlatform[name], 'function', `app adapter implements ${name}`);
    assert.equal(typeof webPlatform[name], 'function', `web adapter implements ${name}`);
  }
});

test('the app adapter reports no account so the title screen branches locally', () => {
  assert.equal(appPlatform.getAccountAvailability(), 'none');
  assert.equal(appPlatform.hasAccount, false);
  assert.equal(appPlatform.hasLeaderboard, false);
});

test('the app adapter reads best, history and completed levels from the store', async () => {
  installFakePreferences();

  assert.deepEqual(await appPlatform.getBestScores(), { best: [] });
  assert.deepEqual(await appPlatform.getCompletedLevels(), { completed: [] });
  assert.deepEqual(await appPlatform.getScoreHistory(), { history: [] });

  assert.deepEqual(await appPlatform.postLevelScore(2, 40, 'easy'), { saved: true });
  assert.deepEqual(await appPlatform.postLevelScore(2, 25, 'easy'), { saved: false });
  assert.deepEqual(await appPlatform.postLevelScore(5, 90, 'hard'), { saved: true });

  const { best } = await appPlatform.getBestScores();
  assert.deepEqual(best.map((entry) => [entry.level, entry.score]), [[2, 40], [5, 90]]);
  assert.equal(best[0].difficulty, 'easy');
  assert.match(best[0].achieved_at, /^\d{4}-\d{2}-\d{2}T/);

  const { completed } = await appPlatform.getCompletedLevels();
  assert.deepEqual(completed, [2, 5]);

  const { history } = await appPlatform.getScoreHistory();
  assert.equal(history.length, 3);
  assert.deepEqual(history.map((entry) => entry.score), [40, 25, 90]);
});

test('the panel renders per-level best, the chart and the completed overview', async () => {
  const source = await read('main.js');
  const html = await readFile(join(gameDir, '..', 'index.html'), 'utf8');

  assert.match(source, /const personalDevelopment = document\.getElementById\('personal-development'\)/);
  assert.match(source, /platform\.getAccountAvailability\(\) === 'none'/);
  assert.match(source, /leaderboardSection\.style\.display = 'none'/);
  assert.match(source, /personalDevelopment\.style\.display = ''/);
  assert.match(source, /platform\.getBestScores\(profileId\)/);
  assert.match(source, /platform\.getCompletedLevels\(profileId\)/);
  assert.match(source, /platform\.getScoreHistory\(\)/);

  // The local chart reuses the existing SVG builder through renderScoreHistory,
  // fed with the total high score trend instead of single level scores.
  const renderPersonal = source.match(/function renderPersonalDevelopment\([\s\S]*?\n\}/)?.[0];
  assert.ok(renderPersonal, 'renderPersonalDevelopment must exist');
  assert.match(renderPersonal, /renderScoreHistory\(\{ trend: highScoreTrend\([\s\S]*?\) \}, personalScoreHistoryChart\)/);
  const renderHistory = source.match(/function renderScoreHistory\([\s\S]*?\n\}/)?.[0];
  assert.match(renderHistory, /buildScoreHistorySvg\(history, summaryKey\)/);
  assert.match(renderPersonal, /personalCompletedOverview\.textContent = t\('personalDevelopment\.completed'/);

  assert.match(html, /id="leaderboard-section"/);
  assert.match(html, /id="personal-development"[^>]*style="display:none"/);
  for (const id of ['personal-best-list', 'personal-score-history-chart', 'personal-completed-overview']) {
    assert.ok(html.includes(`id="${id}"`), id);
  }
  assert.match(html, /id="personal-score-history-chart" class="score-history-chart"/);

  // Execute the real renderer against fake elements: the list comes from the
  // store data, the chart receives the local history and the overview counts
  // the completed levels against TOTAL_LEVELS.
  const context = {
    personalBestPage: 0,
    PERSONAL_BEST_PAGE_SIZE: 3,
    document: { getElementById() { return null; } },
    personalDevelopment: {},
    personalBestList: { innerHTML: '' },
    personalScoreHistoryChart: {},
    personalCompletedOverview: { textContent: '' },
    TOTAL_LEVELS: 60,
    highScoreTrend,
    t: (key, vars) => {
      if (key === 'personalDevelopment.perLevelBest') return `Level ${vars.level}: ${vars.score} points`;
      if (key === 'personalDevelopment.perLevelBestUnfinished') {
        return `Level ${vars.level}: ${vars.score} points (unfinished)`;
      }
      if (key === 'personalDevelopment.completed') return `${vars.completed} of ${vars.total} levels completed`;
      return 'no progress';
    },
    renderScoreHistory: (payload, container) => {
      context.chartPayload = payload;
      context.chartContainer = container;
    },
  };
  vm.runInNewContext(
    `${renderPersonal}\nrenderPersonalDevelopment({ best: [{ level: 2, score: 40 }, { level: 5, score: 90 }], history: [{ level: 2, score: 40 }, { level: 5, score: 90 }, { level: 2, score: 10 }], completed: [2, 5] });`,
    context,
  );
  assert.match(context.personalBestList.innerHTML, /Level 2: 40 points/);
  assert.match(context.personalBestList.innerHTML, /Level 5: 90 points/);
  assert.equal(JSON.stringify(context.chartPayload), JSON.stringify({ trend: [
    { score: 40, achieved_at: null }, { score: 130, achieved_at: null }, { score: 130, achieved_at: null },
  ] }), 'the chart plots the summed level bests, not single level scores');
  assert.equal(context.chartContainer, context.personalScoreHistoryChart);
  assert.equal(context.personalCompletedOverview.textContent, '2 of 60 levels completed');

  vm.runInNewContext(
    `${renderPersonal}\nrenderPersonalDevelopment({ best: [{ level: 2, score: 40, unfinished: true }], history: [{ level: 2, score: 40, unfinished: true }], completed: [] });`,
    context,
  );
  assert.match(context.personalBestList.innerHTML, /Level 2: 40 points \(unfinished\)/);
  assert.doesNotMatch(context.personalBestList.innerHTML, /40 points<\/li>/);

  vm.runInNewContext(
    `${renderPersonal}\nrenderPersonalDevelopment({ best: [], history: [], completed: [] });`,
    context,
  );
  assert.equal(context.personalBestList.innerHTML, '<li>no progress</li>');
  assert.equal(context.personalCompletedOverview.textContent, '0 of 60 levels completed');
});

test('the panel strings exist in English and German', async () => {
  const html = await readFile(join(gameDir, '..', 'index.html'), 'utf8');
  assert.match(html, /data-i18n="personalDevelopment\.title"/);

  setLocale('en', { persist: false });
  assert.equal(t('personalDevelopment.title'), 'Practice');
  assert.equal(t('personalDevelopment.perLevelBest', { level: 3, score: 12 }), 'Level 3: 12 points');
  assert.equal(t('personalDevelopment.completed', { completed: 2, total: 60 }), '2 of 60 levels completed');
  assert.ok(t('personalDevelopment.noProgress').length > 0);

  setLocale('de', { persist: false });
  assert.equal(t('personalDevelopment.title'), 'Training');
  assert.equal(t('personalDevelopment.perLevelBest', { level: 3, score: 12 }), 'Level 3: 12 Punkte');
  assert.equal(t('personalDevelopment.completed', { completed: 2, total: 60 }), '2 von 60 Leveln geschafft');
  assert.ok(t('personalDevelopment.noProgress').length > 0);
});

test('the web adapter keeps the server leaderboard and reports optional accounts', async () => {
  assert.equal(webPlatform.getAccountAvailability(), 'optional');
  assert.equal(webPlatform.hasAccount, true);
  assert.equal(webPlatform.hasLeaderboard, true);
  assert.deepEqual(await webPlatform.getBestScores(), { best: [] });
  assert.deepEqual(await webPlatform.getCompletedLevels(), { completed: [] });
});
