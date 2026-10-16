import { it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  isValidEmail, isValidUsername, generateIdempotencyKey, validateFields,
  WITHDRAWAL_STATEMENT, submitWithdrawalRequest, initWithdrawalRequestForm,
} from './withdrawal-request.js';

// ============ Pure validation helpers ============

it('validates emails with basic bounds', () => {
  assert.equal(isValidEmail('a@b.de'), true);
  assert.equal(isValidEmail('not-an-email'), false);
  assert.equal(isValidEmail(''), false);
  assert.equal(isValidEmail(null), false);
});

it('validates usernames as 3-20 alphanumeric characters', () => {
  assert.equal(isValidUsername('abc'), true);
  assert.equal(isValidUsername('ab'), false);
  assert.equal(isValidUsername('a'.repeat(21)), false);
  assert.equal(isValidUsername('has space'), false);
});

it('generates RFC4122-shaped idempotency keys', () => {
  const key = generateIdempotencyKey();
  assert.match(key, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  assert.notEqual(key, generateIdempotencyKey());
});

it('exposes the exact DE/EN withdrawal statement text that must match app/legal_texts.py verbatim', () => {
  assert.equal(
    WITHDRAWAL_STATEMENT.de,
    'Hiermit widerrufe ich den von mir abgeschlossenen Vertrag über die Bereitstellung der '
    + 'kostenpflichtigen digitalen Inhalte (Arithmo Slayer Premium-Abonnement).',
  );
  assert.equal(
    WITHDRAWAL_STATEMENT.en,
    'I hereby withdraw from the contract I entered into for the supply of the paid digital '
    + 'content (Arithmo Slayer premium subscription).',
  );
});

it('rejects a submission with no identifying information at all', () => {
  const { valid, errors } = validateFields({
    contact_email: 'contact@example.com', account_email: '', username: '', stripe_reference: '',
    statement_language: 'de', statement_confirmed: true,
  });
  assert.equal(valid, false);
  assert.ok(errors.identity);
});

it('accepts a minimal valid submission identified only by username', () => {
  const { valid, normalized } = validateFields({
    contact_email: 'Contact@Example.com', account_email: '', username: 'player1', stripe_reference: '',
    statement_language: 'de', statement_confirmed: true, reason: '  bitte widerrufen  ',
  });
  assert.equal(valid, true);
  assert.equal(normalized.contact_email, 'contact@example.com');
  assert.equal(normalized.username, 'player1');
  assert.equal(normalized.reason, 'bitte widerrufen');
});

it('requires an explicit statement_language selection', () => {
  const { valid, errors } = validateFields({
    contact_email: 'a@b.de', username: 'player1', statement_language: 'fr', statement_confirmed: true,
  });
  assert.equal(valid, false);
  assert.ok(errors.statement_language);
});

it('requires the statement to be explicitly confirmed, not merely implied', () => {
  const { valid, errors } = validateFields({
    contact_email: 'a@b.de', username: 'player1', statement_language: 'de', statement_confirmed: false,
  });
  assert.equal(valid, false);
  assert.ok(errors.statement_confirmed);
});

it('bounds the free-text reason length', () => {
  const { valid, errors } = validateFields({
    contact_email: 'a@b.de', username: 'player1', statement_language: 'de', statement_confirmed: true,
    reason: 'x'.repeat(2001),
  });
  assert.equal(valid, false);
  assert.ok(errors.reason);
});

it('rejects an invalid stripe_reference length but allows it as sole identity', () => {
  const tooLong = validateFields({
    contact_email: 'a@b.de', stripe_reference: 'x'.repeat(129), statement_language: 'de', statement_confirmed: true,
  });
  assert.equal(tooLong.valid, false);
  assert.ok(tooLong.errors.stripe_reference);

  const { valid, normalized } = validateFields({
    contact_email: 'a@b.de', stripe_reference: 'cus_abc123', statement_language: 'en', statement_confirmed: true,
  });
  assert.equal(valid, true);
  assert.equal(normalized.stripe_reference, 'cus_abc123');
});

// ============ submitWithdrawalRequest ============

it('throws an honest error (without claiming success) when the server rejects the request', async () => {
  const fetchImpl = async () => ({
    ok: false, status: 400,
    text: async () => JSON.stringify({ error: 'statement_confirmation_required', message: 'missing confirmation' }),
  });
  await assert.rejects(
    submitWithdrawalRequest({ idempotency_key: 'x' }, { baseUrl: 'http://x', fetchImpl }),
    (err) => { assert.equal(err.code, 'statement_confirmation_required'); return true; },
  );
});

it('returns the parsed receipt (with download URL) on success without mutating the payload', async () => {
  let sentBody;
  const fetchImpl = async (url, opts) => {
    sentBody = JSON.parse(opts.body);
    return {
      ok: true, status: 201,
      text: async () => JSON.stringify({
        request_id: 'req-2', submitted_at: '2026-01-01T00:00:00+00:00',
        status: 'received', statement_language: 'de', message: 'ok',
        receipt_download_url: 'https://example.com/api/withdrawal-requests/req-2/receipt?token=abc',
      }),
    };
  };
  const receipt = await submitWithdrawalRequest({ idempotency_key: 'req-2', contact_email: 'a@b.de' },
    { baseUrl: 'http://x', fetchImpl });
  assert.equal(receipt.request_id, 'req-2');
  assert.ok(receipt.receipt_download_url);
  assert.equal(sentBody.idempotency_key, 'req-2');
});

it('propagates a malformed/non-JSON response body as an honest failure instead of an empty receipt', async () => {
  const fetchImpl = async () => ({ ok: true, status: 201, text: async () => '<html>not json</html>' });
  await assert.rejects(
    submitWithdrawalRequest({ idempotency_key: 'req-x' }, { baseUrl: 'http://x', fetchImpl }),
    (err) => { assert.equal(err.code, 'invalid_response'); return true; },
  );
});

it('rejects a success response missing required receipt fields rather than claiming it was received', async () => {
  const fetchImpl = async () => ({
    ok: true, status: 201,
    text: async () => JSON.stringify({ request_id: 'req-y', status: 'received' }), // missing submitted_at/message/etc.
  });
  await assert.rejects(
    submitWithdrawalRequest({ idempotency_key: 'req-y' }, { baseUrl: 'http://x', fetchImpl }),
    (err) => { assert.equal(err.code, 'invalid_receipt'); return true; },
  );
});

it('rejects a success response whose request_id does not match the submitted idempotency key', async () => {
  const fetchImpl = async () => ({
    ok: true, status: 201,
    text: async () => JSON.stringify({
      request_id: 'some-other-id', submitted_at: '2026-01-01T00:00:00+00:00',
      status: 'received', statement_language: 'de', message: 'ok',
    }),
  });
  await assert.rejects(
    submitWithdrawalRequest({ idempotency_key: 'req-z' }, { baseUrl: 'http://x', fetchImpl }),
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
    'withdrawal-request-form': makeElement({ hidden: false }),
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
    'reason': makeElement({ value: fieldValues.reason || '' }),
    'statement_confirmed': makeElement({ checked: fieldValues.statement_confirmed !== false }),
    'review-contact_email': makeElement(),
    'review-account_email': makeElement(),
    'review-username': makeElement(),
    'review-stripe_reference': makeElement(),
    'review-statement_language': makeElement(),
    'review-statement': makeElement(),
    'review-reason': makeElement(),
    'receipt-request-id': makeElement(),
    'receipt-submitted-at': makeElement(),
    'receipt-status': makeElement(),
    'receipt-message': makeElement(),
  };
  return {
    getElementById: (id) => elements[id],
    querySelector: () => ({ value: fieldValues.statement_language || 'de', checked: true }),
    createElement: () => makeElement(),
    _elements: elements,
  };
}

it('does nothing when the expected markup is absent (no-op on other pages)', () => {
  const doc = { getElementById: () => null };
  assert.doesNotThrow(() => initWithdrawalRequestForm(doc));
});

it('shows validation errors via textContent instead of submitting when fields are invalid', () => {
  const doc = makeFakeDocument({ contact_email: 'not-an-email' });
  initWithdrawalRequestForm(doc);
  doc._elements['review-button']._listeners.click({ preventDefault() {} });
  assert.equal(doc._elements['form-errors'].hidden, false);
  assert.equal(doc._elements['withdrawal-request-form'].hidden, false); // stays on the form
});

it("routes the form's native 'submit' event (e.g. pressing Enter in a field) through the same review step, never a raw page submit", () => {
  const doc = makeFakeDocument({ contact_email: 'a@b.de', username: 'player1' });
  initWithdrawalRequestForm(doc);
  let defaultPrevented = false;
  doc._elements['withdrawal-request-form']._listeners.submit({ preventDefault() { defaultPrevented = true; } });
  assert.equal(defaultPrevented, true);
  assert.equal(doc._elements['withdrawal-request-form'].hidden, true);
  assert.equal(doc._elements['review-panel'].hidden, false);
  assert.equal(doc._elements['receipt-panel'].hidden, true);
});

it('disables the review button and shows an error instead of submitting when no secure RNG is available', () => {
  const doc = makeFakeDocument({ contact_email: 'a@b.de', username: 'player1' });
  initWithdrawalRequestForm(doc);
  withCrypto(undefined, () => {
    doc._elements['review-button']._listeners.click({ preventDefault() {} });
  });
  assert.equal(doc._elements['review-button'].disabled, true);
  assert.equal(doc._elements['form-errors'].hidden, false);
  assert.equal(doc._elements['review-panel'].hidden, true);
  assert.equal(doc._elements['withdrawal-request-form'].hidden, false);
});

it('moves from form to a read-only review step on valid input, rendering the canonical statement text via textContent', () => {
  const doc = makeFakeDocument({ contact_email: 'a@b.de', username: 'player1', reason: '<b>xss</b>' });
  initWithdrawalRequestForm(doc);
  doc._elements['review-button']._listeners.click({ preventDefault() {} });
  assert.equal(doc._elements['withdrawal-request-form'].hidden, true);
  assert.equal(doc._elements['review-panel'].hidden, false);
  assert.equal(doc._elements['review-statement'].textContent, WITHDRAWAL_STATEMENT.de);
  assert.equal(doc._elements['review-reason'].textContent, '<b>xss</b>');
});

it('shows the receipt with a download link when the server returns one', async () => {
  const doc = makeFakeDocument({ contact_email: 'a@b.de', username: 'player1' });
  let sentKey;
  global.fetch = async (url, opts) => {
    sentKey = JSON.parse(opts.body).idempotency_key;
    return {
      ok: true, status: 201,
      text: async () => JSON.stringify({
        request_id: sentKey, submitted_at: '2026-01-01T00:00:00+00:00',
        status: 'received', statement_language: 'de', message: 'ok',
        receipt_download_url: 'https://example.com/receipt?token=abc',
      }),
    };
  };
  global.window = { location: { origin: 'http://localhost' } };
  initWithdrawalRequestForm(doc);
  doc._elements['review-button']._listeners.click({ preventDefault() {} });
  await doc._elements['submit-button']._listeners.click({ preventDefault() {} });
  assert.equal(doc._elements['receipt-panel'].hidden, false);
  assert.equal(doc._elements['receipt-request-id'].textContent, sentKey);
  assert.equal(doc._elements['download-receipt'].hidden, false);
  assert.equal(doc._elements['download-receipt'].href, 'https://example.com/receipt?token=abc');
  delete global.fetch;
  delete global.window;
});

it('hides the download link on an idempotent replay that omits receipt_download_url (token never re-issued)', async () => {
  const doc = makeFakeDocument({ contact_email: 'a@b.de', username: 'player1' });
  global.fetch = async (url, opts) => {
    const body = JSON.parse(opts.body);
    return {
      ok: true, status: 200,
      text: async () => JSON.stringify({
        request_id: body.idempotency_key, submitted_at: '2026-01-01T00:00:00+00:00',
        status: 'received', statement_language: 'de', message: 'bereits eingegangen',
        // No receipt_download_url on replay.
      }),
    };
  };
  global.window = { location: { origin: 'http://localhost' } };
  initWithdrawalRequestForm(doc);
  doc._elements['review-button']._listeners.click({ preventDefault() {} });
  await doc._elements['submit-button']._listeners.click({ preventDefault() {} });
  assert.equal(doc._elements['receipt-panel'].hidden, false);
  assert.equal(doc._elements['download-receipt'].hidden, true);
  delete global.fetch;
  delete global.window;
});

it('disables the submit button immediately to prevent duplicate-click double submission', async () => {
  const doc = makeFakeDocument({ contact_email: 'a@b.de', username: 'player1' });
  let resolveFetch;
  let sentKey;
  const pending = new Promise((resolve) => { resolveFetch = resolve; });
  global.fetch = (url, opts) => { sentKey = JSON.parse(opts.body).idempotency_key; return pending; };
  global.window = { location: { origin: 'http://localhost' } };
  initWithdrawalRequestForm(doc);
  doc._elements['review-button']._listeners.click({ preventDefault() {} });
  const submitButton = doc._elements['submit-button'];
  const first = submitButton._listeners.click({ preventDefault() {} });
  assert.equal(submitButton.disabled, true);
  let fetchCalls = 0;
  const originalFetch = global.fetch;
  global.fetch = (...args) => { fetchCalls++; return originalFetch(...args); };
  await submitButton._listeners.click({ preventDefault() {} });
  assert.equal(fetchCalls, 0);
  resolveFetch({ ok: true, status: 201, text: async () => JSON.stringify({
    request_id: sentKey, submitted_at: '2026-01-01T00:00:00+00:00',
    status: 'received', statement_language: 'de', message: 'ok',
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
      return { ok: false, status: 503, text: async () => JSON.stringify({ error: 'ses_unavailable' }) };
    }
    return {
      ok: true, status: 201,
      text: async () => JSON.stringify({
        request_id: body.idempotency_key, submitted_at: 'now',
        status: 'received', statement_language: 'de', message: 'ok',
      }),
    };
  };
  initWithdrawalRequestForm(doc);
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

it('widerruf.html exposes a permanently visible, no-login withdrawal entry point and required form fields', () => {
  const page = fs.readFileSync(new URL('../widerruf.html', import.meta.url), 'utf8');
  assert.match(page, /id="withdrawal-request-form"/);
  assert.match(page, /id="contact_email"/);
  assert.match(page, /id="statement_confirmed"/);
  assert.match(page, /name="statement_language"/);
  assert.match(page, /id="review-button"/);
  assert.match(page, /id="submit-button"/);
  assert.match(page, /id="download-receipt"/);
  assert.match(page, /type="module"/);
  assert.match(page, /initWithdrawalRequestForm/);
  // No mandatory CAPTCHA/Turnstile or login barrier on this public form.
  assert.ok(!/turnstile/i.test(page));
});

it('widerruf.html shows the exact canonical DE withdrawal statement text verbatim', () => {
  const page = fs.readFileSync(new URL('../widerruf.html', import.meta.url), 'utf8');
  assert.ok(page.includes(WITHDRAWAL_STATEMENT.de));
});

it('widerruf.html links to/from cancel.html so users can find the right form for their situation', () => {
  const widerruf = fs.readFileSync(new URL('../widerruf.html', import.meta.url), 'utf8');
  const cancel = fs.readFileSync(new URL('../cancel.html', import.meta.url), 'utf8');
  assert.match(widerruf, /href="\/cancel\.html"|href="cancel\.html"/);
  assert.match(cancel, /href="widerruf\.html"/);
});
