// access-flow.js — Premium access control & billing flow for Arithmo Slayer

export const ACCESS_CONTROL = {
  ENABLED: false, // Set by backend via environment when live
};

let currentLevelConfig = null;
let currentBillingStatus = null;
let requestGenerationCounter = 0; // Prevents stale configs after logout/restart

export class AccessFlowError extends Error {
  constructor(message, statusCode = null, payload = null) {
    super(message);
    this.name = 'AccessFlowError';
    this.statusCode = statusCode;
    this.payload = payload;
  }
}

/**
 * Fetch the level configuration for a specific level (1-60).
 * For levels 1-2 (free), returns config without calling backend.
 * For levels 3-60 (premium), requires authorization and calls backend.
 *
 * @param {number} levelIndex - 0-based level index
 * @param {object} api - API client with _fetch method
 * @param {boolean} includeBaseline - Whether to request baseline_score in response
 * @returns {Promise<object>} Level config with raw shape from backend (or free fallback)
 * @throws {AccessFlowError} On 401/402/403 with status and payload
 */
export async function getAuthorizedLevelConfig(levelIndex, api, includeBaseline = false) {
  const level = levelIndex + 1;

  // Level 1-2 are free — return from LevelConfig directly
  if (level <= 2) {
    const { LevelConfig } = await import('./levels.js');
    const cfg = LevelConfig[levelIndex];
    if (!cfg) throw new AccessFlowError(`Level ${level} config not found`, 404);

    // For baseline jump, compute it locally if requested
    if (includeBaseline) {
      const { computeDragonPathBaselineScore } = await import('./level-baseline-score.js');
      const { LevelConfig: LevelCfg } = await import('./levels.js');
      const baseline = computeDragonPathBaselineScore(level, LevelCfg);
      return { ...cfg, baseline_score: baseline };
    }
    return cfg;
  }

  // Levels 3-60 require premium authorization
  const params = new URLSearchParams();
  if (includeBaseline) params.append('include_baseline', '1');

  const path = `/levels/${level}${params.size > 0 ? '?' + params.toString() : ''}`;
  const res = await api._fetch(path, {
    headers: { 'Cache-Control': 'no-store' }
  });

  const data = await res.json();

  if (res.status === 401) {
    throw new AccessFlowError('Authentication required', 401, data);
  }
  if (res.status === 402) {
    throw new AccessFlowError('payment_required', 402, data);
  }
  if (res.status === 403) {
    throw new AccessFlowError('Access denied', 403, data);
  }
  if (!res.ok) {
    throw new AccessFlowError(data.error || 'Failed to fetch level config', res.status, data);
  }

  return data;
}

/**
 * Fetch current billing status (anonymous allowed before AUTH_CONTROL_ENABLED).
 *
 * @param {object} api - API client with _fetch method
 * @returns {Promise<object>} Billing status object
 * @throws {AccessFlowError} On network error with status and payload
 */
export async function getBillingStatus(api) {
  const res = await api._fetch('/billing/status', {
    headers: { 'Cache-Control': 'no-store' }
  });

  const data = await res.json();

  if (!res.ok) {
    throw new AccessFlowError(data.error || 'Failed to fetch billing status', res.status, data);
  }

  currentBillingStatus = data;
  return data;
}

/**
 * Initiate a checkout session for premium subscription.
 * Returns redirect URL to Stripe checkout.
 *
 * @param {object} api - API client with _fetch method
 * @param {object} options - { adult_confirmed, terms_accepted }
 * @returns {Promise<object>} { redirect_url: 'https://...' }
 * @throws {AccessFlowError} On 401/402/403 or network error
 */
export async function startCheckout(api, options) {
  const res = await api._fetch('/billing/checkout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      adult_confirmed: options.adult_confirmed || false,
      terms_accepted: options.terms_accepted || false,
    })
  });

  const data = await res.json();

  if (res.status === 401) {
    throw new AccessFlowError('Authentication required', 401, data);
  }
  if (res.status === 402) {
    throw new AccessFlowError('payment_required', 402, data);
  }
  if (res.status === 403) {
    throw new AccessFlowError('Access denied', 403, data);
  }
  if (!res.ok) {
    throw new AccessFlowError(data.error || 'Checkout failed', res.status, data);
  }

  return data; // { redirect_url }
}

/**
 * Open the Stripe billing portal for subscription management.
 *
 * @param {object} api - API client with _fetch method
 * @returns {Promise<object>} { redirect_url: 'https://...' }
 * @throws {AccessFlowError} On 401 or network error
 */
export async function openBillingPortal(api) {
  const res = await api._fetch('/billing/portal', {
    method: 'POST'
  });

  const data = await res.json();

  if (res.status === 401) {
    throw new AccessFlowError('Authentication required', 401, data);
  }
  if (!res.ok) {
    throw new AccessFlowError(data.error || 'Failed to open billing portal', res.status, data);
  }

  return data; // { redirect_url }
}

/**
 * Redeem a code (founding player, etc.) for account access.
 *
 * @param {object} api - API client with _fetch method
 * @param {string} code - Redemption code
 * @returns {Promise<object>} Access object
 * @throws {AccessFlowError} On 401/402/403 or invalid code
 */
export async function redeemCode(api, code) {
  const res = await api._fetch('/billing/redeem', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code })
  });

  const data = await res.json();

  if (res.status === 401) {
    throw new AccessFlowError('Authentication required', 401, data);
  }
  if (res.status === 402) {
    throw new AccessFlowError('payment_required', 402, data);
  }
  if (res.status === 403) {
    throw new AccessFlowError('Access denied', 403, data);
  }
  if (!res.ok) {
    throw new AccessFlowError(data.error || 'Failed to redeem code', res.status, data);
  }

  return data; // { access: { ... } }
}

/**
 * Cancel subscription (authorized only).
 *
 * @param {object} api - API client with _fetch method
 * @returns {Promise<object>} Access object after cancellation
 * @throws {AccessFlowError} On 401 or network error
 */
export async function cancelSubscription(api) {
  const res = await api._fetch('/billing/cancel', {
    method: 'POST'
  });

  const data = await res.json();

  if (res.status === 401) {
    throw new AccessFlowError('Authentication required', 401, data);
  }
  if (!res.ok) {
    throw new AccessFlowError(data.error || 'Failed to cancel subscription', res.status, data);
  }

  return data; // { access: { ... } }
}

export function setCurrentLevelConfig(config) {
  currentLevelConfig = config;
}

export function getCurrentLevelConfig() {
  return currentLevelConfig;
}

export function getBillingStatusCache() {
  return currentBillingStatus;
}

export function setBillingStatusCache(status) {
  currentBillingStatus = status;
}

export function getRequestGeneration() {
  return requestGenerationCounter;
}

export function incrementRequestGeneration() {
  requestGenerationCounter++;
}

export function clearRequestGeneration() {
  requestGenerationCounter = 0;
}

export function isStripeRedirect(value, hostname) {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === hostname && !url.username && !url.password;
  } catch (error) {
    if (error instanceof TypeError) return false;
    throw error;
  }
}

export function validatePendingRecord(record) {
  return record && Number.isInteger(record.levelIndex) && record.levelIndex >= 0 && record.levelIndex < 60
    && Number.isSafeInteger(record.score) && record.score >= 0
    && ['easy', 'medium', 'hard'].includes(record.difficulty)
    && Number.isFinite(record.timerMax) && record.timerMax > 0 && record.timerMax <= 60
    && Number.isInteger(record.maxHearts) && record.maxHearts >= 1 && record.maxHearts <= 20;
}
