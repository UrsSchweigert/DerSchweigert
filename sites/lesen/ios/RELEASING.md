# Releasing Buchstabenzeit for iOS

This document describes how to turn a known-good source revision into a
versioned, signed iOS app, install it through TestFlight, and verify it on a
physical iPhone. The website (`lesen.derschweigert.de`) and the Android
release are separate and unaffected by this process.

> **External release gate:** producing a validly signed `.ipa`, uploading it to
> App Store Connect, and completing a TestFlight install and upgrade check are
> manual maintainer actions. Nothing in this repository performs or claims that
> gate: the automated checks are the shared JavaScript tests, the offline-bundle
> verification, and the unsigned simulator build in
> `.github/workflows/lesen-native.yml`. A green simulator job is prerequisite
> evidence, not device, signing, or store evidence.

All commands run from `sites/lesen/`. Nothing secret is ever committed.

## What this repository does and does not prove

Proven by checked-in files and CI (no Apple account needed):

- The Capacitor 8 project under `ios/` exists and syncs from `static/`.
- `capacitor.config.json` has no `server.url`, so the webview loads the bundled
  `www/` and never a remote server.
- `ios/App/App/Info.plist` declares `CFBundleLocalizations` as `de` and `en`,
  iPhone layout (`TARGETED_DEVICE_FAMILY = 1`, iPhone only
  orientations), and `MARKETING_VERSION` / `CURRENT_PROJECT_VERSION` version
  keys.
- `ios/App/App/PrivacyInfo.xcprivacy` is registered in the App target's
  Resources build phase and declares the Filesystem plugin's file-timestamp
  access with reason `C617.1`; tracking, tracking domains and collected data are
  empty.
- An unsigned simulator build compiles (`CODE_SIGNING_ALLOWED=NO`).

Not proven by any of the above, and therefore required before a release is
called done: distribution signing, the `.ipa`, TestFlight install/upgrade,
physical-device layout, on-device speech, the silent switch, airplane-mode
behaviour, and the four native capabilities listed under device checks.

## iOS App Review package

`APP-REVIEW.md` is the review package for App Review and for anyone running the
device checks below. It names the four native capabilities as the **native
spine** — native `OfflineTts` speech, local progress/report
(`@capacitor/filesystem` plus `@capacitor/share`), `@capacitor/haptics` grading
feedback, and `@capacitor/local-notifications` practice reminders — gives an airplane-mode
demo script with the expected on-screen result for each step, lists the offline
screenshots to capture, and ends with a copy-paste block for App Store Connect.

The notes are deliberately narrower than the device checklist: every claim is
limited to what the build does. Speech is registered in the compiled scene
bridge. The native-only footer reminder control mounts the shared adapter,
with an adult challenge, default-off opt-in and explicit localized status.
Neither source coverage nor automated doubles replace the device gates below.

Capturing the offline screenshots, attaching them to the submission, and
submitting for App Review are owner actions, exactly like producing the signed
build. `APP-REVIEW.md` documents the capture list; it does not contain
submission images.

## Prerequisites (local, macOS only)

- macOS with **Xcode** whose installed iOS SDK still supports the app's
  deployment target. `ios/App/CapApp-SPM/Package.swift` pins
  `platforms: [.iOS(.v15)]` and `swift-tools-version: 5.9`, so use a current
  Xcode (15 or newer; record the exact version in the release record — the CI
  job prints it with `xcodebuild -version` and `macos-latest` decides which one
  runs there).
- **Swift Package Manager**, which ships with Xcode. The project uses SPM only:
  there is no `Podfile` and no CocoaPods step. `ios/App/CapApp-SPM` is generated
  by the Capacitor CLI and resolves `capacitor-swift-pm` plus the five locked
  plugins from `node_modules`.
- **Node.js 22+** and npm (Capacitor 8.6.0 from the locked
  `package-lock.json`).
- An Apple Developer Program team with the app id
  `de.derschweigert.buchstabenzeit` and an App Store Connect app record. Both
  are owner prerequisites, not repository contents.

## Asset sync (restore → copy → sync)

The web app lives in `static/`; `www/` and the native copy are generated and
gitignored. Never edit generated output by hand.

```bash
npm ci                 # locked dependency install
npm run copy-assets    # static/ -> www/, then verify the offline bundle
npx cap sync ios       # www/ -> ios/App/App/public, regenerate CapApp-SPM
```

`npm run copy-assets` runs `scripts/verify-bundle.mjs`, which fails when a
runtime file is missing or the bundle references a remote server.
`npm test` covers the same bundle expectations together with the shared logic.

Do **not** hand-edit generated or owner-merged files:

- `ios/App/App.xcodeproj/project.pbxproj` — regenerate through supported project
  tooling; a hand edit is an owner handoff.
- `ios/App/CapApp-SPM/Package.swift` and `ios/App/App/capacitor.config.json` —
  rewritten by `npx cap sync ios`; the file itself says "DO NOT MODIFY".
- `ios/App/App/Info.plist`, `ios/App/App/PrivacyInfo.xcprivacy` — reviewed and
  owner-merged. A needed change (new plugin permission, new required-reason
  API, new localization) is an owner handoff, not a worker edit.
- `www/` and `ios/App/App/public/` — build output.

Re-check the privacy manifest whenever plugins change. Use the exact key
`NSPrivacyAccessedAPITypeReasons`; the shortened spelling still parses and ships
but Apple ignores it, which is worse than a missing manifest because it looks
fine locally. Add a reason only for APIs the app actually calls, and keep
tracking domains and collected data empty while the app stays on-device only.

## Unsigned simulator smoke check

Run this before spending signing time. It compiles the real project and proves
the bundle and privacy manifest are present in the built `.app`:

```bash
xcodebuild -project ios/App/App.xcodeproj -scheme App \
  -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath /tmp/buchstabenzeit-ios CODE_SIGNING_ALLOWED=NO build
plutil -lint /tmp/buchstabenzeit-ios/Build/Products/Debug-iphonesimulator/App.app/PrivacyInfo.xcprivacy
```

The generated project uses explicit source build phases, so a new Swift file is
not compiled just because it exists. Use an already compiled source file or
request maintainer-side project registration through supported project tooling.

## Versioning

`CFBundleShortVersionString` comes from `MARKETING_VERSION` (committed default
`1.0`) and `CFBundleVersion` from `CURRENT_PROJECT_VERSION` (committed default
`1`), both defined in the owner-merged `project.pbxproj`. Do not hand-edit that
file per release. Override the values at build time instead, exactly as the
Android build takes `-PbzVersionCode`/`-PbzVersionName`:

```bash
xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Release \
  -destination 'generic/platform=iOS' -archivePath /tmp/Buchstabenzeit.xcarchive \
  MARKETING_VERSION=1.1 CURRENT_PROJECT_VERSION=2 \
  -allowProvisioningUpdates archive
```

Rules:

- `CFBundleVersion` must strictly increase for every upload to App Store
  Connect, including re-uploads of the same marketing version. It is independent
  of Android's `versionCode`; keep the human-readable version in step with the
  Android `versionName` where practical.
- Bump `MARKETING_VERSION` for a user-visible release; the about dialog shows
  the native version through `@capacitor/app` `getInfo()`.
- Record git revision, Xcode version, both version values, date, and release
  notes for every release.

## Signing and secrets (owner prerequisites)

Distribution signing needs material that must never enter this repository:
an Apple Distribution certificate (`.p12` plus password), an App Store
provisioning profile (`.mobileprovision`), and App Store Connect API key
credentials (`.p8`, key id, issuer id). Keep them in the owner's password
manager and in the CI secret store, not on disk in the work tree.

A future dedicated signed-release workflow
(`.github/workflows/ios-release.yml`) is maintainer-owned and is **not** created
or edited by this document's task. When the owner adds it, these are the
intended secret names, all placeholders until that workflow exists:

| Secret | Value |
| --- | --- |
| `APPLE_TEAM_ID` | Apple Developer team identifier |
| `APPLE_DISTRIBUTION_CERTIFICATE_BASE64` | `base64 -i distribution.p12` |
| `APPLE_CERTIFICATE_PASSWORD` | password for the `.p12` |
| `APPLE_PROVISIONING_PROFILE_BASE64` | `base64 -i Buchstabenzeit.mobileprovision` |
| `APPLE_KEYCHAIN_PASSWORD` | ephemeral runner keychain password |
| `APP_STORE_CONNECT_API_KEY_ID` | App Store Connect API key id |
| `APP_STORE_CONNECT_API_ISSUER_ID` | App Store Connect issuer id |
| `APP_STORE_CONNECT_API_KEY_BASE64` | `base64 -i AuthKey_XXXXXXXXXX.p8` |

No certificate, profile, `.p8`, `.p12`, `.mobileprovision`, `.cer`,
`.entitlements` file, or password is ever committed. The repository does not
ignore `*.p12`, `*.p8`, `*.mobileprovision`, `ExportOptions.plist`, `.ipa` or
`.xcarchive` files, so keep every one of them outside the work tree (for example
under `/tmp` or a directory above the checkout) rather than relying on
`.gitignore`. Import the certificate into a temporary keychain on the runner,
decode the profile into `~/Library/MobileDevice/Provisioning Profiles`, and
delete both after the build. The workflow should not upload to TestFlight or the
App Store without an explicit owner-approved trigger, matching how
`android-release.yml` builds without publishing.

## Producing and uploading the build

1. Check out the known-good revision and run the asset sync and tests above.
2. Archive with the per-release version overrides (see Versioning).
3. Export a signed `.ipa` with an `ExportOptions.plist` kept outside the repo
   (it contains the team id and distribution method):

   ```bash
   xcodebuild -exportArchive -archivePath /tmp/Buchstabenzeit.xcarchive \
     -exportPath /tmp/export \
     -exportOptionsPlist /path/outside/repo/ExportOptions.plist
   ```

   The result is `/tmp/export/Buchstabenzeit.ipa`.
4. Upload it through Xcode Organizer (Distribute App → App Store Connect →
   Upload) or the Transporter app. Answer the export-compliance question per
   build; the app uses no non-exempt encryption.
5. In App Store Connect, add the build to the internal TestFlight group and
   install it on real devices. App Review submission, screenshots for
   submission, and store metadata are owner actions and stay outside this
   repository's checks.

## TestFlight installation and per-release device checks

Install the TestFlight build on at least one physical iPhone (the app is
iPhone-only), then repeat this checklist for **every** release and record
the result in the release record:

1. **Offline cold launch.** Enable airplane mode, force-quit, and launch. The
   full setup screen appears with no spinner or blank page; nothing is fetched
   from a network. Rotate the device and confirm the layout respects the safe
   areas and both orientations from `Info.plist`.
2. **Language switch.** Toggle the German and English flags in setup and check setup, practice, and the
   about dialog in both. The privacy link must open the matching bundled page
   (`datenschutz.html` for German, `datenschutz-en.html` for English) with no
   network request. Confirm word lists and sounds follow the selected language.
3. **Native capability 2 — Progress/report export.** In the parent report, export the
   CSV. It is written to the app's own cache directory with
   `@capacitor/filesystem` and the app reports success; no permission prompt
   appears because the file never leaves the app container.
4. **Report share sheet (also capability 2).** The exported CSV opens the system share
   sheet through `@capacitor/share`; sharing or saving works and cancelling
   returns to the app without losing the report.
5. **Native capability 4 — Haptics.** Correct and incorrect answers give distinct
   native success/error feedback through `@capacitor/haptics`, and no
   haptics fire when Reduce Motion is enabled in iOS Settings.
6. **Native capability 3 — Local notifications.** Open the footer's
   **Übungserinnerungen / Practice reminders**, solve the adult challenge and
   choose the time. Wrong answers cannot open settings; closing/backgrounding
   locks the gate again. Reminders are off by default and permission is only
   requested when an adult enables them and saves. Allow → one inexact daily
   reminder is scheduled and delivered. Deny → the denial is remembered and the
   app never re-prompts. Cold restart restores the selected time without
   prompting. Disabling cancels; cancellation failure must not look disabled.
7. **Native capability 1 — Speech.** Optional practice speech uses the locally
   registered `OfflineTts` plugin and `AVSpeechSynthesizer`. It accepts only
   enumerated installed Apple compact DE/EN voices, preferring de-DE for
   German, with rate/pitch controls in the bridge contract. With airplane mode
   on, confirm speech works; with no eligible voice, visible feedback explains
   that audio is unavailable and practice continues.
8. **Upgrade.** Install the previous TestFlight build, then install the new one
   over it. Saved progress, language, and settings survive, and the about dialog
   shows the new version.
9. **Silent switch and lifecycle.** Practice audio stops when the app is
   backgrounded or the device is locked. The native bridge configures
   `AVAudioSession` playback/spokenAudio with duckOthers: verify speech with the
   silent switch on and other audio ducking on the tested device/iOS version.
   A call stops stale speech; after it ends, a new tap should work without
   automatically restarting an old card. Record actual results, not just the
   intended session configuration.

A simulator pass does not substitute for any item above: the simulator has no
haptics, no real notification delivery, no silent switch, and no TestFlight
signing path.

## Release record

| Date | Git revision | Xcode | MARKETING_VERSION | CURRENT_PROJECT_VERSION | TestFlight build | Device checks | Notes |
| --- | --- | --- | ---: | ---: | --- | --- | --- |
| _none yet_ | | | 1.0 | 1 | — | — | Project scaffolded; no signed build or TestFlight install performed. |

## Continuous integration

`.github/workflows/lesen-native.yml` contains the existing `ios` job. It runs on
macOS, installs the locked dependencies, runs `npm run copy-assets`, syncs the
Capacitor project, and compiles it for a generic iOS Simulator destination with
`CODE_SIGNING_ALLOWED=NO`. It is maintainer-owned: a change to it is an owner
handoff, and this document does not add or modify workflows.

The future `.github/workflows/ios-release.yml` for signed builds and TestFlight
uploads is owner-created and maintainer-owned. Until it exists, signed builds
are made locally as described above, and a signed `.ipa` plus a TestFlight
install/upgrade check remain external gates.

## What stays out of source control

- Distribution certificates, provisioning profiles, App Store Connect API keys.
- `ExportOptions.plist`, `*.xcarchive`, exported `.ipa` files.
- Derived data, `xcuserdata`, and the generated `www/` /
  `ios/App/App/public/` copies.
- App Store Connect and Apple Developer account credentials.

## See also

- `APP-REVIEW.md` — App Review notes, native-spine capability list, and the
  airplane-mode demo script.
- `../RELEASING.md` — Android release process, versioning log, and the shared
  plugin/privacy prerequisites.
- `../ANDROID-PLAN.md` — distribution policy context shared by both stores.
