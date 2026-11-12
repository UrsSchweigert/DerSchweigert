// Wiring tests for the ability runtime (cooldown-abilities.js) inside the game
// loop (main.js). main.js is a browser module, so the tests pin the loop guard
// and run the extracted run-lifecycle functions against the real pure model.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

import { createAbilityRuntime } from './cooldown-abilities.js';
import { createAbilityBar } from './ability-bar.js';

const source = readFileSync(new URL('./main.js', import.meta.url), 'utf8');

function functionSource(name) {
  const match = source.match(new RegExp(`function ${name}\\([^)]*\\)[\\s\\S]*?\\n\\}`));
  assert.ok(match, `${name} must exist in main.js`);
  return match[0];
}

function finishStartContext() {
  const context = {
    createAbilityRuntime,
    setAnswerInputVisible() {},
    gameplayTimers: [],
    practiceRun: null,
    answerClock: { reset() {} },
    practiceBadgeRetryButton: null,
    createAttemptSummary() { return {}; },
    platform: { isApp: false },
    state: { score: 0 },
    diffSelect: { style: { display: 'flex' } },
    pauseOverlay: { style: {} },
    topBar: { style: {} },
    levelClearOverlay: { style: {} },
    gameOverOverlay: { style: {} },
    resetHealHold() {},
    updateHUDLogoutVisibility() {},
    hud: { update() {} },
    audio: { startLevelBGM() {} },
    flushDeferredMusicVolume() {},
    syncKeepAwake() {},
    animFrameId: 1,
    spawnQueue: [],
    requeuedFiends: [],
    fiends: [],
  };
  vm.createContext(context);
  vm.runInContext(
    [
      'let abilityRuntime = null;',
      functionSource('beginAbilityRun'),
      functionSource('activateAbility'),
      functionSource('finishStartLevel'),
    ].join('\n'),
    context,
  );
  return context;
}

const readRuntime = (context) => vm.runInContext('abilityRuntime', context);

describe('ability runtime lifecycle', () => {
  it('creates the runtime when the first level of a run starts', () => {
    const context = finishStartContext();
    assert.equal(readRuntime(context), null);

    vm.runInContext('finishStartLevel(0, { level: 3, chapter: 1, waveSize: 3 });', context);

    const runtime = readRuntime(context);
    assert.ok(runtime, 'finishStartLevel must create a runtime when none exists');
    assert.equal(runtime.level, 3);
    assert.equal(runtime.isUnlocked('wind'), true);
    assert.equal(runtime.isUnlocked('storm'), false);
  });

  it('re-levels the existing runtime so cooldowns survive a level transition', () => {
    const context = finishStartContext();
    vm.runInContext('finishStartLevel(0, { level: 1, chapter: 1, waveSize: 3 });', context);
    assert.equal(vm.runInContext("activateAbility('wind')", context), true);

    const first = readRuntime(context);
    first.tick(90, { encounterRunning: true });
    assert.equal(first.progress('wind'), 0.5);

    vm.runInContext('finishStartLevel(1, { level: 6, chapter: 1, waveSize: 3 });', context);

    const second = readRuntime(context);
    assert.equal(second, first, 'the same runtime must carry into the next level');
    assert.equal(second.level, 6);
    assert.equal(second.progress('wind'), 0.5, 'remaining cooldown must not reset');
    assert.equal(second.isUnlocked('storm'), true, 'unlocks refresh with the new level');
    assert.equal(vm.runInContext("activateAbility('wind')", context), false, 'a cooling ability is a no-op');
  });

  it('only activates a ready ability and starts its 180 s cooldown', () => {
    const context = finishStartContext();
    vm.runInContext('finishStartLevel(0, { level: 1, chapter: 1, waveSize: 3 });', context);

    assert.equal(vm.runInContext("activateAbility('wind')", context), true);
    const runtime = readRuntime(context);
    assert.equal(runtime.progress('wind'), 0, 'activation restarts the full cooldown');
    assert.equal(vm.runInContext("activateAbility('wind')", context), false);
    assert.equal(vm.runInContext("activateAbility('storm')", context), false, 'locked abilities are a no-op');

    runtime.tick(180, { encounterRunning: true });
    assert.equal(runtime.progress('wind'), 1);
    assert.equal(vm.runInContext("activateAbility('wind')", context), true);
  });

  it('ignores activations before any run has started', () => {
    const context = finishStartContext();
    assert.equal(vm.runInContext("activateAbility('wind')", context), false);
  });
});

describe('game loop wiring', () => {
  it('ticks the runtime with the live-encounter guard', () => {
    const loop = functionSource('gameLoop');
    assert.match(
      loop,
      /abilityRuntime\?\.tick\(dt, \{ encounterRunning: gameRunning && !paused \}\);/,
      'the tick guard must be exactly gameRunning && !paused',
    );
    assert.ok(
      loop.indexOf('abilityRuntime?.tick') > loop.indexOf('advanceGameplayTimers(dt)'),
      'cooldowns tick after the gameplay timers advance',
    );
  });

  it('pushes 0-1 progress into the bar every frame', () => {
    const loop = functionSource('gameLoop');
    assert.match(
      loop,
      /abilityBar\.update\(\{\s*\n\s*level: state\.level,\s*\n\s*progress: abilityRuntime \? \(id\) => abilityRuntime\.progress\(id\) : 1,/,
      'the bar must receive the current level and a progress lookup',
    );
  });
});

describe('run starts', () => {
  it('begins a fresh run from level select, practice, resume and retry', () => {
    assert.ok(
      source.indexOf('beginAbilityRun(targetLevel)') > source.indexOf('const targetIndex = targetLevel - 1;'),
      'level-select campaign start resets the runtime',
    );
    assert.ok(
      source.indexOf('beginAbilityRun(targetLevel)') < source.indexOf('await startLevel(targetIndex, true)'),
      'level-select resets before the level starts',
    );

    const practice = functionSource('startPracticeSession');
    assert.match(practice, /beginAbilityRun\(sourceLevel\);/);
    assert.ok(
      practice.indexOf('beginAbilityRun(sourceLevel)') < practice.indexOf('await startLevel(sourceLevel - 1)'),
      'practice resets before the level starts',
    );

    const resume = functionSource('resumePendingLevel');
    assert.match(resume, /beginAbilityRun\(pending\.levelIndex \+ 1\);/);
    assert.ok(
      resume.indexOf('beginAbilityRun(pending.levelIndex + 1)') < resume.indexOf('startLevel(pending.levelIndex)'),
      'resume resets before the level starts',
    );

    const gameOver = functionSource('triggerGameOver');
    assert.match(gameOver, /beginAbilityRun\(currentLevelIndex \+ 1\);/);
    assert.ok(
      gameOver.indexOf('beginAbilityRun(currentLevelIndex + 1)') < gameOver.indexOf('startLevel(currentLevelIndex)'),
      'retry resets before the level starts',
    );
  });
});

describe('bar updates', () => {
  function trackingElement(tagName) {
    let text = '';
    let textWrites = 0;
    const element = {
      tagName: String(tagName).toUpperCase(),
      id: '',
      className: '',
      type: '',
      title: '',
      disabled: false,
      tabIndex: -1,
      dataset: {},
      children: [],
      parentNode: null,
      style: { setProperty() {} },
      appendChild(child) {
        child.parentNode = element;
        element.children.push(child);
        return child;
      },
      setAttribute() {},
      getAttribute() { return null; },
      removeAttribute() {},
      addEventListener() {},
      removeEventListener() {},
      remove() {},
    };
    Object.defineProperty(element, 'textContent', {
      get() { return text; },
      set(value) { text = String(value); textWrites += 1; },
      enumerable: true,
    });
    Object.defineProperty(element, 'textWrites', { get() { return textWrites; } });
    return element;
  }

  it('rewrites DOM text only when a value changes', () => {
    const chrome = trackingElement('section');
    chrome.id = 'gameplay-chrome';
    const doc = {
      getElementById: (id) => (id === 'gameplay-chrome' ? chrome : null),
      createElement: (tagName) => trackingElement(tagName),
    };
    const textWrites = (node) =>
      (node.textWrites ?? 0) + node.children.reduce((sum, child) => sum + textWrites(child), 0);

    const bar = createAbilityBar({ doc, translate: (key) => key });
    bar.update({ level: 11, progress: 1 });
    const before = textWrites(bar.element);

    bar.update({ level: 11, progress: 1 });
    bar.update({ level: 11, progress: 1 });
    assert.equal(textWrites(bar.element), before, 'unchanged progress must not touch DOM text');

    bar.update({ level: 11, progress: { wind: 0.5, storm: 1, earth: 1 } });
    assert.ok(textWrites(bar.element) > before, 'a cooling slot writes its remaining seconds');
  });
});
