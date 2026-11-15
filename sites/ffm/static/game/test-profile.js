// test-profile.js — the level-testing hatch for the app build.
//
// Jumping into level 47 to look at its storm used to mean clearing 46 levels
// first. A local profile literally named "unlocked" is the way in: on a device
// whose unlock is paid for, that profile's Levels page offers every curriculum
// level instead of only the cleared ones and the next one.
//
// Two gates keep it from being a way around the store: the app build only (the
// website has no profiles to name) and a cached paid entitlement. Without the
// entitlement the extra tiles would only lead to the paywall, because
// getAuthorizedLevelConfig still refuses level 3 and up.

/** The profile name that unlocks every level on the Levels page. */
export const TEST_PROFILE_NAME = 'unlocked';

/**
 * Does this local profile get every level on the Levels page?
 *
 * @param {object} options
 * @param {boolean} [options.isApp] app build, not the website
 * @param {string|null|undefined} [options.profileName] the active local profile's name
 * @param {boolean} [options.premiumAccess] cached store entitlement
 * @returns {boolean}
 */
export function isLevelTestProfile({ isApp = false, profileName = null, premiumAccess = false } = {}) {
  if (!isApp || premiumAccess !== true) return false;
  if (typeof profileName !== 'string') return false;
  // Case and surrounding whitespace are the player's typing, not a different
  // profile: "Unlocked " is the same instruction.
  return profileName.trim().toLowerCase() === TEST_PROFILE_NAME;
}

/**
 * The levels the Levels page offers: the cleared ones as usual, or every level
 * for a test profile.
 *
 * @param {object} options
 * @param {boolean} options.testProfile
 * @param {number[]} options.cleared levels already finished
 * @param {number} options.total curriculum size
 * @returns {number[]}
 */
export function levelAvailability({ testProfile = false, cleared = [], total = 0 } = {}) {
  if (!testProfile) return cleared;
  const count = Math.max(0, Number(total) || 0);
  return Array.from({ length: count }, (_, index) => index + 1);
}
