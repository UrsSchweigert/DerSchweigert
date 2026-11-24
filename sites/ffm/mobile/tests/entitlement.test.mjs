// entitlement.test.mjs — cached store entitlement and premium level gating.
//
// The store cannot run in the Linux checker, so getPurchases is a fake that
// returns canned transactions and the backend is a Map-backed Preferences
// stand-in. The tests pin the cache contract: a purchase grants, a refund
// revokes, an offline launch keeps the cache, and levels 7-60 stay locked
// behind the 402-equivalent error until the cache says otherwise.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ENTITLEMENT_KEY, ENTITLEMENT_SCHEMA_VERSION, createEntitlementStore } from '../game/entitlement.js';
import { PRODUCT_ID } from '../game/purchase.js';

// The app adapter resolves the Capacitor bridge lazily, so installing this
// fake before the first call exercises the real Preferences + NativePurchases
// wiring. The bundle's generated level-data.js is absent here, so an entitled
// premium level reports 404 rather than a config.
const preferences = new Map();
const fakeStore = { items: [] };
globalThis.Capacitor = {
  Plugins: {
    Preferences: {
      async get({ key }) { return { value: preferences.get(key) ?? null }; },
      async set({ key, value }) { preferences.set(key, value); },
    },
    NativePurchases: {
      async getPurchases() { return { purchases: fakeStore.items }; },
    },
  },
};
const { default: platform } = await import('../game/platform-adapter.js');

function createBackend(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    isAvailable: () => true,
    async get(key) { return data.get(key) ?? null; },
    async set(key, value) { data.set(key, value); },
  };
}

function owned(overrides = {}) {
  return {
    transactionId: 'tx-1',
    purchaseToken: 'token-1',
    productIdentifier: PRODUCT_ID,
    purchaseState: '1',
    isAcknowledged: true,
    ...overrides,
  };
}

test('an owned purchase round-trips through the cache', async () => {
  const backend = createBackend();
  const purchases = { items: [owned()] };
  const store = createEntitlementStore({ backend, getPurchases: async () => purchases.items });

  assert.equal((await store.getStatus()).premium_access, false);
  const refreshed = await store.refresh();
  assert.equal(refreshed.premium_access, true);
  assert.equal(refreshed.source, 'store');
  assert.equal(refreshed.transaction_id, 'tx-1');

  // A fresh store over the same backend sees the cached grant without a store.
  const reopened = createEntitlementStore({ backend, getPurchases: async () => [] });
  const cached = await reopened.getStatus();
  assert.equal(cached.premium_access, true);
  assert.equal(cached.source, 'cache');
  assert.equal(cached.transaction_id, 'tx-1');
  assert.equal(JSON.parse(backend.data.get(ENTITLEMENT_KEY)).version, ENTITLEMENT_SCHEMA_VERSION);
});

test('a refund or revoked transaction clears the cached grant', async () => {
  const backend = createBackend();
  const purchases = { items: [owned()] };
  const store = createEntitlementStore({ backend, getPurchases: async () => purchases.items });
  await store.refresh();

  purchases.items = [owned({ revocationDate: '2026-01-01T00:00:00.000Z' })];
  const revoked = await store.refresh();
  assert.equal(revoked.premium_access, false);
  assert.equal(revoked.reason, 'revoked');
  assert.equal(await store.read(), null);

  purchases.items = [];
  const empty = await store.refresh();
  assert.equal(empty.premium_access, false);
  assert.equal(await store.read(), null);
});

test('offline refresh keeps the cache instead of revoking it', async () => {
  const backend = createBackend();
  let fail = false;
  const store = createEntitlementStore({
    backend,
    getPurchases: async () => {
      if (fail) throw new Error('offline');
      return [owned()];
    },
  });
  await store.refresh();
  fail = true;

  const offline = await store.refresh();
  assert.equal(offline.premium_access, true);
  assert.equal(offline.offline, true);
  assert.equal((await store.getStatus()).premium_access, true);
});

test('levels 1-6 are free and 7-60 return the 402 paywall error until entitled', async () => {
  fakeStore.items = [];
  await platform.refreshEntitlement();
  assert.equal((await platform.getAuthorizedLevelConfig(0)).level, 1);
  assert.equal((await platform.getAuthorizedLevelConfig(1)).level, 2);
  // Levels 3-6 are free too; only the generated bundle carries their config, so a test run
  // without it answers 404 (never the paywall).
  for (const index of [2, 5]) {
    await assert.rejects(
      platform.getAuthorizedLevelConfig(index),
      (error) => error.statusCode === 404 && error.code !== 'entitlement_required',
    );
  }
  await assert.rejects(
    platform.getAuthorizedLevelConfig(6),
    (error) => error.code === 'entitlement_required' && error.statusCode === 402,
  );
  assert.equal((await platform.getBillingStatus()).premium_access, false);

  fakeStore.items = [owned()];
  const status = await platform.refreshEntitlement();
  assert.equal(status.premium_access, true);
  assert.equal((await platform.getBillingStatus()).premium_access, true);
  // The gate is open; only the generated bundle carries the level config.
  await assert.rejects(
    platform.getAuthorizedLevelConfig(6),
    (error) => error.statusCode === 404 && error.code !== 'entitlement_required',
  );
});

const LITERAL_DOC = '{"version":1,"entitled":true,"product_id":"arithmoslayer_full_unlock",'
  + '"transaction_id":"tx-old","checked_at":"2026-01-01T00:00:00.000Z","reason":"store_purchase"}';

test('a literal current-format document reads as the same status', async () => {
  const backend = createBackend({ [ENTITLEMENT_KEY]: LITERAL_DOC });
  const status = await createEntitlementStore({ backend }).getStatus();
  assert.deepEqual(status, {
    premium_access: true,
    entitled: true,
    reason: 'store_purchase',
    source: 'cache',
    checked_at: '2026-01-01T00:00:00.000Z',
    product_id: PRODUCT_ID,
    transaction_id: 'tx-old',
  });
});

test('a failed read keeps the cache untouched and reports them offline', async () => {
  const backend = createBackend({ [ENTITLEMENT_KEY]: LITERAL_DOC });
  const before = new Map(backend.data);
  const failing = createEntitlementStore({
    backend, getPurchases: async () => { throw new Error('offline'); },
  });
  const status = await failing.refresh();
  assert.equal(status.offline, true);
  assert.equal(status.premium_access, true);
  assert.deepEqual(backend.data, before);
});

test('a store read that no longer lists the unlock revokes it', async () => {
  const backend = createBackend({ [ENTITLEMENT_KEY]: LITERAL_DOC });
  const status = await createEntitlementStore({ backend, getPurchases: async () => [] }).refresh();
  assert.equal(status.premium_access, false);
  const doc = JSON.parse(backend.data.get(ENTITLEMENT_KEY));
  assert.equal(doc.entitled, false);
  assert.equal(doc.reason, 'revoked');
});

// Offline, the store can answer with an empty list instead of failing. That
// used to read as a refund and locked paying players out in airplane mode.
test('an empty store answer keeps a recently confirmed grant', async () => {
  const backend = createBackend();
  const purchases = { items: [owned()] };
  let clock = Date.parse('2026-11-01T00:00:00.000Z');
  const store = createEntitlementStore({
    backend, getPurchases: async () => purchases.items, now: () => new Date(clock).toISOString(),
  });
  await store.refresh();

  purchases.items = [];
  clock += 3 * 24 * 60 * 60 * 1000;
  const status = await store.refresh();
  assert.equal(status.premium_access, true);
  assert.equal(status.offline, true);
  assert.equal(JSON.parse(backend.data.get(ENTITLEMENT_KEY)).entitled, true);
  // The confirmation date is not refreshed by an answer that did not confirm.
  assert.equal(JSON.parse(backend.data.get(ENTITLEMENT_KEY)).checked_at, '2026-11-01T00:00:00.000Z');
});

test('an empty store answer revokes once the grant has gone unconfirmed past the grace period', async () => {
  const backend = createBackend();
  const purchases = { items: [owned()] };
  let clock = Date.parse('2026-11-01T00:00:00.000Z');
  const store = createEntitlementStore({
    backend, getPurchases: async () => purchases.items, now: () => new Date(clock).toISOString(),
  });
  await store.refresh();

  purchases.items = [];
  clock += 31 * 24 * 60 * 60 * 1000;
  const status = await store.refresh();
  assert.equal(status.premium_access, false);
  assert.equal(status.reason, 'revoked');
});

test('an explicit refund revokes at once, even inside the grace period', async () => {
  const backend = createBackend();
  const purchases = { items: [owned()] };
  const store = createEntitlementStore({ backend, getPurchases: async () => purchases.items });
  await store.refresh();

  purchases.items = [owned({ revocationDate: '2026-01-01T00:00:00.000Z' })];
  assert.equal((await store.refresh()).premium_access, false);
});

test('a store read that never answers counts as offline and keeps the grant', async () => {
  const backend = createBackend();
  let hang = false;
  const store = createEntitlementStore({
    backend, timeoutMs: 20,
    getPurchases: () => (hang ? new Promise(() => {}) : Promise.resolve([owned()])),
  });
  await store.refresh();
  hang = true;
  const status = await store.refresh();
  assert.equal(status.premium_access, true);
  assert.equal(status.offline, true);
});
