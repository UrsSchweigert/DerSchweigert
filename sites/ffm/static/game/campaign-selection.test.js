import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { getCampaignProgress, resetLevelAttempt } from './campaign-progress.js';
import { createLevelGrid } from './level-grid.js';
import { isLevelTestProfile, levelAvailability } from './test-profile.js';
import { createCampaign2Progress } from './campaign2/progress.js';
import { TOTAL_LEVELS_2 } from './campaign2/campaign2-levels.js';

const source = readFileSync(new URL('./main.js', import.meta.url), 'utf8');
const difficulty = source.slice(source.indexOf("document.querySelectorAll('#difficulty-select [data-difficulty]').forEach"),
  source.indexOf('function onLevelGridSelect('));

function setup({ completed = [1, 2], selected = '', fail = false, difficultyKind = 'hard',
  profileName = 'Ada', premium = true } = {}) {
  let handler;
  const starts = [];
  const introPlays = [];
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
    isLevelTestProfile, levelAvailability, activeLocalPlayer: { name: profileName },
    premiumAccess: premium,
    async startLevel(index, baseline) { starts.push([index, baseline]); },
    async startPracticeSession(...args) { starts.push(args); },
    storyIntro: { async playBeforeLevel(level) { introPlays.push(level); } },
    showTitlePage() {}, showProgressError() {}, t: key => key,
    console: { error() {} },
  };
  vm.createContext(context);
  vm.runInContext(difficulty, context);
  return { context, start: () => handler(), starts, introPlays };
}

test('Play continues at the first unfinished level without inventing a score baseline', async () => {
  const { start, starts, context, introPlays } = setup({ completed: [1, 3] });
  await start();
  assert.deepEqual(starts, [[1, true]]);
  // The story intro belongs to level 1 and is asked for before the level starts.
  assert.deepEqual(introPlays, [2]);
  assert.equal(context.state.score, 0);
  assert.equal(context.state.hearts, 3);
});

test('the unlocked player can start any level the grid offered, including an uncleared one', async () => {
  const unlocked = setup({ completed: [1, 2], selected: '47', profileName: 'unlocked', premium: true });
  await unlocked.start();
  assert.deepEqual(unlocked.starts, [[46, true]], 'level 47 starts even though 47 was never cleared');

  // Case and stray spaces are the player's typing, not a different profile.
  const spaced = setup({ completed: [], selected: '20', profileName: ' UNLOCKED ', premium: true });
  await spaced.start();
  assert.deepEqual(spaced.starts, [[19, true]]);
});

test('everyone else still cannot start an uncleared level from the grid', async () => {
  const normal = setup({ completed: [1, 2], selected: '47', profileName: 'Ada', premium: true });
  await normal.start();
  assert.deepEqual(normal.starts, [], 'a normal player is refused');

  const unpaid = setup({ completed: [1, 2], selected: '47', profileName: 'unlocked', premium: false });
  await unpaid.start();
  assert.deepEqual(unpaid.starts, [], 'and so is the hatch without the paid unlock');
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
  vm.runInContext(source.match(/function isCampaign2Selected\([\s\S]*?\n\}/)[0], context);
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
    // The level-test hatch: off here, so this test keeps pinning the ordinary
    // continuation page for a normal player on a paid device.
    isLevelTestProfile,
    levelAvailability,
    premiumAccess: true,
    activeLocalPlayer: { name: 'Ada' },
  };
  vm.createContext(context);
  for (const name of ['isCampaign2Selected', 'updateTitleStartingLevel', 'renderLocalCampaign']) {
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

test('a paid app profile named "unlocked" gets every level as a tile', () => {
  // The hatch behind "jump into level 47 to look at its storm": every level is
  // one tap away, and only for that player.
  const grid = createLevelGrid({ doc: null });
  let selection;
  const context = {
    platform: { isApp: true },
    getCampaignProgress,
    levelGrid: grid,
    levelJumpRow: { style: {} },
    TOTAL_LEVELS: 60,
    titleLevelNumerals: { updateLevelSelection(value) { selection = value; } },
    document: { getElementById: () => ({ dataset: {}, hidden: false }) },
    t: (key, vars) => `${key}:${vars?.level ?? ''}`,
    isLevelTestProfile,
    levelAvailability,
    premiumAccess: true,
    activeLocalPlayer: { name: 'unlocked' },
  };
  vm.createContext(context);
  for (const name of ['isCampaign2Selected', 'updateTitleStartingLevel', 'renderLocalCampaign']) {
    vm.runInContext(source.match(new RegExp(`function ${name}\\([\\s\\S]*?\\n\\}`))[0], context);
  }

  context.renderLocalCampaign([1, 2, 3]);
  assert.equal(grid.entries.length, 60);
  assert.equal(grid.entries.filter((entry) => entry.state === 'locked').length, 0,
    'nothing is locked for the test profile');

  grid.value = '47';
  assert.equal(grid.value, '47', 'the far end of the curriculum is selectable');
  context.renderLocalCampaign([1, 2, 3]);
  assert.equal(selection.level, 47, 'and the title offers to start there');
});

// --- Campaign II on the Levels page ---
// The owner's report: the "unlocked" player in Campaign II saw Campaign I's 60 levels, and a
// picked level neither started nor showed in the title's level numeral (it stayed at 1).
function memoryStorage(seed = {}) {
  const data = new Map(Object.entries(seed));
  return {
    getItem: key => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: key => data.delete(key),
  };
}
function campaign2Store(cleared = []) {
  return createCampaign2Progress({ playerId: 'player-a', storage: memoryStorage(
    cleared.length ? { 'arithmoslayer:campaign2:player-a': JSON.stringify({ version: 1, cleared }) } : {}) });
}
const fnSource = name => source.match(new RegExp(`function ${name}\\([\\s\\S]*?\\n\\}`))?.[0] ?? '';

function levelsPage({ isApp = true, profileName = 'unlocked', campaign = 2, cleared2 = [], premium = true } = {}) {
  const grid = createLevelGrid({ doc: null });
  const shown = { selection: null, line: { textContent: '' }, levelsButton: { hidden: true } };
  const context = {
    platform: { isApp },
    selectedCampaign: campaign,
    getCampaignProgress,
    campaign2Progress: () => campaign2Store(cleared2),
    levelGrid: grid,
    levelJumpRow: { style: {} },
    TOTAL_LEVELS: 60,
    TOTAL_LEVELS_2,
    titleLevelNumerals: { updateLevelSelection(value) { shown.selection = value; } },
    document: { getElementById: id => (id === 'continue-level' ? shown.line
      : id === 'title-levels-btn' ? shown.levelsButton : { dataset: {}, hidden: false }) },
    t: (key, vars) => `${key}:${vars?.level ?? ''}`,
    isLevelTestProfile, levelAvailability, premiumAccess: premium,
    activeLocalPlayer: { name: profileName },
  };
  vm.createContext(context);
  for (const name of ['isCampaign2Selected', 'renderCampaign2Levels', 'updateTitleStartingLevel',
    'renderLocalCampaign', 'renderLevelJumpOptions']) {
    vm.runInContext(fnSource(name), context);
  }
  return { context, grid, shown };
}

test('the unlocked player in Campaign II gets its 40 levels, not Campaign I\'s 60', () => {
  const { context, grid } = levelsPage({ profileName: 'UNLOCKED' });
  context.renderLocalCampaign([1, 2, 3]);
  assert.equal(grid.entries.length, TOTAL_LEVELS_2);
  assert.equal(TOTAL_LEVELS_2, 40);
  assert.equal(grid.entries.filter(entry => entry.state === 'locked').length, 0, 'every Campaign II level is open');

  // Switching back to Campaign I brings its 60 back.
  context.selectedCampaign = 1;
  context.renderLocalCampaign([1, 2, 3]);
  assert.equal(grid.entries.length, 60);
  assert.equal(grid.entries.filter(entry => entry.state === 'locked').length, 0);
});

test('any other player in Campaign II sees 40 levels: its cleared ones and the next', () => {
  const { context, grid } = levelsPage({ profileName: 'Ada', cleared2: [1, 2, 5] });
  context.renderLocalCampaign([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);   // Campaign I progress must not leak in
  assert.equal(grid.entries.length, 40);
  assert.deepEqual(grid.entries.filter(entry => entry.state !== 'locked').map(entry => [entry.level, entry.value]),
    [[1, '1'], [2, '2'], [3, ''], [5, '5']]);
});

test('a Campaign II level picked on the Levels page shows in the title numeral', () => {
  const { context, grid, shown } = levelsPage({ profileName: 'unlocked', cleared2: [1, 2] });
  context.renderLocalCampaign([]);
  assert.equal(shown.selection.level, 3, 'the continuation before a pick');
  assert.equal(shown.line.textContent, 'campaign2.continueAt:3');
  grid.value = '17';
  context.renderLocalCampaign([]);   // what onLevelGridSelect does in the app
  assert.equal(shown.selection.level, 17);
  assert.equal(shown.selection.mode, 'replay');
  assert.equal(shown.line.textContent, 'campaign.startAt:17', 'an uncleared level is a start, not a replay');
  grid.value = '2';
  context.renderLocalCampaign([]);
  assert.equal(shown.line.textContent, 'campaign.replay:2');
  grid.value = '41';
  assert.equal(grid.value, '', 'Campaign II has no level 41');
});

test('the web Levels page lists Campaign II\'s 40 levels while it is chosen', () => {
  const { context, grid, shown } = levelsPage({ isApp: false, profileName: null, cleared2: [1, 2, 3, 4] });
  context.renderLevelJumpOptions({ scores: [{ level: 55 }] });
  assert.equal(grid.entries.length, 40);
  assert.deepEqual(grid.entries.filter(entry => entry.state !== 'locked').map(entry => entry.level), [1, 2, 3, 4, 5]);
  assert.equal(shown.levelsButton.hidden, false);
  grid.value = '3';
  context.renderLevelJumpOptions({ scores: [{ level: 55 }] });
  assert.equal(shown.selection.level, 3);
  assert.equal(shown.line.textContent, 'title.levelNumerals:3');
  context.selectedCampaign = 1;
  context.renderLevelJumpOptions({ scores: [{ level: 55 }] });
  assert.equal(grid.entries.length, 60, 'Campaign I keeps its 60');
});

function campaign2Start({ selected = '', profileName = 'unlocked', premium = true, cleared2 = [], isApp = true } = {}) {
  const run = setup({ selected, profileName, premium });
  run.context.platform.isApp = isApp;
  Object.assign(run.context, { selectedCampaign: 2, TOTAL_LEVELS_2, campaign2Progress: () => campaign2Store(cleared2) });
  return run;
}

test('picking a Campaign II level starts that level', async () => {
  const unlocked = campaign2Start({ selected: '17', profileName: 'UNLOCKED' });
  await unlocked.start();
  assert.deepEqual(unlocked.starts, [[16, true]], 'level 17 of Campaign II, not its continuation');
  assert.deepEqual(unlocked.introPlays, [], 'Campaign II has no story intro');

  const replay = campaign2Start({ selected: '2', profileName: 'Ada', cleared2: [1, 2, 3] });
  await replay.start();
  assert.deepEqual(replay.starts, [[1, true]], 'a cleared level replays');

  const web = campaign2Start({ selected: '3', profileName: null, cleared2: [1, 2, 3], isApp: false });
  await web.start();
  assert.deepEqual(web.starts, [[2, true]], 'and on the web');

  const next = campaign2Start({ profileName: 'Ada', cleared2: [1, 2, 3] });
  await next.start();
  assert.deepEqual(next.starts, [[3, true]], 'no pick: the continuation');
});

test('Campaign II refuses a level that was not offered', async () => {
  const normal = campaign2Start({ selected: '17', profileName: 'Ada', cleared2: [1] });
  await normal.start();
  assert.deepEqual(normal.starts, []);
  const tooFar = campaign2Start({ selected: '47', profileName: 'unlocked' });
  await tooFar.start();
  assert.deepEqual(tooFar.starts, [], 'a stale Campaign I pick past level 40 never starts');
});

test('switching campaign clears the pick and re-renders the Levels page', () => {
  const choose = fnSource('chooseCampaign');
  const refresh = fnSource('refreshLevelGrid');
  const grid = { value: '47' };
  const calls = [];
  const context = {
    selectedCampaign: 1, levelGrid: grid, platform: { isApp: true },
    currentPersonalDevelopment: { completed: [1] }, currentProfile: null,
    campaignSelection: () => ({ set() {} }),
    renderLocalCampaign: () => calls.push('app'), renderLevelJumpOptions: () => calls.push('web'),
    updateTitleStartingLevel: () => calls.push('title'),
  };
  vm.createContext(context);
  vm.runInContext(choose, context);
  vm.runInContext(refresh, context);
  context.chooseCampaign(2);
  assert.equal(grid.value, '', 'a Campaign I pick means nothing in Campaign II');
  context.refreshLevelGrid();
  context.platform.isApp = false;
  context.refreshLevelGrid();
  assert.deepEqual(calls, ['app', 'web']);
  grid.value = '5';
  context.chooseCampaign(2);
  assert.equal(grid.value, '5', 're-choosing the same campaign keeps the pick');
  // The switch re-renders the grid, not only the title line.
  assert.match(fnSource('renderCampaignSwitch'), /refreshLevelGrid\(\);\n\}$/);
});

test('a jump to an uncleared level is labelled a start, not a replay', () => {
  const grid = createLevelGrid({ doc: null });
  const continuation = { textContent: '' };
  const context = {
    platform: { isApp: true },
    getCampaignProgress,
    levelGrid: grid,
    levelJumpRow: { style: {} },
    TOTAL_LEVELS: 60,
    titleLevelNumerals: { updateLevelSelection() {} },
    document: { getElementById: id => id === 'continue-level' ? continuation : { dataset: {}, hidden: false } },
    t: (key, vars) => `${key}:${vars?.level ?? ''}`,
    // The unlocked profile: only it is offered a tile for an uncleared level.
    isLevelTestProfile, levelAvailability, premiumAccess: true, activeLocalPlayer: { name: 'unlocked' },
  };
  vm.createContext(context);
  for (const name of ['isCampaign2Selected', 'updateTitleStartingLevel', 'renderLocalCampaign']) {
    vm.runInContext(source.match(new RegExp(`function ${name}\\([\\s\\S]*?\\n\\}`))[0], context);
  }

  // The grid must exist before a selection can stick to it.
  context.renderLocalCampaign([1, 2]);
  grid.value = '47';
  context.renderLocalCampaign([1, 2]);
  assert.equal(continuation.textContent, 'campaign.startAt:47');

  grid.value = '2';
  context.renderLocalCampaign([1, 2]);
  assert.equal(continuation.textContent, 'campaign.replay:2', 'a cleared level is still a replay');
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
      renderer: { setBackgroundByLevel() {}, waitForBackgroundLoad: async () => {}, groundY: 360 },
      applyLevelGround() {},
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

test('the level-clear fanfare fires exactly once and only for a cleared level', () => {
  const result = source.match(/function triggerWaveClear\([\s\S]*?\n\}/)[0];

  function run({ level = 3, practice = false } = {}) {
    const calls = { hymns: 0, cues: 0, heals: 0, scheduled: 0 };
    const context = {
      waveClearing: false,
      gameRunning: true,
      practiceRun: practice ? { endless: false, completed: false } : null,
      state: { level, hearts: 1, maxHearts: 3 },
      TOTAL_LEVELS: 60,
      GAME_CONFIG: { healingAuraDuration: 1 },
      syncKeepAwake() {},
      hero: { setState() {}, _healAura: 0 },
      hud: { update() {} },
      audio: {
        playVictoryHymn() { calls.hymns++; return Promise.resolve(true); },
        playLevelClear() { calls.cues++; },
        playHeal() { calls.heals++; },
      },
      scheduleGameplayTimeout() { calls.scheduled++; },
      triggerLevelClear() {},
      finishPracticeSession() { calls.scheduled++; },
    };
    vm.createContext(context);
    vm.runInContext(result, context);
    context.triggerWaveClear();
    context.triggerWaveClear();   // the waveClearing guard must swallow the repeat
    return calls;
  }

  const cleared = run();
  assert.equal(cleared.hymns, 1, 'one fanfare per cleared level, even if the clear fires twice');
  assert.equal(cleared.cues, 0, 'the synth cue is only the fallback');
  assert.equal(cleared.scheduled, 1, 'the clear overlay is scheduled once');

  assert.equal(run({ level: 60 }).hymns, 0, 'the final level hands over to triggerGameOver');
  assert.equal(run({ practice: true }).hymns, 0, 'practice runs have no fanfare');
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
