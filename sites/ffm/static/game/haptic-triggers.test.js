// haptic-triggers.test.js — every impact/heal event fires exactly one haptic,
// a frame without an event fires none, and the plugin-absent no-op path ships.
//
// main.js is a browser module, so each test extracts the seam it needs and runs
// it in a bare VM with a recording `globalThis.ffmHaptics`, mirroring the other
// extracted-function suites.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

import { createHaptics } from './haptics.js';
import { noopVibration, resolveVibrationSource } from './haptics-source.js';
import { applyVibrationPreferences, readVibrationPreferences } from './vibration-preferences.js';
import { setLocale, t } from './i18n.js';

const source = readFileSync(new URL('./main.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

function functionSource(name) {
  const match = source.match(new RegExp(`function ${name}\\([\\s\\S]*?\\n\\}`));
  assert.ok(match, `${name} must exist in main.js`);
  return match[0];
}

function recorder() {
  const calls = [];
  return {
    calls,
    impact() { calls.push('impact'); },
    heal() { calls.push('heal'); },
    levelClear() { calls.push('levelClear'); },
  };
}

function run(fnSource, context) {
  vm.createContext(context);
  vm.runInContext(fnSource, context);
  return context;
}

function count(calls, name) {
  return calls.filter(call => call === name).length;
}

// --- Impact events -------------------------------------------------------

test('a lightning hit vibrates once', () => {
  const haptics = recorder();
  const fiend = { hp: 1, type: 'slimeling', setState() {} };
  const context = run(functionSource('resolveLightningHit'), {
    ffmFx: { fiendCentre: () => null },
    state: { enemiesDefeated: 0 },
    activeFiend: {},
    heroLunge: null,
    HERO_X: 100,
    hero: { setState() {} },
    scheduleGameplayTimeout() {},
    checkAllDefeated: () => false,
    spawnInterval: 2,
    hud: { update() {} },
    audio: { playLightningHit() {}, playEnemyDeath() {} },
    recordPracticeEncounterDefeated() {},
    inputDisabled: false,
    ffmHaptics: haptics,
  });
  context.resolveLightningHit(fiend);
  assert.deepEqual(haptics.calls, ['impact']);
});

test('a fireball hit vibrates once', () => {
  const haptics = recorder();
  const fiend = { isDead: true, type: 'slimeling', hit() {} };
  const context = run(functionSource('resolveFireballHit'), {
    state: { enemiesDefeated: 0 },
    activeFiend: {},
    heroLunge: null,
    HERO_X: 100,
    hero: { setState() {} },
    scheduleGameplayTimeout() {},
    checkAllDefeated: () => false,
    spawnInterval: 2,
    hud: { update() {} },
    audio: { playFireballHit() {}, playEnemyDeath() {} },
    recordPracticeEncounterDefeated() {},
    inputDisabled: false,
    ffmFx: { fiendHurt() {}, fiendCentre: () => null },
    ffmHaptics: haptics,
  });
  context.resolveFireballHit(fiend);
  assert.deepEqual(haptics.calls, ['impact']);
});

function answerEnv({ ability = null, practiceRun = null, hearts = 3, maxHearts = 3 } = {}) {
  const haptics = recorder();
  const sounds = [];
  const fiend = {
    problem: { operation: '+', answer: 2, question: '1 + 1 = ?', options: [2, 3] },
    x: 100, y: 300, hp: 1, isDead: false, isElite: false, wasRequeued: false,
    fiendClassId: 'slimeling', type: 'slimeling',
    hit() { this.hp -= 1; this.isDead = this.hp <= 0; },
    setState(state) { this.state = state; },
  };
  const context = run(functionSource('handleCorrectAnswer'), {
    activeFiend: fiend,
    practiceRun,
    attemptSummary: { recordAnswer() {} },
    answerClock: { read: () => 1 },
    answerTimes: [],
    updatePaceAdapter() {},
    state: {
      timerMax: 10, timerRemaining: 9, timerActive: true, combo: 4, score: 100,
      level: 1, hearts, maxHearts, isShapesMode: false, enemiesDefeated: 0,
    },
    GAME_CONFIG: { elitePointMultiplier: 2, healingAuraDuration: 1 },
    getFiendClass: () => ({ scoreValue: 100 }),
    pickComboAbility: () => ability,
    isAbilityBandStart: () => false,
    HERO_X: 100,
    LUNGE_MIN_DIST: 200,
    GROUND_Y: 380,
    HERO_CENTRE_ABOVE_GROUND: 78,
    hero: { x: 100, setState() {}, cast() {} },
    heroLunge: null,
    activeLightningBolts: [], activeFireballs: [], activeDragons: [],
    LightningBolt: class {}, Fireball: class {}, DragonSummon: class {},
    input: { disable() {}, enable() {} },
    inputDisabled: false,
    scheduleGameplayTimeout() {},
    spawnInterval: 2,
    hud: { update() {} },
    audio: {
      playCorrect() {}, playHeal() { sounds.push('heal'); }, playSwordGain() {},
      playLightningCast() {}, playFireballCast() {}, playDragonRoar() { sounds.push('dragon'); },
      playSwordSwing() { sounds.push('sword'); }, playFiendHit() {}, playEnemyDeath() {},
      playLightningHit() {}, playFireballHit() {},
    },
    ffmScreenFx: { play() {} },
    ffmFx: { fiendHurt() {}, fiendCentre: () => ({ x: 300, y: 300 }) },
    recordPracticeEncounterDefeated() {},
    checkAllDefeated: () => false,
    shouldPreserveProblemTimer: () => false,
    generateProblem: () => fiend.problem,
    platform: { getCurrentLevelConfig: () => ({ level: 1 }) },
    queueProblemActivation() {},
    spellLaunchPoint: () => ({ x: 100, y: 200 }),
    CANVAS_W: 900,
    SPELL_TARGET_Y_OFFSET: 30,
    FIREBALL_FLIGHT_MS: 500,
    ffmHaptics: haptics,
  });
  return { context, fiend, haptics, sounds };
}

test('a dragon finisher vibrates once', () => {
  const { context, haptics, sounds } = answerEnv({ ability: 'dragon' });
  context.handleCorrectAnswer();
  assert.deepEqual(sounds, ['dragon']);
  assert.deepEqual(haptics.calls, ['impact']);
});

test('a plain sword hit vibrates once', () => {
  const { context, haptics, sounds } = answerEnv({ ability: null });
  context.handleCorrectAnswer();
  assert.deepEqual(sounds, ['sword']);
  assert.deepEqual(haptics.calls, ['impact']);
});

test('the wrong-answer hurt path vibrates once for a miss and a timeout', () => {
  for (const timeout of [false, true]) {
    const haptics = recorder();
    const fiend = {
      problem: { question: '2 + 5 = ?', answer: 7 },
      setState(value) { this.state = value; },
    };
    const context = run(functionSource('handleWrongAnswer'), {
      attemptSummary: { recordAnswer() {} },
      activeFiend: fiend,
      state: { combo: 3, hearts: 7, maxHearts: 7 },
      practiceRun: null,
      currentLevelIndex: 1,
      rememberMissedProblem() {},
      hero: { setState() {} },
      audio: { playWrong() {}, playTimeout() {}, playHeroHurt() {} },
      hud: { update() {} },
      input: { disable() {} },
      scheduleGameplayTimeout() {},
      healTipShown: true,
      triggerGameOver() { throw new Error('unexpected defeat'); },
      requeuedFiends: [],
      t: key => key,
      ffmHaptics: haptics,
    });
    context.handleWrongAnswer({ timeout });
    assert.deepEqual(haptics.calls, ['impact'], timeout ? 'timeout' : 'wrong choice');
  }
});

// --- Heal and level-clear events ----------------------------------------

test('the practice-recovery heal vibrates once', () => {
  const practiceRun = {
    kind: 'recovery', endless: false, targetProblems: [],
    session: { recordAnswer() {} },
    recovery: { recordCorrect: () => true },
  };
  const { context, haptics, sounds } = answerEnv({ practiceRun, hearts: 2, maxHearts: 3 });
  context.handleCorrectAnswer();
  assert.equal(context.state.hearts, 3);
  assert.equal(count(sounds, 'heal'), 1);
  assert.equal(count(haptics.calls, 'heal'), 1);
});

function waveClearEnv({ level = 1, hearts = 1, maxHearts = 3 } = {}) {
  const haptics = recorder();
  const sounds = [];
  const context = run(functionSource('triggerWaveClear'), {
    waveClearing: false,
    gameRunning: true,
    syncKeepAwake() {},
    hero: { setState() {}, x: 100 },
    practiceRun: null,
    state: { level, hearts, maxHearts },
    TOTAL_LEVELS: 60,
    audio: {
      playVictoryHymn: () => Promise.resolve(true),
      playLevelClear() {},
      playHeal() { sounds.push('heal'); },
    },
    GAME_CONFIG: { healingAuraDuration: 1 },
    GROUND_Y: 380,
    HERO_CENTRE_ABOVE_GROUND: 78,
    hud: { update() {} },
    scheduleGameplayTimeout() {},
    ffmScreenFx: { play() {} },
    ffmHaptics: haptics,
  });
  return { context, haptics, sounds };
}

test('a wave clear heals once and clears the level once', () => {
  const { context, haptics, sounds } = waveClearEnv({ hearts: 1, maxHearts: 3 });
  context.triggerWaveClear();
  assert.equal(count(sounds, 'heal'), 1);
  assert.equal(count(haptics.calls, 'heal'), 1);
  assert.equal(count(haptics.calls, 'levelClear'), 1);
});

test('the last level clears without a fanfare and still vibrates once', () => {
  const { context, haptics, sounds } = waveClearEnv({ level: 60, hearts: 3, maxHearts: 3 });
  context.triggerWaveClear();
  assert.equal(count(sounds, 'heal'), 0);
  assert.equal(count(haptics.calls, 'heal'), 0);
  assert.equal(count(haptics.calls, 'levelClear'), 1);
});

// The hold-to-heal block lives inside gameLoop; slice it out so the third
// playHeal site can be exercised without stubbing the whole frame.
const HEAL_BLOCK = source.slice(
  source.indexOf('const isMCLevel = getCurrentInputMode()'),
  source.indexOf('fiends.forEach(f => f.update(dt));'),
);

function healBlockEnv({ healed }) {
  const haptics = recorder();
  const sounds = [];
  const context = run(HEAL_BLOCK, {
    dt: 1,
    getCurrentInputMode: () => 'multiple-choice',
    practiceRun: null,
    hero: { state: 'idle', x: 100 },
    healHoldProgress: 0,
    isHealHolding: true,
    updateHealHold: () => ({ progress: 0, healed }),
    emitHealCharge() {},
    GAME_CONFIG: { healHoldSecondsPerHeart: 1 },
    state: { hearts: 1, maxHearts: 3 },
    audio: { playHeal() { sounds.push('heal'); } },
    GROUND_Y: 380,
    HERO_CENTRE_ABOVE_GROUND: 78,
    hud: { update() {} },
    getHealHoldRatio: () => 0,
    ffmHaptics: haptics,
  });
  return { context, haptics, sounds };
}

test('the hold-to-heal heart vibrates once', () => {
  const { haptics, sounds } = healBlockEnv({ healed: true });
  assert.equal(count(sounds, 'heal'), 1);
  assert.equal(count(haptics.calls, 'heal'), 1);
});

test('a frame without a gameplay event vibrates zero times', () => {
  const { haptics } = healBlockEnv({ healed: false });
  assert.deepEqual(haptics.calls, []);
});

test('the render and viewport paths never call haptics', () => {
  const renderSection = source.slice(
    source.indexOf('renderer.clear();'),
    source.indexOf('function handleUrlAuthTokens'),
  );
  assert.ok(renderSection.length > 0);
  assert.doesNotMatch(renderSection, /ffmHaptics/);
  for (const file of ['renderer.js', 'viewport-layout.js']) {
    const text = readFileSync(new URL(`./${file}`, import.meta.url), 'utf8');
    assert.doesNotMatch(text, /haptic/i, `${file} must not vibrate`);
  }
});

test('a locked or rejected ability cast never vibrates', () => {
  for (const name of ['activateAbility', 'playAbilityCastFeedback']) {
    assert.doesNotMatch(functionSource(name), /ffmHaptics/, `${name} must stay silent`);
  }
});

// --- Preference, markup and the plugin-absent no-op ---------------------

test('the vibration checkbox sits with the audio controls and is localized', () => {
  assert.match(
    html,
    /id="effects-volume"[\s\S]*?<label for="haptics-toggle" data-i18n="audio.haptics">Vibration<\/label>[\s\S]*?<input id="haptics-toggle" type="checkbox" checked>/,
  );
  for (const locale of ['en', 'de']) {
    setLocale(locale, { persist: false });
    assert.equal(t('audio.haptics'), 'Vibration', locale);
  }
  setLocale('en', { persist: false });
});

test('the saved preference is applied to the instance and the checkbox immediately', () => {
  const haptics = createHaptics({ vibrate: () => true });
  const hapticsToggle = { checked: true };
  const values = new Map();
  const storage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  values.set('arithmo-haptics-preference-v1', JSON.stringify({ enabled: false }));
  const context = run(functionSource('initializeHapticsPreferences'), {
    applyVibrationPreferences,
    readVibrationPreferences,
    haptics,
    hapticsToggle,
    window: { localStorage: storage },
  });
  context.initializeHapticsPreferences();
  assert.equal(haptics.enabled, false);
  assert.equal(hapticsToggle.checked, false);
});

test('the change listener writes the choice and applies it immediately', () => {
  assert.match(
    source,
    /hapticsToggle\?\.addEventListener\('change', \(\) => \{[\s\S]*?haptics\.setEnabled\(hapticsToggle\.checked\);[\s\S]*?writeVibrationPreferences\(window\.localStorage, haptics\.enabled\);/,
  );
});

test('with the plugin absent the resolved driver is the silent no-op', async () => {
  const resolved = await resolveVibrationSource({
    scope: {},
    importModule: () => Promise.reject(new Error('not bundled')),
  });
  assert.equal(resolved.source, 'none');
  assert.equal(resolved.vibrate, noopVibration);

  let driverCalls = 0;
  const haptics = createHaptics({
    vibrate: pattern => {
      driverCalls++;
      resolved.vibrate(pattern);
    },
  });
  haptics.impact();
  haptics.heal();
  haptics.levelClear();
  assert.equal(driverCalls, 3, 'the facade still routes through one silent driver');
});

test('a disabled preference, reduced motion and no driver vibrate zero times', async () => {
  const resolved = await resolveVibrationSource({
    scope: {},
    importModule: () => Promise.reject(new Error('not bundled')),
  });
  let driverCalls = 0;
  const haptics = createHaptics({
    vibrate: pattern => {
      driverCalls++;
      resolved.vibrate(pattern);
    },
    enabled: false,
    reducedMotion: true,
  });
  haptics.impact();
  haptics.heal();
  haptics.levelClear();
  assert.equal(driverCalls, 0);

  haptics.setEnabled(true);
  haptics.impact();
  assert.equal(driverCalls, 0, 'reduced motion still suppresses');

  haptics.setReducedMotion(false);
  haptics.impact();
  assert.equal(driverCalls, 1, 'only the enabled, motion-safe event reaches the driver');
});
