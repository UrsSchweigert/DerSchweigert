// pack-sheet.test.mjs — hero pack sheet: markup, gate, outcomes and grant rule.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HERO_PACK_ID, PURCHASE_OUTCOMES, RESTORE_OUTCOMES } from '../game/purchase.js';
import { PACK_STRINGS, buildPackSheetMarkup, createPackSheet, packText } from '../game/pack-sheet.js';

function fakeDoc() {
  const listeners = new Set();
  return {
    listeners,
    addEventListener(type, fn) { if (type === 'keydown') listeners.add(fn); },
    removeEventListener(type, fn) { if (type === 'keydown') listeners.delete(fn); },
    press(key) { for (const fn of [...listeners]) fn({ key }); },
  };
}

function fakeView() {
  const view = {
    markup: null, statuses: [], closed: 0, focused: 0, handlers: null,
    render(markup, handlers) {
      view.markup = markup;
      view.handlers = handlers;
      return { querySelector: () => ({ focus() { view.focused++; } }) };
    },
    setStatus(text, options = {}) { view.statuses.push({ text, ...options }); },
    setBusy() {},
    close() { view.closed++; },
  };
  return view;
}

function fakePlatform(status) {
  const platform = { refreshes: 0, async refreshEntitlement() { platform.refreshes++; return status; } };
  return platform;
}

function fakeStore({ purchase, restore, product = { priceString: '1,99 €' } } = {}) {
  const store = {
    calls: [],
    async queryProduct(id) { store.calls.push(['query', id]); return { product, error: null }; },
    async purchase(options) { store.calls.push(['purchase', options]); return purchase; },
    async restore(options) { store.calls.push(['restore', options]); return restore; },
  };
  return store;
}

function make(overrides = {}) {
  const ctx = {
    view: fakeView(), doc: fakeDoc(), granted: 0, closedCb: 0,
    platform: fakePlatform({ hero_pack: true }),
    store: fakeStore({ purchase: { outcome: PURCHASE_OUTCOMES.SUCCESS } }),
    opener: { focused: 0, focus() { this.focused++; } },
    ...overrides,
  };
  ctx.sheet = createPackSheet({
    platform: ctx.platform, purchaseStore: ctx.store, gateUi: {}, view: ctx.view, doc: ctx.doc,
    opener: ctx.opener, locale: 'en',
    onGranted: () => { ctx.granted++; }, onClose: () => { ctx.closedCb++; },
  });
  return ctx;
}

test('strings exist in both locales with matching keys', () => {
  for (const key of Object.keys(PACK_STRINGS)) {
    assert.ok(PACK_STRINGS[key].en, `${key} en`);
    assert.ok(PACK_STRINGS[key].de, `${key} de`);
    assert.deepEqual(Object.keys(PACK_STRINGS[key]).sort(), ['de', 'en']);
  }
  assert.notEqual(packText('pack.title', 'en'), packText('pack.title', 'de'));
});

test('markup is an accessible dialog with a status region and named actions', () => {
  const html = buildPackSheetMarkup({ locale: 'en', price: '1,99 €' });
  assert.match(html, /role="dialog"/);
  assert.match(html, /aria-modal="true"/);
  assert.match(html, /aria-labelledby="pack-sheet-title"/);
  assert.match(html, /id="pack-sheet-title"/);
  assert.match(html, /role="status"/);
  for (const action of ['buy', 'restore', 'close']) assert.match(html, new RegExp(`data-pack-action="${action}"`));
  assert.match(html, /Buy for 1,99 €/);
  assert.match(buildPackSheetMarkup({ locale: 'de', price: 'x' }), /Heldenpaket/);
  assert.match(buildPackSheetMarkup({ locale: 'en' }), /Buy hero pack/);
  assert.doesNotMatch(buildPackSheetMarkup({ locale: 'en' }), /Buy for/);
});

test('construction opens nothing; open queries the pack price and focuses', async () => {
  const ctx = make();
  assert.equal(ctx.view.markup, null);
  await ctx.sheet.open();
  assert.deepEqual(ctx.store.calls[0], ['query', HERO_PACK_ID]);
  assert.match(ctx.view.markup, /Buy for 1,99 €/);
  assert.equal(ctx.view.focused, 1);
});

test('no price keeps Buy usable', async () => {
  const ctx = make({ store: fakeStore({ product: null }) });
  await ctx.sheet.open();
  assert.match(ctx.view.markup, /data-pack-action="buy"[^>]*>Buy hero pack/);
});

test('Escape and Close close the sheet and return focus to the opener', async () => {
  const ctx = make();
  await ctx.sheet.open();
  ctx.doc.press('Escape');
  assert.equal(ctx.view.closed, 1);
  assert.equal(ctx.opener.focused, 1);
  assert.equal(ctx.doc.listeners.size, 0);
  await ctx.sheet.open();
  ctx.view.handlers.close();
  assert.equal(ctx.opener.focused, 2);
  assert.equal(ctx.closedCb, 2);
});

test('buy passes the pack id and the gate UI; success grants on hero_pack', async () => {
  const ctx = make();
  await ctx.sheet.open();
  const result = await ctx.sheet.buy();
  assert.equal(result.granted, true);
  assert.equal(ctx.store.calls.at(-1)[1].productId, HERO_PACK_ID);
  assert.equal(ctx.platform.refreshes, 1);
  assert.equal(ctx.granted, 1);
  assert.equal(ctx.view.closed, 1);
});

test('the full unlock alone never grants heroes', async () => {
  const ctx = make({ platform: fakePlatform({ premium_access: true, hero_pack: false }) });
  const result = await ctx.sheet.buy();
  assert.equal(result.granted, false);
  assert.equal(ctx.granted, 0);
  assert.equal(ctx.view.statuses.at(-1).text, packText('pack.error', 'en'));
});

test('non-success outcomes show their line and never refresh', async () => {
  const lines = {
    [PURCHASE_OUTCOMES.PENDING]: 'pack.pending',
    [PURCHASE_OUTCOMES.CANCELLED]: 'pack.cancelled',
    [PURCHASE_OUTCOMES.GATED]: 'pack.gated',
    [PURCHASE_OUTCOMES.ERROR]: 'pack.error',
  };
  for (const [outcome, key] of Object.entries(lines)) {
    const ctx = make({ store: fakeStore({ purchase: { outcome } }) });
    const result = await ctx.sheet.buy();
    assert.equal(result.granted, false, outcome);
    assert.equal(ctx.platform.refreshes, 0);
    assert.equal(ctx.view.statuses.at(-1).text, packText(key, 'en'));
  }
});

test('restore grants only when the pack is owned and hero_pack is true', async () => {
  const owned = { outcome: RESTORE_OUTCOMES.RESTORED, entitled: false, ownedProducts: [HERO_PACK_ID] };
  const ctx = make({ store: fakeStore({ restore: owned }) });
  assert.equal((await ctx.sheet.restore()).granted, true);
  assert.equal(ctx.granted, 1);
  assert.equal(ctx.view.statuses.at(-1).text, packText('pack.restored', 'en'));
});

test('restore with only the full unlock reports nothing to restore', async () => {
  const only = {
    outcome: RESTORE_OUTCOMES.RESTORED, entitled: true, ownedProducts: ['arithmoslayer_full_unlock'],
  };
  const ctx = make({
    store: fakeStore({ restore: only }),
    platform: fakePlatform({ premium_access: true, hero_pack: false }),
  });
  const result = await ctx.sheet.restore();
  assert.equal(result.granted, false);
  assert.equal(ctx.platform.refreshes, 0);
  assert.equal(ctx.granted, 0);
  assert.equal(ctx.view.statuses.at(-1).text, packText('pack.nothingToRestore', 'en'));
});

test('restore gated and error outcomes grant nothing', async () => {
  for (const [outcome, key] of [[RESTORE_OUTCOMES.GATED, 'pack.gated'], [RESTORE_OUTCOMES.ERROR, 'pack.restoreError']]) {
    const ctx = make({ store: fakeStore({ restore: { outcome, entitled: false } }) });
    assert.equal((await ctx.sheet.restore()).granted, false);
    assert.equal(ctx.view.statuses.at(-1).text, packText(key, 'en'));
    assert.equal(ctx.platform.refreshes, 0);
  }
});

test('stylesheet keeps 44 px targets and the module needs a platform', async () => {
  const { readFileSync } = await import('node:fs');
  const css = readFileSync(new URL('../game/mobile-ui.css', import.meta.url), 'utf8');
  assert.match(css, /\.pack-sheet-card button\s*\{[^}]*min-height: 44px/);
  assert.throws(() => createPackSheet({}), TypeError);
});
