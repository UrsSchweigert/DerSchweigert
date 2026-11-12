// Static checks for the committed iOS shell.
//
// These assertions read the files the maintainer committed with the Capacitor
// tooling. They never compile the project, so they prove the declared identity,
// localizations and privacy manifest only. Native-compilation evidence belongs
// to the owner-run M2 job in `.github/workflows/arithmoslayer-native.yml` (xcodebuild
// with `CODE_SIGNING_ALLOWED=NO`), never to this static check, and behaviour
// that needs a device stays a manual gate in RELEASING.md.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const text = (rel) => readFile(join(root, rel), 'utf8');

const INFO_PLIST = 'ios/App/App/Info.plist';
const PRIVACY_MANIFEST = 'ios/App/App/PrivacyInfo.xcprivacy';
const PBXPROJ = 'ios/App/App.xcodeproj/project.pbxproj';

const stringsInArray = (plist, key) => {
  const match = plist.match(new RegExp(`<key>${key}</key>\\s*<array>([\\s\\S]*?)</array>`));
  assert.ok(match, `${key} must be an array`);
  return [...match[1].matchAll(/<string>([^<]*)<\/string>/g)].map((entry) => entry[1]);
};

test('the iOS bundle carries the app identity, both localizations and the encryption exemption', async () => {
  const plist = await text(INFO_PLIST);
  assert.match(plist, /<key>CFBundleDisplayName<\/key>\s*<string>Arithmo Slayer<\/string>/);
  assert.deepEqual(stringsInArray(plist, 'CFBundleLocalizations'), ['de', 'en']);
  assert.match(plist, /<key>ITSAppUsesNonExemptEncryption<\/key>\s*<false\/>/);

  // Versioning is one scheme for both configurations: the plist reads the
  // build settings, so an upload only has to bump the two values below.
  assert.match(plist, /<key>CFBundleShortVersionString<\/key>\s*<string>\$\(MARKETING_VERSION\)<\/string>/);
  assert.match(plist, /<key>CFBundleVersion<\/key>\s*<string>\$\(CURRENT_PROJECT_VERSION\)<\/string>/);
  const pbx = await text(PBXPROJ);
  const bundleIds = pbx.match(/PRODUCT_BUNDLE_IDENTIFIER = de\.derschweigert\.arithmoslayer;/g) ?? [];
  assert.equal(bundleIds.length, 2, 'Debug and Release must both use the app bundle id');
  for (const setting of ['MARKETING_VERSION = 1.0;', 'CURRENT_PROJECT_VERSION = 1;']) {
    assert.ok(pbx.includes(setting), setting);
  }
});

test('the privacy manifest declares no tracking and only the UserDefaults reason', async () => {
  const privacy = await text(PRIVACY_MANIFEST);
  assert.match(privacy, /<key>NSPrivacyTracking<\/key>\s*<false\/>/);
  assert.match(privacy, /<key>NSPrivacyCollectedDataTypes<\/key>\s*<array\/>/);
  assert.match(privacy, /<key>NSPrivacyTrackingDomains<\/key>\s*<array\/>/);

  const types = [...privacy.matchAll(/<key>NSPrivacyAccessedAPIType<\/key>\s*<string>([^<]+)<\/string>/g)]
    .map((match) => match[1]);
  assert.deepEqual(types, ['NSPrivacyAccessedAPICategoryUserDefaults']);
  assert.match(privacy, /NSPrivacyAccessedAPICategoryUserDefaults[\s\S]*<string>CA92\.1<\/string>/);

  // Only reason codes actually used are declared: Capacitor Preferences writes
  // the app's own NSUserDefaults, which is CA92.1 and nothing else.
  const reasons = [...privacy.matchAll(/<string>([A-Z0-9]{4}\.\d)<\/string>/g)].map((match) => match[1]);
  assert.deepEqual(reasons, ['CA92.1']);
});

test('both build configurations support iPhone and iPad without locking rotation', async () => {
  const pbx = await text(PBXPROJ);
  assert.equal((pbx.match(/TARGETED_DEVICE_FAMILY = "1,2";/g) ?? []).length, 2);
  const plist = await text(INFO_PLIST);
  assert.deepEqual(stringsInArray(plist, 'UISupportedInterfaceOrientations'), [
    'UIInterfaceOrientationPortrait', 'UIInterfaceOrientationLandscapeLeft', 'UIInterfaceOrientationLandscapeRight',
  ]);
  assert.deepEqual(stringsInArray(plist, 'UISupportedInterfaceOrientations~ipad'), [
    'UIInterfaceOrientationPortrait', 'UIInterfaceOrientationPortraitUpsideDown',
    'UIInterfaceOrientationLandscapeLeft', 'UIInterfaceOrientationLandscapeRight',
  ]);
});

test('the privacy manifest is compiled into the app target', async () => {
  const pbx = await text(PBXPROJ);
  assert.match(pbx, /PrivacyInfo\.xcprivacy \*\/ = \{isa = PBXFileReference;/);
  const phase = pbx.slice(
    pbx.indexOf('/* Begin PBXResourcesBuildPhase section */'),
    pbx.indexOf('/* End PBXResourcesBuildPhase section */'),
  );
  assert.ok(phase.length > 0, 'the project needs a Resources build phase');
  assert.match(phase, /PrivacyInfo\.xcprivacy in Resources/);
});

test('the committed shell carries the app icon and launch screen', async () => {
  const plist = await text(INFO_PLIST);
  assert.match(plist, /<key>UILaunchStoryboardName<\/key>\s*<string>LaunchScreen<\/string>/);
  const pbx = await text(PBXPROJ);
  assert.match(pbx, /ASSETCATALOG_COMPILER_APPICON_NAME = AppIcon;/);

  const iconSetDir = join(root, 'ios/App/App/Assets.xcassets/AppIcon.appiconset');
  const iconSet = JSON.parse(await readFile(join(iconSetDir, 'Contents.json'), 'utf8'));
  assert.ok(iconSet.images.length > 0, 'the app icon set must list an image');
  for (const image of iconSet.images) {
    assert.ok((await stat(join(iconSetDir, image.filename))).isFile(), image.filename);
  }
  assert.ok((await stat(join(root, 'ios/App/App/Base.lproj/LaunchScreen.storyboard'))).isFile());
});

test('the App target declares the In-App Purchase capability and no entitlements file', async () => {
  const pbx = await text(PBXPROJ);
  // Xcode records an added capability as SystemCapabilities on the app target,
  // which is what makes Signing & Capabilities list it.
  assert.match(pbx, /SystemCapabilities = \{\s*com\.apple\.InAppPurchase = \{\s*enabled = 1;\s*\};/);

  // In-App Purchase has no entitlement key and is enabled by default on every
  // explicit App ID, so no entitlements file belongs to the target.
  assert.doesNotMatch(pbx, /CODE_SIGN_ENTITLEMENTS/);
  await assert.rejects(stat(join(root, 'ios/App/App/App.entitlements')), { code: 'ENOENT' });
});

test('the open iOS shell gaps are escalated instead of silently accepted', async () => {
  const doc = await text('RELEASING.md');
  for (const phrase of ['In-App Purchase capability', 'silent switch', 'AVAudioSession', 'PENDING_MANUAL_GATES']) {
    assert.ok(doc.includes(phrase), `RELEASING.md must record ${phrase}`);
  }
});
