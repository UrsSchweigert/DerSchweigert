// legal.test.mjs — app legal pages, title-screen links and the link gate.
//
// The pages are bundled static HTML; this test pins that both languages exist
// for every page, that the title screen links to them, that the licence page
// credits every track in the music manifest, and that external links open
// only after the parental gate passes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  LEGAL_PAGE_KINDS,
  buildMusicCreditsMarkup,
  buildTitleLegalLinks,
  gateExternalLinks,
  isExternalHref,
  legalPagePath,
  setupTitleLegalLinks,
} from '../game/legal.js';
import { MUSIC_TRACKS } from '../game/music-manifest.js';
import { BUNDLE_FILES } from '../scripts/bundle-check.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const legalDir = join(root, 'legal');
const page = (kind, locale) => readFile(join(legalDir, `${kind}.${locale}.html`), 'utf8');
const legalCssPath = join(legalDir, 'legal.css');
const snapshotPath = join(root, 'tests', 'fixtures', 'legal-text.json');

function fakeEvent(href) {
  const anchor = { getAttribute: (name) => (name === 'href' ? href : null) };
  return {
    target: { closest: (selector) => (selector === 'a[href]' ? anchor : null) },
    defaultPrevented: false,
    preventDefault() { this.defaultPrevented = true; },
  };
}

function fakeDoc({ lang = 'de' } = {}) {
  const listeners = new Map();
  const view = { opened: [], open(url) { view.opened.push(url); }, location: {} };
  const doc = {
    documentElement: { lang },
    defaultView: view,
    addEventListener(type, fn) { listeners.set(type, fn); },
    removeEventListener(type, fn) {
      if (listeners.get(type) === fn) listeners.delete(type);
    },
  };
  return { doc, listeners, view };
}

test('legal page paths are localized and reject unknown kinds', () => {
  for (const kind of LEGAL_PAGE_KINDS) {
    assert.equal(legalPagePath(kind, 'de'), `legal/${kind}.de.html`);
    assert.equal(legalPagePath(kind, 'en'), `legal/${kind}.en.html`);
    assert.equal(legalPagePath(kind, 'fr'), `legal/${kind}.en.html`, 'unknown locale falls back to en');
  }
  assert.throws(() => legalPagePath('cookies', 'en'), /unknown legal page/);
});

test('the title screen links to every legal page in the active language', () => {
  const english = buildTitleLegalLinks('en');
  const german = buildTitleLegalLinks('de');
  for (const kind of LEGAL_PAGE_KINDS) {
    assert.match(english, new RegExp(`href="legal/${kind}\\.en\\.html"`));
    assert.match(german, new RegExp(`href="legal/${kind}\\.de\\.html"`));
  }
  assert.match(english, /Privacy/);
  assert.match(german, /Datenschutz/);
  assert.doesNotMatch(english, /\.de\.html/);
});

test('setupTitleLegalLinks replaces the footer and re-renders on locale change', () => {
  const container = {
    html: '<a href="datenschutz.html">web</a>',
    set innerHTML(value) { this.html = value; },
    get innerHTML() { return this.html; },
    querySelectorAll: () => [],
    appendChild() {},
  };
  const doc = {
    documentElement: { lang: 'en' },
    querySelector: (selector) => (selector === '.splash-legal-links' ? container : null),
    createTextNode: (text) => ({ text }),
  };
  let locale = 'en';
  let listener = null;
  const detach = setupTitleLegalLinks({
    doc,
    getLocale: () => locale,
    onLocaleChange: (fn) => { listener = fn; return () => { listener = null; }; },
  });

  assert.match(container.html, /href="legal\/privacy\.en\.html"/);
  assert.doesNotMatch(container.html, /datenschutz\.html/);
  locale = 'de';
  listener('de');
  assert.match(container.html, /href="legal\/privacy\.de\.html"/);
  detach();
  assert.equal(listener, null);
});

test('only links that leave the app count as external', () => {
  for (const href of [
    'https://www.apple.com/legal/privacy/',
    'http://example.com',
    '//example.com/path',
    'mailto:info@derschweigert.de',
    'tel:+4912345',
  ]) {
    assert.equal(isExternalHref(href), true, href);
  }
  for (const href of ['privacy.de.html', '../index.html', '#top', '/legal/', 'javascript:void(0)', '', null]) {
    assert.equal(isExternalHref(href), false, String(href));
  }
});

test('external links open only after the gate passes', async () => {
  const calls = [];
  const gate = async (options) => { calls.push(options); return true; };
  const gateUi = { ask: async () => 42 };
  const { doc, listeners, view } = fakeDoc({ lang: 'de' });
  const detach = gateExternalLinks({ doc, gate, gateUi });
  const click = listeners.get('click');
  assert.ok(click, 'gateExternalLinks registers a click handler');

  const external = fakeEvent('https://www.apple.com/legal/privacy/de-ww/');
  await click(external);
  assert.equal(external.defaultPrevented, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].action, 'external-link');
  assert.equal(calls[0].locale, 'de');
  assert.deepEqual(view.opened, ['https://www.apple.com/legal/privacy/de-ww/']);

  detach();
  assert.equal(listeners.size, 0);
});

test('the gate blocks external links and leaves internal navigation alone', async () => {
  const calls = [];
  const gate = async (options) => { calls.push(options); return false; };
  const { doc, listeners, view } = fakeDoc({ lang: 'en' });
  gateExternalLinks({ doc, gate, gateUi: { ask: async () => 1 } });
  const click = listeners.get('click');

  const external = fakeEvent('https://policies.google.com/privacy');
  await click(external);
  assert.equal(external.defaultPrevented, true);
  assert.deepEqual(view.opened, [], 'a failed gate opens nothing');

  const internal = fakeEvent('privacy.en.html');
  await click(internal);
  assert.equal(internal.defaultPrevented, false);
  assert.equal(calls.length, 1, 'internal links never reach the gate');
});

test('every legal page exists in DE and EN and links the app shell', async () => {
  for (const kind of LEGAL_PAGE_KINDS) {
    for (const locale of ['de', 'en']) {
      const html = await page(kind, locale);
      assert.match(html, new RegExp(`<html lang="${locale}">`));
      assert.match(html, new RegExp(`data-legal-page="${kind}"`));
      assert.match(html, /href="\.\.\/styles\.css"/);
      assert.match(html, /src="\.\.\/game\/legal\.js"/);
      assert.match(html, /href="\.\.\/index\.html"/);
      assert.match(html, new RegExp(`href="${kind}\\.${locale === 'de' ? 'en' : 'de'}\\.html"`));
      for (const other of LEGAL_PAGE_KINDS.filter((value) => value !== kind)) {
        assert.match(html, new RegExp(`href="${other}\\.${locale}\\.html"`));
      }
      assert.doesNotMatch(html, /https?:\/\/[^\s"]*derschweigert\.de/, 'no first-party web URL');
    }
  }
});

test('external anchors in the legal pages are gated and marked noopener', async () => {
  let external = 0;
  for (const kind of LEGAL_PAGE_KINDS) {
    for (const locale of ['de', 'en']) {
      const html = await page(kind, locale);
      for (const [, href] of html.matchAll(/<a\b[^>]*\bhref="([^"]+)"/g)) {
        if (!isExternalHref(href)) continue;
        external++;
        assert.match(html, new RegExp(`href="${href.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*rel="noopener noreferrer"`));
      }
    }
  }
  assert.ok(external > 0, 'the privacy and licence pages link to the stores and licences');
});

test('the licence pages credit every bundled music track', async () => {
  assert.ok(MUSIC_TRACKS.length > 0, 'the manifest lists at least the existing track');
  assert.ok(MUSIC_TRACKS.some((track) => track.file === 'background-music.mp3'));

  const audio = await readFile(join(root, '..', 'static', 'game', 'audio.js'), 'utf8');
  const referenced = [...audio.matchAll(/['"]\.\/([^'"]+\.mp3)['"]/g)].map((match) => match[1]);
  for (const file of referenced) {
    assert.ok(MUSIC_TRACKS.some((track) => track.file === file), `${file} needs a manifest credit`);
  }

  const markup = buildMusicCreditsMarkup('en');
  for (const track of MUSIC_TRACKS) {
    assert.ok(markup.includes(track.file));
    assert.ok(markup.includes(track.title));
    for (const locale of ['de', 'en']) {
      const html = await page('licence', locale);
      assert.ok(html.includes(track.file), `licence.${locale}.html credits ${track.file}`);
      assert.ok(html.includes(track.title), `licence.${locale}.html names ${track.title}`);
    }
  }
});

// ── Pre-restyle legal text snapshot ─────────────────────────────────────────
// tests/fixtures/legal-text.json records the normalized text blocks of all
// eight pages before the P7 restyle. The restyle may add emphasis and storage
// statements, but every recorded clause must survive verbatim, so a removed or
// reworded clause fails here even when the markup still looks plausible.

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decodeEntities(value) {
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, name) => {
    if (name[0] === '#') {
      const code = name[1].toLowerCase() === 'x'
        ? Number.parseInt(name.slice(2), 16)
        : Number.parseInt(name.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return ENTITIES[name.toLowerCase()] ?? match;
  });
}

function normalizeText(value) {
  return decodeEntities(value.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function textBlocks(html) {
  return [...html.matchAll(/<(h1|h2|p|li)\b[^>]*>([\s\S]*?)<\/\1>/gi)]
    .map((match) => normalizeText(match[2]))
    .filter(Boolean);
}

const pageKeys = () => LEGAL_PAGE_KINDS.flatMap((kind) => ['de', 'en'].map((locale) => `${kind}.${locale}`));

test('every legal page keeps every clause of the pre-restyle text', async () => {
  const snapshot = JSON.parse(await readFile(snapshotPath, 'utf8'));
  assert.deepEqual(Object.keys(snapshot.pages).sort(), pageKeys().sort(), 'the fixture covers all eight pages');
  for (const kind of LEGAL_PAGE_KINDS) {
    for (const locale of ['de', 'en']) {
      const key = `${kind}.${locale}`;
      const recorded = snapshot.pages[key];
      assert.ok(recorded.length > 0, `${key} has a recorded text`);
      const current = textBlocks(await page(kind, locale));
      for (const clause of recorded) {
        assert.ok(current.includes(clause), `${key} lost or altered a legal clause: ${clause}`);
      }
    }
  }
});

test('every legal page links the app restyle after the shared stylesheet', async () => {
  for (const kind of LEGAL_PAGE_KINDS) {
    for (const locale of ['de', 'en']) {
      const html = await page(kind, locale);
      const shared = html.indexOf('href="../styles.css"');
      const app = html.indexOf('href="legal.css"');
      assert.ok(shared >= 0, `${kind}.${locale} keeps the shared stylesheet`);
      assert.ok(app > shared, `${kind}.${locale} loads legal.css after ../styles.css`);
    }
  }
  assert.ok(BUNDLE_FILES.includes('legal/legal.css'), 'the offline bundle ships legal/legal.css');
});

test('the legal restyle is offline, 320px-readable and keeps the page scrolling', async () => {
  const css = await readFile(legalCssPath, 'utf8');
  const rules = css.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(rules, /@import\b/i, 'no imported stylesheets');
  assert.doesNotMatch(rules, /@font-face\b/i, 'no bundled or remote fonts');
  assert.doesNotMatch(rules, /url\(\s*['"]?(?:https?:)?\/\//i, 'no remote url() values');
  assert.match(css, /--legal-forest:\s*#18352d/i, 'forest palette');
  assert.match(css, /--legal-ivory:\s*#f3ead6/i, 'ivory palette');
  assert.match(css, /--legal-brass:\s*#c49a48/i, 'brass palette');
  assert.match(css, /font-size:\s*16px/, '16px prose');
  assert.match(css, /env\(safe-area-inset-(?:top|right|bottom|left)/, 'safe-area padding');
  assert.match(css, /min-height:\s*44px/, '44px tap targets');
  assert.match(css, /overflow-wrap:\s*break-word/, 'long German compounds wrap at 320px');
  assert.doesNotMatch(css, /min-width:\s*\d{3,}px/, 'no fixed width wider than a 320px screen');
  assert.doesNotMatch(css, /overflow(?:-y)?\s*:\s*hidden/i, 'the restyle must not clip scrolling');
  assert.doesNotMatch(css, /position\s*:\s*fixed/i, 'the restyle must not freeze the document');

  const shared = await readFile(join(root, '..', 'static', 'styles.css'), 'utf8');
  assert.match(shared, /body\.legal-body\s*\{[^}]*overflow-y:\s*auto/, 'legal documents stay scrollable');
});

test('the app title screen styles its legal navigation in the fantasy palette', async () => {
  const css = await readFile(join(root, 'game', 'mobile-ui.css'), 'utf8');
  const marker = css.indexOf('Title-screen legal navigation');
  assert.ok(marker >= 0, 'mobile-ui.css owns the app-only title-screen legal nav');
  const block = css.slice(marker);
  assert.match(block, /\.splash-legal-links\s*\{/);
  assert.match(block, /flex-direction:\s*column/);
  assert.match(block, /background:\s*linear-gradient\(145deg, #203e32, #10241c\)/);
  assert.doesNotMatch(buildTitleLegalLinks('en'), / · /);
  assert.match(block, /\.splash-legal-link-btn/);
  assert.match(block, /min-height:\s*44px/);
  assert.match(block, /var\(--brass-light/);
  assert.doesNotMatch(block, /@import|https?:\/\//i);
});

const PRIVACY_EMPHASIS = {
  de: [/keine Analyse/i, /keine Werbung/i, /kein Tracking/i, /nicht an den Anbieter übertragen/i],
  en: [/no analytics/i, /no advertising/i, /no tracking/i, /not transmitted to the provider/i],
};

const LOCAL_STORAGE_AND_PURCHASES = {
  de: [/Familienprofile/i, /Spielernamen/i, /Bestleistungen/i, /Punkteverlauf/i, /Übungsabzeichen/i, /Backup/i, /Apple/i, /Google/i],
  en: [/family profiles/i, /player names/i, /best scores/i, /score history/i, /practice badges/i, /backup/i, /Apple/i, /Google/i],
};

test('both privacy pages emphasise no analytics, advertising, tracking or provider transmission', async () => {
  for (const locale of ['de', 'en']) {
    const html = await page('privacy', locale);
    assert.match(html, /data-privacy-emphasis/, `privacy.${locale} has the emphasis callout`);
    for (const pattern of PRIVACY_EMPHASIS[locale]) {
      assert.match(html, pattern, `privacy.${locale} states ${pattern}`);
    }
  }
});

test('both privacy pages state local family storage, OS backups and store purchases', async () => {
  for (const locale of ['de', 'en']) {
    const html = await page('privacy', locale);
    for (const pattern of LOCAL_STORAGE_AND_PURCHASES[locale]) {
      assert.match(html, pattern, `privacy.${locale} states ${pattern}`);
    }
  }
});

test('no legal page claims the absence of local or store processing', async () => {
  const forbidden = [
    /keine lokale (?:Daten)?verarbeitung/i,
    /keine (?:Daten)?speicherung auf dem Gerät/i,
    /no local (?:data )?processing/i,
    /no (?:data )?storage on the device/i,
    /no store (?:processing|purchases?)/i,
    /keine (?:Kauf-)?Abwicklung durch (?:den )?Store/i,
  ];
  for (const kind of LEGAL_PAGE_KINDS) {
    for (const locale of ['de', 'en']) {
      const html = await page(kind, locale);
      for (const pattern of forbidden) {
        assert.doesNotMatch(html, pattern, `${kind}.${locale} must not claim ${pattern}`);
      }
    }
  }
});
