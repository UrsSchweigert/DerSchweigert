// access-flow.test.js — Tests for access control and billing flow

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  getAuthorizedLevelConfig,
  getBillingStatus,
  startCheckout,
  openBillingPortal,
  redeemCode,
  cancelSubscription,
  AccessFlowError,
  setCurrentLevelConfig,
  getCurrentLevelConfig,
} from './access-flow.js';

// Mock API client factory
function createMockApi(responses = {}) {
  return {
    _fetch: async (path, options = {}) => {
      const key = `${options.method || 'GET'} ${path}`;
      const response = responses[key];
      if (!response) {
        return {
          ok: false,
          status: 404,
          json: async () => ({ error: 'Not found' })
        };
      }
      return response;
    }
  };
}

describe('getAuthorizedLevelConfig', () => {
  it('returns free level config for level 1', async () => {
    const api = createMockApi();
    const cfg = await getAuthorizedLevelConfig(0, api);

    assert.ok(cfg, 'Level 1 config should exist');
    assert.strictEqual(cfg.level, 1, 'Level should be 1');
  });

  it('returns free level config for level 2', async () => {
    const api = createMockApi();
    const cfg = await getAuthorizedLevelConfig(1, api);

    assert.ok(cfg, 'Level 2 config should exist');
    assert.strictEqual(cfg.level, 2, 'Level should be 2');
  });

  it('includes baseline_score when requested for free levels', async () => {
    const api = createMockApi();
    const cfg = await getAuthorizedLevelConfig(1, api, true);

    assert.ok(cfg, 'Level 2 config should exist');
    assert.ok(typeof cfg.baseline_score === 'number', 'baseline_score should be a number');
  });

  it('fetches premium level config via API', async () => {
    const mockResponse = {
      ok: true,
      status: 200,
      json: async () => ({
        level: 3,
        chapter: 1,
        operations: ['+', '-'],
        fiendType: 'slimeling',
        fiendHP: 1,
        waveSize: 35,
        inputMode: 'multiple-choice',
      })
    };

    const api = createMockApi({ 'GET /levels/3': mockResponse });
    const cfg = await getAuthorizedLevelConfig(2, api);

    assert.strictEqual(cfg.level, 3, 'Level should be 3');
    assert.strictEqual(cfg.waveSize, 35, 'waveSize should match API response');
  });

  it('throws AccessFlowError 401 on authentication failure', async () => {
    const mockResponse = {
      ok: false,
      status: 401,
      json: async () => ({ error: 'Unauthorized' })
    };

    const api = createMockApi({ 'GET /levels/3': mockResponse });

    try {
      await getAuthorizedLevelConfig(2, api);
      assert.fail('Should have thrown AccessFlowError');
    } catch (err) {
      assert.ok(err instanceof AccessFlowError, 'Should throw AccessFlowError');
      assert.strictEqual(err.statusCode, 401, 'Status should be 401');
    }
  });

  it('throws AccessFlowError 402 on payment required', async () => {
    const mockResponse = {
      ok: false,
      status: 402,
      json: async () => ({ error: 'Payment required' })
    };

    const api = createMockApi({ 'GET /levels/3': mockResponse });

    try {
      await getAuthorizedLevelConfig(2, api);
      assert.fail('Should have thrown AccessFlowError');
    } catch (err) {
      assert.ok(err instanceof AccessFlowError, 'Should throw AccessFlowError');
      assert.strictEqual(err.statusCode, 402, 'Status should be 402');
    }
  });

  it('throws AccessFlowError 403 on access denied', async () => {
    const mockResponse = {
      ok: false,
      status: 403,
      json: async () => ({ error: 'Forbidden' })
    };

    const api = createMockApi({ 'GET /levels/3': mockResponse });

    try {
      await getAuthorizedLevelConfig(2, api);
      assert.fail('Should have thrown AccessFlowError');
    } catch (err) {
      assert.ok(err instanceof AccessFlowError, 'Should throw AccessFlowError');
      assert.strictEqual(err.statusCode, 403, 'Status should be 403');
    }
  });
});

describe('getBillingStatus', () => {
  it('returns billing status for anonymous users', async () => {
    const mockResponse = {
      ok: true,
      status: 200,
      json: async () => ({ is_premium: false, has_access: false })
    };

    const api = createMockApi({ 'GET /billing/status': mockResponse });
    const status = await getBillingStatus(api);

    assert.strictEqual(status.is_premium, false, 'Should not be premium');
  });

  it('throws AccessFlowError on network failure', async () => {
    const mockResponse = {
      ok: false,
      status: 500,
      json: async () => ({ error: 'Server error' })
    };

    const api = createMockApi({ 'GET /billing/status': mockResponse });

    try {
      await getBillingStatus(api);
      assert.fail('Should have thrown AccessFlowError');
    } catch (err) {
      assert.ok(err instanceof AccessFlowError, 'Should throw AccessFlowError');
      assert.strictEqual(err.statusCode, 500, 'Status should be 500');
    }
  });
});

describe('startCheckout', () => {
  it('returns redirect URL on success', async () => {
    const mockResponse = {
      ok: true,
      status: 200,
      json: async () => ({ redirect_url: 'https://checkout.stripe.com/...' })
    };

    const api = createMockApi({ 'POST /billing/checkout': mockResponse });
    const result = await startCheckout(api, {
      adult_confirmed: true,
      terms_accepted: true
    });

    assert.ok(result.redirect_url, 'Should return redirect URL');
    assert.ok(result.redirect_url.startsWith('https://'), 'URL should be HTTPS');
  });

  it('throws AccessFlowError 401 if not authenticated', async () => {
    const mockResponse = {
      ok: false,
      status: 401,
      json: async () => ({ error: 'Unauthorized' })
    };

    const api = createMockApi({ 'POST /billing/checkout': mockResponse });

    try {
      await startCheckout(api, { adult_confirmed: true, terms_accepted: true });
      assert.fail('Should have thrown AccessFlowError');
    } catch (err) {
      assert.strictEqual(err.statusCode, 401, 'Status should be 401');
    }
  });

  it('throws AccessFlowError 402 on payment issue', async () => {
    const mockResponse = {
      ok: false,
      status: 402,
      json: async () => ({ error: 'Payment failed' })
    };

    const api = createMockApi({ 'POST /billing/checkout': mockResponse });

    try {
      await startCheckout(api, { adult_confirmed: true, terms_accepted: true });
      assert.fail('Should have thrown AccessFlowError');
    } catch (err) {
      assert.strictEqual(err.statusCode, 402, 'Status should be 402');
    }
  });
});

describe('openBillingPortal', () => {
  it('returns redirect URL for portal', async () => {
    const mockResponse = {
      ok: true,
      status: 200,
      json: async () => ({ redirect_url: 'https://billing.stripe.com/...' })
    };

    const api = createMockApi({ 'POST /billing/portal': mockResponse });
    const result = await openBillingPortal(api);

    assert.ok(result.redirect_url, 'Should return redirect URL');
  });

  it('throws AccessFlowError 401 if not authenticated', async () => {
    const mockResponse = {
      ok: false,
      status: 401,
      json: async () => ({ error: 'Unauthorized' })
    };

    const api = createMockApi({ 'POST /billing/portal': mockResponse });

    try {
      await openBillingPortal(api);
      assert.fail('Should have thrown AccessFlowError');
    } catch (err) {
      assert.strictEqual(err.statusCode, 401, 'Status should be 401');
    }
  });

  it('surfaces a safe localizable code, never a raw SyntaxError, when the server returns a non-JSON body (e.g. an unhandled HTML 500 page)', async () => {
    const mockResponse = {
      ok: false,
      status: 503,
      json: async () => { throw new SyntaxError("Unexpected token '<', \"<!doctype \"... is not valid JSON"); }
    };

    const api = createMockApi({ 'POST /billing/portal': mockResponse });

    try {
      await openBillingPortal(api);
      assert.fail('Should have thrown AccessFlowError');
    } catch (err) {
      assert.ok(err instanceof AccessFlowError, 'Should throw AccessFlowError, not a raw SyntaxError');
      assert.strictEqual(err.statusCode, 503, 'Status should be 503');
      assert.strictEqual(err.message, 'portal_unavailable', 'Message must be the safe fallback error code');
      assert.ok(!/Unexpected token/.test(err.message), 'Raw SyntaxError text must never reach the caller');
    }
  });
});

describe('redeemCode', () => {
  it('returns access object on valid code', async () => {
    const mockResponse = {
      ok: true,
      status: 200,
      json: async () => ({ access: { is_premium: true } })
    };

    const api = createMockApi({ 'POST /billing/redeem': mockResponse });
    const result = await redeemCode(api, 'FOUNDING-PLAYER-123');

    assert.ok(result.access, 'Should return access object');
  });

  it('throws AccessFlowError on invalid code', async () => {
    const mockResponse = {
      ok: false,
      status: 400,
      json: async () => ({ error: 'Invalid code' })
    };

    const api = createMockApi({ 'POST /billing/redeem': mockResponse });

    try {
      await redeemCode(api, 'INVALID-CODE');
      assert.fail('Should have thrown AccessFlowError');
    } catch (err) {
      assert.ok(err instanceof AccessFlowError);
    }
  });
});

describe('cancelSubscription', () => {
  it('returns access object after cancellation', async () => {
    const mockResponse = {
      ok: true,
      status: 200,
      json: async () => ({ access: { is_premium: false } })
    };

    const api = createMockApi({ 'POST /billing/cancel': mockResponse });
    const result = await cancelSubscription(api);

    assert.ok(result.access, 'Should return access object');
  });

  it('throws AccessFlowError 401 if not authenticated', async () => {
    const mockResponse = {
      ok: false,
      status: 401,
      json: async () => ({ error: 'Unauthorized' })
    };

    const api = createMockApi({ 'POST /billing/cancel': mockResponse });

    try {
      await cancelSubscription(api);
      assert.fail('Should have thrown AccessFlowError');
    } catch (err) {
      assert.strictEqual(err.statusCode, 401, 'Status should be 401');
    }
  });
});

describe('Current config/billing state', () => {
  it('can store and retrieve current level config', () => {
    const config = { level: 5, waveSize: 40 };
    setCurrentLevelConfig(config);

    assert.strictEqual(getCurrentLevelConfig(), config, 'Should return stored config');
  });
});

describe('baseline_score field name', () => {
  it('returns baseline_score (snake_case) not baselineScore in premium level response', async () => {
    const mockResponse = {
      ok: true,
      status: 200,
      json: async () => ({
        level: 3,
        chapter: 1,
        operations: ['+'],
        fiendType: 'slimeling',
        fiendHP: 1,
        waveSize: 35,
        inputMode: 'multiple-choice',
        baseline_score: 2500  // API returns snake_case
      })
    };

    const api = createMockApi({ 'GET /levels/3?include_baseline=1': mockResponse });
    const cfg = await getAuthorizedLevelConfig(2, api, true);

    assert.ok(cfg.baseline_score !== undefined, 'Should have baseline_score field');
    assert.strictEqual(cfg.baseline_score, 2500, 'baseline_score value should match API');
  });

  it('includes baseline_score for free level 2 when requested', async () => {
    const api = createMockApi();
    const cfg = await getAuthorizedLevelConfig(1, api, true);

    assert.ok(typeof cfg.baseline_score === 'number', 'Should compute baseline_score for free level');
    assert.ok(cfg.baseline_score >= 0, 'baseline_score should be non-negative');
  });
});

describe('Billing status contract', () => {
  it('validates billing status shape', async () => {
    const mockResponse = {
      ok: true,
      status: 200,
      json: async () => ({
        access_control_enabled: true,
        premium_access: false,
        reason: 'free',
        access_until: null,
        paid_until: null,
        gift_until: null,
        subscription_id: null,
        subscription_status: null,
        cancel_at_period_end: false,
        next_payment_at: null,
        can_checkout: true
      })
    };

    const api = createMockApi({ 'GET /billing/status': mockResponse });
    const status = await getBillingStatus(api);

    assert.strictEqual(typeof status.access_control_enabled, 'boolean');
    assert.strictEqual(typeof status.premium_access, 'boolean');
    assert.ok(['free', 'prelaunch', 'grandfathered', 'paid', 'gift', 'unverified'].includes(status.reason));
    assert.strictEqual(typeof status.can_checkout, 'boolean');
  });
});

describe('URL validation', () => {
  it('validates Stripe checkout URL', async () => {
    const mockResponse = {
      ok: true,
      status: 200,
      json: async () => ({ url: 'https://checkout.stripe.com/pay/abc123' })
    };

    const api = createMockApi({ 'POST /billing/checkout': mockResponse });
    const result = await startCheckout(api, { adult_confirmed: true, terms_accepted: true });

    assert.ok(result.url.startsWith('https://checkout.stripe.com'), 'Checkout URL must be Stripe');
  });

  it('validates Stripe billing portal URL', async () => {
    const mockResponse = {
      ok: true,
      status: 200,
      json: async () => ({ url: 'https://billing.stripe.com/abc/123' })
    };

    const api = createMockApi({ 'POST /billing/portal': mockResponse });
    const result = await openBillingPortal(api);

    assert.ok(result.url.startsWith('https://billing.stripe.com'), 'Portal URL must be Stripe');
  });
});
