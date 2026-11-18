// billing-status-errors.test.js — a non-JSON error page from the API (the limiter's HTML
// 429, a gateway 502) must reach the player as a readable error, not as a JSON parser
// message. In Safari that message was "The string did not match the expected pattern.",
// which a grandfathered player saw in the Billing tab in place of "Founding player".
import { test } from 'node:test';
import assert from 'node:assert/strict';

globalThis.window = { location: { origin: 'http://x' } };

// Flask-Limiter's default 429 page, byte for byte as production served it.
const LIMITER_PAGE = '<!doctype html>\n<html lang=en>\n<title>429 Too Many Requests</title>\n'
  + '<h1>Too Many Requests</h1>\n<p>50 per 1 hour</p>\n';

let next = null;
globalThis.fetch = async () => next;
const htmlResponse = (status, body) => new Response(body, { status, headers: { 'Content-Type': 'text/html' } });

const { api } = await import('./api.js');
const { getBillingStatus, getAuthorizedLevelConfig, AccessFlowError } = await import('./access-flow.js');
const { translateServerMessage, setLocale, t } = await import('./i18n.js');

test('api.getBillingStatus turns the HTML 429 into a rate_limited error', async () => {
  next = htmlResponse(429, LIMITER_PAGE);
  await assert.rejects(api.getBillingStatus(), (error) => {
    assert.equal(error.message, 'rate_limited');
    assert.equal(error.status, 429);
    return true;
  });
});

test('access-flow getBillingStatus does the same', async () => {
  next = htmlResponse(429, LIMITER_PAGE);
  await assert.rejects(getBillingStatus({ _fetch: async () => next }), (error) => {
    assert.ok(error instanceof AccessFlowError);
    assert.equal(error.message, 'rate_limited');
    assert.equal(error.statusCode, 429);
    return true;
  });
});

test('a gateway error page becomes server_unavailable, also for a premium level', async () => {
  next = htmlResponse(502, '<html><body>Bad Gateway</body></html>');
  await assert.rejects(api.getBillingStatus(), { message: 'server_unavailable' });
  next = htmlResponse(504, '<html><body>Gateway Timeout</body></html>');
  await assert.rejects(getAuthorizedLevelConfig(4, { _fetch: async () => next }), { message: 'server_unavailable' });
});

test('a success status with an unreadable body is an error, never a free status', async () => {
  next = htmlResponse(200, '<html></html>');
  await assert.rejects(api.getBillingStatus(), { message: 'server_unavailable' });
});

test('the JSON 429 the API now sends keeps its own error', async () => {
  next = new Response(JSON.stringify({ error: 'rate_limited' }), { status: 429 });
  await assert.rejects(api.getBillingStatus(), { message: 'rate_limited' });
});

test('a grandfathered status still arrives unchanged', async () => {
  const status = { premium_access: true, reason: 'grandfathered', access_until: null };
  next = new Response(JSON.stringify(status), { status: 200 });
  assert.deepEqual(await api.getBillingStatus(), status);
});

test('both stand-in errors read as sentences in each language', () => {
  for (const locale of ['en', 'de']) {
    setLocale(locale);
    for (const code of ['rate_limited', 'server_unavailable']) {
      const text = translateServerMessage(code);
      assert.notEqual(text, code);
      assert.notEqual(text, t('errors.unknownServerError'));
      assert.match(text, /\.$/);
    }
  }
  setLocale('en');
});
