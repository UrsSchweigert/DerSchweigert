// app-privacy-public.test.mjs — the public app privacy policy pages.
//
// App Store Connect and Play Console need a privacy-policy URL that describes
// the *app*, not the website/account product. The app ships its own bundled
// policy under mobile/legal/; these two pages at the site root are the public
// twins of it, and this suite keeps them honest: both languages present, the
// claims the bundled pages make preserved, no web-only features leaking in,
// and every cross-link resolving to a file that exists.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const mobileRoot = join(here, '..');
const staticRoot = join(mobileRoot, '..', 'static');

const read = (...parts) => readFileSync(join(...parts), 'utf8');

const publicPages = {
  de: read(staticRoot, 'datenschutz-app.html'),
  en: read(staticRoot, 'datenschutz-app.en.html'),
};
const bundledPages = {
  de: read(mobileRoot, 'legal', 'privacy.de.html'),
  en: read(mobileRoot, 'legal', 'privacy.en.html'),
};

const headings = (html) => [...html.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/g)].map((m) => m[1].trim());

test('both public app privacy pages exist at the site root', () => {
  for (const file of ['datenschutz-app.html', 'datenschutz-app.en.html']) {
    assert.ok(existsSync(join(staticRoot, file)), `${file} must be deployed to the bucket root`);
  }
});

test('each page declares its own language', () => {
  assert.match(publicPages.de, /<html lang="de">/);
  assert.match(publicPages.en, /<html lang="en">/);
  assert.match(publicPages.de, /<h1>Datenschutzerklärung der App<\/h1>/);
  assert.match(publicPages.en, /<h1>App Privacy Policy<\/h1>/);
});

test('the app pages keep every section the bundled app policy has', () => {
  // A public policy that quietly drops a section the app itself promises is
  // the drift that matters, so the bundled headings must be a subset.
  for (const locale of ['de', 'en']) {
    const bundled = new Set(headings(bundledPages[locale]));
    const published = new Set(headings(publicPages[locale]));
    for (const heading of bundled) {
      assert.ok(published.has(heading), `${locale}: public page is missing the "${heading}" section`);
    }
  }
});

test('the app-specific promises reach both public pages', () => {
  const claims = {
    de: [/erhebt, überträgt und verarbeitet keine personenbezogenen Daten/, /keine Analyse/, /keine Werbung/,
      /kein Tracking/, /offline/, /iCloud/, /Bayerische Landesamt für Datenschutzaufsicht/],
    en: [/collects, transmits and processes no personal data/, /no analytics/, /no advertising/,
      /no tracking/, /offline/, /iCloud/, /Bavarian State Office for Data Protection/],
  };
  for (const [locale, patterns] of Object.entries(claims)) {
    for (const pattern of patterns) {
      assert.match(publicPages[locale], pattern, `${locale} page lost: ${pattern}`);
    }
  }
});

test('the app pages stay clear of website-only processing', () => {
  // Accounts, Turnstile, leaderboards, cancellation requests and the web
  // subscription are described in datenschutz.html; repeating them here would
  // make the app policy claim data collection the app does not do.
  const webOnly = ['Turnstile', 'Kündigungsanfrage', 'cancel-request', 'Bestenliste', 'leaderboard',
    'Abonnement', 'subscription', 'bcrypt'];
  for (const [locale, html] of Object.entries(publicPages)) {
    for (const term of webOnly) {
      assert.ok(!html.includes(term), `${locale} app page must not mention "${term}"`);
    }
  }
});

test('each page points at the other policy, the imprint and the other language', () => {
  for (const href of ['datenschutz.html', 'impressum.html', 'terms.html']) {
    assert.ok(publicPages.de.includes(`href="${href}"`), `German app page must link ${href}`);
  }
  for (const href of ['datenschutz.en.html', 'impressum.en.html', 'terms.en.html']) {
    assert.ok(publicPages.en.includes(`href="${href}"`), `English app page must link ${href}`);
  }
  assert.ok(publicPages.de.includes('href="datenschutz-app.en.html"'), 'German page needs the English twin');
  assert.ok(publicPages.en.includes('href="datenschutz-app.html"'), 'English page needs the German twin');
});

test('every link on the app pages resolves to a deployed file or an allowed host', () => {
  const allowedHosts = /^https:\/\/(www\.apple\.com|policies\.google\.com|www\.lda\.bayern\.de)\//;
  for (const [locale, html] of Object.entries(publicPages)) {
    for (const match of html.matchAll(/\bhref="([^"]+)"/g)) {
      const href = match[1];
      if (href.startsWith('mailto:') || allowedHosts.test(href)) continue;
      assert.ok(!/^https?:/.test(href), `${locale}: unexpected external link ${href}`);
      assert.ok(!href.startsWith('/') && !href.startsWith('#'), `${locale}: expected a relative link, got ${href}`);
      assert.ok(existsSync(join(staticRoot, href.split(/[?#]/)[0])), `${locale}: ${href} does not exist`);
    }
  }
});

test('the website policy points readers at the app policy, and the beta page links it', () => {
  assert.match(read(staticRoot, 'datenschutz.html'), /href="datenschutz-app\.html"/);
  assert.match(read(staticRoot, 'datenschutz.en.html'), /href="datenschutz-app\.en\.html"/);

  const beta = read(staticRoot, 'beta', 'index.html');
  assert.match(beta, /href="\/datenschutz-app\.html"/, 'the beta page must link the app policy');
});

test('the app pages carry no inline scripts, styles or disallowed hosts', () => {
  for (const [locale, html] of Object.entries(publicPages)) {
    assert.deepEqual(html.match(/<script\b[^>]*>/gi) ?? [], [], `${locale}: app privacy pages need no script`);
    assert.ok(!/<style\b/i.test(html), `${locale}: styles belong in legal.css`);
    assert.ok(!/style="/i.test(html), `${locale}: no inline style attributes`);
  }
});
