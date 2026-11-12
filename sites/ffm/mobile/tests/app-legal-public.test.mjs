// app-legal-public.test.mjs — the public app legal pages.
//
// App Store Connect and Play Console need a privacy-policy URL that describes
// the *app*, not the website/account product, and the same pages are what the
// app's own legal screen links to. The app ships its bundled documents under
// mobile/legal/; these pages at the site root are their public twins, and this
// suite keeps them honest: both languages present, every section of the
// bundled document preserved, no web-only features leaking in, and every
// cross-link resolving to a file that exists.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const mobileRoot = join(here, '..');
const staticRoot = join(mobileRoot, '..', 'static');

const read = (...parts) => readFileSync(join(...parts), 'utf8');
const headings = (html) => [...html.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/g)].map((m) => m[1].trim());

/** The public page, the bundled page it mirrors, and what each must not say. */
const PAGES = {
  privacy: {
    files: { de: 'datenschutz-app.html', en: 'datenschutz-app.en.html' },
    bundled: { de: 'privacy.de.html', en: 'privacy.en.html' },
    titles: { de: 'Datenschutzerklärung der App', en: 'App Privacy Policy' },
    // Website/account processing belongs in datenschutz.html, never here.
    forbidden: ['Turnstile', 'Kündigungsanfrage', 'cancel-request', 'Bestenliste', 'leaderboard',
      'Abonnement', 'subscription', 'bcrypt'],
    claims: {
      de: [/erhebt, überträgt und verarbeitet keine personenbezogenen Daten/, /keine Analyse/, /keine Werbung/,
        /kein Tracking/, /offline/, /iCloud/, /Bayerische Landesamt für Datenschutzaufsicht/],
      en: [/collects, transmits and processes no personal data/, /no analytics/, /no advertising/,
        /no tracking/, /offline/, /iCloud/, /Bavarian State Office for Data Protection/],
    },
    // The older app policy may also gain a section the public page has not
    // got yet, so this one is a subset check in both directions of intent:
    // published sections must cover the bundled ones.
    crossLinks: {
      de: ['datenschutz.html', 'impressum.html', 'agb-app.html'],
      en: ['datenschutz.en.html', 'impressum.en.html', 'agb-app.en.html'],
    },
  },
  terms: {
    files: { de: 'agb-app.html', en: 'agb-app.en.html' },
    bundled: { de: 'terms.de.html', en: 'terms.en.html' },
    titles: { de: 'Allgemeine Geschäftsbedingungen der App', en: 'App Terms of Use' },
    // The app has no subscription; the website product does. The app terms
    // negate that on purpose ("Es gibt kein Abonnement"), so the guard is on
    // the web subscription's concrete terms instead of the bare word.
    forbidden: ['3,00 EUR', 'alle 3 Kalendermonate', 'EUR 3.00', 'every 3 calendar months', 'Turnstile'],
    claims: {
      de: [/Es gibt kein Abonnement/, /einmaligen In-App-Kauf/, /Erstattung/, /Haftung/],
      en: [/There is no subscription/, /one-time in-app purchase/, /Refund/, /Liability/],
    },
    crossLinks: {
      de: ['datenschutz-app.html', 'impressum.html', 'terms.html'],
      en: ['datenschutz-app.en.html', 'impressum.en.html', 'terms.en.html'],
    },
  },
};

const load = ({ files, bundled }) => ({
  public: { de: read(staticRoot, files.de), en: read(staticRoot, files.en) },
  bundled: { de: read(mobileRoot, 'legal', bundled.de), en: read(mobileRoot, 'legal', bundled.en) },
});

for (const [kind, spec] of Object.entries(PAGES)) {
  const { public: published, bundled } = load(spec);

  test(`${kind}: both public pages are deployed to the bucket root`, () => {
    for (const file of Object.values(spec.files)) {
      assert.ok(existsSync(join(staticRoot, file)), `${file} must be deployed`);
    }
  });

  test(`${kind}: each page declares its own language and title`, () => {
    assert.match(published.de, /<html lang="de">/);
    assert.match(published.en, /<html lang="en">/);
    assert.ok(published.de.includes(`<h1>${spec.titles.de}</h1>`), `German h1 must be "${spec.titles.de}"`);
    assert.ok(published.en.includes(`<h1>${spec.titles.en}</h1>`), `English h1 must be "${spec.titles.en}"`);
  });

  test(`${kind}: every section of the bundled document is published`, () => {
    // A public page that quietly drops a section the app itself shows is the
    // drift that matters, so the bundled headings must be a subset.
    for (const locale of ['de', 'en']) {
      const expected = new Set(headings(bundled[locale]));
      const actual = new Set(headings(published[locale]));
      for (const heading of expected) {
        assert.ok(actual.has(heading), `${kind}/${locale}: public page is missing the "${heading}" section`);
      }
    }
  });

  test(`${kind}: the core statements reach both public pages`, () => {
    for (const [locale, patterns] of Object.entries(spec.claims)) {
      for (const pattern of patterns) {
        assert.match(published[locale], pattern, `${kind}/${locale} page lost: ${pattern}`);
      }
    }
  });

  test(`${kind}: no website-only processing leaks in`, () => {
    for (const [locale, html] of Object.entries(published)) {
      for (const term of spec.forbidden) {
        assert.ok(!html.includes(term), `${kind}/${locale} must not mention "${term}"`);
      }
    }
  });

  test(`${kind}: cross-links and the other language are present and resolvable`, () => {
    for (const [locale, hrefs] of Object.entries(spec.crossLinks)) {
      for (const href of hrefs) {
        assert.ok(published[locale].includes(`href="${href}"`), `${kind}/${locale} must link ${href}`);
      }
    }
    assert.ok(published.de.includes(`href="${spec.files.en}"`), `${kind}: German page needs the English twin`);
    assert.ok(published.en.includes(`href="${spec.files.de}"`), `${kind}: English page needs the German twin`);

    const allowedHosts = /^https:\/\/(www\.apple\.com|policies\.google\.com|www\.lda\.bayern\.de)\//;
    for (const [locale, html] of Object.entries(published)) {
      for (const match of html.matchAll(/\bhref="([^"]+)"/g)) {
        const href = match[1];
        if (href.startsWith('mailto:') || allowedHosts.test(href)) continue;
        assert.ok(!/^https?:/.test(href), `${kind}/${locale}: unexpected external link ${href}`);
        assert.ok(!href.startsWith('/') && !href.startsWith('#'), `${kind}/${locale}: expected a relative link, got ${href}`);
        assert.ok(existsSync(join(staticRoot, href.split(/[?#]/)[0])), `${kind}/${locale}: ${href} does not exist`);
      }
    }
  });

  test(`${kind}: no inline scripts, styles or inline style attributes`, () => {
    for (const [locale, html] of Object.entries(published)) {
      assert.deepEqual(html.match(/<script\b[^>]*>/gi) ?? [], [], `${kind}/${locale}: pages need no script`);
      assert.ok(!/<style\b/i.test(html), `${kind}/${locale}: styles belong in legal.css`);
      assert.ok(!/style="/i.test(html), `${kind}/${locale}: no inline style attributes`);
    }
  });
}

test('the app pages describe the beta identically', () => {
  // TestFlight/Play wording appears on both documents; keep the free-unlock
  // statement in one place so the two pages cannot contradict each other.
  for (const [locale, file] of Object.entries(PAGES.privacy.files)) {
    const html = read(staticRoot, file);
    assert.match(html, /TestFlight/, `${file} must mention TestFlight`);
    assert.match(html, locale === 'de' ? /kostenlos/ : /free/i, `${file} must state the beta is free`);
  }
  for (const [locale, file] of Object.entries(PAGES.terms.files)) {
    const html = read(staticRoot, file);
    assert.match(html, locale === 'de' ? /Promo-Code/ : /promo code/i, `${file} must name the Play promo code`);
  }
});

test('the website pages and the app-facing pages link each other', () => {
  assert.match(read(staticRoot, 'datenschutz.html'), /href="datenschutz-app\.html"/);
  assert.match(read(staticRoot, 'datenschutz.en.html'), /href="datenschutz-app\.en\.html"/);

  const beta = read(staticRoot, 'beta', 'index.html');
  assert.match(beta, /href="\/datenschutz-app\.html"/, 'the beta page must link the app policy');
  assert.match(beta, /href="\/agb-app\.html"/, 'the beta page must link the app terms');

  const promo = read(staticRoot, 'promo', 'index.html');
  assert.match(promo, /href="\/datenschutz-app\.html"/, 'the landing page must link the app policy');
  assert.match(promo, /href="\/agb-app\.html"/, 'the landing page must link the app terms');
});
