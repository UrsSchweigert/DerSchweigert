// api.js — JWT auth + score API client for Arithmo Slayer

import { getLocale } from './i18n.js';

const BASE_URL = window.location.origin + '/api';
let _accessToken = null;
let _sessionEpoch = 0; // Incremented on login/logout to invalidate stale requests

function parseJwt(token) {
  return JSON.parse(atob(token.split('.')[1]));
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
    return data;
  },

  async logout() {
    _sessionEpoch++;
    _accessToken = null;
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

  async updateProfile(firstGradeYear) {
    const res = await this._fetch('/profile', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ first_grade_year: firstGradeYear })
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
    const data = await res.json();
    if (!res.ok) {
      const err = new Error(data.error || 'Failed to fetch level');
      err.status = res.status;
      err.payload = data;
      throw err;
    }
    return data;
  },

  async getBillingStatus() {
    const res = await this._fetch('/billing/status', {
      headers: { 'Cache-Control': 'no-store' }
    });
    const data = await res.json();
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
