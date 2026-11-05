// paywall.js — Bilingual, gated paywall for the app build.
//
// Levels 3-60 are one non-consumable in-app purchase; there is no web
// registration or Stripe checkout in the app. ./purchase.js owns the store
// calls and the parental gate, and every buy and restore runs that gate first.
// The markup builder is DOM-free and the view/gate are injectable for tests.

import {
  PURCHASE_OUTCOMES,
  RESTORE_OUTCOMES,
  createPurchaseStore,
  createPurchasesPlugin,
} from './purchase.js';
import { DEFAULT_LOCALE, resolveLocale } from './parental-gate.js';

export const STRINGS = Object.freeze({
  'paywall.title': { en: 'Unlock levels 3-60', de: 'Level 3–60 freischalten' },
  'paywall.description': { en: 'One purchase unlocks every level. Levels 1-2 stay free.', de: 'Ein Kauf schaltet alle Level frei. Level 1–2 bleiben kostenlos.' },
  'paywall.buy': { en: 'Buy for {price}', de: 'Für {price} kaufen' },
  'paywall.buyNoPrice': { en: 'Buy full unlock', de: 'Vollversion kaufen' },
  'paywall.restore': { en: 'Restore purchase', de: 'Kauf wiederherstellen' },
  'paywall.close': { en: 'Not now', de: 'Später' },
  'paywall.success': { en: 'Purchase complete. All levels are unlocked.', de: 'Kauf abgeschlossen. Alle Level sind freigeschaltet.' },
  'paywall.restored': { en: 'Purchase restored. All levels are unlocked.', de: 'Kauf wiederhergestellt. Alle Level sind freigeschaltet.' },
  'paywall.cancelled': { en: 'Purchase cancelled.', de: 'Kauf abgebrochen.' },
  'paywall.pending': { en: 'Purchase pending approval. Levels unlock once the store confirms it.', de: 'Kauf wartet auf Bestätigung. Freischaltung folgt, sobald der Store ihn bestätigt.' },
  'paywall.gated': { en: 'Ask an adult to complete the parental gate.', de: 'Bitte einen Erwachsenen, die Elternkontrolle abzuschließen.' },
  'paywall.error': { en: 'The store could not complete the purchase. Please try again.', de: 'Der Store konnte den Kauf nicht abschließen. Bitte versuche es erneut.' },
  'paywall.restoreError': { en: 'The store could not restore purchases. Please try again.', de: 'Der Store konnte Käufe nicht wiederherstellen. Bitte versuche es erneut.' },
  'paywall.nothingToRestore': { en: 'No previous purchase was found for this store account.', de: 'Für dieses Store-Konto wurde kein früherer Kauf gefunden.' },
});

/** Translate paywall copy for a supported locale. */
export function paywallText(key, locale = DEFAULT_LOCALE, vars = {}) {
  const copy = STRINGS[key][resolveLocale(locale)];
  return copy.replace(/\{(\w+)\}/g, (match, name) =>
    (vars[name] === undefined ? match : String(vars[name])));
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** The store's localised price string, or null when it is unknown. */
export function priceLabel(product) {
  return typeof product?.priceString === 'string' && product.priceString
    ? product.priceString
    : null;
}

/**
 * Accessible paywall markup. The store price is shown when the store provided
 * one; otherwise the button stays generic instead of inventing an amount.
 * @param {{locale?: string, price?: string|null}} options
 * @returns {string} dialog markup for the caller to insert
 */
export function buildPaywallMarkup({ locale = DEFAULT_LOCALE, price = null } = {}) {
  const loc = resolveLocale(locale);
  const buy = price
    ? paywallText('paywall.buy', loc, { price })
    : paywallText('paywall.buyNoPrice', loc);
  return [
    '<div class="paywall-card overlay-card" role="dialog" aria-modal="true"',
    '     aria-labelledby="paywall-title" aria-describedby="paywall-description">',
    `  <h2 id="paywall-title">${escapeHtml(paywallText('paywall.title', loc))}</h2>`,
    `  <p id="paywall-description">${escapeHtml(paywallText('paywall.description', loc))}</p>`,
    '  <div class="paywall-actions">',
    `    <button type="button" class="diff-btn" data-paywall-action="buy">${escapeHtml(buy)}</button>`,
    `    <button type="button" class="diff-btn" data-paywall-action="restore">${escapeHtml(paywallText('paywall.restore', loc))}</button>`,
    `    <button type="button" class="diff-btn" data-paywall-action="close">${escapeHtml(paywallText('paywall.close', loc))}</button>`,
    '  </div>',
    '  <p class="paywall-status" role="status" aria-live="polite"></p>',
    '</div>',
  ].join('\n');
}

/** Default view: an overlay inserted into the document body. */
export function createDomPaywallView({ doc = globalThis.document } = {}) {
  let overlay = null;
  const find = (selector) => overlay?.querySelector(selector) ?? null;
  return {
    render(markup, handlers = {}) {
      if (!doc?.body) return null;
      if (!overlay) {
        overlay = doc.createElement('div');
        overlay.className = 'overlay paywall-overlay';
        doc.body.appendChild(overlay);
      }
      overlay.innerHTML = markup;
      for (const action of ['buy', 'restore', 'close']) {
        find(`[data-paywall-action="${action}"]`)?.addEventListener('click', handlers[action]);
      }
      return overlay;
    },
    setStatus(text, { error = false } = {}) {
      const node = find('.paywall-status');
      if (!node) return;
      node.textContent = text;
      node.classList.toggle('error-msg', error);
    },
    setBusy(busy) {
      for (const button of overlay?.querySelectorAll('[data-paywall-action]') ?? []) {
        button.disabled = busy;
      }
    },
    close() {
      overlay?.remove();
      overlay = null;
    },
  };
}

/** Default gate UI: renders the parental gate markup and resolves its answer. */
export function createDomGateUi({ doc = globalThis.document } = {}) {
  return {
    ask({ markup }) {
      return new Promise((resolve, reject) => {
        if (!doc?.body) {
          reject(new Error('parental gate needs a document'));
          return;
        }
        const host = doc.createElement('div');
        host.className = 'overlay parental-gate-overlay';
        host.innerHTML = markup;
        doc.body.appendChild(host);
        const close = () => host.remove();
        host.querySelector('#parental-gate-cancel')?.addEventListener('click', () => {
          close();
          const error = new Error('cancelled');
          error.code = 'cancelled';
          reject(error);
        });
        host.querySelector('.parental-gate-form')?.addEventListener('submit', (event) => {
          event.preventDefault();
          const answer = host.querySelector('#parental-gate-answer')?.value ?? '';
          close();
          resolve(answer);
        });
        host.querySelector('#parental-gate-answer')?.focus();
      });
    },
  };
}

/**
 * Create the paywall controller.
 *
 * `purchaseStore`, `gateUi` and `view` are injectable for tests. Success means
 * the platform's cached entitlement now says premium_access; the controller
 * refreshes it from the store before calling onGranted, so a refund that lands
 * between purchase and refresh still leaves the level locked.
 * @param {{platform: object, locale?: string, onGranted?: Function, purchaseStore?: object, plugin?: object, gateUi?: object, view?: object}} options
 * @returns {{open: Function, close: Function, buy: Function, restore: Function}}
 */
export function createPaywall({
  platform,
  locale = DEFAULT_LOCALE,
  onGranted = () => {},
  purchaseStore,
  plugin,
  gateUi,
  view,
} = {}) {
  if (!platform || typeof platform.refreshEntitlement !== 'function') {
    throw new TypeError('paywall needs a platform with refreshEntitlement');
  }
  const loc = resolveLocale(locale);
  const store = purchaseStore ?? createPurchaseStore({ plugin: plugin ?? createPurchasesPlugin() });
  const ui = gateUi ?? createDomGateUi();
  const screen = view ?? createDomPaywallView();

  const message = (key, vars = {}, error = false) => {
    const text = paywallText(key, loc, vars);
    screen.setStatus?.(text, { error });
    return text;
  };
  const fail = (outcome, key, error = false) => ({
    outcome,
    granted: false,
    message: message(key, {}, error),
  });
  const withBusy = async (operation) => {
    screen.setBusy?.(true);
    try {
      return await operation();
    } finally {
      screen.setBusy?.(false);
    }
  };
  const grant = async (outcome, key) => {
    const status = await withBusy(() => platform.refreshEntitlement());
    if (!status?.premium_access) {
      return { outcome, granted: false, status, message: message('paywall.error', {}, true) };
    }
    message(key);
    screen.close?.();
    onGranted();
    return { outcome, granted: true, status, message: paywallText(key, loc) };
  };

  const paywall = {
    async open() {
      const result = await withBusy(() => store.queryProduct()).catch(() => ({ product: null }));
      screen.render?.(buildPaywallMarkup({ locale: loc, price: priceLabel(result?.product) }), {
        buy: () => paywall.buy(),
        restore: () => paywall.restore(),
        close: () => paywall.close(),
      });
      return paywall;
    },

    close() {
      screen.close?.();
    },

    /** Gate, then buy the unlock. */
    async buy() {
      const result = await withBusy(() => store.purchase({ ui, locale: loc }));
      switch (result.outcome) {
        case PURCHASE_OUTCOMES.SUCCESS:
        case PURCHASE_OUTCOMES.ALREADY_OWNED:
          return grant(result.outcome, 'paywall.success');
        case PURCHASE_OUTCOMES.PENDING:
          return fail(result.outcome, 'paywall.pending');
        case PURCHASE_OUTCOMES.CANCELLED:
          return fail(result.outcome, 'paywall.cancelled');
        case PURCHASE_OUTCOMES.GATED:
          return fail(result.outcome, 'paywall.gated', true);
        default:
          return fail(result.outcome, 'paywall.error', true);
      }
    },

    /** Gate, then restore a purchase made on another install or device. */
    async restore() {
      const result = await withBusy(() => store.restore({ ui, locale: loc }));
      if (result.outcome === RESTORE_OUTCOMES.GATED) {
        return fail(result.outcome, 'paywall.gated', true);
      }
      if (result.outcome === RESTORE_OUTCOMES.ERROR) {
        return fail(result.outcome, 'paywall.restoreError', true);
      }
      if (result.entitled) return grant(result.outcome, 'paywall.restored');
      return fail(result.outcome, 'paywall.nothingToRestore');
    },
  };

  return paywall;
}
