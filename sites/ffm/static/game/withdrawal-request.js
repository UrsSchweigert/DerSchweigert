// withdrawal-request.js — Public, no-login withdrawal ("Vertrag
// widerrufen") declaration flow for Arithmo Slayer's static widerruf.html
// page.
//
// Distinct from cancel-request.js (subscription-cancellation requests):
// this exercises the statutory withdrawal right (Sec. 355/356 BGB), never
// calls Stripe, and never looks up or confirms whether an account/email
// exists. A submission is only a durable *declaration* for a human
// operator to manually review and action (see the backend's
// app/billing_admin.py `withdrawal-request` CLI command group). Unlike
// cancel-request.js, this flow also provides an *immediate* email receipt
// and a no-login, token-gated downloadable receipt (the backend mints and
// returns a one-time receipt_token at submission time — this module never
// builds its own receipt text, it links to the server's own durable copy).
//
// The withdrawal statement text itself is never free text the client can
// edit — only a language (de/en) selector is sent to the server, and the
// exact text shown here must match app/legal_texts.py's
// WITHDRAWAL_STATEMENT verbatim, so what the user sees/confirms is exactly
// what gets durably recorded as their declaration.
//
// All user-supplied text is rendered via textContent only (never
// innerHTML) to avoid reflecting untrusted input as markup/script.

export const MAX_EMAIL_LEN = 254;
export const MIN_USERNAME_LEN = 3;
export const MAX_USERNAME_LEN = 20;
export const MAX_REFERENCE_LEN = 128;
export const MAX_REASON_LEN = 2000;

//: Must match app/legal_texts.py's WITHDRAWAL_STATEMENT exactly. The
// server is always authoritative: it records/emails only this canonical
// text (looked up server-side from the language selector sent below),
// never anything supplied by the client, so a mismatch here only ever
// means the page shows the wrong *preview* text, never a forged consent.
export const WITHDRAWAL_STATEMENT = {
  de: 'Hiermit widerrufe ich den von mir abgeschlossenen Vertrag über die Bereitstellung der ' +
    'kostenpflichtigen digitalen Inhalte (Arithmo Slayer Premium-Abonnement).',
  en: 'I hereby withdraw from the contract I entered into for the supply of the paid digital ' +
    'content (Arithmo Slayer premium subscription).',
};

export function isValidEmail(value) {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (trimmed.length < 3 || trimmed.length > MAX_EMAIL_LEN) return false;
  if (/[\s\x00-\x1f\x7f]/.test(trimmed)) return false;
  const atCount = (trimmed.match(/@/g) || []).length;
  if (atCount !== 1) return false;
  const [local, domain] = trimmed.split('@');
  return Boolean(local) && Boolean(domain);
}

export function isValidUsername(value) {
  if (typeof value !== 'string') return false;
  return value.length >= MIN_USERNAME_LEN && value.length <= MAX_USERNAME_LEN && /^[\p{L}\p{N}]+$/u.test(value);
}

export function generateIdempotencyKey() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Never falls back to Math.random() -- see cancel-request.js for the
  // identical reasoning: an idempotency key here durably identifies a
  // statutory withdrawal declaration server-side and must come from a
  // cryptographically secure source.
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
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

  const statementLanguage = fields.statement_language;
  if (statementLanguage !== 'de' && statementLanguage !== 'en') {
    errors.statement_language = 'Bitte eine Sprache für die Erklärung auswählen.';
  }

  if (fields.statement_confirmed !== true) {
    errors.statement_confirmed = 'Bitte die Widerrufserklärung oben ausdrücklich bestätigen.';
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
      statement_language: statementLanguage,
      statement_confirmed: fields.statement_confirmed === true,
      reason: reason || null,
    },
  };
}

//: Fields a genuine receipt must actually carry before the UI is allowed
// to treat the declaration as durably received.
const REQUIRED_RECEIPT_FIELDS = ['request_id', 'submitted_at', 'status', 'statement_language', 'message'];

export async function submitWithdrawalRequest(payload, { baseUrl = window.location.origin + '/api', fetchImpl = fetch } = {}) {
  const res = await fetchImpl(baseUrl + '/withdrawal-requests', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const rawText = await res.text();
  let data;
  try {
    data = rawText ? JSON.parse(rawText) : {};
  } catch (parseError) {
    const error = new Error(
      'Die Antwort des Servers konnte nicht gelesen werden (kein gueltiges JSON). ' +
      'Es wurde KEIN Eingang Ihrer Widerrufserklaerung bestaetigt — bitte spaeter erneut versuchen.',
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
  const missing = REQUIRED_RECEIPT_FIELDS.filter(
    (field) => data[field] === undefined || data[field] === null || data[field] === '',
  );
  if (missing.length > 0 || data.request_id !== payload.idempotency_key) {
    const error = new Error(
      'Die Serverantwort ist unvollstaendig oder stimmt nicht mit der gesendeten Erklaerung ueberein. ' +
      'Bitte kontaktieren Sie uns, bevor Sie davon ausgehen, dass Ihr Widerruf eingegangen ist.',
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
  const langInput = doc.querySelector('input[name="statement_language"]:checked');
  values.statement_language = langInput ? langInput.value : null;
  values.statement_confirmed = Boolean(doc.getElementById('statement_confirmed')?.checked);
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
    li.textContent = message;
    box.appendChild(li);
  }
  box.hidden = false;
}

function renderReview(doc, normalized) {
  const rows = {
    'review-contact_email': normalized.contact_email,
    'review-account_email': normalized.account_email || '(nicht angegeben)',
    'review-username': normalized.username || '(nicht angegeben)',
    'review-stripe_reference': normalized.stripe_reference || '(nicht angegeben)',
    'review-statement_language': normalized.statement_language === 'en' ? 'Englisch' : 'Deutsch',
    'review-statement': WITHDRAWAL_STATEMENT[normalized.statement_language],
    'review-reason': normalized.reason || '(keine Anmerkung)',
  };
  for (const [id, text] of Object.entries(rows)) {
    const el = doc.getElementById(id);
    if (el) el.textContent = text;
  }
}

function renderReceipt(doc, receipt) {
  doc.getElementById('receipt-request-id').textContent = receipt.request_id;
  doc.getElementById('receipt-submitted-at').textContent = receipt.submitted_at;
  doc.getElementById('receipt-status').textContent = receipt.status;
  doc.getElementById('receipt-message').textContent = receipt.message;
  const downloadLink = doc.getElementById('download-receipt');
  if (downloadLink) {
    if (receipt.receipt_download_url) {
      // Links directly to the server's own durable, token-gated receipt
      // (no-login) -- this module never fabricates its own client-side
      // receipt copy for withdrawal declarations.
      downloadLink.href = receipt.receipt_download_url;
      downloadLink.hidden = false;
    } else {
      // An idempotent replay of an already-submitted declaration never
      // re-issues the original (otherwise-unrecoverable) token — the
      // receipt was already shown once at first submission.
      downloadLink.hidden = true;
    }
  }
}

/**
 * Wire up the two-step review-then-submit withdrawal declaration form.
 * Call once on page load with the live `document`.
 */
export function initWithdrawalRequestForm(doc = document) {
  const form = doc.getElementById('withdrawal-request-form');
  if (!form) return; // Markup not present on this page/test context.

  const reviewPanel = doc.getElementById('review-panel');
  const receiptPanel = doc.getElementById('receipt-panel');
  const reviewButton = doc.getElementById('review-button');
  const editButton = doc.getElementById('edit-button');
  const submitButton = doc.getElementById('submit-button');

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
  }

  function performReview(event) {
    event.preventDefault();
    clearErrors(doc);
    const { valid, errors, normalized } = validateFields(readFormValues(doc));
    if (!valid) {
      showErrors(doc, errors);
      return;
    }
    const serialized = JSON.stringify(normalized);
    if (pendingPayload !== serialized) {
      try {
        pendingIdempotencyKey = generateIdempotencyKey();
      } catch (error) {
        showErrors(doc, { submit: error.message || 'Dieser Browser wird nicht unterstuetzt.' });
        reviewButton.disabled = true;
        return;
      }
      pendingPayload = serialized;
    }
    showReview(normalized);
  }

  reviewButton.addEventListener('click', performReview);
  // See cancel-request.js for why the form's own 'submit' event is also
  // intercepted (Enter-key native submission bypassing the review step).
  form.addEventListener('submit', performReview);

  editButton.addEventListener('click', (event) => {
    event.preventDefault();
    showForm();
  });

  submitButton.addEventListener('click', async (event) => {
    event.preventDefault();
    if (submitButton.disabled) return;
    submitButton.disabled = true;
    submitButton.setAttribute('aria-busy', 'true');
    clearErrors(doc);
    try {
      const normalized = JSON.parse(pendingPayload);
      const payload = { ...normalized, idempotency_key: pendingIdempotencyKey };
      const receipt = await submitWithdrawalRequest(payload);
      showReceipt(receipt);
    } catch (error) {
      showErrors(doc, { submit: error.message || 'Senden fehlgeschlagen. Bitte erneut versuchen.' });
      submitButton.disabled = false;
      submitButton.removeAttribute('aria-busy');
    }
  });
}
