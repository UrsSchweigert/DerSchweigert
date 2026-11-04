// paywall.test.mjs — bilingual paywall copy and the purchase/restore flow.
//
// The purchase store, parental gate UI, view and platform are fakes: these
// tests pin that the paywall shows both languages, renders store-gated buy and
// restore actions, never grants without a refreshed entitlement, and reports
// cancel, pending, gated and restore-without-purchase as non-grants.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PURCHASE_OUTCOMES, RESTORE_OUTCOMES } from '../game/purchase.js';
import {
  STRINGS,
  buildPaywallMarkup,
  createPaywall,
  paywallText,
  priceLabel,
} from '../game/paywall.js';

function fakeView() {
  const view = {
    markup: null,
    statuses: [],
    closed: false,
    render(markup) { view.markup = markup; },
    setStatus(text, options = {}) { view.statuses.push({ text, ...options }); },
    setBusy() {},
    close() { view.closed = true; },
  };
  return view;
}

function fakePlatform(status) {
  const platform = { refreshes: 0, async refreshEntitlement() { platform.refreshes++; return status; } };
  return platform;
}

function fakeStore(purchase, restore) {
  const store = {
    calls: [],
    async queryProduct() { return { product: { priceString: '4,99 €' }, error: null }; },
    async purchase(options) { store.calls.push(['purchase', options]); return purchase; },
    async restore(options) { store.calls.push(['restore', options]); return restore; },
  };
  return store;
}

test('paywall copy and markup are bilingual', () => {
  for (const key of Object.keys(STRINGS)) {
    assert.ok(STRINGS[key].en, `${key} needs en`);
    assert.ok(STRINGS[key].de, `${key} needs de`);
  }
  assert.notEqual(paywallText('paywall.title', 'en'), paywallText('paywall.title', 'de'));

  const english = buildPaywallMarkup({ locale: 'en', price: '4,99 €' });
  const german = buildPaywallMarkup({ locale: 'de', price: '4,99 €' });
  assert.match(english, /Unlock levels 3-60/);
  assert.match(english, /Buy for 4,99 €/);
  assert.match(english, /Restore purchase/);
  assert.match(german, /Level 3–60 freischalten/);
  assert.match(german, /Kauf wiederherstellen/);
  assert.match(english, /aria-modal="true"/);
  assert.match(english, /aria-live="polite"/);

  const noPrice = buildPaywallMarkup({ locale: 'en' });
  assert.match(noPrice, /Buy full unlock/);
  assert.equal(priceLabel({ priceString: '4,99 €' }), '4,99 €');
  assert.equal(priceLabel(null), null);
});

test('a successful purchase refreshes the entitlement and resumes the level', async () => {
  const view = fakeView();
  const platform = fakePlatform({ premium_access: true });
  const gateUi = { ask: async () => 42 };
  const store = fakeStore({ outcome: PURCHASE_OUTCOMES.SUCCESS });
  const granted = [];
  const paywall = createPaywall({
    platform, purchaseStore: store, gateUi, view, locale: 'en',
    onGranted: () => granted.push('resumed'),
  });

  const result = await paywall.buy();
  assert.equal(result.granted, true);
  assert.equal(platform.refreshes, 1);
  assert.deepEqual(granted, ['resumed']);
  assert.equal(view.closed, true);
  assert.equal(view.statuses.at(-1).text, paywallText('paywall.success', 'en'));
  assert.equal(store.calls[0][0], 'purchase');
  assert.equal(store.calls[0][1].ui, gateUi, 'the parental gate UI reaches the store');
});

test('already-owned grants without a second store charge', async () => {
  const platform = fakePlatform({ premium_access: true });
  const store = fakeStore({ outcome: PURCHASE_OUTCOMES.ALREADY_OWNED });
  const paywall = createPaywall({ platform, purchaseStore: store, gateUi: {}, view: fakeView() });
  assert.equal((await paywall.buy()).granted, true);
});

test('cancel, pending and gated outcomes never grant', async () => {
  for (const outcome of [PURCHASE_OUTCOMES.CANCELLED, PURCHASE_OUTCOMES.PENDING, PURCHASE_OUTCOMES.GATED]) {
    const platform = fakePlatform({ premium_access: true });
    const view = fakeView();
    const paywall = createPaywall({
      platform, purchaseStore: fakeStore({ outcome }), gateUi: {}, view,
    });
    const result = await paywall.buy();
    assert.equal(result.granted, false, outcome);
    assert.equal(platform.refreshes, 0, `${outcome} must not refresh`);
    assert.equal(view.closed, false);
  }
});

test('a purchase the store did not record stays locked', async () => {
  const platform = fakePlatform({ premium_access: false });
  const store = fakeStore({ outcome: PURCHASE_OUTCOMES.SUCCESS });
  const paywall = createPaywall({ platform, purchaseStore: store, gateUi: {}, view: fakeView() });
  const result = await paywall.buy();
  assert.equal(result.granted, false);
  assert.equal(platform.refreshes, 1);
});

test('restore grants only when the store returns an owned purchase', async () => {
  const granted = [];
  const okPlatform = fakePlatform({ premium_access: true });
  const ok = createPaywall({
    platform: okPlatform,
    purchaseStore: fakeStore(null, { outcome: RESTORE_OUTCOMES.RESTORED, entitled: true }),
    gateUi: {},
    view: fakeView(),
    onGranted: () => granted.push('resumed'),
  });
  assert.equal((await ok.restore()).granted, true);
  assert.deepEqual(granted, ['resumed']);

  for (const result of [
    { outcome: RESTORE_OUTCOMES.RESTORED, entitled: false },
    { outcome: RESTORE_OUTCOMES.GATED, entitled: false },
    { outcome: RESTORE_OUTCOMES.ERROR, entitled: false },
  ]) {
    const platform = fakePlatform({ premium_access: true });
    const paywall = createPaywall({
      platform, purchaseStore: fakeStore(null, result), gateUi: {}, view: fakeView(),
    });
    assert.equal((await paywall.restore()).granted, false, result.outcome);
    assert.equal(platform.refreshes, 0);
  }
});

test('open renders the store price instead of a hard-coded amount', async () => {
  const view = fakeView();
  const paywall = createPaywall({ platform: fakePlatform({}), purchaseStore: fakeStore(null, null), view });
  await paywall.open();
  assert.match(view.markup, /Buy for 4,99 €/);
});
