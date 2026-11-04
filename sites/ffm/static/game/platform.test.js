import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// api.js captures window.location.origin when it is first imported, so the
// browser globals must exist before any adapter is loaded.
globalThis.window = { location: { origin: 'https://game.example' } };

const calls = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, options = {}) => {
  calls.push({ url: String(url), options });
  return { ok: true, status: 200, json: async () => ({ ok: true }) };
};

const {
  PLATFORM_METHODS,
  PLATFORM_PROPERTIES,
  PLATFORM_CAPABILITIES,
  assertPlatformAdapter,
  resolvePlatform,
} = await import('./platform.js');
const { LevelConfig } = await import('./levels.js');
const { default: webPlatform } = await import('./platform-adapter.js');
const { default: appPlatform, PlatformUnavailableError } = await import('../../mobile/game/platform-adapter.js');

function fakeAdapter(overrides = {}) {
  const adapter = {
    isApp: false,
    hasAccount: true,
    hasLeaderboard: true,
    isLoggedIn: false,
    username: null,
  };
  for (const name of PLATFORM_METHODS) adapter[name] = async () => undefined;
  return Object.assign(adapter, overrides);
}

describe('platform interface', () => {
  it('lists every api.js and access-flow.js call the game needs', () => {
    for (const name of [
      'getAuthorizedLevelConfig', 'setCurrentLevelConfig', 'getCurrentLevelConfig',
      'incrementRequestGeneration', 'isStripeRedirect', 'validatePendingRecord',
      'postHighScore', 'postLevelScore', 'getScoreHistory', 'getBillingStatus',
      'login', 'logout', 'refresh', 'getLeaderboard', '_fetch',
    ]) {
      assert.ok(PLATFORM_METHODS.includes(name), name);
    }
    assert.equal(new Set(PLATFORM_METHODS).size, PLATFORM_METHODS.length);
    assert.deepEqual([...PLATFORM_PROPERTIES], ['isLoggedIn', 'username']);
    assert.deepEqual([...PLATFORM_CAPABILITIES], ['isApp', 'hasAccount', 'hasLeaderboard']);
  });

  it('covers every api.* and access-flow call main.js makes today', async () => {
    const source = await readFile(new URL('./main.js', import.meta.url), 'utf8');
    const apiCalls = new Set(
      [...source.matchAll(/\bapi\.([A-Za-z_]\w*)/g)]
        .map((match) => match[1])
        .filter((name) => name !== 'js'),
    );
    for (const name of apiCalls) {
      assert.ok(PLATFORM_METHODS.includes(name) || PLATFORM_PROPERTIES.includes(name), name);
    }
    const imported = source.match(/import\s*\{([^}]+)\}\s*from\s*'\.\/access-flow\.js'/);
    assert.ok(imported, 'main.js imports access-flow.js');
    for (const name of imported[1].split(',').map((part) => part.trim()).filter(Boolean)) {
      assert.ok(PLATFORM_METHODS.includes(name), name);
    }
  });

  it('accepts a complete fake adapter', () => {
    const fake = fakeAdapter();
    assert.equal(assertPlatformAdapter(fake), fake);
  });

  it('rejects an adapter that misses a method or capability', () => {
    const missingMethod = fakeAdapter();
    delete missingMethod.postLevelScore;
    assert.throws(() => assertPlatformAdapter(missingMethod), /postLevelScore/);

    const missingCapability = fakeAdapter({ hasAccount: 'yes' });
    assert.throws(() => assertPlatformAdapter(missingCapability), /hasAccount/);

    assert.throws(() => assertPlatformAdapter(null), /must be an object/);
  });
});

describe('resolvePlatform', () => {
  it('resolves and validates the adapter from the supplied loader', async () => {
    const fake = fakeAdapter();
    const adapter = await resolvePlatform(async () => ({ default: fake }));
    assert.equal(adapter, fake);
  });

  it('rejects an invalid adapter from a loader', async () => {
    await assert.rejects(
      resolvePlatform(async () => fakeAdapter({ isApp: undefined })),
      /isApp/,
    );
  });

  it('resolves the web adapter by default', async () => {
    const adapter = await resolvePlatform();
    assert.equal(adapter, webPlatform);
    assert.equal(adapter.isApp, false);
    assert.equal(adapter.hasAccount, true);
    assert.equal(adapter.hasLeaderboard, true);
  });
});

describe('web platform adapter', () => {
  it('delegates account calls to the existing api.js routes', async () => {
    calls.length = 0;
    await webPlatform.login('ada', 'secret');
    assert.equal(calls[0].url, 'https://game.example/api/auth/login');
    assert.equal(calls[0].options.method, 'POST');
    assert.deepEqual(JSON.parse(calls[0].options.body), { username: 'ada', password: 'secret' });
    assert.equal(webPlatform.isLoggedIn, true);
    assert.equal(webPlatform.username, null); // the fake token is not a JWT

    await webPlatform.logout();
    assert.equal(calls[1].url, 'https://game.example/api/auth/logout');
    assert.equal(webPlatform.isLoggedIn, false);
  });

  it('serves free levels without a network call', async () => {
    calls.length = 0;
    const cfg = await webPlatform.getAuthorizedLevelConfig(0);
    assert.deepEqual(cfg, LevelConfig[0]);
    assert.equal(calls.length, 0);
  });

  it('delegates premium level access to the API', async () => {
    calls.length = 0;
    const cfg = await webPlatform.getAuthorizedLevelConfig(2);
    assert.equal(calls[0].url, 'https://game.example/api/levels/3');
    assert.deepEqual(cfg, { ok: true });
  });

  it('keeps the access-flow helpers working', () => {
    webPlatform.setCurrentLevelConfig({ level: 9 });
    assert.deepEqual(webPlatform.getCurrentLevelConfig(), { level: 9 });
    webPlatform.incrementRequestGeneration();
    assert.equal(webPlatform.isStripeRedirect('https://checkout.stripe.com/x', 'checkout.stripe.com'), true);
    assert.equal(webPlatform.isStripeRedirect('https://evil.example/x', 'checkout.stripe.com'), false);
    assert.equal(webPlatform.validatePendingRecord({
      levelIndex: 0, score: 10, difficulty: 'easy', timerMax: 30, maxHearts: 3,
    }), true);
    assert.equal(webPlatform.validatePendingRecord({ levelIndex: 0 }), false);
  });
});

describe('app platform adapter', () => {
  it('implements the whole interface and advertises app capabilities', () => {
    assert.equal(assertPlatformAdapter(appPlatform), appPlatform);
    assert.equal(appPlatform.isApp, true);
    assert.equal(appPlatform.hasAccount, false);
    assert.equal(appPlatform.hasLeaderboard, false);
    assert.equal(appPlatform.isLoggedIn, false);
    assert.equal(appPlatform.username, null);
  });

  it('serves levels 1-2 and locks the rest until entitled', async () => {
    assert.deepEqual(await appPlatform.getAuthorizedLevelConfig(0), LevelConfig[0]);
    assert.deepEqual(await appPlatform.getAuthorizedLevelConfig(1), LevelConfig[1]);
    await assert.rejects(
      appPlatform.getAuthorizedLevelConfig(2),
      (error) => error instanceof PlatformUnavailableError && error.code === 'entitlement_required',
    );
  });

  it('reports no entitlement and no personal history', async () => {
    assert.equal((await appPlatform.getBillingStatus()).premium_access, false);
    assert.deepEqual(await appPlatform.getScoreHistory(), { history: [] });
    assert.deepEqual(await appPlatform.getLeaderboard(), []);
    assert.deepEqual(await appPlatform.postHighScore(10, 1), { saved: false });
    assert.deepEqual(await appPlatform.postLevelScore(1, 10, 'easy'), { saved: false });
  });

  it('validates pending records like the web adapter', () => {
    const record = { levelIndex: 2, score: 100, difficulty: 'medium', timerMax: 45, maxHearts: 4 };
    assert.equal(appPlatform.validatePendingRecord(record), webPlatform.validatePendingRecord(record));
    assert.equal(appPlatform.validatePendingRecord({ ...record, timerMax: 0 }), false);
  });

  it('rejects account, purchase and network methods', async () => {
    for (const name of ['login', 'register', '_fetch', 'startCheckout', 'deleteAccount']) {
      await assert.rejects(
        appPlatform[name](),
        (error) => error instanceof PlatformUnavailableError && error.code === 'platform_unavailable',
        name,
      );
    }
  });

  it('never touches the network', async () => {
    let networkCalls = 0;
    globalThis.fetch = async () => {
      networkCalls++;
      throw new Error('app adapter must not use the network');
    };
    try {
      await appPlatform.getAuthorizedLevelConfig(0);
      await appPlatform.getBillingStatus();
      await appPlatform.getScoreHistory();
      await appPlatform.postHighScore(1, 1);
      await assert.rejects(appPlatform.login('ada', 'secret'));
    } finally {
      globalThis.fetch = realFetch;
    }
    assert.equal(networkCalls, 0);
  });

  it('has no api.js/access-flow.js import and no network primitive', async () => {
    const source = await readFile(new URL('../../mobile/game/platform-adapter.js', import.meta.url), 'utf8');
    assert.doesNotMatch(source, /^\s*import\s/m);
    assert.doesNotMatch(source, /\bfetch\s*\(/);
    assert.doesNotMatch(source, /\bXMLHttpRequest\b/);
    assert.doesNotMatch(source, /\bnavigator\.sendBeacon\b/);
  });
});
