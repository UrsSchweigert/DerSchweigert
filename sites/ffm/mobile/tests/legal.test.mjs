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

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const legalDir = join(root, 'legal');
const page = (kind, locale) => readFile(join(legalDir, `${kind}.${locale}.html`), 'utf8');

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
