// entitlement-panel.js — App-only player-section entitlement panel.
//
// Shows the device-wide store entitlements on the Players page, explains the
// one-time unlock, uses the store's localised price, and offers buy/restore.
// Both products are listed side by side: the full unlock (Campaign I, levels
// 3-60) and Campaign II (Genius). They are independent: either can be bought
// first, and owning one never hides or gates the other.
// It adds no purchase API: status comes from the platform seam, the price from
// purchase.js, and buy/restore run through paywall.js (which parental-gates
// every store call). The free-content sentence is derived by probing the
// platform's real gating rule, never from fixed copy.

import {
  CAMPAIGN2_PRODUCT_ID,
  PURCHASE_OUTCOMES,
  RESTORE_OUTCOMES,
  createPurchaseStore,
  createPurchasesPlugin,
} from './purchase.js';
import { createPaywall, paywallText, priceLabel } from './paywall.js';
import { DEFAULT_LOCALE, resolveLocale } from './parental-gate.js';

/** Panel copy, keyed like the game's i18n dictionary. */
export const STRINGS = Object.freeze({
  'entitlement.title': { en: 'Your version', de: 'Deine Version' },
  'entitlement.status.full': { en: 'All levels unlocked', de: 'Alle Level freigeschaltet' },
  'entitlement.status.free': { en: 'Free version.', de: 'Kostenlose Version.' },
  'entitlement.status.offline': { en: 'Offline: showing the last saved purchase status.', de: 'Offline: Zuletzt gespeicherter Kaufstatus wird angezeigt.' },
  'entitlement.status.error': { en: 'The purchase status could not be read.', de: 'Der Kaufstatus konnte nicht gelesen werden.' },
  'entitlement.unlock': { en: 'One purchase unlocks every level. Pay once and keep access.', de: 'Ein Kauf schaltet alle Level frei. Einmal zahlen und Zugang behalten.' },
  'entitlement.device': { en: 'The unlock applies to every player on this device. Each player keeps their own scores.', de: 'Die Freischaltung gilt für alle Spieler auf diesem Gerät. Jeder Spieler behält eigene Punkte.' },
  'entitlement.free.one': { en: 'Level 1 is free to play.', de: 'Level 1 ist kostenlos spielbar.' },
  'entitlement.free.range': { en: 'Levels 1–{free} are free to play.', de: 'Level 1–{free} sind kostenlos spielbar.' },
  'entitlement.free.all': { en: 'All {total} levels are available.', de: 'Alle {total} Level sind verfügbar.' },
  'entitlement.free.none': { en: 'No level is free to play.', de: 'Kein Level ist kostenlos spielbar.' },
  'entitlement.free.unknown': { en: 'Some levels are free to play.', de: 'Einige Level sind kostenlos spielbar.' },
  'entitlement.campaign1.title': { en: 'Campaign I: Arithmetic', de: 'Abenteuer I: Rechnen' },
  'entitlement.campaign2.title': { en: 'Campaign II: Genius', de: 'Abenteuer II: Genie' },
  'entitlement.campaign2.owned': { en: 'Campaign II unlocked', de: 'Abenteuer II freigeschaltet' },
  'entitlement.campaign2.offer': { en: 'Forty more levels of fractions, powers, roots and logarithms. A separate one-time purchase; it does not need the full unlock.', de: 'Vierzig weitere Level mit Brüchen, Potenzen, Wurzeln und Logarithmen. Ein eigener Einmalkauf; die Vollversion ist dafür nicht nötig.' },
});

/** Default probe ceiling when the caller does not supply the level count. */
export const DEFAULT_PROBE_LIMIT = 60;

/** Translate panel copy for a supported locale. */
export function entitlementText(key, locale = DEFAULT_LOCALE, vars = {}) {
  const copy = STRINGS[key]?.[resolveLocale(locale)];
  if (!copy) return key;
  return copy.replace(/\{(\w+)\}/g, (match, name) =>
    (vars[name] === undefined ? match : String(vars[name])));
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * Reduce an entitlement status to the panel's four display states.
 * @param {object|null} status platform billing/entitlement status
 * @returns {'full'|'free'|'offline'|'error'} display state
 */
export function resolveStatus(status) {
  if (!status || typeof status !== 'object') return 'error';
  if (status.offline === true) return 'offline';
  return status.premium_access === true ? 'full' : 'free';
}

/** Localized one-line status text. */
export function statusText(statusKey, locale = DEFAULT_LOCALE) {
  const key = {
    full: 'entitlement.status.full',
    offline: 'entitlement.status.offline',
    error: 'entitlement.status.error',
  }[statusKey] ?? 'entitlement.status.free';
  return entitlementText(key, locale);
}

/**
 * Describe the free content from the counted free levels, never a constant.
 * @param {number|null} freeCount number of levels the platform serves unlocked
 * @param {number|null} totalLevels total number of levels, when known
 * @param {string} [locale]
 * @returns {string} localized sentence
 */
export function freeContentText(freeCount, totalLevels, locale = DEFAULT_LOCALE) {
  const loc = resolveLocale(locale);
  const count = Number.isInteger(freeCount) && freeCount > 0 ? freeCount : 0;
  if (Number.isInteger(totalLevels) && totalLevels > 0 && count >= totalLevels) {
    return entitlementText('entitlement.free.all', loc, { total: totalLevels });
  }
  if (count === 1) return entitlementText('entitlement.free.one', loc);
  if (count > 1) return entitlementText('entitlement.free.range', loc, { free: count });
  if (Number.isInteger(totalLevels) && totalLevels > 0) {
    return entitlementText('entitlement.free.none', loc);
  }
  return entitlementText('entitlement.free.unknown', loc);
}

/**
 * Count the levels the platform serves without an entitlement by asking it
 * for each level in order. The first authorization error ends the count.
 * @param {object} platform platform seam with getAuthorizedLevelConfig
 * @param {{max?: number}} [options] probe ceiling
 * @returns {Promise<number>} number of free levels
 */
export async function probeFreeLevels(platform, { max = DEFAULT_PROBE_LIMIT } = {}) {
  if (!platform || typeof platform.getAuthorizedLevelConfig !== 'function') return 0;
  const limit = Number.isInteger(max) && max > 0 ? max : DEFAULT_PROBE_LIMIT;
  let free = 0;
  for (let index = 0; index < limit; index += 1) {
    try {
      await platform.getAuthorizedLevelConfig(index);
      free += 1;
    } catch {
      break;
    }
  }
  return free;
}

/** Accessible panel markup for the current state. */
export function buildEntitlementMarkup({
  locale = DEFAULT_LOCALE,
  statusKey = 'free',
  freeCount = 0,
  totalLevels = null,
  price = null,
  outcomeKey = '',
  outcomeText = '',
  outcomeError = false,
  busy = false,
  showBuy = true,
  // Campaign II: null when the platform cannot sell it (then the section is left out),
  // else { owned, price }. It never depends on statusKey: the products are independent.
  campaign2 = null,
} = {}) {
  const loc = resolveLocale(locale);
  const buy = price
    ? paywallText('paywall.buy', loc, { price })
    : paywallText('paywall.buyNoPrice', loc);
  const restore = paywallText('paywall.restore', loc);
  const disabled = busy ? ' disabled' : '';
  // A fully unlocked install needs only its status line and Restore.
  const full = statusKey === 'full';
  const lines = [
    `<div class="entitlement-panel" data-entitlement-status="${escapeHtml(statusKey)}"`,
    `     data-entitlement-outcome="${escapeHtml(outcomeKey)}">`,
  ];
  // Listed next to Campaign II, the full unlock is named as the campaign it opens.
  if (campaign2) {
    lines.push(`  <h2 class="entitlement-title">${escapeHtml(entitlementText('entitlement.campaign1.title', loc))}</h2>`);
  } else if (!full) {
    lines.push(`  <h2 class="entitlement-title">${escapeHtml(entitlementText('entitlement.title', loc))}</h2>`);
  }
  lines.push(`  <p class="entitlement-status" role="status" aria-live="polite">${escapeHtml(statusText(statusKey, loc))}</p>`);
  if (!full) {
    lines.push(`  <p class="entitlement-free">${escapeHtml(freeContentText(freeCount, totalLevels, loc))}</p>`);
    lines.push(`  <p class="entitlement-unlock">${escapeHtml(entitlementText('entitlement.unlock', loc))}</p>`);
    lines.push(`  <p class="entitlement-device">${escapeHtml(entitlementText('entitlement.device', loc))}</p>`);
  }
  const buyButton = showBuy && !full
    ? `    <button type="button" class="diff-btn action-primary" data-entitlement-action="buy"${disabled}>${escapeHtml(buy)}</button>`
    : null;
  const restoreButton = `    <button type="button" class="diff-btn" data-entitlement-action="restore"${disabled}>${escapeHtml(restore)}</button>`;
  if (!campaign2) {
    lines.push('  <div class="entitlement-actions">');
    if (buyButton) lines.push(buyButton);
    lines.push(restoreButton);
    lines.push('  </div>');
  } else if (buyButton) {
    lines.push('  <div class="entitlement-actions">', buyButton, '  </div>');
  }
  if (campaign2) {
    const owned = campaign2.owned === true;
    const buy2 = campaign2.price
      ? paywallText('paywall.buy', loc, { price: campaign2.price })
      : paywallText('paywall.campaign2.buyNoPrice', loc);
    lines.push(`  <section class="entitlement-product entitlement-campaign2" data-entitlement-campaign2="${owned ? 'owned' : 'offered'}">`);
    lines.push(`    <h2 class="entitlement-title">${escapeHtml(entitlementText('entitlement.campaign2.title', loc))}</h2>`);
    if (owned) {
      lines.push(`    <p class="entitlement-status">${escapeHtml(entitlementText('entitlement.campaign2.owned', loc))}</p>`);
    } else {
      lines.push(`    <p class="entitlement-unlock">${escapeHtml(entitlementText('entitlement.campaign2.offer', loc))}</p>`);
      lines.push('    <div class="entitlement-actions">');
      lines.push(`      <button type="button" class="diff-btn action-primary" data-entitlement-action="buyCampaign2"${disabled}>${escapeHtml(buy2)}</button>`);
      lines.push('    </div>');
    }
    lines.push('  </section>');
    // One Restore under both products: the store restores every purchase at once.
    lines.push('  <div class="entitlement-actions">', restoreButton, '  </div>');
  }
  if (!full || outcomeText) {
    lines.push(`  <p class="entitlement-outcome${outcomeError ? ' error-msg' : ''}" role="status" aria-live="polite">${escapeHtml(outcomeText)}</p>`);
  }
  lines.push('</div>');
  return lines.join('\n');
}

/** Map a paywall purchase/restore result to a distinct localized outcome. */
export function outcomeFromResult(result, action) {
  if (action === 'restore') {
    if (result?.granted) return { key: 'paywall.restored', error: false };
    if (result?.outcome === RESTORE_OUTCOMES.GATED) return { key: 'paywall.gated', error: true };
    if (result?.outcome === RESTORE_OUTCOMES.ERROR) return { key: 'paywall.restoreError', error: true };
    if (result?.outcome === RESTORE_OUTCOMES.RESTORED) {
      return { key: 'paywall.nothingToRestore', error: false };
    }
    return { key: 'paywall.restoreError', error: true };
  }
  if (result?.granted) return { key: 'paywall.success', error: false };
  switch (result?.outcome) {
    case PURCHASE_OUTCOMES.PENDING:
      return { key: 'paywall.pending', error: false };
    case PURCHASE_OUTCOMES.CANCELLED:
      return { key: 'paywall.cancelled', error: false };
    case PURCHASE_OUTCOMES.GATED:
      return { key: 'paywall.gated', error: true };
    default:
      return { key: 'paywall.error', error: true };
  }
}

/** Default view: renders the panel markup into a root element. */
export function createDomEntitlementView({ root } = {}) {
  if (!root?.ownerDocument) throw new TypeError('An entitlement panel root is required');
  return {
    render(markup, handlers = {}) {
      root.innerHTML = markup;
      for (const action of ['buy', 'buyCampaign2', 'restore']) {
        root
          .querySelector(`[data-entitlement-action="${action}"]`)
          ?.addEventListener('click', handlers[action]);
      }
    },
    setBusy(busy) {
      for (const button of root.querySelectorAll?.('[data-entitlement-action]') ?? []) {
        button.disabled = Boolean(busy);
      }
    },
    destroy() {
      root.replaceChildren?.();
    },
  };
}

/**
 * Create the player-section entitlement panel controller.
 *
 * Status comes from the platform seam, the price from the purchase store and
 * buy/restore from paywall.js. The paywall screen is a no-op because the panel
 * renders its own outcome line; the parental gate and entitlement refresh stay
 * in paywall.js.
 * @param {object} options
 * @returns {object} panel API
 */
export function createEntitlementPanel({
  platform,
  locale = DEFAULT_LOCALE,
  getLocale = () => locale,
  purchaseStore,
  plugin,
  gateUi,
  view,
  root,
  totalLevels = null,
  onGranted = () => {},
  onExtrasRestored = () => {},
  // Called after Campaign II was bought here, so the caller can refresh the campaign switch.
  onCampaign2Granted = () => {},
  probe = probeFreeLevels,
} = {}) {
  if (!platform || typeof platform.getBillingStatus !== 'function') {
    throw new TypeError('entitlement panel needs a platform with getBillingStatus');
  }
  if (typeof platform.refreshEntitlement !== 'function') {
    throw new TypeError('entitlement panel needs a platform with refreshEntitlement');
  }
  const store = purchaseStore ?? createPurchaseStore({ plugin: plugin ?? createPurchasesPlugin() });
  const screen = view ?? createDomEntitlementView({ root });

  // Campaign II is sold here whenever the platform can tell whether it is owned.
  const sellsCampaign2 = typeof platform.getOwnedProductIds === 'function';
  // The same store, bound to Campaign II: price, purchase and restore all go through the one
  // injected store (and its plugin), only with the other product id.
  const campaign2Store = {
    productId: CAMPAIGN2_PRODUCT_ID,
    queryProduct: () => store.queryProduct(CAMPAIGN2_PRODUCT_ID),
    purchase: (options = {}) => store.purchase({ ...options, productId: CAMPAIGN2_PRODUCT_ID }),
    restore: (options) => store.restore(options),
  };

  let status = null;
  let product = null;
  let campaign2 = sellsCampaign2 ? { owned: false, price: null } : null;
  let freeCount = null;
  let outcome = null;
  let busy = false;
  let destroyed = false;
  let loadVersion = 0;
  let paywall = null;
  let paywallLocale = null;

  const probeCeiling = () => (Number.isInteger(totalLevels) && totalLevels > 0
    ? totalLevels
    : DEFAULT_PROBE_LIMIT);

  async function computeFreeCount() {
    if (status?.premium_access === true) {
      freeCount = Number.isInteger(totalLevels) && totalLevels > 0 ? totalLevels : null;
      return;
    }
    freeCount = await probe(platform, { max: probeCeiling() });
  }

  function render() {
    if (destroyed) return;
    const loc = resolveLocale(getLocale());
    const statusKey = resolveStatus(status);
    const premium = status?.premium_access === true;
    const outcomeText = outcome ? paywallText(outcome.key, loc) : '';
    const markup = buildEntitlementMarkup({
      locale: loc,
      statusKey,
      freeCount,
      totalLevels,
      price: priceLabel(product),
      outcomeKey: outcome?.key ?? '',
      outcomeText,
      outcomeError: Boolean(outcome?.error),
      busy,
      showBuy: !premium && statusKey !== 'error',
      campaign2,
    });
    screen.render(markup, { buy, buyCampaign2, restore });
    screen.setBusy(busy);
  }

  async function applyStatus(next) {
    if (next && typeof next === 'object') status = next;
    await computeFreeCount();
    render();
  }

  async function load({ refresh = false } = {}) {
    if (destroyed) return null;
    const version = ++loadVersion;
    busy = true;
    outcome = null;
    render();
    try {
      const next = refresh
        ? await platform.refreshEntitlement()
        : await platform.getBillingStatus();
      if (destroyed || version !== loadVersion) return null;
      if (!next || typeof next !== 'object') throw new Error('entitlement status unavailable');
      status = next;
      await computeFreeCount();
      if (destroyed || version !== loadVersion) return null;
      const queried = await store.queryProduct().catch(() => ({ product: null }));
      if (destroyed || version !== loadVersion) return null;
      product = queried?.product ?? null;
      await readCampaign2();
      if (destroyed || version !== loadVersion) return null;
      return status;
    } catch {
      if (destroyed || version !== loadVersion) return null;
      status = null;
      product = null;
      freeCount = null;
      return null;
    } finally {
      if (!destroyed && version === loadVersion) {
        busy = false;
        render();
      }
    }
  }

  // Owned and price of Campaign II; a store that cannot answer leaves it offered, without a price.
  async function readCampaign2() {
    if (!sellsCampaign2) return;
    let owned = false;
    try { owned = ((await platform.getOwnedProductIds()) ?? []).includes(CAMPAIGN2_PRODUCT_ID); } catch { owned = false; }
    const queried = owned ? null : await campaign2Store.queryProduct().catch(() => ({ product: null }));
    campaign2 = { owned, price: owned ? null : priceLabel(queried?.product) };
  }

  const silentView = () => ({ render() {}, setStatus() {}, setBusy() {}, close() {} });

  function paywallForCurrentLocale() {
    const loc = resolveLocale(getLocale());
    if (!paywall || paywallLocale !== loc) {
      paywall = createPaywall({
        platform,
        locale: loc,
        purchaseStore: store,
        gateUi,
        view: silentView(),
        onGranted: () => onGranted(),
      });
      paywallLocale = loc;
    }
    return paywall;
  }

  // One Restore for every product: the store restores all of the account's purchases at
  // once, so after it the extra products (Campaign II) are read back too and reported in
  // the same outcome line. There is no second Restore button anywhere else in the app.
  async function restoreExtras(result) {
    if (result?.outcome !== RESTORE_OUTCOMES.RESTORED || typeof platform.getOwnedProductIds !== 'function') return [];
    let owned = [];
    try { owned = (await platform.getOwnedProductIds()) ?? []; } catch { owned = []; }
    if (owned.length) onExtrasRestored(owned);
    if (campaign2) campaign2 = { ...campaign2, owned: owned.includes(CAMPAIGN2_PRODUCT_ID) || campaign2.owned };
    return owned;
  }

  // Campaign II is bought here without the full unlock: its own paywall controller, bound
  // to the Campaign II product, with the same parental gate.
  async function buyCampaign2() {
    if (!sellsCampaign2 || busy || destroyed) return null;
    busy = true;
    outcome = null;
    render();
    try {
      const result = await createPaywall({
        platform,
        locale: resolveLocale(getLocale()),
        product: 'campaign2',
        purchaseStore: campaign2Store,
        gateUi,
        view: silentView(),
        onGranted: () => onCampaign2Granted(),
      }).buy();
      const mapped = outcomeFromResult(result, 'buy');
      outcome = result?.granted ? { key: 'paywall.campaign2.success', error: false } : mapped;
      if (result?.granted) campaign2 = { ...campaign2, owned: true };
      return result;
    } catch {
      outcome = { key: 'paywall.error', error: true };
      return null;
    } finally {
      if (!destroyed) {
        busy = false;
        render();
      }
    }
  }

  async function run(action) {
    if (busy || destroyed) return null;
    busy = true;
    outcome = null;
    render();
    try {
      const result = await paywallForCurrentLocale()[action]();
      outcome = outcomeFromResult(result, action);
      if (result?.granted && result?.status) await applyStatus(result.status);
      if (action === 'restore') {
        const extras = await restoreExtras(result);
        if (extras.includes(CAMPAIGN2_PRODUCT_ID)) {
          outcome = { key: result?.granted ? 'paywall.restoredAll' : 'paywall.campaign2.restored', error: false };
        }
      }
      return result;
    } catch {
      outcome = {
        key: action === 'restore' ? 'paywall.restoreError' : 'paywall.error',
        error: true,
      };
      return null;
    } finally {
      if (!destroyed) {
        busy = false;
        render();
      }
    }
  }

  function buy() {
    return run('buy');
  }

  function restore() {
    return run('restore');
  }

  function refresh() {
    return load({ refresh: true });
  }

  function destroy() {
    destroyed = true;
    loadVersion += 1;
    screen.destroy?.();
  }

  return {
    load,
    refresh,
    render,
    buy,
    buyCampaign2,
    restore,
    destroy,
    getStatus: () => status,
    getCampaign2: () => campaign2,
    getFreeCount: () => freeCount,
    getOutcome: () => outcome,
  };
}

/** Create the controller, render it into root and load the current status. */
export function mountEntitlementPanel(options = {}) {
  const panel = createEntitlementPanel(options);
  void panel.load();
  return panel;
}
