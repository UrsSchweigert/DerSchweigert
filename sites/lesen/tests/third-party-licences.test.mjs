// Guards the licence and attribution record required by P6 / requirement 6.3:
// every bundled notice stays linked from the about dialog, the upstream
// attribution wording is preserved, and docs/third-party-licences.md reviews
// every runtime dependency at its locked version.
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
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
  for (const target of ['words-de-LICENSE.txt', 'words-en-LICENSE.txt', 'fonts/OFL.txt', 'third-party-notices.txt']) {
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

test('about dialog attribution wording is correct in both languages', async () => {
  const [html, i18n] = await Promise.all([
    readSiteFile('static/index.html'),
    readSiteFile('static/i18n.mjs'),
  ]);
  const dialog = aboutDialog(html);

  assert.ok(dialog.includes('Wortliste: FrequencyWords &amp; Wiktionary, CC BY-SA 4.0'));
  assert.ok(dialog.includes('Schriftart: Andika, SIL Open Font License 1.1'));
  assert.ok(i18n.includes("'dialog.about.wordlist': 'Wortliste: FrequencyWords & Wiktionary, CC BY-SA 4.0 – '"));
  assert.ok(i18n.includes("'dialog.about.font': 'Schriftart: Andika, SIL Open Font License 1.1 – '"));
  assert.ok(i18n.includes("'dialog.about.wordlist': 'Word list: FrequencyWords & Wiktionary, CC BY 4.0 – '"));
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

  assert.ok(record.includes('@capacitor/synapse'), 'transitive dependency and its actual notice must be recorded');
  assert.ok(record.includes('CC BY-SA 4.0'));
  assert.ok(record.includes('CC BY 4.0'));
  assert.ok(record.includes('SIL Open Font License 1.1'));
  for (const path of ['static/words-de-LICENSE.txt', 'static/words-en-LICENSE.txt', 'static/fonts/OFL.txt']) {
    assert.ok(record.includes(path), `the record must name ${path}`);
  }
  assert.ok(record.includes('ios/App/App/public'), 'the record must cover the iOS bundle');
  assert.ok(record.includes('www/'), 'the record must cover the Android bundle');
});

test('runtime notices preserve each complete upstream permission and disclaimer', async () => {
  const [notices, manifest, lock, html] = await Promise.all([
    readSiteFile('static/third-party-notices.txt'),
    readSiteFile('package.json'),
    readSiteFile('package-lock.json'),
    readSiteFile('static/index.html'),
  ]);
  const resolved = JSON.parse(lock).packages;
  for (const name of [...Object.keys(JSON.parse(manifest).dependencies), '@capacitor/synapse']) {
    assert.ok(notices.includes(`${name} ${resolved[`node_modules/${name}`].version}`), name);
  }
  assert.match(aboutDialog(html), /href="third-party-notices\.txt"/);
  const bodies = notices.split(/^={10,}$/m).filter((_, index) => index > 0 && index % 2 === 0).slice(0, 3)
    .map(text => text.trim());
  assert.deepEqual(bodies.map(text => createHash('sha256').update(text).digest('hex')), [
    '7edf453d1584f19ee63f4507d4bbe05e6cce2fa9d334ad72dc40dcaf03cdc6bb',
    'eb99a0d61b507ad0182e18e9d2a91537c1d9025c94e098e4e7603a53b4b5218a',
    '7290a4bdbc2f004c5812e6ba8b2b6cde0caedb72902d3fde5f4f0ee622374307',
  ], 'verbatim trimmed notices from the exact installed locked packages must not be abbreviated');
});

test('native notices preserve full Apache terms, Cordova NOTICE and configured native versions', async () => {
  const [notices, variables] = await Promise.all([
    readSiteFile('static/third-party-notices.txt'),
    readSiteFile('android/variables.gradle'),
  ]);
  const apache = notices.split('Apache License 2.0 (complete upstream text):')[1]?.trim();
  assert.ok(apache, 'actual native redistribution requires the licence text, not just its URL');
  assert.equal(createHash('sha256').update(apache).digest('hex'),
    '283ea6cc2997a1a70da0049e09adf9317bb60ca1b51279b65196b83a69e1996b');
  assert.ok(notices.includes('Apache Cordova\nCopyright 2015-2020 The Apache Software Foundation\n\n'
    + 'This product includes software developed at\n'
    + 'The Apache Software Foundation (http://www.apache.org/).'));
  const versions = Object.fromEntries([...variables.matchAll(/(\w+Version)\s*=\s*'([^']+)'/g)]
    .map(match => [match[1], match[2]]));
  for (const [key, coordinate] of [
    ['androidxActivityVersion', 'androidx.activity:activity'],
    ['androidxAppCompatVersion', 'androidx.appcompat:appcompat'],
    ['androidxCoordinatorLayoutVersion', 'androidx.coordinatorlayout:coordinatorlayout'],
    ['androidxCoreVersion', 'androidx.core:core'],
    ['androidxFragmentVersion', 'androidx.fragment:fragment'],
    ['coreSplashScreenVersion', 'androidx.core:core-splashscreen'],
    ['androidxWebkitVersion', 'androidx.webkit:webkit'],
    ['cordovaAndroidVersion', 'org.apache.cordova:framework'],
  ]) {
    assert.ok(versions[key], `missing configured runtime version ${key}`);
    assert.ok(notices.includes(`${coordinate}:${versions[key]}`), `${coordinate} notice version needs review`);
  }
  assert.ok(notices.includes('io.ionic.libs:ionfilesystem-android 1.1.1'));
  assert.ok(notices.includes('ion-ios-filesystem 2.0.1'));
});
