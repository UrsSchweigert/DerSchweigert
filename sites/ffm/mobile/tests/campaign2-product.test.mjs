// campaign2-product.test.mjs — Campaign II as a second in-app product in the apps.
// (On the web it is part of the subscription and has no product; see campaign2/access.js.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CAMPAIGN2_PRODUCT_ID, CATALOGUE_IDS, PRODUCT_ID, createPurchaseStore } from '../game/purchase.js';
import { CAMPAIGN2_PRODUCT_ID as SHARED_ID } from '../../static/game/campaign2/access.js';
import { createEntitlementStore, ENTITLEMENT_KEY } from '../game/entitlement.js';
import { buildPaywallMarkup, createPaywall, paywallText } from '../game/paywall.js';

const memoryBackend = () => {
  const data = new Map();
  return { data, get: async key => data.get(key) ?? null, set: async (key, value) => { data.set(key, value); } };
};
const owned = id => ({ productIdentifier: id, transactionId: `t-${id}`, purchaseState: '1' });

test('the app and the shared web code agree on the product id', () => {
  assert.equal(CAMPAIGN2_PRODUCT_ID, SHARED_ID);
  assert.ok(CATALOGUE_IDS.includes(CAMPAIGN2_PRODUCT_ID));
  assert.notEqual(CAMPAIGN2_PRODUCT_ID, PRODUCT_ID);
});

test('Campaign II has its own entitlement cache: owning it does not unlock the game, and a refund revokes it', async () => {
  const backend = memoryBackend();
  let purchases = [owned(CAMPAIGN2_PRODUCT_ID)];
  const getPurchases = async () => purchases;
  const full = createEntitlementStore({ backend, getPurchases });
  const campaign2 = createEntitlementStore({
    backend, getPurchases, productId: CAMPAIGN2_PRODUCT_ID, key: 'arithmoslayer:entitlement:campaign2',
  });

  assert.equal((await campaign2.refresh()).premium_access, true);
  assert.equal((await full.refresh()).premium_access, false, 'the full unlock is a separate purchase');
  assert.ok(backend.data.has('arithmoslayer:entitlement:campaign2'));

  const offline = createEntitlementStore({
    backend, getPurchases: async () => { throw new Error('offline'); },
    productId: CAMPAIGN2_PRODUCT_ID, key: 'arithmoslayer:entitlement:campaign2',
  });
  assert.equal((await offline.refresh()).premium_access, true, 'offline keeps the cached grant');

  purchases = [];
  assert.equal((await campaign2.refresh()).premium_access, false, 'a refund revokes it');
  assert.notEqual(ENTITLEMENT_KEY, 'arithmoslayer:entitlement:campaign2');
});

test('the Campaign II paywall sells Campaign II and grants only once the store owns it', async () => {
  const bought = [];
  const store = createPurchaseStore({
    gate: async () => true,
    plugin: {
      isAvailable: () => true,
      getProduct: async id => ({ identifier: id, priceString: '3,99 €' }),
      purchaseProduct: async id => { bought.push(id); return owned(id); },
      getPurchases: async () => [],
      acknowledgePurchase: async () => {},
      restorePurchases: async () => {},
    },
    productId: CAMPAIGN2_PRODUCT_ID,
  });
  const statuses = [];
  const view = { render() {}, setStatus: (text, o) => statuses.push({ text, ...o }), setBusy() {}, close() {} };
  let ownedNow = [];
  const platform = { refreshEntitlement: async () => ({ premium_access: false }), getOwnedProductIds: async () => ownedNow };
  const granted = [];
  const paywall = createPaywall({ platform, purchaseStore: store, gateUi: {}, view, locale: 'en', product: 'campaign2', onGranted: () => granted.push(1) });

  ownedNow = [];
  assert.equal((await paywall.buy()).granted, false, 'a purchase the store does not list is not a grant');
  assert.deepEqual(bought, [CAMPAIGN2_PRODUCT_ID], 'the right product was bought');

  ownedNow = [CAMPAIGN2_PRODUCT_ID];
  const result = await paywall.buy();
  assert.equal(result.granted, true);
  assert.deepEqual(granted, [1]);
  assert.equal(statuses.at(-1).text, paywallText('paywall.campaign2.success', 'en'));

  assert.throws(() => createPaywall({ platform: { refreshEntitlement() {} }, product: 'campaign2' }), TypeError);
});

test('the Campaign II paywall copy is bilingual and says what is sold', () => {
  const en = buildPaywallMarkup({ locale: 'en', product: 'campaign2' });
  const de = buildPaywallMarkup({ locale: 'de', product: 'campaign2' });
  assert.match(en, /Unlock Campaign II/);
  assert.match(de, /Abenteuer II freischalten/);
  assert.match(buildPaywallMarkup({ locale: 'en', product: 'campaign2' }), /Buy Campaign II/);
  assert.doesNotMatch(en, /levels 3-60/);
  assert.match(buildPaywallMarkup({ locale: 'en' }), /Unlock levels 3-60/, 'the default paywall is unchanged');
});
