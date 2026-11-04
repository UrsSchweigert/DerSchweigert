// restore.test.mjs — fresh-install restore through the real adapter and cache.
//
// The Linux checker cannot reach StoreKit or Google Play, so the Capacitor
// scope is a fake installed before the platform adapter is imported. The
// plugin, purchase store, entitlement cache and paywall are the real modules:
// a restore that repopulates getPurchases must write premium_access into the
// Preferences cache and open the levels the paywall locked, while a
// nothing-to-restore result, a store error and a denied parental gate must
// leave the cache and the levels untouched.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RESTORE_OUTCOMES, PRODUCT_ID, createPurchaseStore, createPurchasesPlugin } from '../game/purchase.js';
import { buildPaywallMarkup, createPaywall, paywallText } from '../game/paywall.js';

// Map-backed Preferences and a NativePurchases fake whose restorePurchases
// repopulates the owned transaction list, like a fresh install signed in to
// the same store account.
const preferences = new Map();
const fake = {
  purchases: [],
  restorable: [],
  restoreError: null,
  restoreCalls: 0,
};

function owned(overrides = {}) {
  return {
    transactionId: 'tx-restored',
    purchaseToken: 'token-restored',
    productIdentifier: PRODUCT_ID,
    purchaseState: '1',
    isAcknowledged: true,
    ...overrides,
  };
}

globalThis.Capacitor = {
  Plugins: {
    Preferences: {
      async get({ key }) { return { value: preferences.get(key) ?? null }; },
      async set({ key, value }) { preferences.set(key, value); },
    },
    NativePurchases: {
      async getProduct() {
        return { product: { identifier: PRODUCT_ID, priceString: '4,99 €' } };
      },
      async purchaseProduct() { return owned(); },
      async getPurchases() { return { purchases: fake.purchases }; },
      async restorePurchases() {
        fake.restoreCalls += 1;
        if (fake.restoreError) throw fake.restoreError;
        fake.purchases = [...fake.restorable];
      },
      async acknowledgePurchase() {},
    },
  },
};

const { default: platform } = await import('../game/platform-adapter.js');
const { ENTITLEMENT_KEY } = await import('../game/entitlement.js');

function reset() {
  preferences.clear();
  fake.purchases = [];
  fake.restorable = [];
  fake.restoreError = null;
  fake.restoreCalls = 0;
}

const passingUi = {
  ask: async ({ challenge }) => challenge.a * challenge.b,
};
const denyingUi = { ask: async () => 1 };

const store = () => createPurchaseStore({ plugin: createPurchasesPlugin() });

const locked = (error) => error.code === 'entitlement_required' && error.statusCode === 402;
const unlocked = (error) => error.code !== 'entitlement_required' && error.statusCode !== 402;

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

test('a fresh install restores the purchase, caches the entitlement and opens level 3', async () => {
  reset();
  fake.restorable = [owned()];

  await assert.rejects(platform.getAuthorizedLevelConfig(2), locked);
  assert.equal((await platform.getBillingStatus()).premium_access, false);

  const result = await store().restore({ ui: passingUi, locale: 'en' });

  assert.equal(result.outcome, RESTORE_OUTCOMES.RESTORED);
  assert.equal(result.entitled, true);
  assert.equal(result.transaction.productIdentifier, PRODUCT_ID);
  assert.equal(fake.restoreCalls, 1);
  // Restoring is a store read; only the platform refresh writes the cache.
  assert.equal(preferences.has(ENTITLEMENT_KEY), false);

  const status = await platform.refreshEntitlement();
  assert.equal(status.premium_access, true);
  assert.equal(status.source, 'store');
  const cached = JSON.parse(preferences.get(ENTITLEMENT_KEY));
  assert.equal(cached.entitled, true);
  assert.equal(cached.transaction_id, 'tx-restored');

  await assert.rejects(platform.getAuthorizedLevelConfig(2), unlocked);
});

test('nothing to restore leaves the cache unset and level 3 locked', async () => {
  reset();

  const result = await store().restore({ ui: passingUi, locale: 'de' });

  assert.deepEqual(result, { outcome: RESTORE_OUTCOMES.RESTORED, entitled: false });
  assert.equal(preferences.has(ENTITLEMENT_KEY), false);

  const status = await platform.refreshEntitlement();
  assert.equal(status.premium_access, false);
  assert.equal(status.offline, false);
  assert.equal(JSON.parse(preferences.get(ENTITLEMENT_KEY)).entitled, false);
  await assert.rejects(platform.getAuthorizedLevelConfig(2), locked);
});

test('a store error during restore is reported and grants nothing', async () => {
  reset();
  fake.restoreError = new Error('Restore failed');

  const result = await store().restore({ ui: passingUi, locale: 'en' });

  assert.equal(result.outcome, RESTORE_OUTCOMES.ERROR);
  assert.equal(result.entitled, false);
  assert.equal(result.error, 'Restore failed');
  assert.equal(preferences.has(ENTITLEMENT_KEY), false);
  await assert.rejects(platform.getAuthorizedLevelConfig(2), locked);
});

test('a denied parental gate blocks restore before the store is called', async () => {
  reset();
  fake.restorable = [owned()];

  const result = await store().restore({ ui: denyingUi, locale: 'en' });

  assert.deepEqual(result, { outcome: RESTORE_OUTCOMES.GATED, entitled: false });
  assert.equal(fake.restoreCalls, 0);
  assert.equal(preferences.has(ENTITLEMENT_KEY), false);
  await assert.rejects(platform.getAuthorizedLevelConfig(2), locked);
});

test('the paywall renders a bilingual, gated restore action', () => {
  const english = buildPaywallMarkup({ locale: 'en', price: '4,99 €' });
  const german = buildPaywallMarkup({ locale: 'de', price: '4,99 €' });

  assert.match(english, /data-paywall-action="restore"/);
  assert.match(german, /data-paywall-action="restore"/);
  assert.match(english, /Restore purchase/);
  assert.match(german, /Kauf wiederherstellen/);
  assert.match(english, /role="dialog"/);
  assert.match(english, /aria-modal="true"/);
  assert.equal(paywallText('paywall.restore', 'en'), 'Restore purchase');
  assert.equal(paywallText('paywall.restore', 'de'), 'Kauf wiederherstellen');
});

test('the paywall restore refreshes the entitlement and resumes the level', async () => {
  reset();
  fake.restorable = [owned()];
  const view = fakeView();
  const granted = [];
  const paywall = createPaywall({
    platform,
    purchaseStore: store(),
    gateUi: passingUi,
    view,
    locale: 'en',
    onGranted: () => granted.push('resume'),
  });

  const result = await paywall.restore();

  assert.equal(result.outcome, RESTORE_OUTCOMES.RESTORED);
  assert.equal(result.granted, true);
  assert.deepEqual(granted, ['resume']);
  assert.equal(view.closed, true);
  assert.equal(view.statuses.at(-1).text, paywallText('paywall.restored', 'en'));
  assert.equal(preferences.has(ENTITLEMENT_KEY), true);
  await assert.rejects(platform.getAuthorizedLevelConfig(2), unlocked);
});

test('the paywall reports nothing-to-restore and restore errors without granting', async () => {
  for (const [setup, key] of [
    [() => {}, 'paywall.nothingToRestore'],
    [() => { fake.restoreError = new Error('Restore failed'); }, 'paywall.restoreError'],
  ]) {
    reset();
    setup();
    let refreshes = 0;
    const countingPlatform = {
      ...platform,
      async refreshEntitlement() { refreshes += 1; return platform.refreshEntitlement(); },
    };
    const view = fakeView();
    const paywall = createPaywall({
      platform: countingPlatform,
      purchaseStore: store(),
      gateUi: passingUi,
      view,
      locale: 'de',
    });

    const result = await paywall.restore();

    assert.equal(result.granted, false, key);
    assert.equal(refreshes, 0, `${key} must not refresh`);
    assert.equal(view.closed, false);
    assert.equal(view.statuses.at(-1).text, paywallText(key, 'de'));
    assert.equal(preferences.has(ENTITLEMENT_KEY), false);
  }
});
