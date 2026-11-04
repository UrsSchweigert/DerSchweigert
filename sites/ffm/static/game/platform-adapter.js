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

const platform = {
  isApp: false,
  hasAccount: true,
  hasLeaderboard: true,

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

export default platform;
