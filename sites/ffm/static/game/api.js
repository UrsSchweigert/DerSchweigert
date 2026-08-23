// api.js — JWT auth + score API client for Arithmo Slayer

const BASE_URL = window.location.origin + '/api';
let _accessToken = null;

function parseJwt(token) {
  return JSON.parse(atob(token.split('.')[1]));
}

export const api = {
  async register(username, email, password) {
    const res = await fetch(BASE_URL + '/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ username, email, password })
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Registration failed');
    }
    _accessToken = data.access_token;
    return data;
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

  async postScore(level, score, difficulty) {
    const res = await this._fetch('/score', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ level, score, difficulty })
    });
    return res.json();
  },

  async getLeaderboard(level) {
    const path = level ? '/leaderboard?level=' + level : '/leaderboard';
    const res = await this._fetch(path);
    return res.json();
  },

  get isLoggedIn() {
    return _accessToken !== null;
  },

  get username() {
    if (!_accessToken) return null;
    try {
      return parseJwt(_accessToken).sub;
    } catch {
      return null;
    }
  }
};
