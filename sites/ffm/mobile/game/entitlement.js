// entitlement.js — Cached store entitlement for the app build.
//
// The app has no entitlement server. The single non-consumable unlock is read
// from StoreKit 2 / Google Play through the injected getPurchases function and
// cached in the same Capacitor Preferences backend as progress, so an offline
// launch still knows the player bought the game. A failed store read is not a
// revocation: offline, the cached grant stays and the status reports
// `offline: true`. Only a successful read without an owned, non-revoked
// transaction (a refund) clears the cache.

import { PRODUCT_ID, isPurchased } from './purchase.js';

/** The only entitlement schema version this module understands. */
export const ENTITLEMENT_SCHEMA_VERSION = 1;

/** The single key holding the cached entitlement. */
export const ENTITLEMENT_KEY = 'arithmoslayer:entitlement';

const NOT_ENTITLED = Object.freeze({
  premium_access: false,
  entitled: false,
  reason: 'not_entitled',
  source: 'none',
  checked_at: null,
  product_id: PRODUCT_ID,
  transaction_id: null,
});

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/** A missing, corrupt or unknown-version document reads as no entitlement. */
function normalizeRecord(parsed) {
  if (!isPlainObject(parsed) || parsed.version !== ENTITLEMENT_SCHEMA_VERSION) return null;
  if (parsed.entitled !== true || typeof parsed.checked_at !== 'string' || !parsed.checked_at) {
    return null;
  }
  return {
    entitled: true,
    product_id: typeof parsed.product_id === 'string' ? parsed.product_id : PRODUCT_ID,
    transaction_id: typeof parsed.transaction_id === 'string' ? parsed.transaction_id : null,
    checked_at: parsed.checked_at,
  };
}

function statusOf(record) {
  if (!record) return { ...NOT_ENTITLED };
  return {
    premium_access: true,
    entitled: true,
    reason: 'store_purchase',
    source: 'cache',
    checked_at: record.checked_at,
    product_id: record.product_id,
    transaction_id: record.transaction_id,
  };
}

/**
 * Create the entitlement store around an injectable backend and purchase reader.
 * @param {{backend?: object, getPurchases?: Function, productId?: string, now?: () => string}} options
 * @returns {object} store API with read/write/getStatus/refresh
 */
export function createEntitlementStore({
  backend,
  getPurchases,
  productId = PRODUCT_ID,
  now = () => new Date().toISOString(),
} = {}) {
  const available = () => Boolean(
    backend
    && typeof backend.get === 'function'
    && typeof backend.set === 'function'
    && (typeof backend.isAvailable !== 'function' || backend.isAvailable()),
  );

  async function read() {
    if (!available()) return null;
    try {
      const raw = await backend.get(ENTITLEMENT_KEY);
      return typeof raw === 'string' && raw !== '' ? normalizeRecord(JSON.parse(raw)) : null;
    } catch {
      return null;
    }
  }

  async function write(record) {
    if (!available()) return false;
    try {
      await backend.set(ENTITLEMENT_KEY, JSON.stringify({
        version: ENTITLEMENT_SCHEMA_VERSION,
        entitled: record.entitled === true,
        product_id: record.product_id ?? productId,
        transaction_id: record.transaction_id ?? null,
        checked_at: record.checked_at ?? now(),
        reason: record.reason ?? (record.entitled === true ? 'store_purchase' : 'not_entitled'),
      }));
      return true;
    } catch {
      return false;
    }
  }

  async function getStatus() {
    return statusOf(await read());
  }

  /**
   * Re-read the store and reconcile the cache: grant on an owned, non-revoked
   * unlock; revoke on a refund or an empty list; keep the cache when offline.
   * @returns {Promise<object>} entitlement status with `offline` and `cached`
   */
  const offlineStatus = async () => {
    const status = await getStatus();
    return { ...status, offline: true, cached: status.premium_access };
  };

  async function refresh() {
    if (typeof getPurchases !== 'function') return offlineStatus();
    let purchases;
    try {
      purchases = await getPurchases();
    } catch {
      return offlineStatus();
    }
    const owned = (Array.isArray(purchases) ? purchases : []).find(
      (transaction) => transaction?.productIdentifier === productId && isPurchased(transaction),
    );
    const checkedAt = now();
    if (!owned) {
      const hadGrant = (await read()) !== null;
      const saved = await write({
        entitled: false,
        checked_at: checkedAt,
        reason: hadGrant ? 'revoked' : 'not_entitled',
      });
      return {
        ...NOT_ENTITLED,
        reason: hadGrant ? 'revoked' : 'not_entitled',
        source: 'store',
        checked_at: checkedAt,
        cached: saved,
        offline: false,
      };
    }
    const record = {
      entitled: true,
      product_id: productId,
      transaction_id: owned.transactionId ?? owned.purchaseToken ?? null,
      checked_at: checkedAt,
    };
    const saved = await write(record);
    return { ...statusOf(record), source: 'store', cached: saved, offline: false };
  }

  return { read, write, getStatus, refresh };
}
