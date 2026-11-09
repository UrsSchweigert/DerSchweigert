// entitlement-panel.test.mjs — the app-only player-section entitlement panel.
//
// Pins the panel contract: bilingual copy, store price reuse, a free-content
// sentence derived from the platform's gating probe, distinct localized
// outcomes for cancel, pending, offline, nothing-to-restore and real errors,
// and a device-wide status that never reads per-player scores.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_PROBE_LIMIT, STRINGS, buildEntitlementMarkup, createDomEntitlementView,
  createEntitlementPanel, entitlementText, freeContentText, outcomeFromResult,
  probeFreeLevels, resolveStatus, statusText,
} from '../game/entitlement-panel.js';
import { PURCHASE_OUTCOMES, RESTORE_OUTCOMES } from '../game/purchase.js';
import { paywallText } from '../game/paywall.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function fakeView() {
  const view = { markup: '', busy: false, handlers: {}, destroyed: false };
  view.render = (markup, handlers = {}) => { view.markup = markup; view.handlers = handlers; };
  view.setBusy = (value) => { view.busy = value; };
  view.destroy = () => { view.destroyed = true; };
  return view;
}

function fakePlatform({ status = { premium_access: false, offline: false }, refreshStatus, freeLevels = 2, totalLevels = 60, failStatus = false } = {}) {
  const platform = {
    statusReads: 0, refreshes: 0,
    async getBillingStatus() {
      platform.statusReads += 1;
      if (failStatus) throw new Error('status read failed');
      return status;
    },
    async refreshEntitlement() { platform.refreshes += 1; return refreshStatus ?? status; },
    async getAuthorizedLevelConfig(index) {
      if (index >= 0 && index < freeLevels && index < totalLevels) return { level: index + 1 };
      const error = new Error(`Level ${index + 1} requires an entitlement`);
      error.code = 'entitlement_required';
      throw error;
    },
  };
  return platform;
}

function fakeStore({ product = { priceString: '4,99 €' }, purchase, restore } = {}) {
  const store = { calls: [] };
  store.queryProduct = async () => ({ product, error: null });
  store.purchase = async (options) => { store.calls.push(['purchase', options]); return purchase; };
  store.restore = async (options) => { store.calls.push(['restore', options]); return restore; };
  return store;
}

async function loadedPanel(options = {}) {
  const view = options.view ?? fakeView();
  const panel = createEntitlementPanel({ gateUi: {}, view, locale: 'en', ...options });
  await panel.load();
  return { panel, view };
}

const escaped = (text) => new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));

test('panel copy is bilingual and never implies a subscription or cross-platform transfer', () => {
  for (const key of Object.keys(STRINGS)) {
    assert.ok(STRINGS[key].en, `${key} needs en`);
    assert.ok(STRINGS[key].de, `${key} needs de`);
  }
  assert.notEqual(entitlementText('entitlement.title', 'en'), entitlementText('entitlement.title', 'de'));
  const english = buildEntitlementMarkup({ locale: 'en', statusKey: 'free', freeCount: 2, totalLevels: 60, price: '4,99 €' });
  const german = buildEntitlementMarkup({ locale: 'de', statusKey: 'free', freeCount: 2, totalLevels: 60, price: '4,99 €' });
  assert.match(english, /Your version/);
  assert.match(english, /Free version\./);
  assert.match(english, /Levels 1–2 are free to play\./);
  assert.match(english, /One purchase unlocks every level/);
  assert.match(english, /every player on this device/);
  assert.match(english, /Buy for 4,99 €/);
  assert.match(english, /Restore purchase/);
  assert.match(german, /Deine Version/);
  assert.match(german, /Kostenlose Version/);
  assert.match(german, /Level 1–2 sind kostenlos spielbar/);
  assert.match(german, /Einmal zahlen/);
  assert.match(german, /Kauf wiederherstellen/);
  for (const text of [english, german]) {
    assert.doesNotMatch(text, /subscription|Abo|Android|iOS|iPhone|Google Play/i);
  }
});

test('the price comes from the store product, never a hard-coded amount', async () => {
  const { view } = await loadedPanel({
    platform: fakePlatform(), purchaseStore: fakeStore({ product: { priceString: '7,25 €' } }), totalLevels: 60,
  });
  assert.match(view.markup, /Buy for 7,25 €/);
  assert.doesNotMatch(view.markup, /4,99/);
  const noPrice = buildEntitlementMarkup({ locale: 'en', price: null });
  assert.match(noPrice, /Buy full unlock/);
  assert.doesNotMatch(noPrice, /\d+[,.]\d{2}/);
});

test('the free-content sentence is derived from the platform gating rule', async () => {
  assert.equal(freeContentText(1, 60, 'en'), 'Level 1 is free to play.');
  assert.equal(freeContentText(2, 60, 'en'), 'Levels 1–2 are free to play.');
  assert.equal(freeContentText(5, 60, 'en'), 'Levels 1–5 are free to play.');
  assert.equal(freeContentText(60, 60, 'en'), 'All 60 levels are available.');
  assert.equal(freeContentText(0, 60, 'en'), 'No level is free to play.');
  assert.equal(freeContentText(1, 60, 'de'), 'Level 1 ist kostenlos spielbar.');
  assert.equal(freeContentText(3, 60, 'de'), 'Level 1–3 sind kostenlos spielbar.');
  assert.equal(await probeFreeLevels(fakePlatform({ freeLevels: 2 }), { max: 60 }), 2);
  assert.equal(await probeFreeLevels(fakePlatform({ freeLevels: 4 }), { max: 60 }), 4);
  assert.equal(await probeFreeLevels(fakePlatform({ freeLevels: 0 }), { max: 60 }), 0);
  assert.equal(await probeFreeLevels({}, { max: 60 }), 0);
  assert.equal(DEFAULT_PROBE_LIMIT, 60);
  const two = await loadedPanel({ platform: fakePlatform({ freeLevels: 2 }), purchaseStore: fakeStore(), totalLevels: 60 });
  const five = await loadedPanel({ platform: fakePlatform({ freeLevels: 5 }), purchaseStore: fakeStore(), totalLevels: 60 });
  assert.match(two.view.markup, /Levels 1–2 are free to play\./);
  assert.match(five.view.markup, /Levels 1–5 are free to play\./);
  assert.equal(two.panel.getFreeCount(), 2);
  assert.equal(five.panel.getFreeCount(), 5);
});

test('free, full, offline and error are distinct panel states', async () => {
  assert.equal(resolveStatus({ premium_access: false }), 'free');
  assert.equal(resolveStatus({ premium_access: true }), 'full');
  assert.equal(resolveStatus({ premium_access: true, offline: true }), 'offline');
  assert.equal(resolveStatus(null), 'error');
  assert.notEqual(statusText('free', 'en'), statusText('full', 'en'));
  assert.notEqual(statusText('free', 'en'), statusText('offline', 'en'));
  assert.notEqual(statusText('offline', 'en'), statusText('error', 'en'));
  const free = await loadedPanel({ platform: fakePlatform({ status: { premium_access: false } }), purchaseStore: fakeStore(), totalLevels: 60 });
  assert.match(free.view.markup, /data-entitlement-status="free"/);
  assert.match(free.view.markup, /data-entitlement-action="buy"/);
  const full = await loadedPanel({ platform: fakePlatform({ status: { premium_access: true } }), purchaseStore: fakeStore(), totalLevels: 60 });
  assert.match(full.view.markup, /data-entitlement-status="full"/);
  assert.match(full.view.markup, /All 60 levels are available\./);
  assert.doesNotMatch(full.view.markup, /data-entitlement-action="buy"/);
  assert.match(full.view.markup, /data-entitlement-action="restore"/);
  const offline = await loadedPanel({ platform: fakePlatform({ status: { premium_access: false, offline: true } }), purchaseStore: fakeStore(), totalLevels: 60 });
  assert.match(offline.view.markup, /data-entitlement-status="offline"/);
  assert.match(offline.view.markup, /Offline: showing the last saved purchase status\./);
  const failed = await loadedPanel({ platform: fakePlatform({ failStatus: true }), purchaseStore: fakeStore(), totalLevels: 60 });
  assert.match(failed.view.markup, /data-entitlement-status="error"/);
  assert.match(failed.view.markup, /The purchase status could not be read\./);
});

test('cancellation, pending, gated and store errors are distinct buy outcomes', async () => {
  const cases = [
    [PURCHASE_OUTCOMES.CANCELLED, 'paywall.cancelled'],
    [PURCHASE_OUTCOMES.PENDING, 'paywall.pending'],
    [PURCHASE_OUTCOMES.GATED, 'paywall.gated'],
    [PURCHASE_OUTCOMES.ERROR, 'paywall.error'],
  ];
  const seen = new Set();
  for (const [outcome, key] of cases) {
    const { panel, view } = await loadedPanel({
      platform: fakePlatform(), purchaseStore: fakeStore({ purchase: { outcome } }), totalLevels: 60,
    });
    await panel.buy();
    assert.equal(panel.getOutcome().key, key);
    assert.match(view.markup, escaped(paywallText(key, 'en')));
    seen.add(view.markup);
  }
  assert.equal(seen.size, cases.length, 'every buy outcome must render differently');
});

test('nothing-to-restore, restore errors and a denied gate are distinct restore outcomes', async () => {
  const cases = [
    [{ outcome: RESTORE_OUTCOMES.RESTORED, entitled: false }, 'paywall.nothingToRestore'],
    [{ outcome: RESTORE_OUTCOMES.ERROR, entitled: false }, 'paywall.restoreError'],
    [{ outcome: RESTORE_OUTCOMES.GATED, entitled: false }, 'paywall.gated'],
  ];
  const seen = new Set();
  for (const [result, key] of cases) {
    const { panel, view } = await loadedPanel({
      platform: fakePlatform(), purchaseStore: fakeStore({ restore: result }), totalLevels: 60,
    });
    await panel.restore();
    assert.equal(panel.getOutcome().key, key);
    assert.match(view.markup, escaped(paywallText(key, 'en')));
    seen.add(view.markup);
  }
  assert.equal(seen.size, cases.length, 'every restore outcome must render differently');
});

test('a successful buy or restore refreshes the status to full and gates through paywall.js', async () => {
  const gateUi = { ask: async () => 42 };
  const buyStore = fakeStore({ purchase: { outcome: PURCHASE_OUTCOMES.SUCCESS } });
  const buy = await loadedPanel({
    platform: fakePlatform({ status: { premium_access: false }, refreshStatus: { premium_access: true, offline: false } }),
    purchaseStore: buyStore, gateUi, totalLevels: 60,
  });
  assert.equal((await buy.panel.buy()).granted, true);
  assert.equal(buy.panel.getStatus().premium_access, true);
  assert.equal(buy.panel.getOutcome().key, 'paywall.success');
  assert.match(buy.view.markup, /data-entitlement-status="full"/);
  assert.equal(buyStore.calls[0][0], 'purchase');
  assert.equal(buyStore.calls[0][1].ui, gateUi, 'the parental gate UI reaches the store');
  assert.equal(buyStore.calls[0][1].locale, 'en');

  const restore = await loadedPanel({
    platform: fakePlatform({ status: { premium_access: false }, refreshStatus: { premium_access: true, offline: false } }),
    purchaseStore: fakeStore({ restore: { outcome: RESTORE_OUTCOMES.RESTORED, entitled: true } }),
    totalLevels: 60,
  });
  assert.equal((await restore.panel.restore()).granted, true);
  assert.equal(restore.panel.getStatus().premium_access, true);
  assert.equal(restore.panel.getOutcome().key, 'paywall.restored');
  assert.match(restore.view.markup, /data-entitlement-status="full"/);
});

test('locale changes re-render without re-reading the store', async () => {
  let locale = 'en';
  const platform = fakePlatform();
  const view = fakeView();
  const { panel } = await loadedPanel({ platform, purchaseStore: fakeStore(), view, totalLevels: 60, getLocale: () => locale });
  const reads = platform.statusReads;
  assert.match(view.markup, /Your version/);
  locale = 'de';
  panel.render();
  assert.match(view.markup, /Deine Version/);
  assert.match(view.markup, /Kauf wiederherstellen/);
  assert.equal(platform.statusReads, reads, 'a locale change must not re-read the store');
});

test('the panel reads device-wide entitlement and never per-player scores', async () => {
  const source = await readFile(join(root, 'game', 'entitlement-panel.js'), 'utf8');
  assert.match(source, /getBillingStatus/);
  assert.match(source, /refreshEntitlement/);
  assert.match(source, /from '\.\/purchase\.js'/);
  assert.match(source, /from '\.\/paywall\.js'/);
  assert.match(source, /from '\.\/parental-gate\.js'/);
  assert.doesNotMatch(source, /localProfiles|local-profile|scoreHistory|bestScores/i);
  const platform = fakePlatform();
  const { panel } = await loadedPanel({ platform, purchaseStore: fakeStore(), totalLevels: 60 });
  assert.equal(platform.statusReads, 1);
  assert.equal(panel.getStatus().premium_access, false);
});

test('main.js mounts the panel only behind platform.isApp and the web UI stays intact', async () => {
  const main = await readFile(join(root, '..', 'static', 'game', 'main.js'), 'utf8');
  assert.doesNotMatch(main, /^import\s[^\n]*entitlement-panel/m, 'no static import on the web build');
  assert.match(main, /if \(platform\.isApp\)[\s\S]*import\('\.\/entitlement-panel\.js'\)/);
  assert.match(main, /entitlementPanel\?\.render\(\)/);
  assert.match(main, /entitlementPanel\?\.refresh\(\)/);
  const index = await readFile(join(root, '..', 'static', 'index.html'), 'utf8');
  assert.match(index, /<div id="profile-root"><\/div>\s*<div id="entitlement-root"><\/div>/);
  assert.match(index, /id="account-modal"/, 'the web account UI is untouched');
});

test('the default view renders into the root and binds both actions', () => {
  const listeners = {};
  const buttons = [];
  const fakeRoot = {
    ownerDocument: {}, innerHTML: '',
    querySelector(selector) {
      const action = selector.match(/data-entitlement-action="(\w+)"/)?.[1];
      if (!action) return null;
      const button = { action, addEventListener: (type, handler) => { listeners[action] = handler; } };
      buttons.push(button);
      return button;
    },
    querySelectorAll() { return buttons; },
    replaceChildren() { fakeRoot.innerHTML = ''; },
  };
  const view = createDomEntitlementView({ root: fakeRoot });
  view.render('<button data-entitlement-action="buy"></button><button data-entitlement-action="restore"></button>', { buy: () => {}, restore: () => {} });
  assert.equal(typeof listeners.buy, 'function');
  assert.equal(typeof listeners.restore, 'function');
  view.setBusy(true);
  assert.ok(buttons.every((button) => button.disabled === true));
  view.destroy();
  assert.equal(fakeRoot.innerHTML, '');
});

test('outcome mapping covers every purchase and restore result', () => {
  assert.equal(outcomeFromResult({ granted: true }, 'buy').key, 'paywall.success');
  assert.equal(outcomeFromResult({ granted: true }, 'restore').key, 'paywall.restored');
  assert.equal(outcomeFromResult({ outcome: PURCHASE_OUTCOMES.ALREADY_OWNED, granted: false }, 'buy').key, 'paywall.error');
  assert.equal(outcomeFromResult({ outcome: RESTORE_OUTCOMES.RESTORED, entitled: false }, 'restore').key, 'paywall.nothingToRestore');
  assert.equal(outcomeFromResult({ outcome: RESTORE_OUTCOMES.ERROR, entitled: false }, 'restore').key, 'paywall.restoreError');
  assert.equal(outcomeFromResult(null, 'restore').key, 'paywall.restoreError');
});
