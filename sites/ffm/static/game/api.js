// api.js — JWT auth + score API client for Arithmo Slayer

import { getLocale } from './i18n.js';
import { readApiJson } from './access-flow.js';

const BASE_URL = window.location.origin + '/api';
let _accessToken = null;
let _sessionEpoch = 0; // Incremented on login/logout to invalidate stale requests

// JWT segments are base64url (RFC 7515: '-' and '_', no padding). atob() only
// takes standard base64 and throws on '-' or '_' (WebKit: "The string did not
// match the expected pattern."), so a token whose payload happened to encode
// to one of them read as no user at all.
export function parseJwt(token) {
  const segment = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(segment + '='.repeat((4 - (segment.length % 4)) % 4));
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

// The account a token belongs to: username plus the immutable stable_id, so a
// deleted and re-registered username is a different identity. 'anonymous' when
// logged out. Unreadable tokens get a key of their own that no other token shares.
function identityKey(token) {
  if (!token) return 'anonymous';
  try {
    const payload = parseJwt(token);
    return 'user:' + JSON.stringify([payload.sub ?? null, payload.stable_id ?? null]);
  } catch {
    return 'token:' + token;
  }
}

// A failure worth riding out on the last good answer: rate limited, server or
// gateway trouble, or no answer at all (offline, DNS, CORS). A 401/403 is not
// one of them: the session itself is in question.
function isTransientFailure(error) {
  const status = error?.status;
  return status === undefined || status === null || status === 429 || status >= 500;
}

/**
 * One shared, in-memory billing status for the web game.
 *
 * The game asks for /billing/status on every title page render, level start,
 * hero lookup, hero picker and Campaign II switch. It is our own endpoint (one
 * DynamoDB read, never a Stripe call), but one request per screen added up to
 * a household tripping the per-IP rate limit, after which the game showed the
 * free version. This keeps one answer per identity for `maxAgeMs` and lets
 * concurrent callers share one request.
 *
 * - Keyed to the identity of the current token: another account never sees
 *   this one's status, and `clear()` (login, logout, account deletion) drops it.
 * - Never stored outside memory: a reload asks the server again.
 * - An error is never cached. A transient failure (see isTransientFailure)
 *   returns the last good status of the same identity while it is younger
 *   than `staleLimitMs`; otherwise the error reaches the caller.
 * - `invalidate()` after anything that changes access (checkout, redeem,
 *   cancel, recover): the next read goes to the server, and a request already
 *   in flight from before is neither shared nor stored.
 * - `fresh: true` skips the stored answer (the Billing tab, a checkout return).
 *
 * The server stays authoritative: paid level configs are still checked by the
 * API on every fetch, whatever this cache says.
 */
export function createBillingStatusCache({
  load, getKey, now = () => Date.now(), maxAgeMs = 5 * 60 * 1000, staleLimitMs = 30 * 60 * 1000,
}) {
  let entry = null;      // { key, status, at: fresh-from time (reset by invalidate), fetchedAt }
  let inflight = null;   // { key, generation, promise }
  let generation = 0;

  function invalidate() {
    generation++;
    inflight = null;
    if (entry) entry = { ...entry, at: -Infinity };   // kept only as a stale-while-error fallback
  }

  return {
    async get({ fresh = false } = {}) {
      const key = getKey();
      if (entry && entry.key !== key) entry = null;
      if (!fresh && entry && now() - entry.at < maxAgeMs) return entry.status;
      if (inflight && inflight.key === key && inflight.generation === generation) return inflight.promise;

      const started = generation;
      const fallback = entry;
      const request = { key, generation: started, promise: null };
      request.promise = (async () => {
        try {
          const status = await load();
          if (generation === started && getKey() === key) entry = { key, status, at: now(), fetchedAt: now() };
          return status;
        } catch (error) {
          const usable = fallback && fallback.key === key && getKey() === key
            && now() - fallback.fetchedAt < staleLimitMs;
          if (isTransientFailure(error) && usable) return fallback.status;
          throw error;
        } finally {
          if (inflight === request) inflight = null;
        }
      })();
      inflight = request;
      return request.promise;
    },

    invalidate,

    /** Drops the status entirely: a new session must never see the last one's. */
    clear() {
      invalidate();
      entry = null;
    },

    /** Invalidates when the stored answer is older than `ms` (a tab coming back). */
    expireOlderThan(ms) {
      if (entry && now() - entry.at >= ms) invalidate();
    },
  };
}

export const api = {
  async register(username, email, password, firstGradeYear, turnstileToken) {
    const payload = { username, email, password, turnstile_token: turnstileToken, locale: getLocale() };
    if (firstGradeYear !== null && firstGradeYear !== undefined && firstGradeYear !== '') {
      payload.first_grade_year = Number(firstGradeYear);
    }
    const res = await fetch(BASE_URL + '/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Registration failed');
    }
    // NOTE: no longer sets _accessToken — registering does not log the user in.
    // Caller (main.js) must show a "check your email" message instead of proceeding.
    return data; // { message, user: { username } }
  },

  async login(username, password) {
    const epoch = ++_sessionEpoch;
    const res = await fetch(BASE_URL + '/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Login failed');
    }
    if (epoch !== _sessionEpoch) throw new Error('Session changed during login. Please try again.');
    _accessToken = data.access_token;
    billingStatusCache.clear();
    return data;
  },

  async logout() {
    _sessionEpoch++;
    _accessToken = null;
    billingStatusCache.clear();
    await fetch(BASE_URL + '/auth/logout', {
      method: 'POST',
      credentials: 'include'
    });
    _accessToken = null;
  },

  async refresh() {
    const epoch = _sessionEpoch;
    try {
      const res = await fetch(BASE_URL + '/auth/refresh', {
        method: 'POST',
        credentials: 'include'
      });
      if (res.ok) {
        const data = await res.json();
        if (epoch !== _sessionEpoch) return false;
        _accessToken = data.access_token;
        return true;
      }
      if (epoch === _sessionEpoch) _accessToken = null;
      return false;
    } catch (err) {
      if (epoch === _sessionEpoch) _accessToken = null;
      return false;
    }
  },

  async resendVerification(email, turnstileToken) {
    const res = await fetch(BASE_URL + '/auth/resend-verification', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, turnstile_token: turnstileToken, locale: getLocale() })
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Failed to resend verification email');
    }
    return data;
  },

  async verifyEmail(token) {
    const res = await fetch(BASE_URL + '/auth/verify-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token })
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Verification failed');
    }
    return data;
  },

  async forgotPassword(email, turnstileToken) {
    const res = await fetch(BASE_URL + '/auth/forgot-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, turnstile_token: turnstileToken, locale: getLocale() })
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Failed to send reset email');
    }
    return data;
  },

  async resetPassword(token, newPassword) {
    const res = await fetch(BASE_URL + '/auth/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, new_password: newPassword })
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Password reset failed');
    }
    return data;
  },

  async confirmEmailChange(token) {
    const res = await fetch(BASE_URL + '/auth/confirm-email-change', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token })
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Could not confirm email change');
    }
    return data;
  },

  async _fetch(path, options = {}) {
    const requestEpoch = _sessionEpoch;

    if (_accessToken && requestEpoch === _sessionEpoch) {
      options.headers = { ...options.headers, 'Authorization': 'Bearer ' + _accessToken };
    }

    // Add cache control if not already present
    if (!options.headers?.['Cache-Control']) {
      options.headers = { ...options.headers, 'Cache-Control': 'no-store' };
    }

    let res = await fetch(BASE_URL + path, { credentials: 'include', ...options });

    // Checkout, portal, redeem, cancel and recover can all change access, and
    // so can deleting the account: whatever the outcome, the stored status is
    // no longer to be trusted.
    const method = (options.method || 'GET').toUpperCase();
    if (method !== 'GET' && (path.startsWith('/billing/') || (path === '/profile' && method === 'DELETE'))) {
      billingStatusCache.invalidate();
    }

    // If session epoch changed (login/logout), don't retry with stale token
    if (res.status === 401 && !options._retried && requestEpoch === _sessionEpoch) {
      const ok = await this.refresh();
      if (ok && requestEpoch === _sessionEpoch) {
        return this._fetch(path, { ...options, _retried: true });
      }
    }
    return res;
  },

  async getProfile() {
    const res = await this._fetch('/profile');
    return res.json();
  },

  // updateProfile(year) keeps the legacy one-argument call; updateProfile({ firstGradeYear, hero })
  // sends only the keys that are present.
  async updateProfile(arg) {
    let payload;
    if (arg !== null && typeof arg === 'object') {
      payload = {};
      if ('firstGradeYear' in arg) payload.first_grade_year = arg.firstGradeYear;
      if ('hero' in arg) payload.hero = arg.hero;
    } else {
      payload = { first_grade_year: arg };
    }
    const res = await this._fetch('/profile', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    return res.json();
  },

  async changePassword(currentPassword, newPassword) {
    const res = await this._fetch('/profile/password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ current_password: currentPassword, new_password: newPassword })
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Failed to change password');
    }
    return data;
  },

  async changeEmail(newEmail, currentPassword) {
    const res = await this._fetch('/profile/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ new_email: newEmail, current_password: currentPassword, locale: getLocale() })
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Failed to update email');
    }
    return data;
  },

  async deleteAccount(currentPassword) {
    const res = await this._fetch('/profile', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ current_password: currentPassword })
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Failed to delete account');
    }
    _sessionEpoch++;
    _accessToken = null;
    billingStatusCache.clear();
    return data;
  },

  async postHighScore(score, level) {
    const res = await this._fetch('/high-score', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ score, level })
    });
    return res.json();
  },

  async postLevelScore(level, score, difficulty) {
    const res = await this._fetch('/score', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ level, score, difficulty })
    });
    return res.json();
  },

  async getLeaderboard(firstGradeYear) {
    const path = firstGradeYear ? '/leaderboard?first_grade_year=' + firstGradeYear : '/leaderboard';
    const res = await this._fetch(path);
    return res.json();
  },

  async getScoreHistory() {
    const res = await this._fetch('/profile/score-history');
    return res.json();
  },

  /** Report a finished continuous run: `{ total_ms, splits: [{ level, ms }] }`. */
  async postSpeedrunRun(run) {
    const res = await this._fetch('/speedrun/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(run)
    });
    return res.json();
  },

  async getSpeedrunRecords() {
    const res = await this._fetch('/speedrun/records');
    return res.json();
  },

  async getSpeedrunLeaderboard() {
    const res = await this._fetch('/speedrun/leaderboard');
    return res.json();
  },

  async getLevel(n, includeBaseline = false) {
    const params = new URLSearchParams();
    if (includeBaseline) params.append('include_baseline', '1');
    const path = '/levels/' + n + (params.size > 0 ? '?' + params.toString() : '');
    const res = await this._fetch(path, {
      headers: { 'Cache-Control': 'no-store' }
    });
    const data = await readApiJson(res);
    if (!res.ok) {
      const err = new Error(data.error || 'Failed to fetch level');
      err.status = res.status;
      err.payload = data;
      throw err;
    }
    return data;
  },

  // The shared, cached status (see createBillingStatusCache). `fresh: true`
  // asks the server even when a recent answer is stored.
  getBillingStatus({ fresh = false } = {}) {
    return billingStatusCache.get({ fresh });
  },

  // Forget the stored status: the next read asks the server.
  invalidateBillingStatus() {
    billingStatusCache.invalidate();
  },

  // The tab came back to the foreground: an answer older than `ms` is re-read.
  expireBillingStatus(ms) {
    billingStatusCache.expireOlderThan(ms);
  },

  async _loadBillingStatus() {
    const res = await this._fetch('/billing/status', {
      headers: { 'Cache-Control': 'no-store' }
    });
    const data = await readApiJson(res);
    if (!res.ok) {
      const err = new Error(data.error || 'Failed to fetch billing status');
      err.status = res.status;
      err.payload = data;
      throw err;
    }
    return data;
  },

  async startCheckout(adultConfirmed, termsAccepted, declarations) {
    const res = await this._fetch('/billing/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        adult_confirmed: adultConfirmed,
        terms_accepted: termsAccepted,
        declarations_version: declarations.version,
        declarations_language: declarations.language,
        immediate_access_confirmed: declarations.immediateAccessConfirmed,
        withdrawal_waiver_confirmed: declarations.withdrawalWaiverConfirmed
      })
    });
    const data = await res.json();
    if (!res.ok) {
      const err = new Error(data.error || 'Checkout failed');
      err.status = res.status;
      err.payload = data;
      throw err;
    }
    return data;
  },

  async openBillingPortal() {
    const res = await this._fetch('/billing/portal', {
      method: 'POST'
    });
    let data;
    try {
      data = await res.json();
    } catch (cause) {
      if (!(cause instanceof SyntaxError)) throw cause;
      const error = new Error('portal_unavailable', { cause });
      error.status = res.status;
      throw error;
    }
    if (!res.ok) {
      const err = new Error(data.error || 'Failed to open billing portal');
      err.status = res.status;
      err.payload = data;
      throw err;
    }
    return data;
  },

  async redeemCode(code) {
    const res = await this._fetch('/billing/redeem', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code })
    });
    const data = await res.json();
    if (!res.ok) {
      const err = new Error(data.error || 'Failed to redeem code');
      err.status = res.status;
      err.payload = data;
      throw err;
    }
    return data;
  },

  async cancelSubscription() {
    const res = await this._fetch('/billing/cancel', {
      method: 'POST'
    });
    const data = await res.json();
    if (!res.ok) {
      const err = new Error(data.error || 'Failed to cancel subscription');
      err.status = res.status;
      err.payload = data;
      throw err;
    }
    return data;
  },

  get isLoggedIn() {
    return _accessToken !== null;
  },

  get username() {
    if (!_accessToken) return null;
    try {
      const payload = parseJwt(_accessToken);
      return payload.username || payload.sub;
    } catch {
      return null;
    }
  }
};

const billingStatusCache = createBillingStatusCache({
  load: () => api._loadBillingStatus(),
  getKey: () => identityKey(_accessToken),
});
