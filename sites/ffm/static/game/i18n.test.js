import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  getLocale,
  setLocale,
  toggleLocale,
  onLocaleChange,
  t,
  translateServerMessage,
  translateDom,
  initI18n,
  _resetForTests,
  SUPPORTED_LOCALES,
  DEFAULT_LOCALE,
} from './i18n.js';

// --- Minimal fake localStorage -------------------------------------------
// Node has no global `localStorage` by default (confirmed: ReferenceError
// without --experimental-webstorage), so this is a safe, isolated stand-in
// that never touches real browser/user storage.
function makeFakeStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
    clear: () => { map.clear(); },
  };
}

// --- Minimal fake DOM node/document for translateDom() tests -------------
function makeFakeElement(attrs = {}) {
  return {
    _attrs: { ...attrs },
    textContent: '',
    innerHTML: '',
    getAttribute(name) { return this._attrs[name] ?? null; },
    setAttribute(name, value) { this._attrs[name] = value; },
  };
}

function makeFakeDocument(elementsBySelector) {
  return {
    documentElement: { lang: '' },
    querySelectorAll(selector) {
      const list = elementsBySelector[selector] || [];
      return { forEach: (fn) => list.forEach(fn) };
    },
  };
}

beforeEach(() => {
  _resetForTests();
  delete globalThis.localStorage;
  delete globalThis.navigator;
  delete globalThis.document;
  delete globalThis.window;
});

afterEach(() => {
  _resetForTests();
  delete globalThis.localStorage;
  delete globalThis.navigator;
  delete globalThis.document;
  delete globalThis.window;
});

describe('locale detection', () => {
  it('defaults to English when there is no navigator/localStorage', () => {
    assert.equal(getLocale(), DEFAULT_LOCALE);
    assert.equal(getLocale(), 'en');
  });

  it('detects German from navigator.languages', () => {
    globalThis.navigator = { languages: ['de-DE', 'en-US'] };
    assert.equal(getLocale(), 'de');
  });

  it('detects German from navigator.language when languages is absent', () => {
    globalThis.navigator = { language: 'de-AT' };
    assert.equal(getLocale(), 'de');
  });

  it('respects the first supported language in the browser preference list', () => {
    globalThis.navigator = { languages: ['en-US', 'de-DE'] };
    assert.equal(getLocale(), 'en');
  });

  it('falls back to English for non-German locales', () => {
    globalThis.navigator = { languages: ['fr-FR', 'en-GB'] };
    assert.equal(getLocale(), 'en');
  });

  it('a stored locale takes precedence over browser detection', () => {
    globalThis.navigator = { languages: ['de-DE'] };
    globalThis.localStorage = makeFakeStorage();
    globalThis.localStorage.setItem('ffm_locale', 'en');
    assert.equal(getLocale(), 'en');
  });

  it('a `?lang=` URL param overrides stored/browser locale (auth-action email links)', () => {
    globalThis.window = { location: { search: '?lang=de' } };
    globalThis.navigator = { languages: ['en-US'] };
    globalThis.localStorage = makeFakeStorage();
    globalThis.localStorage.setItem('ffm_locale', 'en');
    assert.equal(getLocale(), 'de');
  });

  it('an unsupported `?lang=` value is ignored, falling through to stored/browser locale', () => {
    globalThis.window = { location: { search: '?lang=fr' } };
    globalThis.localStorage = makeFakeStorage();
    globalThis.localStorage.setItem('ffm_locale', 'en');
    assert.equal(getLocale(), 'en');
  });

  it('the `?lang=` URL override is session-only and never persisted to localStorage', () => {
    globalThis.window = { location: { search: '?lang=de' } };
    globalThis.localStorage = makeFakeStorage();
    assert.equal(getLocale(), 'de');
    assert.equal(globalThis.localStorage.getItem('ffm_locale'), null);
  });
});

describe('setLocale / toggleLocale / persistence', () => {
  it('setLocale persists the choice via localStorage', () => {
    globalThis.localStorage = makeFakeStorage();
    setLocale('de');
    assert.equal(getLocale(), 'de');
    assert.equal(globalThis.localStorage.getItem('ffm_locale'), 'de');
  });

  it('a persisted locale is picked up again after resetting the in-memory cache', () => {
    globalThis.localStorage = makeFakeStorage();
    setLocale('de');
    _resetForTests();
    // currentLocale cache cleared, but the fake storage still holds 'de'
    assert.equal(getLocale(), 'de');
  });

  it('setLocale rejects unsupported locales', () => {
    setLocale('en');
    assert.throws(() => setLocale('fr'), { name: 'RangeError', message: 'Unsupported locale: fr' });
    assert.equal(getLocale(), 'en');
  });

  it('toggleLocale flips between en and de', () => {
    setLocale('en');
    assert.equal(toggleLocale(), 'de');
    assert.equal(toggleLocale(), 'en');
  });

  it('setLocale with persist:false changes the locale without writing to storage', () => {
    globalThis.localStorage = makeFakeStorage();
    setLocale('de', { persist: false });
    assert.equal(getLocale(), 'de');
    assert.equal(globalThis.localStorage.getItem('ffm_locale'), null);
  });

  it('SUPPORTED_LOCALES contains exactly en and de', () => {
    assert.deepEqual([...SUPPORTED_LOCALES].sort(), ['de', 'en']);
  });
});

describe('onLocaleChange', () => {
  it('notifies listeners with the new locale when it changes', () => {
    const seen = [];
    const unsubscribe = onLocaleChange((locale) => seen.push(locale));
    setLocale('de');
    setLocale('en');
    assert.deepEqual(seen, ['de', 'en']);
    unsubscribe();
    setLocale('de');
    assert.deepEqual(seen, ['de', 'en']); // no further notifications after unsubscribe
  });

  it('reports listener failures after notifying every listener', () => {
    const seen = [];
    onLocaleChange(() => { throw new Error('boom'); });
    onLocaleChange((locale) => seen.push(locale));
    assert.throws(() => setLocale('de'), { name: 'AggregateError' });
    assert.deepEqual(seen, ['de']);
  });
});

describe('t()', () => {
  it('returns the English string by default', () => {
    setLocale('en');
    assert.equal(t('topbar.login'), 'Login');
  });

  it('returns the German string when locale is de', () => {
    setLocale('de');
    assert.equal(t('topbar.login'), 'Anmelden');
  });

  it('substitutes {placeholders} with provided vars', () => {
    setLocale('en');
    assert.equal(t('splash.greeting', { username: 'Ada' }), 'Welcome, Ada!');
    setLocale('de');
    assert.equal(t('splash.greeting', { username: 'Ada' }), 'Willkommen, Ada!');
  });

  it('falls back to the key itself for unknown keys (never throws)', () => {
    assert.equal(t('this.key.does.not.exist'), 'this.key.does.not.exist');
  });

  it('uses German terms/privacy links in the German checkout consent', () => {
    setLocale('de');
    const consent = t('checkout.consentTermsHtml');
    assert.match(consent, /href="\/terms\.html"/);
    assert.match(consent, /href="\/datenschutz\.html"/);
    assert.doesNotMatch(consent, /\.en\.html/);
  });

  it('shows the exact, operator-approved German digital-content declarations verbatim', () => {
    setLocale('de');
    assert.equal(
      t('checkout.consentImmediateAccess'),
      'Ich stimme ausdrücklich zu, dass Urs Schweigert vor Ablauf der Widerrufsfrist mit der ' +
      'Bereitstellung der kostenpflichtigen digitalen Inhalte beginnt.'
    );
    assert.equal(
      t('checkout.consentWithdrawalWaiver'),
      'Mir ist bekannt, dass ich durch meine Zustimmung mit Beginn der Bereitstellung mein ' +
      'Widerrufsrecht verliere.'
    );
  });
});

describe('translateServerMessage()', () => {
  it('translates known snake_case backend identifiers', () => {
    setLocale('de');
    assert.equal(translateServerMessage('email_not_verified'), 'Bitte bestätige deine E-Mail-Adresse, bevor du dich anmeldest.');
    setLocale('en');
    assert.equal(translateServerMessage('email_not_verified'), 'Please verify your email before logging in.');
  });

  it('translates checkout declaration rejection identifiers distinctly (version mismatch vs unchecked box)', () => {
    setLocale('en');
    assert.match(translateServerMessage('declarations_version_mismatch'), /updated/i);
    assert.match(translateServerMessage('digital_content_declarations_required'), /confirm/i);
    assert.notEqual(
      translateServerMessage('declarations_version_mismatch'),
      translateServerMessage('digital_content_declarations_required'),
    );
  });

  it('translates known full-sentence backend messages', () => {
    setLocale('de');
    assert.notEqual(translateServerMessage('Email address already in use'), 'Email address already in use');
  });

  it('safely returns unknown/dynamic server text unchanged', () => {
    setLocale('de');
    const dynamic = 'first_grade_year must be between 2000 and 2030';
    assert.equal(translateServerMessage(dynamic), dynamic);
  });

  it('does not expose unknown machine error identifiers to players', () => {
    setLocale('de');
    assert.equal(translateServerMessage('unknown_billing_error'), 'Etwas ist schiefgelaufen. Bitte versuche es erneut.');
  });

  it('passes through non-string input unchanged', () => {
    assert.equal(translateServerMessage(undefined), undefined);
    assert.equal(translateServerMessage(null), null);
  });
});

describe('translateDom()', () => {
  it('applies data-i18n, data-i18n-placeholder and data-i18n-aria-label to matching fake elements', () => {
    setLocale('de');
    const textEl = makeFakeElement({ 'data-i18n': 'topbar.login' });
    const placeholderEl = makeFakeElement({ 'data-i18n-placeholder': 'auth.usernamePlaceholder' });
    const ariaEl = makeFakeElement({ 'data-i18n-aria-label': 'topbar.muteAriaLabel' });
    const htmlEl = makeFakeElement({ 'data-i18n-html': 'splash.greeting' });

    const fakeDoc = makeFakeDocument({
      '[data-i18n]': [textEl],
      '[data-i18n-html]': [htmlEl],
      '[data-i18n-placeholder]': [placeholderEl],
      '[data-i18n-aria-label]': [ariaEl],
      '[data-i18n-title]': [],
    });

    translateDom(fakeDoc);

    assert.equal(textEl.textContent, 'Anmelden');
    assert.equal(placeholderEl.getAttribute('placeholder'), 'Benutzername');
    assert.equal(ariaEl.getAttribute('aria-label'), 'Ton stummschalten');
    assert.ok(htmlEl.innerHTML.includes('Willkommen'));
  });

  it('is a no-op when given a root with no querySelectorAll (no DOM present)', () => {
    assert.doesNotThrow(() => translateDom({}));
    assert.doesNotThrow(() => translateDom(null));
  });
});

describe('initI18n()', () => {
  it('resolves the locale, sets <html lang>, and translates the DOM without throwing', () => {
    globalThis.navigator = { languages: ['de-DE'] };
    const loginEl = makeFakeElement({ 'data-i18n': 'topbar.login' });
    globalThis.document = makeFakeDocument({
      '[data-i18n]': [loginEl],
      '[data-i18n-html]': [],
      '[data-i18n-placeholder]': [],
      '[data-i18n-aria-label]': [],
      '[data-i18n-title]': [],
    });

    const locale = initI18n();

    assert.equal(locale, 'de');
    assert.equal(globalThis.document.documentElement.lang, 'de');
    assert.equal(loginEl.textContent, 'Anmelden');
  });

  it('is safe to call with no document at all (plain Node context)', () => {
    assert.doesNotThrow(() => initI18n());
  });
});
