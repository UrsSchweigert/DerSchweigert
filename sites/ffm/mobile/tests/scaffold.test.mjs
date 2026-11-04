import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { copyAssets } from '../scripts/copy-assets.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const json = async (rel) => JSON.parse(await readFile(join(root, rel), 'utf8'));

test('capacitor config bundles local assets under the app identity', async () => {
  const config = await json('capacitor.config.json');
  assert.equal(config.appId, 'de.derschweigert.arithmoslayer');
  assert.equal(config.appName, 'Arithmo Slayer');
  assert.equal(config.webDir, 'www');
  assert.equal(config.server?.url, undefined);
});

test('capacitor packages stay on one 8.x version', async () => {
  const pkg = await json('package.json');
  const all = { ...pkg.dependencies, ...pkg.devDependencies };
  for (const name of ['@capacitor/core', '@capacitor/cli', '@capacitor/android', '@capacitor/ios']) {
    assert.match(all[name], /^8\.\d+\.\d+$/, name);
    assert.equal(all[name], all['@capacitor/core'], name);
  }
});

test('copy-assets copies the game and drops development-only files', async () => {
  const out = await mkdtemp(join(tmpdir(), 'ffm-www-'));
  try {
    await copyAssets(undefined, out);
    assert.ok((await stat(join(out, 'game/main.js'))).isFile());
    for (const rel of ['game/source-assets', 'game/calibrate.html', 'game/levels.test.js', 'demo.html']) {
      await assert.rejects(stat(join(out, rel)), rel);
    }
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

const text = (rel) => readFile(join(root, rel), 'utf8');

test('native projects carry the app identity and store metadata', async () => {
  const gradle = await text('android/app/build.gradle');
  assert.match(gradle, /applicationId "de\.derschweigert\.arithmoslayer"/);
  const strings = await text('android/app/src/main/res/values/strings.xml');
  assert.match(strings, /<string name="app_name">Arithmo Slayer<\/string>/);
  const manifest = await text('android/app/src/main/AndroidManifest.xml');
  assert.match(manifest, /android:allowBackup="true"/);
  assert.doesNotMatch(manifest, /<uses-permission /);

  const plist = await text('ios/App/App/Info.plist');
  assert.match(plist, /<key>CFBundleDisplayName<\/key>\s*<string>Arithmo Slayer<\/string>/);
  assert.match(plist, /<key>CFBundleLocalizations<\/key>\s*<array>\s*<string>de<\/string>\s*<string>en<\/string>/);
  assert.match(plist, /<key>ITSAppUsesNonExemptEncryption<\/key>\s*<false\/>/);
  const pbx = await text('ios/App/App.xcodeproj/project.pbxproj');
  assert.match(pbx, /PRODUCT_BUNDLE_IDENTIFIER = de\.derschweigert\.arithmoslayer;/);
});

test('iOS privacy manifest declares no tracking and is bundled', async () => {
  const privacy = await text('ios/App/App/PrivacyInfo.xcprivacy');
  assert.match(privacy, /<key>NSPrivacyTracking<\/key>\s*<false\/>/);
  assert.match(privacy, /NSPrivacyAccessedAPICategoryUserDefaults[\s\S]*CA92\.1/);
  const pbx = await text('ios/App/App.xcodeproj/project.pbxproj');
  assert.match(pbx, /PrivacyInfo\.xcprivacy in Resources/);
});
