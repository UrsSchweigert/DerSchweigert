// android-shell.test.mjs — asserts the committed Android shell (requirement 5.1).
//
// The native project belongs to the maintainer scaffold: this test only reads
// it. Gradle cannot run in the Linux checker (no SDK/JDK), so a real APK is
// never produced here; the only native compilation evidence is the M2 workflow
// `.github/workflows/arithmoslayer-native.yml` on the run branch. Anything these
// assertions cannot prove is recorded in RELEASING.md as an open owner action
// instead of being edited into the native project.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const text = (rel) => readFile(join(root, rel), 'utf8');
const exists = async (rel) => (await stat(join(root, rel))).isFile();

const APP_ID = 'de.derschweigert.arithmoslayer';
const APP_NAME = 'Arithmo Slayer';
const APP = 'android/app';
const MANIFEST = `${APP}/src/main/AndroidManifest.xml`;
const BUILD_GRADLE = `${APP}/build.gradle`;
const STRINGS = `${APP}/src/main/res/values/strings.xml`;
const RELEASING = 'RELEASING.md';

const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Attributes of the first element named `name`, read without an XML parser.
function attributes(source, name) {
  const match = new RegExp(`<${name}\\b[^>]*>`).exec(source);
  assert.ok(match, `the manifest must contain a <${name}> element`);
  return Object.fromEntries(
    [...match[0].matchAll(/([\w:]+)\s*=\s*"([^"]*)"/g)].map(([, key, value]) => [key, value]),
  );
}

test('the committed project keeps the app identity', async () => {
  const config = JSON.parse(await text('capacitor.config.json'));
  const gradle = await text(BUILD_GRADLE);
  const strings = await text(STRINGS);

  assert.equal(config.appId, APP_ID);
  assert.equal(config.appName, APP_NAME);

  assert.match(gradle, new RegExp(`namespace\\s*=\\s*"${escape(APP_ID)}"`));
  assert.match(gradle, new RegExp(`applicationId\\s+"${escape(APP_ID)}"`));

  // SDK levels come from variables.gradle, the Buchstabenzeit packaging pattern.
  assert.match(gradle, /compileSdk\s*=\s*rootProject\.ext\.compileSdkVersion/);
  assert.match(gradle, /minSdkVersion\s+rootProject\.ext\.minSdkVersion/);
  assert.match(gradle, /targetSdkVersion\s+rootProject\.ext\.targetSdkVersion/);
  const variables = await text('android/variables.gradle');
  const minSdk = Number(/minSdkVersion\s*=\s*(\d+)/.exec(variables)?.[1]);
  assert.ok(minSdk >= 23, 'Auto Backup needs API 23 or newer');

  assert.match(strings, new RegExp(`<string name="app_name">${escape(APP_NAME)}</string>`));
  assert.match(strings, new RegExp(`<string name="package_name">${escape(APP_ID)}</string>`));
  assert.match(strings, new RegExp(`<string name="custom_url_scheme">${escape(APP_ID)}</string>`));

  assert.ok(
    await exists(`${APP}/src/main/java/de/derschweigert/arithmoslayer/MainActivity.java`),
    'the launcher activity class must match the package identity',
  );
});

test('the manifest labels the app and keeps Auto Backup fully on', async () => {
  const manifest = await text(MANIFEST);
  const application = attributes(manifest, 'application');

  assert.equal(application['android:label'], '@string/app_name');
  assert.equal(application['android:allowBackup'], 'true');
  assert.equal(application['android:icon'], '@mipmap/ic_launcher');
  assert.equal(application['android:roundIcon'], '@mipmap/ic_launcher_round');

  // No rule file may narrow the platform default: progress lives in
  // SharedPreferences and would silently stop being backed up.
  assert.equal(application['android:fullBackupContent'], undefined);
  assert.equal(application['android:dataExtractionRules'], undefined);
  assert.doesNotMatch(manifest, /allowBackup="false"/);
  assert.doesNotMatch(manifest, /fullBackupContent|dataExtractionRules/);
});

test('exactly one activity is exported, and it is the launcher', async () => {
  const manifest = await text(MANIFEST);
  const activities = [...manifest.matchAll(/<activity\b[^>]*>/g)].map(([tag]) => attributes(tag, 'activity'));

  assert.equal(activities.length, 1, 'the shell ships a single activity');
  const [activity] = activities;
  assert.equal(activity['android:name'], '.MainActivity');
  assert.equal(activity['android:exported'], 'true');
  assert.equal(activity['android:theme'], '@style/AppTheme.NoActionBarLaunch');
  assert.equal(activity['android:launchMode'], 'singleTask');

  const filters = [...manifest.matchAll(/<intent-filter>([\s\S]*?)<\/intent-filter>/g)].map(([, body]) => body);
  assert.equal(filters.length, 1);
  assert.match(filters[0], /<action android:name="android\.intent\.action\.MAIN" \/>/);
  assert.match(filters[0], /<category android:name="android\.intent\.category\.LAUNCHER" \/>/);

  const exported = [...manifest.matchAll(/<(\w+)\b[^>]*android:exported="true"[^>]*>/g)].map(([, name]) => name);
  assert.deepEqual(exported, ['activity'], 'only the launcher activity is exported');
  const provider = attributes(manifest, 'provider');
  assert.equal(provider['android:exported'], 'false');
  assert.equal(provider['android:authorities'], '${applicationId}.fileprovider');
});

test('the app declares no permission of its own', async () => {
  const manifest = await text(MANIFEST);

  // Play Billing merges BILLING plus INTERNET and ACCESS_NETWORK_STATE into the
  // packaged manifest. Declaring them here would duplicate the library and ship
  // permissions the offline game never uses.
  assert.doesNotMatch(manifest, /<uses-permission/);
  assert.doesNotMatch(manifest, /<permission\b/);
  assert.doesNotMatch(manifest, /android\.permission\.[A-Z_]+/);

  const pkg = JSON.parse(await text('package.json'));
  assert.match(pkg.dependencies['@capgo/native-purchases'], /^8\.\d+\.\d+$/);

  const plugins = await text(`${APP}/capacitor.build.gradle`);
  assert.match(plugins, /implementation project\(':capgo-native-purchases'\)/);

  // The merged manifest is the only place the billing permissions are visible;
  // RELEASING.md keeps that verification as an open gate, never as a claim.
  const doc = await text(RELEASING);
  assert.match(doc, /merged manifest/i);
  assert.match(doc, /com\.android\.vending\.BILLING/);
  assert.match(doc, /INTERNET/);
  assert.match(doc, /ACCESS_NETWORK_STATE/);
});

test('the adaptive icon and splash come from the committed artwork', async () => {
  const adaptive = await text(`${APP}/src/main/res/mipmap-anydpi-v26/ic_launcher.xml`);
  assert.match(adaptive, /<adaptive-icon\b/);
  assert.match(adaptive, /@mipmap\/ic_launcher_background/);
  assert.match(adaptive, /@mipmap\/ic_launcher_foreground/);

  const adaptiveRound = await text(`${APP}/src/main/res/mipmap-anydpi-v26/ic_launcher_round.xml`);
  assert.match(adaptiveRound, /<adaptive-icon\b/);

  for (const density of ['mdpi', 'hdpi', 'xhdpi', 'xxhdpi', 'xxxhdpi']) {
    for (const name of ['ic_launcher.png', 'ic_launcher_round.png', 'ic_launcher_background.png']) {
      assert.ok(await exists(`${APP}/src/main/res/mipmap-${density}/${name}`), `mipmap-${density}/${name}`);
    }
  }

  const styles = await text(`${APP}/src/main/res/values/styles.xml`);
  assert.match(styles, /<style name="AppTheme\.NoActionBarLaunch" parent="Theme\.SplashScreen">/);
  assert.match(styles, /<item name="android:background">@drawable\/splash<\/item>/);
  for (const rel of ['drawable/splash.png', 'drawable-night/splash.png', 'drawable-port-xxxhdpi/splash.png']) {
    assert.ok(await exists(`${APP}/src/main/res/${rel}`), rel);
  }
});

test('the version scheme is documented and the release override defaults to 1 / 1.0', async () => {
  const gradle = await text(BUILD_GRADLE);
  assert.match(gradle, /versionCode resolvedVersionCode/);
  assert.match(gradle, /versionName resolvedVersionName/);

  const lines = gradle.split('\n');
  const codeLine = lines.find((line) => line.includes('def resolvedVersionCode'));
  const nameLine = lines.find((line) => line.includes('def resolvedVersionName'));
  assert.ok(codeLine, 'build.gradle must resolve versionCode');
  assert.ok(nameLine, 'build.gradle must resolve versionName');
  assert.match(codeLine, /ffmVersionCode.*FFM_VERSION_CODE.*BZ_VERSION_CODE.*'1'/);
  assert.match(nameLine, /ffmVersionName.*FFM_VERSION_NAME.*BZ_VERSION_NAME.*'1\.0'/);

  const doc = await text(RELEASING);
  const lower = doc.toLowerCase();
  for (const needle of [
    'versioncode',
    'versionname',
    'strictly increase',
    'bzversioncode',
    'bzversionname',
    'BZ_VERSION_CODE',
    'BZ_VERSION_NAME',
    'variables.gradle',
    'release record',
  ]) {
    assert.ok(lower.includes(needle.toLowerCase()), `RELEASING.md must document ${needle}`);
  }

  // The override is wired up in the committed shell, so the doc describes it
  // instead of recording the native edit as an open owner action.
  assert.doesNotMatch(doc, /hardcodes `versionCode 1`/);
  assert.match(doc, /android\/app\/build\.gradle/);
  assert.match(doc, /FFM_VERSION_CODE/);
});

test('the release build is signed from the environment and fails loudly without it', async () => {
  const gradle = await text(BUILD_GRADLE);
  assert.match(gradle, /signingConfigs \{\s*\n\s*release \{/);
  for (const env of [
    'FFM_KEYSTORE_FILE',
    'FFM_KEYSTORE_PASSWORD',
    'FFM_KEY_ALIAS',
    'FFM_KEY_PASSWORD',
  ]) {
    assert.ok(gradle.includes(env), `build.gradle must read ${env}`);
  }
  assert.match(gradle, /signingConfig hasReleaseSigning \? signingConfigs\.release : null/);
  // A release without credentials throws instead of emitting an unsigned bundle,
  // while debug builds keep working without them.
  assert.match(gradle, /throw new GradleException/);
  assert.match(gradle, /t\.name == 'bundleRelease' \|\| t\.name == 'assembleRelease'/);
  // No keystore or credentials are ever committed.
  await assert.rejects(stat(join(root, 'android/keystore.properties')), { code: 'ENOENT' });
});

test('RELEASING.md records the shell gaps and the open gates', async () => {
  const doc = await text(RELEASING);
  const lower = doc.toLowerCase();

  for (const needle of [
    'npm run copy-assets',
    'node scripts/bundle-check.mjs',
    'npm test',
    'arithmoslayer-native.yml',
    'M1',
    'M2',
    'M3',
    'arithmoslayer_full_unlock',
    'sandbox',
    'internal testing',
    'App Review',
    'parental gate',
    'manual gate',
  ]) {
    assert.ok(lower.includes(needle.toLowerCase()), `RELEASING.md must cover ${needle}`);
  }

  // Every unresolved gate is written as open until a revision-bound evidence
  // row exists; the manual checklist carries placeholders, not claims.
  assert.match(doc, /pending|open/i);
  assert.match(doc, /\|.*Revision.*\|/i);
});
