// promo.test.js — regression tests for the /promo/ landing page.
//
// Run with: node --test sites/ffm/static/promo/promo.test.js
//
// The page ships under a strict CSP and has to stay a single static German
// document with one external script, so these tests fail loudly when any of
// that drifts. No dependencies beyond node builtins.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, normalize } from 'node:path';

import { DICTIONARY, SUPPORTED_LOCALES, DEFAULT_LOCALE, STORAGE_KEY } from './promo.js';

const here = dirname(fileURLToPath(import.meta.url));
// sites/ffm/static is the web root, so "/game/…" resolves below it.
const webRoot = normalize(join(here, '..'));

const read = (name) => readFileSync(join(here, name), 'utf8');
const html = read('index.html');
const css = read('promo.css');
const js = read('promo.js');

const ENTITIES = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&apos;': "'",
  '&nbsp;': '\u00a0',
  '&ndash;': '–',
  '&mdash;': '—',
  '&shy;': '\u00ad',
  '&#39;': "'",
};

function decodeEntities(value) {
  return value
    .replace(/&(?:amp|lt|gt|quot|apos|nbsp|ndash|mdash|shy|#39);/g, (match) => ENTITIES[match])
    .replace(/\s+/g, ' ')
    .trim();
}

/** `<span class="nb">1–2</span>` is a line-break guard, not content. */
function stripNoBreak(value) {
  return value.replace(/<span class="nb">|<\/span>/g, '');
}

/** Every i18n key referenced from the markup, by attribute flavour. */
function collectI18nKeys() {
  const keys = { text: [], ariaLabel: [], title: [], placeholder: [] };
  const pattern = /\bdata-i18n(-aria-label|-title|-placeholder)?="([^"]*)"/g;
  let match;
  while ((match = pattern.exec(html)) !== null) {
    const flavour = match[1];
    const key = match[2];
    if (!key) continue;
    if (flavour === '-aria-label') keys.ariaLabel.push(key);
    else if (flavour === '-title') keys.title.push(key);
    else if (flavour === '-placeholder') keys.placeholder.push(key);
    else keys.text.push(key);
  }
  return keys;
}

const i18nKeys = collectI18nKeys();
const referencedKeys = new Set([
  ...i18nKeys.text,
  ...i18nKeys.ariaLabel,
  ...i18nKeys.title,
  ...i18nKeys.placeholder,
]);

// --- dictionary ---------------------------------------------------------

test('dictionary defines exactly the two supported locales', () => {
  assert.deepEqual(SUPPORTED_LOCALES, ['de', 'en']);
  assert.equal(DEFAULT_LOCALE, 'de');
  // Shared with the game (game/i18n.js) and the only key the privacy policy lists.
  assert.equal(STORAGE_KEY, 'ffm_locale');

  for (const [key, entry] of Object.entries(DICTIONARY)) {
    const locales = Object.keys(entry).sort();
    assert.deepEqual(locales, ['de', 'en'], `key "${key}" must define exactly de and en`);
    for (const locale of locales) {
      const value = entry[locale];
      assert.equal(typeof value, 'string', `${key}.${locale} must be a string`);
      assert.ok(value.trim().length > 0, `${key}.${locale} must not be empty`);
    }
  }
});

test('every data-i18n key in index.html exists in the dictionary', () => {
  const missing = [...referencedKeys].filter((key) => !(key in DICTIONARY));
  assert.deepEqual(missing, [], `markup uses keys missing from promo.js: ${missing.join(', ')}`);
});

test('no dictionary key is unused', () => {
  const unused = Object.keys(DICTIONARY).filter((key) => !referencedKeys.has(key));
  assert.deepEqual(unused, [], `dictionary keys not used in index.html: ${unused.join(', ')}`);
});

test('markup carries the German copy verbatim, so no-JS visitors see German', () => {
  const pattern = /<([a-z][a-z0-9]*)\b([^>]*\bdata-i18n="([^"]+)"[^>]*)>((?:[^<]|<span class="nb">|<\/span>)*)<\/\1>/g;
  const checked = new Set();
  let match;
  while ((match = pattern.exec(html)) !== null) {
    const [, , , key, text] = match;
    const expected = DICTIONARY[key].de;
    const actual = decodeEntities(stripNoBreak(text));
    assert.equal(actual, expected, `markup text for "${key}" drifts from the de dictionary value`);
    checked.add(key);
  }
  // Leaf-element coverage: the big text blocks must all have been compared.
  for (const key of referencedKeys) {
    if (i18nKeys.text.includes(key)) {
      assert.ok(checked.has(key), `"${key}" is not a leaf element that the test can verify`);
    }
  }
});

test('German uses comma decimals, English uses dot decimals', () => {
  assert.ok(html.includes('3,00 EUR'), 'German markup must show 3,00 EUR');
  assert.ok(html.includes('3,99 EUR'), 'German markup must show 3,99 EUR');
  assert.equal(DICTIONARY['prices.web.price'].en, 'EUR 3.00');
  assert.equal(DICTIONARY['prices.app.price'].en, 'EUR 3.99');

  const offenders = [];
  for (const [key, entry] of Object.entries(DICTIONARY)) {
    if (key === 'prices.web.price' || key === 'prices.app.price') continue;
    if (/3[.,]00(?!\d)/.test(entry.de) || /3[.,]99(?!\d)/.test(entry.de)) {
      if (!/3,00|3,99/.test(entry.de)) offenders.push(`${key}.de`);
    }
    if (/3,00|3,99/.test(entry.en)) offenders.push(`${key}.en`);
  }
  assert.deepEqual(offenders, [], `wrong decimal separator in: ${offenders.join(', ')}`);
});

// --- CSP / scripting ----------------------------------------------------

test('exactly one script tag, external, and no inline handlers or javascript: URLs', () => {
  const scriptTags = html.match(/<script\b[^>]*>/gi) || [];
  assert.equal(scriptTags.length, 1, 'the page must ship exactly one <script> tag');
  assert.match(scriptTags[0], /\bsrc="\/promo\/promo\.js"/, 'the single script must load /promo/promo.js');
  assert.match(scriptTags[0], /\btype="module"/, 'promo.js is an ES module and must load as one');

  assert.deepEqual(html.match(/<script(?![^>]*\bsrc=)[^>]*>/gi) || [], [], 'no inline <script> blocks allowed');
  assert.deepEqual(html.match(/\son[a-z]+\s*=/gi) || [], [], 'no inline event handlers allowed');
  assert.ok(!/javascript:/i.test(html), 'no javascript: URLs allowed');
  assert.ok(!/<style\b/i.test(html), 'styles belong in promo.css, not a <style> block');
  assert.ok(!/style="/i.test(html), 'no inline style attributes');
});

test('every asset reference is root-absolute, allow-listed or an anchor', () => {
  // The page is served at "/" and at "/promo" (CloudFront viewer-request
  // rewrite keeps the browser URL), so a bare relative "promo.css" resolves to
  // "/promo.css" or "/promo/promo.css" depending on the entry point — one of
  // them always 403s. Every reference therefore has to be root-absolute.
  const urls = new Set();
  for (const match of html.matchAll(/\b(?:src|href)="([^"]+)"/g)) urls.add(match[1]);
  for (const match of css.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)) urls.add(match[1]);
  for (const match of html.matchAll(/<link\b[^>]*\bhref="([^"]+)"/g)) urls.add(match[1]);

  const allowedAbsolute = /^https:\/\/arithmoslayer\.de\//;
  const bad = [];
  for (const url of urls) {
    if (url.startsWith('#') || url.startsWith('mailto:')) continue;
    if (url.startsWith('/')) continue;
    if (allowedAbsolute.test(url)) continue;
    bad.push(url);
  }
  assert.deepEqual(bad, [], `bare relative URLs break at / and /promo: ${bad.join(', ')}`);
});

test('the page loads its own CSS and JS from /promo/', () => {
  assert.match(html, /<link rel="stylesheet" href="\/promo\/promo\.css">/);
  assert.match(html, /<script src="\/promo\/promo\.js" type="module"><\/script>/);
  assert.ok(existsSync(join(here, 'promo.css')), '/promo/promo.css must exist');
  assert.ok(existsSync(join(here, 'promo.js')), '/promo/promo.js must exist');
});

test('every root-relative asset actually exists in the bucket', () => {
  const urls = new Set();
  for (const match of html.matchAll(/\b(?:src|href)="(\/[^"]*)"/g)) urls.add(match[1]);

  // /play is a server route (same handler as the game page), not a static file.
  const routes = new Set(['/play']);
  const missing = [];
  for (const url of urls) {
    if (routes.has(url)) continue;
    const clean = decodeURIComponent(url.split(/[?#]/)[0]);
    if (!existsSync(join(webRoot, clean))) missing.push(url);
  }
  assert.deepEqual(missing, [], `root-relative assets missing from sites/ffm/static: ${missing.join(', ')}`);
});

test('every <img> declares intrinsic size to avoid layout shift', () => {
  const imgs = html.match(/<img\b[^>]*>/gi) || [];
  assert.ok(imgs.length > 0, 'the page should use game art');
  const bad = imgs.filter((tag) => !/\bwidth="\d+"/.test(tag) || !/\bheight="\d+"/.test(tag));
  assert.deepEqual(bad, [], `images without width/height: ${bad.join('\n')}`);
  const badAlt = imgs.filter((tag) => !/\balt="/.test(tag));
  assert.deepEqual(badAlt, [], `images without alt: ${badAlt.join('\n')}`);
});

// --- structure ----------------------------------------------------------

test('required section anchors and navigation exist', () => {
  for (const id of ['hero', 'generationen', 'kunst', 'spiel', 'preise', 'familie', 'faq']) {
    assert.match(html, new RegExp(`id="${id}"`), `missing section #${id}`);
  }
  for (const anchor of ['#spiel', '#kunst', '#preise', '#familie', '#faq']) {
    assert.match(html, new RegExp(`href="${anchor}"`), `missing nav/anchor link to ${anchor}`);
  }
  assert.match(html, /href="\/play"/, 'a link to /play must exist');
  assert.match(html, /id="promo-lang-toggle"/, 'language toggle button is required');
  assert.match(html, /href="#main"/, 'skip link target is required');
});

test('document shell: one h1, German default, required meta', () => {
  assert.match(html, /<html lang="de" class="no-js">/, 'static HTML must declare German and no-js');
  assert.equal((html.match(/<h1\b/g) || []).length, 1, 'exactly one h1');
  assert.match(html, /<title>[^<]+<\/title>/);
  assert.match(html, /<meta name="description" content="[^"]{60,}"/);
  assert.match(html, /<link rel="canonical" href="https:\/\/arithmoslayer\.de\/">/);
  assert.match(html, /<meta name="robots" content="index,follow">/);
  assert.match(html, /<meta name="theme-color" content="#0d1b2a">/);
  assert.match(html, /<link rel="icon" href="\/favicon\.png"/);
  assert.match(html, /<link rel="apple-touch-icon" href="\/apple-touch-icon\.png"/);
  assert.match(html, /<meta property="og:title"/);
  assert.match(html, /<meta property="og:description"/);
  assert.match(html, /<meta property="og:url" content="https:\/\/arithmoslayer\.de\/">/);
  assert.match(html, /<meta property="og:type" content="website">/);
  assert.match(html, /<meta property="og:locale" content="de_DE">/);
  assert.match(html, /<meta property="og:image" content="https:\/\/arithmoslayer\.de\/promo\/og-image\.png">/);
  assert.match(html, /<meta property="og:image:width" content="1200">/);
  assert.match(html, /<meta property="og:image:height" content="630">/);
  assert.match(html, /<meta name="twitter:card" content="summary_large_image">/);
  assert.match(html, /<meta name="twitter:image" content="https:\/\/arithmoslayer\.de\/promo\/og-image\.png">/);
  // Every og-image reference must carry the /promo/ directory.
  assert.equal(
    (html.match(/og-image\.png/g) || []).length,
    (html.match(/\/promo\/og-image\.png/g) || []).length,
    'og-image.png must be referenced as /promo/og-image.png',
  );
});

test('body carries id="promo-root" for the production smoke test', () => {
  // deploy.yml greps the served "/" document for this marker.
  assert.match(html, /<body id="promo-root">/);
});

test('numeric ranges are kept together', () => {
  // German breaks "1–2" after the en dash, which is how "Level 1–/2" appears
  // at 320 px. Every range in the page body must sit in a .nb wrapper.
  const body = html.slice(html.indexOf('<body'));
  const ranges = [...body.matchAll(/\d+–\d+/g)];
  assert.ok(ranges.length > 5, 'the page should still state level ranges');
  const unwrapped = [];
  for (const match of ranges) {
    const before = body.slice(Math.max(0, match.index - 18), match.index);
    const after = body.slice(match.index + match[0].length, match.index + match[0].length + 8);
    if (!before.endsWith('<span class="nb">') || !after.startsWith('</span>')) unwrapped.push(match[0]);
  }
  assert.deepEqual(unwrapped, [], `ranges without <span class="nb">: ${unwrapped.join(', ')}`);
});

test('language toggle is an action, and hidden without JS', () => {
  assert.match(html, /id="promo-lang-toggle"/);
  const toggle = html.match(/<button id="promo-lang-toggle"[^>]*>/)[0];
  assert.ok(!/aria-pressed/.test(toggle), 'a language switch is not a toggle button state');
  assert.match(toggle, /aria-label="/, 'the toggle needs an accessible name');
  assert.match(css, /html\.no-js #promo-lang-toggle|(?<=\n)\.no-js #promo-lang-toggle/);
  assert.match(js, /classList\.remove\('no-js'\)/);
});

test('the comparison table is a reachable, announced scroll region', () => {
  const wrap = html.match(/<div class="table-wrap[^"]*"[^>]*>/)[0];
  assert.match(wrap, /tabindex="0"/);
  assert.match(wrap, /role="region"/);
  assert.match(wrap, /aria-label="[^"]+"/);
});

test('the skip link is fixed so it appears where focus is', () => {
  const block = css.match(/\.skip-link \{[^}]*\}/)[0];
  assert.match(block, /position: fixed/);
});

test('legal, support and pricing facts are present', () => {
  for (const href of [
    '/impressum.html',
    '/datenschutz.html',
    '/terms.html',
    '/cancel.html',
    '/widerruf.html',
    '/impressum.en.html',
    '/datenschutz.en.html',
    '/terms.en.html',
    'mailto:info@derschweigert.de',
  ]) {
    assert.ok(html.includes(`href="${href}"`), `missing footer link ${href}`);
  }
  assert.ok(html.includes('arithmoslayer_full_unlock') === false, 'internal product id must not leak into copy');
  // Honest store messaging: coming-soon badges, never fake store URLs.
  assert.ok(!/apps\.apple\.com|play\.google\.com/.test(html), 'no store URLs may be invented');
  assert.match(html, /prices\.app\.iosBadge/);
  assert.match(html, /prices\.app\.androidBadge/);
});

// --- module + og image --------------------------------------------------

test('promo.js exports the dictionary and never touches the DOM at import time', () => {
  assert.equal(typeof DICTIONARY, 'object');
  assert.ok(Object.keys(DICTIONARY).length > 40, 'the dictionary should cover the whole page');
  assert.match(js, /export function setLocale/);
  assert.match(js, /localStorage/);
  assert.match(js, /prefers-reduced-motion/);
});

test('og-image.png exists at exactly 1200x630 (PNG IHDR)', () => {
  const file = join(here, 'og-image.png');
  assert.ok(existsSync(file), 'og-image.png is missing');
  const buffer = readFileSync(file);
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.ok(buffer.subarray(0, 8).equals(signature), 'og-image.png is not a PNG');
  assert.equal(buffer.subarray(12, 16).toString('ascii'), 'IHDR');
  assert.equal(buffer.readUInt32BE(16), 1200, 'og-image width must be 1200');
  assert.equal(buffer.readUInt32BE(20), 630, 'og-image height must be 630');
  assert.ok(buffer.length < 1_500_000, `og-image.png is too heavy: ${buffer.length} bytes`);
});

test('reduced-motion and no-scroll regressions are handled in CSS', () => {
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(css, /scroll-margin-top/);
  assert.match(css, /overflow-x: clip/);
  assert.match(css, /:focus-visible/);
  assert.match(css, /min-height: 44px/);
});
