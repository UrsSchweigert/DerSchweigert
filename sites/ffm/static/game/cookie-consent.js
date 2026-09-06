// cookie-consent.js — Simple consent gate for Cloudflare Turnstile CAPTCHA
// Checks localStorage for prior user decision; shows banner if unset.
// On Accept: loads Turnstile dynamically. On Decline: blocks Turnstile.

export class CookieConsent {
  constructor() {
    this.STORAGE_KEY = 'ffm_cookie_consent';
    this.TURNSTILE_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js';
  }

  // Check if user has already made a decision
  hasDecision() {
    return localStorage.getItem(this.STORAGE_KEY) !== null;
  }

  // Check if user accepted cookies
  isAccepted() {
    return localStorage.getItem(this.STORAGE_KEY) === 'accepted';
  }

  // Get the current consent state (null, 'accepted', or 'declined')
  getState() {
    return localStorage.getItem(this.STORAGE_KEY);
  }

  // Record acceptance and load Turnstile
  accept() {
    localStorage.setItem(this.STORAGE_KEY, 'accepted');
    this.loadTurnstile();
    this.hideBanner();
  }

  // Record rejection without loading Turnstile
  decline() {
    localStorage.setItem(this.STORAGE_KEY, 'declined');
    this.hideBanner();
  }

  // Dynamically inject the Turnstile script tag
  loadTurnstile() {
    if (window.turnstile) {
      return; // Already loaded
    }
    const script = document.createElement('script');
    script.src = this.TURNSTILE_URL;
    script.async = true;
    script.defer = true;
    document.head.appendChild(script);
  }

  // Show the cookie banner (if it exists)
  showBanner() {
    const banner = document.getElementById('cookie-banner');
    if (banner) {
      banner.style.display = 'flex';
    }
  }

  // Hide the cookie banner
  hideBanner() {
    const banner = document.getElementById('cookie-banner');
    if (banner) {
      banner.style.display = 'none';
    }
  }

  // Initialize: show banner if no prior decision, load Turnstile if accepted
  init() {
    if (!this.hasDecision()) {
      // No prior decision: show banner
      this.showBanner();
    } else if (this.isAccepted()) {
      // Previously accepted: load Turnstile and hide banner
      this.loadTurnstile();
      this.hideBanner();
    } else {
      // Previously declined: hide banner (Turnstile not loaded)
      this.hideBanner();
    }
  }
}
