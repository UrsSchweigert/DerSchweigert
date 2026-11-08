import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createAttemptSummary } from './attempt-summary.js';

const source = readFileSync(new URL('./main.js', import.meta.url), 'utf8');

test('actual mistake flow distinguishes timeout from wrong choice and tracks repeated retrieval', () => {
  const wrong = source.match(/function handleWrongAnswer\([\s\S]*?\n\}/)[0];
  for (const timeout of [false, true]) {
    const attemptSummary = createAttemptSummary();
    const problem = { question: '2 + 5 = ?', answer: 7 };
    const fiend = { problem, setState(value) { this.state = value; } };
    const timers = [];
    const context = {
      attemptSummary, activeFiend: fiend, state: { combo: 3, hearts: 7, maxHearts: 7 },
      practiceRun: null, currentLevelIndex: 1, rememberMissedProblem() {},
      hero: { setState() {} }, audio: { playWrong() {}, playTimeout() {} }, hud: { update() {} },
      input: { disable() {} }, scheduleGameplayTimeout: (fn) => timers.push(fn),
      healTipShown: true, triggerGameOver() { throw new Error('unexpected defeat'); },
      requeuedFiends: [], t: key => key,
    };
    vm.createContext(context);
    vm.runInContext(wrong, context);
    context.handleWrongAnswer({ timeout });
    assert.equal(fiend._answerFeedback, timeout ? 'timeout' : 'incorrect');
    assert.equal(context.state.hearts, 6);
    timers.shift()();
    assert.equal(fiend.state, 'reveal');
    assert.equal(fiend._revealText, '2 + 5 = 7');
    attemptSummary.recordAnswer(problem, true);
    const result = attemptSummary.snapshot();
    assert.equal(result.firstAttemptTotal, 1);
    assert.equal(result.firstAttemptCorrect, 0);
    assert.equal(result.correctAnswers, 1);
    assert.equal(result.timeouts, timeout ? 1 : 0);
  }
});

test('actual timeout call supplies the timeout reason', () => {
  const timer = source.match(/function updateTimer\([\s\S]*?\n\}/)[0];
  let reason;
  const context = { state: { timerActive: true, timerRemaining: 0.1 },
    handleWrongAnswer: options => { reason = options.timeout; } };
  vm.createContext(context);
  vm.runInContext(timer, context);
  context.updateTimer(0.2);
  assert.equal(reason, true);
});

test('clear accomplishments compare only supplied own history and do not invent mastery', () => {
  const render = source.match(/function renderAttemptAccomplishment\([\s\S]*?\n\}/)[0];
  const attemptSummary = createAttemptSummary();
  for (let i = 0; i < 4; i++) attemptSummary.recordAnswer({}, true);
  attemptSummary.recordAnswer({}, false);
  const element = { hidden: true, textContent: '' };
  const context = {
    state: { isShapesMode: false }, practiceRun: null, attemptSummary, completionFeedback: null,
    document: { getElementById: () => element },
    t: (key, args) => `${key}:${JSON.stringify(args)}`,
  };
  vm.createContext(context);
  vm.runInContext(render, context);
  context.renderAttemptAccomplishment('level-attempt-summary', {
    saved: true,
    previousAttemptSummary: { firstAttemptCorrect: 2, firstAttemptTotal: 5, bestStreak: 2 },
  });
  assert.match(element.textContent, /attempt.firstReplies/);
  assert.match(element.textContent, /attempt.accuracyImproved/);
  assert.doesNotMatch(element.textContent, /mastery/i);
  context.renderAttemptAccomplishment('level-attempt-summary', null);
  assert.match(element.textContent, /attempt.replayGoal/);
  context.state.isShapesMode = true;
  context.renderAttemptAccomplishment('level-attempt-summary');
  assert.equal(element.hidden, true);
  assert.equal(element.textContent, '');
});

test('perfect first replies get a reachable maintenance goal rather than an impossible extra answer', () => {
  const render = source.match(/function renderAttemptAccomplishment\([\s\S]*?\n\}/)[0];
  const attemptSummary = createAttemptSummary();
  attemptSummary.recordAnswer({}, true);
  const element = {};
  const context = { attemptSummary, state: {}, practiceRun: null, completionFeedback: null,
    document: { getElementById: () => element }, t: key => key };
  vm.createContext(context);
  vm.runInContext(render, context);
  context.renderAttemptAccomplishment('level-attempt-summary');
  assert.match(element.textContent, /attempt.keepAccuracy/);
});
