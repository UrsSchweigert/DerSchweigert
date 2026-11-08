# OS backup of on-device progress

Arithmo Slayer has no account and no server. Family profiles and their progress
are written on the device by `game/profile-store.js` using the Preferences
backend in `game/progress-store.js` and have to survive the operating system's own
backup and restore path, because there is no cloud sync, no export/import screen
and no reset button. This document records what is stored, which OS mechanism
covers it, how to verify a restore, and the native flags later phases must keep.

## What is stored, and where

| Record | Capacitor Preferences key | Content |
| --- | --- | --- |
| Family profiles | `arithmoslayer:profiles` | selected profile ID, stable player IDs/names, each player's bests, latest 100 history entries, sorted completed levels, completion receipts and optional practice badges/receipts |
| Standalone per-level best | `arithmoslayer:progress:best` | legacy standalone helper's best score, difficulty and timestamp per level |
| Standalone score history | `arithmoslayer:progress:history` | legacy standalone helper's latest 100 timestamped entries |
| Standalone completed levels | `arithmoslayer:progress:completed` | legacy standalone helper's sorted cleared levels |

The family profile record is one version-1 JSON document. All mutations are
serialized. Recording a completion writes its personal best (if improved),
history, completed levels and completion-ID receipt with one `set`. The
in-memory committed state changes only after that write succeeds. Retrying the
same completion ID for the same player returns its original
`{persisted:true,bestImproved}` result without adding history or writing again.
Receipts are kept even after entries leave the 100-entry history window;
reusing an ID with a different result rejects with `completion_conflict`.

Clears may also carry an optional `attemptSummary`: correct/total first replies,
correct replies including retries, incorrect replies, timeouts, and best streak.
The summary and previous same-level/same-difficulty comparison are committed in
that same write. Summary-bearing receipts return their original
`previousAttemptSummary` on retry, even after later attempts are recorded.
Documents and receipts without summaries remain valid and never invent statistics.

Practice badges are optional fields in the same version-1 family document.
`recordPractice({profileId,sessionId,badgeIds})` atomically records descriptive
badges and its stable session receipt, without changing best scores, history or
completed levels. It returns `{persisted:true,badges}` for newly earned badges;
retries return the original receipt even after relaunch. Reusing an ID for
different badges rejects with `practice_conflict`. `getPracticeBadges(profileId)`
returns `{badges}`. Missing optional fields mean no badges, not inferred awards.
Failed writes preserve the committed state and remain retryable. Badges belong
to the captured player and use the existing OS backup mechanism; purchases
remain device-wide and independent.

A missing profile key creates one default player. No standalone records are
imported or migrated: this app has not launched. A read failure, corrupt profile
document, unsupported schema, unavailable Preferences bridge, or failed write
rejects with `code:"storage_unavailable"`; it never silently replaces existing
data or reports a successful save. The retained standalone progress helpers
keep their existing empty-on-corruption behavior.

The app's only backend is `createPreferencesBackend()` in
`game/progress-store.js`. The app composes the independent local-profile adapter
into `game/platform-adapter.js`:

```js
import { createLocalProfileAdapter } from './local-profile-adapter.js';
const localProfiles = createLocalProfileAdapter();
await localProfiles.initialize({ defaultName: 'Player 1' });
```

`getActiveProfile()` synchronously returns the committed `{id,name}` after
initialization. All other methods are asynchronous: `listProfiles()`,
`createProfile(name)` (creates and selects atomically), `selectProfile(id)`,
`renameProfile(id,name)`, and `deleteProfile(id,{confirmed:true})`. Deleting the
active player selects the first remaining player; the final player cannot be
deleted. Names may duplicate, but IDs never change or merge.

Progress reads require an explicit owner ID: `getBestScores(profileId)` returns
`{best}`, `getScoreHistory(profileId)` returns `{history}`, and
`getCompletedLevels(profileId)` returns `{completed}`.
`recordLevel({profileId,completionId,level,score,difficulty})` returns
`{persisted,bestImproved}`. Capture the profile ID and one stable completion ID
when a run starts; retries reuse both IDs. A lower or zero score still persists
history and completion successfully. Entitlement remains device-wide in its
separate store and is not created, changed or deleted by profile operations.

`recordLevel({...record,attemptSummary})` additionally returns
`previousAttemptSummary` (or `null` when no comparable summary exists).
`getAttemptSummary(profileId,level,difficulty)` reads the latest comparable clear.
Statistics belong to the captured player, not the current UI selection, and stay
inside the OS-backed family record; they are not sent to an educational service.

The profile UI is mounted with
`mountProfileUI({root,adapter,translate,canSwitch,onSelected,onError})`, returning
`{refresh,destroy}`. It refreshes automatically, uses text-only rendering, and
shows up to three players per page (two when viewport height is below 400px).
Create/rename forms and delete confirmations replace the list, not extend it.
The parent must deny profile changes during active, paused or unsettled runs
through `canSwitch` and refresh the UI when that guard changes.
`onSelected` receives the committed active `{id,name}` after a successful
create, select, rename or deletion.

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
# 1. Create two players, clear different levels, note the selected player,
#    each player's per-level best, history, and completed count.
# 2. Confirm the app is eligible and force a backup:
adb shell dumpsys backup | grep -A3 arithmoslayer
adb shell bmgr backupnow de.derschweigert.arithmoslayer
adb shell bmgr list sets                       # note the transport token
# 3. Remove the app, install it again, then restore:
adb shell pm uninstall de.derschweigert.arithmoslayer
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
adb shell bmgr restore <token> de.derschweigert.arithmoslayer
# 4. Relaunch: names, selected ID and each player's progress must match step 1.
#    Replay/retry a completion and verify its history appears only once.
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

1. Create two players, clear different levels, and note their names, selected
   player, personal bests, chart entries and completed counts.
2. Back up: Settings → Apple ID → iCloud → iCloud Backup → Back Up Now, or make
   an encrypted Finder backup. Wait for the backup to finish.
3. Delete the app, then restore the device (or a second device) from that
   backup and install the same build again.
4. Relaunch: the names, selected player and each player's personal best, chart
   and completed count must match step 1. Verify changing players does not
   change the device's unlock entitlement.

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

Profile isolation, atomic writes, idempotency, reload, failed initialization,
failed mutations, device entitlement preservation and UI guards/pagination
are covered separately:

```sh
node --test tests/{progress-store,profile-store,local-profile-adapter,profile-ui}.test.mjs
```
