// parental-gate.js — Bilingual, accessible adult check for the app build.
//
// StoreKit and Google Play require a parental gate before a purchase, a
// restore or a link that leaves the app. The gate is deliberately not an
// arithmetic exercise from the game itself: levels 1-2 only add numbers up
// to 12, while this challenge multiplies two operands between 6 and 12
// (products 36-144) and spells both operands out in words. A child who can
// read the digits therefore still has to read and multiply.
//
// The module is DOM-free. buildGateMarkup() returns the accessible dialog
// markup and gate() asks the injected UI for an answer, so the purchase,
// restore and external-link flows can wire it without importing a renderer
// (and node:test can drive it with a fake UI). The answer never appears in
// the markup or in the question text.

export const SUPPORTED_LOCALES = Object.freeze(['en', 'de']);
export const DEFAULT_LOCALE = 'en';

/** Smallest and largest operand of the multiplication challenge. */
export const MIN_OPERAND = 6;
export const MAX_OPERAND = 12;

/** Actions that must be gated before they run. */
export const GATED_ACTIONS = Object.freeze(['purchase', 'restore', 'external-link']);

/** Operand words 0-12; the challenge only uses 6-12. */
export const NUMBER_WORDS = Object.freeze({
  en: Object.freeze([
    'zero', 'one', 'two', 'three', 'four', 'five', 'six',
    'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
  ]),
  de: Object.freeze([
    'null', 'eins', 'zwei', 'drei', 'vier', 'fünf', 'sechs',
    'sieben', 'acht', 'neun', 'zehn', 'elf', 'zwölf',
  ]),
});

/** All gate copy, keyed like the game's i18n dictionary. */
export const STRINGS = Object.freeze({
  'gate.title': { en: 'Parental gate', de: 'Elternkontrolle' },
  'gate.description': {
    en: 'This step protects purchases, restores and links that leave the app.',
    de: 'Dieser Schritt schützt Käufe, Wiederherstellungen und Links, die die App verlassen.',
  },
  'gate.question': { en: '{a} times {b}', de: '{a} mal {b}' },
  'gate.answerLabel': { en: 'Type the result', de: 'Ergebnis eingeben' },
  'gate.hint': {
    en: 'Ask an adult to solve this multiplication.',
    de: 'Bitte einen Erwachsenen, diese Multiplikation zu lösen.',
  },
  'gate.submit': { en: 'Continue', de: 'Weiter' },
  'gate.cancel': { en: 'Cancel', de: 'Abbrechen' },
});

/** Normalize an unknown locale to a supported one. */
export function resolveLocale(locale) {
  return SUPPORTED_LOCALES.includes(locale) ? locale : DEFAULT_LOCALE;
}

function translate(key, locale) {
  return STRINGS[key][resolveLocale(locale)];
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function assertChallenge(challenge) {
  const { a, b } = challenge ?? {};
  const valid = (value) => Number.isInteger(value) && value >= MIN_OPERAND && value <= MAX_OPERAND;
  if (!valid(a) || !valid(b)) {
    throw new RangeError(`challenge operands must be integers ${MIN_OPERAND}-${MAX_OPERAND}`);
  }
  return { a, b };
}

/**
 * Build a multiplication challenge from an injected random source.
 * @param {() => number} [random] source returning a number in [0, 1)
 * @returns {{a: number, b: number}} operands in [MIN_OPERAND, MAX_OPERAND]
 */
export function generateChallenge(random = Math.random) {
  if (typeof random !== 'function') {
    throw new TypeError('random must be a function');
  }
  const span = MAX_OPERAND - MIN_OPERAND + 1;
  const pick = () => {
    const value = Number(random());
    const bounded = Number.isFinite(value) ? Math.min(Math.max(value, 0), 1 - Number.EPSILON) : 0;
    return MIN_OPERAND + Math.floor(bounded * span);
  };
  return { a: pick(), b: pick() };
}

/**
 * Spell the challenge out in words, so the operands are not shown as digits.
 * @param {{a: number, b: number}} challenge multiplication challenge
 * @param {string} [locale] 'en' or 'de'
 * @returns {string} localized question, e.g. "six times twelve"
 */
export function questionText(challenge, locale = DEFAULT_LOCALE) {
  const { a, b } = assertChallenge(challenge);
  const words = NUMBER_WORDS[resolveLocale(locale)];
  return translate('gate.question', locale).replace('{a}', words[a]).replace('{b}', words[b]);
}

/**
 * Check an answer against the challenge's product. Only the exact integer
 * product is accepted; the sum, nearby products, fractions and text fail.
 * @param {{a: number, b: number}} challenge multiplication challenge
 * @param {unknown} value answer from the UI
 * @returns {boolean} true only for the exact product
 */
export function checkAnswer(challenge, value) {
  const { a, b } = assertChallenge(challenge);
  const product = a * b;
  if (typeof value === 'number') {
    return Number.isInteger(value) && value === product;
  }
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (!/^\d{1,3}$/.test(trimmed)) return false;
  return Number(trimmed) === product;
}

/**
 * Accessible gate markup. The question is spelled out in words and the
 * answer (and its digits) never appears; only the input's pattern attribute
 * mentions digit characters.
 * @param {{locale?: string, challenge: {a: number, b: number}}} options
 * @returns {string} dialog markup for the caller to insert
 */
export function buildGateMarkup({ locale = DEFAULT_LOCALE, challenge } = {}) {
  const loc = resolveLocale(locale);
  assertChallenge(challenge);
  const question = questionText(challenge, loc);
  const title = translate('gate.title', loc);
  const description = translate('gate.description', loc);
  const answerLabel = translate('gate.answerLabel', loc);
  const hint = translate('gate.hint', loc);
  return [
    '<div class="parental-gate parental-gate-card overlay-card" role="dialog" aria-modal="true"',
    '     aria-labelledby="parental-gate-title" aria-describedby="parental-gate-description">',
    `  <h2 id="parental-gate-title">${escapeHtml(title)}</h2>`,
    `  <p id="parental-gate-description">${escapeHtml(description)}</p>`,
    `  <p id="parental-gate-question" class="parental-gate-question">${escapeHtml(question)}</p>`,
    '  <form class="parental-gate-form">',
    `    <label for="parental-gate-answer">${escapeHtml(answerLabel)}</label>`,
    '    <input id="parental-gate-answer" name="parental-gate-answer" type="text"',
    '           inputmode="numeric" pattern="[0-9]*" autocomplete="off"',
    '           autocapitalize="off" spellcheck="false"',
    '           aria-describedby="parental-gate-question parental-gate-hint" />',
    `    <p id="parental-gate-hint">${escapeHtml(hint)}</p>`,
    '    <div class="parental-gate-actions">',
    `      <button type="submit" id="parental-gate-submit">${escapeHtml(translate('gate.submit', loc))}</button>`,
    `      <button type="button" id="parental-gate-cancel">${escapeHtml(translate('gate.cancel', loc))}</button>`,
    '    </div>',
    '  </form>',
    '</div>',
  ].join('\n');
}

function isCancellation(error) {
  if (!error || typeof error !== 'object') return false;
  return error.name === 'AbortError' || error.code === 'cancelled' || error.code === 'canceled';
}

/**
 * Ask the injected UI to solve a challenge. Resolves true only for the exact
 * product; a wrong answer, a dismissed dialog or a cancellation is false.
 * @param {{ui: {ask: Function}, random?: () => number, locale?: string, action?: string}} options
 * @returns {Promise<boolean>} whether an adult passed the gate
 */
export async function gate({ ui, random = Math.random, locale = DEFAULT_LOCALE, action } = {}) {
  if (!ui || typeof ui.ask !== 'function') {
    throw new TypeError('parental gate needs a ui.ask function');
  }
  if (action !== undefined && !GATED_ACTIONS.includes(action)) {
    throw new RangeError(`unknown gated action: ${action}`);
  }
  const loc = resolveLocale(locale);
  const challenge = generateChallenge(random);
  let answer;
  try {
    answer = await ui.ask({
      action: action ?? null,
      locale: loc,
      challenge: { a: challenge.a, b: challenge.b },
      question: questionText(challenge, loc),
      markup: buildGateMarkup({ locale: loc, challenge }),
    });
  } catch (error) {
    if (isCancellation(error)) return false;
    throw error;
  }
  return checkAnswer(challenge, answer);
}
