// first-open-notice.js — App-only thank-you notice shown on the first launch.
//
// The app is paid for once, so a first launch shows a short thank-you that
// explains the one-time model, lists the free levels and practice modes, and
// offers a single continue action. Nothing here sells anything: there is no
// purchase prompt and no gating change, and dismissing only records an
// acknowledgement.
//
// The free-level sentence comes from the real gating probe in
// ./entitlement-panel.js (the same rule the Players panel uses), and the
// practice modes come from PRACTICE_KINDS in the shared practice session
// module, so the notice cannot drift from what the game actually serves.
//
// The acknowledgement lives in the Capacitor Preferences store under its own
// device-wide key, never in per-player progress, so it survives profile
// switches and app restarts and reappears only on a fresh install. When the
// store is unavailable the notice is still shown and the continue button
// still closes it.

import { DEFAULT_LOCALE, resolveLocale } from './parental-gate.js';
import { freeContentText, probeFreeLevels } from './entitlement-panel.js';
import { createPreferencesBackend } from './progress-store.js';

/** Device-wide key holding the acknowledgement; never per player. */
export const NOTICE_KEY = 'arithmoslayer:first-open-notice';

/** The only acknowledgement schema version this module understands. */
export const NOTICE_SCHEMA_VERSION = 1;

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * Device-wide acknowledgement store around an injectable key-value backend.
 * A missing, corrupt or unknown-version document reads as not acknowledged; a
 * storage failure reads as not acknowledged and a failed write reports false.
 * @param {{get: Function, set: Function, isAvailable?: Function}} backend
 * @returns {object} acknowledgement API
 */
export function createNoticeStore(backend) {
  const available = () => Boolean(
    backend
    && typeof backend.get === 'function'
    && typeof backend.set === 'function'
    && (typeof backend.isAvailable !== 'function' || backend.isAvailable()),
  );

  return {
    isAvailable: available,

    /** Whether this install already acknowledged the notice. */
    async isAcknowledged() {
      if (!available()) return false;
      try {
        const raw = await backend.get(NOTICE_KEY);
        if (typeof raw !== 'string' || raw === '') return false;
        const parsed = JSON.parse(raw);
        return isPlainObject(parsed)
          && parsed.version === NOTICE_SCHEMA_VERSION
          && parsed.acknowledged === true;
      } catch {
        return false;
      }
    },

    /** Record the acknowledgement; false when the device store refused it. */
    async acknowledge(now = () => new Date().toISOString()) {
      if (!available()) return false;
      try {
        await backend.set(NOTICE_KEY, JSON.stringify({
          version: NOTICE_SCHEMA_VERSION,
          acknowledged: true,
          acknowledged_at: now(),
        }));
        return true;
      } catch {
        return false;
      }
    },
  };
}

/**
 * Accessible notice markup. All copy comes from the i18n dictionary through
 * `translate`; the free-level sentence reuses the shared gating-derived
 * helper and the practice labels reuse the existing practice.* keys.
 * @param {{locale?: string, translate: Function, freeCount?: number,
 *   totalLevels?: number|null, practiceKinds?: string[]}} options
 * @returns {string} dialog markup for the caller to insert
 */
export function buildNoticeMarkup({
  locale = DEFAULT_LOCALE,
  translate,
  freeCount = 0,
  totalLevels = null,
  practiceKinds = [],
} = {}) {
  const loc = resolveLocale(locale);
  const tr = typeof translate === 'function' ? translate : (key) => key;
  const modes = practiceKinds
    .map((kind) => tr(`practice.kind.${kind}`))
    .filter((label) => typeof label === 'string' && label && !label.startsWith('practice.kind.'))
    .join(', ');
  const lines = [
    '<div class="overlay-card first-open-notice-card">',
    `  <h2 id="first-open-notice-title">${escapeHtml(tr('notice.title'))}</h2>`,
    `  <p class="notice-thanks">${escapeHtml(tr('notice.thanks'))}</p>`,
    `  <p class="notice-model">${escapeHtml(tr('notice.model'))}</p>`,
    `  <p class="notice-free">${escapeHtml(freeContentText(freeCount, totalLevels, loc))}</p>`,
  ];
  if (modes) {
    lines.push(`  <p class="notice-modes">${escapeHtml(tr('notice.modes', { modes }))}</p>`);
  }
  lines.push(`  <p class="notice-device">${escapeHtml(tr('notice.device'))}</p>`);
  lines.push(`  <button type="button" class="diff-btn action-primary" data-notice-action="continue">${escapeHtml(tr('notice.continue'))}</button>`);
  lines.push('</div>');
  return lines.join('\n');
}

/** Default view: renders the notice into a hidden overlay shell. */
export function createNoticeView({ root } = {}) {
  if (!root) throw new TypeError('A first-open notice root is required');
  return {
    render(markup, handlers = {}) {
      root.innerHTML = markup;
      root.querySelector('[data-notice-action="continue"]')
        ?.addEventListener('click', handlers.continue);
      root.setAttribute('role', 'dialog');
      root.setAttribute('aria-modal', 'true');
      root.setAttribute('aria-labelledby', 'first-open-notice-title');
      if (!root.hasAttribute('tabindex')) root.setAttribute('tabindex', '-1');
    },
    show() {
      root.hidden = false;
      root.style.display = 'flex';
    },
    hide() {
      root.style.display = 'none';
    },
    focusContinue() {
      root.querySelector('[data-notice-action="continue"]')?.focus();
    },
  };
}

/**
 * Create the first-open notice controller.
 *
 * `probe` and `view` are injectable for tests. The notice only shows when the
 * device has not acknowledged it yet; dismissing records the acknowledgement
 * and hides it even when the device store is unavailable.
 * @param {object} options
 * @returns {object} notice API
 */
export function createFirstOpenNotice({
  platform,
  translate,
  getLocale = () => DEFAULT_LOCALE,
  totalLevels = null,
  practiceKinds = [],
  backend,
  view,
  root,
  doc = globalThis.document,
  probe = probeFreeLevels,
  onAcknowledged = () => {},
} = {}) {
  const store = createNoticeStore(backend ?? createPreferencesBackend());
  const host = root ?? doc?.getElementById?.('first-open-notice') ?? null;
  const screen = view ?? createNoticeView({ root: host });

  let freeCount = 0;
  let visible = false;
  let destroyed = false;

  async function computeFreeCount() {
    const max = Number.isInteger(totalLevels) && totalLevels > 0 ? totalLevels : undefined;
    try {
      freeCount = await probe(platform, max === undefined ? {} : { max });
    } catch {
      freeCount = 0;
    }
    if (!Number.isInteger(freeCount) || freeCount < 0) freeCount = 0;
  }

  function render() {
    if (destroyed) return;
    screen.render(buildNoticeMarkup({
      locale: getLocale(),
      translate,
      freeCount,
      totalLevels,
      practiceKinds,
    }), { continue: dismiss });
  }

  async function open() {
    if (destroyed) return false;
    visible = true;
    await computeFreeCount();
    if (destroyed) return false;
    render();
    screen.show();
    screen.focusContinue?.();
    return true;
  }

  async function dismiss() {
    if (!visible) return false;
    visible = false;
    // Hide first so a slow or unavailable device store can never block the
    // continue action; the acknowledgement is best effort.
    screen.hide();
    const saved = await store.acknowledge();
    if (saved) onAcknowledged();
    return saved;
  }

  /** Show only on a device that has not acknowledged the notice yet. */
  async function maybeShow() {
    if (destroyed) return false;
    if (await store.isAcknowledged()) return false;
    return open();
  }

  function destroy() {
    destroyed = true;
    visible = false;
    screen.hide?.();
  }

  return {
    maybeShow,
    open,
    dismiss,
    render,
    destroy,
    isOpen: () => visible,
    getFreeCount: () => freeCount,
    store,
  };
}

/** Create the controller and show it when this install has not seen it yet. */
export function mountFirstOpenNotice(options = {}) {
  const notice = createFirstOpenNotice(options);
  void notice.maybeShow();
  return notice;
}
