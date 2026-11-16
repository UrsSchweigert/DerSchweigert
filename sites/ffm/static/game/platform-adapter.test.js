import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

globalThis.window = { location: { origin: 'https://game.example' } };

// Scripted server: every request lands in `requests`.
let requests;
let profileBody;
let billingBody;
let failing;
globalThis.fetch = async (url, options = {}) => {
  const path = String(url).replace('https://game.example/api', '');
  requests.push(path);
  if (failing) throw new Error('network down');
  const body = path === '/auth/login' ? { access_token: header() }
    : path === '/profile' ? profileBody
    : path === '/billing/status' ? billingBody : {};
  return { ok: true, status: 200, json: async () => body };
};
const header = () => {
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${enc({ alg: 'none' })}.${enc({ username: 'kid', exp: 4e9 })}.sig`;
};

const { default: platform } = await import('./platform-adapter.js');
const count = (path) => requests.filter((p) => p === path).length;

describe('web getActiveHeroSkin', () => {
  beforeEach(async () => {
    failing = false;
    profileBody = { hero: 'knight' };
    billingBody = { premium_access: true };
    requests = [];
    await platform.logout().catch(() => {});
    requests = [];
  });

  it('resolves null without any request when logged out', async () => {
    assert.equal(await platform.getActiveHeroSkin(), null);
    assert.deepEqual(requests, []);
  });

  it('gives null for a free account', async () => {
    await platform.login('kid', 'pw');
    billingBody = { premium_access: false };
    assert.equal(await platform.getActiveHeroSkin(), null);
  });

  it('gives the hero for a premium account and reads the profile once', async () => {
    await platform.login('kid', 'pw');
    assert.equal(await platform.getActiveHeroSkin(), 'knight');
    assert.equal(await platform.getActiveHeroSkin(), 'knight');
    assert.equal(count('/profile'), 1);
    assert.equal(count('/billing/status'), 2);
  });

  it('skips billing when no hero is stored', async () => {
    await platform.login('kid', 'pw');
    profileBody = { hero: null };
    assert.equal(await platform.getActiveHeroSkin(), null);
    assert.equal(count('/billing/status'), 0);
  });

  it('uses the profile the adapter already forwarded', async () => {
    await platform.login('kid', 'pw');
    profileBody = { hero: 'mage' };
    await platform.updateProfile({ hero: 'mage' });
    requests = [];
    assert.equal(await platform.getActiveHeroSkin(), 'mage');
    assert.equal(count('/profile'), 0);
  });

  it('gives null once premium has ended', async () => {
    await platform.login('kid', 'pw');
    assert.equal(await platform.getActiveHeroSkin(), 'knight');
    billingBody = { premium_access: false };
    assert.equal(await platform.getActiveHeroSkin(), null);
  });

  it('resolves null when a request fails', async () => {
    await platform.login('kid', 'pw');
    failing = true;
    assert.equal(await platform.getActiveHeroSkin(), null);
  });

  it('forgets the profile on logout', async () => {
    await platform.login('kid', 'pw');
    await platform.getActiveHeroSkin();
    await platform.logout();
    await platform.login('kid', 'pw');
    profileBody = { hero: 'mage' };
    assert.equal(await platform.getActiveHeroSkin(), 'mage');
  });
});
