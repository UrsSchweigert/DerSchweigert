import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFile } from 'node:fs/promises';

const page = await readFile(new URL('../marketing/index.html', import.meta.url), 'utf8');
const language = await readFile(new URL('../marketing/language.mjs', import.meta.url), 'utf8');

test('marketing page describes the guided reading app and its audience', () => {
  assert.match(page, /<html lang="de">/);
  assert.match(page, /<span data-i18n="heroTitleLead">Lesen lernen –<\/span> <span data-i18n="heroTitleHighlight">Karte für Karte\.<\/span>/);
  assert.match(page, /Fürs gemeinsame Lesen mit Erwachsenen/);
  assert.match(page, /Buchstaben, Silben, Wörter &amp; Sätze/);
  assert.match(page, /Google Play/);
  assert.match(page, /Apple App Store/);
});

test('marketing page focuses on the apps without promoting a browser version', () => {
  assert.match(page, /noch nicht in den Stores veröffentlicht/i);
  assert.match(page, /Store-Link folgt/);
  assert.doesNotMatch(page, /Browser|browser/);
  assert.doesNotMatch(page, /kostenlos|kostenfreie/i);
  assert.doesNotMatch(page, /https:\/\/lesen\.derschweigert\.de\/(?!datenschutz\.html)/);
  assert.doesNotMatch(page, /play\.google\.com\/store\/apps\/details/);
  assert.doesNotMatch(page, /apps\.apple\.com\/[^"]+\/app\//);
});

test('marketing page links the official privacy, terms, imprint and contact pages', () => {
  assert.match(page, /https:\/\/lesen\.derschweigert\.de\/datenschutz\.html/);
  assert.match(page, /https:\/\/derschweigert\.de\/nutzungsbedingungen/);
  assert.match(page, /https:\/\/derschweigert\.de\/impressum/);
  assert.match(page, /href="https:\/\/derschweigert\.de\/#projects" data-i18n="projectReference"/);
  assert.match(page, /mailto:info@derschweigert\.de/);
});

test('marketing page exposes accessible section navigation and mascot text alternative', () => {
  assert.match(page, /aria-label="Hauptnavigation"/);
  assert.match(page, /aria-labelledby="features-title"/);
  assert.match(page, /aria-labelledby="how-title"/);
  assert.match(page, /aria-labelledby="parents-title"/);
  assert.match(page, /alt="Die Buchstabenzeit-Eule liest ein Buch/);
});

test('marketing page offers an English version and a return link to German', () => {
  assert.match(page, /hreflang="en" href="https:\/\/buchstabenzeit\.derschweigert\.de\/\?lang=en"/);
  assert.match(page, /id="language-toggle" class="language-toggle" href="\?lang=en"/);
  assert.match(page, /<script type="module" src="\/language\.mjs"><\/script>/);
  assert.match(language, /document\.documentElement\.lang = 'en'/);
  assert.match(language, /languageToggle\.href = '\/'/);
  assert.match(language, /https:\/\/lesen\.derschweigert\.de\/datenschutz-en\.html/);
  assert.match(language, /Google Play/);
  assert.match(language, /Apple App Store/);
  assert.match(language, /navLabel: 'Main navigation'/);
  assert.match(language, /projectReference: 'See Buchstabenzeit on DerSchweigert'/);
  assert.doesNotMatch(language, /browser|free in the browser/i);
});

test('every translatable marketing label has an English translation', () => {
  const pageKeys = new Set(
    [...page.matchAll(/data-i18n(?:-aria|-alt)?="([^"]+)"/g)].map(([, key]) => key),
  );
  const translations = new Set(
    [...language.matchAll(/^\s{2}([A-Za-z][A-Za-z0-9]*):\s*'/gm)].map(([, key]) => key),
  );
  for (const key of pageKeys) {
    assert.ok(translations.has(key), `Missing English translation for ${key}`);
  }
});

test('marketing page shows a real app screenshot with responsive variants', async () => {
  assert.match(page, /class="device-shot" src="\/images\/app-auswahl-780\.webp"/);
  assert.match(page, /srcset="\/images\/app-auswahl-480\.webp 480w, \/images\/app-auswahl-780\.webp 780w"/);
  assert.match(page, /width="780" height="1148"/);
  assert.doesNotMatch(page, /images\/buchstabenzeit-logo\.png/);

  for (const asset of [
    'images/app-auswahl-480.webp',
    'images/app-auswahl-780.webp',
    'images/app-lesekarte-520.webp',
    'images/app-lesekarte-780.webp',
    'images/eule-192.webp',
    'images/eule-384.webp',
  ]) {
    const image = await readFile(new URL(`../marketing/${asset}`, import.meta.url));
    assert.ok(image.length > 0, `Missing marketing asset: ${asset}`);
    assert.ok(image.length < 200_000, `Marketing asset too heavy: ${asset}`);
  }
});

test('marketing page ships a large social preview card and vector favicon', async () => {
  assert.match(page, /property="og:image" content="https:\/\/buchstabenzeit\.derschweigert\.de\/images\/og-card\.jpg"/);
  assert.match(page, /property="og:image:width" content="1200"/);
  assert.match(page, /property="og:image:height" content="630"/);
  assert.match(page, /name="twitter:card" content="summary_large_image"/);
  assert.match(page, /rel="icon" type="image\/svg\+xml" href="\/images\/favicon\.svg"/);
  assert.match(page, /rel="apple-touch-icon" href="\/images\/apple-touch-icon\.png"/);
  for (const asset of ['images/og-card.jpg', 'images/favicon.svg', 'images/apple-touch-icon.png']) {
    const file = await readFile(new URL(`../marketing/${asset}`, import.meta.url));
    assert.ok(file.length > 0, `Missing marketing asset: ${asset}`);
  }
});

test('marketing page keeps progressive enhancement same-origin for the strict CSP', () => {
  assert.match(page, /<script type="module" src="\/marketing\.mjs"><\/script>/);
  assert.doesNotMatch(page, /<script>|<script(?![^>]*src=)/);
  assert.match(language, /document\.documentElement\.lang = 'en'/);
});

test('marketing closing call to action pairs the copy with decorative artwork', async () => {
  assert.match(page, /class="cta-art" src="\/images\/lesen-gemeinsam-640\.webp"/);
  assert.match(page, /srcset="\/images\/lesen-gemeinsam-420\.webp 420w, \/images\/lesen-gemeinsam-640\.webp 640w"/);
  assert.match(page, /alt="" aria-hidden="true"/);
  for (const asset of ['images/lesen-gemeinsam-420.webp', 'images/lesen-gemeinsam-640.webp']) {
    const image = await readFile(new URL(`../marketing/${asset}`, import.meta.url));
    assert.ok(image.length > 0, `Missing marketing asset: ${asset}`);
    assert.ok(image.length < 200_000, `Marketing asset too heavy: ${asset}`);
  }
});
