// platform.js — Platform seam for Arithmo Slayer.
//
// Game modules talk to this interface instead of importing api.js or
// access-flow.js directly. The web build resolves ./platform-adapter.js; the
// Capacitor bundle ships its own www/game/platform-adapter.js over the top of
// it (see sites/ffm/mobile/game/platform-adapter.js), so the same game code
// runs against either platform.
//
// The interface covers the five things the game needs from a platform:
//   - level access          getAuthorizedLevelConfig / level config cache
//   - score recording       postHighScore / postLevelScore
//   - personal history      getScoreHistory
//   - entitlement           getBillingStatus (premium_access) + billing flow
//   - account/leaderboard   account methods + getLeaderboard + capability flags
//   - personal development  getAccountAvailability + getBestScores +
//                           getCompletedLevels (local data in the app build)

// Every function a platform adapter must provide. These are exactly the
// api.js methods and access-flow.js functions that main.js calls today.
export const API_METHODS = Object.freeze([
  'register',
  'login',
  'logout',
  'refresh',
  'resendVerification',
  'verifyEmail',
  'forgotPassword',
  'resetPassword',
  'confirmEmailChange',
  '_fetch',
  'getProfile',
  'updateProfile',
  'changePassword',
  'changeEmail',
  'deleteAccount',
  'postHighScore',
  'postLevelScore',
  'getLeaderboard',
  'getScoreHistory',
  'getBillingStatus',
  'startCheckout',
  'openBillingPortal',
  'redeemCode',
  'cancelSubscription',
]);

// The personal-development surface behind the title screen. The app reads it
// from the on-device progress store; the web build keeps its server-backed
// leaderboard and reports empty personal data.
export const PERSONAL_METHODS = Object.freeze([
  'getAccountAvailability',
  'getBestScores',
  'getCompletedLevels',
]);

export const ACCESS_FLOW_METHODS = Object.freeze([
  'getAuthorizedLevelConfig',
  'setCurrentLevelConfig',
  'getCurrentLevelConfig',
  'incrementRequestGeneration',
  'isStripeRedirect',
  'validatePendingRecord',
]);

// The app sells the unlock through StoreKit/Play Billing and caches the
// entitlement on device, so it refreshes the cache instead of opening a web
// checkout. The web adapter keeps this a no-op.
export const ENTITLEMENT_METHODS = Object.freeze([
  'refreshEntitlement',
]);

export const PLATFORM_METHODS = Object.freeze([
  ...ACCESS_FLOW_METHODS,
  ...API_METHODS,
  ...PERSONAL_METHODS,
  ...ENTITLEMENT_METHODS,
]);

// localProfiles is null on the web and a local-only profile adapter in the app.
export const PLATFORM_PROPERTIES = Object.freeze(['isLoggedIn', 'username', 'localProfiles']);

// Boolean flags describing what the active platform can do. Game code checks
// these instead of probing the adapter's shape.
export const PLATFORM_CAPABILITIES = Object.freeze(['isApp', 'hasAccount', 'hasLeaderboard']);

/**
 * Throw unless `adapter` implements the whole platform interface.
 * @param {object} adapter
 * @returns {object} the same adapter
 */
export function assertPlatformAdapter(adapter) {
  if (!adapter || typeof adapter !== 'object') {
    throw new TypeError('Platform adapter must be an object');
  }
  for (const name of PLATFORM_METHODS) {
    if (typeof adapter[name] !== 'function') {
      throw new TypeError(`Platform adapter is missing method: ${name}`);
    }
  }
  for (const name of PLATFORM_PROPERTIES) {
    if (!(name in adapter)) {
      throw new TypeError(`Platform adapter is missing property: ${name}`);
    }
  }
  for (const name of PLATFORM_CAPABILITIES) {
    if (typeof adapter[name] !== 'boolean') {
      throw new TypeError(`Platform adapter capability must be a boolean: ${name}`);
    }
    if (adapter.isApp) {
      for (const name of [
        'initialize', 'getActiveProfile', 'listProfiles', 'createProfile', 'selectProfile',
        'renameProfile', 'deleteProfile', 'getBestScores', 'getScoreHistory', 'getCompletedLevels', 'recordLevel',
      ]) {
        if (typeof adapter.localProfiles?.[name] !== 'function') {
          throw new TypeError(`App platform is missing local profile method: ${name}`);
        }
      }
    }
  }
  return adapter;
}

const loadWebAdapter = () => import('./platform-adapter.js');

let resolvedAdapter = null;

/**
 * Resolve the platform adapter for this build.
 *
 * The default loader imports ./platform-adapter.js, which the app bundle
 * replaces with its local-only adapter. Tests pass their own loader to
 * exercise the seam with fakes.
 *
 * @param {() => Promise<object|{default: object}>} [loadAdapter]
 * @returns {Promise<object>} validated platform adapter
 */
export async function resolvePlatform(loadAdapter = loadWebAdapter) {
  if (loadAdapter === loadWebAdapter && resolvedAdapter) return resolvedAdapter;
  const module = await loadAdapter();
  const adapter = assertPlatformAdapter(module?.default ?? module);
  if (loadAdapter === loadWebAdapter) resolvedAdapter = adapter;
  return adapter;
}
