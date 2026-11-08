// backup.test.mjs — proves the OS backup model for on-device progress.
//
// The app has no server and no account, so a cleared level only survives a
// reinstall or a new device through the OS backup. These tests assert that the
// store is built on the backup-included Capacitor Preferences backend, that
// neither native shell excludes app data from backup, and that BACKUP.md keeps
// documenting the model and the flags the shell phases must preserve.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PROGRESS_KEYS, createPreferencesBackend } from '../game/progress-store.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const text = (rel) => readFile(join(root, rel), 'utf8');
const toPosix = (rel) => rel.split('\\').join('/');
const ANDROID_MANIFEST = 'android/app/src/main/AndroidManifest.xml';
const IOS_PLIST = 'ios/App/App/Info.plist';

test('progress is stored through the Capacitor Preferences backend', async () => {
  assert.equal(typeof createPreferencesBackend, 'function');

  const store = await text('game/progress-store.js');
  assert.match(store, /Capacitor\?\.Plugins\?\.Preferences/);
  // The backend must not fall back to a store the OS backup skips or to a
  // plugin that would need its own backup rules.
  assert.doesNotMatch(store, /\blocalStorage\b|\bindexedDB\b|@capacitor\/filesystem/);
  assert.doesNotMatch(store, /ExcludedFromBackup|excludeFromBackup|no_backup/i);

  const adapter = await text('game/platform-adapter.js');
  assert.match(adapter, /import \{[^}]*createPreferencesBackend[^}]*\} from '\.\/progress-store\.js'/);
  assert.match(adapter, /createLocalProfileAdapter\(\{ backend: createPreferencesBackend\(\) \}\)/);
  const profiles = await text('game/profile-store.js');
  assert.doesNotMatch(profiles, /\blocalStorage\b|\bindexedDB\b|@capacitor\/filesystem/);

  const pkg = JSON.parse(await text('package.json'));
  assert.match(pkg.dependencies['@capacitor/preferences'], /^8\.\d+\.\d+$/);
});

test('the Preferences backend reads and writes through the injected bridge', async () => {
  const calls = [];
  const backend = createPreferencesBackend({
    Capacitor: {
      Plugins: {
        Preferences: {
          async get({ key }) {
            calls.push(['get', key]);
            return { value: 'stored' };
          },
          async set({ key, value }) {
            calls.push(['set', key, value]);
          },
        },
      },
    },
  });

  assert.equal(backend.isAvailable(), true);
  assert.equal(await backend.get('arithmoslayer:progress:best'), 'stored');
  await backend.set('arithmoslayer:progress:best', '{}');
  assert.deepEqual(calls, [
    ['get', 'arithmoslayer:progress:best'],
    ['set', 'arithmoslayer:progress:best', '{}'],
  ]);

  // Outside the WebView there is no bridge, so the store reads as empty.
  assert.equal(createPreferencesBackend({}).isAvailable(), false);
});

test('Android Auto Backup includes the progress store', async () => {
  const manifest = await text(ANDROID_MANIFEST);
  assert.match(manifest, /android:allowBackup="true"/);
  assert.doesNotMatch(manifest, /android:fullBackupContent/);
  assert.doesNotMatch(manifest, /android:dataExtractionRules/);
});

test('no Android manifest opts app data out of backup', async () => {
  const entries = (await readdir(join(root, 'android'), { recursive: true }))
    .map(toPosix)
    .filter((rel) => rel.split('/').pop() === 'AndroidManifest.xml');
  assert.ok(entries.length > 0, 'the Android shell must ship a manifest');

  for (const rel of entries) {
    const manifest = await text(join('android', rel));
    assert.doesNotMatch(manifest, /android:allowBackup="false"/, rel);
    assert.doesNotMatch(manifest, /android:fullBackupContent=/, rel);
    assert.doesNotMatch(manifest, /android:dataExtractionRules=/, rel);
  }
});

test('no Android backup rule excludes app data', async () => {
  const resXml = join(root, 'android', 'app', 'src', 'main', 'res', 'xml');
  const entries = (await readdir(resXml, { recursive: true }))
    .map(toPosix)
    .filter((rel) => rel.endsWith('.xml'));
  assert.ok(entries.includes('file_paths.xml'), 'the FileProvider paths stay the only rule file');

  for (const rel of entries) {
    const source = await readFile(join(resXml, rel), 'utf8');
    assert.doesNotMatch(source, /<exclude\b/, `${rel} must not exclude data from backup`);
    assert.doesNotMatch(source, /full-backup-content|data-extraction-rules/, rel);
  }
});

test('iOS excludes nothing from device or iCloud backup', async () => {
  const plist = await text(IOS_PLIST);
  assert.doesNotMatch(plist, /NSFileProtection/i);
  assert.doesNotMatch(plist, /NSURLIsExcludedFromBackupKey|ExcludedFromBackup/);
  // iCloud/CloudKit sync is out of scope; backup is the only transport.
  assert.doesNotMatch(plist, /com\.apple\.developer\.icloud/);
});

test('BACKUP.md documents the model, the restore steps and the shell flags', async () => {
  const doc = await text('BACKUP.md');
  const lower = doc.toLowerCase();

  for (const needle of [
    'Capacitor Preferences',
    'Auto Backup',
    'allowBackup',
    'fullBackupContent',
    'dataExtractionRules',
    'NSFileProtection',
    'NSUserDefaults',
    'SharedPreferences',
    'iCloud',
    'restore',
    'P5',
  ]) {
    assert.ok(lower.includes(needle.toLowerCase()), `BACKUP.md must mention ${needle}`);
  }

  for (const key of Object.values(PROGRESS_KEYS)) {
    assert.ok(doc.includes(key), `BACKUP.md must document the ${key} record`);
  }

  assert.match(doc, /android:allowBackup="true"/);
  assert.match(doc, /<exclude>/);
});
