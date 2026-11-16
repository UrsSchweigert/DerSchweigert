// pack-sheet.js — Bilingual hero pack sheet for the app build.
//
// The hero pack is its own non-consumable; the full unlock never grants
// heroes. The sheet opens only through open(), shows the store's price string
// (never an amount from code), and runs the parental gate before buy and
// restore through ./purchase.js. It reuses the level paywall's helpers and
// leaves the level paywall untouched.

import {
  HERO_PACK_ID,
  PURCHASE_OUTCOMES,
  RESTORE_OUTCOMES,
  createPurchaseStore,
  createPurchasesPlugin,
} from './purchase.js';
import { DEFAULT_LOCALE, resolveLocale } from './parental-gate.js';
import {
  createDomGateUi,
  createDomPaywallView,
  escapeHtml,
  priceLabel,
} from './paywall.js';

export const PACK_STRINGS = Object.freeze({
  'pack.title': { en: 'Hero pack', de: 'Heldenpaket' },
  'pack.description': { en: 'One purchase unlocks every extra hero. The levels are not part of it.', de: 'Ein Kauf schaltet alle zusätzlichen Helden frei. Die Level gehören nicht dazu.' },
  'pack.buy': { en: 'Buy for {price}', de: 'Für {price} kaufen' },
  'pack.buyNoPrice': { en: 'Buy hero pack', de: 'Heldenpaket kaufen' },
  'pack.restore': { en: 'Restore purchases', de: 'Käufe wiederherstellen' },
  'pack.close': { en: 'Close', de: 'Schließen' },
  'pack.success': { en: 'Purchase complete. The heroes are unlocked.', de: 'Kauf abgeschlossen. Die Helden sind freigeschaltet.' },
  'pack.restored': { en: 'Purchase restored. The heroes are unlocked.', de: 'Kauf wiederhergestellt. Die Helden sind freigeschaltet.' },
  'pack.cancelled': { en: 'Purchase cancelled.', de: 'Kauf abgebrochen.' },
  'pack.pending': { en: 'Purchase pending approval. The heroes unlock once the store confirms it.', de: 'Kauf wartet auf Bestätigung. Die Helden werden freigeschaltet, sobald der Store ihn bestätigt.' },
  'pack.gated': { en: 'Ask an adult to complete the parental gate.', de: 'Bitte einen Erwachsenen, die Elternkontrolle abzuschließen.' },
  'pack.error': { en: 'The store could not complete the purchase. Please try again.', de: 'Der Store konnte den Kauf nicht abschließen. Bitte versuche es erneut.' },
  'pack.restoreError': { en: 'The store could not restore purchases. Please try again.', de: 'Der Store konnte Käufe nicht wiederherstellen. Bitte versuche es erneut.' },
  'pack.nothingToRestore': { en: 'No hero pack purchase was found for this store account.', de: 'Für dieses Store-Konto wurde kein Heldenpaket gefunden.' },
});

/** Translate hero pack copy for a supported locale. */
export function packText(key, locale = DEFAULT_LOCALE, vars = {}) {
  const copy = PACK_STRINGS[key][resolveLocale(locale)];
  return copy.replace(/\{(\w+)\}/g, (match, name) =>
    (vars[name] === undefined ? match : String(vars[name])));
}

/**
 * Accessible hero pack markup. The price line is omitted when the store gave
 * none, and Buy stays usable with a generic label.
 * @param {{locale?: string, price?: string|null}} options
 * @returns {string} dialog markup for the caller to insert
 */
export function buildPackSheetMarkup({ locale = DEFAULT_LOCALE, price = null } = {}) {
  const loc = resolveLocale(locale);
  const buy = price ? packText('pack.buy', loc, { price }) : packText('pack.buyNoPrice', loc);
  return [
    '<div class="paywall-card overlay-card pack-sheet-card" role="dialog" aria-modal="true"',
    '     aria-labelledby="pack-sheet-title" aria-describedby="pack-sheet-description">',
    `  <h2 id="pack-sheet-title">${escapeHtml(packText('pack.title', loc))}</h2>`,
    `  <p id="pack-sheet-description">${escapeHtml(packText('pack.description', loc))}</p>`,
    '  <div class="paywall-actions">',
    `    <button type="button" class="diff-btn action-primary" data-pack-action="buy">${escapeHtml(buy)}</button>`,
    `    <button type="button" class="diff-btn" data-pack-action="restore">${escapeHtml(packText('pack.restore', loc))}</button>`,
    `    <button type="button" class="diff-btn" data-pack-action="close">${escapeHtml(packText('pack.close', loc))}</button>`,
    '  </div>',
    '  <p class="paywall-status pack-sheet-status" role="status" aria-live="polite"></p>',
    '</div>',
  ].join('\n');
}

/**
 * Create the hero pack sheet controller. Nothing opens it but open().
 * Success means the refreshed entitlement says hero_pack; the full unlock
 * alone never counts.
 * @param {{platform: object, locale?: string, onGranted?: Function, onClose?: Function, purchaseStore?: object, plugin?: object, gateUi?: object, view?: object, opener?: object, doc?: object}} options
 * @returns {{open: Function, close: Function, buy: Function, restore: Function}}
 */
export function createPackSheet({
  platform,
  locale = DEFAULT_LOCALE,
  onGranted = () => {},
  onClose = () => {},
  purchaseStore,
  plugin,
  gateUi,
  view,
  opener = null,
  doc = globalThis.document,
} = {}) {
  if (!platform || typeof platform.refreshEntitlement !== 'function') {
    throw new TypeError('pack sheet needs a platform with refreshEntitlement');
  }
  const loc = resolveLocale(locale);
  const store = purchaseStore ?? createPurchaseStore({ plugin: plugin ?? createPurchasesPlugin() });
  const ui = gateUi ?? createDomGateUi();
  const screen = view ?? createDomPaywallView({
    doc,
    overlayClass: 'overlay pack-sheet-overlay',
    actionAttr: 'data-pack-action',
    statusSelector: '.pack-sheet-status',
  });

  let isOpen = false;
  const onKey = (event) => {
    if (event?.key === 'Escape') sheet.close();
  };

  const message = (key, error = false) => {
    const text = packText(key, loc);
    screen.setStatus?.(text, { error });
    return text;
  };
  const fail = (outcome, key, error = false) => ({
    outcome,
    granted: false,
    message: message(key, error),
  });
  const withBusy = async (operation) => {
    screen.setBusy?.(true);
    try {
      return await operation();
    } finally {
      screen.setBusy?.(false);
    }
  };
  const grant = async (outcome, key, missingKey, missingIsError) => {
    const status = await withBusy(() => platform.refreshEntitlement());
    if (status?.hero_pack !== true) {
      return { outcome, granted: false, status, message: message(missingKey, missingIsError) };
    }
    message(key);
    sheet.close();
    onGranted();
    return { outcome, granted: true, status, message: packText(key, loc) };
  };

  const sheet = {
    async open() {
      const result = await withBusy(() => store.queryProduct(HERO_PACK_ID))
        .catch(() => ({ product: null }));
      const root = screen.render?.(
        buildPackSheetMarkup({ locale: loc, price: priceLabel(result?.product) }),
        { buy: () => sheet.buy(), restore: () => sheet.restore(), close: () => sheet.close() },
      );
      isOpen = true;
      doc?.addEventListener?.('keydown', onKey);
      root?.querySelector?.('[data-pack-action]')?.focus?.();
      return sheet;
    },

    close() {
      doc?.removeEventListener?.('keydown', onKey);
      screen.close?.();
      if (!isOpen) return;
      isOpen = false;
      opener?.focus?.();
      onClose();
    },

    /** Gate, then buy the hero pack. */
    async buy() {
      const result = await withBusy(() => store.purchase({ ui, locale: loc, productId: HERO_PACK_ID }));
      switch (result.outcome) {
        case PURCHASE_OUTCOMES.SUCCESS:
        case PURCHASE_OUTCOMES.ALREADY_OWNED:
          return grant(result.outcome, 'pack.success', 'pack.error', true);
        case PURCHASE_OUTCOMES.PENDING:
          return fail(result.outcome, 'pack.pending');
        case PURCHASE_OUTCOMES.CANCELLED:
          return fail(result.outcome, 'pack.cancelled');
        case PURCHASE_OUTCOMES.GATED:
          return fail(result.outcome, 'pack.gated', true);
        default:
          return fail(result.outcome, 'pack.error', true);
      }
    },

    /** Gate, then run the single restore that covers both products. */
    async restore() {
      const result = await withBusy(() => store.restore({ ui, locale: loc }));
      if (result.outcome === RESTORE_OUTCOMES.GATED) return fail(result.outcome, 'pack.gated', true);
      if (result.outcome === RESTORE_OUTCOMES.ERROR) return fail(result.outcome, 'pack.restoreError', true);
      if (!result.ownedProducts?.includes(HERO_PACK_ID)) {
        return fail(result.outcome, 'pack.nothingToRestore');
      }
      return grant(result.outcome, 'pack.restored', 'pack.nothingToRestore', false);
    },
  };

  return sheet;
}
