import { it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('./main.js', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const block = source.slice(source.indexOf("btnResumeGame.addEventListener("),
  source.indexOf('// Shown once per playthrough'));

function setup({ loggedIn = true, app = false, shapes = false, practice = false,
  save = async () => {} } = {}) {
  const handlers = {};
  const element = name => ({
    style: {}, dataset: {}, textContent: '', disabled: false,
    addEventListener(event, callback) { handlers[name] = callback; },
  });
  let submissions = 0;
  let quits = 0;
  let refreshes = 0;
  const partials = [];
  const audioSettings = { open: false, querySelector: () => ({ focus() {} }) };
  const context = {
    document: { getElementById(id) {
      if (id === 'audio-settings') return audioSettings;
      return element(id);
    } },
    paused: false, gameRunning: true, inputDisabled: false, completedLevelSave: null,
    practiceRun: practice ? { kind: 'targeted' } : shapes ? { kind: 'shapes' } : null,
    runProfileId: app ? 'profile-1' : null,
    levelStartScore: 1000,
    createCompletionId: () => 'partial-id-1',
    state: { score: 1234, level: 2, difficulty: 'easy', isShapesMode: shapes, timerActive: true },
    platform: {
      isApp: app,
      isLoggedIn: loggedIn,
      localProfiles: app ? {
        getActiveProfile: () => ({ id: 'profile-1' }),
        async recordPartialAttempt(input) {
          partials.push(input);
          await save();
          return { persisted: true, bestImproved: true };
        },
      } : null,
      async postHighScore(score, level) {
        submissions++;
        assert.equal(score, 1234);
        assert.equal(level, 2);
        await save();
      },
    },
    pauseOverlay: element(), pauseActions: element(), pauseQuitActions: element(),
    pauseSaveNotice: element(), pauseSaveError: element(),
    btnResumeGame: element('resume'), btnQuitGame: element('quit'),
    btnPauseBack: element('back'), btnPauseSave: element('save'), btnPauseDiscard: element('discard'),
    input: { disable() {}, enable() {} },
    audio: { pauseBGM() {}, resumeBGM() {} },
    resetHealHold() {}, activeFiend: null, appLifecycle: null, syncKeepAwake() {},
    getCurrentInputMode() { return 'multiple-choice'; },
    t: key => key,
    clearPremiumSession() { quits++; context.gameRunning = false; },
    clearPendingRecord() {},
    diffSelect: { scrollTop: 100 },
    async refreshProfileAndLeaderboard() { refreshes++; },
    console: { error() {} },
  };
  vm.createContext(context);
  vm.runInContext(block, context);
  vm.runInContext('pauseGame();', context);
  return {
    context, handlers, audioSettings, submissions: () => submissions, quits: () => quits,
    refreshes: () => refreshes, partials: () => partials,
  };
}

it('audio Back returns to pause without resuming gameplay', () => {
  const { context, handlers, audioSettings } = setup();
  audioSettings.open = true;
  handlers['btn-audio-back']();
  assert.equal(audioSettings.open, false);
  assert.equal(context.paused, true);
  assert.equal(context.pauseOverlay.style.display, 'flex');
});

it('Android Back closes audio settings before returning to the game', () => {
  const { context, audioSettings } = setup();
  Object.assign(context, {
    pendingSkillIntro: null,
    levelClearOverlay: { style: { display: 'none' } },
    gameOverOverlay: { style: { display: 'none' } },
    healTipOverlay: { style: { display: 'none' } },
  });
  vm.runInContext(source.match(/function handleAppBack\(\)[\s\S]*?\n\}/)[0], context);
  audioSettings.open = true;
  assert.equal(context.handleAppBack(), true);
  assert.equal(audioSettings.open, false);
  assert.equal(context.paused, true);
  assert.equal(context.handleAppBack(), true);
  assert.equal(context.paused, false);
});

it('Back to game restores enabled answers in untimed practice', () => {
  const { context, handlers } = setup();
  let enabled = 0;
  context.activeFiend = {};
  context.state.timerActive = false;
  context.input.enable = () => { enabled++; };
  handlers.resume();
  assert.equal(enabled, 1);
  assert.equal(context.paused, false);
});

it('requires an explicit resume choice; quit confirmation and back keep gameplay paused', () => {
  const { context, handlers } = setup();
  assert.equal(context.paused, true);
  handlers.quit();
  assert.equal(context.pauseQuitActions.style.display, '');
  assert.equal(context.paused, true);
  handlers.back();
  assert.equal(context.pauseActions.style.display, '');
  assert.equal(context.paused, true);
  handlers.resume();
  assert.equal(context.paused, false);
  assert.equal(context.pauseOverlay.style.display, 'none');
  assert.ok(!source.includes("pauseOverlay.addEventListener('click'"));
  for (const id of ['btn-resume-game', 'btn-quit-game', 'btn-pause-save', 'btn-pause-discard']) {
    assert.ok(html.includes(`id="${id}"`));
  }
});

it('saves the current score once before quitting and blocks duplicate saves', async () => {
  let resolve;
  const pending = new Promise(res => { resolve = res; });
  const { context, handlers, submissions, quits } = setup({ save: () => pending });
  handlers.quit();
  const saving = handlers.save();
  await handlers.save();
  assert.equal(submissions(), 1);
  assert.equal(quits(), 0);
  assert.equal(context.btnPauseDiscard.disabled, true);
  resolve();
  await saving;
  assert.equal(quits(), 1);
  assert.equal(context.paused, false);
  assert.equal(context.diffSelect.scrollTop, 0);
  assert.equal(context.btnPauseSave.disabled, false);
});

it('keeps the game paused with a visible error if saving fails', async () => {
  const { context, handlers, quits } = setup({ save: async () => { throw new Error('offline'); } });
  handlers.quit();
  await handlers.save();
  assert.equal(quits(), 0);
  assert.equal(context.paused, true);
  assert.equal(context.pauseSaveError.textContent, 'overlay.saveScoreFailed');
  assert.equal(context.btnPauseSave.disabled, false);
});

it('offers save and discard with an unfinished notice in the app', () => {
  const { context, handlers } = setup({ app: true });
  handlers.quit();
  assert.equal(context.btnPauseSave.style.display, '');
  assert.equal(context.btnPauseDiscard.style.display, '');
  assert.equal(context.btnPauseDiscard.dataset.i18n, 'overlay.discardScore');
  assert.equal(context.pauseSaveNotice.textContent, 'overlay.unfinishedSaveNotice');
});

it('app save banks only the level score as one unfinished attempt and refreshes progress', async () => {
  const { context, handlers, submissions, quits, partials, refreshes } = setup({ app: true });
  handlers.quit();
  await handlers.save();
  assert.deepEqual(partials().map((input) =>
    [input.profileId, input.completionId, input.level, input.score, input.difficulty]),
  [['profile-1', 'partial-id-1', 2, 234, 'easy']]);
  assert.equal(submissions(), 0);
  assert.equal(quits(), 1);
  assert.equal(context.paused, false);
  assert.equal(refreshes(), 2);
});

it('a failed app save stays paused and retries with the same attempt ID', async () => {
  let attempts = 0;
  const { context, handlers, quits, partials, refreshes } = setup({
    app: true,
    save: async () => { if (++attempts === 1) throw new Error('offline'); },
  });
  handlers.quit();
  await handlers.save();
  assert.equal(quits(), 0);
  assert.equal(refreshes(), 0);
  assert.equal(context.paused, true);
  assert.equal(context.pauseSaveError.textContent, 'overlay.saveScoreFailed');
  assert.equal(context.btnPauseSave.disabled, false);
  await handlers.save();
  assert.equal(quits(), 1);
  assert.deepEqual(partials().map((input) => input.completionId), ['partial-id-1', 'partial-id-1']);
});

it('the app offers no save in practice or Shapes and writes nothing', async () => {
  for (const options of [{ app: true, practice: true }, { app: true, shapes: true }]) {
    const { context, handlers, quits, partials } = setup(options);
    handlers.quit();
    assert.equal(context.btnPauseSave.style.display, 'none');
    assert.equal(context.btnPauseDiscard.dataset.i18n, 'overlay.returnTitle');
    await handlers.save();
    assert.equal(partials().length, 0);
    assert.equal(context.paused, true);
    handlers.discard();
    assert.equal(quits(), 1);
  }
});

for (const options of [{ loggedIn: false }, { shapes: true }, {}]) {
  it(`discards without submitting a score for ${JSON.stringify(options)}`, async () => {
    const { context, handlers, submissions, quits } = setup(options);
    handlers.quit();
    if (options.loggedIn === false || options.shapes) {
      assert.equal(context.btnPauseSave.style.display, 'none');
      await handlers.save();
      assert.equal(submissions(), 0);
    }
    handlers.discard();
    assert.equal(submissions(), 0);
    assert.equal(quits(), 1);
  });
}

it('freezes delayed combat during pause and cancels it when quitting', () => {
  const { context, handlers } = setup();
  vm.runInContext('scheduleGameplayTimeout(() => { state.score++; }, 300);', context);
  assert.match(source, /if \(!paused\) advanceGameplayTimers\(dt\);/);
  assert.equal(context.state.score, 1234);
  handlers.discard();
  vm.runInContext('advanceGameplayTimers(1);', context);
  assert.equal(context.state.score, 1234);
});

it('runs gameplay timers once and defers newly scheduled timers to later frames', () => {
  const { context } = setup();
  vm.runInContext(`
    scheduleGameplayTimeout(() => {
      state.score++;
      scheduleGameplayTimeout(() => { state.score++; }, 100);
    }, 100);
    advanceGameplayTimers(0.1);
  `, context);
  assert.equal(context.state.score, 1235);
  vm.runInContext('advanceGameplayTimers(0.1);', context);
  assert.equal(context.state.score, 1236);
  vm.runInContext('advanceGameplayTimers(1);', context);
  assert.equal(context.state.score, 1236);
});
