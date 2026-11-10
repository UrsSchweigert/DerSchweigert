// legal.js — App legal pages: title-screen links and the external-link gate.
//
// The app ships its own privacy, imprint, terms and licence pages under
// legal/ (source: mobile/legal/, copied to www/legal/). They replace the web
// legal footer, which describes accounts, cookies and billing the app does
// not have. Every link that leaves the app runs the parental gate from
// ./parental-gate.js first; the document, gate and UI are injectable so
// node:test can drive this module without a browser.

import {
  DEFAULT_LOCALE,
  buildGateMarkup,
  gate as parentalGate,
  resolveLocale,
} from './parental-gate.js';
import { MUSIC_TRACKS } from './music-manifest.js';

export { resolveLocale };

/** The four bundled legal pages, one DE and one EN file each. */
export const LEGAL_PAGE_KINDS = Object.freeze(['privacy', 'imprint', 'terms', 'licence']);

/** The bundled player manual, one DE and one EN file each. */
export const MANUAL_LOCALES = Object.freeze(['de', 'en']);

/** Title-screen link labels, keyed like the game's i18n dictionary. */
export const STRINGS = Object.freeze({
  'legal.privacy': { en: 'Privacy', de: 'Datenschutz' },
  'legal.imprint': { en: 'Legal notice', de: 'Impressum' },
  'legal.terms': { en: 'Terms', de: 'AGB' },
  'legal.licence': { en: 'Licence & credits', de: 'Lizenz & Credits' },
  'legal.manual': { en: 'Manual', de: 'Handbuch' },
});

export function legalText(key, locale = DEFAULT_LOCALE) {
  return STRINGS[key][resolveLocale(locale)];
}

/**
 * Bundle-relative path of a legal page, as linked from www/index.html.
 * @param {'privacy'|'imprint'|'terms'|'licence'} kind
 * @param {string} [locale]
 * @returns {string} e.g. "legal/privacy.de.html"
 */
export function legalPagePath(kind, locale = DEFAULT_LOCALE) {
  if (!LEGAL_PAGE_KINDS.includes(kind)) {
    throw new RangeError(`unknown legal page: ${kind}`);
  }
  return `legal/${kind}.${resolveLocale(locale)}.html`;
}

/** Bundle-relative path of the player manual in the requested language. */
export function manualPagePath(locale = DEFAULT_LOCALE) {
  return `legal/manual.${resolveLocale(locale)}.html`;
}

/** Localized title-screen links to every bundled legal page, manual first. */
export function buildTitleLegalLinks(locale = DEFAULT_LOCALE) {
  const loc = resolveLocale(locale);
  const manual = `<a href="${manualPagePath(loc)}">${legalText('legal.manual', loc)}</a>`;
  return [manual, ...LEGAL_PAGE_KINDS
    .map((kind) => `<a href="${legalPagePath(kind, loc)}">${legalText(`legal.${kind}`, loc)}</a>`)]
    .join('\n');
}

/**
 * Replace the title screen's web legal footer with the app pages, keeping any
 * controls the app owns (the cookie-settings button) in place. Re-renders when
 * the locale changes and returns an unsubscribe function.
 */
export function setupTitleLegalLinks({ doc = globalThis.document, getLocale, onLocaleChange } = {}) {
  const container = doc?.querySelector?.('.splash-legal-links');
  if (!container) return () => {};
  const controls = [...container.querySelectorAll('button')];
  const render = () => {
    const locale = typeof getLocale === 'function' ? getLocale() : doc.documentElement?.lang;
    container.innerHTML = buildTitleLegalLinks(locale);
    for (const control of controls) {
      container.appendChild(control);
    }
  };
  render();
  const off = typeof onLocaleChange === 'function' ? onLocaleChange(render) : null;
  return () => {
    if (typeof off === 'function') off();
  };
}

/** Whether a link leaves the app and therefore needs the parental gate. */
export function isExternalHref(href) {
  if (typeof href !== 'string') return false;
  const value = href.trim();
  return /^(?:https?:|mailto:|tel:)/i.test(value) || value.startsWith('//');
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** One list item per bundled track, straight from the music manifest. */
export function buildMusicCreditsMarkup(locale = DEFAULT_LOCALE) {
  resolveLocale(locale);
  return MUSIC_TRACKS.map((track) => {
    const source = track.source
      ? ` — <a href="${escapeHtml(track.source)}" rel="noopener noreferrer">${escapeHtml(track.source)}</a>`
      : '';
    return `<li><strong>${escapeHtml(track.title)}</strong> — ${escapeHtml(track.author)}, `
      + `<code>${escapeHtml(track.file)}</code> (${escapeHtml(track.licence)})${source}</li>`;
  }).join('');
}

/** Default gate UI: render the accessible dialog and resolve its answer. */
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
        const cancel = () => {
          close();
          const error = new Error('cancelled');
          error.code = 'cancelled';
          reject(error);
        };
        host.querySelector('#parental-gate-cancel')?.addEventListener('click', cancel);
        host.addEventListener('keydown', (event) => {
          if (event.key === 'Escape') cancel();
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
 * Intercept external anchor clicks and open the target only after the gate.
 * @param {{doc?: Document, gate?: Function, gateUi?: object, open?: Function}} options
 * @returns {() => void} detach function
 */
export function gateExternalLinks({
  doc = globalThis.document,
  gate = parentalGate,
  gateUi,
  open,
} = {}) {
  if (!doc?.addEventListener) throw new TypeError('gateExternalLinks needs a document');
  if (typeof gate !== 'function') throw new TypeError('gateExternalLinks needs a gate function');
  if (!gateUi) throw new TypeError('gateExternalLinks needs a gate ui');
  const opener = open ?? ((href) => {
    const view = doc.defaultView;
    if (/^(?:mailto:|tel:)/i.test(href) && view) view.location.href = href;
    else view?.open?.(href, '_blank', 'noopener,noreferrer');
  });
  const onClick = async (event) => {
    const anchor = event.target?.closest?.('a[href]');
    if (!anchor) return;
    const href = anchor.getAttribute('href') ?? '';
    if (!isExternalHref(href)) return;
    event.preventDefault();
    const locale = resolveLocale(doc.documentElement?.lang);
    let allowed = false;
    try {
      allowed = await gate({ ui: gateUi, action: 'external-link', locale });
    } catch {
      allowed = false;
    }
    if (allowed) opener(href);
  };
  doc.addEventListener('click', onClick);
  return () => doc.removeEventListener('click', onClick);
}

/** Wire a bundled legal page: music credits plus the external-link gate. */
export function wireLegalPage({ doc = globalThis.document, gate = parentalGate } = {}) {
  if (!doc) return () => {};
  const credits = doc.querySelector?.('[data-music-credits]');
  if (credits) credits.innerHTML = buildMusicCreditsMarkup(doc.documentElement?.lang);
  return gateExternalLinks({ doc, gate, gateUi: createDomGateUi({ doc }) });
}

// Legal pages carry data-legal-page; the game's title screen does not, so
// importing this module from main.js never installs a second click handler.
if (typeof document !== 'undefined' && document.body?.dataset?.legalPage) {
  wireLegalPage({ doc: document });
}
