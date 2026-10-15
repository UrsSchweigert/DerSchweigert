import { it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  isValidEmail, isValidUsername, isValidIsoDate, isFutureIsoDate,
  generateIdempotencyKey, validateFields, buildReceiptText,
  submitCancelRequest, initCancelRequestForm,
} from './cancel-request.js';

// ============ Pure validation helpers ============

it('validates emails with basic bounds', () => {
  assert.equal(isValidEmail('a@b.de'), true);
  assert.equal(isValidEmail('not-an-email'), false);
  assert.equal(isValidEmail(''), false);
  assert.equal(isValidEmail('a'.repeat(260) + '@b.de'), false);
  assert.equal(isValidEmail(null), false);
});

it('rejects emails with whitespace/control characters, no "@" or more than one "@", or an empty side', () => {
  assert.equal(isValidEmail('a b@example.com'), false);
  assert.equal(isValidEmail('a\tb@example.com'), false);
  assert.equal(isValidEmail('a\u0000b@example.com'), false);
  assert.equal(isValidEmail('noatsign.example.com'), false);
  assert.equal(isValidEmail('a@b@example.com'), false);
  assert.equal(isValidEmail('@example.com'), false);
  assert.equal(isValidEmail('a@'), false);
  assert.equal(isValidEmail('a@b.de'), true);
});

it('validates usernames as 3-20 alphanumeric characters', () => {
  assert.equal(isValidUsername('abc'), true);
  assert.equal(isValidUsername('ab'), false);
  assert.equal(isValidUsername('a'.repeat(21)), false);
  assert.equal(isValidUsername('has space'), false);
  assert.equal(isValidUsername('has-dash'), false);
});

it('aligns username validation with the actual (Unicode-aware) account policy, not an ASCII-only check', () => {
  // app/auth.py's real registration policy is Python str.isalnum() (3-20
  // chars), which accepts Unicode letters/digits, not only ASCII — this
  // field is meant to match real, already-registered usernames.
  assert.equal(isValidUsername('müller123'), true);
  assert.equal(isValidUsername('Müller'), true);
  assert.equal(isValidUsername('用户名abc'), true);
});

it('accepts only strict ISO 8601 calendar dates, rejecting German formatting', () => {
  assert.equal(isValidIsoDate('2026-10-15'), true);
  assert.equal(isValidIsoDate('15.10.2026'), false);
  assert.equal(isValidIsoDate('2026/10/15'), false);
  assert.equal(isValidIsoDate('2026-02-30'), false); // not a real calendar date
  assert.equal(isValidIsoDate('not-a-date'), false);
});

it('requires requested dates to be strictly in the future and within bounds', () => {
  const now = new Date('2026-01-01T00:00:00Z');
  assert.equal(isFutureIsoDate('2026-01-02', now), true);
  assert.equal(isFutureIsoDate('2026-01-01', now), false); // today is not "future"
  assert.equal(isFutureIsoDate('2025-12-31', now), false); // past
  assert.equal(isFutureIsoDate('2030-01-01', now), false); // too far out (> 3 years)
});

it('generates RFC4122-shaped idempotency keys', () => {
  const key = generateIdempotencyKey();
  assert.match(key, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  assert.notEqual(key, generateIdempotencyKey());
});

it('rejects a submission with no identifying information at all', () => {
  const { valid, errors } = validateFields({
    contact_email: 'contact@example.com', account_email: '', username: '',
    stripe_reference: '', cancellation_type: 'earliest',
  });
  assert.equal(valid, false);
  assert.ok(errors.identity);
});

it('accepts a minimal valid earliest-cancellation submission', () => {
  const { valid, normalized } = validateFields({
    contact_email: 'Contact@Example.com', account_email: '', username: 'player1',
    stripe_reference: '', cancellation_type: 'earliest', reason: '  please cancel  ',
  });
  assert.equal(valid, true);
  assert.equal(normalized.contact_email, 'contact@example.com');
  assert.equal(normalized.username, 'player1');
  assert.equal(normalized.requested_date, null);
  assert.equal(normalized.reason, 'please cancel');
});

it('requires a valid future requested_date only when that cancellation type is chosen', () => {
  const missingDate = validateFields({
    contact_email: 'a@b.de', username: 'player1', cancellation_type: 'requested_date', requested_date: '',
  });
  assert.equal(missingDate.valid, false);
  assert.ok(missingDate.errors.requested_date);

  const germanFormat = validateFields({
    contact_email: 'a@b.de', username: 'player1', cancellation_type: 'requested_date', requested_date: '15.10.2026',
  });
  assert.equal(germanFormat.valid, false);
});

it('bounds the free-text reason length', () => {
  const { valid, errors } = validateFields({
    contact_email: 'a@b.de', username: 'player1', cancellation_type: 'earliest',
    reason: 'x'.repeat(2001),
  });
  assert.equal(valid, false);
  assert.ok(errors.reason);
});

it('builds a human-readable plaintext receipt that never claims confirmed cancellation', () => {
  const text = buildReceiptText({
    request_id: 'req-1', submitted_at: '2026-01-01T00:00:00+00:00', status: 'submitted',
    cancellation_type: 'earliest', contact_email: 'a@b.de', message: 'Ihre Anfrage wurde entgegengenommen.',
  });
  assert.match(text, /Antrags-ID: req-1/);
  assert.match(text, /NICHT bestaetigte Kuendigung/);
});

// ============ submitCancelRequest ============

it('throws an honest error (without claiming success) when the server rejects the request', async () => {
  const fetchImpl = async () => ({
    ok: false, status: 409,
    text: async () => JSON.stringify({ error: 'idempotency_conflict', message: 'conflict happened' }),
  });
  await assert.rejects(
    submitCancelRequest({ idempotency_key: 'x' }, { baseUrl: 'http://x', fetchImpl }),
    (err) => { assert.equal(err.code, 'idempotency_conflict'); return true; },
  );
});

it('returns the parsed receipt on success without mutating the payload', async () => {
  let sentBody;
  const fetchImpl = async (url, opts) => {
    sentBody = JSON.parse(opts.body);
    return {
      ok: true, status: 201,
      text: async () => JSON.stringify({
        request_id: 'req-2', submitted_at: '2026-01-01T00:00:00+00:00',
        status: 'submitted', cancellation_type: 'earliest', message: 'ok',
      }),
    };
  };
  const receipt = await submitCancelRequest({ idempotency_key: 'req-2', contact_email: 'a@b.de' },
    { baseUrl: 'http://x', fetchImpl });
  assert.equal(receipt.request_id, 'req-2');
  assert.equal(sentBody.idempotency_key, 'req-2');
});

it('propagates a malformed/non-JSON response body as an honest failure instead of an empty receipt', async () => {
  const fetchImpl = async () => ({ ok: true, status: 201, text: async () => '<html>not json</html>' });
  await assert.rejects(
    submitCancelRequest({ idempotency_key: 'req-x' }, { baseUrl: 'http://x', fetchImpl }),
    (err) => { assert.equal(err.code, 'invalid_response'); return true; },
  );
});

it('rejects a success response missing required receipt fields rather than claiming it was received', async () => {
  const fetchImpl = async () => ({
    ok: true, status: 201,
    text: async () => JSON.stringify({ request_id: 'req-y', status: 'submitted' }), // missing submitted_at/message/etc.
  });
  await assert.rejects(
    submitCancelRequest({ idempotency_key: 'req-y' }, { baseUrl: 'http://x', fetchImpl }),
    (err) => { assert.equal(err.code, 'invalid_receipt'); return true; },
  );
});

it('rejects a success response whose request_id does not match the submitted idempotency key', async () => {
  const fetchImpl = async () => ({
    ok: true, status: 201,
    text: async () => JSON.stringify({
      request_id: 'some-other-id', submitted_at: '2026-01-01T00:00:00+00:00',
      status: 'submitted', cancellation_type: 'earliest', message: 'ok',
    }),
  });
  await assert.rejects(
    submitCancelRequest({ idempotency_key: 'req-z' }, { baseUrl: 'http://x', fetchImpl }),
    (err) => { assert.equal(err.code, 'invalid_receipt'); return true; },
  );
});

function withCrypto(value, fn) {
  const originalDescriptor = Object.getOwnPropertyDescriptor(global, 'crypto');
  Object.defineProperty(global, 'crypto', { value, configurable: true, writable: true });
  try {
    return fn();
  } finally {
    Object.defineProperty(global, 'crypto', originalDescriptor);
  }
}

it('mints a secure getRandomValues-based fallback id when crypto.randomUUID is unavailable', () => {
  const realGetRandomValues = global.crypto.getRandomValues.bind(global.crypto);
  withCrypto({ getRandomValues: realGetRandomValues }, () => {
    const key = generateIdempotencyKey();
    assert.match(key, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });
});

it('throws an explicit, catchable error instead of using Math.random() when no secure RNG exists at all', () => {
  withCrypto(undefined, () => {
    assert.throws(() => generateIdempotencyKey(), (err) => {
      assert.equal(err.code, 'insecure_random_unsupported');
      return true;
    });
  });
});

// ============ DOM wiring ============

function makeElement(overrides = {}) {
  const listeners = {};
  return {
    value: '', textContent: '', hidden: true, disabled: false, href: '', download: '',
    style: {}, checked: false,
    addEventListener(event, handler) { listeners[event] = handler; },
    setAttribute() {}, removeAttribute() {}, appendChild() {},
    _listeners: listeners,
    ...overrides,
  };
}

function makeFakeDocument(fieldValues = {}) {
  const elements = {
    'cancel-request-form': makeElement({ hidden: false }),
    'review-panel': makeElement(),
    'receipt-panel': makeElement(),
    'review-button': makeElement(),
    'edit-button': makeElement(),
    'submit-button': makeElement(),
    'download-receipt': makeElement(),
    'form-errors': makeElement({ textContent: '', hidden: true, appendChild() {} }),
    'contact_email': makeElement({ value: fieldValues.contact_email || '' }),
    'account_email': makeElement({ value: fieldValues.account_email || '' }),
    'username': makeElement({ value: fieldValues.username || '' }),
    'stripe_reference': makeElement({ value: fieldValues.stripe_reference || '' }),
    'requested_date': makeElement({ value: fieldValues.requested_date || '' }),
    'reason': makeElement({ value: fieldValues.reason || '' }),
    'review-contact_email': makeElement(),
    'review-account_email': makeElement(),
    'review-username': makeElement(),
    'review-stripe_reference': makeElement(),
    'review-cancellation_type': makeElement(),
    'review-reason': makeElement(),
    'receipt-request-id': makeElement(),
    'receipt-submitted-at': makeElement(),
    'receipt-status': makeElement(),
    'receipt-message': makeElement(),
  };
  return {
    getElementById: (id) => elements[id],
    querySelector: () => ({ value: fieldValues.cancellation_type || 'earliest', checked: true }),
    createElement: () => makeElement(),
    _elements: elements,
  };
}

it('does nothing when the expected markup is absent (no-op on other pages)', () => {
  const doc = { getElementById: () => null };
  assert.doesNotThrow(() => initCancelRequestForm(doc));
});

it('shows validation errors via textContent instead of submitting when fields are invalid', () => {
  const doc = makeFakeDocument({ contact_email: 'not-an-email' });
  initCancelRequestForm(doc);
  doc._elements['review-button']._listeners.click({ preventDefault() {} });
  assert.equal(doc._elements['form-errors'].hidden, false);
  assert.equal(doc._elements['cancel-request-form'].hidden, false); // stays on the form
});

it("routes the form's native 'submit' event (e.g. pressing Enter in a field) through the same review step, never a raw page submit", () => {
  const doc = makeFakeDocument({ contact_email: 'a@b.de', username: 'player1' });
  initCancelRequestForm(doc);
  let defaultPrevented = false;
  doc._elements['cancel-request-form']._listeners.submit({ preventDefault() { defaultPrevented = true; } });
  assert.equal(defaultPrevented, true);
  // Reached the review step directly from the form's submit event, never
  // a bare page navigation/reload and never skipping review straight to
  // the receipt.
  assert.equal(doc._elements['cancel-request-form'].hidden, true);
  assert.equal(doc._elements['review-panel'].hidden, false);
  assert.equal(doc._elements['receipt-panel'].hidden, true);
});

it('disables the review button and shows an error instead of submitting when no secure RNG is available', () => {
  const doc = makeFakeDocument({ contact_email: 'a@b.de', username: 'player1' });
  initCancelRequestForm(doc);
  withCrypto(undefined, () => {
    doc._elements['review-button']._listeners.click({ preventDefault() {} });
  });
  assert.equal(doc._elements['review-button'].disabled, true);
  assert.equal(doc._elements['form-errors'].hidden, false);
  // Never silently proceeds to review/receipt without a secure id.
  assert.equal(doc._elements['review-panel'].hidden, true);
  assert.equal(doc._elements['cancel-request-form'].hidden, false);
});

it('moves from form to a read-only review step on valid input, rendering values via textContent', () => {
  const doc = makeFakeDocument({ contact_email: 'a@b.de', username: 'player1', reason: '<b>xss</b>' });
  initCancelRequestForm(doc);
  doc._elements['review-button']._listeners.click({ preventDefault() {} });
  assert.equal(doc._elements['cancel-request-form'].hidden, true);
  assert.equal(doc._elements['review-panel'].hidden, false);
  // The raw (potentially unsafe) text is assigned as textContent, never parsed as markup.
  assert.equal(doc._elements['review-reason'].textContent, '<b>xss</b>');
});

it('disables the submit button immediately to prevent duplicate-click double submission', async () => {
  const doc = makeFakeDocument({ contact_email: 'a@b.de', username: 'player1' });
  let resolveFetch;
  let sentKey;
  const pending = new Promise((resolve) => { resolveFetch = resolve; });
  global.fetch = (url, opts) => { sentKey = JSON.parse(opts.body).idempotency_key; return pending; };
  global.window = { location: { origin: 'http://localhost' } };
  initCancelRequestForm(doc);
  doc._elements['review-button']._listeners.click({ preventDefault() {} });
  const submitButton = doc._elements['submit-button'];
  const first = submitButton._listeners.click({ preventDefault() {} });
  assert.equal(submitButton.disabled, true);
  // A second rapid click while in flight must not trigger a second request.
  let fetchCalls = 0;
  const originalFetch = global.fetch;
  global.fetch = (...args) => { fetchCalls++; return originalFetch(...args); };
  await submitButton._listeners.click({ preventDefault() {} });
  assert.equal(fetchCalls, 0);
  resolveFetch({ ok: true, status: 201, text: async () => JSON.stringify({
    request_id: sentKey, submitted_at: '2026-01-01T00:00:00+00:00',
    status: 'submitted', cancellation_type: 'earliest', message: 'ok',
  }) });
  await first;
  assert.equal(doc._elements['receipt-panel'].hidden, false);
  assert.equal(doc._elements['receipt-request-id'].textContent, sentKey);
  delete global.fetch;
  delete global.window;
});

it('keeps the same idempotency key across a failed submit retry instead of creating a duplicate', async () => {
  const doc = makeFakeDocument({ contact_email: 'a@b.de', username: 'player1' });
  const sentKeys = [];
  global.window = { location: { origin: 'http://localhost' } };
  let shouldFail = true;
  global.fetch = async (url, opts) => {
    const body = JSON.parse(opts.body);
    sentKeys.push(body.idempotency_key);
    if (shouldFail) {
      return { ok: false, status: 503, text: async () => JSON.stringify({ error: 'billing_provider_unavailable' }) };
    }
    return {
      ok: true, status: 201,
      text: async () => JSON.stringify({
        request_id: body.idempotency_key, submitted_at: 'now',
        status: 'submitted', cancellation_type: 'earliest', message: 'ok',
      }),
    };
  };
  initCancelRequestForm(doc);
  doc._elements['review-button']._listeners.click({ preventDefault() {} });
  await doc._elements['submit-button']._listeners.click({ preventDefault() {} });
  assert.equal(doc._elements['submit-button'].disabled, false); // re-enabled so the user can retry
  shouldFail = false;
  await doc._elements['submit-button']._listeners.click({ preventDefault() {} });
  assert.equal(sentKeys.length, 2);
  assert.equal(sentKeys[0], sentKeys[1]); // same key reused, not a fresh/duplicate request
  delete global.fetch;
  delete global.window;
});

// ============ Markup checks ============

it('cancel.html exposes a permanently visible public cancellation entry point and required form fields', () => {
  const page = fs.readFileSync(new URL('../cancel.html', import.meta.url), 'utf8');
  assert.match(page, /id="cancel-request-form"/);
  assert.match(page, /id="contact_email"/);
  assert.match(page, /id="review-button"/);
  assert.match(page, /id="submit-button"/);
  assert.match(page, /Kündigung jetzt absenden/);
  assert.match(page, /type="module"/);
  // No mandatory CAPTCHA/Turnstile or login barrier on this public form.
  assert.ok(!/turnstile/i.test(page));
});

it('cancel.html presents the no-login public form as the prominent primary route, with account login only as an optional secondary path', () => {
  const page = fs.readFileSync(new URL('../cancel.html', import.meta.url), 'utf8');
  const h1Index = page.indexOf('<h1>Abonnement Kündigung</h1>');
  const publicFormIndex = page.indexOf('id="cancel-request-form"');
  const accountLinkIndex = page.indexOf('href="/?account=billing"');
  assert.ok(h1Index >= 0 && publicFormIndex >= 0 && accountLinkIndex >= 0);
  // The no-login form must appear before the authenticated-account link,
  // not buried underneath it.
  assert.ok(publicFormIndex < accountLinkIndex,
    'public cancel-request form must be presented before the account-login link');
  // The account-login route is explicitly framed as optional, not required.
  assert.match(page, /optional/i);
});
