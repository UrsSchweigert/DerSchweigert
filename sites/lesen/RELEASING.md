# Releasing Buchstabenzeit for Android

This document describes how to turn a known-good source revision into a valid,
versioned, signed Android App Bundle (`.aab`) for Google Play. The website
(`lesen.derschweigert.de`) deploys separately and is unaffected by this process.

> **External release gate:** producing a validly signed `.aab` and completing the
> Play Console internal-track install and upgrade check are manual maintainer
> actions. This repository's automated checks (shared JS tests, asset sync, and
> `android-release.yml`) neither perform nor claim that gate.

All commands run from `sites/lesen/`. Nothing secret is ever committed.

## Prerequisites (local)

- Node.js 22+ and npm (Capacitor 8).
- JDK 21 (e.g. `brew install openjdk@21`).
- Android SDK command-line tools with `platform-tools`, `platforms;android-36`,
  `build-tools;36.0.0`, and `android/local.properties` pointing at the SDK
  (`sdk.dir=/path/to/Android/sdk`). `local.properties` is gitignored.

The locked native dependencies include `@capacitor/filesystem` and
`@capacitor/share` for the parent report's on-device CSV export. Run Capacitor
sync after restoring dependencies so both plugins reach the native project
(`npm run sync` for Android, or `npx cap sync ios` for an existing iOS project).
Installing the plugins alone is not export verification: test the adapter and
the native share sheet before release. The plain website remains independent
of these native dependencies.

P3's locked native prerequisites also include `@capacitor/haptics` and
`@capacitor/local-notifications`. Android inherits vibration and notification
restore support from these plugins. The app removes the notification plugin's
exact-alarm permission: practice reminders use inexact scheduling, not
exact-alarm settings or prompts. No INTERNET permission is added. Installing
these dependencies does not enable reminders or request permission; the adapter
must keep reminders off by default, require the parental gate before prompting,
remember denial without re-prompting, and suppress haptics under Reduce Motion.
Verify the final APK's merged permissions as well as native reminder/haptics
behaviour before release.

## iOS project prerequisites (not release approval)

The checked-in `ios/` shell is generated with the locked Capacitor 8 CLI and
Swift Package Manager. Restore it with `npm ci`, `npm run copy-assets`, then
`npx cap sync ios`; do not recreate or hand-edit `project.pbxproj`. The app
localizations are German and English, and its icon and light/dark splash assets
come from the existing images under `assets/`.

The app's `PrivacyInfo.xcprivacy` is registered in the App target's Resources
build phase, not merely present beside the source. It declares the Filesystem
plugin's documented `NSPrivacyAccessedAPICategoryFileTimestamp` reason `C617.1`
using Apple's `NSPrivacyAccessedAPITypeReasons` key. Tracking, tracking domains
and collected data are empty/disabled; recheck declarations against actual
native API usage whenever plugins change. Resource registration was performed
using the `xcode` project API already shipped with the locked Capacitor CLI.

An unsigned simulator build can be checked without signing credentials:

```bash
xcodebuild -project ios/App/App.xcodeproj -scheme App \
  -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath /tmp/buchstabenzeit-ios CODE_SIGNING_ALLOWED=NO build
plutil -lint /tmp/buchstabenzeit-ios/Build/Products/Debug-iphonesimulator/App.app/PrivacyInfo.xcprivacy
```

The generated project uses explicit source build phases. A new Swift file is
not compiled just because it exists: use an already compiled source file or
request maintainer-side project registration through supported project tooling.
This scaffold and unsigned build do not prove native speech, silent-switch
behaviour, physical-device behaviour, distribution signing or TestFlight/store
readiness. Those remain separate implementation and external release gates.

Native read-aloud accepts installed Apple compact, enhanced and premium speech
assets for German and English, including legacy identifiers. Voice quality is
not an offline-availability flag. Siri, unknown/third-party providers and
personal/novelty voices remain excluded because their offline behaviour is not
established by this bridge. iOS can still list a downloaded voice whose assets
cannot synthesize (Apple FB12994908): speaking with it ends at once in silence.
The bridge therefore renders a short sample into memory, without playback,
before using a voice; voices that yield no audio are skipped (and logged as
`OfflineTts: … produced no audio`), and failed voices are re-checked when the
app returns to the foreground. Voices are tried in order of preference (exact
locale first, then premium, enhanced, compact), and probing stops at the first
voice that works, so `listOfflineVoices` reports at most that one voice. The
probe for German and English runs in the background as soon as the app
initializes the bridge at launch, so the first read-aloud does not wait for it.
Speech is not played with
`AVSpeechSynthesizer.speak()`, which on iOS 17+ can finish in silence with
downloaded voices inside third-party apps: the bridge renders it with `write()`
and plays the audio through its own `AVAudioEngine` in the playback session,
reporting completion only after the audio has played. The Xcode log shows
`OfflineTts: speaking with <voice>` and `OfflineTts: playing via <route> at
volume <0–1>` for each utterance. Before release, test both languages in airplane mode
on a physical device with downloaded enhanced/premium voices, including a device
without a matching compact voice. Confirm missing voices still produce the
accessible explanation and that the silent switch does not mute playback.

## One-time: create your upload keystore

Google Play uses **Play App Signing**: Google holds the real *app signing key*;
you hold an *upload key*. Generate the upload keystore once and keep it (and its
passwords) safe and backed up — losing it means you must reset the upload key with
Google support.

```bash
keytool -genkeypair -v \
  -keystore buchstabenzeit-upload.jks \
  -alias buchstabenzeit \
  -keyalg RSA -keysize 2048 -validity 10000
```

Store it **outside** the repo (the repo ignores `*.jks` and `keystore.properties`
anyway). Then create `sites/lesen/android/keystore.properties` (gitignored):

```properties
storeFile=/absolute/path/to/buchstabenzeit-upload.jks
storePassword=... 
keyAlias=buchstabenzeit
keyPassword=...
```

Alternatively, set `BZ_KEYSTORE_FILE`, `BZ_KEYSTORE_PASSWORD`, `BZ_KEY_ALIAS`,
`BZ_KEY_PASSWORD` as environment variables (used by CI via encrypted secrets).

If no keystore is configured, `build:release` **fails loudly** instead of
producing a silently unsigned bundle.

## Versioning

`versionCode` must **strictly increase** for every Play upload; `versionName` is
the human-readable version. They default to `1` / `1.0` and are overridden per
release without editing `build.gradle`:

```bash
# via Gradle properties
./gradlew bundleRelease -PbzVersionCode=2 -PbzVersionName=1.1
# or via environment variables
BZ_VERSION_CODE=2 BZ_VERSION_NAME=1.1 npm run build:release
```

Keep a simple log (commit message or a table below) of: git revision, versionName,
versionCode, date, and release notes.

## Shell behaviour (safe areas, Back, version)

The web shell in `static/` and the thin native activity carry the P4 polish:

- **Safe areas.** `static/index.html` sets `viewport-fit=cover` and pads the
  body with `env(safe-area-inset-*)` (falling back to `0px`). `MainActivity`
  calls `WindowCompat.setDecorFitsSystemWindows(getWindow(), false)` and
  `AppTheme.NoActionBar` keeps the status and navigation bars transparent, so
  the edge-to-edge WebView reports real notch and gesture-bar insets.
- **Back behaviour.** The `@capacitor/app` `backButton` listener closes an open
  dialog first, asks for confirmation (End practice?) while a deck is running,
  returns to setup from the completion screen, and only exits the app from
  setup. Cancelling the dialog resumes practice.
- **Lifecycle and speech.** `appStateChange` and `visibilitychange` cancel
  in-flight speech when the app is backgrounded, so audio never continues while
  the device is locked or another app is in front.
- **Version, privacy, attribution.** The about dialog shows the version from a
  single source: `versionName` in `android/app/build.gradle`, read once at
  startup through the `@capacitor/app` plugin's `getInfo()`. On the plain
  website there is no native version, so the label is shown alone. The dialog
  links the bundled privacy policy (`datenschutz.html` /
  `datenschutz-en.html`), the word-list licences (`words-de-LICENSE.txt` /
  `words-en-LICENSE.txt`) and the font licence (`fonts/OFL.txt`); these files
  are part of the verified offline bundle, so no network request is involved.

## Release steps (local)

1. Choose a known-good commit on `android-app` and check it out.
2. `npm run restore`         # clean, locked dependency install (npm ci)
3. `npm test`                # shared JS logic tests
4. `npm run build:debug`     # optional: sanity debug build
5. `BZ_VERSION_CODE=<n> BZ_VERSION_NAME=<x.y> npm run build:release`
6. The signed bundle is at:
   `android/app/build/outputs/bundle/release/app-release.aab`
7. Verify it is signed:
   `jarsigner -verify -verbose -certs android/app/build/outputs/bundle/release/app-release.aab`
8. Upload the `.aab` to the Play Console (internal testing first). Test an
   **upgrade** over the previous build, not just a clean install.

Producing a validly signed `.aab` and completing the Play Console internal-track
install/upgrade check are an **external release gate**. They are performed
manually by the maintainer; the shared JS tests, `copy-assets`/`cap sync`, and
the `android-release.yml` build neither perform nor claim this gate.

## Release record

| Date | Git revision | versionName | versionCode | targetSdk | Track | Notes |
| --- | --- | ---: | ---: | ---: | --- | --- |
| 2026-10-22 | f29830f | 1.1 | 2 | 36 | Internal testing | First internal testing release. Signed with the upload key; Play App Signing enabled. Supersedes an earlier versionCode 1 (targetSdk 34) build that Play rejected for the API-36 requirement. |
| 2026-10-27 | b503c3d | 1.3 | 4 | 36 | Local build (not uploaded) | English UI and content (word list, sounds, voice), Flop Training, sound-unit word matching, English title "Letter time". Signed `.aab` and sideload `.apk`. versionCode 3 (1.2) was already used on Play. |

## Reproducing a past release

A release is reproducible from: the recorded **git revision** + the locked
`package-lock.json` + the recorded **versionCode/versionName** + your upload
keystore. Check out the revision, `npm ci`, and run `build:release` with the same
version inputs. `npm run sync` first re-copies `static/` into `www/` from that
revision and verifies the required bundle files, then `cap sync android` copies
that same output into the native project, so asset sync is reproducible rather
than hand-edited.

## Continuous integration (GitHub Actions)

`.github/workflows/android-release.yml` builds a signed `.aab` **on demand only**
(manual `workflow_dispatch` with `versionName`/`versionCode` inputs, or an
`android-v*` tag). It is separate from the website `deploy.yml` and never runs on
a website deploy or ordinary push. It uploads the `.aab` as a build artifact and
does **not** publish to Google Play (v1 publication stays manual and owner-approved).

`.github/workflows/lesen-build-artifacts.yml` builds the unsigned Android APK and
the Xcode project for inspection. It runs **on demand only** as well: a manual
`workflow_dispatch`, or a `lesen-v*` tag. It no longer runs on every pull request
or on every push to `main`, because the macOS runner it needs bills at ten times
the Linux rate and `lesen-native.yml` already compiles the app before a merge.
Run it (or tag the release) when an artifact is actually wanted.

The workflow uses Node 22, JDK 21 and Android SDK 36. It is maintainer-owned:
release work should not edit it, and a change to it is an owner handoff. A
passing shared JavaScript test run is not native build evidence: record an
Android debug build and the required iOS simulator proof at the exact upgrade
revision before advancing past the harness's Capacitor prerequisite milestone.

Add these repository **secrets** (Settings → Secrets and variables → Actions):

| Secret | Value |
| --- | --- |
| `BZ_KEYSTORE_BASE64` | `base64 -i buchstabenzeit-upload.jks` (the upload keystore, base64-encoded) |
| `BZ_KEYSTORE_PASSWORD` | keystore store password |
| `BZ_KEY_ALIAS` | key alias (e.g. `buchstabenzeit`) |
| `BZ_KEY_PASSWORD` | key password |

Without `BZ_KEYSTORE_BASE64` the workflow fails early with a clear message; the
decoded keystore is removed from the runner after the build.

## Play App Signing, credentials & account ownership

- **Play App Signing**: let Google manage the *app signing key*. You upload
  bundles signed with your *upload key*; Google re-signs with the app signing key.
  This means a lost upload key can be **reset** via Play Console support without
  bricking the app — but still keep the upload key safe.
- **Backups**: store the upload keystore and its passwords in a password manager /
  secure backup, in at least two locations. Losing both the key and the ability to
  reset it would block future updates.
- **Account ownership**: the Google Play developer account (and its payments
  profile) is owned by the app owner. Document who holds the account, billing, and
  the upload keystore. Consider a standalone package identity suitable for transfer
  (the app id `de.derschweigert.buchstabenzeit` is already independent of any
  individual).
- **Never commit** the keystore, `keystore.properties`, passwords, or CI secrets.

## What stays out of source control

- The upload keystore (`*.jks`) and `keystore.properties` (passwords).
- `local.properties` (local SDK path).
- Play Console account credentials.

See also `../ANDROID-PLAN.md` (§4.D, §6) for policy and distribution context.
