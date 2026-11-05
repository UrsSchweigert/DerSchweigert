// purchase.js — One-time unlock purchase through StoreKit 2 and Google Play.
//
// The app sells exactly one non-consumable product, arithmoslayer_full_unlock.
// The open-source @capgo/native-purchases plugin (MPL-2.0) wraps StoreKit 2 on
// iOS and Google Play Billing on Android; there is no backend, no receipt
// server and no third-party purchase service. Prices always come from the
// store (getProduct), never from a hard-coded amount.
//
// The module is DOM-free and native-free: createPurchasesPlugin() reads the
// Capacitor plugin lazily from the injected scope, and the store only needs
// the small method set below, so node:test drives it with a fake plugin.
//
// Both entry points run the parental gate first, because a child must not be
// able to reach a store sheet or a restore. A purchase is acknowledged (Play)
// or finished (StoreKit 2) after it is granted; already-owned transactions and
// restored ones are settled the same way. A pending purchase is never settled,
// because the store has not charged it yet.

import { gate as parentalGate } from './parental-gate.js';

/** The single non-consumable unlock sold by the app. */
export const PRODUCT_ID = 'arithmoslayer_full_unlock';

/** Google Play / StoreKit product type for a one-time purchase. */
export const PRODUCT_TYPE = 'inapp';

/** Every outcome of purchase(). */
export const PURCHASE_OUTCOMES = Object.freeze({
  SUCCESS: 'success',
  CANCELLED: 'cancelled',
  PENDING: 'pending',
  ALREADY_OWNED: 'already-owned',
  ERROR: 'error',
  GATED: 'gated',
});

/** Every outcome of restore(). */
export const RESTORE_OUTCOMES = Object.freeze({
  RESTORED: 'restored',
  ERROR: 'error',
  GATED: 'gated',
});

function messageOf(error) {
  if (typeof error === 'string' && error) return error;
  if (error && typeof error.message === 'string' && error.message) return error.message;
  return 'purchase failed';
}

/**
 * Map a plugin error to a purchase outcome. The plugin reports the store's
 * failure as an Error with a `code` and/or message, so both are inspected;
 * the match is intentionally case-insensitive because iOS and Android word
 * the same condition differently.
 * @param {unknown} error rejection from the plugin
 * @returns {string} one of PURCHASE_OUTCOMES
 */
export function classifyError(error) {
  const text = `${error?.code ?? ''} ${error?.message ?? ''}`.toLowerCase();
  if (/cancel/.test(text)) return PURCHASE_OUTCOMES.CANCELLED;
  if (/pending|deferred|ask.?to.?buy/.test(text)) return PURCHASE_OUTCOMES.PENDING;
  if (/already.?owned|already.?purchased|item.?already.?owned/.test(text)) {
    return PURCHASE_OUTCOMES.ALREADY_OWNED;
  }
  return PURCHASE_OUTCOMES.ERROR;
}

/**
 * Whether a transaction is a completed purchase. Android exposes a numeric
 * purchaseState where "1" is PURCHASED and "0" is PENDING; iOS has no state
 * field for a non-consumable and returns only completed transactions. A
 * revoked (refunded) StoreKit transaction never counts as owned.
 * @param {unknown} transaction store transaction
 * @returns {boolean} true when the transaction is charged and valid
 */
export function isPurchased(transaction) {
  if (!transaction || typeof transaction !== 'object') return false;
  if (typeof transaction.revocationDate === 'string' && transaction.revocationDate) return false;
  return transaction.purchaseState === undefined || transaction.purchaseState === '1';
}

/**
 * Whether a transaction still needs settling: StoreKit finishing on iOS
 * (`needsFinish`) or Google Play acknowledgment on Android (`isAcknowledged`).
 * @param {unknown} transaction store transaction
 * @returns {boolean} true when acknowledgePurchase() must run
 */
export function needsSettlement(transaction) {
  if (!transaction || typeof transaction !== 'object') return false;
  if (transaction.needsFinish === true) return true;
  return transaction.isAcknowledged === false;
}

/**
 * Create the Capacitor NativePurchases adapter.
 *
 * The plugin is resolved on every call, exactly like the Preferences backend:
 * the bundle is copied before Capacitor injects its plugins, so reading it at
 * module load would capture undefined. Tests pass a scope object instead of
 * globalThis.
 * @param {object} [scope] object holding Capacitor.Plugins
 * @returns {object} adapter with the store's plugin surface
 */
export function createPurchasesPlugin(scope = globalThis) {
  const native = () => scope?.Capacitor?.Plugins?.NativePurchases ?? null;
  const call = (method) => {
    const plugin = native();
    if (!plugin || typeof plugin[method] !== 'function') {
      throw new Error('Capacitor NativePurchases is unavailable');
    }
    return plugin[method].bind(plugin);
  };
  return {
    isAvailable() {
      const plugin = native();
      return Boolean(
        plugin
        && typeof plugin.purchaseProduct === 'function'
        && typeof plugin.getPurchases === 'function',
      );
    },
    async getProduct() {
      const { product } = await call('getProduct')({
        productIdentifier: PRODUCT_ID,
        productType: PRODUCT_TYPE,
      });
      return product ?? null;
    },
    async purchaseProduct() {
      return call('purchaseProduct')({
        productIdentifier: PRODUCT_ID,
        productType: PRODUCT_TYPE,
        quantity: 1,
      });
    },
    async getPurchases() {
      const { purchases } = await call('getPurchases')({ productType: PRODUCT_TYPE });
      return Array.isArray(purchases) ? purchases : [];
    },
    async restorePurchases() {
      await call('restorePurchases')();
    },
    async acknowledgePurchase(transaction) {
      const purchaseToken = transaction?.purchaseToken ?? transaction?.transactionId;
      if (!purchaseToken) {
        throw new Error('transaction has no purchase token or transaction id');
      }
      await call('acknowledgePurchase')({ purchaseToken });
    },
  };
}

/**
 * Create the purchase/restore store around an injectable plugin.
 *
 * `gate` defaults to the real parental gate and is called before any store
 * call; a store without a gate function is a programming error, so purchase
 * and restore always return GATED when the adult check fails.
 * @param {{plugin: object, gate?: Function, productId?: string}} options
 * @returns {object} store API
 */
export function createPurchaseStore({
  plugin,
  gate = parentalGate,
  productId = PRODUCT_ID,
} = {}) {
  if (!plugin || typeof plugin.purchaseProduct !== 'function') {
    throw new TypeError('purchase store needs a plugin with purchaseProduct');
  }
  if (typeof gate !== 'function') {
    throw new TypeError('purchase store needs a gate function');
  }

  const owns = (purchases) => (Array.isArray(purchases) ? purchases : [])
    .find((transaction) => transaction?.productIdentifier === productId && isPurchased(transaction)) ?? null;

  // Settling is best effort: a charged purchase has already granted the
  // entitlement, and a failed finish can be retried from the store queue.
  const settle = async (transaction) => {
    if (!needsSettlement(transaction)) return { acknowledged: true, error: null };
    try {
      await plugin.acknowledgePurchase(transaction);
      return { acknowledged: true, error: null };
    } catch (error) {
      return { acknowledged: false, error: messageOf(error) };
    }
  };

  const history = async () => {
    try {
      return await plugin.getPurchases();
    } catch {
      return [];
    }
  };

  return {
    productId,

    isAvailable() {
      return typeof plugin.isAvailable === 'function' ? plugin.isAvailable() : true;
    },

    /**
     * Query the store's localised product, so the paywall can show the
     * store price string instead of a hard-coded amount.
     * @returns {Promise<{product: object|null, error: string|null}>}
     */
    async queryProduct() {
      try {
        return { product: await plugin.getProduct(), error: null };
      } catch (error) {
        return { product: null, error: messageOf(error) };
      }
    },

    /**
     * Gate, then buy the unlock.
     * @param {{ui: {ask: Function}, random?: () => number, locale?: string}} options
     * @returns {Promise<object>} purchase outcome
     */
    async purchase({ ui, random = Math.random, locale } = {}) {
      if (!(await gate({ ui, random, locale, action: 'purchase' }))) {
        return { outcome: PURCHASE_OUTCOMES.GATED };
      }

      const owned = owns(await history());
      if (owned) {
        const settled = await settle(owned);
        return {
          outcome: PURCHASE_OUTCOMES.ALREADY_OWNED,
          transaction: owned,
          acknowledged: settled.acknowledged,
          error: settled.error,
        };
      }

      let product;
      try {
        product = await plugin.getProduct();
      } catch (error) {
        return { outcome: PURCHASE_OUTCOMES.ERROR, error: messageOf(error) };
      }

      let transaction;
      try {
        transaction = await plugin.purchaseProduct();
      } catch (error) {
        return { outcome: classifyError(error), error: messageOf(error) };
      }
      if (!transaction || typeof transaction !== 'object') {
        return { outcome: PURCHASE_OUTCOMES.ERROR, error: 'store returned no transaction' };
      }
      if (!isPurchased(transaction)) {
        return { outcome: PURCHASE_OUTCOMES.PENDING, transaction, product };
      }

      const settled = await settle(transaction);
      return {
        outcome: PURCHASE_OUTCOMES.SUCCESS,
        transaction,
        product,
        acknowledged: settled.acknowledged,
        error: settled.error,
      };
    },

    /**
     * Gate, then ask the store to restore the unlock on a fresh install or a
     * new device signed in with the same store account.
     * @param {{ui: {ask: Function}, random?: () => number, locale?: string}} options
     * @returns {Promise<{outcome: string, entitled: boolean, transaction?: object, error?: string|null}>}
     */
    async restore({ ui, random = Math.random, locale } = {}) {
      if (!(await gate({ ui, random, locale, action: 'restore' }))) {
        return { outcome: RESTORE_OUTCOMES.GATED, entitled: false };
      }
      try {
        await plugin.restorePurchases();
        const owned = owns(await plugin.getPurchases());
        if (!owned) {
          return { outcome: RESTORE_OUTCOMES.RESTORED, entitled: false };
        }
        const settled = await settle(owned);
        return {
          outcome: RESTORE_OUTCOMES.RESTORED,
          entitled: true,
          transaction: owned,
          acknowledged: settled.acknowledged,
          error: settled.error,
        };
      } catch (error) {
        return { outcome: RESTORE_OUTCOMES.ERROR, entitled: false, error: messageOf(error) };
      }
    },
  };
}
