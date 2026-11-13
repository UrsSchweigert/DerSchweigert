// beta.test.js — regression tests for the /beta/ open-beta invite page.
//
// Run with: node --test sites/ffm/static/beta/beta.test.js
//
// The page is a static German document under the same strict CSP as /promo/,
// reuses the landing page's locale layer and ships exactly one external
// script. These tests fail loudly when the copy, the dictionary, the links,
// the waitlist form or that arrangement drift. No dependencies beyond node
// builtins.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, normalize } from 'node:path';

import { DICTIONARY as PROMO_DICTIONARY, SUPPORTED_LOCALES, DEFAULT_LOCALE, STORAGE_KEY } from '../promo/promo.js';
import { DICTIONARY } from './beta.js';

const here = dirname(fileURLToPath(import.meta.url));
// sites/ffm/static is the web root, so "/game/…" resolves below it.
const webRoot = normalize(join(here, '..'));

const read = (name) => readFileSync(join(here, name), 'utf8');

// The page reuses /promo/promo.js, so its markup may use the shared promo keys
// (for example the gameplay band) as well as beta.js's own beta.* keys.
const lookup = (key) => DICTIONARY[key] ?? PROMO_DICTIONARY[key];
const html = read('index.html');
const css = read('beta.css');
const js = read('beta.js');

const TESTFLIGHT_JOIN = 'https://testflight.apple.com/join/66sUYcn3';
const TESTFLIGHT_APP = 'https://apps.apple.com/app/testflight/id899247664';

// Escapes every regex metacharacter, backslash included, so a URL can be
// matched literally: an unescaped '.' would also match 'appleXcom'.
const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Keys the script writes into the empty status region; they can never appear
// as markup text, so the "no unused key" check has to know about them.
const SCRIPT_ONLY_KEYS = new Set([
  'beta.waitlist.sending',
  'beta.waitlist.registered',
  'beta.waitlist.already',
  'beta.waitlist.invalid',
  'beta.waitlist.needsGmail',
  'beta.waitlist.rateLimited',
  'beta.waitlist.error',
]);

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

test('dictionary covers both locales and keeps the beta.* namespace', () => {
  assert.deepEqual(SUPPORTED_LOCALES, ['de', 'en']);
  assert.equal(DEFAULT_LOCALE, 'de');
  // Shared with the landing page and the game, so one privacy-policy key suffices.
  assert.equal(STORAGE_KEY, 'ffm_locale');

  for (const [key, entry] of Object.entries(DICTIONARY)) {
    assert.ok(key.startsWith('beta.'), `"${key}" must be prefixed so it cannot collide with /promo/`);
    const locales = Object.keys(entry).sort();
    assert.deepEqual(locales, ['de', 'en'], `key "${key}" must define exactly de and en`);
    for (const locale of locales) {
      assert.equal(typeof entry[locale], 'string', `${key}.${locale} must be a string`);
      assert.ok(entry[locale].trim().length > 0, `${key}.${locale} must not be empty`);
    }
  }
});

test('every data-i18n key in index.html exists in the shared or beta dictionary', () => {
  const missing = [...referencedKeys].filter((key) => !lookup(key));
  assert.deepEqual(missing, [],
    `markup uses keys missing from beta.js and promo.js: ${missing.join(', ')}`);
});

test('no dictionary key is unused', () => {
  const unused = Object.keys(DICTIONARY).filter(
    (key) => !referencedKeys.has(key) && !SCRIPT_ONLY_KEYS.has(key),
  );
  assert.deepEqual(unused, [], `dictionary keys not used in index.html: ${unused.join(', ')}`);
});

test('every script-only key is actually written by the form code', () => {
  for (const key of SCRIPT_ONLY_KEYS) {
    assert.ok(key in DICTIONARY, `${key} must exist in the dictionary`);
    assert.ok(js.includes(`'${key}'`), `${key} is in the script-only allowlist but the script never uses it`);
  }
});

test('markup carries the German copy verbatim, so no-JS visitors see German', () => {
  const pattern = /<([a-z][a-z0-9]*)\b([^>]*\bdata-i18n="([^"]+)"[^>]*)>((?:[^<]|<span class="nb">|<\/span>)*)<\/\1>/g;
  const checked = new Set();
  let match;
  while ((match = pattern.exec(html)) !== null) {
    const [, , , key, text] = match;
    const entry = lookup(key);
    assert.ok(entry, `missing dictionary entry for "${key}"`);
    const expected = entry.de;
    const actual = decodeEntities(stripNoBreak(text));
    assert.equal(actual, expected, `markup text for "${key}" drifts from the de dictionary value`);
    checked.add(key);
  }
  for (const key of i18nKeys.text) {
    assert.ok(checked.has(key), `"${key}" is not a leaf element that the test can verify`);
  }
});

// --- iOS links and honesty ----------------------------------------------

test('the iOS beta is a real TestFlight link in the hero, the steps and the track footer', () => {
  const occurrences = html.split(`href="${TESTFLIGHT_JOIN}"`).length - 1;
  assert.equal(occurrences, 3, 'hero, step 2 and the iOS track must all link to the TestFlight invitation');
  for (const tag of html.match(new RegExp(`<a\\b[^>]*href="${escapeRegExp(TESTFLIGHT_JOIN)}"[^>]*>`, 'g'))) {
    assert.match(tag, /target="_blank"/, 'external store links open in a new tab');
    assert.match(tag, /rel="noopener"/, 'external links need rel="noopener"');
  }
});

test('the TestFlight app link is the real App Store entry', () => {
  assert.ok(html.includes(`href="${TESTFLIGHT_APP}"`), 'step 1 must link to the TestFlight app');
});

test('Android is never presented as released: no Play link, a waitlist instead', () => {
  assert.ok(!/play\.google\.com/.test(html), 'no Play Store URL may be invented before the track exists');
  assert.match(DICTIONARY['beta.android.badge'].de, /Vorbereitung/);
  assert.match(html, /href="#android"/, 'the hero must point at the Android waitlist');
  assert.match(html, /id="android-waitlist-form"/, 'the Android track must offer the waitlist form');
});

test('legal and support destinations are present', () => {
  for (const href of [
    '/impressum.html',
    '/datenschutz.html',
    '/datenschutz-app.html',
    '/terms.html',
    '/impressum.en.html',
    '/datenschutz.en.html',
    '/terms.en.html',
    'mailto:info@derschweigert.de',
  ]) {
    assert.ok(html.includes(`href="${href}"`), `missing link ${href}`);
  }
  // The beta page is about the app, so the app policy must be reachable from
  // both the footer and the data-protection answer.
  assert.match(html, /data-i18n="beta\.footer\.legalPrivacyApp"/);
  assert.match(html, /data-i18n="beta\.faq\.a6Link"/);
  assert.ok(existsSync(join(webRoot, 'datenschutz-app.html')), 'the app privacy page must be deployed');
});

test('the page states the real platform minimums', () => {
  assert.match(DICTIONARY['beta.ios.deviceValue'].de, /iOS 15 oder neuer/);
  assert.match(DICTIONARY['beta.android.deviceValue'].de, /Android 7\.0 oder neuer/);
  // Both come from the native shells (IPHONEOS_DEPLOYMENT_TARGET, minSdkVersion 24).
  assert.match(html, /iOS 15 oder neuer/);
  assert.match(html, /Android 7\.0 oder neuer/);
});

test('both tracks explain how the full version behaves during the beta', () => {
  const ios = html.match(/id="ios"[\s\S]*?<\/article>/)[0];
  const android = html.match(/id="android"[\s\S]*?<\/article>/)[0];

  assert.match(ios, /data-i18n="beta\.ios\.unlockText"/, 'iOS must say the beta unlock is free');
  assert.match(android, /data-i18n="beta\.android\.unlockText"/, 'Android must explain the promo-code route');
  assert.match(android, /data-i18n="beta\.android\.unlockLink"/, 'Android needs the request link');
  assert.match(android, /href="mailto:info@derschweigert\.de\?subject=[^"]*Promo-Code/, 'the request goes by mail');

  // The public facts the copy depends on: free on iOS, free promo code on Android.
  assert.match(DICTIONARY['beta.ios.unlockText'].de, /kostenlos|nichts/i);
  assert.match(DICTIONARY['beta.android.unlockText'].de, /Promo-Code/);
  assert.match(DICTIONARY['beta.faq.a1'].de, /Promo-Code/, 'the cost FAQ must mention the Android route too');
});

test('the hero no longer carries the browser fallback or the free-levels line', () => {
  for (const dropped of ['beta.hero.ctaWeb', 'beta.hero.print']) {
    assert.ok(!(dropped in DICTIONARY), `${dropped} was removed from the hero and must not stay in the dictionary`);
  }
  assert.deepEqual(html.match(/class="hero-links"|class="hero-print"/g) ?? [], []);
});

// --- waitlist form ------------------------------------------------------

test('the waitlist form posts to the same-origin API with a labelled email input', () => {
  const form = html.match(/<form class="beta-signup"[\s\S]*?<\/form>/);
  assert.ok(form, 'missing the waitlist form');
  assert.match(form[0], /id="android-waitlist-form"/);
  assert.match(form[0], /method="post"/);
  assert.match(form[0], /action="\/api\/beta\/android-waitlist"/, 'the form action must be the real API route');

  const input = form[0].match(/<input\b[^>]*>/);
  assert.ok(input, 'missing the email input');
  assert.match(input[0], /type="email"/);
  assert.match(input[0], /name="email"/);
  assert.match(input[0], /autocomplete="email"/);
  assert.match(input[0], /\brequired\b/);
  assert.match(input[0], /maxlength="254"/, 'the API rejects addresses longer than 254 characters');
  const label = form[0].match(/<label\b[^>]*for="android-waitlist-email"[^>]*>/);
  assert.ok(label, 'the email input needs a label');

  assert.match(form[0], /role="status"/, 'the feedback region must be announced');
  assert.match(form[0], /aria-live="polite"/);
  assert.match(form[0], /href="mailto:info@derschweigert\.de[^"]*"/, 'no-JS visitors need a mail fallback');
});

test('the form script targets the real endpoint and handles every failure class', () => {
  assert.match(js, /const WAITLIST_ENDPOINT = '\/api\/beta\/android-waitlist'/);
  assert.match(js, /method: 'POST'/);
  assert.match(js, /'Content-Type': 'application\/json'/);
  assert.match(js, /response\.status === 429/, 'rate limiting must be explained, not swallowed');
  assert.match(js, /response\.status === 400/, 'a rejected address must be explained');
  assert.match(js, /data\.error === 'google_mail_required'/, 'a non-Gmail address must get its own message');
  assert.match(js, /catch \{/, 'a network failure must not leave the form silent');
  assert.match(js, /button\.disabled = true/, 'a double submit must be prevented');
  assert.match(js, /data\.status === 'already_registered'/, 'a repeat sign-up must read as success');
  assert.match(js, /onLocaleChange\(\(\) => renderWaitlistStatus/, 'a language switch must re-render the feedback');
});

// --- CSP / scripting ----------------------------------------------------

test('exactly one script tag, external, and no inline handlers or javascript: URLs', () => {
  const scriptTags = html.match(/<script\b[^>]*>/gi) || [];
  assert.equal(scriptTags.length, 1, 'the page must ship exactly one <script> tag');
  assert.match(scriptTags[0], /\bsrc="\/beta\/beta\.js"/, 'the single script must load /beta/beta.js');
  assert.match(scriptTags[0], /\btype="module"/, 'beta.js is an ES module and must load as one');

  assert.deepEqual(html.match(/<script(?![^>]*\bsrc=)[^>]*>/gi) || [], [], 'no inline <script> blocks allowed');
  assert.deepEqual(html.match(/\son[a-z]+\s*=/gi) || [], [], 'no inline event handlers allowed');
  assert.ok(!/javascript:/i.test(html), 'no javascript: URLs allowed');
  assert.ok(!/<style\b/i.test(html), 'styles belong in beta.css, not a <style> block');
  assert.ok(!/style="/i.test(html), 'no inline style attributes');
});

test('every reference is root-absolute, allow-listed or an anchor', () => {
  // Served as /beta/ and as /beta (CloudFront rewrite), so a bare relative
  // path would resolve differently depending on the entry point.
  const urls = new Set();
  for (const match of html.matchAll(/\b(?:src|href)="([^"]+)"/g)) urls.add(match[1]);
  for (const match of css.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)) urls.add(match[1]);

  const allowList = [TESTFLIGHT_JOIN, TESTFLIGHT_APP];
  const allowedAbsolute = /^https:\/\/arithmoslayer\.de\//;
  const bad = [];
  for (const url of urls) {
    if (url.startsWith('#') || url.startsWith('/') || url.startsWith('mailto:')) continue;
    if (allowedAbsolute.test(url)) continue;
    if (allowList.includes(url)) continue;
    bad.push(url);
  }
  assert.deepEqual(bad, [], `bare relative or unexpected external URLs: ${bad.join(', ')}`);
});

test('every root-relative asset actually exists in the bucket', () => {
  const urls = new Set();
  for (const match of html.matchAll(/\b(?:src|href)="(\/[^"]*)"/g)) urls.add(match[1]);

  // Server routes: the CloudFront rewrite and the API endpoint.
  const routes = new Set(['/play', '/beta', '/beta/', '/api/beta/android-waitlist']);
  const missing = [];
  for (const url of urls) {
    if (routes.has(url)) continue;
    const clean = decodeURIComponent(url.split(/[?#]/)[0]);
    if (!existsSync(join(webRoot, clean))) missing.push(url);
  }
  assert.deepEqual(missing, [], `referenced but not in sites/ffm/static: ${missing.join(', ')}`);
});

test('the page reuses the landing-page design system and adds only its own CSS', () => {
  assert.match(html, /<link rel="stylesheet" href="\/promo\/promo\.css">/);
  assert.match(html, /<link rel="stylesheet" href="\/beta\/beta\.css">/);
  assert.ok(existsSync(join(here, 'beta.css')), '/beta/beta.css must exist');
  assert.ok(existsSync(join(here, 'beta.js')), '/beta/beta.js must exist');

  // Tokens, buttons, header, sections, FAQ and footer come from promo.css;
  // redefining them here would let the two pages drift apart.
  assert.ok(!/:root\s*\{/.test(css), 'beta.css must not redefine design tokens');
  for (const shared of ['.btn-primary', '.site-header', '.faq-item', '.site-footer', '.hero-stage']) {
    assert.ok(!new RegExp(`${escapeRegExp(shared)}\\s*\\{`).test(css), `beta.css must not restyle ${shared}`);
  }
});

// --- art, module and a11y ----------------------------------------------

test('the beta page carries the looping gameplay band above the requirements', () => {
  const start = html.indexOf('class="shot-band"');
  const end = html.indexOf('class="beta-strip"');
  assert.ok(start > -1 && end > start, 'the band must sit right above the requirements strip');
  const band = html.slice(start, end);

  assert.equal((band.match(/<figure class="shot-frame">/g) || []).length, 5,
    'one primary shot per action');
  assert.equal((band.match(/<figure class="shot-frame shot-clone">/g) || []).length, 5,
    'the loop needs a duplicated, aria-hidden set');
  assert.match(band, /<div class="shot-band-set" aria-hidden="true">/);

  for (const name of ['level-01-strike', 'level-10-fireball', 'level-20-blitz',
    'level-30-dragon', 'level-40-healing']) {
    const url = `/promo/art/shots/${name}.webp`;
    assert.ok(band.includes(`src="${url}"`), `missing ${url} in the beta markup`);
    assert.ok(existsSync(join(webRoot, url)), `missing ${url} on disk`);
  }

  assert.match(band, /<div class="shot-band-viewport" data-pannable-band tabindex="0" role="region"/);
  assert.match(band, /<div class="shot-band-track" data-band-track>/);
  assert.ok(!band.includes('strip-hint'), 'the band carries no disclaimer hint');
});

test('the art gallery uses the promo art that the landing page ships', () => {
  const images = [...html.matchAll(/<img\b[^>]*src="(\/promo\/art\/[^"]+)"/g)].map((m) => m[1]);
  assert.ok(images.length >= 3, 'the page should show promo art');
  for (const src of images) {
    assert.ok(existsSync(join(webRoot, src)), `${src} must exist`);
  }
  assert.match(html, /class="beta-gallery"/);
});

test('beta.js exports the dictionary, reuses promo.js and never touches the DOM at import time', () => {
  assert.equal(typeof DICTIONARY, 'object');
  assert.ok(Object.keys(DICTIONARY).length > 90, 'the dictionary should cover the whole page');
  assert.match(js, /from '\.\.\/promo\/promo\.js'/, 'the locale layer is imported, not copied');
  assert.match(js, /registerDictionary\(DICTIONARY\)/);
  assert.match(js, /onLocaleChange/);
  assert.match(js, /localStorage|getLocale/);
});

test('the language toggle is reachable, labelled and inert without JS', () => {
  const toggle = html.match(/<button id="beta-lang-toggle"[\s\S]*?<\/button>/)[0];
  assert.match(toggle, /type="button"/, 'the toggle must not submit anything');
  assert.match(toggle, /data-i18n-aria-label="beta\.nav\.langToggle"/, 'the toggle needs a translatable accessible name');
  assert.match(toggle, /aria-label="/, 'the toggle needs an accessible name in the static markup');
  assert.match(css, /\.no-js #beta-lang-toggle\s*\{[^}]*display:\s*none/, 'a dead toggle is hidden without JS');
  assert.ok(html.includes('class="no-js"'), 'the document starts as no-js');
});

test('the page has one h1 and the anchors its navigation uses', () => {
  assert.equal((html.match(/<h1\b/g) || []).length, 1, 'exactly one h1');
  assert.ok(html.includes('<body id="beta-root">'), 'the deploy smoke test greps for beta-root');
  for (const id of ['ablauf', 'ios', 'android', 'faq']) {
    assert.ok(html.includes(`id="${id}"`), `missing anchor #${id}`);
  }
  assert.match(css, /#ablauf,\s*\n#ios,\s*\n#android,\s*\n#faq\s*\{[^}]*scroll-margin-top/);
});

test('the requirements strip is centred', () => {
  const list = css.match(/\.beta-strip-list \{[^}]*\}/)[0];
  assert.match(list, /text-align:\s*center/);
  const items = css.match(/\.beta-strip-list li \{[^}]*\}/)[0];
  assert.match(items, /justify-items:\s*center/);
});

test('every image has alt text and intrinsic dimensions', () => {
  for (const tag of html.match(/<img\b[^>]*>/g) || []) {
    assert.match(tag, /\balt="/, `missing alt: ${tag.slice(0, 60)}`);
    assert.match(tag, /\bwidth="/, `missing width: ${tag.slice(0, 60)}`);
    assert.match(tag, /\bheight="/, `missing height: ${tag.slice(0, 60)}`);
  }
});
