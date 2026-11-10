import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { getCampaignProgress, resetLevelAttempt } from './campaign-progress.js';
import { createLevelGrid } from './level-grid.js';

const source = readFileSync(new URL('./main.js', import.meta.url), 'utf8');
const difficulty = source.slice(source.indexOf("document.querySelectorAll('#difficulty-select .diff-btn').forEach"),
  source.indexOf('function onLevelGridSelect('));

function setup({ completed = [1, 2], selected = '', fail = false, difficultyKind = 'hard' } = {}) {
  let handler;
  const starts = [];
  const btn = { dataset: { difficulty: difficultyKind, timer: '5', hearts: '3' },
    addEventListener(_event, callback) { handler = callback; } };
  const context = {
    profileMutationPending: false, levelStarting: false, pendingSkillIntro: null,
    document: { querySelectorAll: () => [btn] },
    platform: { isApp: true,
      localProfiles: { getActiveProfile: () => ({ id: 'player-a' }) },
      async getCompletedLevels(id) {
        assert.equal(id, 'player-a');
        if (fail) throw new Error('storage unavailable');
        return { completed };
      },
    },
    async ensureLocalProfiles() {},
    profileUI: { async whenIdle() {} },
    state: { score: 800, hearts: 0 }, levelStartScore: 100,
    diffSelect: { style: { display: 'flex' } },
    levelGrid: { value: selected },
    getCampaignProgress, resetLevelAttempt,
    async startLevel(index, baseline) { starts.push([index, baseline]); },
    async startPracticeSession(...args) { starts.push(args); },
    showTitlePage() {}, showProgressError() {}, t: key => key,
    console: { error() {} },
  };
  vm.createContext(context);
  vm.runInContext(difficulty, context);
  return { context, start: () => handler(), starts };
}

test('Play continues at the first unfinished level without inventing a score baseline', async () => {
  const { start, starts, context } = setup({ completed: [1, 3] });
  await start();
  assert.deepEqual(starts, [[1, true]]);
  assert.equal(context.state.score, 0);
  assert.equal(context.state.hearts, 3);
});

test('web title shows selected start level and preserves a valid replay on refresh', () => {
  const grid = createLevelGrid({ doc: null });
  let selection;
  const continuation = { textContent: '' };
  const context = {
    platform: { isApp: false },
    levelGrid: grid,
    levelJumpRow: { style: {} },
    TOTAL_LEVELS: 60,
    titleLevelNumerals: { updateLevelSelection(value) { selection = value; } },
    document: { getElementById: id => id === 'continue-level' ? continuation : {} },
    t: (key, vars) => `${key}:${vars?.level ?? ''}`,
  };
  vm.createContext(context);
  vm.runInContext(source.match(/function updateTitleStartingLevel\([\s\S]*?\n\}/)[0], context);
  vm.runInContext(source.match(/function renderLevelJumpOptions\([\s\S]*?\n\}/)[0], context);
  context.renderLevelJumpOptions({ scores: [{ level: 5 }] });
  assert.equal(grid.entries.length, 60);
  assert.deepEqual(grid.entries.filter(entry => entry.state !== 'locked').map(entry => entry.level), [1, 5]);
  grid.value = '5';
  context.renderLevelJumpOptions({ scores: [{ level: 5 }] });
  assert.equal(grid.value, '5');
  assert.equal(selection.level, 5);
  assert.equal(selection.mode, 'replay');
  assert.equal(continuation.textContent, 'title.levelNumerals:5');
  context.renderLevelJumpOptions(null);
  assert.equal(grid.value, '');
  assert.equal(selection.level, 1);
  assert.equal(selection.mode, 'continuation');
  assert.equal(continuation.textContent, 'title.levelNumerals:1');
});

test('native title artwork follows continuation, replay, player reset and campaign completion', () => {
  const grid = createLevelGrid({ doc: null });
  let selection;
  const continuation = { textContent: '' };
  const context = {
    platform: { isApp: true },
    getCampaignProgress,
    levelGrid: grid,
    levelJumpRow: { style: {} },
    TOTAL_LEVELS: 60,
    titleLevelNumerals: { updateLevelSelection(value) { selection = value; } },
    document: { getElementById: id => id === 'continue-level' ? continuation : { dataset: {}, hidden: false } },
    t: (key, vars) => `${key}:${vars?.level ?? ''}`,
  };
  vm.createContext(context);
  for (const name of ['updateTitleStartingLevel', 'renderLocalCampaign']) {
    vm.runInContext(source.match(new RegExp(`function ${name}\\([\\s\\S]*?\\n\\}`))[0], context);
  }
  context.renderLocalCampaign([1, 3]);
  assert.equal(selection.level, 2);
  assert.equal(selection.mode, 'continuation');
  assert.deepEqual(grid.entries.filter(entry => entry.state !== 'locked').map(entry => [entry.level, entry.value]),
    [[1, '1'], [2, ''], [3, '3']]);
  grid.value = '3';
  context.renderLocalCampaign([1, 3]);
  assert.equal(selection.level, 3);
  assert.equal(selection.mode, 'replay');
  grid.value = '7';
  assert.equal(grid.value, '', 'a locked level can never be selected');
  grid.value = '3';
  context.renderLocalCampaign([], { resetSelection: true });
  assert.equal(selection.level, 1);
  assert.equal(selection.mode, 'continuation');
  context.renderLocalCampaign(Array.from({ length: 60 }, (_, i) => i + 1));
  assert.equal(selection.level, 1);
  assert.equal(continuation.textContent, 'campaign.complete:');
});

test('picking a level tile updates the title and returns to the Play page', () => {
  const pages = [];
  let refreshed = 0;
  const context = {
    platform: { isApp: false }, currentPersonalDevelopment: null,
    updateTitleStartingLevel() { refreshed += 1; },
    renderLocalCampaign() { throw new Error('web must not render the native campaign'); },
    showTitlePage(name) { pages.push(name); },
  };
  vm.createContext(context);
  vm.runInContext(source.match(/function onLevelGridSelect\([\s\S]*?\n\}/)[0], context);
  context.onLevelGridSelect('5');
  assert.equal(refreshed, 1);
  assert.deepEqual(pages, ['play']);
});

test('the existing title Shapes button launches Endless without depending on the finite practice selector', async () => {
  const { start, starts } = setup({ difficultyKind: 'shapes' });
  await start();
  assert.equal(starts.length, 1);
  assert.equal(starts[0][0], 'shapes');
  assert.equal(starts[0][1], 1);
  assert.equal(starts[0][2].endless, true);
});

test('replay is restricted to this player cleared levels', async () => {
  const replay = setup({ selected: '2' });
  await replay.start();
  assert.deepEqual(replay.starts, [[1, true]]);
  const invalid = setup({ selected: '4' });
  await invalid.start();
  assert.deepEqual(invalid.starts, []);
  assert.equal(invalid.context.diffSelect.style.display, 'flex');
});

test('a cleared campaign restarts at one rather than trying to access level 61', async () => {
  const { start, starts } = setup({ completed: Array.from({ length: 60 }, (_, i) => i + 1) });
  await start();
  assert.deepEqual(starts, [[0, true]]);
});

test('failed local progress reads do not pretend that progress is empty', async () => {
  const { start, starts, context } = setup({ fail: true });
  await start();
  assert.deepEqual(starts, []);
  assert.equal(context.levelStarting, false);
  assert.equal(context.diffSelect.style.display, 'flex');
});

test('a pending profile mutation prevents starting a campaign', async () => {
  const { start, starts, context } = setup();
  context.profileMutationPending = true;
  await start();
  assert.deepEqual(starts, []);
});

test('player identity unhides both nested title rows, progress and pause without injecting markup', () => {
  const render = source.match(/function renderPlayerIdentity\([\s\S]*?\n\}/)[0];
  const rows = [];
  const elements = Object.fromEntries(['playing-as', 'progress-player-name', 'pause-player-name'].map(id => {
    const nested = [{ hidden: true }, { hidden: true }];
    rows.push(...nested);
    return [id, { textContent: '', closest: selector => nested[selector === '.playing-as-row' ? 0 : 1] }];
  }));
  const name = '<Player> & family';
  const context = { platform: { isApp: true }, activeLocalPlayer: { name },
    document: { getElementById: id => elements[id] } };
  vm.createContext(context);
  vm.runInContext(render, context);
  context.renderPlayerIdentity();
  for (const element of Object.values(elements)) {
    assert.equal(element.textContent, name);
    assert.equal(element.title, name);
    assert.equal(element.hidden, false);
  }
  assert.ok(rows.every(row => !row.hidden));
  context.activeLocalPlayer = null;
  context.renderPlayerIdentity();
  assert.ok(rows.every(row => row.hidden));
});

test('actual level startup preserves web baselines but never awards them to native continuation', async () => {
  const startup = source.match(/async function startLevel\([\s\S]*?\n\}/)[0];
  for (const isApp of [true, false]) {
    let baseline;
    const context = {
      profileMutationPending: false, profileUI: null, levelRequestGeneration: 0, gameplayTimers: [],
      practiceRun: null,
      getSkillIntro: () => null,
      showLoadingOverlay() {}, hideLoadingOverlay() {}, ensureLocalProfiles: async () => {},
      setAnswerInputVisible() {},
      platform: { isApp, username: '',
        localProfiles: { getActiveProfile: () => ({ id: 'player-a' }) },
        getAuthorizedLevelConfig: async () => ({ level: 3, baseline_score: 1500 }),
        setCurrentLevelConfig() {},
      },
      state: {}, input: { disable() {} },
      practiceRun: null,
      renderer: { setBackgroundByLevel() {}, waitForBackgroundLoad: async () => {} },
      assetsLoaded: Promise.resolve(), LOADING_SAFETY_TIMEOUT_MS: 1,
      setTimeout, clearPendingRecord() {}, setAccountModalVisible() {},
      finishStartLevel(_index, _cfg, value) { baseline = value; },
      handleLevelConfigError(error) { throw error; },
    };
    vm.createContext(context);
    vm.runInContext(startup, context);
    await context.startLevel(2, true);
    assert.equal(baseline, isApp ? 0 : 1500);
  }
});

test('the actual game-over retry restores hearts, time and checkpoint, including Shapes', () => {
  const result = source.match(/function triggerGameOver\([\s\S]*?\n\}/)[0];
  for (const shapes of [false, true]) {
    const element = () => ({ style: {}, textContent: '' });
    const context = {
      state: { isShapesMode: shapes, score: 900, hearts: 0, maxHearts: shapes ? 9 : 3,
        timerMax: shapes ? 25 : 5, timerRemaining: 0, timerActive: true },
      gameplayTimers: [], resetHealHold() {}, input: { disable() {} },
      setAnswerInputVisible() {},
      levelClearOverlay: element(), topBar: element(), gameOverOverlay: element(),
      gameOverScore: element(), btnRetryLevel: element(), btnReturnTitle: element(),
      document: { getElementById() { return null; } },
      audio: { stopBGM() {}, playGameOver() {}, playCampaignVictory() {} }, syncKeepAwake() {},
      practiceRun: null,
      platform: { isLoggedIn: false }, t: key => key,
      levelStartScore: 400, currentLevelIndex: 2, resetLevelAttempt,
      startLevel() {}, startPracticeSession() {},
      renderAttemptAccomplishment() {},
    };
    vm.createContext(context);
    vm.runInContext(result, context);
    context.triggerGameOver();
    context.btnRetryLevel.onclick();
    assert.equal(context.state.hearts, shapes ? 9 : 3);
    assert.equal(context.state.timerRemaining, shapes ? 25 : 5);
    assert.equal(context.state.score, shapes ? 0 : 400);
  }
});

test('successful completion uses victory wording and never plays defeat audio', () => {
  const result = source.match(/function triggerGameOver\([\s\S]*?\n\}/)[0];
  const title = { textContent: '' };
  const element = () => ({ style: {}, textContent: '' });
  let defeats = 0;
  let victories = 0;
  const context = {
    state: { isShapesMode: false, score: 9999, level: 60 },
    practiceRun: null,
    completionFeedback: null,
    gameplayTimers: [], resetHealHold() {}, input: { disable() {} },
    setAnswerInputVisible() {},
    levelClearOverlay: element(), topBar: element(), gameOverOverlay: element(),
    gameOverScore: element(), btnRetryLevel: element(), btnReturnTitle: element(),
    document: { getElementById() { return title; } },
    audio: { stopBGM() {}, playGameOver() { defeats++; }, playCampaignVictory() { victories++; } }, syncKeepAwake() {},
    platform: { isLoggedIn: false }, t: key => key,
    renderAttemptAccomplishment() {},
  };
  vm.createContext(context);
  vm.runInContext(result, context);
  context.triggerGameOver(true);
  assert.equal(defeats, 0);
  assert.equal(victories, 1);
  assert.equal(title.textContent, 'campaign.victory');
  assert.equal(context.btnRetryLevel.textContent, 'campaign.replay');
});
