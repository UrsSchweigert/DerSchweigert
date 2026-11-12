// level-clear-preview.test.js — the next-scene preview on the level-clear
// card. The suite pins the URL resolution and copy at levels 1, 2, 59 and 60
// and the missing-image fallback. It reads only the source, the markup and the
// manifest JSON: no level or stage image file is opened from disk.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

import { LEVEL_ART_MANIFEST, resolveLevelBackground, stageArtUrl } from './level-art.js';
import { _resetForTests, setLocale, t } from './i18n.js';
import { TOTAL_LEVELS } from './levels.js';

const source = readFileSync(new URL('./main.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

const previewSource = source.match(/function renderLevelClearPreview\([\s\S]*?\n\}/)[0];
const clearSource = source.match(/function triggerLevelClear\(\) \{[\s\S]*?\n\}/)[0];
const gameOverSource = source.match(/function triggerGameOver\([\s\S]*?\n\}/)[0];

beforeEach(() => {
  _resetForTests();
  setLocale('en');
});

afterEach(() => {
  _resetForTests();
});

// Minimal element stand-in: records every src assignment so a test can prove
// the finale requests no image at all.
function fakeElement() {
  const style = {};
  const srcSets = [];
  let src = '';
  return {
    style,
    textContent: '',
    alt: '',
    onerror: null,
    srcSets,
    get src() { return src; },
    set src(value) { src = String(value); srcSets.push(src); },
    removeAttribute(name) { if (name === 'src') { src = ''; srcSets.push(''); } },
  };
}

function makeContext({ level = 1, fail = false } = {}) {
  const element = () => fakeElement();
  const previewImage = element();
  const context = {
    state: { level, score: 900, difficulty: 'easy' },
    setAnswerInputVisible() {},
    practiceRun: null,
    spawnQueue: [], requeuedFiends: [],
    levelStartScore: 100, runProfileId: 'player-a',
    completedLevelSave: null, completionPending: false,
    attemptSummary: { snapshot: () => ({}) },
    renderAttemptAccomplishment() {},
    createCompletionId: () => 'completion-1',
    createLevelCompletion: () => async () => true,
    resetLevelAttempt() {},
    TOTAL_LEVELS,
    resolveLevelBackground,
    stageArtUrl,
    LEVEL_ART_MANIFEST,
    t,
    levelClearOverlay: element(), levelClearTitle: element(), levelClearScore: element(),
    levelClearPreview: element(), levelClearPreviewImage: previewImage,
    levelClearPreviewTitle: element(),
    topBar: element(), btnNextLevel: element(), btnReplayLevel: element(),
    btnSaveScoreReturnTitle: element(), diffSelect: element(),
    profileUI: null, audio: { stopBGM() {}, playWinPop() {} },
    updateHUDLogoutVisibility() {},
    async refreshProfileAndLeaderboard() {},
    platform: { isApp: true, isLoggedIn: false },
    triggerGameOver(won) { context.gameOver = won; },
    startLevel(index) { context.nextIndex = index; },
    console: { error() {} },
    ffmScreenFx: { play() {} },
    failures: fail,
  };
  vm.createContext(context);
  vm.runInContext(previewSource, context);
  vm.runInContext(clearSource, context);
  return context;
}

async function clearLevel(level) {
  const context = makeContext({ level });
  await context.triggerLevelClear();
  return context;
}

const imageSrc = (context) => context.levelClearPreviewImage.src;
const previewTitle = (context) => context.levelClearPreviewTitle.textContent;
const previewAlt = (context) => context.levelClearPreviewImage.alt;

test('clearing level 1 previews level 2 with its manifest art and title', async () => {
  const context = await clearLevel(1);
  assert.equal(context.levelClearPreview.style.display, 'flex');
  assert.equal(imageSrc(context), resolveLevelBackground(2, LEVEL_ART_MANIFEST));
  assert.match(imageSrc(context), /\/levels\/level-02\.webp$/);
  assert.equal(previewAlt(context), 'Preview of level 2');
  assert.equal(previewTitle(context), 'Next: Level 2');
});

test('clearing level 2 previews level 3 without touching the renderer copy', async () => {
  const context = await clearLevel(2);
  assert.match(imageSrc(context), /\/levels\/level-03\.webp$/);
  assert.equal(previewAlt(context), 'Preview of level 3');
  assert.equal(previewTitle(context), 'Next: Level 3');
});

test('clearing level 59 previews level 60, the last level image', async () => {
  const context = await clearLevel(59);
  assert.match(imageSrc(context), /\/levels\/level-60\.webp$/);
  assert.equal(previewAlt(context), 'Preview of level 60');
  assert.equal(previewTitle(context), 'Next: Level 60');
});

test('clearing level 60 shows the finale and requests no next-level image', async () => {
  const context = await clearLevel(60);
  assert.equal(context.levelClearPreview.style.display, 'flex');
  assert.equal(previewTitle(context), 'The Finale');
  assert.equal(context.levelClearPreviewImage.style.display, 'none');
  assert.equal(imageSrc(context), '');
  assert.equal(previewAlt(context), '');
  assert.deepEqual(
    context.levelClearPreviewImage.srcSets.filter((value) => value !== ''),
    [],
    'the finale must not request a level-61 image',
  );
});

test('the finale clears a pending error handler from an earlier preview', () => {
  const context = makeContext({ level: 60 });
  context.renderLevelClearPreview(60);
  assert.equal(typeof context.levelClearPreviewImage.onerror, 'function');
  context.renderLevelClearPreview(61);
  assert.equal(context.levelClearPreviewImage.onerror, null, 'a late failure must not request art');
});

test('the preview copy is localized in German', async () => {
  setLocale('de');
  const level = await clearLevel(2);
  assert.equal(previewTitle(level), 'Weiter: Level 3');
  assert.equal(previewAlt(level), 'Vorschau auf Level 3');

  const finale = await clearLevel(60);
  assert.equal(previewTitle(finale), 'Das Finale');
});

test('a missing next-level image falls back to the chapter stage', async () => {
  const context = await clearLevel(2);
  const image = context.levelClearPreviewImage;
  assert.match(image.src, /\/levels\/level-03\.webp$/);

  image.onerror();

  assert.match(image.src, /\/stage-1\.webp$/, 'level 3 lives in chapter I');
  assert.equal(image.onerror, null, 'the fallback runs once and cannot loop');
});

test('levels without a manifest entry resolve straight to the chapter stage', async () => {
  const context = makeContext({ level: 21 });
  context.LEVEL_ART_MANIFEST = { levels: {} };
  context.renderLevelClearPreview(22);
  assert.match(imageSrc(context), /\/stage-3\.webp$/, 'level 22 lives in chapter III');
});

test('the markup carries the preview figure between the summary and the buttons', () => {
  assert.match(html, /<figure id="level-clear-preview" style="display:none">/);
  assert.match(html, /<img id="level-clear-preview-image" alt="">/);
  assert.match(html, /<figcaption id="level-clear-preview-title"><\/figcaption>/);
  const summary = html.indexOf('id="level-attempt-summary"');
  const preview = html.indexOf('id="level-clear-preview"');
  const buttons = html.indexOf('id="btn-next-level"');
  assert.ok(summary < preview && preview < buttons, 'the preview sits above the buttons');
});

test('the preview is re-rendered on locale change and hidden on replay, game over and title return', () => {
  assert.match(source, /renderLevelClearPreview\(state\.level \+ 1\)/);
  assert.match(source, /renderLevelClearPreview\(lastLevelClearNum \+ 1\)/);
  assert.equal(
    (clearSource.match(/levelClearPreview\.style\.display = 'none'/g) ?? []).length,
    2,
    'the replay and return-to-title handlers hide the preview',
  );
  assert.match(gameOverSource, /levelClearPreview\.style\.display = 'none'/);
});
