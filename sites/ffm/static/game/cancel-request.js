// cancel-request.js — Public, no-login subscription-cancellation request
// flow for Arithmo Slayer's static cancel.html page.
//
// This module never calls Stripe and never looks up or confirms whether
// an account/email exists: a submission is only a durable *request* for a
// human operator to manually review and action (see the backend's
// app/billing_admin.py `cancel-request` CLI command group). The UI must
// never claim the subscription was canceled — only that the request was
// received ("Anfrage erhalten", not "Kündigung bestätigt").
//
// All user-supplied text is rendered via textContent only (never
// innerHTML) to avoid reflecting untrusted input as markup/script.

export const MAX_EMAIL_LEN = 254;
export const MIN_USERNAME_LEN = 3;
export const MAX_USERNAME_LEN = 20;
export const MAX_REFERENCE_LEN = 128;
export const MAX_REASON_LEN = 2000;
export const MAX_FUTURE_DAYS = 3 * 365;

export function isValidEmail(value) {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (trimmed.length < 3 || trimmed.length > MAX_EMAIL_LEN) return false;
  // Basic structural check only (this flow never verifies deliverability
  // or account existence), mirroring the backend's app/cancel_requests.py
  // _valid_email(): no whitespace/control characters anywhere, exactly
  // one '@', and a non-empty local part and domain part either side.
  if (/[\s\x00-\x1f\x7f]/.test(trimmed)) return false;
  const atCount = (trimmed.match(/@/g) || []).length;
  if (atCount !== 1) return false;
  const [local, domain] = trimmed.split('@');
  return Boolean(local) && Boolean(domain);
}

export function isValidUsername(value) {
  if (typeof value !== 'string') return false;
  // Aligned with the actual account-username policy enforced server-side
  // at registration (app/auth.py: 3-20 chars, Python str.isalnum()) and
  // reused as-is by the backend's own cancel-request validation
  // (app/cancel_requests.py _valid_username) — str.isalnum() accepts any
  // Unicode letter/digit, not only ASCII, so this uses Unicode property
  // escapes rather than an ASCII-only [a-zA-Z0-9] regex to avoid
  // rejecting real, already-registered usernames this field is meant to
  // match against.
  return value.length >= MIN_USERNAME_LEN && value.length <= MAX_USERNAME_LEN && /^[\p{L}\p{N}]+$/u.test(value);
}

// Strict ISO 8601 calendar date (YYYY-MM-DD) check — rejects German
// DD.MM.YYYY and any other format (even though this page's own labels
// are German), and rejects invalid calendar dates like 2026-02-30.
export function isValidIsoDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function isFutureIsoDate(value, now = new Date()) {
  if (!isValidIsoDate(value)) return false;
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const [year, month, day] = value.split('-').map(Number);
  const target = new Date(Date.UTC(year, month - 1, day));
  if (target <= today) return false;
  const days = Math.round((target - today) / 86400000);
  return days <= MAX_FUTURE_DAYS;
}

export function generateIdempotencyKey() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback for browsers lacking crypto.randomUUID (but supporting the
  // older crypto.getRandomValues) still uses a cryptographically secure
  // random source — never Math.random(), which is not a secure RNG and
  // must not be used to mint an idempotency key that durably identifies
  // a cancellation request server-side.
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
    bytes[8] = (bytes[8] & 0x3f) | 0x80; // RFC 4122 variant
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  // No secure random source available at all: refuse to proceed rather
  // than silently falling back to Math.random() (predictable, and could
  // let an attacker guess/collide a durable request's idempotency key).
  const error = new Error(
    'Ihr Browser unterstuetzt die fuer dieses Formular erforderliche sichere ' +
    'Zufallszahlenerzeugung nicht (crypto.getRandomValues fehlt). Bitte verwenden Sie einen ' +
    'aktuellen Browser oder wenden Sie sich per E-Mail an uns.',
  );
  error.code = 'insecure_random_unsupported';
  throw error;
}

/**
 * Validate and normalize raw form field values.
 * @returns {{valid: boolean, errors: object, normalized: object}}
 */
export function validateFields(fields) {
  const errors = {};

  const contactEmail = (fields.contact_email || '').trim();
  if (!isValidEmail(contactEmail)) {
    errors.contact_email = 'Bitte eine gültige Kontakt-E-Mail-Adresse angeben.';
  }

  const accountEmail = (fields.account_email || '').trim();
  if (accountEmail && !isValidEmail(accountEmail)) {
    errors.account_email = 'Ungültige Konto-E-Mail-Adresse.';
  }

  const username = (fields.username || '').trim();
  if (username && !isValidUsername(username)) {
    errors.username = `Benutzername muss ${MIN_USERNAME_LEN}-${MAX_USERNAME_LEN} alphanumerische Zeichen haben.`;
  }

  const stripeReference = (fields.stripe_reference || '').trim();
  if (stripeReference.length > MAX_REFERENCE_LEN) {
    errors.stripe_reference = `Höchstens ${MAX_REFERENCE_LEN} Zeichen.`;
  }

  if (!accountEmail && !username && !stripeReference) {
    errors.identity = 'Bitte mindestens eines angeben: Konto-E-Mail, Benutzername oder Vertrags-/Zahlungsreferenz.';
  }

  const cancellationType = fields.cancellation_type;
  if (cancellationType !== 'earliest' && cancellationType !== 'requested_date') {
    errors.cancellation_type = 'Bitte eine Kündigungsart auswählen.';
  }

  let requestedDate = null;
  if (cancellationType === 'requested_date') {
    requestedDate = (fields.requested_date || '').trim();
    if (!isFutureIsoDate(requestedDate)) {
      errors.requested_date = 'Bitte ein gültiges, zukünftiges Datum auswählen.';
    }
  }

  const reason = (fields.reason || '').trim();
  if (reason.length > MAX_REASON_LEN) {
    errors.reason = `Höchstens ${MAX_REASON_LEN} Zeichen.`;
  }

  return {
    valid: Object.keys(errors).length === 0,
    errors,
    normalized: {
      contact_email: contactEmail.toLowerCase(),
      account_email: accountEmail ? accountEmail.toLowerCase() : null,
      username: username || null,
      stripe_reference: stripeReference || null,
      cancellation_type: cancellationType,
      requested_date: cancellationType === 'requested_date' ? requestedDate : null,
      reason: reason || null,
    },
  };
}

/** Plain-text receipt suitable for a client-side download — mirrors (but
 * does not replace) the structured JSON receipt the backend returns. */
export function buildReceiptText(receipt) {
  const lines = [
    'Kuendigungsanfrage - Eingangsbestaetigung',
    `Antrags-ID: ${receipt.request_id}`,
    `Eingereicht am (UTC): ${receipt.submitted_at}`,
    `Status: ${receipt.status} (Anfrage erhalten, NICHT bestaetigte Kuendigung)`,
    `Kuendigungsart: ${receipt.cancellation_type}`,
  ];
  if (receipt.requested_date) lines.push(`Gewuenschtes Datum: ${receipt.requested_date}`);
  lines.push(`Kontakt-E-Mail: ${receipt.contact_email}`);
  if (receipt.account_email) lines.push(`Konto-E-Mail: ${receipt.account_email}`);
  if (receipt.username) lines.push(`Benutzername: ${receipt.username}`);
  if (receipt.stripe_reference) lines.push(`Referenz: ${receipt.stripe_reference}`);
  if (receipt.reason) lines.push(`Anmerkung: ${receipt.reason}`);
  lines.push('', receipt.message || '');
  return lines.join('\n');
}

//: Fields a genuine receipt must actually carry before the UI is allowed
// to treat the request as durably received.
const REQUIRED_RECEIPT_FIELDS = ['request_id', 'submitted_at', 'status', 'cancellation_type', 'message'];

export async function submitCancelRequest(payload, { baseUrl = window.location.origin + '/api', fetchImpl = fetch } = {}) {
  const res = await fetchImpl(baseUrl + '/cancel-requests', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const rawText = await res.text();
  let data;
  try {
    // An empty body (e.g. a 204, or a proxy/gateway error page with no
    // JSON) is only ever treated as "no data", never silently coerced
    // into a fabricated success payload.
    data = rawText ? JSON.parse(rawText) : {};
  } catch (parseError) {
    // A malformed/non-JSON body (e.g. an HTML error page from a proxy)
    // must never be silently swallowed into an empty {} that a caller
    // could then misread as a valid (if sparse) receipt — propagate it
    // as an explicit, honest failure instead.
    const error = new Error(
      'Die Antwort des Servers konnte nicht gelesen werden (kein gueltiges JSON). ' +
      'Es wurde KEIN Eingang Ihrer Anfrage bestaetigt — bitte spaeter erneut versuchen.',
    );
    error.code = 'invalid_response';
    error.status = res.status;
    throw error;
  }
  if (!res.ok) {
    const error = new Error(data.message || data.error || 'request_failed');
    error.code = data.error;
    error.status = res.status;
    throw error;
  }
  // Even on an HTTP-success status, verify the receipt actually looks
  // like a real receipt — carries every required field, non-empty — and
  // that its request_id is the exact one we submitted (the server always
  // echoes it back as the idempotency key). Only then may the UI claim
  // the request was received; anything else is treated as a failure
  // rather than silently rendered as success with blank/wrong fields.
  const missing = REQUIRED_RECEIPT_FIELDS.filter(
    (field) => data[field] === undefined || data[field] === null || data[field] === '',
  );
  if (missing.length > 0 || data.request_id !== payload.idempotency_key) {
    const error = new Error(
      'Die Serverantwort ist unvollstaendig oder stimmt nicht mit der gesendeten Anfrage ueberein. ' +
      'Bitte kontaktieren Sie uns, bevor Sie davon ausgehen, dass Ihre Anfrage eingegangen ist.',
    );
    error.code = 'invalid_receipt';
    error.status = res.status;
    throw error;
  }
  return data;
}

const FIELD_IDS = ['contact_email', 'account_email', 'username', 'stripe_reference', 'reason'];

function readFormValues(doc) {
  const values = {};
  for (const id of FIELD_IDS) {
    values[id] = doc.getElementById(id).value;
  }
  const typeInput = doc.querySelector('input[name="cancellation_type"]:checked');
  values.cancellation_type = typeInput ? typeInput.value : null;
  values.requested_date = doc.getElementById('requested_date').value;
  return values;
}

function clearErrors(doc) {
  const box = doc.getElementById('form-errors');
  box.textContent = '';
  box.hidden = true;
}

function showErrors(doc, errors) {
  const box = doc.getElementById('form-errors');
  box.textContent = '';
  for (const message of Object.values(errors)) {
    const li = doc.createElement('li');
    li.textContent = message; // textContent only — never innerHTML with user/error strings
    box.appendChild(li);
  }
  box.hidden = false;
}

function renderReview(doc, normalized) {
  const typeLabel = normalized.cancellation_type === 'requested_date'
    ? `Zum ${normalized.requested_date} (wird manuell geprüft)`
    : 'Zum frühestmöglichen Zeitpunkt';
  const rows = {
    'review-contact_email': normalized.contact_email,
    'review-account_email': normalized.account_email || '(nicht angegeben)',
    'review-username': normalized.username || '(nicht angegeben)',
    'review-stripe_reference': normalized.stripe_reference || '(nicht angegeben)',
    'review-cancellation_type': typeLabel,
    'review-reason': normalized.reason || '(keine Anmerkung)',
  };
  for (const [id, text] of Object.entries(rows)) {
    doc.getElementById(id).textContent = text; // textContent only — avoids reflecting user input as HTML
  }
}

function renderReceipt(doc, receipt) {
  doc.getElementById('receipt-request-id').textContent = receipt.request_id;
  doc.getElementById('receipt-submitted-at').textContent = receipt.submitted_at;
  doc.getElementById('receipt-status').textContent = receipt.status;
  doc.getElementById('receipt-message').textContent = receipt.message;
}

/**
 * Wire up the two-step review-then-submit cancellation request form.
 * Call once on page load with the live `document`.
 */
export function initCancelRequestForm(doc = document) {
  const form = doc.getElementById('cancel-request-form');
  if (!form) return; // Markup not present on this page/test context.

  const reviewPanel = doc.getElementById('review-panel');
  const receiptPanel = doc.getElementById('receipt-panel');
  const reviewButton = doc.getElementById('review-button');
  const editButton = doc.getElementById('edit-button');
  const submitButton = doc.getElementById('submit-button');
  const downloadLink = doc.getElementById('download-receipt');

  let pendingIdempotencyKey = null;
  let pendingPayload = null;

  function showForm() {
    form.hidden = false;
    reviewPanel.hidden = true;
    receiptPanel.hidden = true;
  }

  function showReview(normalized) {
    renderReview(doc, normalized);
    form.hidden = true;
    reviewPanel.hidden = false;
    receiptPanel.hidden = true;
  }

  function showReceipt(receipt) {
    renderReceipt(doc, receipt);
    form.hidden = true;
    reviewPanel.hidden = true;
    receiptPanel.hidden = false;
    if (downloadLink) {
      const blob = new Blob([buildReceiptText(receipt)], { type: 'text/plain;charset=utf-8' });
      downloadLink.href = URL.createObjectURL(blob);
      downloadLink.download = `kuendigungsanfrage-${receipt.request_id}.txt`;
      downloadLink.hidden = false;
    }
  }

  function performReview(event) {
    event.preventDefault();
    clearErrors(doc);
    const { valid, errors, normalized } = validateFields(readFormValues(doc));
    if (!valid) {
      showErrors(doc, errors);
      return;
    }
    // A fresh idempotency key is minted only when the reviewed payload
    // actually changes, so re-reviewing the same unmodified details before
    // submitting (or retrying after a failed submit) reuses the same key
    // rather than risking a duplicate durable request.
    const serialized = JSON.stringify(normalized);
    if (pendingPayload !== serialized) {
      try {
        pendingIdempotencyKey = generateIdempotencyKey();
      } catch (error) {
        // No secure random source available in this browser: refuse to
        // proceed to review rather than silently using an insecure
        // fallback id, and disable the review button so the user cannot
        // keep retrying the same unsupported path.
        showErrors(doc, { submit: error.message || 'Dieser Browser wird nicht unterstuetzt.' });
        reviewButton.disabled = true;
        return;
      }
      pendingPayload = serialized;
    }
    showReview(normalized);
  }

  reviewButton.addEventListener('click', performReview);

  // A <form> with multiple fields and no type="submit" button can still
  // be natively submitted by pressing Enter in a text field in some
  // browsers — which would issue a real (GET, by default) page
  // navigation/reload carrying field values as a URL query string,
  // bypassing the mandatory review step entirely and leaking
  // email/username/reason into the URL/history/referrer. Explicitly
  // intercepting the form's own 'submit' event (which fires regardless
  // of *what* triggered it — click or Enter) and always preventing the
  // default, routing it through the exact same review step, closes that
  // off without weakening the two-step review-then-submit flow.
  form.addEventListener('submit', performReview);

  editButton.addEventListener('click', (event) => {
    event.preventDefault();
    showForm();
  });

  submitButton.addEventListener('click', async (event) => {
    event.preventDefault();
    if (submitButton.disabled) return; // guards against double-click/double-submit
    submitButton.disabled = true;
    submitButton.setAttribute('aria-busy', 'true');
    clearErrors(doc);
    try {
      const normalized = JSON.parse(pendingPayload);
      const payload = { ...normalized, idempotency_key: pendingIdempotencyKey };
      const receipt = await submitCancelRequest(payload);
      showReceipt(receipt);
    } catch (error) {
      // Honest failure: the same idempotency key is kept so a retry
      // cannot create a duplicate durable request, and nothing here
      // claims success.
      showErrors(doc, { submit: error.message || 'Senden fehlgeschlagen. Bitte erneut versuchen.' });
      submitButton.disabled = false;
      submitButton.removeAttribute('aria-busy');
    }
  });
}
