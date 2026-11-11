import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createAttemptSummary } from './attempt-summary.js';
import {
  createEarnedRecovery,
  createPracticeSession,
  collectTargetedProblems,
  getPracticeBadgeIds,
} from './practice-session.js';
import { resetLevelAttempt } from './campaign-progress.js';
import { getSkillIntro } from './skill-intro.js';
import { isAbilityBandStart } from './combo-abilities.js';
import { generateShapesProblem } from './shapes.js';
import { getArithmeticOptionCount } from './levels.js';
import { PRACTICE_KINDS } from './practice-session.js';
import { setLocale, t } from './i18n.js';
import {
  applyAudioPreferences,
  applyDeferredMusicVolume,
  readAudioPreferences,
  writeAudioPreferences,
} from './audio-preferences.js';

const source = readFileSync(new URL('./main.js', import.meta.url), 'utf8');
const fn = name => {
  const found = source.match(new RegExp(`(?:async )?function ${name}\\([\\s\\S]*?\\n\\}`));
  assert.ok(found, `${name} must exist`);
  return found[0];
};
const element = () => ({ style: {}, textContent: '', hidden: false, disabled: false });
const problem = (operation = '+', answer = 2) => ({
  operation, answer, question: `1 ${operation} 1 = ?`, options: [answer, answer + 1],
});

test('Progress explains every selected training mode in DE/EN alongside the unscored notice', () => {
  const description = { dataset: {}, textContent: '' };
  const context = {
    practiceKindSelect: { value: 'targeted' },
    document: { getElementById: id => id === 'practice-description' ? description : null },
    t,
  };
  vm.createContext(context);
  vm.runInContext(fn('renderPracticeDescription'), context);
  for (const locale of ['de', 'en']) {
    setLocale(locale, { persist: false });
    for (const kind of PRACTICE_KINDS) {
      context.practiceKindSelect.value = kind;
      context.renderPracticeDescription();
      const key = `practice.description.${kind}`;
      assert.equal(description.dataset.i18n, key);
      assert.equal(description.textContent, t(key));
      assert.notEqual(description.textContent, key);
      assert.ok(description.textContent.length > 40);
    }
    assert.notEqual(t('practice.unscoredDescription'), 'practice.unscoredDescription');
  }
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /data-title-page="progress"[\s\S]*id="practice-kind" aria-describedby="practice-description practice-unscored"/);
  assert.match(source, /practiceKindSelect\?\.addEventListener\('change',[\s\S]*?renderPracticeDescription\(\)/);
});

function practiceStartContext(kind, targetProblems = []) {
  let started;
  const context = {
    practiceKindSelect: { value: kind },
    practiceLevelSelect: { value: '34' },
    practiceStatus: { textContent: '', classList: { toggle() {} } },
    btnStartPractice: { disabled: false },
    levelStarting: false,
    profileMutationPending: false,
    pendingSkillIntro: null,
    platform: { isApp: false, username: '' },
    profileUI: null,
    runProfileId: null,
    TOTAL_LEVELS: 60,
    state: { difficulty: 'medium', score: 900, hearts: 3, maxHearts: 3, timerMax: 10 },
    createCompletionId: () => `practice-${kind}`,
    createPracticeSession,
    createEarnedRecovery,
    getTargetedProblems: () => targetProblems,
    showPracticeStatus: message => { context.practiceStatus.textContent = message; },
    startLevel: async index => { started = index; },
    t: key => key,
    console: { error() {} },
  };
  vm.createContext(context);
  vm.runInContext(fn('startPracticeSession'), context);
  return { context, started: () => started };
}

test('the training tab explains the selected level from its authorized config', async () => {
  const hint = { textContent: '' };
  const configs = {
    1: { operations: ['+'], maxResult: 10 },
    15: { operations: ['+', '-'], maxResult: 20 },
    45: { operations: ['+', '-', '*', '/'], maxResult: 1440 },
  };
  const requested = [];
  const context = {
    practiceLevelHint: hint,
    practiceKindSelect: { value: 'short' },
    practiceLevelSelect: { value: '1' },
    platform: {
      async getAuthorizedLevelConfig(index) {
        requested.push(index + 1);
        const config = configs[index + 1];
        if (!config) throw Object.assign(new Error('requires an entitlement'), { statusCode: 402 });
        return { level: index + 1, ...config };
      },
    },
    levelSummaries: new Map(),
    levelHintGeneration: 0,
    OPERATION_KEYS: {
      '+': 'practice.operation.add', '-': 'practice.operation.subtract',
      '*': 'practice.operation.multiply', '/': 'practice.operation.divide',
    },
    OPERATION_ORDER: ['+', '-', '*', '/'],
    TOTAL_LEVELS: 60,
    getArithmeticOptionCount,
    t,
  };
  vm.createContext(context);
  for (const name of ['levelOperationsLabel', 'loadLevelSummary', 'updatePracticeLevelHint']) {
    vm.runInContext(fn(name), context);
  }

  setLocale('en', { persist: false });
  await context.updatePracticeLevelHint();
  assert.equal(hint.textContent, 'Level 1: addition, results up to 10 · 5 answer choices');
  assert.deepEqual(requested, [1], 'one authorized lookup per level');

  context.practiceLevelSelect.value = '15';
  await context.updatePracticeLevelHint();
  assert.equal(hint.textContent, 'Level 15: addition and subtraction, results up to 20 · 10 answer choices');

  context.practiceLevelSelect.value = '45';
  await context.updatePracticeLevelHint();
  assert.equal(hint.textContent,
    'Level 45: addition, subtraction, multiplication and division, results up to 1440 · 10 answer choices');

  // Locale switch re-renders the same cached summary in the new language.
  setLocale('de', { persist: false });
  const before = requested.length;
  await context.updatePracticeLevelHint();
  assert.equal(hint.textContent, 'Level 45: Plus, Minus, Mal und Geteilt, Ergebnisse bis 1440 · 10 Antworten');
  assert.equal(requested.length, before, 'the cached summary is reused');

  // A locked level says so instead of showing an empty or invented hint.
  context.practiceLevelSelect.value = '30';
  await context.updatePracticeLevelHint();
  assert.equal(hint.textContent, t('practice.levelHintLocked'));
  assert.notEqual(hint.textContent, 'practice.levelHintLocked');

  // Shape counting ignores the source level.
  context.practiceKindSelect.value = 'shapes';
  context.practiceLevelSelect.value = '1';
  await context.updatePracticeLevelHint();
  assert.equal(hint.textContent, t('practice.levelHintShapes'));
  setLocale('en', { persist: false });

  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /<select id="practice-level-select"><\/select>\s*<p id="practice-level-hint" class="practice-level-hint" role="status" aria-live="polite"><\/p>/);
  assert.match(source, /practiceLevelSelect\?\.addEventListener\('change',[\s\S]*?updatePracticeLevelHint\(\)/);
  assert.match(source, /practiceKindSelect\?\.addEventListener\('change',[\s\S]*?updatePracticeLevelHint\(\)/);
  assert.match(source, /onLocaleChange\(\(\) => \{[\s\S]*?updatePracticeLevelHint\(\)/);
  const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
  assert.match(css, /#practice-level-hint \{[^}]*grid-column: 1 \/ -1;/s);
  assert.match(css, /#practice-level-hint \{[^}]*text-align: center;/s,
    'the level explanation is a one-line label, so it stays centred under its selector');
  assert.match(css, /#practice-level-hint:empty \{ display: none; \}/);

  // Only one hint element: the web and app builds share the markup.
  assert.equal((html.match(/id="practice-level-hint"/g) ?? []).length, 1);
});

test('the practice panel is a submenu with the tab title style and its own way back', async () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');

  // The summary carries the Training tab's own heading style.
  const summary = css.match(/^#practice-panel > summary \{([^}]*)\}/m)?.[1];
  assert.ok(summary, 'practice submenu title rule missing');
  assert.match(summary, /font-family:\s*var\(--font-prose\);/);
  assert.match(summary, /font-size:\s*var\(--text-heading\);/);
  assert.match(summary, /font-weight:\s*700;/);
  assert.match(summary, /color:\s*var\(--ivory\);/);

  // A back control closes the submenu and the summary can take focus back.
  assert.match(html, /<button type="button" id="btn-close-practice" class="diff-btn practice-back" data-i18n="practice.back">Back<\/button>/);
  assert.match(source, /function closePracticePanel\(\) \{[\s\S]*?practicePanel\.open = false;[\s\S]*?querySelector\('summary'\)\?\.focus\?\.\(\);/);
  assert.match(source, /getElementById\('btn-close-practice'\)\?\.addEventListener\('click', closePracticePanel\)/);
  assert.match(source, /practicePanel\?\.addEventListener\('keydown',[\s\S]*?'Escape'[\s\S]*?closePracticePanel\(\)/);
  const back = css.match(/^#btn-close-practice \{([^}]*)\}/m)?.[1];
  assert.ok(back, 'back button rule missing');
  assert.match(back, /grid-column:\s*1 \/ -1;/);
  assert.match(back, /width:\s*100%;/);
  assert.match(back, /min-height:\s*44px;/);

  for (const locale of ['de', 'en']) {
    setLocale(locale, { persist: false });
    assert.notEqual(t('practice.back'), 'practice.back');
  }
  setLocale('en', { persist: false });
  assert.equal(t('practice.back'), 'Back');
  setLocale('de', { persist: false });
  assert.equal(t('practice.back'), 'Zurück');
  setLocale('en', { persist: false });
});

test('all six practice modes initialize a fresh unscored session and bounded source level', async () => {
  const targets = Array.from({ length: 7 }, () => problem());
  for (const kind of ['targeted', 'short', 'assisted', 'elite', 'recovery', 'shapes']) {
    const { context, started } = practiceStartContext(kind, targets.slice(0, 5));
    await context.startPracticeSession();
    assert.equal(started(), 33);
    assert.equal(context.practiceRun.kind, kind);
    assert.equal(context.practiceRun.sourceLevel, 34);
    assert.equal(context.practiceRun.sessionId, `practice-${kind}`);
    assert.equal(context.practiceRun.session.snapshot().scored, false);
    assert.equal(context.state.score, 0);
    assert.equal(context.state.isShapesMode, kind === 'shapes');
    assert.equal(context.practiceRun.targetProblems.length, kind === 'targeted' ? 5 : 0);
    assert.equal(context.state.timerActive, undefined);
  }
});

test('targeted misses retain distinct original problems by source level and clear on profile switch', () => {
  const context = {
    practiceRun: null, state: { isShapesMode: false },
    runProfileId: 'player-a', missedProblemsOwner: 'player-a',
    missedProblemsByLevel: new Map(),
    practiceOwnerId: () => 'player-a',
    collectTargetedProblems,
  };
  vm.createContext(context);
  vm.runInContext(
    `${fn('clearMissedProblemsForOwner')}\n${fn('rememberMissedProblem')}\n${fn('getTargetedProblems')}`,
    context,
  );
  const missed = Array.from({ length: 7 }, () => problem());
  for (const p of missed) context.rememberMissedProblem(p, 32);
  context.rememberMissedProblem(missed[0], 32);
  const level34Problem = problem();
  context.rememberMissedProblem(level34Problem, 33);
  const targets = context.getTargetedProblems(33);
  assert.equal(targets.length, 5);
  assert.equal(targets[0], missed[0]);
  assert.equal(targets[4], missed[4]);
  const level33 = context.getTargetedProblems(33);
  assert.equal(level33[0], missed[0]);
  assert.equal(context.getTargetedProblems(33).length, 5);
  assert.equal(context.getTargetedProblems(34)[0], level34Problem);
  context.clearMissedProblemsForOwner('player-b');
  assert.equal(context.getTargetedProblems(33).length, 0);
});

test('level setup bounds enemy queues and resets practice pacing without changing campaign pacing', () => {
  const setup = (practiceRun, isShapesMode = false) => {
    const context = {
      gameplayTimers: [], waveClearing: false, answerTimes: [], spawnInterval: 4,
      setAnswerInputVisible() {},
      answerClock: { reset() {} }, createAttemptSummary, attemptSummary: createAttemptSummary(),
      completionFeedback: null, lastCastAbility: null, practiceRun, campaignWon: false,
      completedLevelSave: null, currentLevelIndex: 0, levelStartScore: 0,
      state: {
        score: 0, level: 1, combo: 0, timerMax: 10, timerRemaining: 2,
        hearts: 5, maxHearts: 5, isShapesMode,
      },
      spawnQueue: [], requeuedFiends: [], fiends: [], activeFiend: null,
      inputDisabled: true, pendingProblemActivation: null,
      activeLightningBolts: [], activeFireballs: [], activeDragons: [],
      resetHealHold() {},
      platform: { isApp: false },
      diffSelect: { style: { display: 'flex' } },
      pauseOverlay: { style: {} }, topBar: { style: {} },
      levelClearOverlay: { style: {} }, gameOverOverlay: { style: {} },
      practiceBadgeRetryButton: null,
      updateHUDLogoutVisibility() {}, hud: { update() {} },
      audio: { startLevelBGM() {} }, syncKeepAwake() {},
      flushDeferredMusicVolume() {},
      animFrameId: 1, cfg: null,
    };
    vm.createContext(context);
    vm.runInContext(fn('finishStartLevel'), context);
    context.finishStartLevel(7, { level: 8, chapter: 1, waveSize: 24 });
    return context;
  };
  for (const kind of ['short', 'assisted', 'elite', 'recovery']) {
    const context = setup({ kind, targetProblems: [] });
    assert.equal(context.spawnQueue.length, 10);
    assert.equal(context.spawnInterval, 2);
  }
  const targets = Array.from({ length: 5 }, () => problem());
  const targeted = setup({ kind: 'targeted', targetProblems: targets });
  assert.equal(targeted.spawnQueue.length, targets.length);
  targets.forEach((target, index) => assert.equal(targeted.spawnQueue[index], target));
  assert.equal(targeted.spawnInterval, 2);
  const shapes = setup({ kind: 'shapes', targetProblems: [] }, true);
  assert.equal(shapes.spawnQueue.length, 0);
  assert.equal(shapes.spawnInterval, 2);
  const campaign = setup(null);
  assert.equal(campaign.spawnQueue.length, 24);
  assert.equal(campaign.spawnInterval, 4);
  assert.equal(generateShapesProblem(1).distractors.length + 1, 4);
});

test('every practice source level goes through authorized level config before setup', async () => {
  const startup = fn('startLevel');
  for (const kind of ['targeted', 'short', 'assisted', 'elite', 'recovery', 'shapes']) {
    const requested = [];
    let finished = 0;
    const context = {
      practiceRun: { kind, sourceLevel: 42 },
      state: { timerActive: true },
      levelRequestGeneration: 0,
      levelStarting: false,
      profileMutationPending: false,
      platform: {
        isApp: true, username: '',
        localProfiles: { getActiveProfile: () => ({ id: 'player-a' }) },
        getAuthorizedLevelConfig: async (index, baseline) => {
          requested.push([index, baseline]);
          return { level: index + 1, baseline_score: 700 };
        },
        setCurrentLevelConfig() {},
      },
      showLoadingOverlay() {}, hideLoadingOverlay() {},
      setAnswerInputVisible() {},
      ensureLocalProfiles: async () => {}, profileUI: { whenIdle: async () => {} },
      input: { disable() {} }, renderer: { setBackgroundByLevel() {}, waitForBackgroundLoad: async () => {} },
      assetsLoaded: Promise.resolve(), LOADING_SAFETY_TIMEOUT_MS: 1,
      setTimeout, clearPendingRecord() {}, setAccountModalVisible() {},
      getSkillIntro: () => null,
      finishStartLevel() { finished++; },
      handleLevelConfigError(error) { throw error; },
    };
    vm.createContext(context);
    vm.runInContext(startup, context);
    await context.startLevel(41);
    assert.deepEqual(requested, [[41, false]]);
    assert.equal(finished, 1);
    assert.equal(context.runProfileId, 'player-a');
  }
});

test('worked examples render only after authorization and both intro actions start the level', () => {
  for (const action of ['continue', 'skip']) {
    let startCount = 0;
    const handlers = {};
    const context = {
      activeSkillIntro: null,
      skillIntroOverlay: element(), skillIntroTitle: element(), skillIntroBody: element(),
      skillIntroExample: element(),
      btnSkillIntroContinue: { addEventListener: (event, callback) => { handlers.continue = callback; } },
      btnSkillIntroSkip: { addEventListener: (event, callback) => { handlers.skip = callback; } },
      t: (key, values) => `${key}:${values?.a}/${values?.b}/${values?.answer}`,
      finishStartLevel() { startCount++; },
      clearPendingRecord() {}, setAccountModalVisible() {},
    };
    vm.createContext(context);
    vm.runInContext(`${fn('renderSkillIntro')}\n${fn('showSkillIntro')}\n` +
      `btnSkillIntroContinue.addEventListener('click', () => pendingSkillIntro?.());\n` +
      `btnSkillIntroSkip.addEventListener('click', () => pendingSkillIntro?.());`, context);
    context.showSkillIntro(getSkillIntro(34), 33, { level: 34 }, 0);
    assert.equal(context.skillIntroOverlay.style.display, 'flex');
    assert.match(context.skillIntroBody.textContent, /20\/4\/5/);
    assert.match(context.skillIntroExample.textContent, /20\/4\/5/);
    handlers[action]();
    assert.equal(startCount, 1);
    assert.equal(context.skillIntroOverlay.style.display, 'none');
  }
});

test('denied practice config surfaces an error instead of bypassing entitlement', async () => {
  let finishCount = 0;
  let configError;
  const context = {
    practiceRun: { kind: 'targeted', sourceLevel: 60 },
    state: { timerActive: true },
    levelRequestGeneration: 0, levelStarting: false, profileMutationPending: false,
    platform: {
      isApp: false, username: '',
      getAuthorizedLevelConfig: async () => { throw Object.assign(new Error('locked'), { statusCode: 403 }); },
      setCurrentLevelConfig() {},
    },
    showLoadingOverlay() {}, hideLoadingOverlay() {}, input: { disable() {} },
    setAnswerInputVisible() {},
    handleLevelConfigError(error) { configError = error; },
    finishStartLevel() { finishCount++; },
  };
  vm.createContext(context);
  vm.runInContext(fn('startLevel'), context);
  await context.startLevel(59);
  assert.equal(configError.statusCode, 403);
  assert.equal(finishCount, 0);
});

test('practice config errors remain visible and do not write pending campaign records', () => {
  let message = '';
  const context = {
    practiceRun: { kind: 'targeted' }, state: { score: 0, difficulty: 'medium', timerMax: 10, maxHearts: 5 },
    t: key => key, savePendingRecord() { throw new Error('must not save campaign state'); },
    platform: { isApp: false }, diffSelect: { style: { display: 'none' } },
    showPracticeStatus(value) { message = value; }, audio: { stopBGM() {} },
    updateHUDLogoutVisibility() {},
    authStatusMessage: element(), authStatusModal: { style: {} },
  };
  vm.createContext(context);
  vm.runInContext(fn('handleLevelConfigError'), context);
  context.handleLevelConfigError({ statusCode: 403 }, 59);
  assert.equal(message, 'practice.startFailed');
  assert.equal(context.practiceRun, null);
  assert.equal(context.authStatusModal.style.display, 'flex');
});

test('Shapes timing and hearts cannot leak into the next elite or recovery practice', async () => {
  for (const kind of ['elite', 'recovery']) {
    const { context } = practiceStartContext('shapes');
    await context.startPracticeSession();
    assert.equal(context.state.timerMax, 25);
    assert.equal(context.state.maxHearts, 9);
    await context.startPracticeSession(kind, 1);
    assert.equal(context.state.timerMax, 10);
    assert.equal(context.state.timerRemaining, 10);
    assert.equal(context.state.maxHearts, 5);
    assert.equal(context.state.hearts, 5);
  }
});

test('answer zone is explicitly hidden on title and result transitions and shown on gameplay startup', () => {
  const zone = { hidden: false };
  const context = { document: { getElementById: () => zone } };
  vm.createContext(context);
  vm.runInContext(fn('setAnswerInputVisible'), context);
  context.setAnswerInputVisible(false);
  assert.equal(zone.hidden, true);
  context.setAnswerInputVisible(true);
  assert.equal(zone.hidden, false);
  for (const name of ['clearPremiumSession', 'returnToTitle', 'triggerLevelClear', 'triggerGameOver', 'startLevel']) {
    assert.match(fn(name), /setAnswerInputVisible\(false\)/);
  }
  assert.match(fn('finishStartLevel'), /setAnswerInputVisible\(true\)/);
});

function correctAnswerContext(kind, { hearts = 5, maxHearts = 5, hp = 1 } = {}) {
  const p = problem('+', 2);
  const fiend = {
    problem: p, isDead: false, isElite: kind === 'elite', fiendClassId: 1, type: 'slimeling',
    wasRequeued: false, x: 100, y: 0, hp, state: 'idle',
    setState(value) { this.state = value; },
    hit() { this.hp--; this.isDead = this.hp <= 0; },
  };
  const played = { correct: 0, heal: 0, fiendHits: [], deaths: [] };
  const session = createPracticeSession({ kind, problems: kind === 'targeted' ? [p] : [] });
  const context = {
    activeFiend: fiend, practiceRun: {
      kind, targetProblems: kind === 'targeted' ? [p] : [], session,
      recovery: createEarnedRecovery(), operations: new Set(),
    },
    attemptSummary: createAttemptSummary(),
    answerClock: { read: () => 1 },
    answerTimes: [], updatePaceAdapter() {},
    state: {
      timerMax: 10, timerRemaining: 9, timerActive: true,
      combo: 0, score: 900, level: 1, hearts, maxHearts,
      isShapesMode: kind === 'shapes', enemiesDefeated: 0,
    },
    GAME_CONFIG: { elitePointMultiplier: 2 },
    getFiendClass: () => ({ scoreValue: 500 }),
    pickComboAbility() { throw new Error('Practice must not charge combo abilities'); },
    isAbilityBandStart,
    HERO_X: 100, LUNGE_MIN_DIST: 100,
    hero: { setState() {} }, heroLunge: null,
    activeLightningBolts: [], activeFireballs: [], activeDragons: [],
    LightningBolt: class {}, Fireball: class {}, DragonSummon: class {},
    input: { disable() {} }, inputDisabled: false,
    scheduleGameplayTimeout(callback, delay) { this.delays.push([callback, delay]); },
    delays: [], hud: { update() {} },
    audio: {
      playCorrect() { played.correct++; }, playHeal() { played.heal++; },
      playSwordSwing() {}, prepareFiend() {},
      playFiendHit(type) { played.fiendHits.push(type); },
      playEnemyDeath(type) { played.deaths.push(type); },
    },
    spawnInterval: 2, shouldPreserveTimerAfterHit: () => true,
    recordPracticeEncounterDefeated: null,
    getCurrentInputMode: () => 'multiple-choice',
    generateProblem: () => problem(),
    platform: { getCurrentLevelConfig: () => ({ level: 1 }) },
    queueProblemActivation: (fiendArg, options) => { context.queued = { fiend: fiendArg, options }; },
  };
  vm.createContext(context);
  vm.runInContext(fn('recordPracticeEncounterDefeated'), context);
  vm.runInContext(fn('shouldPreserveProblemTimer'), context);
  vm.runInContext(fn('handleCorrectAnswer'), context);
  return { context, fiend, played };
}

test('correct replies across all modes are unscored, use one gentle cue, and defeat-count multi-HP once', () => {
  for (const kind of ['targeted', 'short', 'assisted', 'elite', 'recovery', 'shapes']) {
    const { context, played } = correctAnswerContext(kind);
    context.handleCorrectAnswer();
    assert.equal(context.state.score, 900);
    assert.equal(context.state.combo, 0);
    assert.equal(played.correct, 1);
    assert.deepEqual(played.fiendHits, ['slimeling'], 'the fiend type carries its own impact cue');
    assert.deepEqual(played.deaths, ['slimeling'], 'and its own defeat cry');
    assert.equal(context.activeFiend, null);
    if (kind === 'targeted') assert.equal(context.practiceRun.session.snapshot().resolvedProblems, 1);
    if (kind !== 'targeted' && kind !== 'shapes') {
      assert.equal(context.practiceRun.session.snapshot().encountersDefeated, 1);
    }
  }

  const { context, fiend } = correctAnswerContext('elite', { hp: 3 });
  context.handleCorrectAnswer();
  assert.equal(fiend.hp, 2);
  assert.equal(context.activeFiend, null);
  context.heroLunge.onArrive();
  assert.equal(context.queued.options.preserveTimer, false);
  assert.equal(context.practiceRun.session.snapshot().encountersDefeated, 0);
});

test('Endless Shapes accepts more than ten answers, remains unscored and never completes', () => {
  const { context, fiend, played } = correctAnswerContext('shapes');
  context.practiceRun.endless = true;
  vm.runInContext(fn('checkAllDefeated'), context);
  context.spawnQueue = [];
  context.requeuedFiends = [];
  context.fiends = [];
  for (let index = 0; index < 11; index++) {
    fiend.problem = generateShapesProblem(index);
    fiend.hp = 1;
    fiend.isDead = false;
    context.activeFiend = fiend;
    context.handleCorrectAnswer();
    assert.equal(context.checkAllDefeated(), false);
  }
  assert.equal(context.state.score, 900);
  assert.equal(context.state.combo, 0);
  assert.equal(context.state.enemiesDefeated, 11);
  assert.equal(played.correct, 11);
  assert.equal(context.practiceRun.session.snapshot().resolvedProblems, 0);
  assert.equal(context.practiceRun.completed, undefined);
});

test('assisted and targeted practice leave the clock inactive while timed kinds reset it', () => {
  for (const kind of ['targeted', 'short', 'assisted', 'elite', 'recovery', 'shapes']) {
    const fiend = { problem: problem(), x: 200, walkSpeed: 30 };
    const context = {
      pendingProblemActivation: { fiend, preserveTimer: true },
      lastCastAbility: null, practiceRun: { kind },
      getCurrentInputMode: () => 'multiple-choice',
      getFiendWalkSpeed: () => 30,
      getProblemTimerRemaining: timerMax => timerMax,
      state: { timerMax: 10, timerRemaining: 3, timerActive: false },
      activeFiend: null, answerClock: { reset() {} },
      input: { setMCOptions(options) { context.options = options; }, enable(mode) { context.mode = mode; } },
    };
    vm.createContext(context);
    vm.runInContext(fn('activatePendingProblem'), context);
    context.activatePendingProblem();
    assert.equal(context.state.timerActive, !['targeted', 'assisted'].includes(kind));
    assert.equal(context.state.timerRemaining, 10);
    assert.equal(context.mode, 'multiple-choice');
  }
});

test('completed bounded practice sessions cannot spawn an eleventh encounter or shape question', () => {
  const spawn = fn('spawnNextFiend');
  for (const kind of ['short', 'assisted', 'elite', 'recovery']) {
    const session = createPracticeSession({ kind });
    for (let index = 0; index < 10; index++) session.recordEncounterDefeated();
    let spawned = 0;
    const context = {
      state: { isShapesMode: false },
      practiceRun: { kind, session },
      spawnQueue: [], requeuedFiends: [], fiends: [],
      createFiend() { spawned++; return {}; },
    };
    vm.createContext(context);
    vm.runInContext(spawn, context);
    assert.equal(spawned, 0);
    assert.equal(context.fiends.length, 0);
  }
  const shapes = createPracticeSession({ kind: 'shapes' });
  for (let index = 0; index < 10; index++) shapes.recordAnswer({}, true);
  let shapeSpawns = 0;
  const context = {
    state: { isShapesMode: true },
    practiceRun: { kind: 'shapes', session: shapes },
    spawnQueue: [], requeuedFiends: [], fiends: [],
    createShapesFiend() { shapeSpawns++; return {}; },
  };
  vm.createContext(context);
  vm.runInContext(spawn, context);
  assert.equal(shapeSpawns, 0);
});

test('recovery practice heals only after five distinct actual correct replies', () => {
  const { context, played } = correctAnswerContext('recovery', { hearts: 1, maxHearts: 3 });
  for (let index = 0; index < 5; index++) {
    if (index) {
      const next = problem('+', index + 2);
      context.activeFiend = {
        ...context.activeFiend, problem: next, hp: 1, isDead: false,
        hit() { this.isDead = true; }, setState() {},
      };
    }
    context.handleCorrectAnswer();
  }
  assert.equal(context.state.hearts, 2);
  assert.equal(played.heal, 1);
});

test('targeted mistakes wait through correction and retry the same problem; final Shapes correction waits two seconds', () => {
  const mistake = fn('handleWrongAnswer');
  const targetProblem = problem();
  const targetFiend = {
    problem: targetProblem, isElite: false, state: 'walk',
    setState(value) { this.state = value; },
  };
  const targetedTimers = [];
  const targetedSession = createPracticeSession({ kind: 'targeted', problems: [targetProblem] });
  const targeted = {
    activeFiend: targetFiend,
    practiceRun: { kind: 'targeted', session: targetedSession },
    currentLevelIndex: 33, rememberMissedProblem() {},
    attemptSummary: createAttemptSummary(), state: { combo: 1, hearts: 4, maxHearts: 5 },
    hero: { setState() {} }, audio: { playWrong() {}, playTimeout() {} }, hud: { update() {} },
    input: { disable() {} }, inputDisabled: false,
    scheduleGameplayTimeout: callback => targetedTimers.push(callback),
    healTipShown: true, triggerGameOver() {}, requeuedFiends: [],
    t: key => key, console: { error() {} },
  };
  vm.createContext(targeted);
  vm.runInContext(mistake, targeted);
  targeted.handleWrongAnswer();
  targetedTimers.shift()();
  assert.equal(targeted.activeFiend.state, 'reveal');
  targetedTimers.shift()();
  assert.equal(targeted.requeuedFiends[0], targeted.activeFiend);
  assert.equal(targetProblem.answer, 2);
  assert.equal(targetedSession.snapshot().resolvedProblems, 0);

  const shapeSession = createPracticeSession({ kind: 'shapes' });
  for (let index = 0; index < 9; index++) shapeSession.recordAnswer({}, true);
  const shapeProblem = { answer: 4, displayMode: 'shapes' };
  const shapeFiend = { problem: shapeProblem, state: 'walk', setState(value) { this.state = value; } };
  const shapeTimers = [];
  let finished = 0;
  const shapes = {
    activeFiend: shapeFiend,
    practiceRun: { kind: 'shapes', session: shapeSession },
    state: { combo: 0, hearts: 4, maxHearts: 5, isShapesMode: true },
    currentLevelIndex: 0, rememberMissedProblem() {},
    attemptSummary: createAttemptSummary(),
    hero: { setState() {} }, audio: { playWrong() {}, playTimeout() {} }, hud: { update() {} },
    input: { disable() {} }, inputDisabled: false,
    scheduleGameplayTimeout: (callback, delay) => shapeTimers.push({ callback, delay }),
    healTipShown: true, triggerGameOver() {}, requeuedFiends: [], fiends: [shapeFiend],
    finishPracticeSession() { finished++; },
    t: key => key, console: { error() {} },
  };
  vm.createContext(shapes);
  vm.runInContext(mistake, shapes);
  shapes.handleWrongAnswer();
  shapeTimers.shift().callback();
  const correction = shapeTimers.shift();
  assert.equal(correction.delay, 2000);
  correction.callback();
  assert.equal(shapeSession.snapshot().complete, true);
  assert.equal(finished, 1);
});

test('badge persistence retries with the captured owner and stable session receipt', async () => {
  const calls = [];
  let fail = true;
  const retryButton = element();
  const context = {
    platform: {
      isApp: true,
      localProfiles: {
        async recordPractice(input) {
          calls.push(input);
          if (fail) { fail = false; throw new Error('offline'); }
          return { persisted: true, badges: input.badgeIds };
        },
      },
    },
    practiceRun: {
      kind: 'short', sessionId: 'stable-session', completed: true,
      savedBadges: false, badgeSavePending: false, operations: new Set(['+']),
    },
    runProfileId: 'captured-player',
    practiceBadgeRetryButton: retryButton,
    ensurePracticeBadgeRetryButton: () => retryButton,
    getPracticeBadgeIds,
    refreshPracticeBadges: async () => {},
    gameOverScore: element(),
    t: key => key,
    console: { error() {} },
  };
  vm.createContext(context);
  vm.runInContext(fn('savePracticeBadges'), context);
  await context.savePracticeBadges();
  assert.equal(retryButton.hidden, false);
  await context.savePracticeBadges();
  assert.equal(context.practiceRun.savedBadges, true);
  assert.deepEqual(calls.map(call => [call.profileId, call.sessionId]), [
    ['captured-player', 'stable-session'],
    ['captured-player', 'stable-session'],
  ]);
  assert.deepEqual(calls[0].badgeIds, ['practice-addition']);
  assert.deepEqual(calls[1].badgeIds, calls[0].badgeIds);
});

test('practice retry creates a new session and resets all attempt counters', async () => {
  let id = 0;
  let started;
  const { context } = practiceStartContext('short');
  context.createCompletionId = () => `retry-${++id}`;
  context.state.hearts = 0;
  context.state.timerRemaining = 0;
  context.state.score = 99;
  context.practiceRun = {
    kind: 'short', sourceLevel: 34, sessionId: 'old-session',
    session: createPracticeSession({ kind: 'short' }),
  };
  const gameOver = {
    state: context.state,
    practiceRun: context.practiceRun,
    gameOverOverlay: element(), levelClearOverlay: element(), topBar: element(),
    gameOverScore: element(), btnRetryLevel: element(), btnReturnTitle: element(),
    document: { getElementById: () => element() },
    gameplayTimers: [], resetHealHold() {}, input: { disable() {} }, inputDisabled: false,
    setAnswerInputVisible() {},
    audio: { stopBGM() {}, playGameOver() {} }, syncKeepAwake() {},
    platform: { isLoggedIn: false }, t: key => key, campaignWon: false,
    renderAttemptAccomplishment() {}, levelStartScore: 0,
  };
  Object.assign(context, gameOver, {
    startLevel: async index => { started = index; },
    resetLevelAttempt,
  });
  vm.runInContext(`${fn('startPracticeSession')}\n${fn('triggerGameOver')}`, context);
  context.triggerGameOver(false);
  await context.btnRetryLevel.onclick();
  assert.equal(started, 33);
  assert.equal(context.practiceRun.sessionId, 'retry-1');
  assert.equal(context.practiceRun.session.snapshot().encountersDefeated, 0);
  assert.equal(context.state.score, 0);
  assert.equal(context.state.hearts, context.state.maxHearts);
});

test('practice completion cannot enter campaign persistence or online score paths', () => {
  let completed = 0;
  let highScoreWrites = 0;
  const clearContext = {
    setAnswerInputVisible() {},
    practiceRun: { kind: 'short' },
    finishPracticeSession() { completed++; },
  };
  vm.createContext(clearContext);
  vm.runInContext(fn('triggerLevelClear'), clearContext);
  clearContext.triggerLevelClear();
  assert.equal(completed, 1);
  assert.equal(clearContext.completedLevelSave, undefined);

  const run = {
    kind: 'short', completed: true, session: createPracticeSession({ kind: 'short' }),
  };
  const context = {
    state: { isShapesMode: false, score: 9999, level: 10, timerActive: false },
    practiceRun: run, campaignWon: true, gameplayTimers: [],
    setAnswerInputVisible() {},
    completionFeedback: null,
    resetHealHold() {}, input: { disable() {} }, levelClearOverlay: element(), topBar: element(),
    audio: { stopBGM() {}, playCampaignVictory() { throw new Error('practice is not campaign victory'); } },
    syncKeepAwake() {}, document: { getElementById: () => element() },
    platform: { isLoggedIn: true, postHighScore() { highScoreWrites++; } },
    gameOverOverlay: element(), gameOverScore: element(), btnRetryLevel: element(),
    btnReturnTitle: element(), renderAttemptAccomplishment() {}, t: key => key,
  };
  vm.createContext(context);
  vm.runInContext(fn('triggerGameOver'), context);
  context.triggerGameOver(true);
  assert.equal(highScoreWrites, 0);
});

test('returning from practice clears the separate run flag and shape mode', () => {
  const context = {
    practiceRun: { kind: 'shapes' },
    setAnswerInputVisible() {},
    state: { isShapesMode: true },
    pendingSkillIntro: () => {},
    activeSkillIntro: getSkillIntro(5),
    skillIntroOverlay: { style: { display: 'flex' } },
    diffSelect: { style: { display: 'none' } },
    updateHUDLogoutVisibility() {},
    refreshProfileAndLeaderboard() {},
    profileUI: null, refreshPracticeBadges() {},
  };
  vm.createContext(context);
  vm.runInContext(fn('returnToTitle'), context);
  context.returnToTitle();
  assert.equal(context.practiceRun, null);
  assert.equal(context.state.isShapesMode, false);
  assert.equal(context.skillIntroOverlay.style.display, 'none');
  assert.equal(context.diffSelect.style.display, 'flex');
});

test('audio settings apply and persist effects volume while keeping unverified music control disabled', () => {
  const values = new Map([['arithmo-audio-preferences-v1', JSON.stringify({ effects: 0.4, music: 0.2 })]]);
  const applied = [];
  const context = {
    readAudioPreferences, writeAudioPreferences, applyAudioPreferences, applyDeferredMusicVolume,
    deferredMusicVolume: null,
    audio: {
      musicVolumeCapability: { supported: false, status: 'unverified-media-routing' },
      muted: false,
      getEffectsVolume: () => 0.4, getMusicVolume: () => 0.35,
      setEffectsVolume(value) { applied.push(['effects', value]); },
      setMusicVolume(value) { applied.push(['music', value]); },
      setMuted(value) { this.muted = Boolean(value); },
    },
    window: { localStorage: {
      getItem: key => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
    } },
    musicVolumeStatus: { textContent: '' },
    musicVolumeInput: { disabled: false, value: '0.35' },
    effectsVolumeInput: { value: '1' },
    t: key => key,
    console: { error() {} },
  };
  vm.createContext(context);
  vm.runInContext(`${fn('audioPreferenceStatus')}\n${fn('initializeAudioPreferences')}\n${fn('persistAudioPreferences')}`, context);
  context.initializeAudioPreferences();
  assert.deepEqual(applied, [['effects', 0.4]]);
  assert.equal(context.deferredMusicVolume, 0.2, 'music gain waits for a supported route');
  assert.equal(context.musicVolumeInput.disabled, true);
  assert.equal(context.musicVolumeInput.value, '0.35');
  assert.equal(context.musicVolumeStatus.textContent, 'audio.musicVolumeUnavailable');
  context.persistAudioPreferences();
  assert.deepEqual(JSON.parse(values.get('arithmo-audio-preferences-v1')),
    { effects: 0.4, music: 0.35, muted: false });
});
