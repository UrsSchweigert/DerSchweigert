// Who may play Campaign 2. On the web it is part of the one existing subscription (no
// extra product). Only the apps sell it separately, as one more non-consumable in-app
// product. Pure logic: callers pass in what the platform already knows.

// The store product id of Campaign II, sold only in the apps (the web has it in the subscription).
// Create it with exactly this id in App Store Connect and Google Play, and keep it equal to
// CAMPAIGN2_PRODUCT_ID in mobile/game/purchase.js (a test fails if they drift apart). Store ids
// can never be reused, so do not change it once created.
export const CAMPAIGN2_PRODUCT_ID = 'arithmoslayer_genius_unlock';

/**
 * Whether the title screen shows the Genius Campaign button. Players who own the app product
 * always see it (they bought it, so they can switch at once, even on a fresh install). Everyone
 * else, including web subscribers, sees it only after beating level 40 for the first time.
 */
export function geniusButtonVisible({ platform, ownsProduct = false, revealed = false }) {
  if (platform !== 'web' && platform !== 'app') throw new RangeError(`Unknown platform "${platform}"`);
  return revealed || (platform === 'app' && ownsProduct);
}

/**
 * @param {{platform: 'web'|'app', premiumAccess?: boolean, ownedProductIds?: string[]}} state
 *   `premiumAccess` is the existing web entitlement (the subscription); `ownedProductIds`
 *   are the app's owned store products (see mobile/game/entitlement.js).
 */
export function campaign2Access({ platform, premiumAccess = false, ownedProductIds = [] }) {
  if (platform === 'web') {
    return premiumAccess
      ? { granted: true, reason: 'web_subscription' }
      : { granted: false, reason: 'subscription_required' };
  }
  if (platform === 'app') {
    return ownedProductIds.includes(CAMPAIGN2_PRODUCT_ID)
      ? { granted: true, reason: 'app_purchase' }
      : { granted: false, reason: 'app_purchase_required' };
  }
  throw new RangeError(`Unknown platform "${platform}"`);
}
