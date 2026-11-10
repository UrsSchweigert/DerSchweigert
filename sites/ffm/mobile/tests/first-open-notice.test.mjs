// first-open-notice.test.mjs — the app-only first-open thank-you notice.
//
// Pins the notice contract: short bilingual copy from the i18n dictionary
// (thanks, purpose, a plea to try, the one-time unlock), a free-level range
// derived from the real gating probe, a device-wide acknowledgement that
// survives profile switches and restarts, a storage failure that still shows
// the notice with a working continue action, and a dismiss that cannot
// re-open the dialog from the same activation.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  NOTICE_KEY, NOTICE_SCHEMA_VERSION, REOPEN_GUARD_MS, buildNoticeMarkup,
  createFirstOpenNotice, createNoticeStore,
} from '../game/first-open-notice.js';
import { freeContentText } from '../game/entitlement-panel.js';
import { PROGRESS_KEYS } from '../game/progress-store.js';
import { PRACTICE_KINDS } from '../../static/game/practice-session.js';
import { _resetForTests, setLocale, t } from '../../static/game/i18n.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

beforeEach(() => {
  _resetForTests();
  setLocale('en', { persist: false });
});

function createBackend(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    isAvailable: () => true,
    async get(key) { return data.get(key) ?? null; },
    async set(key, value) { data.set(key, value); },
  };
}

function failingBackend() {
  return {
    isAvailable: () => true,
    async get() { throw new Error('storage read failed'); },
    async set() { throw new Error('storage write failed'); },
  };
}

function fakePlatform({ freeLevels = 2, totalLevels = 60 } = {}) {
  const platform = { calls: 0 };
  platform.getAuthorizedLevelConfig = async (index) => {
    platform.calls += 1;
    if (index >= 0 && index < freeLevels && index < totalLevels) return { level: index + 1 };
    const error = new Error(`Level ${index + 1} requires an entitlement`);
    error.code = 'entitlement_required';
    throw error;
  };
  return platform;
}

function fakeView() {
  const view = { markup: '', visible: false, focused: false, handlers: {} };
  view.render = (markup, handlers = {}) => { view.markup = markup; view.handlers = handlers; };
  view.show = () => { view.visible = true; };
  view.hide = () => { view.visible = false; };
  view.focusContinue = () => { view.focused = true; };
  return view;
}

function notice({ platform = fakePlatform(), backend = createBackend(), view = fakeView(), ...rest } = {}) {
  const controller = createFirstOpenNotice({
    platform,
    translate: t,
    getLocale: () => 'en',
    totalLevels: 60,
    practiceKinds: PRACTICE_KINDS,
    backend,
    view,
    ...rest,
  });
  return { controller, view };
}

test('notice copy is short, kind and never implies a subscription or a purchase', () => {
  setLocale('en', { persist: false });
  const english = buildNoticeMarkup({
    locale: 'en', translate: t, freeCount: 2, totalLevels: 60, practiceKinds: PRACTICE_KINDS,
  });
  setLocale('de', { persist: false });
  const german = buildNoticeMarkup({
    locale: 'de', translate: t, freeCount: 2, totalLevels: 60, practiceKinds: PRACTICE_KINDS,
  });

  assert.match(english, /Thank you!/);
  assert.match(english, /Thank you for trying Arithmo Slayer\./);
  assert.match(english, /Mental arithmetic as brain training – at your own pace\./);
  assert.match(english, /Just give it a try/);
  assert.match(english, /Levels 1–2 are free to play\./);
  assert.match(english, /unlocks levels 3–60 – no subscription, no recurring charges/);
  assert.match(english, /Continue/);
  assert.match(german, /Danke!/);
  assert.match(german, /Danke, dass du Arithmo Slayer ausprobierst\./);
  assert.match(german, /Kopfrechnen als Gehirntraining – im eigenen Tempo\./);
  assert.match(german, /Probier es einfach aus/);
  assert.match(german, /Level 1–2 sind kostenlos spielbar\./);
  assert.match(german, /Level 3–60 frei – ohne Abo, ohne laufende Kosten/);
  assert.match(german, /Weiter/);

  for (const text of [english, german]) {
    assert.doesNotMatch(text, /monthly|Android|iOS|iPhone|Google Play/i);
    assert.match(text, /data-notice-action="continue"/);
    assert.doesNotMatch(text, /data-notice-action="(?:buy|restore)"/);
    assert.doesNotMatch(text, /\d+[,.]\d{2}\s*(?:€|\$)/, 'the notice never shows a price');
  }

  // It is a brain exercise, not a game: the notice never says "game"/"Spiel".
  assert.doesNotMatch(english, /\bgame\b/i);
  assert.doesNotMatch(german, /\bSpiel\b/i);

  // Four short paragraphs and the action: the screen stays readable at a glance.
  const paragraphs = (english.match(/<p /g) ?? []).length;
  assert.ok(paragraphs <= 4, `the notice must stay short, found ${paragraphs} paragraphs`);
});

test('the free-level range and the unlock come from the real gating', async () => {
  assert.deepEqual([...PRACTICE_KINDS].sort(),
    ['assisted', 'elite', 'recovery', 'shapes', 'short', 'targeted'],
    'a new practice mode still decides whether the plea to try mentions practice');

  const two = notice({ platform: fakePlatform({ freeLevels: 2 }) });
  assert.equal(await two.controller.maybeShow(), true);
  assert.match(two.view.markup, new RegExp(freeContentText(2, 60, 'en')));
  assert.match(two.view.markup, /levels 3–60/);
  assert.equal(two.controller.getFreeCount(), 2);

  const five = notice({ platform: fakePlatform({ freeLevels: 5 }) });
  await five.controller.maybeShow();
  assert.match(five.view.markup, new RegExp(freeContentText(5, 60, 'en')));
  assert.match(five.view.markup, /levels 6–60/,
    'the unlock range starts right after the last free level');
  assert.equal(five.controller.getFreeCount(), 5);

  // A fully unlocked device has no range to explain.
  const all = notice({ platform: fakePlatform({ freeLevels: 60 }) });
  await all.controller.maybeShow();
  assert.match(all.view.markup, new RegExp(freeContentText(60, 60, 'en')));
  assert.doesNotMatch(all.view.markup, /levels 61|notice-unlock">[^<]*One purchase/);

  // A probe that fails never scares the player with "no level is free".
  const unknown = buildNoticeMarkup({ locale: 'en', translate: t, freeCount: 0, totalLevels: 60 });
  assert.doesNotMatch(unknown, /No level is free to play\./);
  assert.match(unknown, /unlocks the remaining levels/);

  const noModes = buildNoticeMarkup({ locale: 'en', translate: t, freeCount: 2, totalLevels: 60 });
  assert.doesNotMatch(noModes, /class="notice-try"/);
});

test('the acknowledgement is device-wide and survives restarts and profile switches', async () => {
  const backend = createBackend();
  const first = notice({ backend });
  assert.equal(await first.controller.maybeShow(), true);
  assert.equal(first.view.visible, true);
  assert.equal(await first.controller.dismiss(), true);
  assert.equal(first.view.visible, false);
  assert.equal(JSON.parse(backend.data.get(NOTICE_KEY)).version, NOTICE_SCHEMA_VERSION);

  const store = createNoticeStore(backend);
  assert.equal(await store.isAcknowledged(), true);

  // A fresh controller over the same device store (an app restart, another
  // player profile) never shows the notice again.
  const restarted = notice({ backend });
  assert.equal(await restarted.controller.maybeShow(), false);
  assert.equal(restarted.view.visible, false);

  // The acknowledgement is not one of the per-player progress documents.
  assert.ok(!Object.values(PROGRESS_KEYS).includes(NOTICE_KEY));
  const source = await readFile(join(root, 'game', 'first-open-notice.js'), 'utf8');
  assert.doesNotMatch(source, /localProfiles|local-profile|scoreHistory|bestScores|profileId/i);
  assert.match(source, /from '\.\/entitlement-panel\.js'/);
  assert.match(source, /from '\.\/parental-gate\.js'/);
  assert.match(source, /from '\.\/progress-store\.js'/);
});

test('a fresh install shows the notice', async () => {
  const { controller, view } = notice({ backend: createBackend() });
  assert.equal(await controller.maybeShow(), true);
  assert.equal(view.visible, true);
  assert.equal(view.focused, true);
  assert.match(view.markup, /first-open-notice-title/);
});

test('a storage failure still shows the notice with a working continue action', async () => {
  const { controller, view } = notice({ backend: failingBackend() });
  assert.equal(await controller.maybeShow(), true);
  assert.equal(view.visible, true);
  assert.equal(await controller.dismiss(), false, 'the failed write is reported');
  assert.equal(view.visible, false, 'continue still closes the notice');
  assert.equal(await createNoticeStore(failingBackend()).isAcknowledged(), false);
});

test('the notice is reopenable after it was acknowledged', async () => {
  const backend = createBackend();
  let clock = 1000;
  const { controller, view } = notice({ backend, now: () => clock });
  await controller.maybeShow();
  await controller.dismiss();
  assert.equal(controller.isOpen(), false);
  // The dismiss cool-down is over: a deliberate reopen works.
  clock += REOPEN_GUARD_MS;
  assert.equal(await controller.open(), true);
  assert.equal(controller.isOpen(), true);
  assert.equal(view.visible, true);
  assert.match(view.markup, /Thank you!/);
});

test('the activation that dismisses the notice cannot open it again', async () => {
  const backend = createBackend();
  let clock = 5000;
  const { controller, view } = notice({ backend, now: () => clock });
  await controller.maybeShow();
  assert.equal(await controller.dismiss(), true);

  // Same tap, ghost click or an overlapping reopen button: ignored.
  assert.equal(await controller.open(), false);
  assert.equal(controller.isOpen(), false);
  assert.equal(view.visible, false);

  // Still on screen: a second activation never re-renders the dialog.
  clock += REOPEN_GUARD_MS;
  await controller.open();
  const markup = view.markup;
  view.markup = '';
  assert.equal(await controller.open(), false);
  assert.equal(view.markup, '');
  assert.equal(view.visible, true);
  assert.ok(markup.includes('first-open-notice-title'));
});

test('Escape closes the notice so a full-screen dialog always has a way out', async () => {
  const listeners = new Map();
  const doc = {
    addEventListener: (type, handler) => listeners.set(type, handler),
    removeEventListener: (type) => listeners.delete(type),
  };
  const { controller, view } = notice({ backend: createBackend(), doc });
  await controller.open();
  assert.equal(controller.isOpen(), true);
  listeners.get('keydown')?.({ key: 'Escape' });
  assert.equal(controller.isOpen(), false);
  assert.equal(view.visible, false);
  controller.destroy();
  assert.equal(listeners.has('keydown'), false);
});

test('a corrupt acknowledgement document reads as not acknowledged', async () => {
  const backend = createBackend({ [NOTICE_KEY]: '{not json' });
  assert.equal(await createNoticeStore(backend).isAcknowledged(), false);
  const wrongVersion = createBackend({
    [NOTICE_KEY]: JSON.stringify({ version: 99, acknowledged: true }),
  });
  assert.equal(await createNoticeStore(wrongVersion).isAcknowledged(), false);
  const { controller, view } = notice({ backend: createBackend({ [NOTICE_KEY]: '{not json' }) });
  assert.equal(await controller.maybeShow(), true);
  assert.equal(view.visible, true);
});

test('main.js, index.html and the modal focus helper wire the notice app-only', async () => {
  const main = await readFile(join(root, '..', 'static', 'game', 'main.js'), 'utf8');
  assert.doesNotMatch(main, /from '\.\/first-open-notice\.js'/, 'no static import on the web build');
  assert.equal((main.match(/import\('\.\/first-open-notice\.js'\)/g) ?? []).length, 1);
  assert.match(main, /createFirstOpenNotice\(\{[\s\S]*?practiceKinds: PRACTICE_KINDS/);
  assert.match(main, /totalLevels: TOTAL_LEVELS/);
  assert.match(main, /firstOpenNotice\?\.render\(\)/);
  assert.match(main, /'first-open-notice-help', 'btn-notice-help'/);
  assert.match(main, /\.then\(\(\) => introAtOpen\)[\s\S]*?\.then\(\(\) => firstOpenNotice\?\.maybeShow\(\)\)/,
    'the notice waits for the story intro so the two never overlap');

  const index = await readFile(join(root, '..', 'static', 'index.html'), 'utf8');
  assert.match(index, /<div id="first-open-notice" class="overlay" style="display:none"><\/div>/);
  assert.match(index, /id="first-open-notice-help"[^>]*data-i18n="notice.reopen"[^>]*hidden/);
  assert.match(index, /id="btn-notice-help"[^>]*data-i18n="notice.reopen"[^>]*hidden/);

  const modal = await readFile(join(root, '..', 'static', 'game', 'modal-focus.js'), 'utf8');
  assert.match(modal, /'first-open-notice'/);

  await assert.rejects(
    stat(join(root, '..', 'static', 'game', 'first-open-notice.js')),
    { code: 'ENOENT' },
    'the module must ship only through the app overlay',
  );
});
