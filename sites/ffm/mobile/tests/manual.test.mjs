// manual.test.mjs — the bundled DE/EN player manual.
//
// The manual is a static offline document under legal/ (copied to www/legal/).
// This test pins both locales, every documented section, the P7 document
// styling, the offline-only rule, and the title-screen/bundle reachability.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildTitleLegalLinks, manualPagePath, MANUAL_LOCALES } from '../game/legal.js';
import { BUNDLE_FILES } from '../scripts/bundle-check.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const manualDir = join(root, 'legal');
const readManual = (locale) => readFile(join(manualDir, `manual.${locale}.html`), 'utf8');

const SECTIONS = Object.freeze([
  'campaign',
  'campaign2',
  'difficulty',
  'controls',
  'timer',
  'abilities',
  'healing',
  'scoring',
  'players',
  'training',
  'purchase',
  'privacy',
]);

test('the manual path is localized and the title screen links it first', () => {
  assert.deepEqual([...MANUAL_LOCALES], ['de', 'en']);
  assert.equal(manualPagePath('de'), 'legal/manual.de.html');
  assert.equal(manualPagePath('en'), 'legal/manual.en.html');
  assert.equal(manualPagePath('fr'), 'legal/manual.en.html', 'unknown locale falls back to en');

  const english = buildTitleLegalLinks('en');
  const german = buildTitleLegalLinks('de');
  assert.match(english, /href="legal\/manual\.en\.html"/);
  assert.match(german, /href="legal\/manual\.de\.html"/);
  assert.ok(english.startsWith('<a href="legal/manual.en.html">Manual</a>'));
  assert.ok(german.startsWith('<a href="legal/manual.de.html">Handbuch</a>'));
  assert.doesNotMatch(english, /\.de\.html/);
});

test('both manual locales exist and carry every documented section', async () => {
  for (const locale of MANUAL_LOCALES) {
    const html = await readManual(locale);
    const other = locale === 'de' ? 'en' : 'de';
    assert.match(html, new RegExp(`<html lang="${locale}">`));
    assert.match(html, /data-legal-page="manual"/);
    for (const section of SECTIONS) {
      assert.match(html, new RegExp(`data-manual-section="${section}"`), `${locale} documents ${section}`);
    }
    assert.match(html, /href="\.\.\/index\.html"/, `${locale} links back to the game`);
    assert.equal((html.match(/href="\.\.\/index\.html"/g) ?? []).length, 2,
      `${locale} returns to the game from top and bottom`);
    assert.ok(html.indexOf('class="legal-return-nav"') < html.indexOf('<ol>'),
      `${locale} offers return before the contents`);
    assert.match(html, new RegExp(`href="manual\\.${other}\\.html"`), `${locale} links the other locale`);
    assert.match(html, new RegExp(`href="privacy\\.${locale}\\.html"`), `${locale} links its privacy page`);
    assert.match(html, /src="\.\.\/game\/legal\.js"/);
  }
});

test('manual navigation uses opaque forest buttons and a primary game-return action', async () => {
  const css = await readFile(join(manualDir, 'legal.css'), 'utf8');
  assert.match(css, /\.legal-content nav ol a\s*\{[^}]*background:\s*linear-gradient\(145deg, #203e32, #10241c\)/s);
  assert.match(css, /\.legal-footer-nav a\[href="\.\.\/index\.html"\]\s*\{[^}]*background:\s*linear-gradient\(145deg, #d5b05c, #a77a34\)/s);
});

test('the manual content matches the settled campaign, dragon, score and training rules', async () => {
  const english = await readManual('en');
  for (const pattern of [
    /60 levels in four chapters/,
    /Levels 1–6 are free/,
    /15 seconds per question/,
    /nine seconds/,
    /combo 21/,
    /dragon at combo 21\./,
    /flawless baseline score divided by its number of encounters/,
    /unfinished attempt that did not clear the level/,
    /Discard returns to the title/,
    /unscored, never completes campaign levels, never unlocks content/,
    /Restore purchase/,
    /no analytics and no tracking/,
  ]) {
    assert.match(english, pattern, `manual.en.html states ${pattern}`);
  }

  const german = await readManual('de');
  for (const pattern of [
    /60 Level in vier Kapiteln/,
    /Level 1–6 sind kostenlos/,
    /15 Sekunden pro Frage/,
    /neun Sekunden/,
    /Drache bei 21\./,
    /fehlerfreie Basiswertung des Levels geteilt durch seine Anzahl an Begegnungen/,
    /unfertigen Versuch, der das Level nicht geschafft hat/,
    /Verwerfen kehrt/,
    /unbewertet, schließt keine Kampagnenlevel ab, schaltet nichts frei/,
    /Kauf wiederherstellen/,
    /keine Analyse und kein Tracking/,
  ]) {
    assert.match(german, pattern, `manual.de.html states ${pattern}`);
  }
});

// The difficulty curve (#534), Campaign II (#538) and the Players-page UI (#586) changed what
// the manual has to say; these pin the facts so the two languages cannot drift from the game.
test('the manual describes the difficulty curve, Campaign II and the Players page as built', async () => {
  const english = await readManual('en');
  const german = await readManual('de');
  for (const pattern of [
    /Subtraction starts at level 10, multiplication at level 20 and division at level 30/,
    /levels 20, 30, 40, 50 and 60 is a boss round/,
    /25 extra points/,
    /subtraction, multiplication and division at levels 10, 20 and 30/,
    /40 levels in eight acts of five/,
    /does not depend on Campaign I/,
    /without clearing any level first and without the full unlock/,
    /side by side, each with its own buy button, and one Restore purchase for both/,
    /Arithmetic or Genius/,
    /Campaign II is a second one-time purchase/,
    /with the full unlock, add more players/,
    /Personal progression chart/,
    /speaker button in the top-right corner of the pause card/,
    /thick gold frame/,
  ]) {
    assert.match(english, pattern, `manual.en.html states ${pattern}`);
  }
  for (const pattern of [
    /Subtraktion beginnt in Level 10, Multiplikation in Level 20 und Division in Level 30/,
    /Level 20, 30, 40, 50 und 60 ist eine Bossrunde/,
    /25 Extrapunkte/,
    /Division in Level 10, 20 und 30 ein/,
    /40 Level in acht Akten zu je fünf/,
    /hängt nicht von Abenteuer I ab/,
    /ohne vorher ein Level zu schaffen und ohne Vollversion/,
    /jedes mit eigenem Kaufknopf, und ein „Kauf wiederherstellen“ für beide/,
    /Rechnen oder Genie/,
    /Abenteuer II ist ein zweiter, eigener Einmalkauf/,
    /mit der Vollversion weitere Spieler hinzufügen/,
    /Persönlicher Fortschritt/,
    /Lautsprechertaste oben rechts in der Pausenkarte/,
    /dicken Goldrahmen/,
  ]) {
    assert.match(german, pattern, `manual.de.html states ${pattern}`);
  }
  for (const stale of [/levels 5, 25 and 34/, /Level 5, 25 und 34/, /arithmetic of level 10 before/, /Rechenart von Level 10, bevor/,
    // Campaign II has no level-40 gate any more (owner decision after #586).
    /cleared level 40/, /Level 40 von Abenteuer I geschafft/]) {
    assert.doesNotMatch(english + german, stale, `the manual no longer states ${stale}`);
  }
});

test('the manual is offline-only and follows the P7 document styling', async () => {
  for (const locale of MANUAL_LOCALES) {
    const html = await readManual(locale);
    assert.doesNotMatch(html, /https?:\/\//, `${locale} must not reference a remote URL`);
    assert.doesNotMatch(html, /@import|@font-face/i, `${locale} must not load a font`);
    assert.doesNotMatch(html, /\b(?:fetch|XMLHttpRequest|sendBeacon)\b/, `${locale} must not call an API`);
    assert.doesNotMatch(html, /<script\b(?![^>]*\bsrc=)/i, `${locale} must not add inline scripts`);

    const shared = html.indexOf('href="../styles.css"');
    const app = html.indexOf('href="legal.css"');
    assert.ok(shared >= 0, `${locale} keeps the shared stylesheet`);
    assert.ok(app > shared, `${locale} loads legal.css after ../styles.css`);
    assert.match(html, /class="legal-body"/);
    assert.match(html, /class="legal-page"/);
  }
});

test('both manual pages ship in the offline bundle', () => {
  for (const rel of ['legal/manual.de.html', 'legal/manual.en.html']) {
    assert.ok(BUNDLE_FILES.includes(rel), `${rel} must be a required bundle file`);
  }
});
