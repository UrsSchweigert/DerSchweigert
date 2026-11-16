// platform-adapter.js — Web platform adapter for Arithmo Slayer.
//
// Keeps today's behaviour exactly by delegating to api.js and access-flow.js;
// the rest of the game talks to this object through platform.js instead of
// importing those modules directly.
import { api } from './api.js';
import {
  getAuthorizedLevelConfig,
  setCurrentLevelConfig,
  getCurrentLevelConfig,
  incrementRequestGeneration,
  isStripeRedirect,
  validatePendingRecord,
} from './access-flow.js';
import { API_METHODS } from './platform.js';

// The latest profile response this session, so the hero needs no extra request.
let cachedProfile = null;

const platform = {
  isApp: false,
  hasAccount: true,
  hasLeaderboard: true,
  localProfiles: null,

  getAuthorizedLevelConfig(levelIndex, includeBaseline = false) {
    return getAuthorizedLevelConfig(levelIndex, api, includeBaseline);
  },

  setCurrentLevelConfig,
  getCurrentLevelConfig,
  incrementRequestGeneration,
  isStripeRedirect,
  validatePendingRecord,

  // The web build keeps its account and server leaderboard; the local
  // personal-development panel is app-only, so its data stays empty here.
  getAccountAvailability() {
    return 'optional';
  },

  async getBestScores() {
    return { best: [] };
  },

  async getCompletedLevels() {
    return { completed: [] };
  },

  // The web build sells access through Stripe checkout, so there is no local
  // entitlement cache to refresh; the app adapter overrides this.
  async refreshEntitlement() {
    return { premium_access: false, source: 'none', offline: false };
  },

  // The account's hero id when premium_access allows it, else null. Never
  // rejects. Logged out makes no request; the profile comes from the latest
  // response already forwarded (one getProfile only when none is cached) and
  // billing is read fresh on each call, only once a hero is stored.
  async getActiveHeroSkin() {
    try {
      if (!api.isLoggedIn) return null;
      const profile = cachedProfile ?? await platform.getProfile();
      const hero = profile?.hero;
      if (typeof hero !== 'string' || hero === '') return null;
      const status = await api.getBillingStatus();
      return api.isLoggedIn && status?.premium_access === true ? hero : null;
    } catch {
      return null;
    }
  },

  postSpeedrunRun(run) {
    return api.postSpeedrunRun(run);
  },

  getSpeedrunRecords() {
    return api.getSpeedrunRecords();
  },

  getSpeedrunLeaderboard() {
    return api.getSpeedrunLeaderboard();
  },

  get isLoggedIn() {
    return api.isLoggedIn;
  },

  get username() {
    return api.username;
  },
};

for (const name of API_METHODS) {
  platform[name] = (...args) => api[name](...args);
}

// Remember the profile response only while its session lasts; a new or ended
// session drops it so one account's hero never reaches the next.
const rememberProfile = (name) => {
  platform[name] = async (...args) => {
    const profile = await api[name](...args);
    cachedProfile = api.isLoggedIn && profile && typeof profile === 'object' ? profile : null;
    return profile;
  };
};
rememberProfile('getProfile');
rememberProfile('updateProfile');
for (const name of ['login', 'logout', 'register']) {
  platform[name] = async (...args) => {
    cachedProfile = null;
    try {
      return await api[name](...args);
    } finally {
      cachedProfile = null;
    }
  };
}

export default platform;
