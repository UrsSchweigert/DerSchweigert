// billing-status-cache.test.js — the web game's shared billing status: one request per
// identity and max age, shared by concurrent callers, dropped on every change of session
// or access, never an error cached as "free", and never one account's answer for another.
import { test } from 'node:test';
import assert from 'node:assert/strict';

globalThis.window = { location: { origin: 'http://x' } };

const b64url = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
const tokenFor = (sub, stableId = sub + '-id', extra = {}) =>
  `${b64url({ alg: 'HS256' })}.${b64url({ sub, stable_id: stableId, typ: 'access', ...extra })}.sig`;

// A tiny fake API: each route answers from `routes`; every request is logged.
const log = [];
const routes = {};
globalThis.fetch = async (url, opts = {}) => {
  const path = new URL(url).pathname.replace(/^\/api/, '');
  const method = (opts.method || 'GET').toUpperCase();
  const auth = opts.headers?.Authorization ?? null;
  log.push({ method, path, auth });
  const handler = routes[`${method} ${path}`];
  if (!handler) return new Response(JSON.stringify({ error: 'not_found' }), { status: 404 });
  return handler({ auth, opts });
};
const json = (status, body) => new Response(JSON.stringify(body), { status });
const statusCalls = () => log.filter((entry) => entry.path === '/billing/status');

const { api, createBillingStatusCache, parseJwt } = await import('./api.js');

let premiumFor = {};   // token -> status answered by GET /billing/status
routes['GET /billing/status'] = ({ auth }) => {
  const token = auth?.replace('Bearer ', '');
  return json(200, premiumFor[token] ?? { premium_access: false, reason: 'free' });
};
const login = async (token) => {
  routes['POST /auth/login'] = () => json(200, { access_token: token });
  await api.login('x', 'y');
};
routes['POST /auth/logout'] = () => json(200, { ok: true });

function reset() {
  log.length = 0;
  premiumFor = {};
}

// --- The cache on its own, with a controlled clock -------------------------------------

function harness({ maxAgeMs = 1000, staleLimitMs = 5000 } = {}) {
  let clock = 0;
  let key = 'user:a';
  const loads = [];
  const cache = createBillingStatusCache({
    load: () => new Promise((resolve, reject) => loads.push({ resolve, reject })),
    getKey: () => key,
    now: () => clock,
    maxAgeMs,
    staleLimitMs,
  });
  return {
    cache, loads,
    tick: (ms) => { clock += ms; },
    setKey: (k) => { key = k; },
    settle: async (value) => { loads.at(-1).resolve(value); await Promise.resolve(); },
  };
}

test('concurrent callers share one request', async () => {
  const h = harness();
  const calls = [h.cache.get(), h.cache.get(), h.cache.get()];
  assert.equal(h.loads.length, 1);
  h.loads[0].resolve({ premium_access: true });
  for (const status of await Promise.all(calls)) assert.equal(status.premium_access, true);
});

test('an answer is reused until it is older than the max age', async () => {
  const h = harness({ maxAgeMs: 1000 });
  const first = h.cache.get();
  h.loads[0].resolve({ n: 1 });
  await first;
  h.tick(999);
  assert.deepEqual(await h.cache.get(), { n: 1 });
  assert.equal(h.loads.length, 1);
  h.tick(1);
  const second = h.cache.get();
  assert.equal(h.loads.length, 2);
  h.loads[1].resolve({ n: 2 });
  assert.deepEqual(await second, { n: 2 });
});

test('fresh skips the stored answer', async () => {
  const h = harness();
  const first = h.cache.get();
  h.loads[0].resolve({ n: 1 });
  await first;
  const fresh = h.cache.get({ fresh: true });
  assert.equal(h.loads.length, 2);
  h.loads[1].resolve({ n: 2 });
  assert.deepEqual(await fresh, { n: 2 });
  assert.deepEqual(await h.cache.get(), { n: 2 });
});

test('a request in flight before invalidate() is neither shared nor stored', async () => {
  const h = harness();
  const before = h.cache.get();
  h.cache.invalidate();             // e.g. a redeem finished meanwhile
  const after = h.cache.get();
  assert.equal(h.loads.length, 2);
  h.loads[0].resolve({ n: 'old' });
  h.loads[1].resolve({ n: 'new' });
  assert.deepEqual(await before, { n: 'old' });
  assert.deepEqual(await after, { n: 'new' });
  assert.deepEqual(await h.cache.get(), { n: 'new' });
  assert.equal(h.loads.length, 2);
});

test('a transient failure serves the last good status, a lasting one does not', async () => {
  const h = harness({ maxAgeMs: 1000, staleLimitMs: 5000 });
  const first = h.cache.get();
  h.loads[0].resolve({ premium_access: true, reason: 'grandfathered' });
  await first;
  h.tick(2000);
  for (const status of [429, 502, undefined]) {
    const pending = h.cache.get();
    h.loads.at(-1).reject(Object.assign(new Error('x'), { status }));
    assert.equal((await pending).reason, 'grandfathered', `status ${status}`);
  }
  const unauthorised = h.cache.get();
  h.loads.at(-1).reject(Object.assign(new Error('Token expired'), { status: 401 }));
  await assert.rejects(unauthorised, /Token expired/);
  h.tick(3000);                       // last good answer is now 5 s old: past the limit
  const tooOld = h.cache.get();
  h.loads.at(-1).reject(Object.assign(new Error('rate_limited'), { status: 429 }));
  await assert.rejects(tooOld, /rate_limited/);
});

test('an error is never cached, and with no good answer it reaches the caller', async () => {
  const h = harness();
  const first = h.cache.get();
  h.loads[0].reject(Object.assign(new Error('rate_limited'), { status: 429 }));
  await assert.rejects(first, /rate_limited/);
  const retry = h.cache.get();
  assert.equal(h.loads.length, 2);
  h.loads[1].resolve({ premium_access: true });
  assert.equal((await retry).premium_access, true);
});

test('another identity never gets this one\'s status, not even as a fallback', async () => {
  const h = harness();
  const first = h.cache.get();
  h.loads[0].resolve({ premium_access: true });
  await first;
  h.setKey('user:b');
  const other = h.cache.get();
  assert.equal(h.loads.length, 2);
  h.loads[1].reject(Object.assign(new Error('rate_limited'), { status: 429 }));
  await assert.rejects(other, /rate_limited/);
});

test('an answer that lands after the identity changed is not stored for the new one', async () => {
  const h = harness();
  const pending = h.cache.get();
  h.setKey('user:b');
  h.loads[0].resolve({ premium_access: true });
  await pending;
  const next = h.cache.get();
  assert.equal(h.loads.length, 2);
  h.loads[1].resolve({ premium_access: false });
  assert.equal((await next).premium_access, false);
});

test('expireOlderThan re-reads only an answer past that age', async () => {
  const h = harness({ maxAgeMs: 10_000 });
  const first = h.cache.get();
  h.loads[0].resolve({ n: 1 });
  await first;
  h.tick(100);
  h.cache.expireOlderThan(200);
  await h.cache.get();
  assert.equal(h.loads.length, 1);
  h.tick(100);
  h.cache.expireOlderThan(200);
  const again = h.cache.get();
  assert.equal(h.loads.length, 2);
  h.loads[1].resolve({ n: 2 });
  assert.deepEqual(await again, { n: 2 });
});

// --- Through the real api object --------------------------------------------------------

test('a title screen worth of callers costs one request', async () => {
  reset();
  await login(tokenFor('Founder'));
  premiumFor[tokenFor('Founder')] = { premium_access: true, reason: 'grandfathered' };
  const answers = await Promise.all([api.getBillingStatus(), api.getBillingStatus(), api.getBillingStatus()]);
  answers.push(await api.getBillingStatus(), await api.getBillingStatus());
  assert.equal(statusCalls().length, 1);
  for (const status of answers) assert.equal(status.reason, 'grandfathered');
  await api.logout();
});

test('logout clears it, and the next account starts from the server', async () => {
  reset();
  premiumFor[tokenFor('Paid')] = { premium_access: true, reason: 'paid' };
  await login(tokenFor('Paid'));
  assert.equal((await api.getBillingStatus()).reason, 'paid');
  await api.logout();
  assert.equal((await api.getBillingStatus()).premium_access, false);   // anonymous, asked again
  await login(tokenFor('Free'));
  assert.equal((await api.getBillingStatus()).premium_access, false);
  assert.equal(statusCalls().length, 3);
  assert.deepEqual(statusCalls().map((c) => c.auth), [
    'Bearer ' + tokenFor('Paid'), null, 'Bearer ' + tokenFor('Free'),
  ]);
  await api.logout();
});

test('logging in as someone else straight away never shows the last account', async () => {
  reset();
  premiumFor[tokenFor('Paid')] = { premium_access: true, reason: 'paid' };
  await login(tokenFor('Paid'));
  await api.getBillingStatus();
  await login(tokenFor('Other'));
  assert.equal((await api.getBillingStatus()).premium_access, false);
  assert.equal(statusCalls().length, 2);
  await api.logout();
});

test('a token refreshed to another account is a different identity', async () => {
  reset();
  premiumFor[tokenFor('Paid')] = { premium_access: true, reason: 'paid' };
  await login(tokenFor('Paid'));
  await api.getBillingStatus();
  routes['POST /auth/refresh'] = () => json(200, { access_token: tokenFor('Other') });
  assert.equal(await api.refresh(), true);
  assert.equal((await api.getBillingStatus()).premium_access, false);
  assert.equal(statusCalls().length, 2);
  await api.logout();
});

test('the same account with a refreshed token keeps the cached answer', async () => {
  reset();
  premiumFor[tokenFor('Paid', 'sid', { iat: 1 })] = { premium_access: true, reason: 'paid' };
  await login(tokenFor('Paid', 'sid', { iat: 1 }));
  await api.getBillingStatus();
  routes['POST /auth/refresh'] = () => json(200, { access_token: tokenFor('Paid', 'sid', { iat: 2 }) });
  await api.refresh();
  assert.equal((await api.getBillingStatus()).reason, 'paid');
  assert.equal(statusCalls().length, 1);
  await api.logout();
});

for (const [name, call, path] of [
  ['redeem', () => api.redeemCode('CODE'), 'POST /billing/redeem'],
  ['checkout', () => api.startCheckout(true, true, { version: 1, language: 'en' }), 'POST /billing/checkout'],
  ['cancel', () => api.cancelSubscription(), 'POST /billing/cancel'],
  ['portal', () => api.openBillingPortal(), 'POST /billing/portal'],
  ['recover', () => api._fetch('/billing/recover', { method: 'POST' }), 'POST /billing/recover'],
]) {
  test(`${name} makes the next read go to the server`, async () => {
    reset();
    const token = tokenFor('Buyer');
    await login(token);
    await api.getBillingStatus();
    premiumFor[token] = { premium_access: true, reason: 'gift' };
    routes[path] = () => json(200, { ok: true, url: 'https://billing.stripe.com/x', access: premiumFor[token] });
    await call();
    assert.equal((await api.getBillingStatus()).reason, 'gift');
    assert.equal(statusCalls().length, 2);
    await api.logout();
  });
}

test('even a failed redeem drops the stored status', async () => {
  reset();
  await login(tokenFor('Buyer'));
  await api.getBillingStatus();
  routes['POST /billing/redeem'] = () => json(400, { error: 'invalid_code' });
  await assert.rejects(api.redeemCode('BAD'), /invalid_code/);
  await api.getBillingStatus();
  assert.equal(statusCalls().length, 2);
  await api.logout();
});

test('deleting the account clears it', async () => {
  reset();
  const token = tokenFor('Leaver');
  premiumFor[token] = { premium_access: true, reason: 'paid' };
  await login(token);
  await api.getBillingStatus();
  routes['DELETE /profile'] = () => json(200, { ok: true });
  await api.deleteAccount('pw');
  assert.equal(api.isLoggedIn, false);
  assert.equal((await api.getBillingStatus()).premium_access, false);
  assert.equal(statusCalls().length, 2);
});

test('the Billing tab\'s fresh read asks the server even with a cached answer', async () => {
  reset();
  await login(tokenFor('Founder'));
  await api.getBillingStatus();
  await api.getBillingStatus({ fresh: true });
  assert.equal(statusCalls().length, 2);
  await api.logout();
});

test('the status lives only in memory', async () => {
  const writes = [];
  globalThis.localStorage = { setItem: (k) => writes.push(k), getItem: () => null, removeItem() {} };
  globalThis.sessionStorage = globalThis.localStorage;
  reset();
  await login(tokenFor('Founder'));
  await api.getBillingStatus();
  assert.deepEqual(writes, []);
  delete globalThis.localStorage;
  delete globalThis.sessionStorage;
  await api.logout();
});

// --- Reading the token ------------------------------------------------------------------

test('parseJwt reads base64url payloads that atob() alone rejects', () => {
  // Find a payload whose base64url form uses '-' or '_' (atob throws on both).
  let token = null;
  for (let i = 0; i < 500 && !token; i++) {
    const candidate = tokenFor('Dinoyo', `sid-${i}~?>`, { exp: 1795000000 + i });
    if (/[-_]/.test(candidate.split('.')[1])) token = candidate;
  }
  assert.ok(token, 'no base64url sample found');
  assert.throws(() => atob(token.split('.')[1]));
  assert.equal(parseJwt(token).sub, 'Dinoyo');
});

test('api.username survives such a token', async () => {
  let token = null;
  for (let i = 0; i < 500 && !token; i++) {
    const candidate = tokenFor('Dinoyo', `sid-${i}~?>`);
    if (/[-_]/.test(candidate.split('.')[1])) token = candidate;
  }
  await login(token);
  assert.equal(api.username, 'Dinoyo');
  await api.logout();
});
