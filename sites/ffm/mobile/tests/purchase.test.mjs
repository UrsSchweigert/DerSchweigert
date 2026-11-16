// purchase.test.mjs — unit tests for the one-time unlock purchase.
//
// The real store cannot run in the Linux checker, so the plugin is a Map-free
// fake that records calls and returns canned transactions. The tests pin the
// store contract: the parental gate runs before every store call, prices come
// from getProduct, and each outcome (success, cancel, pending, error,
// already-owned, restore) settles or leaves the transaction alone as the
// platform requires.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CATALOGUE_IDS,
  HERO_PACK_ID,
  PRODUCTS,
  PRODUCT_ID,
  PRODUCT_TYPE,
  PURCHASE_OUTCOMES,
  RESTORE_OUTCOMES,
  classifyError,
  createPurchaseStore,
  createPurchasesPlugin,
  isPurchased,
  needsSettlement,
} from '../game/purchase.js';

const PRODUCT = Object.freeze({
  identifier: PRODUCT_ID,
  title: 'Full unlock',
  description: 'All 60 levels',
  priceString: '4,99 €',
  price: 4.99,
  currencyCode: 'EUR',
});

function transaction(overrides = {}) {
  return {
    transactionId: 'GPA.1234-5678-9012-34567',
    purchaseToken: 'play-token',
    productIdentifier: PRODUCT_ID,
    purchaseState: '1',
    isAcknowledged: true,
    ...overrides,
  };
}

/**
 * Fake plugin. `events` is shared with the fake gate, so a test can assert
 * that the gate ran before the first store call.
 */
function createHarness(options = {}) {
  const events = [];
  const state = {
    product: PRODUCT,
    purchases: [],
    purchase: transaction(),
    productError: null,
    purchasesError: null,
    purchaseError: null,
    restoreError: null,
    acknowledgeError: null,
  };
  const plugin = {
    events,
    isAvailable() {
      events.push('isAvailable');
      return true;
    },
    async getProduct() {
      events.push('getProduct');
      if (state.productError) throw state.productError;
      return state.product;
    },
    async purchaseProduct() {
      events.push('purchaseProduct');
      if (state.purchaseError) throw state.purchaseError;
      return state.purchase;
    },
    async getPurchases() {
      events.push('getPurchases');
      if (state.purchasesError) throw state.purchasesError;
      return state.purchases;
    },
    async restorePurchases() {
      events.push('restorePurchases');
      if (state.restoreError) throw state.restoreError;
    },
    async acknowledgePurchase(record) {
      events.push(['acknowledgePurchase', record]);
      if (state.acknowledgeError) throw state.acknowledgeError;
    },
  };
  const gateCalls = [];
  const gate = async (request) => {
    gateCalls.push(request);
    events.push(`gate:${request.action}`);
    return options.allow ?? true;
  };
  const store = createPurchaseStore({ plugin, gate });
  return { store, plugin, state, events, gateCalls };
}

const acknowledgeCalls = (events) => events.filter((entry) => Array.isArray(entry));

test('the store is bound to the unlock product and exposes availability', () => {
  const { store } = createHarness();
  assert.equal(store.productId, PRODUCT_ID);
  assert.equal(PRODUCT_TYPE, 'inapp');
  assert.equal(store.isAvailable(), true);
});

test('a store without a plugin or a gate is a programming error', () => {
  assert.throws(() => createPurchaseStore({}), TypeError);
  assert.throws(() => createPurchaseStore({ plugin: { purchaseProduct() {} }, gate: 'no' }), TypeError);
});

test('the Capacitor adapter resolves the plugin lazily and uses the unlock id', async () => {
  const calls = [];
  const scope = {};
  const adapter = createPurchasesPlugin(scope);
  assert.equal(adapter.isAvailable(), false);

  scope.Capacitor = {
    Plugins: {
      NativePurchases: {
        async getProduct(options) {
          calls.push(['getProduct', options]);
          return { product: PRODUCT };
        },
        async purchaseProduct(options) {
          calls.push(['purchaseProduct', options]);
          return transaction({ isAcknowledged: false });
        },
        async getPurchases(options) {
          calls.push(['getPurchases', options]);
          return { purchases: [transaction()] };
        },
        async restorePurchases() {
          calls.push(['restorePurchases']);
        },
        async acknowledgePurchase(options) {
          calls.push(['acknowledgePurchase', options]);
        },
      },
    },
  };

  assert.equal(adapter.isAvailable(), true);
  assert.deepEqual(await adapter.getProduct(), PRODUCT);
  assert.equal((await adapter.purchaseProduct()).transactionId, transaction().transactionId);
  assert.equal((await adapter.getPurchases()).length, 1);
  await adapter.restorePurchases();
  await adapter.acknowledgePurchase(transaction());

  assert.deepEqual(calls, [
    ['getProduct', { productIdentifier: PRODUCT_ID, productType: 'inapp' }],
    ['purchaseProduct', { productIdentifier: PRODUCT_ID, productType: 'inapp', quantity: 1 }],
    ['getPurchases', { productType: 'inapp' }],
    ['restorePurchases'],
    ['acknowledgePurchase', { purchaseToken: 'play-token' }],
  ]);
});

test('the adapter falls back to the transaction id for StoreKit finishing', async () => {
  const calls = [];
  const scope = {
    Capacitor: {
      Plugins: {
        NativePurchases: {
          async acknowledgePurchase(options) {
            calls.push(options);
          },
        },
      },
    },
  };
  await createPurchasesPlugin(scope).acknowledgePurchase({ transactionId: '2000001043762129', needsFinish: true });
  assert.deepEqual(calls, [{ purchaseToken: '2000001043762129' }]);
});

test('queryProduct returns the localised store price', async () => {
  const { store } = createHarness();
  const result = await store.queryProduct();
  assert.equal(result.error, null);
  assert.equal(result.product.priceString, '4,99 €');
});

test('queryProduct reports a store error without throwing', async () => {
  const { store, state } = createHarness();
  state.productError = new Error('Product not found');
  const result = await store.queryProduct();
  assert.equal(result.product, null);
  assert.equal(result.error, 'Product not found');
});

test('purchase success runs the gate first, uses the store price and acknowledges', async () => {
  const { store, state, events, gateCalls } = createHarness();
  state.purchase = transaction({ isAcknowledged: false });

  const result = await store.purchase({ ui: { ask: async () => 42 }, locale: 'de' });

  assert.equal(result.outcome, PURCHASE_OUTCOMES.SUCCESS);
  assert.equal(result.product.priceString, '4,99 €');
  assert.equal(result.transaction.purchaseToken, 'play-token');
  assert.equal(result.acknowledged, true);
  assert.equal(result.error, null);
  assert.equal(gateCalls.length, 1);
  assert.equal(gateCalls[0].action, 'purchase');
  assert.equal(gateCalls[0].locale, 'de');
  assert.equal(events[0], 'gate:purchase');
  assert.equal(acknowledgeCalls(events).length, 1);
  assert.deepEqual(acknowledgeCalls(events)[0][1], state.purchase);
});

test('purchase success does not re-acknowledge an acknowledged purchase', async () => {
  const { store, events } = createHarness();
  const result = await store.purchase({ ui: { ask: async () => 42 } });
  assert.equal(result.outcome, PURCHASE_OUTCOMES.SUCCESS);
  assert.equal(result.acknowledged, true);
  assert.equal(acknowledgeCalls(events).length, 0);
});

test('an unfinished StoreKit transaction is finished after success', async () => {
  const { store, state, events } = createHarness();
  state.purchase = transaction({ purchaseToken: undefined, needsFinish: true, isAcknowledged: undefined });

  const result = await store.purchase({ ui: { ask: async () => 42 } });

  assert.equal(result.outcome, PURCHASE_OUTCOMES.SUCCESS);
  assert.equal(acknowledgeCalls(events).length, 1);
  assert.equal(acknowledgeCalls(events)[0][1].transactionId, transaction().transactionId);
});

test('a failed acknowledgment keeps the granted purchase as success', async () => {
  const { store, state } = createHarness();
  state.purchase = transaction({ isAcknowledged: false });
  state.acknowledgeError = new Error('Play Billing unavailable');

  const result = await store.purchase({ ui: { ask: async () => 42 } });

  assert.equal(result.outcome, PURCHASE_OUTCOMES.SUCCESS);
  assert.equal(result.acknowledged, false);
  assert.equal(result.error, 'Play Billing unavailable');
});

test('a cancelled purchase is reported as cancelled and not acknowledged', async () => {
  const { store, state, events } = createHarness();
  state.purchaseError = Object.assign(new Error('User cancelled the purchase'), { code: 'PURCHASE_CANCELLED' });

  const result = await store.purchase({ ui: { ask: async () => 42 } });

  assert.equal(result.outcome, PURCHASE_OUTCOMES.CANCELLED);
  assert.equal(result.error, 'User cancelled the purchase');
  assert.equal(events[0], 'gate:purchase');
  assert.equal(acknowledgeCalls(events).length, 0);
});

test('a pending Android purchase is reported as pending and not acknowledged', async () => {
  const { store, state, events } = createHarness();
  state.purchase = transaction({ purchaseState: '0', isAcknowledged: false, transactionId: undefined });

  const result = await store.purchase({ ui: { ask: async () => 42 } });

  assert.equal(result.outcome, PURCHASE_OUTCOMES.PENDING);
  assert.equal(result.transaction.purchaseState, '0');
  assert.equal(acknowledgeCalls(events).length, 0);
});

test('an Ask-to-Buy / deferred error is reported as pending', async () => {
  const { store, state } = createHarness();
  state.purchaseError = Object.assign(new Error('Purchase is pending approval'), { code: 'PURCHASE_PENDING' });

  const result = await store.purchase({ ui: { ask: async () => 42 } });
  assert.equal(result.outcome, PURCHASE_OUTCOMES.PENDING);
});

test('an unexpected store failure is reported as error', async () => {
  const { store, state } = createHarness();
  state.purchaseError = new Error('Network error');

  const result = await store.purchase({ ui: { ask: async () => 42 } });
  assert.equal(result.outcome, PURCHASE_OUTCOMES.ERROR);
  assert.equal(result.error, 'Network error');
});

test('a product query failure stops the purchase before the store sheet', async () => {
  const { store, state, events } = createHarness();
  state.productError = new Error('Product not found');

  const result = await store.purchase({ ui: { ask: async () => 42 } });

  assert.equal(result.outcome, PURCHASE_OUTCOMES.ERROR);
  assert.equal(result.error, 'Product not found');
  assert.equal(events.includes('purchaseProduct'), false);
});

test('an already-owned purchase from history is settled without buying again', async () => {
  const { store, state, events } = createHarness();
  state.purchases = [transaction({ isAcknowledged: false })];

  const result = await store.purchase({ ui: { ask: async () => 42 } });

  assert.equal(result.outcome, PURCHASE_OUTCOMES.ALREADY_OWNED);
  assert.equal(result.transaction.purchaseToken, 'play-token');
  assert.equal(events.includes('purchaseProduct'), false);
  assert.equal(events.includes('getProduct'), false);
  assert.equal(acknowledgeCalls(events).length, 1);
});

test('an already-owned store error is reported as already-owned', async () => {
  const { store, state } = createHarness();
  state.purchaseError = Object.assign(new Error('You already own this item'), { code: 'ITEM_ALREADY_OWNED' });

  const result = await store.purchase({ ui: { ask: async () => 42 } });
  assert.equal(result.outcome, PURCHASE_OUTCOMES.ALREADY_OWNED);
});

test('a foreign, pending or revoked history entry does not count as owned', async () => {
  const { store, state } = createHarness();
  state.purchases = [
    transaction({ productIdentifier: 'another.product' }),
    transaction({ purchaseState: '0' }),
    transaction({ revocationDate: '2026-01-01T00:00:00Z', revocationReason: 'other' }),
  ];
  const result = await store.purchase({ ui: { ask: async () => 42 } });
  assert.equal(result.outcome, PURCHASE_OUTCOMES.SUCCESS);
});

test('a revoked purchase is not restorable', async () => {
  const { store, state } = createHarness();
  state.purchases = [transaction({ revocationDate: '2026-01-01T00:00:00Z', revocationReason: 'other' })];

  const result = await store.restore({ ui: { ask: async () => 42 } });
  assert.deepEqual(result, { outcome: RESTORE_OUTCOMES.RESTORED, entitled: false });
});

test('a failing history query does not block a new purchase', async () => {
  const { store, state } = createHarness();
  state.purchasesError = new Error('Billing unavailable');
  const result = await store.purchase({ ui: { ask: async () => 42 } });
  assert.equal(result.outcome, PURCHASE_OUTCOMES.SUCCESS);
});

test('a denied gate blocks the purchase before any store call', async () => {
  const { store, events, gateCalls } = createHarness({ allow: false });

  const result = await store.purchase({ ui: { ask: async () => 41 } });

  assert.deepEqual(result, { outcome: PURCHASE_OUTCOMES.GATED });
  assert.deepEqual(events, ['gate:purchase']);
  assert.equal(gateCalls[0].action, 'purchase');
});

test('restore runs the gate first and reports the restored entitlement', async () => {
  const { store, state, events, gateCalls } = createHarness();
  state.purchases = [transaction({ isAcknowledged: false })];

  const result = await store.restore({ ui: { ask: async () => 42 }, locale: 'en' });

  assert.equal(result.outcome, RESTORE_OUTCOMES.RESTORED);
  assert.equal(result.entitled, true);
  assert.equal(result.transaction.productIdentifier, PRODUCT_ID);
  assert.equal(result.acknowledged, true);
  assert.equal(events[0], 'gate:restore');
  assert.equal(gateCalls[0].action, 'restore');
  assert.equal(acknowledgeCalls(events).length, 1);
});

test('restore without an owned purchase reports no entitlement', async () => {
  const { store, state } = createHarness();
  state.purchases = [transaction({ productIdentifier: 'another.product' })];

  const result = await store.restore({ ui: { ask: async () => 42 } });
  assert.deepEqual(result, { outcome: RESTORE_OUTCOMES.RESTORED, entitled: false });
});

test('restore reports a store error without claiming entitlement', async () => {
  const { store, state } = createHarness();
  state.restoreError = new Error('Restore failed');

  const result = await store.restore({ ui: { ask: async () => 42 } });
  assert.equal(result.outcome, RESTORE_OUTCOMES.ERROR);
  assert.equal(result.entitled, false);
  assert.equal(result.error, 'Restore failed');
});

test('a denied gate blocks restore before any store call', async () => {
  const { store, events } = createHarness({ allow: false });

  const result = await store.restore({ ui: { ask: async () => 41 } });

  assert.deepEqual(result, { outcome: RESTORE_OUTCOMES.GATED, entitled: false });
  assert.deepEqual(events, ['gate:restore']);
});

test('transaction helpers recognise pending and unsettled records', () => {
  assert.equal(isPurchased(transaction()), true);
  assert.equal(isPurchased(transaction({ purchaseState: '0' })), false);
  assert.equal(isPurchased(transaction({ revocationDate: '2026-01-01T00:00:00Z' })), false);
  assert.equal(isPurchased(null), false);
  assert.equal(needsSettlement(transaction({ isAcknowledged: false })), true);
  assert.equal(needsSettlement(transaction({ isAcknowledged: true })), false);
  assert.equal(needsSettlement(transaction({ needsFinish: true })), true);
  assert.equal(needsSettlement(null), false);
});

test('classifyError covers the store-specific failure families', () => {
  assert.equal(classifyError({ code: 'PURCHASE_CANCELLED' }), PURCHASE_OUTCOMES.CANCELLED);
  assert.equal(classifyError({ message: 'User canceled' }), PURCHASE_OUTCOMES.CANCELLED);
  assert.equal(classifyError({ code: 'PURCHASE_PENDING' }), PURCHASE_OUTCOMES.PENDING);
  assert.equal(classifyError({ message: 'Waiting for Ask to Buy approval' }), PURCHASE_OUTCOMES.PENDING);
  assert.equal(classifyError({ code: 'ITEM_ALREADY_OWNED' }), PURCHASE_OUTCOMES.ALREADY_OWNED);
  assert.equal(classifyError(new Error('boom')), PURCHASE_OUTCOMES.ERROR);
  assert.equal(classifyError(null), PURCHASE_OUTCOMES.ERROR);
});

const heroTx = (overrides = {}) => transaction({ productIdentifier: HERO_PACK_ID, ...overrides });

test('the catalogue is frozen and names both products', () => {
  assert.equal(PRODUCT_ID, 'arithmoslayer_full_unlock');
  assert.equal(HERO_PACK_ID, 'arithmoslayer_hero_pack');
  assert.deepEqual([...CATALOGUE_IDS], [PRODUCT_ID, HERO_PACK_ID]);
  assert.equal(Object.isFrozen(PRODUCTS), true);
  assert.equal(Object.isFrozen(CATALOGUE_IDS), true);
});

test('the adapter sends the hero pack id with the same product type', async () => {
  const calls = [];
  const scope = {
    Capacitor: { Plugins: { NativePurchases: {
      async getProduct(payload) { calls.push(['getProduct', payload]); return { product: null }; },
      async purchaseProduct(payload) { calls.push(['purchaseProduct', payload]); return {}; },
    } } },
  };
  const adapter = createPurchasesPlugin(scope);
  await adapter.getProduct(HERO_PACK_ID);
  await adapter.purchaseProduct(HERO_PACK_ID);
  assert.deepEqual(calls, [
    ['getProduct', { productIdentifier: HERO_PACK_ID, productType: PRODUCT_TYPE }],
    ['purchaseProduct', { productIdentifier: HERO_PACK_ID, productType: PRODUCT_TYPE, quantity: 1 }],
  ]);
});

test('a hero pack purchase gates first, settles and maps outcomes like the unlock', async () => {
  const ids = [];
  const h = createHarness();
  h.plugin.getProduct = async (id) => { h.events.push('getProduct'); ids.push(id); return PRODUCT; };
  h.plugin.purchaseProduct = async (id) => { h.events.push('purchaseProduct'); ids.push(id); if (h.state.purchaseError) throw h.state.purchaseError; return h.state.purchase; };
  h.state.purchase = heroTx({ isAcknowledged: false });
  const result = await h.store.purchase({ productId: HERO_PACK_ID });
  assert.equal(result.outcome, PURCHASE_OUTCOMES.SUCCESS);
  assert.equal(result.acknowledged, true);
  assert.equal(acknowledgeCalls(h.events).length, 1);
  assert.deepEqual(ids, [HERO_PACK_ID, HERO_PACK_ID]);
  assert.equal(h.events[0], 'gate:purchase');

  h.state.purchase = heroTx({ purchaseState: '0' });
  assert.equal((await h.store.purchase({ productId: HERO_PACK_ID })).outcome, PURCHASE_OUTCOMES.PENDING);
  h.state.purchaseError = Object.assign(new Error('User cancelled'), { code: 'CANCELLED' });
  assert.equal((await h.store.purchase({ productId: HERO_PACK_ID })).outcome, PURCHASE_OUTCOMES.CANCELLED);
});

test('a hero pack already owned is reported without a second purchase', async () => {
  const h = createHarness();
  h.state.purchases = [heroTx()];
  const result = await h.store.purchase({ productId: HERO_PACK_ID });
  assert.equal(result.outcome, PURCHASE_OUTCOMES.ALREADY_OWNED);
  assert.equal(h.events.includes('purchaseProduct'), false);
  h.state.purchases = [transaction()];
  assert.equal(h.store.productId, PRODUCT_ID);
});

test('a denied gate never reaches the plugin for a pack purchase or a restore', async () => {
  const h = createHarness({ allow: false });
  assert.equal((await h.store.purchase({ productId: HERO_PACK_ID })).outcome, PURCHASE_OUTCOMES.GATED);
  assert.equal((await h.store.restore()).outcome, RESTORE_OUTCOMES.GATED);
  assert.deepEqual(h.events, ['gate:purchase', 'gate:restore']);
});

test('a product outside the catalogue is rejected without any plugin call', async () => {
  const h = createHarness();
  assert.equal((await h.store.purchase({ productId: 'other' })).outcome, PURCHASE_OUTCOMES.ERROR);
  assert.deepEqual(await h.store.queryProduct('other'), { product: null, error: 'unknown product' });
  assert.deepEqual(h.events, []);
});

test('queryProduct reads the hero pack and defaults to the unlock', async () => {
  const h = createHarness();
  const ids = [];
  h.plugin.getProduct = async (id) => { ids.push(id); return PRODUCT; };
  await h.store.queryProduct(HERO_PACK_ID);
  await h.store.queryProduct();
  assert.deepEqual(ids, [HERO_PACK_ID, PRODUCT_ID]);
});

test('restore lists owned catalogue products with one restore and one read', async () => {
  const h = createHarness();
  h.state.purchases = [transaction(), heroTx()];
  const both = await h.store.restore();
  assert.equal(both.entitled, true);
  assert.deepEqual(both.ownedProducts, [PRODUCT_ID, HERO_PACK_ID]);
  assert.equal(h.events.filter((e) => e === 'restorePurchases').length, 1);
  assert.equal(h.events.filter((e) => e === 'getPurchases').length, 1);

  h.state.purchases = [heroTx()];
  assert.deepEqual(await h.store.restore(), {
    outcome: RESTORE_OUTCOMES.RESTORED,
    entitled: false,
    ownedProducts: [HERO_PACK_ID],
  });
  h.state.purchases = [];
  assert.deepEqual(await h.store.restore(), { outcome: RESTORE_OUTCOMES.RESTORED, entitled: false });
});
