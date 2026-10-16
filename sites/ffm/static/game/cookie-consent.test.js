import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { CookieConsent } from './cookie-consent.js';

// --- Minimal fake localStorage -------------------------------------------
// Node has no global `localStorage` by default, so this is a safe, isolated
// stand-in that never touches real browser/user storage.
function makeFakeStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
    clear: () => { map.clear(); },
  };
}

// --- Minimal fake banner element + document ------------------------------
function makeFakeBanner() {
  return { style: { display: 'none' } };
}

function makeFakeDocument(banner) {
  return {
    getElementById(id) {
      return id === 'cookie-banner' ? banner : null;
    },
    head: { appendChild() {} },
    createElement() {
      return { src: '', async: false, defer: false };
    },
  };
}

function makeFakeLocation() {
  return { reloadCount: 0, reload() { this.reloadCount += 1; } };
}

beforeEach(() => {
  global.localStorage = makeFakeStorage();
  global.window = { location: makeFakeLocation() };
  global.document = makeFakeDocument(makeFakeBanner());
});

describe('CookieConsent', () => {
  it('shows the banner on first visit (no prior decision)', () => {
    const consent = new CookieConsent();
    consent.init();
    assert.equal(document.getElementById('cookie-banner').style.display, 'flex');
    assert.equal(consent.hasDecision(), false);
  });

  it('accept() records acceptance and hides the banner', () => {
    const consent = new CookieConsent();
    consent.accept();
    assert.equal(consent.getState(), 'accepted');
    assert.equal(consent.isAccepted(), true);
    assert.equal(document.getElementById('cookie-banner').style.display, 'none');
  });

  it('decline() records rejection and hides the banner without loading Turnstile', () => {
    const consent = new CookieConsent();
    consent.decline();
    assert.equal(consent.getState(), 'declined');
    assert.equal(consent.isAccepted(), false);
    assert.equal(document.getElementById('cookie-banner').style.display, 'none');
    assert.equal(window.turnstile, undefined);
    // First-time decline (nothing was previously accepted/loaded): no reload needed.
    assert.equal(window.location.reloadCount, 0);
  });

  it('decline() reloads the page once when revoking a prior acceptance, so Turnstile actually stops', () => {
    const consent = new CookieConsent();
    consent.accept();
    assert.equal(window.location.reloadCount, 0);

    consent.revisit();
    consent.decline();

    assert.equal(consent.getState(), 'declined');
    assert.equal(document.getElementById('cookie-banner').style.display, 'none');
    assert.equal(window.location.reloadCount, 1);
  });

  it('revisit() re-opens the banner after a prior accept decision, so the user can change it', () => {
    const consent = new CookieConsent();
    consent.accept();
    assert.equal(document.getElementById('cookie-banner').style.display, 'none');

    consent.revisit();
    assert.equal(document.getElementById('cookie-banner').style.display, 'flex');

    // Changing the mind to decline still works correctly after a revisit
    // (and triggers exactly one reload to stop the already-loaded Turnstile).
    consent.decline();
    assert.equal(consent.getState(), 'declined');
    assert.equal(document.getElementById('cookie-banner').style.display, 'none');
    assert.equal(window.location.reloadCount, 1);
  });

  it('revisit() re-opens the banner after a prior decline decision, so the user can change it', () => {
    const consent = new CookieConsent();
    consent.decline();
    assert.equal(document.getElementById('cookie-banner').style.display, 'none');

    consent.revisit();
    assert.equal(document.getElementById('cookie-banner').style.display, 'flex');

    consent.accept();
    assert.equal(consent.getState(), 'accepted');
    assert.equal(document.getElementById('cookie-banner').style.display, 'none');
    // Switching decline -> accept never involves tearing down a loaded
    // script, so no reload is needed either.
    assert.equal(window.location.reloadCount, 0);
  });
});
