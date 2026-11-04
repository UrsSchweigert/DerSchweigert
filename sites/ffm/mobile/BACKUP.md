# OS backup of on-device progress

Arithmo Slayer has no account and no server. Progress is written on the device
by `game/progress-store.js` and has to survive the operating system's own
backup and restore path, because there is no cloud sync, no export/import screen
and no reset button. This document records what is stored, which OS mechanism
covers it, how to verify a restore, and the native flags later phases must keep.

## What is stored, and where

| Record | Capacitor Preferences key | Content |
| --- | --- | --- |
| Per-level best | `arithmoslayer:progress:best` | best score, difficulty and timestamp per level |
| Score history | `arithmoslayer:progress:history` | the last 100 timestamped entries behind the title-screen chart |
| Completed levels | `arithmoslayer:progress:completed` | sorted level numbers that were cleared |

Every record is one JSON document with a `version` field (currently schema
version 1) written with a single `set`, so a write either replaces that record
or leaves the previous one untouched. A corrupt document, a missing key or an
unknown newer schema version reads as empty instead of throwing.

The app's only backend is `createPreferencesBackend()` in
`game/progress-store.js`; `game/platform-adapter.js` builds the store from it:

```js
const progress = createProgressStore(createPreferencesBackend());
```

Capacitor Preferences writes to the platform's standard small-data store:

- Android: a `SharedPreferences` file (`shared_prefs/CapacitorStorage.xml`) in
  the app's private data directory.
- iOS: `NSUserDefaults`, in
  `Library/Preferences/de.derschweigert.arithmoslayer.plist` inside the app
  container.

Both are included in the OS backup model by default. The phase 3 unlock cache
uses the same backend and therefore inherits this model; nothing in the app
marks progress as excluded from backup.

## Android: Auto Backup

Android Auto Backup (API 23 and newer) copies the app's private data directory,
including `SharedPreferences`, and restores it when the app is installed again
on the same account. It runs when `android:allowBackup="true"` is set; the
manifest in `android/app/src/main/AndroidManifest.xml` sets it.

Which files are included is described by `android:dataExtractionRules` on
Android 12+ (cloud backup and device-to-device transfer) and by the older
`android:fullBackupContent` attribute. The app sets neither, so the platform
default applies: everything under the app data directory except `cache/` and
`no_backup/` is backed up. Progress is well inside the 25 MB per-app cloud
quota. No rule may add an `<exclude>` for `sharedpref` or the data directory,
because that would silently drop the player's progress.

### Verifying an Android restore

Use a device with a backup transport (a physical device signed into a Google
account; emulator images often have no usable transport):

```sh
# 1. Clear a level, note the per-level best and history on the title screen.
# 2. Confirm the app is eligible and force a backup:
adb shell dumpsys backup | grep -A3 arithmoslayer
adb shell bmgr backupnow de.derschweigert.arithmoslayer
adb shell bmgr list sets                       # note the transport token
# 3. Remove the app, install it again, then restore:
adb shell pm uninstall de.derschweigert.arithmoslayer
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
adb shell bmgr restore <token> de.derschweigert.arithmoslayer
# 4. Relaunch: the per-level best, chart and completed count must match step 1.
```

Also verify the shipped artifact still carries the flag and no rules:

```sh
apkanalyzer manifest print android/app/build/outputs/bundle/release/app-release.aab \
  | grep -i -E 'allowBackup|fullBackupContent|dataExtractionRules'
```

The expected output is `android:allowBackup="true"` and nothing else. The
Google One device-to-device and reinstall restore paths use the same data, so
one successful transport restore plus the artifact check covers both.

## iOS: device and iCloud backup

iOS backs up the app container to iCloud Backup or to an encrypted
computer backup unless a file or directory is marked with
`NSURLIsExcludedFromBackupKey`. `NSUserDefaults` lives in
`Library/Preferences`, which is part of that container and is included. The
app never sets `NSURLIsExcludedFromBackupKey`, and `ios/App/App/Info.plist`
declares no `NSFileProtection*` key, so nothing narrows the backup or keeps the
preferences plist out of it.

Backup is a snapshot, not sync: the app must be installed when the backup runs,
and progress returns only when the device (or a new device) is restored from
that backup. Simulator clones and `simctl` copies do not exercise iCloud.

### Verifying an iOS restore

1. Clear a level and note the per-level best and chart entries.
2. Back up: Settings → Apple ID → iCloud → iCloud Backup → Back Up Now, or make
   an encrypted Finder backup. Wait for the backup to finish.
3. Delete the app, then restore the device (or a second device) from that
   backup and install the same build again.
4. Relaunch: the title-screen best, chart and completed count must match
   step 1.

For the build itself, confirm the plist has no backup exclusion:

```sh
plutil -p ios/App/App/Info.plist | grep -i -E 'FileProtection|ExcludedFromBackup'
```

The command must print nothing.

## Native flags P5 must set

P5 owns the native shells, so it sets and verifies these flags. They are
maintainer-owned files: the change belongs in that phase, not in a worker
branch.

Android — `android/app/src/main/AndroidManifest.xml`:

- keep `android:allowBackup="true"`;
- do not add `android:fullBackupContent`;
- do not add `android:dataExtractionRules`;
- if a rules file is ever introduced (`res/xml/backup_rules.xml`,
  `res/xml/data_extraction_rules.xml`), it must not contain an `<exclude>` for
  `sharedpref` or the app's data directory.

iOS — `ios/App/App/Info.plist`:

- no `NSFileProtection*` key that excludes the preferences plist from backup;
- no `NSURLIsExcludedFromBackupKey` handling on the preferences plist;
- no iCloud/CloudKit container: this design is backup-only, not live sync.

## Automated check

`tests/backup.test.mjs` asserts that the store is built on the Capacitor
Preferences backend, that the Android manifest allows backup and declares no
backup rules, that no `res/xml` rule excludes app data, that the iOS plist
declares no `NSFileProtection` or backup exclusion, and that this document keeps
naming the keys and flags above. Run it with:

```sh
node --test tests/backup.test.mjs
```
