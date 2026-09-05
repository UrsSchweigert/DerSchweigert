// api.js — JWT auth + score API client for Arithmo Slayer

const BASE_URL = window.location.origin + '/api';
let _accessToken = null;

function parseJwt(token) {
  return JSON.parse(atob(token.split('.')[1]));
}

export const api = {
  async register(username, email, password, firstGradeYear) {
    const payload = { username, email, password };
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
    _accessToken = data.access_token;
    return data;
  },

  async logout() {
    await fetch(BASE_URL + '/auth/logout', {
      method: 'POST',
      credentials: 'include'
    });
    _accessToken = null;
  },

  async refresh() {
    try {
      const res = await fetch(BASE_URL + '/auth/refresh', {
        method: 'POST',
        credentials: 'include'
      });
      if (res.ok) {
        const data = await res.json();
        _accessToken = data.access_token;
        return true;
      }
      _accessToken = null;
      return false;
    } catch (err) {
      _accessToken = null;
      return false;
    }
  },

  async resendVerification(email) {
    const res = await fetch(BASE_URL + '/auth/resend-verification', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
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

  async forgotPassword(email) {
    const res = await fetch(BASE_URL + '/auth/forgot-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
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
    if (_accessToken) {
      options.headers = { ...options.headers, 'Authorization': 'Bearer ' + _accessToken };
    }
    let res = await fetch(BASE_URL + path, { credentials: 'include', ...options });
    if (res.status === 401 && !options._retried) {
      const ok = await this.refresh();
      if (ok) {
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
      body: JSON.stringify({ new_email: newEmail, current_password: currentPassword })
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Failed to update email');
    }
    return data;
  },

  async postHighScore(score) {
    const res = await this._fetch('/high-score', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ score })
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
