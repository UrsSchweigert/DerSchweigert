// platform-adapter.js — App platform adapter (local-only stub) for Arithmo Slayer.
//
// The Capacitor bundle copies this file over www/game/platform-adapter.js, so
// the game resolves it through platform.js like any other adapter. It is
// deliberately local: no api.js or access-flow.js import, no fetch or other
// network call, and no Stripe, account or leaderboard code path. Progress and
// the store entitlement live on the device (./progress-store.js,
// ./entitlement.js); purchases go through the native store (./purchase.js).
//
// The app lifecycle seam (pause/resume, Android back, keep-awake) lives in
// ./lifecycle.js and is wired by main.js inside its platform.isApp branch.
import { createPreferencesBackend, createProgressStore } from './progress-store.js';
import { createPurchasesPlugin } from './purchase.js';
import { createEntitlementStore } from './entitlement.js';

// Progress and the entitlement cache share the Capacitor Preferences store.
const progress = createProgressStore(createPreferencesBackend());
const purchases = createPurchasesPlugin();
const entitlement = createEntitlementStore({
  backend: createPreferencesBackend(),
  getPurchases: () => purchases.getPurchases(),
});

// level-data.js is generated into www/ at build time, so premium configs are
// imported lazily and only once the cached entitlement allows them.
let levelConfigsPromise = null;
const loadLevelConfigs = () => {
  if (!levelConfigsPromise) {
    levelConfigsPromise = import('./level-data.js')
      .then((module) => module.LevelConfig ?? null)
      .catch(() => null);
  }
  return levelConfigsPromise;
};

export class PlatformUnavailableError extends Error {
  constructor(feature) {
    super(`${feature} is not available in the app build`);
    this.name = 'PlatformUnavailableError';
    this.code = 'platform_unavailable';
    this.feature = feature;
  }
}

// Mirrors LevelConfig[0..1] in sites/ffm/static/game/levels.js; platform.test.js
// fails if the two drift apart. Levels 3-60 stay locked until a store
// entitlement exists.
const FREE_LEVELS = Object.freeze([
  { level: 1, chapter: 1, chapterName: 'Grade 1 Foundations', operations: ['+'],
    operandRange: { a: [1, 5], b: [1, 5] }, maxResult: 10,
    fiendType: 'slimeling', fiendHP: 1, waveSize: 30, inputMode: 'multiple-choice' },
  { level: 2, chapter: 1, chapterName: 'Grade 1 Foundations', operations: ['+'],
    operandRange: { a: [1, 6], b: [1, 6] }, maxResult: 12,
    fiendType: 'bonehead', fiendHP: 1, waveSize: 30, inputMode: 'multiple-choice' },
]);

// Web-shaped billing fields the app merges the cached entitlement status into.
const NOT_ENTITLED = Object.freeze({
  access_control_enabled: true,
  premium_access: false,
  reason: 'not_entitled',
  access_until: null,
  paid_until: null,
  gift_until: null,
  subscription_id: null,
  subscription_status: null,
  cancel_at_period_end: false,
  next_payment_at: null,
  can_checkout: false,
});

const UNAVAILABLE = Object.freeze({
  register: 'Account registration',
  login: 'Account login',
  logout: 'Account logout',
  refresh: 'Session refresh',
  resendVerification: 'Email verification',
  verifyEmail: 'Email verification',
  forgotPassword: 'Password reset',
  resetPassword: 'Password reset',
  confirmEmailChange: 'Email change',
  getProfile: 'Account profile',
  updateProfile: 'Account profile',
  changePassword: 'Account profile',
  changeEmail: 'Account profile',
  deleteAccount: 'Account deletion',
  _fetch: 'Network access',
  startCheckout: 'Purchases',
  openBillingPortal: 'Billing management',
  redeemCode: 'Redeem codes',
  cancelSubscription: 'Subscription management',
});

let currentLevelConfig = null;
let requestGeneration = 0;

const platform = {
  isApp: true,
  hasAccount: false,
  hasLeaderboard: false,
  isLoggedIn: false,
  username: null,

  // Levels 1-2 are always free. Every other level needs the cached store
  // entitlement and, once entitled, its generated config. includeBaseline
  // stays unsupported: the app has no level-jump UI, and main.js treats a
  // missing baseline_score as 0.
  async getAuthorizedLevelConfig(levelIndex) {
    if (Number.isInteger(levelIndex) && levelIndex >= 0 && levelIndex < FREE_LEVELS.length) {
      return FREE_LEVELS[levelIndex];
    }
    if (!(await entitlement.getStatus()).premium_access) {
      const error = new PlatformUnavailableError(`Level ${levelIndex + 1} requires an entitlement`);
      error.code = 'entitlement_required';
      error.statusCode = 402;
      throw error;
    }
    const configs = await loadLevelConfigs();
    const cfg = Array.isArray(configs) ? configs[levelIndex] : null;
    if (!cfg) {
      const error = new PlatformUnavailableError(`Level ${levelIndex + 1} config is unavailable`);
      error.statusCode = 404;
      throw error;
    }
    return cfg;
  },

  setCurrentLevelConfig(config) {
    currentLevelConfig = config;
  },

  getCurrentLevelConfig() {
    return currentLevelConfig;
  },

  incrementRequestGeneration() {
    requestGeneration++;
  },

  isStripeRedirect() {
    return false;
  },

  validatePendingRecord(record) {
    return record && Number.isInteger(record.levelIndex) && record.levelIndex >= 0 && record.levelIndex < 60
      && Number.isSafeInteger(record.score) && record.score >= 0
      && ['easy', 'medium', 'hard'].includes(record.difficulty)
      && Number.isFinite(record.timerMax) && record.timerMax > 0 && record.timerMax <= 60
      && Number.isInteger(record.maxHearts) && record.maxHearts >= 1 && record.maxHearts <= 20;
  },

  // The app keeps per-level bests instead of one high score, so the web
  // leaderboard's high-score call stays a no-op that never fails gameplay.
  async postHighScore() {
    return { saved: false };
  },

  // A cleared level is recorded locally: the per-level best, the timestamped
  // history behind the title-screen chart and the completed set. `saved`
  // reports a new personal best, matching the web score endpoint.
  async postLevelScore(level, score, difficulty) {
    const best = await progress.writeBestScore(level, score, difficulty);
    await progress.appendHistory({ level, score, difficulty });
    await progress.markCompleted(level);
    return { saved: best.saved };
  },

  async getScoreHistory() {
    return { history: await progress.readHistory() };
  },

  // The app has no account: the title screen renders the local
  // personal-development panel instead of the web leaderboard.
  getAccountAvailability() {
    return 'none';
  },

  async getBestScores() {
    return { best: await progress.readBestScores() };
  },

  async getCompletedLevels() {
    return { completed: await progress.readCompletedLevels() };
  },

  async getLeaderboard() {
    return [];
  },

  // Billing is the cached store entitlement, not a subscription.
  async getBillingStatus() {
    return { ...NOT_ENTITLED, ...(await entitlement.getStatus()) };
  },

  // Refresh the entitlement from the store on launch and on resume; keeps the
  // cache when the store is unreachable (offline).
  async refreshEntitlement() {
    return entitlement.refresh();
  },
};

for (const [name, feature] of Object.entries(UNAVAILABLE)) {
  platform[name] = async () => {
    throw new PlatformUnavailableError(feature);
  };
}

export default platform;
