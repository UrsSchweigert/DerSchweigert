// help-overlay.test.mjs — app-only contextual help controls.
//
// Pins the help contract: staged bilingual copy for every context, the manual
// link in the active language, controls in the play area, pause menu and title
// navigation, and a dialog that pauses live play without touching score or
// timer while restoring the answer and focus. The web build never loads it.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  HELP_CONTEXTS, TITLE_PAGE_CONTEXTS, buildHelpMarkup, createHelpController,
  readAnswerState, resolvePlayContext, restoreAnswerState, titlePageContext,
} from '../game/help-overlay.js';
import { BUNDLE_FILES } from '../scripts/bundle-check.mjs';
import { initGameplayModalFocus } from '../../static/game/modal-focus.js';
import { _resetForTests, getLocale, setLocale, t } from '../../static/game/i18n.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

beforeEach(() => {
  _resetForTests();
  setLocale('en', { persist: false });
});

function markup(context, extra = {}) {
  return buildHelpMarkup({ context, locale: extra.locale ?? 'en', translate: t, ...extra });
}

function fakeView() {
  const view = { markup: '', visible: false, focused: 0, handlers: {}, label: '', buttons: [] };
  view.render = (html, handlers = {}) => { view.markup = html; view.handlers = handlers; };
  view.show = () => { view.visible = true; };
  view.hide = () => { view.visible = false; };
  view.focusClose = () => { view.focused += 1; };
  view.setButtonLabel = (label) => { view.label = label; };
  view.destroy = () => { view.destroyed = true; };
  return view;
}

function fixture({ playing = true, answer = '12', activeRun = playing } = {}) {
  const listeners = {};
  const input = { value: answer, selectionStart: 1, selectionEnd: 1, focusCalls: 0 };
  input.setSelectionRange = (start, end) => { input.selectionStart = start; input.selectionEnd = end; };
  input.focus = () => { input.focusCalls += 1; };
  const trigger = { focused: 0, focus() { this.focused += 1; doc.activeElement = this; } };
  const doc = {
    activeElement: trigger,
    getElementById: (id) => (id === 'answer-input' ? input : null),
    addEventListener(type, fn) { listeners[type] = fn; },
    removeEventListener(type) { delete listeners[type]; },
  };
  const game = { playing, pauseCalls: 0, resumeCalls: 0, score: 120, timer: 7.5, input };
  game.isPlaying = () => game.playing;
  game.hasActiveRun = () => game.activeRun ?? playing;
  game.activeRun = activeRun;
  game.pause = () => { game.pauseCalls += 1; game.playing = false; input.value = ''; };
  game.resume = () => { game.resumeCalls += 1; game.playing = true; };
  const view = fakeView();
  const controller = createHelpController({
    doc, translate: t, getLocale, getGameMode: () => null,
    game, view, registerOverlay: () => () => {},
  });
  return { controller, view, game, input, doc, trigger, listeners };
}

test('every help context has staged English and German copy from the dictionary', () => {
  assert.deepEqual([...HELP_CONTEXTS].sort(),
    ['levels', 'pause', 'play', 'players', 'practice', 'progress', 'ranks', 'terms', 'title'],
    'a new help context must be added to the copy deliberately');
  for (const context of HELP_CONTEXTS) {
    for (const locale of ['en', 'de']) {
      const html = markup(context, { locale, mode: 'shapes' });
      assert.match(html, /class="overlay-card app-help-card"/, `${context}/${locale}`);
      assert.match(html, /data-help-action="close"/);
      assert.match(html, /class="app-help-summary">[^<]{20,}</, `${context}/${locale} has a summary`);
      assert.match(html, /class="app-help-tips">[\s\S]*?<li>/, `${context}/${locale} has tips`);
      assert.doesNotMatch(html, /help\.[a-z]+\.(?:title|summary|tip\d)/, 'no raw i18n keys leak');
      assert.match(html, new RegExp(`href="legal/manual\\.${locale}\\.html"`), 'manual in the active language');
      assert.match(html, /class="app-help-manual-link"/);
    }
  }
});

test('practice help names the running training mode and title pages map to their own help', () => {
  setLocale('de', { persist: false });
  const shapes = buildHelpMarkup({
    context: 'practice', locale: 'de', translate: t, mode: 'shapes',
  });
  assert.match(shapes, /Formen zählen/);
  assert.match(shapes, /Training ist unbewertet/);
  assert.deepEqual(resolvePlayContext('campaign'), { context: 'play', mode: null });
  assert.deepEqual(resolvePlayContext(null), { context: 'play', mode: null });
  assert.deepEqual(resolvePlayContext('elite'), { context: 'practice', mode: 'elite' });
  assert.equal(titlePageContext('family'), 'players');
  assert.equal(titlePageContext('leaderboard'), 'ranks');
  assert.equal(titlePageContext('legal'), 'terms');
  assert.equal(titlePageContext('unknown'), 'title');
  for (const [page, context] of Object.entries(TITLE_PAGE_CONTEXTS)) {
    assert.ok(HELP_CONTEXTS.includes(context), `${page} maps to a real context`);
  }
  assert.throws(() => buildHelpMarkup({ context: 'nope', translate: t }), RangeError);
});

test('help copy is escaped and never links off-device', () => {
  const html = buildHelpMarkup({
    context: 'title', locale: 'en', translate: key => (key === 'help.title.summary' ? '<b>x</b>' : key),
  });
  assert.match(html, /&lt;b&gt;x&lt;\/b&gt;/);
  assert.doesNotMatch(html, /https?:\/\//);
});

test('opening help in live play pauses once and closing restores answer, focus, score and timer', () => {
  const f = fixture();
  const scoreBefore = f.game.score;
  const timerBefore = f.game.timer;
  assert.equal(f.controller.open('play'), true);
  assert.equal(f.game.pauseCalls, 1, 'a running level pauses while help is open');
  assert.equal(f.controller.isOpen(), true);
  assert.equal(f.view.visible, true);
  assert.match(f.view.markup, /Playing a level/);
  assert.equal(f.controller.close(), true);
  assert.equal(f.game.resumeCalls, 1, 'closing help resumes exactly once');
  assert.equal(f.controller.isOpen(), false);
  assert.equal(f.view.visible, false);
  assert.equal(f.input.value, '12', 'the entered answer survives the pause');
  assert.equal(f.input.selectionStart, 1);
  assert.equal(f.trigger.focused, 1, 'focus returns to the control that opened help');
  assert.equal(f.game.score, scoreBefore);
  assert.equal(f.game.timer, timerBefore);
  assert.equal(restoreAnswerState(readAnswerState(f.doc)), true, 'captured state restores idempotently');
  assert.equal(restoreAnswerState(null), false);
  assert.equal(readAnswerState({ getElementById: () => null }), null);
});

test('help opened from the pause menu never resumes the game on close', () => {
  const f = fixture({ playing: false });
  assert.equal(f.controller.open('pause'), true);
  assert.equal(f.game.pauseCalls, 0);
  assert.match(f.view.markup, /frozen while this menu is open/);
  assert.equal(f.controller.close(), true);
  assert.equal(f.game.resumeCalls, 0);
  assert.equal(f.controller.close(), false, 'closing twice is a no-op');
  assert.equal(f.game.resumeCalls, 0);
});

test('the manual link warns that opening it ends the run, in every play context', () => {
  for (const locale of ['en', 'de']) {
    for (const context of ['play', 'practice', 'pause']) {
      const warned = buildHelpMarkup({
        context, locale, translate: t, mode: 'shapes', hasActiveRun: true,
      });
      assert.match(warned, /class="app-help-warning" id="help-manual-warning" role="note"/,
        `${context}/${locale} warns before the manual link`);
      assert.match(warned, /class="app-help-manual-link"[^>]*aria-describedby="help-manual-warning"/,
        `${context}/${locale} ties the warning to the link`);
      assert.match(warned, /href="legal\/manual\.\w+\.html"/, 'the link still works');
      const stale = buildHelpMarkup({ context, locale, translate: t, hasActiveRun: false });
      assert.doesNotMatch(stale, /app-help-warning/, `${context}/${locale} only warns during a run`);
      assert.doesNotMatch(stale, /aria-describedby="help-manual-warning"/);
    }
  }
  // The title screen and the other title tabs have no run to lose.
  for (const context of ['title', 'progress', 'levels', 'players', 'ranks', 'terms']) {
    const html = buildHelpMarkup({ context, locale: 'en', translate: t, hasActiveRun: true });
    assert.doesNotMatch(html, /app-help-warning/, `${context} never warns about the manual`);
  }
  assert.match(buildHelpMarkup({ context: 'pause', locale: 'en', translate: t, hasActiveRun: true }),
    /ends this level/);
  setLocale('de', { persist: false });
  assert.match(buildHelpMarkup({ context: 'pause', locale: 'de', translate: t, hasActiveRun: true }),
    /Fortschritt dieses Durchgangs geht verloren/);
  setLocale('en', { persist: false });
});

test('help opened from the pause menu warns before the full manual', () => {
  const f = fixture({ playing: false, activeRun: true });
  assert.equal(f.controller.open('pause'), true);
  assert.match(f.view.markup, /Opening the full manual ends this level/);
  assert.match(f.view.markup, /aria-describedby="help-manual-warning"/);
  f.game.activeRun = false;
  f.controller.refresh();
  assert.doesNotMatch(f.view.markup, /app-help-warning/, 'a finished run stops warning');
});

test('Escape closes help and a locale switch re-renders the open dialog', () => {
  const f = fixture();
  f.controller.open('title');
  setLocale('de', { persist: false });
  f.controller.refresh();
  assert.match(f.view.markup, /Startbildschirm/);
  assert.match(f.view.markup, /legal\/manual\.de\.html/);
  assert.ok(f.listeners.keydown, 'help listens for Escape');
  f.listeners.keydown({ key: 'Escape', preventDefault() {} });
  assert.equal(f.controller.isOpen(), false);
  assert.equal(f.game.resumeCalls, 1);
});

test('the play-area, pause and title controls ship only through the app overlay', async () => {
  const main = await readFile(join(root, '..', 'static', 'game', 'main.js'), 'utf8');
  assert.doesNotMatch(main, /from '\.\/help-overlay\.js'/, 'no static import on the web build');
  assert.equal((main.match(/import\('\.\/help-overlay\.js'\)/g) ?? []).length, 1);
  const appStart = main.indexOf('if (platform.isApp) {');
  const appBlock = main.slice(appStart, main.indexOf('\n}\n', appStart));
  assert.ok(appBlock.includes("import('./help-overlay.js')"), 'mounted inside the app branch');
  assert.match(appBlock, /game: \{\s*isPlaying: \(\) => gameRunning && !paused,[\s\S]*?hasActiveRun: \(\) => gameRunning,\s*pause: pauseForHelp,\s*resume: resumeFromHelp,/);
  assert.match(appBlock, /registerOverlay: gameplayModalFocus\.registerOverlay/);
  assert.match(main, /function pauseForHelp\(\)/);
  assert.match(main, /function resumeFromHelp\(\)/);
  assert.match(main, /if \(helpOverlay\?\.isOpen\?\.\(\)\) \{\s*helpOverlay\.close\(\);\s*return true;/,
    'Android Back closes help before anything else');
  assert.match(main, /helpOverlay\?\.refresh\(\)/);
  assert.ok(BUNDLE_FILES.includes('game/help-overlay.js'), 'the module ships in the app bundle');
  await assert.rejects(
    stat(join(root, '..', 'static', 'game', 'help-overlay.js')),
    { code: 'ENOENT' },
    'the module must ship only through the app overlay',
  );
});

test('app-only styles keep 44px help targets and the play button out of the timer row', async () => {
  const css = await readFile(join(root, 'game', 'mobile-ui.css'), 'utf8');
  const start = css.indexOf('/* Contextual help, injected by help-overlay.js');
  assert.ok(start > 0, 'help styles live in the app-only stylesheet');
  const block = css.slice(start);
  assert.match(block, /\.app-help-button \{[^}]*min-height: 44px/s);
  assert.match(block, /\.app-help-button \{[^}]*min-width: 44px/s);
  assert.match(block, /#gameplay-chrome \.app-help-button\[data-help-host="play"\] \{ grid-column: 2; grid-row: 1; \}/,
    'the help button shares the question row');
  assert.match(block, /#gameplay-chrome #btn-pause-game \{ grid-column: 3; grid-row: 1; \}/);
  assert.match(block, /\.app-help-overlay \{ z-index: 120; \}/);
  assert.match(block, /\.app-help-card \{[^}]*overflow-y: auto/s);
  assert.doesNotMatch(block, /url\(|https?:\/\//, 'help UI stays offline');
  assert.doesNotMatch(block, /#answer-input/, 'help never restyles the answer field');
});

test('the modal focus manager accepts later overlays such as the help dialog', () => {
  const doc = { addEventListener() {}, removeEventListener() {} };
  class Element {
    constructor(id, parent = null) {
      this.id = id;
      this.parentElement = parent;
      this.children = [];
      this.nodeType = 1;
      this.isConnected = true;
      this.style = { display: 'none', visibility: 'visible' };
      this.attributes = {};
      this.tabIndex = 0;
      parent?.children.push(this);
    }
    setAttribute(name, value) { this.attributes[name] = value; }
    hasAttribute(name) { return name in this.attributes; }
    contains(target) { return target === this || this.children.some(child => child.contains(target)); }
    closest() { return null; }
    querySelector(selector) { return selector === 'h2' ? this.heading : null; }
    querySelectorAll() { return this.actions ?? []; }
    focus() { doc.activeElement = this; }
  }
  const body = doc.body = new Element('body');
  body.style.display = 'block';
  const background = new Element('game-wrap', body);
  background.style.display = 'block';
  const trigger = new Element('trigger', background);
  trigger.style.display = 'block';
  doc.getElementById = () => undefined;
  doc.defaultView = {
    getComputedStyle: el => el.style,
    MutationObserver: class {
      constructor(fn) { this.callback = fn; }
      observe() {}
      disconnect() {}
    },
  };
  trigger.focus();
  const manager = initGameplayModalFocus({ doc });
  const help = new Element('help-overlay', body);
  help.heading = new Element('help-title', help);
  const close = new Element('help-close', help);
  close.style.display = 'block';
  help.actions = [close];
  const unregister = manager.registerOverlay(help);
  assert.equal(help.attributes.role, 'dialog');
  assert.equal(help.attributes['aria-modal'], 'true');
  assert.equal(help.attributes['aria-labelledby'], 'help-title');
  help.style.display = 'flex';
  manager.refresh();
  assert.equal(background.inert, true, 'background is inert while help is open');
  assert.equal(doc.activeElement, close, 'focus moves into the help dialog');
  help.style.display = 'none';
  manager.refresh();
  assert.equal(background.inert, false);
  assert.equal(doc.activeElement, trigger, 'focus returns to the opener');
  unregister();
  assert.equal(manager.unregisterOverlay(help), false, 'unregistering twice is a no-op');
  assert.equal(manager.registerOverlay(null)(), undefined);
});
