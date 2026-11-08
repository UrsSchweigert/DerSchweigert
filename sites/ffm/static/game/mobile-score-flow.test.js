import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createCompletionId, createLevelCompletion } from './level-completion.js';
import { resetLevelAttempt } from './campaign-progress.js';

const source = readFileSync(new URL('./main.js', import.meta.url), 'utf8');
const clear = source.match(/function triggerLevelClear\([\s\S]*?\n\}/)[0];
function setup({ level = 1, fail = false } = {}) {
  const element = () => ({ style: {}, disabled: false, textContent: '' });
  const writes = [];
  let failures = fail ? 1 : 0;
  const context = {
    state: { level, score: 900, difficulty: 'easy' },
    setAnswerInputVisible() {},
    practiceRun: null,
    levelStartScore: 100, runProfileId: 'player-a',
    completedLevelSave: null, completionPending: false,
    attemptSummary: { snapshot: () => ({ firstAttemptCorrect: 2, firstAttemptTotal: 3,
      correctAnswers: 3, incorrectAnswers: 1, timeouts: 0, bestStreak: 2 }) },
    renderAttemptAccomplishment() {},
    createCompletionId, createLevelCompletion, resetLevelAttempt, TOTAL_LEVELS: 60,
    platform: { isApp: true, isLoggedIn: false,
      async postLevelScore(...args) {
        if (failures-- > 0) throw new Error('storage unavailable');
        writes.push(args);
      },
      async postHighScore() { throw new Error('Mobile must not use online high scores'); },
    },
    t: (key, vars) => `${key}:${JSON.stringify(vars)}`,
    levelClearOverlay: element(), levelClearTitle: element(), levelClearScore: element(),
    topBar: element(), btnNextLevel: element(), btnReplayLevel: element(),
    btnSaveScoreReturnTitle: element(), diffSelect: element(),
    profileUI: null, audio: { stopBGM() {} },
    updateHUDLogoutVisibility() {},
    async refreshProfileAndLeaderboard() { context.refreshes++; },
    refreshes: 0,
    triggerGameOver(won) { context.gameOver = won; },
    startLevel(index) { context.nextIndex = index; },
    console: { error() {} },
  };
  vm.createContext(context);
  vm.runInContext(clear, context);
  return { context, writes };
}

test('clearing level one saves locally without login and refreshes title on return', async () => {
  const { context, writes } = setup();
  await context.triggerLevelClear();
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0].slice(0, 3), [1, 800, 'easy']);
  assert.equal(writes[0][3].profileId, 'player-a');
  assert.equal(context.btnSaveScoreReturnTitle.style.display, '');
  await context.btnSaveScoreReturnTitle.onclick();
  assert.equal(writes.length, 1);
  assert.equal(context.diffSelect.style.display, 'flex');
  assert.equal(context.refreshes, 2);
});

test('the final level persists before finishing and cannot advance to level 61', async () => {
  const { context, writes } = setup({ level: 60 });
  await context.triggerLevelClear();
  assert.equal(writes[0][0], 60);
  assert.equal(context.gameOver, undefined);
  await context.btnNextLevel.onclick();
  assert.equal(context.gameOver, true);
  assert.equal(context.nextIndex, undefined);
});

test('failed completion remains recoverable; returning retries and never discards it', async () => {
  const { context, writes } = setup({ fail: true });
  await context.triggerLevelClear();
  assert.match(context.levelClearScore.textContent, /saveScoreFailed/);
  assert.equal(writes.length, 0);
  assert.notEqual(context.diffSelect.style.display, 'flex');
  await context.btnSaveScoreReturnTitle.onclick();
  assert.equal(writes.length, 1);
  assert.equal(context.diffSelect.style.display, 'flex');
});

test('replaying resets the run checkpoint but does not double-submit the completed attempt', async () => {
  const { context, writes } = setup();
  await context.triggerLevelClear();
  await context.btnReplayLevel.onclick();
  assert.equal(context.state.score, 100);
  assert.equal(context.nextIndex, 0);
  assert.equal(writes.length, 1);
});
