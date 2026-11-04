// Guards the licence and attribution record required by P6 / requirement 6.3:
// every bundled notice stays linked from the about dialog, the upstream
// attribution wording is preserved, and docs/third-party-licences.md reviews
// every runtime dependency at its locked version.
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFile, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { REQUIRED_FILES } from '../scripts/verify-bundle.mjs';

const siteRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const aboutStart = 'id="about-dialog"';

async function readSiteFile(relativePath) {
  return readFile(join(siteRoot, relativePath), 'utf8');
}

async function fileExists(relativePath) {
  const info = await stat(join(siteRoot, relativePath)).catch(() => null);
  return Boolean(info?.isFile());
}

function aboutDialog(html) {
  const start = html.indexOf(aboutStart);
  assert.ok(start >= 0, 'static/index.html must keep the about dialog');
  return html.slice(start, html.indexOf('</dialog>', start));
}

test('about dialog links point at licence files that are bundled', async () => {
  const html = await readSiteFile('static/index.html');
  const dialog = aboutDialog(html);

  const hrefs = [...dialog.matchAll(/<a\b[^>]*\bhref="([^"]+)"/g)].map(match => match[1]);
  assert.ok(hrefs.includes('words-de-LICENSE.txt'), dialog);
  assert.ok(hrefs.includes('fonts/OFL.txt'), dialog);
  assert.ok(
    html.includes("currentLanguage === 'en' ? 'words-en-LICENSE.txt' : 'words-de-LICENSE.txt'"),
    'the language switch must point the word-list link at the English notice',
  );

  const required = new Set(REQUIRED_FILES);
  for (const target of ['words-de-LICENSE.txt', 'words-en-LICENSE.txt', 'fonts/OFL.txt']) {
    assert.ok(required.has(target), `${target} must stay in REQUIRED_FILES`);
    assert.ok(await fileExists(join('static', target)), `static/${target} must be bundled`);
  }
});

test('bundled licence files keep their upstream attribution', async () => {
  const [german, english, font] = await Promise.all([
    readSiteFile('static/words-de-LICENSE.txt'),
    readSiteFile('static/words-en-LICENSE.txt'),
    readSiteFile('static/fonts/OFL.txt'),
  ]);

  for (const marker of [
    'Creative Commons Attribution-ShareAlike 4.0 International',
    'Hermit Dave, FrequencyWords',
    'OpenSubtitles2018',
    'german-nouns',
    'Wiktionary',
  ]) {
    assert.ok(german.includes(marker), `words-de-LICENSE.txt must keep "${marker}"`);
  }

  for (const marker of [
    'Creative Commons Attribution 4.0 International',
    'Hermit Dave, FrequencyWords',
    'OpenSubtitles2018',
  ]) {
    assert.ok(english.includes(marker), `words-en-LICENSE.txt must keep "${marker}"`);
  }

  for (const marker of [
    'SIL OPEN FONT LICENSE Version 1.1',
    'Reserved Font Names "Andika" and "SIL"',
    'SIL International',
  ]) {
    assert.ok(font.includes(marker), `fonts/OFL.txt must keep "${marker}"`);
  }
});

test('about dialog attribution wording is unchanged in both languages', async () => {
  const [html, i18n] = await Promise.all([
    readSiteFile('static/index.html'),
    readSiteFile('static/i18n.mjs'),
  ]);
  const dialog = aboutDialog(html);

  assert.ok(dialog.includes('Wortliste: FrequencyWords &amp; Wiktionary, CC BY-SA 4.0'));
  assert.ok(dialog.includes('Schriftart: Andika, SIL Open Font License 1.1'));
  assert.ok(i18n.includes("'dialog.about.wordlist': 'Wortliste: FrequencyWords & Wiktionary, CC BY-SA 4.0 – '"));
  assert.ok(i18n.includes("'dialog.about.font': 'Schriftart: Andika, SIL Open Font License 1.1 – '"));
  assert.ok(i18n.includes("'dialog.about.wordlist': 'Word list: FrequencyWords & Wiktionary, CC BY-SA 4.0 – '"));
  assert.ok(i18n.includes("'dialog.about.font': 'Font: Andika, SIL Open Font License 1.1 – '"));
});

test('the licence review record covers every runtime dependency', async () => {
  const [record, manifest, lock] = await Promise.all([
    readSiteFile('docs/third-party-licences.md'),
    readSiteFile('package.json'),
    readSiteFile('package-lock.json'),
  ]);
  const dependencies = Object.keys(JSON.parse(manifest).dependencies ?? {});
  const resolved = JSON.parse(lock).packages;

  assert.ok(dependencies.length > 0, 'package.json must declare runtime dependencies');
  for (const name of dependencies) {
    const version = resolved[`node_modules/${name}`]?.version;
    assert.ok(version, `package-lock.json must resolve ${name}`);
    const row = new RegExp(`\\|\\s*\`${name.replace(/[/@]/g, m => `\\${m}`)}\`\\s*\\|\\s*${version.replace(/\./g, '\\.')}\\s*\\|\\s*(MIT|ISC)\\s*\\|`);
    assert.match(record, row, `docs/third-party-licences.md must review ${name}@${version}`);
  }

  assert.ok(record.includes('@capacitor/synapse'), 'transitive ISC dependency must be recorded');
  assert.ok(record.includes('CC BY-SA 4.0'));
  assert.ok(record.includes('CC BY 4.0'));
  assert.ok(record.includes('SIL Open Font License 1.1'));
  for (const path of ['static/words-de-LICENSE.txt', 'static/words-en-LICENSE.txt', 'static/fonts/OFL.txt']) {
    assert.ok(record.includes(path), `the record must name ${path}`);
  }
  assert.ok(record.includes('ios/App/App/public'), 'the record must cover the iOS bundle');
  assert.ok(record.includes('www/'), 'the record must cover the Android bundle');
});
