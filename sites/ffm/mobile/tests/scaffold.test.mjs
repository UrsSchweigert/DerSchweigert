import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat, mkdtemp, rm, mkdir, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { copyAssets, EXCLUDED, REQUIRED_FILES } from '../scripts/copy-assets.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const json = async (rel) => JSON.parse(await readFile(join(root, rel), 'utf8'));
const toPosix = (rel) => rel.split('\\').join('/');

test('capacitor config bundles local assets under the app identity', async () => {
  const config = await json('capacitor.config.json');
  assert.equal(config.appId, 'de.derschweigert.arithmoslayer');
  assert.equal(config.appName, 'Arithmo Slayer');
  assert.equal(config.webDir, 'www');
  assert.equal(config.server?.url, undefined);
  assert.doesNotMatch(JSON.stringify(config), /"url"\s*:/);
});

test('capacitor packages stay on one 8.x version', async () => {
  const pkg = await json('package.json');
  const all = { ...pkg.dependencies, ...pkg.devDependencies };
  const platform = ['@capacitor/core', '@capacitor/cli', '@capacitor/android', '@capacitor/ios'];
  for (const name of platform) {
    assert.match(all[name], /^8\.\d+\.\d+$/, name);
    assert.equal(all[name], all['@capacitor/core'], name);
  }
  for (const [name, version] of Object.entries(all)) {
    // @capacitor/assets is the icon/splash tool and does not track the runtime line.
    if (name === '@capacitor/assets') continue;
    if (name.startsWith('@capacitor') || name.startsWith('@capgo/')) {
      assert.match(version, /^8\.\d+\.\d+$/, name);
    }
  }
});

test('copy-assets copies the game and drops development-only files', async () => {
  const out = await mkdtemp(join(tmpdir(), 'ffm-www-'));
  try {
    await copyAssets(undefined, out);
    for (const rel of REQUIRED_FILES) {
      assert.ok((await stat(join(out, rel))).isFile(), rel);
    }
    const entries = (await readdir(out, { recursive: true })).map(toPosix);
    for (const rel of entries) {
      assert.ok(!EXCLUDED.some((pattern) => pattern.test(rel)), `${rel} must not be bundled`);
      assert.notEqual(rel.split('/').pop(), '.DS_Store', rel);
    }
    for (const rel of ['game/source-assets', 'game/calibrate.html', 'game/levels.test.js', 'demo.html']) {
      await assert.rejects(stat(join(out, rel)), rel);
    }
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

// One concrete path per development-only rule. Adding an exclusion without a
// sample here fails the coverage assertion below, so every excluded path is
// asserted and would surface if it ever reached www/.
const EXCLUDED_SAMPLES = [
  'game/source-assets/hero.png',
  'game/source-assets/nested/deep.png',
  'game/calibrate.html',
  'game/calibrate.js',
  'game/_dragon_test.html',
  'game/main.test.js',
  'game/platform.test.js',
  'game/api.js',
  'game/access-flow.js',
  'game/cancel-request.js',
  'game/withdrawal-request.js',
  'game/hero-spritesheet.png',
  'game/hero-spritesheet-upload.png',
  'game/tests/helper.js',
  'story/sources/intro/hero-raw.png',
  'story/references/hero-reference-sheet.png',
  'story/tools/cutout.py',
  'story/preview.html',
  'story/README.md',
  'story/ART-BIBLE.md',
  'story/tests/story.test.mjs',
  'export-sprites.html',
  'demo.html',
  'cancel.html',
  'widerruf.html',
  '.DS_Store',
];

const KEPT_SAMPLES = [
  ...REQUIRED_FILES,
  'game/platform.js',
  'game/platform-app.js',
  'game/fiend-sprites/a.png',
  'terms.html',
];

async function fixture(files) {
  const dir = await mkdtemp(join(tmpdir(), 'ffm-src-'));
  for (const rel of files) {
    const target = join(dir, rel);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, rel);
  }
  return dir;
}

test('every copy-assets exclusion is asserted against a concrete path', async () => {
  for (const pattern of EXCLUDED) {
    assert.ok(
      EXCLUDED_SAMPLES.some((rel) => pattern.test(rel)),
      `no sample path exercises exclusion ${pattern}`,
    );
  }

  const src = await fixture([...KEPT_SAMPLES, ...EXCLUDED_SAMPLES]);
  const out = await mkdtemp(join(tmpdir(), 'ffm-www-'));
  try {
    await copyAssets(src, out);
    for (const rel of EXCLUDED_SAMPLES) {
      await assert.rejects(stat(join(out, rel)), `${rel} must not appear in www/`);
    }
    for (const rel of KEPT_SAMPLES) {
      assert.ok((await stat(join(out, rel))).isFile(), `${rel} must be bundled`);
    }
  } finally {
    await rm(src, { recursive: true, force: true });
    await rm(out, { recursive: true, force: true });
  }
});

test('copy-assets fails when a required file is missing', async () => {
  const src = await fixture(['index.html', 'game/main.js']);
  const out = await mkdtemp(join(tmpdir(), 'ffm-www-'));
  try {
    await assert.rejects(copyAssets(src, out), /styles\.css/);
  } finally {
    await rm(src, { recursive: true, force: true });
    await rm(out, { recursive: true, force: true });
  }
});

const text = (rel) => readFile(join(root, rel), 'utf8');

test('README records the maintainer-owned escalation paths', async () => {
  const readme = await text('README.md');
  for (const rel of ['package.json', 'package-lock.json', 'capacitor.config.json', 'android/', 'ios/']) {
    assert.ok(readme.includes(rel), rel);
  }
  assert.match(readme, /escalat/i);
});

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
